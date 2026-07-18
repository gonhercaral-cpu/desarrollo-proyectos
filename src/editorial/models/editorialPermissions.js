// Fase 7 — Permisos editoriales por usuario y departamento.
// IMPORTANTE: estos permisos son SÓLO del documento editorial. No modifican los
// roles globales (admin/collaborator) ni la pertenencia a departamentos.

// Niveles ordenados de menor a mayor alcance.
export const EDITORIAL_LEVELS = [
  ["viewer", "Lector"],
  ["commenter", "Comentarista"],
  ["content_editor", "Editor de contenido"],
  ["designer", "Diseñador"],
  ["reviewer", "Revisor"],
  ["publisher", "Publicador"],
  ["manager", "Administrador del documento"],
];

const LEVEL_RANK = new Map(EDITORIAL_LEVELS.map(([value], index) => [value, index]));

// Capacidades atómicas.
export const EDITORIAL_CAPABILITIES = [
  "view", // ver documento (modo lectura)
  "download", // descargar archivos autorizados
  "comment", // comentar
  "edit_content", // editar contenido permitido
  "edit_design", // edición visual
  "review", // revisión y checklist
  "publish", // publicar / despublicar
  "manage", // administración del documento y permisos
];

// Mapa nivel → capacidades. Cada nivel superior hereda las de los inferiores
// que apliquen (viewer siempre puede ver/descargar).
const LEVEL_CAPABILITIES = {
  viewer: ["view", "download"],
  commenter: ["view", "download", "comment"],
  content_editor: ["view", "download", "comment", "edit_content"],
  designer: ["view", "download", "comment", "edit_content", "edit_design"],
  reviewer: ["view", "download", "comment", "edit_content", "edit_design", "review"],
  publisher: ["view", "download", "comment", "edit_content", "edit_design", "review", "publish"],
  manager: EDITORIAL_CAPABILITIES.slice(),
};

export function getLevelLabel(level) {
  return EDITORIAL_LEVELS.find(([value]) => value === level)?.[1] || "Lector";
}

export function isEditorialLevel(level) {
  return LEVEL_RANK.has(String(level || ""));
}

function rankOf(level) {
  return LEVEL_RANK.has(level) ? LEVEL_RANK.get(level) : -1;
}

// Nivel más alto entre varios (para combinar usuario + departamentos).
export function highestLevel(levels = []) {
  let best = null;
  let bestRank = -1;
  for (const level of levels) {
    const rank = rankOf(level);
    if (rank > bestRank) {
      bestRank = rank;
      best = level;
    }
  }
  return best;
}

// Resuelve el nivel efectivo de un usuario sobre un proyecto editorial.
// - Admin global: manager (acceso completo).
// - Propietario del proyecto: manager (control).
// - Colaborador: máximo entre su permiso explícito, permisos de sus
//   departamentos y el nivel base por compatibilidad (Fases 1–6: los
//   colaboradores editaban contenido). Un permiso explícito puede bajar o subir.
// `permissions.users[uid]` y `permissions.departments[departmentId]` guardan
// niveles. `userDepartmentIds` son los departamentos del usuario.
export function resolveEditorialLevel({
  project = {},
  user = {},
  isAdmin = false,
  userDepartmentIds = [],
  defaultLevel = "content_editor",
} = {}) {
  const uid = String(user.uid || user.id || "");
  if (isAdmin || String(user.role || "").toLowerCase() === "admin") return "manager";
  if (uid && project.ownerUid === uid) return "manager";

  const permissions = project.editorialPermissions || {};
  const users = permissions.users || {};
  const departments = permissions.departments || {};

  const explicit = uid && isEditorialLevel(users[uid]) ? users[uid] : null;
  const deptLevels = (Array.isArray(userDepartmentIds) ? userDepartmentIds : [])
    .map((id) => departments[id])
    .filter(isEditorialLevel);

  // ¿Es colaborador del proyecto? Sólo entonces aplica el nivel base.
  const collaboratorUids = Array.isArray(project.collaboratorUids) ? project.collaboratorUids : [];
  const isCollaborator = uid && collaboratorUids.includes(uid);

  // Un permiso explícito manda sobre el default (permite bajar a viewer).
  if (explicit) return highestLevel([explicit, ...deptLevels]);
  if (deptLevels.length) return highestLevel([...deptLevels, isCollaborator ? defaultLevel : "viewer"]);
  if (isCollaborator) return defaultLevel;
  return null; // sin acceso editorial
}

export function levelCapabilities(level) {
  return LEVEL_CAPABILITIES[level] || [];
}

// ¿El nivel tiene la capacidad?
export function levelCan(level, capability) {
  return levelCapabilities(level).includes(capability);
}

// Azúcar: resuelve nivel efectivo y evalúa capacidad en un paso.
export function canEditorial(context, capability) {
  const level = resolveEditorialLevel(context);
  if (!level) return false;
  return levelCan(level, capability);
}
