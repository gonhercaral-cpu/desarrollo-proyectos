import { useEffect, useState } from "react";
import { deviceService } from "../services/deviceService";

function dateTime(value) {
  return value ? new Date(value).toLocaleString("es-MX") : "Sin registro";
}
function activationCode(value) {
  return value ? `${value.slice(0, 5)}-${value.slice(5)}` : "Sin código";
}

export default function TeamsPanel({ profile, api = deviceService }) {
  const canManage = profile?.active === true && profile?.role === "admin";
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [revision, setRevision] = useState(0);
  const [renaming, setRenaming] = useState(null);
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
        if (live) { setDevices(result); setLoadError(""); }
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

  if (!canManage) return <section className="ac-section-panel"><h2>Equipos</h2><p role="alert">Se requiere administrador activo para gestionar equipos.</p></section>;
  const groups = [
    { title: "Pendientes de activación", items: devices.filter((device) => device.status === "pending") },
    { title: "Equipos autorizados", items: devices.filter((device) => device.status === "authorized") },
    { title: "Acceso revocado o rechazado", items: devices.filter((device) => device.status === "revoked") },
  ];
  return (
    <section className="ac-section-panel ac-devices-panel">
      <header className="ac-section-heading">
        <div><span>ACCESO INSTITUCIONAL</span><h2>Equipos</h2><p>Autoriza equipos del salón. Acceso exclusivo a publicaciones y archivos publicados.</p></div>
        <button type="button" className="ac-outline-button" disabled={Boolean(busy)} onClick={() => setRevision((value) => value + 1)}>Actualizar equipos</button>
      </header>
      {(error || loadError) && <p className="ac-error-banner" role="alert">{error || loadError}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading && <p role="status">Cargando equipos...</p>}
      {!loading && groups.map(({ title, items }) => (
        <section key={title} className="ac-device-group">
          <h3>{title} <small>({items.length})</small></h3>
          {!items.length && <p>No hay equipos en este estado.</p>}
          <div className="ac-device-grid">
            {items.map((device) => {
              const visibleName = device.displayName || device.deviceName || device.name || "Equipo del salón";
              const pending = device.status === "pending";
              const expired = pending && (!device.expiresAt || device.expiresAt <= Date.now());
              const status = pending ? expired ? "Código vencido" : "Pendiente" : device.status === "authorized" ? "Activo" : device.revokedReason === "rejected" ? "Rechazado" : "Revocado";
              return (
                <article key={device.deviceId} className="ac-device-card">
                  <div className="ac-device-title"><h4>{visibleName}</h4><span className={`ac-status-pill ${device.status === "authorized" ? "is-active" : "is-draft"}`}>{status}</span></div>
                  <p className="ac-device-technical">Hostname: {device.deviceName || "Se informará en la próxima conexión del equipo"}</p>
                  {renaming?.deviceId === device.deviceId ? (
                    <form className="ac-device-actions" onSubmit={handleRename}>
                      <label>Nombre visible<input autoFocus maxLength={100} placeholder={device.deviceName || device.name} value={renaming.name} onChange={(event) => setRenaming({ ...renaming, name: event.target.value })} disabled={Boolean(busy)} /></label>
                      <small>Vacío: usar hostname. Máximo 100 caracteres.</small>
                      <button type="submit" className="ac-primary-button" disabled={Boolean(busy)}>Guardar nombre</button>
                      <button type="button" className="ac-clear-filters" disabled={Boolean(busy)} onClick={() => setRenaming(null)}>Cancelar</button>
                    </form>
                  ) : <button type="button" className="ac-clear-filters" disabled={Boolean(busy)} onClick={() => setRenaming({ deviceId: device.deviceId, name: device.displayName ?? (device.deviceName ? "" : device.name) })}>Renombrar</button>}
                  <dl className="ac-device-details">
                    <dt>ID equipo</dt><dd>{device.deviceId}</dd>
                    {pending ? <><dt>Código de activación</dt><dd className="ac-device-code">{activationCode(device.code)}</dd><dt>Solicitud</dt><dd>{dateTime(device.requestedAt)}</dd><dt>Vence</dt><dd>{dateTime(device.expiresAt)}</dd></> : <><dt>Última conexión</dt><dd>{dateTime(device.lastSeenAt)}</dd><dt>Última sincronización</dt><dd>{dateTime(device.lastSyncAt)}{device.lastSyncAt && <small>Declarada por Desktop{device.lastSyncUnitId ? ` · ${device.lastSyncUnitId} v${device.lastSyncVersion}` : ""}</small>}</dd><dt>Versión Active Classroom</dt><dd>{device.appVersion || "No informada"}</dd></>}
                  </dl>
                  {expired && <p>Código vencido. Pulsa Reintentar activación en Desktop para renovarlo.</p>}
                  {pending && <div className="ac-device-actions"><label>Nombre visible al autorizar (opcional)<input maxLength={100} placeholder="Ej. Salón 4 - Inglés" value={activationNames[device.deviceId] ?? device.displayName ?? ""} disabled={Boolean(busy)} onChange={(event) => setActivationNames((current) => ({ ...current, [device.deviceId]: event.target.value }))} /></label></div>}
                  <div className="ac-device-actions">
                    {pending && <>
                      <button type="button" className="ac-primary-button" disabled={Boolean(busy) || expired || !device.code} onClick={() => {
                        if (window.confirm(`Autorizar "${activationNames[device.deviceId]?.trim() || visibleName}"? Comprueba que el equipo del salón muestra ${activationCode(device.code)}.`)) void perform(device.deviceId, "approve", { code: device.code, displayName: activationNames[device.deviceId] ?? device.displayName ?? "" }, "Equipo autorizado. Pulsa Reintentar activación en Desktop.");
                      }}>Autorizar</button>
                      <button type="button" className="ac-outline-button" disabled={Boolean(busy)} onClick={() => {
                        if (window.confirm(`Rechazar activación de "${visibleName}"? Esta credencial quedará bloqueada.`)) void perform(device.deviceId, "reject", { deviceId: device.deviceId }, "Solicitud rechazada.");
                      }}>Rechazar</button>
                    </>}
                    {device.status === "authorized" && <button type="button" className="ac-outline-button" disabled={Boolean(busy)} onClick={() => {
                      if (window.confirm(`Revocar acceso de "${visibleName}"? Un equipo desconectado conservará sus clases hasta conocer la revocación.`)) void perform(device.deviceId, "revoke", { deviceId: device.deviceId }, "Acceso del equipo revocado.");
                    }}>Revocar acceso</button>}
                  </div>
                  {device.status === "revoked" && <p>Para volver a autorizar, soporte debe renovar la identidad del equipo. La nueva solicitud aparecerá aquí con otro código; las clases locales se conservan.</p>}
                  {busy === device.deviceId && <p role="status">Guardando...</p>}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
}
