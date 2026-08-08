import JSZip from "jszip";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { createTextElement } from "../editorial/models/editorialElements";
import { createEditorialProject, EDITORIAL_COLLECTIONS } from "../editorial/services/editorialProjectsService";
import { createEditorialPage } from "../editorial/services/editorialPagesService";
import { saveEditorialPageElements } from "../editorial/services/editorialElementsService";

function getAttributeValue(node) {
  return node?.getAttribute("w:val") ?? node?.getAttribute("val") ?? "";
}

function firstDescendant(node, name) {
  return node?.getElementsByTagNameNS("*", name)?.[0] || null;
}

function readToggle(node, name) {
  const toggle = firstDescendant(node, name);
  if (!toggle) return false;
  return !["0", "false", "off"].includes(String(getAttributeValue(toggle)).toLowerCase());
}

function parseRun(run) {
  const properties = firstDescendant(run, "rPr");
  const text = Array.from(run.children || []).map((child) => {
    if (["t", "instrText"].includes(child.localName)) return child.textContent || "";
    if (child.localName === "tab") return "\t";
    if (["br", "cr"].includes(child.localName)) return "\n";
    return "";
  }).join("");
  return {
    text,
    bold: readToggle(properties, "b"),
    italic: readToggle(properties, "i"),
    underline: Boolean(firstDescendant(properties, "u")),
  };
}

function getWordText(node) {
  return Array.from(node.getElementsByTagNameNS("*", "r"))
    .map((run) => parseRun(run).text)
    .join("")
    .trim();
}

function parseStyles(parsed) {
  const styles = new Map();
  Array.from(parsed?.getElementsByTagNameNS("*", "style") || []).forEach((style) => {
    const id = style.getAttribute("w:styleId") || style.getAttribute("styleId") || "";
    const name = getAttributeValue(firstDescendant(style, "name"));
    const outlineLevel = Number(getAttributeValue(firstDescendant(style, "outlineLvl")));
    if (id) styles.set(id, { name, outlineLevel: Number.isFinite(outlineLevel) ? outlineLevel : null });
  });
  return styles;
}

function parseNumbering(parsed) {
  const abstractFormats = new Map();
  Array.from(parsed?.getElementsByTagNameNS("*", "abstractNum") || []).forEach((abstractNumber) => {
    const abstractId = abstractNumber.getAttribute("w:abstractNumId") || abstractNumber.getAttribute("abstractNumId") || "";
    const levels = new Map();
    Array.from(abstractNumber.getElementsByTagNameNS("*", "lvl")).forEach((level) => {
      const levelId = level.getAttribute("w:ilvl") || level.getAttribute("ilvl") || "0";
      levels.set(levelId, getAttributeValue(firstDescendant(level, "numFmt")) || "bullet");
    });
    abstractFormats.set(abstractId, levels);
  });

  const numbering = new Map();
  Array.from(parsed?.getElementsByTagNameNS("*", "num") || []).forEach((number) => {
    const numberId = number.getAttribute("w:numId") || number.getAttribute("numId") || "";
    const abstractId = getAttributeValue(firstDescendant(number, "abstractNumId"));
    if (numberId) numbering.set(numberId, abstractFormats.get(abstractId) || new Map());
  });
  return numbering;
}

function getParagraphKind(paragraph, styles) {
  const styleId = getAttributeValue(firstDescendant(paragraph, "pStyle"));
  const style = styles.get(styleId) || {};
  const match = `${styleId} ${style.name || ""}`.match(/heading\s*([1-6])|t[ií]tulo\s*([1-6])/i);
  if (!match && Number.isInteger(style.outlineLevel) && style.outlineLevel >= 0 && style.outlineLevel <= 5) {
    return `heading${style.outlineLevel + 1}`;
  }
  return match ? `heading${match[1] || match[2] || "1"}` : "paragraph";
}

function getParagraphAlignment(paragraph) {
  const value = getAttributeValue(firstDescendant(firstDescendant(paragraph, "pPr"), "jc"));
  if (["center", "right", "both", "justify"].includes(value)) return value === "both" ? "justify" : value;
  return "left";
}

