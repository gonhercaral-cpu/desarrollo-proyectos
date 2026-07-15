function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCertificatePersonText(value) {
  return cleanString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_/-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeCertificateSignerType(data) {
  const candidates = [
    data?.type,
    data?.signerType,
    data?.category,
    data?.categoria,
    data?.role,
    data?.rol,
    data?.cargo,
  ].map(normalizeCertificatePersonText).filter(Boolean);

  if (candidates.some((value) => /(^|\s)(principal|director|directora)(\s|$)/.test(value))) {
    return "Principal";
  }
  if (candidates.some((value) => /(^|\s)(teacher|maestr[oa]|docente|profesor[ae]?|instructor[ae]?)(\s|$)/.test(value))) {
    return "Teacher";
  }
  return "";
}

function isActiveCertificateSigner(data) {
  if (!data || data.deleted === true || data.isDeleted === true || data.archived === true) {
    return false;
  }

  const activeValues = [data.active, data.isActive, data.activo];
  const hasExplicitActiveValue = activeValues.some((value) => value !== undefined && value !== null);
  if (!hasExplicitActiveValue) return true;

  const activeValue = data.active ?? data.isActive ?? data.activo;
  return activeValue === true || normalizeCertificatePersonText(activeValue) === "activo";
}

function normalizePublicCertificatePerson(id, data) {
  return {
    id: cleanString(id),
    name: cleanString(data?.name || data?.displayName || data?.fullName || data?.nombre),
    type: normalizeCertificateSignerType(data),
    active: isActiveCertificateSigner(data),
  };
}

function buildPublicCertificatePeople(records) {
  const seenIds = new Set();
  const seenNames = new Set();

  return (Array.isArray(records) ? records : [])
    .map((record) => normalizePublicCertificatePerson(record?.id, record))
    .filter((person) => {
      if (!person.active || !person.id || !person.name || !person.type || seenIds.has(person.id)) {
        return false;
      }

      const nameKey = `${person.type}:${normalizeCertificatePersonText(person.name)}`;
      if (seenNames.has(nameKey)) return false;

      seenIds.add(person.id);
      seenNames.add(nameKey);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

module.exports = {
  buildPublicCertificatePeople,
  isActiveCertificateSigner,
  normalizeCertificateSignerType,
};
