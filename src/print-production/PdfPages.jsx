import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { previewDocument } from "./service.js";

GlobalWorkerOptions.workerSrc = workerUrl;
const PAGE_SIZE = 6;

function PageThumbnail({ pdf, number, selected, onSelect }) {
  const canvas = useRef(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let render;
    const target = canvas.current;
    pdf.getPage(number).then((page) => {
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(192 / natural.width, 256 / natural.height);
      const viewport = page.getViewport({ scale });
      target.width = Math.ceil(viewport.width);
      target.height = Math.ceil(viewport.height);
      render = page.render({ canvas: target, viewport });
      return render.promise;
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, number]);

  return (
    <button type="button" className="pp-page-thumb" aria-label={`Abrir página ${number}`}
      aria-pressed={selected === number} onClick={() => onSelect(number)}>
      <span>{failed ? "Vista no disponible" : <canvas ref={canvas} aria-hidden="true" />}</span>
      <strong>Página {number}</strong>
    </button>
  );
}

export default function PdfPages({ source, blob, selected, onSelect }) {
  const [pdf, setPdf] = useState(null);
  const [error, setError] = useState(false);
  const [first, setFirst] = useState(() => Math.floor(((selected || 1) - 1) / PAGE_SIZE) * PAGE_SIZE + 1);
  useEffect(() => {
    let active = true;
    let task;
    (async () => {
      const file = blob || await previewDocument(source);
      if (!active) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!active) return;
      task = getDocument({ data: bytes, useWasm: false, isEvalSupported: false, enableXfa: false, stopAtErrors: true });
      const document = await task.promise;
      if (active) setPdf(document);
    })().catch(() => { if (active) setError(true); });
    return () => { active = false; void task?.destroy().catch(() => {}); };
  }, [source, blob]);

  if (error) return <p className="pp-loading" role="status">No se pudieron generar las miniaturas. El visor del PDF sigue disponible.</p>;
  if (!pdf) return <p className="pp-loading" role="status">Preparando miniaturas…</p>;
  const start = Math.min(first, Math.floor((pdf.numPages - 1) / PAGE_SIZE) * PAGE_SIZE + 1);
  const last = Math.min(start + PAGE_SIZE - 1, pdf.numPages);
  return (
    <section className="pp-page-gallery" aria-label="Miniaturas de páginas">
      <div className="pp-divider">
        <h3>Miniaturas del PDF</h3>
        <div className="pp-row-actions">
          <button type="button" className="pp-btn" aria-label="Páginas anteriores" disabled={start === 1}
            onClick={() => setFirst(start - PAGE_SIZE)}>‹</button>
          <span aria-live="polite">{start}–{last} de {pdf.numPages}</span>
          <button type="button" className="pp-btn" aria-label="Páginas siguientes" disabled={last === pdf.numPages}
            onClick={() => setFirst(start + PAGE_SIZE)}>›</button>
        </div>
      </div>
      <div className="pp-page-grid">
        {Array.from({ length: last - start + 1 }, (_, i) => (
          <PageThumbnail key={start + i} pdf={pdf} number={start + i} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}
