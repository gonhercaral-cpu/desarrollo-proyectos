import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection, getDocs, limit, onSnapshot, orderBy, query, startAfter,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../services/firebase";

const PAGE_SIZE = 25;
const KIND_LABELS = {
  production: "Producción general", books: "Libros", certificates: "Certificados emitidos",
  credentials: "Credenciales emitidas", printer: "Por impresora", inventory: "Inventario",
  costs: "Costos", operator: "Por operador", waste: "Merma y rechazos", reprints: "Reimpresiones",
};
const FREQUENCY_LABELS = { daily: "Diaria", weekly: "Semanal", monthly: "Mensual" };
const SECTION_LABELS = {
  type: "Por tipo", status: "Por estado", source: "Por origen", product: "Por material o producto",
  operator: "Por operador", printer: "Por impresora",
};
const SUMMARY_ROWS = [
  ["jobs", "Trabajos"], ["requestedFaces", "Caras solicitadas"], ["requestedSheets", "Hojas solicitadas"],
  ["confirmedFaces", "Caras confirmadas"], ["accepted", "Aceptadas"], ["rejected", "Rechazadas"],
  ["inventoried", "Inventariadas"], ["costTotal", "Costo registrado"], ["jobsWithoutCost", "Trabajos sin costo"],
  ["reprints", "Reimpresiones"],
];
const GROUP_COLUMNS = [
  ["key", "Grupo"], ["jobs", "Trabajos"], ["requestedFaces", "Caras solicitadas"], ["confirmedFaces", "Caras confirmadas"],
  ["rejected", "Rechazadas"], ["rejectionRate", "Tasa de rechazo"], ["inventoried", "Inventariadas"], ["costTotal", "Costo"],
];

const styles = {
  root: { display: "grid", gap: 16 },
  panel: { border: "1px solid #d6dbe4", borderRadius: 12, padding: 16, background: "#fff", display: "grid", gap: 12 },
  head: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 },
  item: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between",
    border: "1px solid #e1e5ec", borderRadius: 10, padding: "10px 12px" },
  button: { minHeight: 40, padding: "0 14px", borderRadius: 8, border: "1px solid #94a3b8", background: "#fff", cursor: "pointer", font: "inherit" },
  primary: { minHeight: 40, padding: "0 14px", borderRadius: 8, border: "1px solid #1d4ed8", background: "#1d4ed8", color: "#fff", cursor: "pointer", font: "inherit" },
  danger: { minHeight: 40, padding: "0 14px", borderRadius: 8, border: "1px solid #b91c1c", background: "#fff", color: "#b91c1c", cursor: "pointer", font: "inherit" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  cell: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e8ebf0" },
  scroll: { overflowX: "auto" },
  muted: { color: "#475569", fontSize: 13, margin: 0 },
  overlay: { position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.55)", display: "grid", placeItems: "center", padding: 16, zIndex: 1000 },
  dialog: { background: "#fff", borderRadius: 14, padding: 20, width: "min(520px, 100%)", maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 12 },
  field: { display: "grid", gap: 4 },
  input: { minHeight: 40, padding: "0 10px", borderRadius: 8, border: "1px solid #94a3b8", font: "inherit" },
  check: { display: "flex", gap: 8, alignItems: "flex-start" },
};

function callable(name) {
  const invoke = httpsCallable(functions, name, { timeout: 60000 });
  return async (data) => (await invoke(data)).data;
}
const saveSchedule = callable("printProductionSchedule");

