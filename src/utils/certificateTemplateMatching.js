export function normalizeCertificateMatchText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/discovery/g, "discover")
    .replace(/new horizons/g, "newhorizons")
    .replace(/mega flash/g, "megaflash")
    .replace(/smile\s+/g, "smile")
    .replace(/[^a-z0-9]+/g, "");
}

export function certificateTextMatches(source = "", target = "") {
  const sourceText = normalizeCertificateMatchText(source);
  const targetText = normalizeCertificateMatchText(target);

  if (!sourceText || !targetText) return false;

  return sourceText === targetText || sourceText.includes(targetText) || targetText.includes(sourceText);
}

function isRequestCertificateLikeType(requestType) {
  return requestType === "Certificado" || requestType === "Diploma";
}

export function getCertificateRequestTemplateTargets(form = {}, selectedProduct = null) {
  const rawLevel = form.level && form.level !== "No aplica"
    ? form.level
    : form.certificateTemplateLevel || selectedProduct?.level || "";
  const rawProgram =
    form.certificateTemplateProgramName ||
    form.courseProgramName ||
    form.courseLevel ||
    form.group ||
    selectedProduct?.name ||
    form.productName ||
    "";
  const rawAudience = form.certificateTemplateAudience || form.courseAudience || "";
  const rawType = isRequestCertificateLikeType(form.requestType)
    ? form.requestType
    : selectedProduct?.category || form.requestType || "";

  return {
    targetLevel: String(rawLevel || "").trim(),
    targetProgram: String(rawProgram || "").trim(),
    targetAudience: String(rawAudience || "").trim(),
    targetType: String(rawType || "").trim(),
  };
}

function matchesStrictTemplate(template, targets) {
  const { targetLevel, targetProgram, targetAudience, targetType } = targets;
  const matchesLevel = targetLevel ? certificateTextMatches(template.level, targetLevel) : false;
  const matchesProgram = targetProgram
    ? certificateTextMatches(template.programName, targetProgram) ||
      certificateTextMatches(template.name, targetProgram) ||
      certificateTextMatches(`${template.level || ""} ${template.programName || ""}`, targetProgram)
    : false;
  const matchesAudience = targetAudience ? certificateTextMatches(template.audience, targetAudience) : true;
  const matchesType = targetType
    ? certificateTextMatches(template.certificateType, targetType) || certificateTextMatches(template.audience, targetType)
    : true;

  return (matchesLevel || matchesProgram) && matchesAudience && matchesType;
}

function matchesLooseTemplate(template, targets) {
  const { targetLevel, targetProgram } = targets;

  if (targetLevel && certificateTextMatches(template.level, targetLevel)) return true;
  if (!targetProgram) return false;

  return (
    certificateTextMatches(template.programName, targetProgram) ||
    certificateTextMatches(template.name, targetProgram) ||
    certificateTextMatches(`${template.level || ""} ${template.programName || ""}`, targetProgram)
  );
}

/**
 * Returns every active template that matches the strict criteria (level/program + audience + type).
 * Used when a caller needs to know if the match is unambiguous (exactly one result) before
 * persisting a permanent decision, instead of silently picking the first array position.
 */
export function findStrictMatchingCertificateTemplates(templates = [], form = {}, selectedProduct = null) {
  const activeTemplates = (templates || []).filter((template) => template?.active !== false);
  const targets = getCertificateRequestTemplateTargets(form, selectedProduct);

  const hasTarget = Boolean(targets.targetLevel || targets.targetProgram || targets.targetAudience || targets.targetType);
  if (!hasTarget) return [];

  return activeTemplates.filter((template) => matchesStrictTemplate(template, targets));
}

/**
 * Best-effort single template resolution: strict match first, falls back to a looser
 * substring match (ignoring audience/type) if nothing strict is found. This is the same
 * fuzzy fallback behavior used historically for live rendering of legacy requests that
 * never got a certificateTemplateId persisted. New callers that need to persist a permanent
 * decision should prefer findStrictMatchingCertificateTemplates and require an unambiguous result.
 */
export function findMatchingCertificateTemplateInList(templates = [], form = {}, selectedProduct = null) {
  const strictMatches = findStrictMatchingCertificateTemplates(templates, form, selectedProduct);
  if (strictMatches.length > 0) return strictMatches[0];

  const activeTemplates = (templates || []).filter((template) => template?.active !== false);
  const targets = getCertificateRequestTemplateTargets(form, selectedProduct);

  const hasTarget = Boolean(targets.targetLevel || targets.targetProgram || targets.targetAudience || targets.targetType);
  if (!hasTarget) return null;

  return activeTemplates.find((template) => matchesLooseTemplate(template, targets)) || null;
}
