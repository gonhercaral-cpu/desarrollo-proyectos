import { sanitizeRichText } from "../utils/richText";

export default function RichTextContent({ value, className = "" }) {
  const safeHtml = sanitizeRichText(value);
  if (!safeHtml) return null;
  return <div className={`rich-text-content ${className}`.trim()} dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
