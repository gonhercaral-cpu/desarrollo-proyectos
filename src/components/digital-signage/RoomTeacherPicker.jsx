import { useId, useState } from "react";

export default function RoomTeacherPicker({ value = "", onChange, teachers = [], loading = false, error = "", label = "Maestro Asignado" }) {
  const id = useId();
  const [custom, setCustom] = useState(false);
  const known = teachers.some(teacher => teacher.name === value);
  return (
    <div className="signage-room-teacher-picker">
      <label className="signage-rooms-field" htmlFor={id}>{label}</label>
      <select
        id={id}
        value={custom ? "__custom__" : value}
        onChange={event => {
          const selected = event.target.value;
          setCustom(selected === "__custom__");
          if (selected !== "__custom__") onChange(selected);
        }}
      >
        <option value="">{loading ? "Cargando maestros de Firmas…" : "Selecciona un maestro"}</option>
        {value && !known && <option value={value}>{value} (nombre guardado)</option>}
        {teachers.map(teacher => <option key={teacher.id} value={teacher.name}>{teacher.name}{teacher.campuses.length ? ` — ${teacher.campuses.join(", ")}` : ""}</option>)}
        <option value="__custom__">Nombre personalizado…</option>
      </select>
      {custom && (
        <label className="signage-rooms-field">
          Nombre personalizado del maestro
          <input type="text" value={value} maxLength={120} onChange={event => onChange(event.target.value)} placeholder="Nombre del maestro" />
        </label>
      )}
      {error && <span role="status" className="signage-rooms-hint-text">{error} Puedes conservar el nombre guardado o utilizar uno personalizado.</span>}
      {!loading && !error && !teachers.length && <span className="signage-rooms-hint-text">No hay maestros activos registrados en Imprenta → Firmas.</span>}
    </div>
  );
}