function getParagraphList(paragraph, numbering) {
  const numberProperties = firstDescendant(firstDescendant(paragraph, "pPr"), "numPr");
  if (!numberProperties) return null;
  const id = getAttributeValue(firstDescendant(numberProperties, "numId"));
  const level = getAttributeValue(firstDescendant(numberProperties, "ilvl")) || "0";
  const format = numbering.get(id)?.get(level) || "bullet";
  return { id, level: Number(level) || 0, ordered: format !== "bullet", format };
}

async function readOptionalXml(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  const xml = await file.async("string");
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  return parsed.getElementsByTagName("parsererror").length ? null : parsed;
}

export async function parseDocxBlob(blob) {
  let zip;
  try {
    zip = await JSZip.loadAsync(blob);
  } catch (error) {
    const invalidError = new Error("El archivo no contiene un DOCX válido.", { cause: error });
    invalidError.code = "invalid-docx";
    throw invalidError;
  }
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("El DOCX no contiene un documento válido.");

  const [xml, stylesXml, numberingXml] = await Promise.all([
    documentFile.async("string"),
    readOptionalXml(zip, "word/styles.xml"),
    readOptionalXml(zip, "word/numbering.xml"),
  ]);
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length) {
    throw new Error("No se pudo interpretar el contenido del DOCX.");
  }

  const styles = parseStyles(stylesXml);
  const numbering = parseNumbering(numberingXml);
  const listCounters = new Map();
  const body = parsed.getElementsByTagNameNS("*", "body")[0];
  const blocks = [];
  Array.from(body?.children || []).forEach((node) => {
    if (node.localName === "p") {
      const runs = Array.from(node.getElementsByTagNameNS("*", "r"))
        .map(parseRun)
        .filter((run) => run.text.length > 0);
      const text = runs.map((run) => run.text).join("").trimEnd();
      if (!text.trim()) return;
      const list = getParagraphList(node, numbering);
      let marker = "";
      if (list) {
        const counterKey = `${list.id}:${list.level}`;
        const counter = (listCounters.get(counterKey) || 0) + 1;
        listCounters.set(counterKey, counter);
        marker = list.ordered ? `${counter}.` : "•";
      }
      blocks.push({
        type: getParagraphKind(node, styles),
        text,
        runs,
        alignment: getParagraphAlignment(node),
        list,
        marker,
      });
      return;
    }
    if (node.localName === "tbl") {
      Array.from(node.getElementsByTagNameNS("*", "tr")).forEach((row) => {
        const cells = Array.from(row.getElementsByTagNameNS("*", "tc")).map(getWordText);
        if (cells.some(Boolean)) blocks.push({
          type: "tableRow",
          text: cells.join("  |  "),
          cells,
          runs: [],
          alignment: "left",
          list: null,
          marker: "",
        });
      });
    }
  });

  return {
    blocks,
    text: blocks.map((block) => block.text).join("\n\n"),
    warnings: ["Vista estructurada. Tipografía exacta, imágenes, encabezados de página y diseño flotante pueden variar."],
  };
}

export async function findEditorialProjectBySourceFile(sourceFileId, user) {
  const uid = user?.uid || user?.id;
  if (!sourceFileId || !uid) return null;
  const snapshot = await getDocs(query(
    collection(db, EDITORIAL_COLLECTIONS.projects),
    where("ownerUid", "==", uid),
    where("sourceFileId", "==", sourceFileId)
  ));
  return snapshot.docs[0]?.id || null;
}

