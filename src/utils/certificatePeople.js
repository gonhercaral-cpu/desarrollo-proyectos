const PRINCIPAL_ALIASES = [
  "principal",
  "director",
  "directora",
  "director academico",
  "directora academica",
  "firmante principal",
  "primary signer",
  "academic director",
];

const TEACHER_ALIASES = [
  "teacher",
  "maestro",
  "maestra",
  "docente",
  "profesor",
  "profesora",
  "instructor",
  "instructora",
];

export function normalizeCertificatePersonText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es-MX")
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeCertificateSignerType(...values) {
  const candidates = values
    .flat()
    .map(normalizeCertificatePersonText)
    .filter(Boolean);

  if (candidates.some((value) => PRINCIPAL_ALIASES.includes(value))) return "Principal";
  if (candidates.some((value) => TEACHER_ALIASES.includes(value))) return "Teacher";

  if (candidates.some((value) => /(^|\s)(director|directora|principal)(\s|$)/.test(value))) {
    return "Principal";
  }
  if (candidates.some((value) => /(^|\s)(teacher|maestr[oa]|docente|profesor[ae]?|instructor[ae]?)(\s|$)/.test(value))) {
    return "Teacher";
  }

  return "";
}

export function isActiveCertificatePerson(person) {
  const activeValue = person?.active ?? person?.isActive ?? person?.activo;
  const active = activeValue === true || normalizeCertificatePersonText(activeValue) === "activo";
  return active && person?.deleted !== true && person?.isDeleted !== true && person?.archived !== true;
}

export function dedupeCertificatePeople(people) {
  const seenIds = new Set();
  const seenNames = new Set();

  return people.filter((person) => {
    const id = String(person?.id || person?.sourceId || "").trim();
    const type = normalizeCertificateSignerType(person?.type, person?.category, person?.role);
    const name = normalizeCertificatePersonText(person?.name);
    if (!id || !type || !name || seenIds.has(id)) return false;

    const nameKey = `${type}:${name}`;
    if (seenNames.has(nameKey)) return false;

    seenIds.add(id);
    seenNames.add(nameKey);
    return true;
  });
}

