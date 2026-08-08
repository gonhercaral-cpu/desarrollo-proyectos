import { useEffect, useMemo, useState } from "react";
import { detectFileKind, FILE_KINDS, isEditorialImportable, isInternallyPreviewable } from "../utils/fileTypes";
import { parseDocxBlob } from "../services/docxService";

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "Tamaño desconocido";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FileViewerModal({ file, loadFile, onClose, onOpenEditorial, canOpenEditorial = false }) {
  const kind = detectFileKind(file);
  const previewable = isInternallyPreviewable(file);
  const [blob, setBlob] = useState(null);
  const [objectUrl, setObjectUrl] = useState("");
  const [text, setText] = useState("");
  const [docx, setDocx] = useState(null);
  const [loading, setLoading] = useState(previewable);
  const [error, setError] = useState("");
  const [editorialLoading, setEditorialLoading] = useState(false);

  const info = useMemo(() => [
    file?.mimeType || "Tipo desconocido",
    formatBytes(file?.size),
    file?.modifiedTime ? new Date(file.modifiedTime).toLocaleString("es-MX") : "Sin fecha",
  ].join(" · "), [file]);

  useEffect(() => {
    let active = true;
    let nextUrl = "";
    if (!previewable) {
      return () => {};
    }

    loadFile(file)
      .then(async (nextBlob) => {
        if (!active) return;
        setBlob(nextBlob);
        if (kind === FILE_KINDS.TEXT) setText(await nextBlob.text());
        if (kind === FILE_KINDS.DOCX) setDocx(await parseDocxBlob(nextBlob));
        if (![FILE_KINDS.TEXT, FILE_KINDS.DOCX].includes(kind)) {
          nextUrl = URL.createObjectURL(nextBlob);
          setObjectUrl(nextUrl);
        }
      })
      .catch((loadError) => active && setError(loadError.message || "No se pudo abrir el archivo."))
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [file, kind, loadFile, previewable]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function handleDownload() {
    try {
      const downloadBlob = blob || await loadFile(file);
      const url = URL.createObjectURL(downloadBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file?.name || "archivo";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      setError(downloadError.message || "No se pudo descargar el archivo.");
    }
  }

  async function handleOpenEditorial() {
    setEditorialLoading(true);
    setError("");
    try {
      await onOpenEditorial(file, blob || await loadFile(file));
    } catch (editorialError) {
      setError(editorialError.message || "No se pudo abrir el archivo en Editor Editorial.");
      setEditorialLoading(false);
    }
  }

  return (
    <div className="drive-preview-backdrop" role="dialog" aria-modal="true" aria-label={`Vista previa de ${file?.name || "archivo"}`}>
      <div className="drive-preview-modal drive-internal-viewer">
        <header className="drive-preview-header">
          <div><span>{info}</span><strong>{file?.name || "Archivo sin nombre"}</strong></div>
          <div className="drive-preview-actions">
            {canOpenEditorial && isEditorialImportable(file) ? (
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
          {error ? <div className="drive-preview-state error"><strong>No se pudo mostrar el archivo</strong><p>{error}</p><button type="button" onClick={handleDownload}>Descargar</button></div> : null}
          {!loading && !error && kind === FILE_KINDS.PDF ? <iframe title={file?.name || "PDF"} src={objectUrl} /> : null}
          {!loading && !error && kind === FILE_KINDS.IMAGE ? <img className="drive-viewer-image" src={objectUrl} alt={file?.name || "Imagen"} /> : null}
          {!loading && !error && kind === FILE_KINDS.TEXT ? <pre className="drive-viewer-text">{text}</pre> : null}
          {!loading && !error && kind === FILE_KINDS.VIDEO ? <video className="drive-viewer-media" src={objectUrl} controls autoPlay={false} /> : null}
          {!loading && !error && kind === FILE_KINDS.AUDIO ? <div className="drive-viewer-audio"><strong>{file?.name}</strong><audio src={objectUrl} controls /></div> : null}
          {!loading && !error && kind === FILE_KINDS.DOCX ? (
            <article className="drive-viewer-docx">
              <p className="drive-viewer-warning">{docx?.warnings?.[0]}</p>
              {docx?.blocks?.length ? docx.blocks.map((block, index) => {
                const level = Number(block.type.replace("heading", ""));
                const Tag = level >= 1 && level <= 6 ? `h${level}` : "p";
                return <Tag key={`${index}-${block.text.slice(0, 20)}`} className={block.type === "tableRow" ? "docx-table-row" : ""}>{block.text}</Tag>;
              }) : <p>Documento sin texto compatible para vista previa.</p>}
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