function newRequestId() {
  return globalThis.crypto?.randomUUID?.() || `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatValue(key, value) {
  if (value === null || value === undefined) return "Sin dato";
  if (key === "rejectionRate") return `${(value * 100).toFixed(2)} %`;
  if (key === "costTotal") return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
  return typeof value === "number" ? new Intl.NumberFormat("es-MX").format(value) : String(value);
}

function formatDay(value) {
  const [y, m, d] = String(value || "").split("-");
  return y && m && d ? `${d}/${m}/${y}` : "—";
}

function periodLabel(report) {
  return report.from === report.to ? formatDay(report.from) : `${formatDay(report.from)} – ${formatDay(report.to)}`;
}

// Neutraliza fórmulas de hoja de cálculo y escapa comillas, comas y saltos de línea.
function csvCell(value) {
  let cell = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/u.test(cell) && Number.isNaN(Number(cell))) cell = `'${cell}`;
  return /[",\r\n]/u.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell;
}

function reportToCsv(report) {
  const data = report.data || {};
  const rows = [
    ["Reporte", KIND_LABELS[report.kind] || report.kind], ["Periodo", `${report.from} a ${report.to}`],
    ["Zona horaria", report.timezone], ["Identificador", report.id], ["Huella del contenido", report.contentSha256], [],
    ["Resumen", "Periodo actual", "Periodo anterior"],
    ...SUMMARY_ROWS.map(([key, label]) => [label, data.summary?.[key], data.previous?.summary?.[key]]),
  ];
  if (data.emitted) {
    rows.push([], ["Emitidos por día", "Cantidad"], ...(data.emitted.byDay || []).map((item) => [item.day, item.emitted]));
  }
  for (const [name, list] of Object.entries(data.sections || {})) {
    rows.push([], [SECTION_LABELS[name] || name], GROUP_COLUMNS.map(([, label]) => label),
      ...list.map((row) => GROUP_COLUMNS.map(([key]) => row[key])));
  }
  rows.push([], ...Object.values(data.labels || {}).map((label) => ["Nota", label]));
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function downloadCsv(report) {
  const blob = new Blob([reportToCsv(report)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reporte-imprenta-${report.kind}-${report.from}-${report.to}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Table({ caption, columns, rows }) {
  return <div className="ppr-scroll" style={styles.scroll}>
    <table className="ppr-table" style={styles.table}>
      <caption style={{ textAlign: "left", fontWeight: 600, padding: "4px 0" }}>{caption}</caption>
      <thead><tr>{columns.map(([key, label]) => <th key={key} scope="col" style={styles.cell}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.key ?? row.day ?? index}`}>
        {columns.map(([key]) => <td key={key} style={styles.cell}>{formatValue(key, row[key])}</td>)}
      </tr>)}</tbody>
    </table>
  </div>;
}

function ReportDetail({ report, onClose }) {
  const data = report.data || {};
  const summaryRows = SUMMARY_ROWS.map(([key, label]) => ({
    key: label, current: data.summary?.[key], previous: data.previous?.summary?.[key],
    change: data.comparison?.[key]?.percent == null ? null : `${data.comparison[key].percent} %`, field: key,
  }));
  return <section className="ppr-detail" style={styles.panel} aria-labelledby="ppr-detail-title">
    <div style={styles.head}>
      <h3 id="ppr-detail-title" style={{ margin: 0 }}>{KIND_LABELS[report.kind] || report.kind} · {periodLabel(report)}</h3>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={styles.primary} onClick={() => downloadCsv(report)}>Descargar CSV</button>
        <button type="button" style={styles.button} onClick={onClose}>Cerrar reporte</button>
      </div>
    </div>
    <p style={styles.muted}>
      Zona horaria {report.timezone}. Este reporte es una copia fija generada el {report.generatedAtIso ? new Date(report.generatedAtIso).toLocaleString("es-MX") : "—"}
      {report.source === "schedule" ? " por una programación." : "."} Periodo anterior: {formatDay(data.previous?.from)} – {formatDay(data.previous?.to)}.
    </p>
    <div className="ppr-scroll" style={styles.scroll}>
      <table className="ppr-table" style={styles.table}>
        <caption style={{ textAlign: "left", fontWeight: 600, padding: "4px 0" }}>Resumen y comparación</caption>
        <thead><tr>
          <th scope="col" style={styles.cell}>Indicador</th><th scope="col" style={styles.cell}>Periodo</th>
          <th scope="col" style={styles.cell}>Anterior</th><th scope="col" style={styles.cell}>Cambio</th>
        </tr></thead>
        <tbody>{summaryRows.map((row) => <tr key={row.field}>
          <th scope="row" style={styles.cell}>{row.key}</th>
          <td style={styles.cell}>{formatValue(row.field, row.current)}</td>
          <td style={styles.cell}>{formatValue(row.field, row.previous)}</td>
          <td style={styles.cell}>{row.change ?? "Sin dato"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {data.emitted && <>
      <p style={{ margin: 0 }}><strong>{formatValue("n", data.emitted.total)}</strong> emitidos (periodo anterior: {formatValue("n", data.emitted.previousTotal)}).
        Trabajos de impresión asociados: {formatValue("n", data.printedFromJobs?.jobs)}.</p>
      <Table caption="Emitidos por día" columns={[["day", "Día"], ["emitted", "Emitidos"]]} rows={data.emitted.byDay || []} />
    </>}
    {Object.entries(data.sections || {}).map(([name, rows]) => rows.length === 0
      ? <p key={name} style={styles.muted}>{SECTION_LABELS[name] || name}: sin registros en el periodo.</p>
      : <Table key={name} caption={SECTION_LABELS[name] || name} columns={GROUP_COLUMNS} rows={rows} />)}
    {data.truncated && <p style={styles.muted}>Algunas tablas muestran solo los 200 grupos principales; el resto se agrupa en “otros”.</p>}
    <ul style={{ ...styles.muted, paddingLeft: 18, margin: 0 }}>
      {Object.entries(data.labels || {}).map(([key, label]) => <li key={key}>{label}</li>)}
    </ul>
  </section>;
}

function ScheduleDialog({ onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", kind: "production", frequency: "weekly", enabled: false, notifyCreator: false });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  const dialogRef = useRef(null);
  const requestId = useRef(newRequestId());
  useEffect(() => {
    const previous = document.activeElement;
    nameRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  function keydown(event) {
    if (event.key === "Escape" && !saving) onClose();
    if (event.key !== "Tab") return;
    const items = [...dialogRef.current.querySelectorAll("input, select, button:not([disabled])")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) { setError("Escribe un nombre para la programación."); return; }
    setSaving(true);
    setError("");
    try {
      await saveSchedule({ action: "save", requestId: requestId.current, ...form, name: form.name.trim() });
      onSaved();
    } catch (err) {
      setError(err?.message || "No se pudo guardar la programación.");
      setSaving(false);
    }
  }
  return <div className="ppr-overlay" style={styles.overlay} onKeyDown={keydown}>
    <form ref={dialogRef} className="ppr-dialog" style={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="ppr-schedule-title" onSubmit={submit}>
      <h3 id="ppr-schedule-title" style={{ margin: 0 }}>Programar reporte recurrente</h3>
      <p style={styles.muted}>Se genera con el último periodo completo, en horario de America/Tijuana. No se envían correos: solo se guarda en el archivo y, si lo eliges, se te avisa dentro del sistema.</p>
      <label style={styles.field}>Nombre
        <input ref={nameRef} style={styles.input} value={form.name} maxLength={120} onChange={set("name")} required />
      </label>
      <label style={styles.field}>Tipo de reporte
        <select style={styles.input} value={form.kind} onChange={set("kind")}>
          {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label style={styles.field}>Frecuencia
        <select style={styles.input} value={form.frequency} onChange={set("frequency")}>
          <option value="daily">Diaria (día anterior)</option>
          <option value="weekly">Semanal (lunes a domingo anterior)</option>
          <option value="monthly">Mensual (mes anterior)</option>
        </select>
      </label>
      <label style={styles.check}><input type="checkbox" checked={form.notifyCreator} onChange={set("notifyCreator")} /> Avisarme dentro del sistema cuando esté listo</label>
      <label style={styles.check}><input type="checkbox" checked={form.enabled} onChange={set("enabled")} /> Activar ahora (si no, se guarda apagada)</label>
      {error && <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" style={styles.button} onClick={onClose} disabled={saving}>Cancelar</button>
        <button type="submit" style={styles.primary} disabled={saving}>{saving ? "Guardando…" : "Guardar programación"}</button>
      </div>
    </form>
  </div>;
}

function ScheduleList({ schedules, error }) {
  const [confirming, setConfirming] = useState("");
  const [busy, setBusy] = useState("");
  const [failure, setFailure] = useState("");
  async function deactivate(id) {
    setBusy(id);
    setFailure("");
    try {
      await saveSchedule({ action: "deactivate", requestId: newRequestId(), scheduleId: id });
      setConfirming("");
    } catch (err) {
      setFailure(err?.message || "No se pudo desactivar la programación.");
    } finally {
      setBusy("");
    }
  }
  if (error) return <p role="alert" style={{ color: "#b91c1c" }}>No se pudieron cargar las programaciones. {error}</p>;
  if (schedules.length === 0) return <p style={styles.muted}>Aún no hay programaciones.</p>;
  return <>
    {failure && <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>{failure}</p>}
    <ul className="ppr-list" style={styles.list}>
      {schedules.map((item) => <li key={item.id} style={styles.item}>
        <span>
          <strong>{item.name}</strong> · {KIND_LABELS[item.kind] || item.kind} · {FREQUENCY_LABELS[item.frequency] || item.frequency}
          <br /><span style={styles.muted}>{item.enabled ? "Activa" : "Apagada"}
            {item.lastPeriodKey ? ` · último periodo ${item.lastPeriodKey.replace("_", " a ")}` : ""}
            {item.lastError ? ` · último error: ${item.lastError}` : ""}</span>
        </span>
        {item.enabled && (confirming === item.id
          ? <span style={{ display: "flex", gap: 8 }}>
            <button type="button" style={styles.danger} disabled={busy === item.id} onClick={() => deactivate(item.id)}>Confirmar desactivación</button>
            <button type="button" style={styles.button} onClick={() => setConfirming("")}>Cancelar</button>
          </span>
          : <button type="button" style={styles.button} onClick={() => setConfirming(item.id)} aria-label={`Desactivar ${item.name}`}>Desactivar</button>)}
      </li>)}
    </ul>
  </>;
}

export default function ProductionReportArchive({ isAdmin }) {
  const [reports, setReports] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [scheduleError, setScheduleError] = useState("");
  const [dialog, setDialog] = useState(false);
  const opener = useRef(null);

  const load = useCallback(async (after) => {
    try {
      const snapshot = await getDocs(query(collection(db, "printReports"), orderBy("createdAt", "desc"),
        ...(after ? [startAfter(after)] : []), limit(PAGE_SIZE)));
      setError("");
      const items = snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
      setReports((current) => (after ? [...current, ...items] : items));
      setCursor(snapshot.size === PAGE_SIZE ? snapshot.docs.at(-1) : null);
    } catch (err) {
      setError(err?.message || "No se pudo cargar el archivo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const firstPage = query(collection(db, "printReports"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
    getDocs(firstPage).then((snapshot) => {
      if (!active) return;
      setReports(snapshot.docs.map((item) => ({ ...item.data(), id: item.id })));
      setCursor(snapshot.size === PAGE_SIZE ? snapshot.docs.at(-1) : null);
    }).catch((err) => {
      if (active) setError(err?.message || "No se pudo cargar el archivo.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isAdmin) return undefined;
    return onSnapshot(query(collection(db, "printReportSchedules"), limit(100)),
      (snapshot) => {
        setSchedules(snapshot.docs.map((item) => ({ ...item.data(), id: item.id })));
        setScheduleError("");
      },
      (err) => setScheduleError(err?.message || ""));
  }, [isAdmin]);

  function closeDialog() {
    setDialog(false);
  }

  return <div className="ppr-root" style={styles.root}>
    <section className="ppr-panel" style={styles.panel} aria-labelledby="ppr-archive-title">
      <div style={styles.head}>
        <h2 id="ppr-archive-title" style={{ margin: 0 }}>Archivo de reportes</h2>
        <button type="button" style={styles.button} onClick={() => load(null)} disabled={loading}>Actualizar</button>
      </div>
      <p style={styles.muted}>Cada reporte es una copia fija del periodo: no cambia aunque después se corrijan los trabajos.</p>
      {error && <div role="alert" className="message-box">
        <p>{error}</p><button type="button" style={styles.button} onClick={() => load(null)}>Reintentar</button>
      </div>}
      {loading && reports.length === 0 && <p role="status">Cargando reportes…</p>}
      {!loading && !error && reports.length === 0 && <p style={styles.muted}>Todavía no hay reportes guardados.</p>}
      <ul className="ppr-list" style={styles.list}>
        {reports.map((report) => <li key={report.id} style={styles.item}>
          <span><strong>{KIND_LABELS[report.kind] || report.kind}</strong> · {periodLabel(report)}
            <br /><span style={styles.muted}>{report.source === "schedule" ? "Programado" : "Manual"}
              {report.generatedAtIso ? ` · ${new Date(report.generatedAtIso).toLocaleString("es-MX")}` : ""}</span></span>
          <button type="button" style={styles.button} aria-pressed={selected?.id === report.id} onClick={() => setSelected(report)}>
            {selected?.id === report.id ? "Abierto" : "Abrir periodo"}
          </button>
        </li>)}
      </ul>
      {cursor && <button type="button" style={styles.button} disabled={loading} onClick={() => { setLoading(true); load(cursor); }}>Cargar más</button>}
    </section>
    {selected && <ReportDetail report={selected} onClose={() => setSelected(null)} />}
    {isAdmin && <section className="ppr-panel" style={styles.panel} aria-labelledby="ppr-schedules-title">
      <div style={styles.head}>
        <h2 id="ppr-schedules-title" style={{ margin: 0 }}>Reportes recurrentes</h2>
        <button type="button" ref={opener} style={styles.primary} onClick={() => setDialog(true)}>Programar reporte</button>
      </div>
      <ScheduleList schedules={schedules} error={scheduleError} />
    </section>}
    {dialog && <ScheduleDialog onClose={closeDialog} onSaved={closeDialog} />}
  </div>;
}
