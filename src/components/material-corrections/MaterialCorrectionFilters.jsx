import {
  ERROR_TYPE_OPTIONS,
  MATERIAL_CORRECTION_PRIORITY_OPTIONS,
  MATERIAL_CORRECTION_STATUS_OPTIONS,
  MATERIAL_TYPE_OPTIONS,
} from "../../material-corrections/constants";

const FILTER_DEFINITIONS = [
  ["status", "Estado", MATERIAL_CORRECTION_STATUS_OPTIONS],
  ["priority", "Prioridad", MATERIAL_CORRECTION_PRIORITY_OPTIONS],
  ["level", "Nivel"],
  ["book", "Libro"],
  ["unit", "Unidad"],
  ["lesson", "Lección"],
  ["materialType", "Tipo de material", MATERIAL_TYPE_OPTIONS],
  ["errorType", "Tipo de error", ERROR_TYPE_OPTIONS],
  ["reporter", "Reportante"],
  ["campus", "Plantel"],
  ["assigned", "Responsable"],
];

function uniqueOptions(reports, key, assignees) {
  if (key === "assigned") {
    return [
      { value: "unassigned", label: "Sin responsable" },
      ...assignees.map((assignee) => ({ value: assignee.uid, label: assignee.name })),
    ];
  }
  const getter = {
    level: (report) => report.levelName,
    book: (report) => report.bookName,
    unit: (report) => report.unitNumber,
    lesson: (report) => report.lessonNumber,
    reporter: (report) => report.reportedBy?.name,
    campus: (report) => report.reportedBy?.campus,
  }[key];
  return Array.from(new Set(reports.map(getter).filter((value) => value !== null && value !== undefined && value !== "")))
    .sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }))
    .map((value) => ({ value: String(value), label: String(value) }));
}

export default function MaterialCorrectionFilters({
  filters,
  onChange,
  reports,
  assignees,
  onClear,
}) {
  return (
    <section className="material-correction-filters" aria-label="Filtros de reportes">
      <div className="material-filter-grid">
        {FILTER_DEFINITIONS.map(([key, label, staticOptions]) => {
          const options = staticOptions || uniqueOptions(reports, key, assignees);
          return (
            <label key={key}>
              {label}
              <select value={filters[key] || ""} onChange={(event) => onChange(key, event.target.value)}>
                <option value="">Todos</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          );
        })}
        <label>
          Evidencia
          <select value={filters.evidence || ""} onChange={(event) => onChange("evidence", event.target.value)}>
            <option value="">Todos</option>
            <option value="with">Con evidencia</option>
            <option value="without">Sin evidencia</option>
          </select>
        </label>
        <label>
          Desde
          <input type="date" value={filters.dateFrom || ""} onChange={(event) => onChange("dateFrom", event.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={filters.dateTo || ""} onChange={(event) => onChange("dateTo", event.target.value)} />
        </label>
      </div>
      <div className="material-filter-checks">
        <label>
          <input type="checkbox" checked={filters.pendingInPerson === true} onChange={(event) => onChange("pendingInPerson", event.target.checked)} />
          Pendiente presencial
        </label>
        <label>
          <input type="checkbox" checked={filters.pendingOnline === true} onChange={(event) => onChange("pendingOnline", event.target.checked)} />
          Pendiente en línea
        </label>
        <button type="button" className="secondary-button" onClick={onClear}>Limpiar filtros</button>
      </div>
    </section>
  );
}
