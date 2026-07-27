const PREDEFINED_CERTIFICATE_SIGNER_CAMPUSES = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Online",
];

const CERTIFICATE_SIGNER_CAMPUS_OPTIONS = [
  ...PREDEFINED_CERTIFICATE_SIGNER_CAMPUSES,
  "Otro",
];

function getCertificateSignerCampusFormState(value = "") {
  const campus = String(value || "").trim();

  if (PREDEFINED_CERTIFICATE_SIGNER_CAMPUSES.includes(campus)) {
    return { campus, customCampus: "" };
  }

  return {
    campus: "Otro",
    customCampus: campus === "Otro" ? "" : campus,
  };
}

function resolveCertificateSignerCampus(campus, customCampus = "") {
  const selection = String(campus || "").trim();
  if (PREDEFINED_CERTIFICATE_SIGNER_CAMPUSES.includes(selection)) return selection;
  if (selection !== "Otro") return "";
  return String(customCampus || "").trim();
}

export {
  PREDEFINED_CERTIFICATE_SIGNER_CAMPUSES,
  CERTIFICATE_SIGNER_CAMPUS_OPTIONS,
  getCertificateSignerCampusFormState,
  resolveCertificateSignerCampus,
};
