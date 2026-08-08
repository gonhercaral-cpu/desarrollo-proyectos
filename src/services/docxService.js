import JSZip from "jszip";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { createTextElement } from "../editorial/models/editorialElements";
import { createEditorialProject, EDITORIAL_COLLECTIONS } from "../editorial/services/editorialProjectsService";
import { createEditorialPage } from "../editorial/services/editorialPagesService";
import { saveEditorialPageElements } from "../editorial/services/editorialElementsService";

function getWordText(node) {
  return Array.from(node.getElementsByTagNameNS("*", "t"))
    .map((textNode) => textNode.textContent || "")
    .join("")
    .trim();
}

function getParagraphKind(paragraph) {
  const styleNode = paragraph.getElementsByTagNameNS("*", "pStyle")[0];
  const style = styleNode?.getAttribute("w:val") || styleNode?.getAttribute("val") || "";
  const match = String(style).match(/heading\s*([1-6])|t[ií]tulo\s*([1-6])/i);
  return match ? `heading${match[1] || match[2] || "1"}` : "paragraph";
}

export async function parseDocxBlob(blob) {
  const zip = await JSZip.loadAsync(blob);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) throw new Error("El DOCX no contiene un documento válido.");

  const xml = await documentFile.async("string");
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (parsed.getElementsByTagName("parsererror").length) {
    throw new Error("No se pudo interpretar el contenido del DOCX.");
  }

  const body = parsed.getElementsByTagNameNS("*", "body")[0];
  const blocks = [];
  Array.from(body?.children || []).forEach((node) => {
    if (node.localName === "p") {
      const text = getWordText(node);
      if (text) blocks.push({ type: getParagraphKind(node), text });
      return;
    }
    if (node.localName === "tbl") {
      Array.from(node.getElementsByTagNameNS("*", "tr")).forEach((row) => {
        const cells = Array.from(row.getElementsByTagNameNS("*", "tc"))
          .map(getWordText)
          .filter(Boolean);
        if (cells.length) blocks.push({ type: "tableRow", text: cells.join("  |  ") });
      });
    }
  });

  return {
    blocks,
    text: blocks.map((block) => block.text).join("\n\n"),
    warnings: ["Vista basada en texto. Diseño avanzado, fuentes, encabezados, imágenes y saltos complejos pueden variar."],
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
    const lineCount = Math.max(1, Math.ceil(block.text.length / (headingLevel ? 42 : 72)));
    const height = Math.max(36, lineCount * fontSize * 1.35);
    const next = {
      ...element,
      name: headingLevel ? `Título ${headingLevel}` : block.type === "tableRow" ? "Fila de tabla" : "Párrafo",
      content: block.text,
      x: 48,
      y,
      width: 720,
      height,
      style: {
        ...element.style,
        fontSize,
        fontWeight: headingLevel ? "bold" : "normal",
        boxMode: "fixed_box",
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
  const parsed = await parseDocxBlob(blob);
  const sourceFileId = String(sourceFile?.id || "").trim();
  const existingProjectId = await findEditorialProjectBySourceFile(sourceFileId, user);
  if (existingProjectId) return { projectId: existingProjectId, existing: true, parsed };

  const projectId = await createEditorialProject({
    name: String(sourceFile?.name || "Documento DOCX").replace(/\.docx$/i, ""),
    type: "custom",
    size: "letter",
    orientation: "portrait",
    sourceFileId,
    sourceFileName: sourceFile?.name || "",
    sourceMimeType: sourceFile?.mimeType || "",
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
