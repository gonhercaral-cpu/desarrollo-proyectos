import { useEffect, useRef, useState } from 'react';
import { supervisionRequest } from '../services/projectSupervisionService';

const DEFAULT_CONFIG = { alertsEnabled: false, automaticNotifications: false, aiEnabled: false, timeZone: 'America/Tijuana', reminderDays: 15, preventiveDays: 7, urgentDays: 3, inactivityBusinessDays: 7, sendHour: 9, sendDays: [1, 2, 3, 4, 5], cooldownHours: 24, reportDaily: false, reportWeekly: false, reportWeekday: 1, reportRecipientIds: [], aiMonthlyRequestLimit: 100, aiMonthlyTokenLimit: 200000, aiMaxInputChars: 12000, aiMaxOutputTokens: 1000, aiModel: '' };
const FILTERS = [['all', 'Todos'], ['attention', 'Requieren atención'], ['pendingEvidence', 'Evidencias pendientes'], ['dueSoon', 'Por vencer'], ['decisions', 'Decisiones pendientes'], ['inactive', 'Inactivos'], ['overdue', 'Vencidos']];
const RISKS = [['', 'Todos los riesgos'], ['bajo', 'Bajo'], ['medio', 'Medio'], ['alto', 'Alto'], ['critico', 'Crítico']];
const SORTS = [['priority', 'Prioridad'], ['deadline', 'Fecha límite'], ['activity', 'Actividad más antigua']];
const PERIODS = [['1', 'Último día'], ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días']];
const METRICS = ['inactive', 'attention', 'pendingEvidence', 'dueSoon', 'decisions', 'overdue'];
const LABELS = { active: 'Activos', completed: 'Completados', attention: 'Atención', pendingEvidence: 'Evidencias pendientes', dueSoon: 'Por vencer', decisions: 'Decisiones', inactive: 'Inactivos', overdue: 'Vencidos', readyForClosure: 'Listos para cierre', partialEvidenceProjects: 'Proyectos con conteo parcial de evidencias' };
const QUESTIONS = [['¿Qué proyectos debo priorizar?', 'Prioridad'], ['¿Qué proyectos están vencidos?', 'Vencidos'], ['¿Qué avances debo revisar?', 'Avances'], ['¿Qué evidencias están pendientes?', 'Evidencias'], ['¿Qué proyectos están listos para cierre?', 'Cierre']];
const NUMS = [['reminderDays', 'Recordatorio (días)'], ['preventiveDays', 'Preventivo (días)'], ['urgentDays', 'Urgente (días)'], ['inactivityBusinessDays', 'Inactividad (días hábiles)'], ['sendHour', 'Hora de envío (0-23)'], ['cooldownHours', 'Enfriamiento (horas)'], ['reportWeekday', 'Día del informe semanal (0=domingo, 6=sábado)'], ['aiMonthlyRequestLimit', 'IA: solicitudes al mes'], ['aiMonthlyTokenLimit', 'IA: tokens al mes'], ['aiMaxInputChars', 'IA: máx. caracteres de entrada'], ['aiMaxOutputTokens', 'IA: máx. tokens de salida']];
const FLAGS = [['alertsEnabled', 'Alertas'], ['automaticNotifications', 'Notificaciones automáticas'], ['aiEnabled', 'Análisis con IA'], ['reportDaily', 'Informe diario'], ['reportWeekly', 'Informe semanal']];
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DECISIONS = { pending: 'pendiente', attended: 'atendido', dismiss: 'descartado', snooze: 'pospuesto' };

const list = (v) => (Array.isArray(v) ? v : []);
const split = (t) => t.split(',').map((x) => x.trim()).filter(Boolean);
const errMsg = (e) => (e && e.message) || 'No se pudo completar la operación.';
const fmt = (v) => {
  if (!v) return 'sin fecha';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-MX', { dateStyle: 'medium' });
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
};
const num = (m, k) => (m && Number.isFinite(m[k]) ? m[k] : '—');
const summaryText = (m, at) => (m
  ? `Hay ${num(m, 'active')} proyectos activos: ${num(m, 'attention')} requieren atención, ${num(m, 'overdue')} están vencidos, ${num(m, 'dueSoon')} vencen pronto, ${num(m, 'pendingEvidence')} evidencias pendientes de revisión humana, ${num(m, 'decisions')} esperan una decisión, ${num(m, 'inactive')} sin actividad reciente y ${num(m, 'readyForClosure')} listos para cierre (${num(m, 'completed')} completados). Calculado: ${fmt(at)}.`
  : 'Aún no hay métricas disponibles.');

function Modal({ open, title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className='supervision-dialog' aria-label={title} onClose={onClose}>
      {open && (
        <div className='supervision-dialog-body'>
          <header className='supervision-dialog-head'>
            <h3>{title}</h3>
            <button type='button' onClick={onClose}>Cerrar</button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}

function Select({ label, value, options, onChange }) {
  return (
    <label className='supervision-field'>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

function Card({ s, checked, canCheck, busy, aiOn, on }) {
  const id = s.projectId;
  const adv = list(s.sources).filter((x) => x.type === 'advance' || x.type === 'comment').slice(0, 3);
  const flags = [s.overdue && 'Vencido', s.dueSoon && 'Por vencer', s.inactive && 'Inactivo', s.pendingEvidence && 'Evidencias pendientes de revisión humana', s.decisionPending && 'Decisión pendiente', s.readyForClosure && 'Listo para cierre'].filter(Boolean);
  return (
    <article className={`supervision-card supervision-risk-${s.risk || 'sin-dato'}`}>
      <header className='supervision-card-head'>
        <input type='checkbox' aria-label={`Seleccionar ${s.title}`} checked={checked} disabled={!s.active || (!checked && !canCheck)} onChange={() => on.check(id)} />
        <h4>{s.title}</h4>
        <span className='supervision-badge'>Riesgo: {s.risk === 'critico' ? 'crítico' : s.risk || 'sin dato'}{Number.isFinite(s.riskScore) ? ` (${s.riskScore})` : ''}</span>
      </header>
      <p className='supervision-meta'>Estado: {s.status || 'sin dato'} · Responsable: {s.assigneeName || 'sin asignar'} · Fecha límite: {s.deadline ? fmt(s.deadline) : 'sin fecha'}{Number.isFinite(s.daysRemaining) ? ` (${s.daysRemaining} días)` : ''}</p>
      <p>Progreso reportado: {Number.isFinite(s.progress) ? `${s.progress}%` : 'sin dato'}. Es un valor declarado; la supervisión no lo ha verificado.</p>
      {flags.length > 0 && <ul className='supervision-flags'>{flags.map((f) => <li key={f}>{f}</li>)}</ul>}
      {list(s.reasons).length > 0
        ? <ul className='supervision-reasons'>{list(s.reasons).map((r, i) => <li key={`${r.code}-${i}`}>{r.message}</li>)}</ul>
        : <p>Sin motivos de riesgo informados.</p>}
      {Number.isFinite(s.pendingDeliverables) && <p>Entregables, actividades o hitos pendientes: {s.pendingDeliverables}</p>}<h5>Últimos avances y comentarios</h5>
      {adv.length > 0
        ? <ul className='supervision-advances'>{adv.map((a) => <li key={a.id}>{a.text} <small>{fmt(a.at)} · {a.type === 'evidence' ? 'solo metadatos; archivo no leído' : 'texto registrado'}</small></li>)}</ul>
        : <p>Sin avances ni comentarios registrados.</p>}
      {list(s.missingInformation).length > 0 && <p>Información faltante: {list(s.missingInformation).join('; ')}</p>}
      {s.decisionState && <p>Decisión registrada: {DECISIONS[s.decisionState] || s.decisionState}{s.snoozeUntil ? ` hasta ${fmt(s.snoozeUntil)}` : ''}</p>}
      {s.suggestedMessage && <details><summary>Mensaje sugerido</summary><p>{s.suggestedMessage}</p></details>}
      <div className='supervision-actions'>
        <button type='button' onClick={() => on.detail(id)}>Detalle</button>
        <button type='button' disabled={!aiOn || busy} title={aiOn ? undefined : 'La IA no está disponible'} onClick={() => on.analyze(id)}>Analizar</button>
        <button type='button' disabled={busy} title='Solo marca avances como revisados; no aprueba evidencias' onClick={() => on.review(s)}>Marcar avances revisados</button>
        <button type='button' disabled={!s.active || busy} onClick={() => on.prepare([id], s.suggestedMessage || '')}>Preparar mensaje</button>
        <button type='button' disabled={!s.active || busy} onClick={() => on.prepare([id], `Por favor, comparte información verificable sobre los pendientes y el siguiente compromiso de entrega del proyecto «${s.title}».`)}>Solicitar información</button>
        <button type='button' disabled={!s.active || busy} onClick={() => on.prepare([id], `Solicito revisar y corregir los puntos señalados en el proyecto «${s.title}». Por favor, confirma los ajustes realizados y adjunta las evidencias correspondientes.`)}>Solicitar corrección</button>
        <button type='button' onClick={() => on.open(id)}>Ver proyecto</button>
        <button type='button' disabled={busy} onClick={() => on.decide(s, 'attended')}>Atendido</button>
        <button type='button' disabled={busy} onClick={() => on.decide(s, 'snooze')}>Posponer 7 días</button>
        <button type='button' disabled={busy} onClick={() => on.decide(s, 'dismiss')}>Descartar</button>
      </div>
    </article>
  );
}

function Analysis({ a }) {
  return (
    <div className='supervision-analysis'>
      {[['facts', 'Hechos'], ['inferences', 'Inferencias'], ['recommendations', 'Recomendaciones']].map(([k, t]) => (
        <section key={k}>
          <h5>{t}</h5>
          {list(a[k]).length === 0 ? <p>Sin elementos.</p> : (
            <ul>{list(a[k]).map((x, i) => <li key={i}>{x.text} <small>Fuentes: {list(x.sourceIds).join(', ') || 'ninguna citada'}</small></li>)}</ul>
          )}
        </section>
      ))}
      <p><small>Modelo: {a.model || 'no informado'} · Generado: {fmt(a.generatedAt)}. Puede contener errores; contraste con las fuentes.</small></p>
    </div>
  );
}

function ProjectRules({ projectId, overrides = {}, onSaved }) {
  const [values, setValues] = useState(overrides);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const keys = [['reminderDays', 'Recordatorio (días)'], ['preventiveDays', 'Preventivo (días)'], ['urgentDays', 'Urgente (días)'], ['inactivityBusinessDays', 'Inactividad (días laborables)']];
  async function save(e) {
    e.preventDefault(); setSaving(true); setStatus('');
    const next = { ...overrides };
    for (const [key] of keys) { if (values[key] === '' || values[key] === undefined) delete next[key]; else next[key] = Number(values[key]); }
    if (values.timeZone) next.timeZone = values.timeZone; else delete next.timeZone;
    try { await supervisionRequest('configureProject', { projectId, overrides: next }); setStatus('Reglas particulares guardadas.'); onSaved(); }
    catch (error) { setStatus(errMsg(error)); }
    finally { setSaving(false); }
  }
  return <details><summary>Reglas particulares del proyecto</summary><p>Los campos vacíos utilizan la configuración global. Los calendarios particulares conservan sus días laborables y feriados.</p><form onSubmit={save} className='supervision-config-form'>
    {keys.map(([key, label]) => <label key={key}>{label}<input type='number' value={values[key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} /></label>)}
    <label>Zona horaria particular<input value={values.timeZone || ''} onChange={(e) => setValues((v) => ({ ...v, timeZone: e.target.value }))} /></label>
    <p role='status'>{status}</p><button type='submit' disabled={saving}>Guardar reglas del proyecto</button>
  </form></details>;
}

function Detail({ res, loading, aiOn, busy, onAnalyze, onOpen, onReload }) {
  if (loading) return <p role='status'>Cargando detalle…</p>;
  if (!res) return null;
  if (res.error) return <p role='alert' className='supervision-error'>{res.error}</p>;
  const { summary: s, analysis, history, lastReviewedAt } = res.data || {};
  if (!s) return <p>El servidor no devolvió datos del proyecto.</p>;
  return (
    <div className='supervision-detail'>
      <p><strong>{s.title}</strong> · Última revisión de avances: {lastReviewedAt ? fmt(lastReviewedAt) : 'nunca'}</p>
      <div className='supervision-actions'>
        <button type='button' onClick={() => onOpen(s.projectId)}>Ver proyecto</button>
        <button type='button' disabled={!aiOn || busy} onClick={() => onAnalyze(s.projectId)}>Analizar con IA</button>
      </div>
      <h4>Fuentes</h4>
      {list(s.sources).length === 0 ? <p>Sin fuentes registradas.</p> : (
        <ul>{list(s.sources).map((x) => <li key={x.id}><code>{x.id}</code> · {x.type}: {x.text} <small>{fmt(x.at)} · {x.type === 'evidence' ? 'solo metadatos; archivo no leído' : 'texto o datos registrados'}</small></li>)}</ul>
      )}
      <h4>Análisis de IA</h4>
      {analysis ? <Analysis a={analysis} /> : <p>Aún no hay un análisis guardado para este proyecto.</p>}
      <ProjectRules key={s.projectId + JSON.stringify(res.data.overrides || {})} projectId={s.projectId} overrides={res.data.overrides} onSaved={onReload} />
      <h4>Historial</h4>
      {list(history).length === 0 ? <p>Sin historial.</p> : (
        <ul>{list(history).map((h) => <li key={h.id}>{fmt(h.createdAt)} · {h.actorName || 'sistema'} · {h.action}{h.message ? `: ${h.message}` : ''}</li>)}</ul>
      )}
    </div>
  );
}

function Prep({ prep, titles, onChange, onPrepare, onSend }) {
  const { draft, result } = prep;
  if (!draft) {
    return (
      <div>
        <p>Proyectos seleccionados ({prep.ids.length}/10):</p>
        <ul>{prep.ids.map((id) => <li key={id}>{titles[id] || id}</li>)}</ul>
        <label className='supervision-field'>Mensaje (opcional; si queda vacío se usa el mensaje del servidor)
          <textarea maxLength={600} rows={4} value={prep.message} onChange={(e) => onChange({ message: e.target.value })} />
        </label>
        {prep.error && <p role='alert' className='supervision-error'>{prep.error}</p>}
        <button type='button' disabled={prep.busy || prep.ids.length === 0} onClick={onPrepare}>{prep.busy ? 'Preparando…' : 'Preparar vista previa'}</button>
      </div>
    );
  }
  return (
    <div>
      <p>Vista previa no editable. El borrador vence: {fmt(draft.expiresAt)}.</p>
      {list(draft.items).map((it) => (
        <section key={it.projectId} className='supervision-preview'>
          <h4>{it.title}</h4>
          <p>Destinatarios: {list(it.recipients).map((r) => r.name || r.uid).join(', ') || 'ninguno'}</p>
          <p className='supervision-message'>{it.message}</p>
        </section>
      ))}
      {result ? <p role='status'>Enviados: {result.sent ?? 0}. Operación ya procesada: {result.alreadySent ? 'sí' : 'no'}.</p> : (
        <>
          <label className='supervision-field'>
            <input type='checkbox' checked={prep.confirmed} onChange={(e) => onChange({ confirmed: e.target.checked })} /> Revisé destinatarios y mensajes y autorizo el envío.
          </label>
          {prep.error && <p role='alert' className='supervision-error'>{prep.error}</p>}
          <div className='supervision-actions'>
            <button type='button' disabled={prep.busy} onClick={() => onChange({ draft: null, confirmed: false })}>Volver a editar</button>
            <button type='button' disabled={!prep.confirmed || prep.busy} onClick={onSend}>{prep.busy ? 'Enviando…' : 'Enviar'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function Report({ r }) {
  return (
    <div className='supervision-report'>
      <h4>Informe de {r.periodDays} día(s) · {fmt(r.generatedAt)}</h4>
      <p>{r.summary}</p><p>{r.scope}</p>{r.partial && <p>Informe parcial: se alcanzó el límite de registros.</p>}
      {r.metrics && <ul>{Object.entries(r.metrics).map(([k, v]) => <li key={k}>{LABELS[k] || k}: {String(v)}</li>)}</ul>}
      {list(r.recentActivity).length > 0 && <details><summary>Avances del periodo</summary><ul>{r.recentActivity.map((a, i) => <li key={i}>{a.title}: {a.text} · {fmt(a.createdAt)}</li>)}</ul></details>}
      {list(r.projects).length === 0 ? <p>El informe no incluye proyectos.</p> : (
        <ul>{list(r.projects).map((p) => <li key={p.projectId}>{p.title} · riesgo {p.risk || 'sin dato'} · límite {p.deadline ? fmt(p.deadline) : 'sin fecha'} · evidencias pendientes: {String(p.pendingEvidence)}</li>)}</ul>
      )}
    </div>
  );
}

function ConfigForm({ config, busy, onSave, people }) {
  const [c, setC] = useState(() => ({ ...DEFAULT_CONFIG, ...config }));
  const [ids, setIds] = useState(() => list(config.reportRecipientIds).join(', '));
  const [hol, setHol] = useState(() => list(config.holidays).join(', '));
  const [err, setErr] = useState('');
  const set = (k, v) => setC((p) => ({ ...p, [k]: v }));
  const toggleDay = (d) => setC((p) => {
    const cur = list(p.sendDays);
    return { ...p, sendDays: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort() };
  });
  const save = (e) => {
    e.preventDefault();
    const out = { ...c, reportRecipientIds: split(ids) };
    for (const [k, l] of NUMS) {
      const v = Number(c[k]);
      if (String(c[k]).trim() === '' || !Number.isFinite(v)) { setErr(`Valor numérico inválido: ${l}`); return; }
      out[k] = v;
    }
    if (hol.trim() || config.holidays) out.holidays = split(hol);
    const turnsOn = (k) => c[k] && !config[k];
    if ((turnsOn('automaticNotifications') || turnsOn('aiEnabled')) && !window.confirm('Va a habilitar envío automático y/o IA. Solo tendrá efecto si el servidor también lo tiene habilitado y puede generar notificaciones o costos. ¿Confirmar?')) return;
    setErr('');
    onSave(out);
  };
  return (
    <form className='supervision-config-form' onSubmit={save}>
      <p className='supervision-hint'>Las opciones guardadas se aplican al motor. El envío automático y la IA requieren además habilitación autorizada en el servidor.</p>
      {FLAGS.map(([k, l]) => (
        <label key={k} className='supervision-field'><input type='checkbox' checked={!!c[k]} onChange={(e) => set(k, e.target.checked)} /> {l}</label>
      ))}
      {NUMS.map(([k, l]) => (
        <label key={k} className='supervision-field'>{l}<input type='number' value={c[k]} onChange={(e) => set(k, e.target.value)} /></label>
      ))}
      <label className='supervision-field'>Zona horaria<input value={c.timeZone} onChange={(e) => set('timeZone', e.target.value)} /></label>
      <label className='supervision-field'>Modelo de IA<input value={c.aiModel} onChange={(e) => set('aiModel', e.target.value)} /></label>
      <fieldset className='supervision-field'>
        <legend>Días de envío</legend>
        {DAYS.map((d, i) => <label key={d}><input type='checkbox' checked={list(c.sendDays).includes(i)} onChange={() => toggleDay(i)} /> {d}</label>)}
      </fieldset>
      <fieldset><legend>Días laborables</legend>{DAYS.map((d, i) => <label key={d}><input type='checkbox' checked={list(c.workDays).includes(i)} onChange={() => set('workDays', list(c.workDays).includes(i) ? c.workDays.filter((x) => x !== i) : [...list(c.workDays), i].sort())} /> {d}</label>)}</fieldset>
      <fieldset><legend>Destinatarios autorizados de informes</legend>
        {people.filter((p) => p.isAdmin).map((p) => <label key={p.uid}><input type='checkbox' checked={split(ids).includes(p.uid)} onChange={(e) => setIds((old) => (e.target.checked ? [...split(old), p.uid] : split(old).filter((id) => id !== p.uid)).join(', '))} /> {p.name}</label>)}
      </fieldset>
      <label className='supervision-field'>Feriados opcionales (AAAA-MM-DD separados por coma)
        <input value={hol} onChange={(e) => setHol(e.target.value)} />
      </label>
      {err && <p role='alert' className='supervision-error'>{err}</p>}
      <button type='submit' disabled={busy}>Guardar configuración</button>
    </form>
  );
}

export default function ProjectSupervision({ onOpenProject }) {
  const [form, setForm] = useState({ filter: 'all', risk: '', status: '', assigneeUid: '', sort: 'priority' });
  const [applied, setApplied] = useState(form);
  const [reloadN, setReloadN] = useState(0);
  const [data, setData] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moreBusy, setMoreBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ text: '' });
  const [refr, setRefr] = useState(null);
  const [dReq, setDReq] = useState(null);
  const [dRes, setDRes] = useState(null);
  const [prep, setPrep] = useState(null);
  const [ask, setAsk] = useState({ busy: false, res: null, error: '' });
  const [question, setQuestion] = useState('');
  const [questionProjectId, setQuestionProjectId] = useState('');
  const [period, setPeriod] = useState('7');
  const [report, setReport] = useState(null);
  const [executive, setExecutive] = useState(null);
  const [saved, setSaved] = useState([]);
  const [people, setPeople] = useState([]);
  const qTok = useRef(0);
  const askSeq = useRef(0);

  useEffect(() => {
    let off = false;
    supervisionRequest('people').then((r) => { if (!off) setPeople(list(r.items)); }).catch(() => {});
    return () => { off = true; };
  }, []);

  useEffect(() => {
    let off = false;
    supervisionRequest('overview', { ...applied, cursor: null })
      .then((r) => { if (off) return; setData(r); setItems(list(r.items)); setError(''); setLoading(false); })
      .catch((e) => { if (off) return; setItems([]); setError(errMsg(e)); setLoading(false); });
    return () => { off = true; };
  }, [applied, reloadN]);

  useEffect(() => {
    if (!dReq) return undefined;
    let off = false;
    supervisionRequest('detail', { projectId: dReq.id })
      .then((d) => { if (!off) setDRes({ req: dReq, data: d }); })
      .catch((e) => { if (!off) setDRes({ req: dReq, error: errMsg(e) }); });
    return () => { off = true; };
  }, [dReq]);

  const reload = () => { qTok.current += 1; setLoading(true); setReloadN((n) => n + 1); };
  const applyForm = (next) => { qTok.current += 1; setLoading(true); setSelected([]); setApplied({ ...next }); };
  const quick = (k) => { const next = { ...form, filter: k === 'active' ? 'all' : k }; setForm(next); applyForm(next); };
  const patchForm = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 10 ? [...s, id] : s));
  const openProject = (id) => { if (onOpenProject) onOpenProject(id); };

  const run = async (op, payload, ok) => {
    setBusy(true);
    setNotice({ text: 'Procesando…' });
    try {
      const r = await supervisionRequest(op, payload);
      setNotice({ text: typeof ok === 'function' ? ok(r) : ok });
      return r;
    } catch (e) {
      setNotice({ text: errMsg(e), error: true });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    if (!data || !data.nextCursor) return;
    const tok = qTok.current;
    setMoreBusy(true);
    try {
      const r = await supervisionRequest('overview', { ...applied, cursor: data.nextCursor });
      if (tok === qTok.current) {
        setItems((p) => [...p, ...list(r.items).filter((x) => !p.some((y) => y.projectId === x.projectId))]);
        setData((d) => ({ ...d, nextCursor: r.nextCursor, metrics: r.metrics || d.metrics, computedAt: r.computedAt || d.computedAt }));
      }
    } catch (e) {
      if (tok === qTok.current) setNotice({ text: errMsg(e), error: true });
    } finally {
      setMoreBusy(false);
    }
  };

  const refresh = async (cursor) => {
    const r = await run('refresh', cursor ? { cursor } : {}, (x) => `Lote procesado: ${x.processed ?? 0} proyectos.${x.nextCursor ? ' Indexación parcial: aún quedan proyectos por procesar.' : ' Indexación completa.'}`);
    if (!r) return;
    setRefr(r);
    if (!r.nextCursor) reload();
  };

  const review = async (s) => {
    if (await run('review', { projectId: s.projectId, version: s.version }, 'Avances marcados como revisados. Las evidencias no se aprobaron.')) reload();
  };
  const decide = async (s, action) => {
    const label = { attended: 'marcar como atendido', dismiss: 'descartar', snooze: 'posponer 7 días' }[action];
    if (!window.confirm(`¿Confirma ${label}: ${s.title}?`)) return;
    const payload = { projectId: s.projectId, version: s.version, action };
    if (action === 'snooze') payload.snoozeUntil = new Date(Date.now() + 7 * 864e5).toISOString();
    if (await run('decision', payload, 'Decisión registrada.')) reload();
  };
  const analyze = async (id) => {
    const r = await run('analyze', { projectId: id }, (x) => `Análisis: ${x.status || 'sin estado'}${x.message ? ` — ${x.message}` : ''}`);
    if (r) setDReq({ id, n: dReq && dReq.id === id ? dReq.n + 1 : 0 });
  };

  const openPrep = (ids, msg) => setPrep({ ids: list(ids).slice(0, 10), message: msg || '', draft: null, busy: false, error: '', confirmed: false, result: null });
  const patchPrep = (p) => setPrep((c) => (c ? { ...c, ...p } : c));
  const doPrepare = async () => {
    const msg = prep.message.trim();
    patchPrep({ busy: true, error: '' });
    try {
      const draft = await supervisionRequest('prepare', { projectIds: prep.ids, ...(msg ? { message: msg } : {}) });
      patchPrep({ draft, busy: false, confirmed: false });
    } catch (e) {
      patchPrep({ busy: false, error: errMsg(e) });
    }
  };
  const doSend = async () => {
    if (!prep || !prep.draft || !prep.confirmed) return;
    patchPrep({ busy: true, error: '' });
    try {
      const result = await supervisionRequest('send', { draftId: prep.draft.draftId, confirmed: true });
      patchPrep({ busy: false, result });
    } catch (e) {
      patchPrep({ busy: false, error: errMsg(e) });
    }
  };

  const askNow = async (text) => {
    const q = text.trim();
    if (!q) return;
    askSeq.current += 1;
    const id = askSeq.current;
    setAsk({ busy: true, res: null, error: '' });
    try {
      const res = await supervisionRequest('assistant', { question: q, ...(questionProjectId ? { projectId: questionProjectId } : {}) });
      if (id === askSeq.current) setAsk({ busy: false, res, error: '' });
    } catch (e) {
      if (id === askSeq.current) setAsk({ busy: false, res: null, error: errMsg(e) });
    }
  };

  const generateExecutive = async () => {
    const result = await run('assistant', { question: 'Resume los avances durante la última semana' }, 'Resumen ejecutivo actualizado.');
    if (result) setExecutive(result);
  };
  const genReport = async () => {
    const r = await run('report', { periodDays: Number(period) }, 'Informe generado.');
    if (r) setReport(r);
  };
  const loadSaved = async () => {
    const r = await run('reports', {}, (x) => `${list(x.items).length} informes guardados.${x.nextCursor ? ' Hay más informes no cargados.' : ''}`);
    if (r) setSaved(list(r.items));
  };
  const saveConfig = async (cfg) => {
    const r = await run('configure', { config: cfg }, 'Configuración guardada. La disponibilidad de IA y envíos se verifica en el servidor.');
    if (r && r.config) { setData((d) => ({ ...d, config: r.config })); reload(); }
  };

  const q = search.trim().toLowerCase();
  const shown = q
    ? items.filter((s) => [s.title, s.assigneeName, s.status, ...list(s.reasons).map((r) => r.message)].join(' ').toLowerCase().includes(q))
    : items;
  const titles = Object.fromEntries(items.map((s) => [s.projectId, s.title]));
  const aiOn = !!(data && data.aiAvailable);
  const cfg = data && data.config;
  const alerts = items.filter((s) => s.overdue || s.dueSoon || s.inactive).slice(0, 5);
  const dLoading = !!dReq && (!dRes || dRes.req !== dReq);
  const on = { check: toggle, detail: (id) => setDReq({ id, n: 0 }), analyze, review, decide, prepare: openPrep, open: openProject };

  return (
    <section className='supervision supervision-page' aria-labelledby='supervision-title'>
      <header className='supervision-header'>
        <div>
          <h2 id='supervision-title'>Supervisión inteligente</h2>
          <p>Riesgo de proyectos calculado con metadatos y avances reportados. Toda decisión la toma una persona.</p>
        </div>
        <div className='supervision-header-actions'>
          <button type='button' onClick={reload} disabled={loading}>Recargar</button>
          <button type='button' onClick={() => refresh()} disabled={busy}>Actualizar índice</button>
        </div>
      </header>

      <div className={`supervision-live${notice.error ? ' supervision-error' : ''}`} role='status' aria-live='polite'>{notice.text}</div>
      {refr && refr.nextCursor && (
        <p className='supervision-hint'>Indexación parcial ({refr.processed ?? 0} procesados en el último lote). <button type='button' disabled={busy} onClick={() => refresh(refr.nextCursor)}>Continuar indexación</button></p>
      )}
      {data && data.initializing && <p className='supervision-hint'>La supervisión se está inicializando; los datos pueden estar incompletos.</p>}
      {error && <p role='alert' className='supervision-error'>{error}</p>}

      <div className='supervision-metrics'>
        {METRICS.map((k) => (
          <button key={k} type='button' className='supervision-metric' onClick={() => quick(k)}>
            <span>{LABELS[k]}</span>
            <strong>{k === 'pendingEvidence' && data?.metrics?.partialEvidenceProjects > 0 ? '≥ ' : ''}{num(data && data.metrics, k)}</strong>
          </button>
        ))}
      </div>

      <section className='supervision-panel supervision-summary'>
        <h3>Resumen ejecutivo</h3><button type='button' disabled={busy} onClick={generateExecutive}>Resumir actividad de la semana</button>
        {executive && <div><p className='supervision-message'>{executive.answer}</p><p>{executive.aiUsed ? 'Síntesis asistida por IA; revisa las fuentes.' : 'Resumen estructurado sin IA.'}</p><div className='supervision-actions'>{list(executive.sources).map((source) => <button type='button' key={source.projectId} onClick={() => openProject(source.projectId)}>{source.title}</button>)}</div></div>}
<p className='supervision-muted'>Indicadores calculados por reglas. Abre el detalle de cada proyecto para consultar sus fuentes y el análisis de IA disponible.</p>
        <p>{summaryText(data && data.metrics, data && data.computedAt)}</p>{data?.metrics?.partialEvidenceProjects > 0 && <p>El conteo de evidencias es un mínimo conocido: algunos proyectos tienen información heredada fuera de la muestra. Abre su detalle antes de decidir.</p>}
        {data && !aiOn && <p className='supervision-hint'>El análisis con IA no está disponible actualmente.</p>}
      </section>

      <div className='supervision-layout'>
        <div className='supervision-main'>
          <section className='supervision-panel'>
            <h3>Proyectos prioritarios</h3>
            <form className='supervision-filters' onSubmit={(e) => { e.preventDefault(); applyForm(form); }}>
              <Select label='Filtro' value={form.filter} options={FILTERS} onChange={(v) => patchForm('filter', v)} />
              <Select label='Riesgo' value={form.risk} options={RISKS} onChange={(v) => patchForm('risk', v)} />
              <Select label='Orden' value={form.sort} options={SORTS} onChange={(v) => patchForm('sort', v)} />
              <label className='supervision-field'>Estado<input value={form.status} onChange={(e) => patchForm('status', e.target.value)} /></label>
              <Select label='Responsable' value={form.assigneeUid} options={[['', 'Todos'], ...people.map((p) => [p.uid, p.name])]} onChange={(v) => patchForm('assigneeUid', v)} />
              <button type='submit' disabled={loading}>Aplicar</button>
            </form>
            <label className='supervision-field'>Buscar solo en los proyectos cargados en esta página
              <input type='search' value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
            {selected.length > 0 && (
              <div className='supervision-selection'>
                <span>{selected.length} seleccionados (máximo 10)</span>
                <button type='button' onClick={() => openPrep(selected)}>Preparar aviso</button>
                <button type='button' onClick={() => setSelected([])}>Limpiar</button>
              </div>
            )}
            {loading ? <p role='status'>Cargando proyectos…</p> : shown.length === 0 ? (
              <p className='supervision-empty'>{items.length ? 'Ningún proyecto cargado coincide con la búsqueda.' : error ? 'No se pudieron cargar los proyectos.' : 'No hay proyectos para los filtros seleccionados.'}</p>
            ) : shown.map((s) => (
              <Card key={s.projectId} s={s} checked={selected.includes(s.projectId)} canCheck={selected.length < 10} busy={busy} aiOn={aiOn} on={on} />
            ))}
            {data && data.nextCursor && !loading && (
              <button type='button' onClick={loadMore} disabled={moreBusy}>{moreBusy ? 'Cargando…' : 'Cargar más'}</button>
            )}
          </section>
        </div>

        <aside className='supervision-aside'>
          <section className='supervision-panel'>
            <h3>Asistente</h3>
            <div className='supervision-chips'>
              {QUESTIONS.map(([text, label]) => (
                <button key={label} type='button' disabled={ask.busy} onClick={() => { setQuestion(text); askNow(text); }}>{label}</button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); askNow(question); }}>
              <Select label='Contexto del asistente' value={questionProjectId} options={[["", "Todos los proyectos"], ...items.map((p) => [p.projectId, p.title])]} onChange={setQuestionProjectId} /><label className='supervision-field'>Pregunta
                <textarea maxLength={500} rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
              </label>
              <button type='submit' disabled={ask.busy || !question.trim()}>Preguntar</button>
            </form>
            <div aria-live='polite'>
              {ask.busy && <p>Consultando…</p>}
              {ask.error && <p role='alert' className='supervision-error'>{ask.error}</p>}
              {ask.res && (
                <div className='supervision-answer'>
                  <p className='supervision-message'>{ask.res.answer}</p>
                  <p><small>{ask.res.aiUsed ? 'Respuesta generada con IA.' : 'Respuesta sin IA.'}</small></p>
                  {list(ask.res.sources).length > 0 && (
                    <ul>{list(ask.res.sources).map((x) => <li key={x.projectId}>{x.title || x.projectId} <button type='button' onClick={() => openProject(x.projectId)}>Ver proyecto</button></li>)}</ul>
                  )}
                  {list(ask.res.draftProjectIds).length > 0 && (
                    <button type='button' onClick={() => openPrep(ask.res.draftProjectIds)}>Preparar aviso ({Math.min(10, list(ask.res.draftProjectIds).length)})</button>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className='supervision-panel'>
            <h3>Alertas de los proyectos cargados</h3>
            <p>Alertas: {cfg ? (cfg.alertsEnabled ? 'habilitadas' : 'deshabilitadas') : 'sin dato'} · Notificaciones automáticas: {cfg ? (cfg.automaticNotifications ? 'habilitadas' : 'deshabilitadas') : 'sin dato'}</p>
            {alerts.length === 0 ? <p>No hay alertas en los proyectos cargados.</p> : (
              <ul>{alerts.map((s) => <li key={s.projectId}>{s.title}: {[s.overdue && 'vencido', s.dueSoon && 'por vencer', s.inactive && 'inactivo'].filter(Boolean).join(', ')}</li>)}</ul>
            )}
          </section>

          <details className='supervision-panel supervision-config'>
            <summary>Configuración</summary>
            {cfg ? <ConfigForm key={JSON.stringify(cfg)} config={cfg} busy={busy} onSave={saveConfig} people={people} /> : <p>La configuración aún no está disponible.</p>}
          </details>

          <section className='supervision-panel'>
            <h3>Reportes</h3>
            <Select label='Periodo' value={period} options={PERIODS} onChange={setPeriod} />
            <div className='supervision-actions'>
              <button type='button' disabled={busy} onClick={genReport}>Generar informe</button>
              <button type='button' disabled={busy} onClick={loadSaved}>Informes guardados</button>
            </div>
            {saved.length > 0 && (
              <ul>{saved.map((r) => <li key={r.id}><button type='button' onClick={() => setReport(r)}>{fmt(r.generatedAt)} · {r.periodDays} día(s)</button></li>)}</ul>
            )}
            {report ? <Report r={report} /> : <p>Aún no se ha generado ni abierto un informe.</p>}
          </section>
        </aside>
      </div>

      <Modal open={!!dReq} title='Detalle del proyecto' onClose={() => setDReq(null)}>
        <Detail res={dRes && dRes.req === dReq ? dRes : null} loading={dLoading} aiOn={aiOn} busy={busy} onAnalyze={analyze} onOpen={openProject} onReload={() => { setDReq((d) => ({ ...d, n: d.n + 1 })); reload(); }} />
      </Modal>
      <Modal open={!!prep} title='Aviso a responsables' onClose={() => setPrep(null)}>
        {prep && <Prep prep={prep} titles={titles} onChange={patchPrep} onPrepare={doPrepare} onSend={doSend} />}
      </Modal>
    </section>
  );
}
