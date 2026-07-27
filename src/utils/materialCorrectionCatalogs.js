function cleanCatalogText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeCatalogText(value) {
  return cleanCatalogText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX");
}

export function getMaterialCorrectionLevelName(template = {}) {
  const level = cleanCatalogText(template.level);
  const program = cleanCatalogText(template.programName);
  const compactLevel = normalizeCatalogText(level).replace(/\s+/g, "");
  const compactProgram = normalizeCatalogText(program).replace(/\s+/g, "");
  if (!program || compactLevel.includes(compactProgram)) {
    return level;
  }
  return `${level} ${program}`.trim();
}

export function buildActiveMaterialCorrectionLevels(templates = []) {
  const seen = new Set();
  return (Array.isArray(templates) ? templates : [])
    .filter((template) => template?.active === true && template?.id)
    .map((template) => ({
      id: cleanCatalogText(template.id),
      name: getMaterialCorrectionLevelName(template),
    }))
    .sort((first, second) => (
      first.name.localeCompare(second.name, "es-MX", {
        numeric: true,
        sensitivity: "base",
      })
      || first.id.localeCompare(second.id, "es-MX", { sensitivity: "base" })
    ))
    .filter((level) => {
      const key = normalizeCatalogText(level.name);
      if (!level.id || !key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
