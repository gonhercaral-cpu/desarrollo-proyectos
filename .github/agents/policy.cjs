const path = require("node:path");
const policy = require("./policy.json");

function assertAllowedPath(file) {
  if (typeof file !== "string" || !/^[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_-]+)*$/.test(file)) {
    throw new Error("Ruta no válida: se requieren rutas relativas simples.");
  }
  const lower = file.toLowerCase();
  const segments = lower.split("/");
  if (segments.some((part) => !part || part.startsWith(".") || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/.test(part))) {
    throw new Error("Ruta ambigua o reservada.");
  }
  if (!policy.allowedPrefixes.some((prefix) => lower.startsWith(prefix)) ||
      policy.protectedPrefixes.some((prefix) => lower.startsWith(prefix)) ||
      policy.protectedFiles.some((protectedFile) => protectedFile.toLowerCase() === lower) ||
      /(^|\/)(agents|claude|gemini)\.md$/.test(lower) ||
      /(^|\/)(package(?:-lock)?\.json|.*lock.*|.*\.config\.[^/]+)$/.test(lower) ||
      /(secret|credential|serviceaccount|service-account|\.rules$|\.pem$|\.key$)/.test(lower) ||
      !policy.allowedExtensions.includes(path.posix.extname(lower))) {
    throw new Error(`Archivo fuera de la política auxiliar: ${file}`);
  }
  return file;
}

function parseAssignment(body) {
  if (typeof body !== "string" || Buffer.byteLength(body) > 16000) throw new Error("Contrato demasiado grande.");
  const match = body.match(/^\/codex-delegate (claude|gemini)\r?\n([\s\S]+)$/);
  if (!match) throw new Error("Usa /codex-delegate claude|gemini seguido de JSON sin cercas Markdown.");
  const data = JSON.parse(match[2]);
  const keys = ["version", "kind", "objective", "paths", "acceptance", "tests"];
  if (Object.keys(data).some((key) => !keys.includes(key)) || data.version !== 1 ||
      !["implement", "review"].includes(data.kind)) throw new Error("Contrato desconocido.");
  for (const key of ["objective", "acceptance", "tests"]) {
    if (typeof data[key] !== "string" || !data[key].trim() || data[key].length > 4000) {
      throw new Error(`Campo obligatorio o excesivo: ${key}`);
    }
  }
  if (!Array.isArray(data.paths) || !data.paths.length || data.paths.length > policy.maxFiles ||
      new Set(data.paths.map((file) => String(file).toLowerCase())).size !== data.paths.length) {
    throw new Error("paths debe contener entre 1 y 12 archivos únicos, sin comodines.");
  }
  data.paths.forEach(assertAllowedPath);
  return { ...data, agent: match[1] };
}

function validateChanges(assignment, changes, patchBytes) {
  if (patchBytes > policy.maxPatchBytes) throw new Error("Parche demasiado grande.");
  if (changes.length > policy.maxFiles) throw new Error("Demasiados archivos.");
  if (assignment.kind === "review" && changes.length) throw new Error("Una revisión no puede modificar archivos.");
  for (const change of changes) {
    assertAllowedPath(change.path);
    if (!assignment.paths.includes(change.path)) throw new Error(`Cambio fuera del contrato: ${change.path}`);
    if (change.binary || !["100644", "000000"].includes(change.mode)) {
      throw new Error("No se permiten binarios, symlinks, submódulos ni ejecutables.");
    }
  }
}

module.exports = { policy, assertAllowedPath, parseAssignment, validateChanges };
