const ALLOWED_TAGS = new Set([
  "A",
  "B",
  "BR",
  "DIV",
  "EM",
  "FONT",
  "H1",
  "H2",
  "H3",
  "I",
  "LI",
  "OL",
  "P",
  "SPAN",
  "STRONG",
  "U",
  "UL",
]);

const ALLOWED_STYLES = new Set(["font-family", "font-size", "text-align"]);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isSafeHref(value = "") {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function cleanNode(source, targetDocument) {
  if (source.nodeType === Node.TEXT_NODE) {
    return targetDocument.createTextNode(source.textContent || "");
  }

  if (source.nodeType !== Node.ELEMENT_NODE) return null;

  if (!ALLOWED_TAGS.has(source.tagName)) {
    const fragment = targetDocument.createDocumentFragment();
    Array.from(source.childNodes).forEach((child) => {
      const cleanChild = cleanNode(child, targetDocument);
      if (cleanChild) fragment.appendChild(cleanChild);
    });
    return fragment;
  }

  const element = targetDocument.createElement(source.tagName.toLowerCase());

  if (source.tagName === "A") {
    const href = source.getAttribute("href") || "";
    if (isSafeHref(href)) {
      element.setAttribute("href", href);
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  }

  if (source.tagName === "FONT") {
    const face = source.getAttribute("face");
    const size = source.getAttribute("size");
    if (face) element.setAttribute("face", face.slice(0, 80));
    if (size && /^[1-7]$/.test(size)) element.setAttribute("size", size);
  }

  const cleanStyles = [];
  Array.from(source.style || []).forEach((property) => {
    if (!ALLOWED_STYLES.has(property)) return;
    const value = source.style.getPropertyValue(property).replace(/[<>"']/g, "").slice(0, 100);
    if (value) cleanStyles.push(`${property}: ${value}`);
  });
  if (cleanStyles.length) element.setAttribute("style", cleanStyles.join("; "));

  Array.from(source.childNodes).forEach((child) => {
    const cleanChild = cleanNode(child, targetDocument);
    if (cleanChild) element.appendChild(cleanChild);
  });

  return element;
}

export function sanitizeRichText(value = "") {
  const source = String(value || "");
  if (!source) return "";
  if (typeof DOMParser === "undefined" || typeof Node === "undefined") {
    return escapeHtml(source);
  }

  const normalizedSource = /<\/?[a-z][\s\S]*>/i.test(source)
    ? source
    : escapeHtml(source).replace(/\r?\n/g, "<br>");
  const parsed = new DOMParser().parseFromString(`<div>${normalizedSource}</div>`, "text/html");
  const output = document.createElement("div");
  Array.from(parsed.body.firstElementChild?.childNodes || []).forEach((child) => {
    const cleanChild = cleanNode(child, document);
    if (cleanChild) output.appendChild(cleanChild);
  });
  return output.innerHTML;
}

export function richTextToPlainText(value = "") {
  const source = String(value || "");
  if (!source) return "";
  if (typeof DOMParser === "undefined") return source.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const parsed = new DOMParser().parseFromString(source, "text/html");
  return (parsed.body.textContent || "").replace(/\s+/g, " ").trim();
}

export function isRichTextEmpty(value = "") {
  return !richTextToPlainText(value);
}
