import { useState } from "react";

const LABELS = {
  multiple_choice: "Opción múltiple", fill_blanks: "Completar espacios",
  true_false: "Verdadero o falso", matching: "Relacionar columnas",
  open_questions: "Preguntas abiertas",
};

function lines(value) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

export default function EditorialExerciseDialog({ type, existing, onClose, onSubmit }) {
  const data = existing?.exerciseData || {};
  const [form, setForm] = useState(() => ({
    question: data.question || "",
    text: data.sourceText || data.text || "",
    options: (data.options || []).join("\n"),
    correctOption: Number(data.correctOption ?? 0),
    showLetters: data.showLetters !== false,
    layout: data.layout || "list",
    blanks: (data.blanks || []).join("\n"),
    wordBank: (data.wordBank || []).join("\n"),
    showWordBank: data.showWordBank !== false,
    statements: (data.statements || []).map((item) => `${item.text}|${item.answer === true ? "V" : item.answer === false ? "F" : ""}`).join("\n"),
    leftItems: (data.leftItems || []).join("\n"),
    rightItems: (data.rightItems || []).join("\n"),
    answers: data.answers ? Object.entries(data.answers).map(([left, right]) => `${left}:${right}`).join("\n") : "",
    questions: (data.questions || []).join("\n"),
    answerLines: Number(data.answerLines || 3),
  }));
  if (!type) return null;
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const values = { ...form };
    values.options = lines(form.options);
    values.blanks = lines(form.blanks);
    values.wordBank = lines(form.wordBank);
    values.questions = lines(form.questions);
    values.leftItems = lines(form.leftItems);
    values.rightItems = lines(form.rightItems);
    values.statements = lines(form.statements).map((row) => { const [text, answer] = row.split("|"); return { text, answer: answer?.trim().toUpperCase() === "V" ? true : answer?.trim().toUpperCase() === "F" ? false : null }; });
    values.answers = Object.fromEntries(lines(form.answers).map((row) => row.split(":").map((part) => part.trim())).filter((pair) => pair.length === 2));
    onSubmit(values);
  };

  return (
    <div className="editorial-dialog-layer">
      <button type="button" className="editorial-dialog-backdrop" onClick={onClose} aria-label="Cerrar" />
      <form className="editorial-dialog editorial-academic-dialog" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <header><div><span className="editorial-eyebrow">Generador de ejercicio</span><h2>{existing ? "Regenerar" : "Crear"} · {LABELS[type]}</h2></div></header>
        <div className="editorial-structure-form">
          {type === "multiple_choice" && <><label>Pregunta<textarea rows="2" value={form.question} onChange={(event) => update("question", event.target.value)} required /></label><label>Opciones · una por línea<textarea rows="5" value={form.options} onChange={(event) => update("options", event.target.value)} required /></label><div className="editorial-academic-field-grid"><label>Respuesta correcta<select value={form.correctOption} onChange={(event) => update("correctOption", Number(event.target.value))}>{lines(form.options).map((option, index) => <option value={index} key={`${option}-${index}`}>{index + 1}. {option}</option>)}</select></label><label>Diseño<select value={form.layout} onChange={(event) => update("layout", event.target.value)}><option value="list">Lista</option><option value="columns">Dos columnas</option></select></label></div><label className="editorial-inspector-checkbox"><input type="checkbox" checked={form.showLetters} onChange={(event) => update("showLetters", event.target.checked)} />Mostrar letras</label></>}
          {type === "fill_blanks" && <><label>Texto original<textarea rows="4" value={form.text} onChange={(event) => update("text", event.target.value)} required /></label><label>Palabras a ocultar · una por línea<textarea rows="4" value={form.blanks} onChange={(event) => update("blanks", event.target.value)} required /></label><label>Banco de palabras · una por línea<textarea rows="3" value={form.wordBank} onChange={(event) => update("wordBank", event.target.value)} /></label><label className="editorial-inspector-checkbox"><input type="checkbox" checked={form.showWordBank} onChange={(event) => update("showWordBank", event.target.checked)} />Mostrar banco</label></>}
          {type === "true_false" && <label>Afirmaciones · texto|V o texto|F<textarea rows="8" value={form.statements} onChange={(event) => update("statements", event.target.value)} required /></label>}
          {type === "matching" && <><div className="editorial-academic-field-grid"><label>Columna A<textarea rows="6" value={form.leftItems} onChange={(event) => update("leftItems", event.target.value)} required /></label><label>Columna B<textarea rows="6" value={form.rightItems} onChange={(event) => update("rightItems", event.target.value)} required /></label></div><label>Respuestas · índice A:índice B<textarea rows="3" value={form.answers} onChange={(event) => update("answers", event.target.value)} placeholder="0:1" /></label></>}
          {type === "open_questions" && <><label>Preguntas · una por línea<textarea rows="8" value={form.questions} onChange={(event) => update("questions", event.target.value)} required /></label><label>Líneas por respuesta<input type="number" min="1" max="12" value={form.answerLines} onChange={(event) => update("answerLines", Number(event.target.value))} /></label></>}
          {existing && <p className="editorial-design-warning">Se reemplazará solo el grupo generado. Los elementos manuales permanecen intactos.</p>}
        </div>
        <footer><button type="button" className="editorial-button secondary" onClick={onClose}>Cancelar</button><button type="submit" className="editorial-button primary">{existing ? "Confirmar regeneración" : "Generar"}</button></footer>
      </form>
    </div>
  );
}
