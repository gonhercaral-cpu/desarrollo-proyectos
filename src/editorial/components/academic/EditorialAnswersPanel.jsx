import EditorialIcon from "../EditorialIcon";

function formatAnswer(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === true) return "Verdadero";
  if (value === false) return "Falso";
  return String(value ?? "");
}

export default function EditorialAnswersPanel({ elements, warnings, onSelect }) {
  const answers = elements.filter((element) => element.answerData);
  return <div className="editorial-answers-panel"><header><strong>Respuestas de página</strong><span>{answers.length}</span></header>{answers.map((element) => <button type="button" key={element.id} onClick={() => onSelect(element.id)}><EditorialIcon name="answers" size={16} /><span><strong>{element.name}</strong><small>{formatAnswer(element.answerData.value) || "Sin respuesta"}</small></span></button>)}{!answers.length && <div className="editorial-inspector-empty"><EditorialIcon name="answers" size={26} /><strong>Sin respuestas</strong><p>Configura respuestas en ejercicios o desde Propiedades.</p></div>}{warnings.length > 0 && <section className="editorial-academic-warnings"><strong>Advertencias</strong>{warnings.map((warning, index) => <button type="button" key={`${warning.code}-${warning.elementId || warning.groupId || index}`} onClick={() => warning.elementId && onSelect(warning.elementId)}>{warning.message}</button>)}</section>}</div>;
}
