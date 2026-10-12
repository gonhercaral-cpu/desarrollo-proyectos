import { ClassroomMetrics, ClassroomInspector } from "./ConsoleLayout";
import ActiveClassroomIcon from "./ActiveClassroomIcon";
import { canClassroom } from "../utils/permissions";
import { useEffect, useState } from "react";
import { deviceService } from "../services/deviceService";

function dateTime(value) {
  return value ? new Date(value).toLocaleString("es-MX") : "Sin registro";
}
function activationCode(value) {
  return value ? `${value.slice(0, 5)}-${value.slice(5)}` : "Sin código";
}

export default function TeamsPanel({ profile, api = deviceService }) {
  const canManage = canClassroom(profile, "manageDevices");
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [revision, setRevision] = useState(0);
  const [renaming, setRenaming] = useState(null);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [enroll, setEnroll] = useState(false);
  const [activationNames, setActivationNames] = useState({});

  useEffect(() => {
    if (!canManage) return undefined;
    let live = true;
    let querying = false;
    async function load() {
      if (querying) return;
      querying = true;
      try {
        const result = [];
        const visited = new Set();
        let cursor = null;
        do {
          const page = await api.list({ cursor });
          if (!live) return;
          result.push(...page.devices);
          cursor = page.nextCursor;
          if (cursor && visited.has(cursor)) throw new Error("No se pudo completar el listado de equipos.");
          if (cursor) visited.add(cursor);
        } while (cursor);
        if (live) { setObservedAt(Date.now()); setDevices(result); setLoadError(""); }
      } catch (failure) {
        if (live) setLoadError(failure?.message || "No se pudieron consultar los equipos.");
      } finally {
        querying = false;
        if (live) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, 30000);
    return () => { live = false; window.clearInterval(timer); };
  }, [api, canManage, revision]);

  async function perform(deviceId, action, data, message) {
    if (busy) return;
    setBusy(deviceId); setError(""); setNotice("");
    try {
      await api[action](data);
      setRenaming(null); setNotice(message); setRevision((value) => value + 1);
    } catch (failure) {
      setError(failure?.message || "No se pudo actualizar el equipo. Reintenta.");
      setRevision((value) => value + 1);
    } finally { setBusy(""); }
  }
  function handleRename(event) {
    event.preventDefault();
    if (renaming) void perform(renaming.deviceId, "rename", { deviceId: renaming.deviceId, displayName: renaming.name }, "Nombre visible actualizado.");
  }

  if (!canManage) return <section className="ac-section-panel"><h2>Equipos</h2><p role="alert">Se requiere permiso para gestionar equipos.</p></section>;
  const online = device => device.status === "authorized" && device.lastSeenAt && observedAt - device.lastSeenAt < 6 * 60 * 1000;
  const deviceLabel = device => device.status === "pending" ? "Pendiente" : device.status === "revoked" ? "Revocado" : online(device) ? "En línea" : "Offline";
  const visible = devices.filter(device => (!search || [device.displayName, device.deviceName, device.deviceId].join(" ").toLowerCase().includes(search.toLowerCase())) && (filter === "all" || device.status === filter));
  const inspected = devices.find(device => device.deviceId === selected) || visible[0];
  return <><ClassroomMetrics items={[{ title: "Equipos vinculados", value: devices.filter(device => device.status === "authorized").length, detail: "dispositivos autorizados", icon: "teams" }, { title: "En línea", value: devices.filter(online).length, detail: "conexión en los últimos 6 minutos", icon: "refresh", tone: "green" }, { title: "Requieren atención", value: devices.filter(device => device.status === "pending").length, detail: "solicitudes de activación pendientes", icon: "info", tone: "orange" }]} />{(error || loadError) && <p className="ac-error-banner" role="alert">{error || loadError}</p>}{notice && <p role="status">{notice}</p>}<div className="ac-console-layout"><section className="ac-console-panel"><div className="ac-console-toolbar"><label><ActiveClassroomIcon name="search" /><input placeholder="Buscar equipo o identificador…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Estado del equipo" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos los estados</option><option value="authorized">Autorizados</option><option value="pending">Pendientes</option><option value="revoked">Revocados</option></select><button className="ac-primary-button" onClick={() => { setEnroll(!enroll); setFilter("pending"); }}>+ Vincular equipo</button><button className="ac-outline-button" disabled={Boolean(busy)} onClick={() => setRevision(value => value + 1)}>Actualizar equipos</button></div>{enroll && <p className="ac-permission-hint">Abre Desktop en el equipo y solicita activación. Selecciona aquí su solicitud y confirma el código mostrado en ese equipo.</p>}{loading && <p role="status">Cargando equipos…</p>}<div className="ac-console-table-scroll"><table className="ac-console-table"><thead><tr><th>Equipo / Pantalla</th><th>Estado</th><th>Última conexión</th><th>Versión de app</th><th>Última sincronización</th><th>Acciones</th></tr></thead><tbody>{visible.map(device => <tr key={device.deviceId} className={inspected?.deviceId === device.deviceId ? "is-selected" : ""}><td><button onClick={() => setSelected(device.deviceId)}><ActiveClassroomIcon name="teams" /><strong>{device.displayName || device.deviceName || device.name}</strong></button><small>{device.deviceName}</small></td><td><span className={`ac-console-status is-${online(device) ? "positive" : "pending"}`}>{deviceLabel(device)}</span></td><td>{dateTime(device.lastSeenAt)}</td><td>{device.appVersion || "No informada"}</td><td>{dateTime(device.lastSyncAt)}</td><td><button className="ac-outline-button" onClick={() => setSelected(device.deviceId)}>···</button></td></tr>)}</tbody></table>{!visible.length && !loading && <p className="ac-console-empty">Sin equipos en este estado.</p>}</div></section><ClassroomInspector>{inspected ? <div className="ac-inspector-body"><div className="ac-device-preview"><ActiveClassroomIcon name="teams" size={62} /></div><h3>{inspected.displayName || inspected.deviceName || inspected.name}</h3><span className={`ac-console-status is-${online(inspected) ? "positive" : "pending"}`}>{deviceLabel(inspected)}</span><dl><dt>Identificador</dt><dd>{inspected.deviceId}</dd><dt>Hostname</dt><dd>{inspected.deviceName || "No informado"}</dd><dt>Última conexión</dt><dd>{dateTime(inspected.lastSeenAt)}</dd><dt>Última sincronización</dt><dd>{dateTime(inspected.lastSyncAt)}</dd><dt>Versión de app</dt><dd>{inspected.appVersion || "No informada"}</dd>{inspected.lastSyncUnitId && <><dt>Última Unit sincronizada</dt><dd>{inspected.lastSyncUnitId} v{inspected.lastSyncVersion}</dd></>}</dl>{renaming?.deviceId === inspected.deviceId ? <form className="ac-device-actions" onSubmit={handleRename}><label>Nombre visible<input autoFocus maxLength={100} value={renaming.name} onChange={event => setRenaming({ ...renaming, name: event.target.value })} disabled={Boolean(busy)} /></label><button className="ac-primary-button" disabled={Boolean(busy)}>Guardar nombre</button><button type="button" className="ac-outline-button" onClick={() => setRenaming(null)}>Cancelar</button></form> : <button className="ac-outline-button" disabled={Boolean(busy)} onClick={() => setRenaming({ deviceId: inspected.deviceId, name: inspected.displayName ?? inspected.deviceName ?? "" })}>Renombrar pantalla</button>}{inspected.status === "pending" && <><h4>Código de vinculación</h4><p className="ac-device-code">{activationCode(inspected.code)}</p><small>Vence: {dateTime(inspected.expiresAt)}</small><label>Nombre visible<input maxLength={100} value={activationNames[inspected.deviceId] || ""} onChange={event => setActivationNames(current => ({ ...current, [inspected.deviceId]: event.target.value }))} /></label><button className="ac-primary-button" disabled={Boolean(busy) || !inspected.code || inspected.expiresAt <= observedAt} onClick={() => { if (window.confirm(`¿Autorizar este equipo? Confirma el código ${activationCode(inspected.code)} en Desktop.`)) void perform(inspected.deviceId, "approve", { code: inspected.code, displayName: activationNames[inspected.deviceId] ?? inspected.displayName ?? "" }, "Equipo autorizado."); }}>Autorizar equipo</button><button className="ac-outline-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm("¿Rechazar esta solicitud de activación?")) void perform(inspected.deviceId, "reject", { deviceId: inspected.deviceId }, "Solicitud rechazada."); }}>Rechazar</button></>}{inspected.status === "authorized" && <button className="ac-danger-button" disabled={Boolean(busy)} onClick={() => { if (window.confirm("¿Revocar acceso? El equipo offline conocerá la revocación al reconectarse.")) void perform(inspected.deviceId, "revoke", { deviceId: inspected.deviceId }, "Acceso revocado."); }}>Revocar acceso</button>}{inspected.status === "revoked" && <p>Para volver a autorizar, soporte debe renovar la identidad del equipo; clases locales conservadas.</p>}</div> : <p>Selecciona un equipo.</p>}</ClassroomInspector></div></>;
}
