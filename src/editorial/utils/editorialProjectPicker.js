// Estabilización — etiquetas y filtrado del selector de proyectos operativos.
// Evita mostrar IDs, [object Object] o texto ilegible. Pura y testeable.

// Nombre legible del proyecto (nunca el ID ni un objeto).
export function projectDisplayLabel(project) {
  if (!project || typeof project !== "object") return "Proyecto";
  const name = project.name || project.title || project.projectName || project.nombre;
  if (typeof name === "string" && name.trim()) return name.trim();
  return "Proyecto sin nombre";
}

// Subetiqueta: estado · responsable.
export function projectSubLabel(project) {
  const status = String(project?.status || "Sin estado").trim() || "Sin estado";
  const responsible = String(
    project?.assignedToName || project?.responsibleName || project?.createdByName || "Sin responsable"
  ).trim() || "Sin responsable";
  return `${status} · ${responsible}`;
}

// Filtra proyectos vinculables: excluye ya vinculados y aplica búsqueda por
// nombre (case/acentos-insensitive). Ordena alfabéticamente por nombre.
export function filterLinkableProjects(projects, linkedIds, search = "") {
  const excluded = linkedIds instanceof Set ? linkedIds : new Set(Array.isArray(linkedIds) ? linkedIds : []);
  const term = normalize(search);
  return (Array.isArray(projects) ? projects : [])
    .filter((project) => project && project.id && !excluded.has(project.id))
    .filter((project) => (term ? normalize(projectDisplayLabel(project)).includes(term) : true))
    .sort((a, b) => projectDisplayLabel(a).localeCompare(projectDisplayLabel(b), "es"));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}
