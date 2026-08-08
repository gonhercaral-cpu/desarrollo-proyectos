import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectFileKind, FILE_KINDS, isEditorialImportable, isInternallyPreviewable } from "../utils/fileTypes";
import { parseDocxBlob } from "../services/docxService";
import { getCloudFileErrorMessage } from "../services/driveService";

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "Tamaño desconocido";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeContent(result, file) {
  if (result instanceof Blob) {
    const kind = detectFileKind(file);
    return {
      blob: result,
      originalName: file?.name || "archivo",
      deliveredName: file?.name || "archivo",
      originalMimeType: file?.mimeType || result.type,
      deliveredMimeType: result.type || file?.mimeType || "application/octet-stream",
      kind,
      size: result.size,
      exported: false,
      previewable: isInternallyPreviewable(file),
      editable: isEditorialImportable(file),
    };
  }
  return result;
}

function DocxRuns({ runs, fallback }) {
  if (!runs?.length) return fallback;
  return runs.map((run, index) => {
    let content = run.text;
    if (run.underline) content = <u>{content}</u>;
    if (run.italic) content = <em>{content}</em>;
    if (run.bold) content = <strong>{content}</strong>;
    return <span key={`${index}-${run.text.slice(0, 12)}`}>{content}</span>;
  });
}

function DocxBlock({ block }) {
  if (block.type === "tableRow") {
    return (
      <div className="docx-table-row" role="row">
        {(block.cells || [block.text]).map((cell, cellIndex) => (
          <span role="cell" key={`${cellIndex}-${cell.slice(0, 16)}`}>{cell}</span>
        ))}
      </div>
    );
  }
  const level = Number(block.type.replace("heading", ""));
  const Tag = level >= 1 && level <= 6 ? `h${level}` : "p";
  return (
    <Tag
      className={block.list ? "docx-list-item" : ""}
      style={{ textAlign: block.alignment || "left", paddingLeft: block.list ? `${block.list.level * 24}px` : undefined }}
    >
      {block.marker ? <span className="docx-list-marker">{block.marker}</span> : null}
      <DocxRuns runs={block.runs} fallback={block.text} />
    </Tag>
  );
}

