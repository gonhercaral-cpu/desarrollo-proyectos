import { createEditorialElementId } from "../models/editorialElements.js";

const DEFAULT_TYPES = ["unit", "chapter", "resources", "custom"];

function metadataOf(value = {}) {
  return { ...(value.academicMetadata || {}), ...value };
}

function numberOf(numbering, pageId) {
  return numbering?.get?.(pageId) || numbering?.[pageId] || {};
}

export function buildAutomaticIndexEntries({ pages = [], sections = [], numbering = {}, config = {} }) {
  const includedTypes = new Set(config.sectionTypes?.length ? config.sectionTypes : DEFAULT_TYPES);
  const includeLessons = config.includeLessons !== false;
  const entries = [];

  sections
    .filter((section) => includedTypes.has(section.type) && config.excludedSectionIds?.includes(section.id) !== true)
    .sort((left, right) => left.order - right.order)
    .forEach((section) => {
      const firstPage = pages.find((page) => page.sectionId === section.id);
      if (!firstPage) return;
      entries.push({
        id: `section:${section.id}`,
        sourceId: section.id,
        kind: "section",
        level: section.type === "unit" || section.type === "chapter" ? 0 : 1,
        label: section.name,
        pageId: firstPage.id,
        pageLabel: numberOf(numbering, firstPage.id).label || "—",
      });
      if (!includeLessons) return;
      pages.filter((page) => page.sectionId === section.id).forEach((page) => {
        const metadata = metadataOf(page);
        if (metadata.academicType !== "lesson" && !metadata.lessonTitle) return;
        entries.push({
          id: `page:${page.id}`,
          sourceId: page.id,
          kind: "lesson",
          level: 1,
          label: metadata.lessonTitle || page.name,
          pageId: page.id,
          pageLabel: numberOf(numbering, page.id).label || "—",
        });
      });
    });
  return entries;
}

export function automaticIndexSignature(input) {
  return JSON.stringify(buildAutomaticIndexEntries(input).map(({ id, label, pageLabel, level }) => [id, label, pageLabel, level]));
}

export function formatAutomaticIndex(entries, config = {}) {
  const indent = String(config.indent || "    ");
  const leader = config.leader === "none" ? " " : String(config.leader || ".");
  const width = Math.max(20, Number(config.lineWidth || 58));
  return entries.map((entry) => {
    const prefix = indent.repeat(Math.max(0, Number(entry.level || 0)));
    const label = `${prefix}${entry.label}`;
    const count = Math.max(2, width - label.length - String(entry.pageLabel).length);
    return `${label} ${leader.repeat(count)} ${entry.pageLabel}`;
  }).join("\n");
}

export function createAutomaticIndexElement(input, zIndex = 0, config = {}) {
  return {
    id: createEditorialElementId(), name: "Índice automático", type: "text",
    x: 56, y: 80, width: 660, height: 700, rotation: 0, opacity: 1, zIndex,
    locked: false, visible: true, content: "{{automatic.index}}",
    style: { fontFamily: "Arial", fontSize: 18, fontWeight: "normal", fill: "#142033", lineHeight: 1.45 },
    automaticIndex: { ...config, sectionTypes: config.sectionTypes?.length ? config.sectionTypes : DEFAULT_TYPES, signature: automaticIndexSignature({ ...input, config }) },
    generatedKind: "automatic_index",
  };
}

export function resolveAutomaticIndexElement(element, input) {
  if (!element?.automaticIndex) return element;
  const entries = buildAutomaticIndexEntries({ ...input, config: element.automaticIndex });
  return { ...element, content: formatAutomaticIndex(entries, element.automaticIndex) };
}

export function isAutomaticIndexStale(element, input) {
  return Boolean(element?.automaticIndex) && element.automaticIndex.signature !== automaticIndexSignature({ ...input, config: element.automaticIndex });
}

export function refreshAutomaticIndexElement(element, input) {
  if (!element?.automaticIndex) return element;
  return { ...element, automaticIndex: { ...element.automaticIndex, signature: automaticIndexSignature({ ...input, config: element.automaticIndex }) } };
}