function blocksToElements(blocks) {
  let y = 48;
  return blocks.map((block, index) => {
    const headingLevel = Number(block.type.replace("heading", "")) || 0;
    const element = createTextElement(index);
    const fontSize = headingLevel ? Math.max(22, 34 - headingLevel * 2) : 17;
    const content = block.marker ? `${"  ".repeat(block.list?.level || 0)}${block.marker} ${block.text}` : block.text;
    const lineCount = Math.max(1, Math.ceil(content.length / (headingLevel ? 42 : 72)));
    const height = Math.max(36, lineCount * fontSize * 1.35);
    const meaningfulRuns = (block.runs || []).filter((run) => run.text.trim());
    const allBold = meaningfulRuns.length > 0 && meaningfulRuns.every((run) => run.bold);
    const allItalic = meaningfulRuns.length > 0 && meaningfulRuns.every((run) => run.italic);
    const next = {
      ...element,
      name: headingLevel ? `Título ${headingLevel}` : block.type === "tableRow" ? "Fila de tabla" : block.list ? "Elemento de lista" : "Párrafo",
      content,
      x: 48,
      y,
      width: 720,
      height,
      style: {
        ...element.style,
        fontSize,
        fontWeight: headingLevel || allBold ? "bold" : "normal",
        fontStyle: allItalic ? "italic" : "normal",
        align: block.alignment || "left",
        boxMode: "fixed_box",
      },
      metadata: {
        importedFrom: "docx",
        sourceRuns: block.runs || [],
        sourceList: block.list || null,
        sourceTableCells: block.cells || [],
      },
    };
    y += height + (headingLevel ? 20 : 12);
    return next;
  });
}

function paginateBlocks(blocks) {
  const pages = [];
  let current = [];
  let estimatedHeight = 0;
  blocks.forEach((block) => {
    const heading = block.type.startsWith("heading");
    const height = Math.max(46, Math.ceil(block.text.length / (heading ? 42 : 72)) * (heading ? 40 : 26));
    if (current.length && estimatedHeight + height > 880) {
      pages.push(current);
      current = [];
      estimatedHeight = 0;
    }
    current.push(block);
    estimatedHeight += height;
  });
  if (current.length || pages.length === 0) pages.push(current);
  return pages;
}

export async function importDocxToEditorial({ blob, sourceFile, user }) {
  const sourceFileId = String(sourceFile?.id || "").trim();
  const existingProjectId = await findEditorialProjectBySourceFile(sourceFileId, user);
  if (existingProjectId) return { projectId: existingProjectId, existing: true, parsed: null };

  const parsed = await parseDocxBlob(blob);
  if (!parsed.blocks.length) {
    const emptyError = new Error("El DOCX no contiene párrafos, listas ni tablas importables.");
    emptyError.code = "empty-docx";
    throw emptyError;
  }

  const projectId = await createEditorialProject({
    name: String(sourceFile?.name || "Documento DOCX").replace(/\.docx$/i, ""),
    type: "custom",
    size: "letter",
    orientation: "portrait",
    sourceFileId,
    sourceFileName: sourceFile?.name || "",
    sourceMimeType: sourceFile?.mimeType || "",
    sourceDeliveredName: sourceFile?.deliveredName || sourceFile?.name || "",
    sourceDeliveredMimeType: sourceFile?.deliveredMimeType || sourceFile?.mimeType || "",
    sourceExported: sourceFile?.exported === true,
    sourceProvider: "nube_aes",
  }, user);

  const documentsSnapshot = await getDocs(collection(db, EDITORIAL_COLLECTIONS.projects, projectId, EDITORIAL_COLLECTIONS.documents));
  const documentId = documentsSnapshot.docs[0]?.id;
  if (!documentId) throw new Error("No se creó el documento editorial principal.");
  const initialPagesSnapshot = await getDocs(collection(
    db,
    EDITORIAL_COLLECTIONS.projects,
    projectId,
    EDITORIAL_COLLECTIONS.documents,
    documentId,
    EDITORIAL_COLLECTIONS.pages
  ));
  const initialPageId = initialPagesSnapshot.docs[0]?.id;
  if (!initialPageId) throw new Error("No se creó la página editorial inicial.");

  const project = { widthIn: 8.5, heightIn: 11, orientation: "portrait" };
  const pages = paginateBlocks(parsed.blocks);
  const pageIds = [initialPageId];
  for (let index = 1; index < pages.length; index += 1) {
    pageIds.push(await createEditorialPage({
      projectId,
      documentId,
      project,
      user,
      name: `Página ${index + 1}`,
      referencePageId: pageIds[index - 1],
    }));
  }

  for (let index = 0; index < pages.length; index += 1) {
    await saveEditorialPageElements({
      context: { projectId, documentId, pageId: pageIds[index], kind: "page" },
      elements: blocksToElements(pages[index]),
      persistedIds: new Set(),
      user,
    });
  }

  return { projectId, existing: false, parsed };
}