export default function FileViewerModal({ file, loadFile, onClose, onOpenEditorial, canOpenEditorial = false }) {
  const requestedKind = detectFileKind(file);
  const requestedPreviewable = isInternallyPreviewable(file);
  const [content, setContent] = useState(null);
  const [resolvedKind, setResolvedKind] = useState(requestedKind);
  const [objectUrl, setObjectUrl] = useState("");
  const [text, setText] = useState("");
  const [docx, setDocx] = useState(null);
  const [loading, setLoading] = useState(requestedPreviewable);
  const [error, setError] = useState(null);
  const [editorialLoading, setEditorialLoading] = useState(false);
  const contentPromiseRef = useRef(null);

  const previewable = content ? content.previewable : requestedPreviewable;
  const editorialImportable = content ? content.editable : isEditorialImportable(file);
  const info = useMemo(() => [
    content?.deliveredMimeType || file?.mimeType || "Tipo desconocido",
    formatBytes(content?.size || file?.size),
    content?.exported ? `Exportado desde ${content.originalMimeType}` : null,
    file?.modifiedTime ? new Date(file.modifiedTime).toLocaleString("es-MX") : "Sin fecha",
  ].filter(Boolean).join(" · "), [content, file]);

  const requestContent = useCallback(() => {
    if (!contentPromiseRef.current) {
      contentPromiseRef.current = loadFile(file)
        .then((result) => normalizeContent(result, file))
        .catch((loadError) => {
          contentPromiseRef.current = null;
          throw loadError;
        });
    }
    return contentPromiseRef.current;
  }, [file, loadFile]);

  useEffect(() => {
    let active = true;
    let nextUrl = "";
    if (!requestedPreviewable) return () => {};

    requestContent()
      .then(async (nextContent) => {
        if (!nextContent?.blob) {
          const invalidError = new Error("Nube AES no devolvió contenido binario válido.");
          invalidError.code = "invalid-response";
          throw invalidError;
        }
        const nextKind = nextContent.kind || detectFileKind({
          name: nextContent.deliveredName,
          mimeType: nextContent.deliveredMimeType,
        });
        if (!active) return;
        setContent(nextContent);
        setResolvedKind(nextKind);
        if (nextContent.previewable === false) return;
        if (nextKind === FILE_KINDS.TEXT) setText(await nextContent.blob.text());
        if (nextKind === FILE_KINDS.DOCX) setDocx(await parseDocxBlob(nextContent.blob));
        if (![FILE_KINDS.TEXT, FILE_KINDS.DOCX].includes(nextKind)) {
          nextUrl = URL.createObjectURL(nextContent.blob);
          setObjectUrl(nextUrl);
        }
      })
      .catch((loadError) => {
        console.error("Nube AES: error de vista previa", loadError);
        if (active) setError({
          title: "No se pudo mostrar el archivo",
          message: getCloudFileErrorMessage(loadError, "mostrar"),
        });
      })
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [file, requestContent, requestedPreviewable]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function ensureContent() {
    return content || requestContent();
  }

  async function handleDownload() {
    try {
      const downloadContent = await ensureContent();
      const url = URL.createObjectURL(downloadContent.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadContent.deliveredName || file?.name || "archivo";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      console.error("Nube AES: error de descarga", downloadError);
      setError({
        title: "No se pudo descargar el archivo",
        message: getCloudFileErrorMessage(downloadError, "descargar"),
      });
    }
  }

  async function handleOpenEditorial() {
    setEditorialLoading(true);
    setError(null);
    try {
      await onOpenEditorial(file, await ensureContent());
    } catch (editorialError) {
      console.error("Nube AES: error de importación editorial", editorialError);
      setError({
        title: "No se pudo importar al Editor Editorial",
        message: getCloudFileErrorMessage(editorialError, "importar"),
      });
      setEditorialLoading(false);
    }
  }

  return (
    <div className="drive-preview-backdrop" role="dialog" aria-modal="true" aria-label={`Vista previa de ${file?.name || "archivo"}`}>
      <div className="drive-preview-modal drive-internal-viewer">
        <header className="drive-preview-header">
          <div><span>{info}</span><strong>{file?.name || "Archivo sin nombre"}</strong></div>
          <div className="drive-preview-actions">
            {canOpenEditorial && editorialImportable ? (
              <button className="visual-primary-button" type="button" onClick={handleOpenEditorial} disabled={editorialLoading}>
                {editorialLoading ? "Importando..." : "Abrir en Editor Editorial"}
              </button>
            ) : null}
            <button className="visual-outline-button" type="button" onClick={handleDownload}>Descargar</button>
            {file?.webViewLink ? <a className="visual-outline-button" href={file.webViewLink} target="_blank" rel="noreferrer">Abrir externamente</a> : null}
            <button className="drive-preview-close" type="button" onClick={onClose} aria-label="Cerrar vista previa">×</button>
          </div>
        </header>
        <div className="drive-preview-body drive-internal-viewer-body">
          {loading ? <div className="drive-preview-state"><strong>Cargando archivo...</strong><progress /></div> : null}
          {error ? <div className="drive-preview-state error"><strong>{error.title}</strong><p>{error.message}</p><button type="button" onClick={handleDownload}>Descargar</button></div> : null}
          {!loading && !error && resolvedKind === FILE_KINDS.PDF ? <iframe title={file?.name || "PDF"} src={objectUrl} /> : null}
          {!loading && !error && resolvedKind === FILE_KINDS.IMAGE ? <img className="drive-viewer-image" src={objectUrl} alt={file?.name || "Imagen"} /> : null}
          {!loading && !error && resolvedKind === FILE_KINDS.TEXT ? <pre className="drive-viewer-text">{text}</pre> : null}
          {!loading && !error && resolvedKind === FILE_KINDS.VIDEO ? <video className="drive-viewer-media" src={objectUrl} controls autoPlay={false} /> : null}
          {!loading && !error && resolvedKind === FILE_KINDS.AUDIO ? <div className="drive-viewer-audio"><strong>{file?.name}</strong><audio src={objectUrl} controls /></div> : null}
          {!loading && !error && resolvedKind === FILE_KINDS.DOCX ? (
            <article className="drive-viewer-docx">
              {docx?.warnings?.[0] ? <p className="drive-viewer-warning">{docx.warnings[0]}</p> : null}
              {docx?.blocks?.length
                ? docx.blocks.map((block, index) => <DocxBlock block={block} key={`${index}-${block.text.slice(0, 20)}`} />)
                : <p>DOCX válido, pero sin párrafos, listas ni tablas visibles.</p>}
            </article>
          ) : null}
          {!loading && !error && !previewable ? (
            <div className="drive-preview-state"><strong>Vista previa no disponible</strong><p>Este formato todavía no tiene visor interno. Puedes descargarlo o abrirlo externamente.</p></div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
