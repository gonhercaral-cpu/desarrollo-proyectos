import { useMemo, useState } from "react";
import { ACADEMIC_BLOCKS, ACADEMIC_TYPE_OPTIONS, EXERCISE_TYPES, getAcademicTypeLabel, normalizeAcademicMetadata } from "../../models/editorialAcademic";
import EditorialIcon from "../EditorialIcon";

const EXERCISE_LABELS = { multiple_choice: "Opción múltiple", fill_blanks: "Completar espacios", true_false: "Verdadero o falso", matching: "Relacionar columnas", open_questions: "Preguntas abiertas" };
const TABS = [["blocks", "Bloques"], ["exercises", "Ejercicios"], ["songs", "Canciones"], ["related", "Relacionados"], ["saved", "Guardados"]];

function AcademicCard({ value, title, subtitle, thumbnail, onInsert, onOpen, draggable = false }) {
  return <article className="editorial-academic-card" draggable={draggable} onDragStart={draggable ? (event) => event.dataTransfer.setData("application/x-editorial-academic", JSON.stringify({ kind: "block", value })) : undefined}><button type="button" onClick={onOpen || onInsert} disabled={!onOpen && !onInsert}><span className="editorial-academic-card-icon" style={{ background: thumbnail?.background || undefined }}><EditorialIcon name="academic" size={18} /></span><span><strong>{title}</strong><small>{subtitle}</small></span></button>{onInsert && <button type="button" className="editorial-academic-insert" onClick={onInsert}>Insertar</button>}</article>;
}

export default function EditorialAcademicLibraryPanel({ project, metadata, design, relatedProjects, editorMode, onAction }) {
  const [tab, setTab] = useState("blocks");
  const [search, setSearch] = useState("");
  const [series, setSeries] = useState(metadata.seriesId || "");
  const [level, setLevel] = useState(metadata.levelId || "");
  const [academicType, setAcademicType] = useState("");
  const normalized = search.trim().toLowerCase();
  const blocks = useMemo(() => ACADEMIC_BLOCKS.filter((item) => item.label.toLowerCase().includes(normalized)), [normalized]);
  const related = useMemo(() => relatedProjects.filter((item) => {
    const itemMetadata = normalizeAcademicMetadata(item);
    return (!series || itemMetadata.seriesId === series) && (!level || itemMetadata.levelId === level) && (!academicType || itemMetadata.academicType === academicType) && `${item.name} ${itemMetadata.academicType || ""}`.toLowerCase().includes(normalized);
  }), [academicType, level, normalized, relatedProjects, series]);
  const saved = useMemo(() => design.components.filter((item) => {
    const itemMetadata = normalizeAcademicMetadata(item);
    return (!series || itemMetadata.seriesId === series) && (!level || itemMetadata.levelId === level) && (!academicType || itemMetadata.academicType === academicType) && `${item.name} ${item.category}`.toLowerCase().includes(normalized);
  }), [academicType, design.components, level, normalized, series]);
  const canInsert = editorMode.kind === "page";
  return (
    <aside className="editorial-structure-panel editorial-academic-library">
      <header><strong>Biblioteca académica</strong><button type="button" onClick={() => onAction("metadata")}>Vincular</button></header>
      <div className="editorial-academic-tabs">{TABS.map(([value, label]) => <button type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)} key={value}>{label}</button>)}</div>
      <div className="editorial-design-tools"><label><EditorialIcon name="search" size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar" /></label></div>
      {(tab === "related" || tab === "saved") && <div className="editorial-academic-filters"><select value={academicType} onChange={(event) => setAcademicType(event.target.value)} aria-label="Tipo académico">{ACADEMIC_TYPE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><input value={series} onChange={(event) => setSeries(event.target.value)} placeholder="Serie" /><input value={level} onChange={(event) => setLevel(event.target.value)} placeholder="Nivel" /></div>}
      <div className="editorial-design-list editorial-academic-list">
        {tab === "blocks" && blocks.map((block) => <AcademicCard key={block.value} value={block.value} title={block.label} subtitle="Bloque editable" draggable={canInsert} onInsert={canInsert ? () => onAction("insert-block", block.value) : null} />)}
        {tab === "exercises" && EXERCISE_TYPES.filter((type) => EXERCISE_LABELS[type].toLowerCase().includes(normalized)).map((type) => <AcademicCard key={type} value={type} title={EXERCISE_LABELS[type]} subtitle="Abrir asistente" onOpen={canInsert ? () => onAction("exercise", type) : undefined} />)}
        {tab === "songs" && <><AcademicCard value="song" title="Hoja de canción" subtitle="Letra manual · Alumno/Maestro" onOpen={canInsert ? () => onAction("song") : undefined} />{project.academicType === "song" && <p className="editorial-academic-note">Este proyecto está marcado como canción.</p>}</>}
        {tab === "related" && <><button type="button" className="editorial-button compact primary" onClick={() => onAction("new-related")}>Nuevo material vinculado</button>{related.map((item) => <AcademicCard key={item.id} title={item.name} subtitle={`${getAcademicTypeLabel(item.academicType)} · ${item.unitTitle || item.lessonTitle || "Mismo libro"}`} onOpen={() => onAction("open-related", item)} />)}</>}
        {tab === "saved" && saved.map((item) => <AcademicCard key={item.id} title={item.name} subtitle={item.category || "General"} thumbnail={item.thumbnail} onInsert={canInsert ? () => onAction("insert-component", item) : null} />)}
        {((tab === "blocks" && !blocks.length) || (tab === "related" && !related.length) || (tab === "saved" && !saved.length)) && <div className="editorial-panel-empty"><EditorialIcon name="academic" size={26} /><p>No hay resultados.</p></div>}
      </div>
      <footer className="editorial-academic-library-footer"><button type="button" onClick={() => onAction("answers")}>Respuestas</button><button type="button" onClick={() => onAction("validate")}>Validar página</button></footer>
    </aside>
  );
}
