import {
  isActiveCertificatePerson,
  normalizeCertificatePersonText,
  normalizeCertificateSignerType,
} from "../certificatePeople.js";

// Mismas convenciones que Imprenta → Firmas. Solo devuelve datos de selección;
// imágenes de firma, notas y datos de auditoría nunca pasan al editor de Signage.
export function buildSignageTeachers(records = []) {
  const teachers = new Map();
  for (const person of Array.isArray(records) ? records : []) {
    const type = normalizeCertificateSignerType(person?.type, person?.signerType, person?.category, person?.categoria, person?.role, person?.rol, person?.cargo);
    const deleted = person?.deleted === true || person?.isDeleted === true || person?.archived === true;
    const hasActive = [person?.active, person?.isActive, person?.activo].some(value => value !== undefined && value !== null);
    if (type !== "Teacher" || deleted || (hasActive && !isActiveCertificatePerson(person))) continue;
    const name = String(person?.name || person?.displayName || person?.fullName || person?.nombre || "").trim();
    const id = String(person?.id || "").trim();
    if (!id || !name) continue;
    const key = normalizeCertificatePersonText(name);
    const campus = String(person?.campus || "").trim();
    const previous = teachers.get(key);
    if (previous) {
      previous.campuses = [...new Set([...previous.campuses, ...(campus ? [campus] : [])])].sort();
    } else {
      teachers.set(key, { id, name, campuses: campus ? [campus] : [] });
    }
  }
  return [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name, "es-MX", { sensitivity: "base" }));
}
