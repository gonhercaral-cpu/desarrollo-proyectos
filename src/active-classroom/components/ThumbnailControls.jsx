export function ThumbnailSizeControl({ value, onChange }) {
  const choices = ["small", "medium", "large"];
  return <label className="ac-thumbnail-control">Tamaño de miniatura:<input type="range" min="0" max="2" step="1" value={choices.indexOf(value)} aria-valuetext={{ small: "Pequeño", medium: "Mediano", large: "Grande" }[value]} onChange={event => onChange(choices[Number(event.target.value)])} /><span>{{ small: "Pequeño", medium: "Mediano", large: "Grande" }[value]}</span></label>;
}
