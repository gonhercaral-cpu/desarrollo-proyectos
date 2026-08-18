import { useEffect, useRef } from "react";
import { sanitizeRichText } from "../utils/richText";

const FONTS = ["Arial", "Georgia", "Tahoma", "Times New Roman", "Verdana"];

export default function RichTextEditor({ value, onChange, disabled = false, placeholder = "" }) {
  const editorRef = useRef(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    const safeValue = sanitizeRichText(value);
    if (editor.innerHTML !== safeValue) editor.innerHTML = safeValue;
  }, [value]);

  function runCommand(command, commandValue = null) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command, false, commandValue);
    onChange(sanitizeRichText(editorRef.current?.innerHTML || ""));
  }

  function handleInput() {
    onChange(sanitizeRichText(editorRef.current?.innerHTML || ""));
  }

  function handleBlur() {
    const safeValue = sanitizeRichText(editorRef.current?.innerHTML || "");
    if (editorRef.current) editorRef.current.innerHTML = safeValue;
    onChange(safeValue);
  }

  return (
    <div className={`rich-text-editor${disabled ? " disabled" : ""}`}>
      <div className="rich-text-toolbar" role="toolbar" aria-label="Formato de descripción">
        <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("bold")} title="Negrita"><b>B</b></button>
        <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("italic")} title="Cursiva"><i>I</i></button>
        <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("underline")} title="Subrayado"><u>U</u></button>
        <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("insertUnorderedList")} title="Lista con viñetas">• Lista</button>
        <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("insertOrderedList")} title="Lista numerada">1. Lista</button>
        <select disabled={disabled} defaultValue="p" onChange={(event) => runCommand("formatBlock", event.target.value)} aria-label="Título o tamaño">
          <option value="p">Normal</option>
          <option value="h1">Título 1</option>
          <option value="h2">Título 2</option>
          <option value="h3">Título 3</option>
        </select>
        <select disabled={disabled} defaultValue="Arial" onChange={(event) => runCommand("fontName", event.target.value)} aria-label="Fuente">
          {FONTS.map((font) => <option value={font} key={font}>{font}</option>)}
        </select>
        <button type="button" disabled={disabled} onClick={() => {
          const href = window.prompt("Dirección del enlace (https://...)");
          if (href) runCommand("createLink", href);
        }} title="Insertar enlace">Enlace</button>
        <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("undo")} title="Deshacer">↶</button>
        <button type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => runCommand("redo")} title="Rehacer">↷</button>
      </div>
      <div
        ref={editorRef}
        className="rich-text-surface"
        contentEditable={!disabled}
        data-placeholder={placeholder}
        role="textbox"
        aria-multiline="true"
        aria-label="Descripción del proyecto"
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleBlur}
      />
    </div>
  );
}
