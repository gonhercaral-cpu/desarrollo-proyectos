import { useState } from "react";
import { Icon, Modal } from "./UI.jsx";
import { errorText, TYPES } from "./model.js";
import { saveSettings } from "./service.js";

const MODES = { single: "Una impresora", pages: "Por rangos", copies: "Por copias", smart: "Inteligente" };
const PRIORITIES = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };
const EMPTY = { groups: [], rules: [], revision: 0 };

function GroupFields({ value, change, printers }) {
  return (
    <>
      <label className="pp-field">Nombre del grupo<input required maxLength={80} value={value.name} onChange={(e) => change("name", e.target.value)} /></label>
      <fieldset className="pp-routing-targets">
        <legend>Impresoras del grupo</legend>
        {printers.map((printer) => {
          const checked = value.printerIds.includes(printer.id);
          return <label className="pp-check" key={printer.id}>
            <input type="checkbox" checked={checked} onChange={() => change("printerIds", checked
              ? value.printerIds.filter((id) => id !== printer.id) : [...value.printerIds, printer.id])} />
            {printer.settings?.name || printer.name || printer.queue}
            {printer.settings?.enabled === false ? " · Desactivada" : ""}
          </label>;
        })}
      </fieldset>
    </>
  );
}

function RuleFields({ value, change, groups, printers }) {
  const paper = Object.fromEntries([...new Set(printers.flatMap((p) => p.paperSizes || []))].map((item) => [item, item]));
  const media = Object.fromEntries([...new Set(printers.flatMap((p) => p.capabilities?.mediaTypes || []))].map((item) => [item, item]));
  function select(key, label, options, empty = "Cualquiera") {
    return <label>{label}<select value={value[key] || ""} required={empty === false}
      onChange={(event) => change(key, event.target.value)}>
      {empty !== false && <option value="">{empty}</option>}
      {value[key] && !(value[key] in options) && <option value={value[key]}>{value[key]}</option>}
      {Object.entries(options).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
    </select></label>;
  }
  function number(key, label, min, max) {
    return <label>{label}<input type="number" value={value[key] ?? ""} min={min} max={max} step="1"
      placeholder="Sin límite" onChange={(event) => change(key, event.target.value === "" ? null : Number(event.target.value))} /></label>;
  }
  return (
    <div className="pp-fields">
      <label>Nombre de la regla<input required maxLength={80} value={value.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label className="pp-check"><input type="checkbox" checked={value.enabled} onChange={(e) => change("enabled", e.target.checked)} />Regla activa</label>
      {select("groupId", "Grupo de destino", Object.fromEntries(groups.map((group) => [group.id, group.name])), false)}
      {select("mode", "Distribución", MODES, false)}
      {select("type", "Tipo de documento", TYPES)}
      {select("priority", "Prioridad del trabajo", PRIORITIES)}
      {select("paper", "Tamaño de papel", paper)}
      {select("mediaType", "Tipo de papel", media)}
      {select("color", "Modo de color", { color: "A color", mono: "Blanco y negro" })}
      <label>Acabado solicitado<input maxLength={80} value={value.finishing || ""} onChange={(e) => change("finishing", e.target.value)} placeholder="Cualquiera" /></label>
      {number("minPages", "Páginas desde", 1, 10000)}
      {number("maxPages", "Páginas hasta", 1, 10000)}
      {number("minCopies", "Copias desde", 1, 999)}
      {number("maxCopies", "Copias hasta", 1, 999)}
      {number("minSpeed", "Velocidad mínima (páginas/min)", 1, 2000)}
      {number("maxQueue", "Máximo de trabajos en cola CUPS", 0, 10000)}
    </div>
  );
}

export default function PrinterRouting({ settings, printers, isAdmin }) {
  const routing = settings.routing || EMPTY;
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function open(kind, record = null, remove = false) {
    const defaults = kind === "groups" ? { printerIds: [] } : { groupId: routing.groups[0]?.id, mode: "smart", enabled: true };
    setError("");
    setMessage("");
    setEditing({ kind, remove, revision: routing.revision, value: record || { id: crypto.randomUUID(), name: "", ...defaults } });
  }

  async function write(next, revision = routing.revision) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await saveSettings({ requestId: crypto.randomUUID(), routing: { ...next, revision } });
      setEditing(null);
      setMessage("Distribución actualizada.");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const { kind, value, remove, revision } = editing;
    const entries = routing[kind];
    const exists = entries.some((item) => item.id === value.id);
    const next = remove ? entries.filter((item) => item.id !== value.id) : exists
      ? entries.map((item) => item.id === value.id ? value : item) : [...entries, value];
    await write({ ...routing, [kind]: next }, revision);
  }

  function move(index, offset) {
    const rules = [...routing.rules];
    [rules[index], rules[index + offset]] = [rules[index + offset], rules[index]];
    void write({ ...routing, rules });
  }

  return (
    <section className="pp-card pp-routing">
      <div className="pp-divider"><h3><Icon name="layers" /> Grupos y reglas de distribución</h3></div>
      <div className="pp-routing-columns">
        <div>
          <div className="pp-divider"><h4>Grupos de impresoras</h4>
            {isAdmin && <button type="button" className="pp-btn" disabled={busy || !printers.length} onClick={() => open("groups")}>Nuevo grupo</button>}
          </div>
          {!routing.groups.length && <p>{printers.length ? "Agrupa equipos para dirigir trabajos a impresoras compatibles." : "Vincula una impresora para crear un grupo."}</p>}
          {routing.groups.map((group) => {
            const members = group.printerIds.map((id) => printers.find((printer) => printer.id === id));
            return <div className="pp-printer" key={group.id}>
              <span><strong>{group.name}</strong><small>{members.map((p) => p?.settings?.name || p?.name || "Equipo ausente").join(", ")}</small></span>
              {isAdmin && <div className="pp-row-actions">
                <button type="button" className="pp-btn" disabled={busy} onClick={() => open("groups", group)}>Editar</button>
                <button type="button" className="pp-btn" disabled={busy || routing.rules.some((rule) => rule.groupId === group.id)} onClick={() => open("groups", group, true)}>Eliminar</button>
              </div>}
            </div>;
          })}
        </div>
        <div>
          <div className="pp-divider"><h4>Orden de aplicación</h4>
            {isAdmin && <button type="button" className="pp-btn pp-primary" disabled={busy || !routing.groups.length} onClick={() => open("rules")}>Nueva regla</button>}
          </div>
          <p>Se aplica la primera regla activa que coincide. El grupo debe tener equipos disponibles que cumplan sus condiciones.</p>
          {routing.rules.map((rule, index) => (
            <div className="pp-printer" key={rule.id}>
              <span><strong>{index + 1}. {rule.name}</strong><small>
                {routing.groups.find((group) => group.id === rule.groupId)?.name} · {MODES[rule.mode]} · {rule.enabled ? "Activa" : "En pausa"}
              </small></span>
              {isAdmin && <div className="pp-row-actions">
                <button type="button" className="pp-btn" aria-label={`Subir ${rule.name}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
                <button type="button" className="pp-btn" aria-label={`Bajar ${rule.name}`} disabled={busy || index === routing.rules.length - 1} onClick={() => move(index, 1)}>↓</button>
                <button type="button" className="pp-btn" disabled={busy} onClick={() => open("rules", rule)}>Editar</button>
                <button type="button" className="pp-btn" disabled={busy} onClick={() => open("rules", rule, true)}>Eliminar</button>
              </div>}
            </div>
          ))}
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      {!editing && error && <p role="alert" className="pp-error">{error}</p>}
      {editing && <Modal title={editing.remove ? "Eliminar configuración" : editing.kind === "groups" ? "Grupo de impresoras" : "Regla de distribución"}
        wide onClose={busy ? undefined : () => setEditing(null)}>
        <form onSubmit={submit}>
          {editing.remove ? <p>Eliminar «{editing.value.name}» de la configuración.</p> : (() => {
            const change = (key, value) => setEditing((current) => ({ ...current, value: { ...current.value, [key]: value } }));
            return editing.kind === "groups"
              ? <GroupFields value={editing.value} change={change} printers={printers} />
              : <RuleFields value={editing.value} change={change} printers={printers} groups={routing.groups} />;
          })()}
          {error && <p role="alert" className="pp-error">{error}</p>}
          <footer className="pp-dialog-actions">
            <button type="button" className="pp-btn" disabled={busy} onClick={() => setEditing(null)}>Cancelar</button>
            <button className="pp-btn pp-primary" disabled={busy}>{busy ? "Guardando…" : editing.remove ? "Eliminar" : "Guardar"}</button>
          </footer>
        </form>
      </Modal>}
    </section>
  );
}
