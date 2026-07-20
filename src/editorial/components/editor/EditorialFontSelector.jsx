import { useEffect, useMemo, useRef, useState } from "react";
import { resolveFontVariant } from "../../models/editorialFonts";

const RECENT_KEY = "editorial-recent-fonts";
const STATUS_LABELS = { available: "Disponible", loading: "Cargando…", unavailable: "No cargó", not_embeddable: "Fallback PDF" };

function readRecentFonts() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter((item) => typeof item === "string").slice(0, 5); }
  catch { return []; }
}

export default function EditorialFontSelector({ value, style, catalog, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState(readRecentFonts);
  const [family, setFamily] = useState("");
  const [license, setLicense] = useState("");
  const [weight, setWeight] = useState("400");
  const [italic, setItalic] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const requestedVariant = resolveFontVariant({ weight: style?.fontWeight, italic: style?.fontStyle === "italic" });
  const options = useMemo(() => catalog?.buildOptions?.(requestedVariant) || [], [catalog, requestedVariant]);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    const matches = term ? options.filter((option) => option.family.toLocaleLowerCase("es").includes(term)) : options;
    return [...matches].sort((left, right) => {
      const leftRecent = recent.indexOf(left.family); const rightRecent = recent.indexOf(right.family);
      if (leftRecent >= 0 || rightRecent >= 0) return (leftRecent < 0 ? 99 : leftRecent) - (rightRecent < 0 ? 99 : rightRecent);
      return left.category.localeCompare(right.category, "es") || left.family.localeCompare(right.family, "es");
    });
  }, [options, query, recent]);

  useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    function outside(event) { if (!rootRef.current?.contains(event.target)) setOpen(false); }
    function escape(event) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  function select(option) {
    if (!option?.selectable) { setNotice(option?.status === "unavailable" ? "La fuente no cargó; se conserva la fuente actual." : `Variante ${requestedVariant} todavía está cargando.`); return; }
    const nextRecent = [option.family, ...recent.filter((item) => item !== option.family)].slice(0, 5);
    setRecent(nextRecent);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(nextRecent)); } catch { /* almacenamiento opcional */ }
    setNotice(option.pdfEmbeddable === false ? "PDF usará fallback explícito." : "");
    setOpen(false);
    setQuery("");
    onChange(option.family);
  }

  function handleListKey(event) {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(filtered.length - 1, index + 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
    if (event.key === "Enter") { event.preventDefault(); select(filtered[activeIndex]); }
  }

  async function upload() {
    if (!file || !family.trim() || !license.trim()) return;
    setBusy(true); setNotice("Cargando fuente…");
    try {
      await catalog.uploadFont({ file, family: family.trim(), weight: Number(weight), style: italic ? "italic" : "normal", license: license.trim() });
      setNotice("Fuente guardada. Esperando carga de FontFace…"); setFile(null);
    } catch (error) { setNotice(error.message || "No fue posible cargar fuente."); }
    finally { setBusy(false); }
  }

  return (
    <div className="editorial-font-selector" ref={rootRef}>
      <span className="editorial-font-label">Fuente · variante {requestedVariant}</span>
      <button type="button" className="editorial-font-picker-trigger" aria-haspopup="listbox" aria-expanded={open} style={{ fontFamily: value }} onClick={() => { setOpen((current) => !current); setActiveIndex(0); }}>{value || "Arial"}<span>▾</span></button>
      {open && <div className="editorial-font-picker-popover">
        <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={handleListKey} placeholder="Buscar fuente" aria-label="Buscar fuente" />
        <div className="editorial-font-picker-list" role="listbox" aria-label="Fuentes disponibles">
          {filtered.map((option, index) => <button type="button" role="option" aria-selected={option.family === value} className={index === activeIndex ? "active" : ""} disabled={!option.selectable} key={option.family} onMouseEnter={() => setActiveIndex(index)} onClick={() => select(option)} style={{ fontFamily: option.family }}><span><strong>{option.family}</strong><small>{option.category}{recent.includes(option.family) ? " · Reciente" : ""}</small></span><em>{STATUS_LABELS[option.status] || option.status}</em></button>)}
          {!filtered.length && <p>Sin coincidencias.</p>}
        </div>
      </div>}
      <details>
        <summary>Agregar fuente autorizada</summary>
        <label className="editorial-inspector-file">TTF, OTF, WOFF o WOFF2<input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        <label className="editorial-inspector-field"><span>Familia</span><input value={family} onChange={(event) => setFamily(event.target.value)} /></label>
        <div className="editorial-inspector-grid two"><label className="editorial-inspector-field"><span>Peso</span><select value={weight} onChange={(event) => setWeight(event.target.value)}><option value="400">Normal</option><option value="700">Bold</option></select></label><label className="editorial-inspector-checkbox"><input type="checkbox" checked={italic} onChange={(event) => setItalic(event.target.checked)} />Italic</label></div>
        <label className="editorial-inspector-field wide"><span>Licencia o autorización</span><input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="Nombre/licencia interna" /></label>
        <button type="button" onClick={upload} disabled={busy || !file || !family.trim() || !license.trim()}>{busy ? "Cargando…" : "Registrar fuente"}</button>
      </details>
      {notice && <p className="editorial-font-notice">{notice}</p>}
    </div>
  );
}
