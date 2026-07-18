import { useEffect, useMemo, useState } from "react";
import { getActiveDepartments } from "../../services/departmentsService";
import { EDITORIAL_LEVELS } from "../models/editorialPermissions";
import { userDisplayName, userSubLabel } from "../utils/editorialLabels";

// Fase 7 — Asignación de permisos editoriales por usuario y departamento. No
// modifica roles globales; sólo el mapa editorialPermissions del proyecto.
export default function EditorialPermissionsDialog({ open, project, users, busy, error, onClose, onSubmit }) {
  const [userLevels, setUserLevels] = useState(() => ({ ...(project.editorialPermissions?.users || {}) }));
  const [departmentLevels, setDepartmentLevels] = useState(() => ({ ...(project.editorialPermissions?.departments || {}) }));
  const [departments, setDepartments] = useState([]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    getActiveDepartments().then((result) => { if (active) setDepartments(result); }).catch(() => { if (active) setDepartments([]); });
    return () => { active = false; };
  }, [open]);

  const assignableUsers = useMemo(
    () => users.filter((user) => user.id !== project.ownerUid),
    [project.ownerUid, users]
  );

  if (!open) return null;

  const cleanMap = (map) => Object.fromEntries(Object.entries(map).filter(([, level]) => level));

  return (
    <div className="editorial-dialog-layer" role="presentation">
      <button type="button" className="editorial-dialog-backdrop" aria-label="Cerrar ventana" onClick={onClose} />
      <section className="editorial-dialog editorial-permissions-dialog" role="dialog" aria-modal="true" aria-label="Permisos editoriales">
        <header>
          <div><span>Permisos</span><h2>Permisos editoriales</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        {error && <p className="editorial-notice warning">{error}</p>}
        <p className="editorial-hint">El propietario y los administradores conservan control completo. Estos permisos no cambian los roles globales.</p>

        <div className="editorial-permissions-section">
          <h4>Por usuario</h4>
          {assignableUsers.length === 0 && <p className="editorial-hint">Sin colaboradores.</p>}
          {assignableUsers.map((user) => (
            <label className="editorial-permission-row" key={user.id}>
              <span className="editorial-permission-user"><strong>{userDisplayName(user)}</strong><small>{userSubLabel(user)}</small></span>
              <select value={userLevels[user.id] || ""} onChange={(event) => setUserLevels((prev) => ({ ...prev, [user.id]: event.target.value }))}>
                <option value="">Predeterminado</option>
                {EDITORIAL_LEVELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          ))}
        </div>

        <div className="editorial-permissions-section">
          <h4>Por departamento</h4>
          {departments.map((department) => (
            <label className="editorial-permission-row" key={department.id}>
              <span>{department.name || department.id}</span>
              <select value={departmentLevels[department.id] || ""} onChange={(event) => setDepartmentLevels((prev) => ({ ...prev, [department.id]: event.target.value }))}>
                <option value="">Sin permiso</option>
                {EDITORIAL_LEVELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>
          ))}
        </div>

        <footer>
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="button" className="editorial-button primary" disabled={busy} onClick={() => onSubmit({ users: cleanMap(userLevels), departments: cleanMap(departmentLevels) })}>
            {busy ? "Guardando…" : "Guardar permisos"}
          </button>
        </footer>
      </section>
    </div>
  );
}
