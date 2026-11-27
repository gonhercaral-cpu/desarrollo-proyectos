import { useEffect, useMemo, useRef, useState } from 'react';
import { loadHistory, generateReport } from './service.js';
import { Icon, Metric, Empty, Button } from './UI.jsx';
import { TYPES, millis, errorText, kindFor } from './model.js';
import { exportReportCSV, exportReportPDF, exportReportXLSX } from './reportExport.js';
import './Analytics.css';

const MAX_PAGES = 25;
const MAX_JOBS = 5000;
const FALLBACK_TYPES = {
  book: 'Libro', certificate: 'Certificado', credential: 'Credencial', flyer: 'Volante',
  brochure: 'Folleto', trifold: 'Tríptico', worksheet: 'Hoja de trabajo',
  teaching: 'Material didáctico', advertising: 'Publicidad', form: 'Formato', other: 'Otro',
};
const PALETTE = ['#0f294a', '#1d4ed8', '#0284c7', '#0d9488', '#4f46e5', '#d97706', '#dc2626', '#64748b'];
const PRESETS = [
  { id: '7d', label: '7 días', days: 7 },
  { id: '30d', label: '30 días', days: 30 },
  { id: '90d', label: '90 días', days: 90 },
  { id: 'month', label: 'Este mes' },
  { id: 'year', label: 'Este año' },
];
const REPORTS = [
  { id: 'monthly', label: 'Producción mensual', icon: 'calendar', desc: 'Resumen por mes de trabajos y calidad' },
  { id: 'books', label: 'Libros', icon: 'book', desc: 'Tirajes, aceptados y páginas verificadas' },
  { id: 'certificates', label: 'Certificados', icon: 'award', desc: 'Únicos por ID y emitidos por fecha' },
  { id: 'credentials', label: 'Credenciales', icon: 'credit-card', desc: 'Producción y reposiciones de credenciales' },
  { id: 'inventory', label: 'Inventario generado', icon: 'package', desc: 'Ejemplares inventariados por producto' },
  { id: 'incidents', label: 'Incidencias / Reimpresión', icon: 'alert-triangle', desc: 'Reimpresiones y rechazos de calidad' },
  { id: 'operator', label: 'Por operador', icon: 'users', desc: 'Actividad y calidad por responsable' },
  { id: 'costs', label: 'Costos e insumos', icon: 'dollar-sign', desc: 'Costos y consumibles verificados', requiresCosts: true },
];

const pad2 = (n) => String(n).padStart(2, '0');
const toIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startMs = (iso) => new Date(`${iso}T00:00:00.000`).getTime();
const endMs = (iso) => new Date(`${iso}T23:59:59.999`).getTime();
const fmtNum = (n) => (n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('es-MX').format(Math.round(n)));
const fmtCur = (n) => (n == null || !Number.isFinite(n) ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const toMs = (v) => { const m = millis?.(v); return Number.isFinite(m) && m > 0 ? m : 0; };
const numOrNull = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function typeLabel(id) {
  const raw = TYPES instanceof Map ? TYPES.get(id) : TYPES?.[id];
  if (typeof raw === 'string') return raw;
  return raw?.label || FALLBACK_TYPES[id] || id || 'Otro';
}

function resolveType(job) {
  if (job?.type && (FALLBACK_TYPES[job.type] || (TYPES instanceof Map ? TYPES.has(job.type) : TYPES?.[job.type]))) return job.type;
  const k=kindFor(job); if(k)return k;
  return job?.type || 'other';
}

function getPresetDates(preset) {
  const now = new Date();
  const to = toIso(now);
  if (preset === 'month') return { from: toIso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  if (preset === 'year') return { from: toIso(new Date(now.getFullYear(), 0, 1)), to };
  const days = PRESETS.find((p) => p.id === preset)?.days || 30;
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { from: toIso(start), to };
}

function deltaBadge(curr, prev) {
  if (curr == null || prev == null) return { text: 'Sin base comparable', tone: 'neutral' };
  if (prev === 0) return curr === 0 ? { text: '0% vs periodo ant.', tone: 'neutral' } : { text: 'Nuevo vs periodo ant.', tone: 'up' };
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  const sign = pct > 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(1)}% vs periodo ant.`, tone: pct > 0 ? 'up' : pct < 0 ? 'down' : 'neutral' };
}

function verifiedPhysical(job) {
  const confirmed=(job.parts||[]).filter(p=>p.status==="completed"&&["printed","partial"].includes(p.reconcile?.outcome));
  if(!confirmed.length)return {sides:null,sheets:null};
  let sides=0, sheets=0;
  for(const part of confirmed){
    const pages=part.to-part.from+1, nUp=Number(job.config?.pagesPerSheet)||1;
    const faces=Math.ceil(pages/nUp);
    sides+=faces*part.copies;
    sheets+=Math.ceil(faces/(job.config?.duplex?2:1))*part.copies;
  }
  return {sides,sheets};
}

function extractCosts(job) {
  const direct = [job.totalCost, job.cost, job.costs?.total].map(numOrNull).find((v) => v != null);
  const unit = numOrNull(job.unitCost);
  const acc = numOrNull(job.accepted);
  const cost = direct != null ? direct : (unit != null && acc != null ? unit * acc : null);
  const raw = job.supplies || job.consumables || job.materials;
  const items = [];
  if (Array.isArray(raw)) {
    for (const s of raw) {
      const q = numOrNull(s?.quantity ?? s?.qty ?? s?.amount);
      if (q != null && q > 0) items.push(`${s.name || s.label || 'Insumo'}: ${q}${s.unit ? ` ${s.unit}` : ''}`);
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) {
      const q = numOrNull(v);
      if (q != null && q > 0) items.push(`${k}: ${q}`);
    }
  }
  return { cost, suppliesText: items.join('; '), hasSupplies: items.length > 0 };
}

async function fetchPeriod(fromMs, toMs, isCurrent) {
  const seen = new Map();
  let cursor = null, pages = 0, truncated = false, truncReason = '';
  const fromDate = new Date(fromMs), toDate = new Date(toMs+1);
  while (pages < MAX_PAGES && seen.size < MAX_JOBS) {
    const res = await loadHistory({ cursor, from: fromDate, to: toDate, pageSize:250 });
    if (!isCurrent()) return { cancelled: true };
    const batch = Array.isArray(res?.jobs) ? res.jobs : [];
    for (const j of batch) {
      if (j?.id && !seen.has(j.id)) seen.set(j.id, j);
    }
    pages += 1;
    const next = res?.cursor ?? null;
    if (!next || batch.length === 0 || next === cursor) { cursor = null; break; }
    cursor = next;
  }
  if (cursor) {
    truncated = true;
    truncReason = seen.size >= MAX_JOBS
      ? `Límite de ${fmtNum(MAX_JOBS)} trabajos alcanzado; existen registros adicionales sin cargar.`
      : `Límite de ${MAX_PAGES} páginas de historial alcanzado; existen registros adicionales sin cargar.`;
  }
  return { cancelled: false, jobs: [...seen.values()], truncated, truncReason, pages };
}

function matchesFilters(job, { fromMs, toMs, printerId, type, groupId }) {
  const created = toMs(job.createdAt);
  if (!created || created < fromMs || created > toMs) return false;
  if (type && resolveType(job) !== type) return false;
  if (printerId) {
    const parts = Array.isArray(job.parts) ? job.parts : [];
    if (!parts.some((p) => p?.printerId === printerId) && job.printerId !== printerId) return false;
  }
  if (groupId) {
    const q = groupId.trim().toLowerCase();
    const ids = [job.groupId, job.batchId, job.source?.id, job.productId, job.reprintOfJobId, job.id]
      .filter(Boolean).map((v) => String(v).toLowerCase());
    if (!ids.some((v) => v === q || v.includes(q))) return false;
  }
  return true;
}

function analyzePeriod(rawJobs, certs, filters, printerNames, canViewCosts) {
  const jobs = rawJobs.filter((j) => matchesFilters(j, filters));
  const byType = new Map(), byPrinter = new Map(), byOperator = new Map(), byMonth = new Map(), byGroup = new Map();
  const certIds = new Set();
  const spanDays = Math.max(1, Math.round((filters.toMs - filters.fromMs) / 86400000));
  const useMonthly = spanDays > 62;
  const buckets = new Map();
  let originalJobs = 0, reprintJobs = 0, requested = 0, accepted = 0, rejected = 0, inventoried = 0;
  let acceptedJobs = 0, sides = 0, sidesJobs = 0, sheets = 0, sheetsJobs = 0;
  let totalCost = 0, costJobs = 0, supplyJobs = 0;
  const enriched = [];

  for (const job of jobs) {
    const t = resolveType(job);
    const ms = toMs(job.createdAt);
    const d = new Date(ms);
    const monthKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const bucketKey = useMonthly ? monthKey : toIso(d);
    const isReprint = Boolean(job.reprintOfJobId);
    const req = numOrNull(job.config?.copies) || 0;
    const acc = numOrNull(job.accepted);
    const rej = numOrNull(job.rejected);
    const inv = numOrNull(job.inventoried);
    const phys = verifiedPhysical(job);
    const fin = canViewCosts ? extractCosts(job) : { cost: null, suppliesText: '', hasSupplies: false };
    const op = (job.createdByName || '').trim() || 'Sin operador';
    const grp = job.groupId || job.batchId || job.productId || job.source?.id || '';

    if (isReprint) reprintJobs += 1; else originalJobs += 1;
    requested += req;
    if (acc != null) { accepted += acc; acceptedJobs += 1; }
    if (rej != null) rejected += rej;
    if (inv != null) inventoried += inv;
    if (phys.sides != null) { sides += phys.sides; sidesJobs += 1; }
    if (phys.sheets != null) { sheets += phys.sheets; sheetsJobs += 1; }
    if (fin.cost != null) { totalCost += fin.cost; costJobs += 1; }
    if (fin.hasSupplies) supplyJobs += 1;
    if (Number(job.accepted)>0 && job.source?.certificateId) certIds.add(String(job.source.certificateId));

    const b = buckets.get(bucketKey) || { key: bucketKey, jobs: 0, accepted: 0 };
    b.jobs += 1; b.accepted += acc || 0; buckets.set(bucketKey, b);

    const ts = byType.get(t) || { id: t, label: typeLabel(t), jobs: 0, accepted: 0, reprints: 0 };
    ts.jobs += 1; ts.accepted += acc || 0; if (isReprint) ts.reprints += 1; byType.set(t, ts);

    const msRow = byMonth.get(monthKey) || { month: monthKey, jobs: 0, originals: 0, reprints: 0, accepted: 0, rejected: 0, sides: 0, sidesJobs: 0, sheets: 0, sheetsJobs: 0 };
    msRow.jobs += 1; if (isReprint) msRow.reprints += 1; else msRow.originals += 1;
    msRow.accepted += acc || 0; msRow.rejected += rej || 0;
    if (phys.sides != null) { msRow.sides += phys.sides; msRow.sidesJobs += 1; }
    if (phys.sheets != null) { msRow.sheets += phys.sheets; msRow.sheetsJobs += 1; }
    byMonth.set(monthKey, msRow);

    const opRow = byOperator.get(op) || { name: op, jobs: 0, originals: 0, reprints: 0, accepted: 0, rejected: 0 };
    opRow.jobs += 1; if (isReprint) opRow.reprints += 1; else opRow.originals += 1;
    opRow.accepted += acc || 0; opRow.rejected += rej || 0; byOperator.set(op, opRow);

    if (grp) {
      const gRow = byGroup.get(grp) || { id: grp, jobs: 0, accepted: 0, inventoried: 0 };
      gRow.jobs += 1; gRow.accepted += acc || 0; gRow.inventoried += inv || 0; byGroup.set(grp, gRow);
    }

    const parts = Array.isArray(job.parts) ? job.parts : [];
    const seenPrinters = new Set();
    for (const p of parts) {
      const pid = p?.printerId || 'sin-impresora';
      const pr = byPrinter.get(pid) || { id: pid, name: printerNames.get(pid) || pid, jobs: 0, parts: 0, copies: 0 };
      pr.parts += 1; pr.copies += numOrNull(p?.copies) || 0;
      if (!seenPrinters.has(pid)) { pr.jobs += 1; seenPrinters.add(pid); }
      byPrinter.set(pid, pr);
    }
    const printerLabel = [...seenPrinters].map((id) => printerNames.get(id) || id).join(', ') || 'Sin asignar';
    enriched.push({ ...job, _type: t, _ms: ms, _isReprint: isReprint, _acc: acc, _rej: rej, _inv: inv, _phys: phys, _fin: fin, _op: op, _grp: grp, _printers: printerLabel });
  }

  const emittedCerts = [];
  const emittedUnique = new Set();
  for (const c of Array.isArray(certs) ? certs : []) {
    const cm = toMs(c?.createdAt ?? c?.issuedAt ?? c?.generatedAt ?? c?.date);
    if (cm >= filters.fromMs && cm <= filters.toMs) {
      emittedCerts.push({ ...c, _ms: cm });
      const cid = c?.certificateId || c?.id;
      if (cid) emittedUnique.add(String(cid));
    }
  }

  return {
    jobs: enriched.sort((a, b) => b._ms - a._ms),
    totalJobs: jobs.length, originalJobs, reprintJobs, requested, accepted, rejected, inventoried,
    acceptedJobs, sides: sidesJobs ? sides : null, sidesJobs, sheets: sheetsJobs ? sheets : null, sheetsJobs,
    totalCost: costJobs ? totalCost : null, costJobs, supplyJobs,
    uniqueCertIds: certIds.size, emittedCerts, emittedUniqueCount: emittedUnique.size,
    byType: [...byType.values()].sort((a, b) => b.jobs - a.jobs),
    byPrinter: [...byPrinter.values()].sort((a, b) => b.jobs - a.jobs),
    byOperator: [...byOperator.values()].sort((a, b) => b.jobs - a.jobs),
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    byGroup: [...byGroup.values()].sort((a, b) => b.jobs - a.jobs),
    series: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
    useMonthly,
  };
}

function buildReport(id, data, prev, meta) {
  const base = {
    id, periodLabel: `${meta.from} a ${meta.to}`, generatedAt: new Date().toLocaleString('es-MX'),
    filtersSummary: meta.filtersSummary, truncatedWarning: meta.truncatedWarning, notes: meta.notes,
  };
  if (id === 'monthly') return {
    ...base, title: 'Reporte de Producción Mensual', subtitle: 'Trabajos principales, calidad y volumen físico verificado por mes',
    kpis: [
      { label: 'Trabajos principales', value: fmtNum(data.totalJobs), delta: meta.compare ? deltaBadge(data.totalJobs, prev.totalJobs).text : '' },
      { label: 'Aceptados (calidad)', value: fmtNum(data.accepted), delta: meta.compare ? deltaBadge(data.accepted, prev.accepted).text : '' },
      { label: 'Reimpresiones', value: fmtNum(data.reprintJobs) },
      { label: 'Hojas verificadas', value: data.sheets != null ? fmtNum(data.sheets) : 'Sin dato' },
    ],
    columns: [
      { key: 'month', label: 'Mes' }, { key: 'jobs', label: 'Trabajos', numeric: true },
      { key: 'originals', label: 'Originales', numeric: true }, { key: 'reprints', label: 'Reimpresiones', numeric: true },
      { key: 'accepted', label: 'Aceptados', numeric: true }, { key: 'rejected', label: 'Rechazados', numeric: true },
      { key: 'sides', label: 'Caras verif.', numeric: true }, { key: 'sheets', label: 'Hojas verif.', numeric: true },
    ],
    rows: data.byMonth.map((m) => ({
      month: m.month, jobs: m.jobs, originals: m.originals, reprints: m.reprints,
      accepted: m.accepted, rejected: m.rejected, sides: m.sidesJobs ? m.sides : 'N/D', sheets: m.sheetsJobs ? m.sheets : 'N/D',
    })),
    chart: { kind: 'bars', items: data.byMonth.map((m) => ({ label: m.month, value: m.jobs, sub: `${fmtNum(m.accepted)} acept.` })) },
  };
  if (id === 'books' || id === 'credentials') {
    const isBook = id === 'books';
    const list = data.jobs.filter((j) => j._type === (isBook ? 'book' : 'credential'));
    const accSum = list.reduce((s, j) => s + (j._acc || 0), 0);
    const repSum = list.filter((j) => j._isReprint).length;
    return {
      ...base, title: isBook ? 'Reporte de Producción de Libros' : 'Reporte de Credenciales',
      subtitle: isBook ? 'Detalle de tirajes, calidad y hojas verificadas de libros' : 'Detalle de lotes, aceptados y reposiciones de credenciales',
      kpis: [
        { label: isBook ? 'Trabajos de libros' : 'Trabajos de credenciales', value: fmtNum(list.length) },
        { label: 'Ejemplares aceptados', value: fmtNum(accSum) },
        { label: 'Reimpresiones', value: fmtNum(repSum) },
      ],
      columns: [
        { key: 'date', label: 'Fecha' }, { key: 'title', label: 'Título' }, { key: 'group', label: 'Grupo / Producto' },
        { key: 'requested', label: 'Solicitados', numeric: true }, { key: 'accepted', label: 'Aceptados', numeric: true },
        { key: 'rejected', label: 'Rechazados', numeric: true }, { key: 'sheets', label: 'Hojas verif.', numeric: true },
        { key: 'reprint', label: 'Reimpresión' },
      ],
      rows: list.map((j) => ({
        date: fmtDate(j._ms), title: j.title || j.source?.name || j.id, group: j._grp || '—',
        requested: numOrNull(j.config?.copies) ?? 'N/D', accepted: j._acc ?? 'N/D', rejected: j._rej ?? 'N/D',
        sheets: j._phys.sheets ?? 'N/D', reprint: j._isReprint ? `Sí (${j.reprintOfJobId})` : 'No',
      })),
      chart: { kind: 'bars', items: list.slice(0, 8).map((j) => ({ label: (j.title || j.id).slice(0, 28), value: j._acc ?? (numOrNull(j.config?.copies) || 0) })) },
    };
  }
  if (id === 'certificates') {
    const list = data.jobs.filter((j) => j._type === 'certificate' || j.source?.certificateId);
    const uniq = new Set(list.map((j) => j.source?.certificateId).filter(Boolean));
    return {
      ...base, title: 'Reporte de Certificados', subtitle: 'Trabajos únicos por certificateId y certificados emitidos por fecha',
      kpis: [
        { label: 'Trabajos certificados', value: fmtNum(list.length) },
        { label: 'Únicos por certificateId', value: fmtNum(uniq.size) },
        { label: 'Emitidos en periodo', value: fmtNum(data.emittedCerts.length), delta: meta.compare ? deltaBadge(data.emittedCerts.length, prev.emittedCerts.length).text : '' },
      ],
      columns: [
        { key: 'date', label: 'Fecha' }, { key: 'source', label: 'Origen' }, { key: 'certId', label: 'Certificate ID' },
        { key: 'title', label: 'Documento / Titular' }, { key: 'accepted', label: 'Aceptados', numeric: true }, { key: 'reprint', label: 'Reimpresión' },
      ],
      rows: [
        ...list.map((j) => ({ date: fmtDate(j._ms), source: 'Producción', certId: j.source?.certificateId || 'Sin ID', title: j.title || j.source?.name || j.id, accepted: j._acc ?? 'N/D', reprint: j._isReprint ? 'Sí' : 'No' })),
        ...data.emittedCerts.map((c) => ({ date: fmtDate(c._ms), source: 'Emitido', certId: c.certificateId || c.id || 'Sin ID', title: c.templateName || 'Certificado emitido', accepted: 1, reprint: 'No' })),
      ],
      chart: { kind: 'bars', items: [{ label: 'Trabajos impresión', value: list.length }, { label: 'Únicos certificateId', value: uniq.size }, { label: 'Emitidos por fecha', value: data.emittedCerts.length }] },
    };
  }
  if (id === 'inventory') {
    const list = data.jobs.filter((j) => (j._inv != null && j._inv > 0) || j.productId);
    const invSum = list.reduce((s, j) => s + (j._inv || 0), 0);
    return {
      ...base, title: 'Reporte de Inventario Generado', subtitle: 'Ejemplares ingresados a inventario vinculados por producto',
      kpis: [
        { label: 'Registros con inventario', value: fmtNum(list.length) },
        { label: 'Total inventariado', value: fmtNum(invSum), delta: meta.compare ? deltaBadge(invSum, prev.inventoried).text : '' },
      ],
      columns: [
        { key: 'date', label: 'Fecha' }, { key: 'productId', label: 'ID Producto' }, { key: 'title', label: 'Trabajo' },
        { key: 'type', label: 'Tipo' }, { key: 'accepted', label: 'Aceptados', numeric: true }, { key: 'inventoried', label: 'Inventariados', numeric: true },
      ],
      rows: list.map((j) => ({
        date: fmtDate(j._ms), productId: j.productId || 'Sin productId', title: j.title || j.id,
        type: typeLabel(j._type), accepted: j._acc ?? 'N/D', inventoried: j._inv ?? 0,
      })),
      chart: { kind: 'bars', items: list.slice(0, 8).map((j) => ({ label: (j.productId || j.title || j.id).slice(0, 24), value: j._inv || 0 })) },
    };
  }
  if (id === 'incidents') {
    const list = data.jobs.filter((j) => j._isReprint || (j._rej != null && j._rej > 0));
    const rate = data.totalJobs ? ((data.reprintJobs / data.totalJobs) * 100).toFixed(1) : '0.0';
    return {
      ...base, title: 'Reporte de Incidencias y Reimpresiones', subtitle: 'Trabajos reimpresos (reprintOfJobId) y ejemplares rechazados en control de calidad',
      kpis: [
        { label: 'Reimpresiones', value: fmtNum(data.reprintJobs), delta: meta.compare ? deltaBadge(data.reprintJobs, prev.reprintJobs).text : '' },
        { label: 'Tasa reimpresión', value: `${rate}%` },
        { label: 'Ejemplares rechazados', value: fmtNum(data.rejected) },
      ],
      columns: [
        { key: 'date', label: 'Fecha' }, { key: 'title', label: 'Trabajo' }, { key: 'type', label: 'Tipo' },
        { key: 'original', label: 'Trabajo original' }, { key: 'rejected', label: 'Rechazados', numeric: true },
        { key: 'accepted', label: 'Aceptados', numeric: true }, { key: 'operator', label: 'Operador' },
      ],
      rows: list.map((j) => ({
        date: fmtDate(j._ms), title: j.title || j.id, type: typeLabel(j._type),
        original: j.reprintOfJobId || '—', rejected: j._rej ?? 0, accepted: j._acc ?? 'N/D', operator: j._op,
      })),
      chart: { kind: 'bars', items: [{ label: 'Originales', value: data.originalJobs }, { label: 'Reimpresiones', value: data.reprintJobs }, { label: 'Con rechazos', value: list.filter((j) => (j._rej || 0) > 0).length }] },
    };
  }
  if (id === 'operator') return {
    ...base, title: 'Reporte por Operador', subtitle: 'Volumen de trabajos principales, calidad y reimpresiones por operador',
    kpis: [
      { label: 'Operadores activos', value: fmtNum(data.byOperator.length) },
      { label: 'Trabajos totales', value: fmtNum(data.totalJobs) },
      { label: 'Ejemplares aceptados', value: fmtNum(data.accepted) },
    ],
    columns: [
      { key: 'name', label: 'Operador' }, { key: 'jobs', label: 'Trabajos', numeric: true },
      { key: 'originals', label: 'Originales', numeric: true }, { key: 'reprints', label: 'Reimpresiones', numeric: true },
      { key: 'accepted', label: 'Aceptados', numeric: true }, { key: 'rejected', label: 'Rechazados', numeric: true },
    ],
    rows: data.byOperator,
    chart: { kind: 'bars', items: data.byOperator.slice(0, 8).map((o) => ({ label: o.name, value: o.jobs, sub: `${fmtNum(o.accepted)} acept.` })) },
  };
  const costRows = data.jobs.filter((j) => j._fin.cost != null || j._fin.hasSupplies);
  return {
    ...base, title: 'Reporte de Costos y Consumo de Insumos', subtitle: 'Solo registros con costos o insumos explícitamente verificados',
    kpis: [
      { label: 'Costo total verificado', value: data.totalCost != null ? fmtCur(data.totalCost) : 'Sin datos' },
      { label: 'Trabajos con costo', value: `${fmtNum(data.costJobs)} / ${fmtNum(data.totalJobs)}` },
      { label: 'Trabajos con insumos', value: fmtNum(data.supplyJobs) },
    ],
    columns: [
      { key: 'date', label: 'Fecha' }, { key: 'title', label: 'Trabajo' }, { key: 'type', label: 'Tipo' },
      { key: 'accepted', label: 'Aceptados', numeric: true }, { key: 'cost', label: 'Costo (MXN)', numeric: true }, { key: 'supplies', label: 'Insumos registrados' },
    ],
    rows: costRows.map((j) => ({
      date: fmtDate(j._ms), title: j.title || j.id, type: typeLabel(j._type),
      accepted: j._acc ?? 'N/D', cost: j._fin.cost ?? 'N/D', supplies: j._fin.suppliesText || '—',
    })),
    chart: { kind: 'bars', items: costRows.slice(0, 8).map((j) => ({ label: (j.title || j.id).slice(0, 24), value: j._fin.cost || 0 })) },
  };
}

function TrendChart({ current, previous, showPrev }) {
  if (!current.length) return <Empty icon="bar-chart-2" title="Sin serie temporal">No hay trabajos en el rango seleccionado.</Empty>;
  const w = 540, h = 190, px = 34, py = 20;
  const maxV = Math.max(1, ...current.map((d) => d.jobs), ...(showPrev ? previous.map((d) => d.jobs) : [0]));
  const pts = (arr) => arr.map((d, i) => {
    const x = arr.length === 1 ? w / 2 : px + (i * (w - px * 2)) / (arr.length - 1);
    const y = h - py - (d.jobs / maxV) * (h - py * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="pp-chart-wrap">
      <svg viewBox={`0 0 ${w} ${h}`} className="pp-svg" role="img" aria-label="Evolución de producción">
        {[0, 0.5, 1].map((r) => {
          const y = h - py - r * (h - py * 2);
          return <g key={r}><line x1={px} y1={y} x2={w - px} y2={y} stroke="#e2e8f0" /><text x={px - 6} y={y + 4} textAnchor="end" className="pp-axis">{Math.round(maxV * r)}</text></g>;
        })}
        {showPrev && previous.length > 1 && <polyline fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="5 4" points={pts(previous)} />}
        {current.length > 1 && <polyline fill="none" stroke="#1d4ed8" strokeWidth="2.5" points={pts(current)} />}
        {current.map((d, i) => {
          const x = current.length === 1 ? w / 2 : px + (i * (w - px * 2)) / (current.length - 1);
          const y = h - py - (d.jobs / maxV) * (h - py * 2);
          return <circle key={d.key} cx={x} cy={y} r="3.5" fill="#0f294a"><title>{`${d.key}: ${d.jobs} trabajos, ${d.accepted} aceptados`}</title></circle>;
        })}
      </svg>
      <div className="pp-chart-foot">
        <span>{current[0]?.key}</span>
        <span className="pp-legend-inline"><i><b style={{ background: '#1d4ed8' }} />Actual</i>{showPrev && <i><b style={{ background: '#94a3b8' }} />Periodo anterior</i>}</span>
        <span>{current[current.length - 1]?.key}</span>
      </div>
    </div>
  );
}

function DonutChart({ items, total }) {
  if (!items.length || !total) return <Empty icon="layers" title="Sin distribución">No hay registros para clasificar por tipo.</Empty>;
  const r = 58, c = 2 * Math.PI * r;

  return (
    <div className="pp-donut-box">
      <svg viewBox="0 0 160 160" className="pp-donut-svg" role="img" aria-label="Distribución por tipo">
        <circle cx="80" cy="80" r={r} fill="none" stroke="#f1f5f9" strokeWidth="20" />
        {items.map((it, idx) => {
          const len = (it.jobs / total) * c;
          const el = <circle key={it.id} cx="80" cy="80" r={r} fill="none" stroke={PALETTE[idx % PALETTE.length]} strokeWidth="20" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-items.slice(0,idx).reduce((sum,item)=>sum+item.jobs/total*c,0)} transform="rotate(-90 80 80)" />;
          return el;
        })}
        <text x="80" y="76" textAnchor="middle" className="pp-donut-num">{fmtNum(total)}</text>
        <text x="80" y="94" textAnchor="middle" className="pp-donut-sub">trabajos</text>
      </svg>
      <ul className="pp-donut-list">
        {items.slice(0, 7).map((it, idx) => (
          <li key={it.id}><span className="pp-dot" style={{ background: PALETTE[idx % PALETTE.length] }} /><em>{it.label}</em><strong>{fmtNum(it.jobs)}</strong><small>{((it.jobs / total) * 100).toFixed(0)}%</small></li>
        ))}
      </ul>
    </div>
  );
}

function BarRanking({ items, emptyTitle }) {
  if (!items.length) return <Empty icon="bar-chart-2" title={emptyTitle || 'Sin datos'}>No se registraron elementos en este periodo.</Empty>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="pp-rank">
      {items.map((it) => (
        <div key={it.label} className="pp-rank-row">
          <div className="pp-rank-head"><span>{it.label}</span><strong>{fmtNum(it.value)}{it.sub ? <small> · {it.sub}</small> : null}</strong></div>
          <div className="pp-rank-track"><div className="pp-rank-fill" style={{ width: `${Math.max(3, (it.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function Analytics({ view = 'stats', printers = [], generatedCertificates = [], canViewCosts = false }) {
  const initial = useMemo(() => getPresetDates('30d'), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [preset, setPreset] = useState('30d');
  const [printerId, setPrinterId] = useState('');
  const [type, setType] = useState('');
  const [groupId, setGroupId] = useState('');
  const [comparePrev, setComparePrev] = useState(true);
  const [reportId, setReportId] = useState('monthly');
  const [notes, setNotes] = useState('');
  const [state, setState] = useState({ loading: true, error: '', currJobs: [], prevJobs: [], truncated: false, truncReason: '', prevTruncated: false });
  const [exportErr, setExportErr] = useState('');
  const [exporting, setExporting] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const reqRef = useRef(0);

  const rangeValid = Boolean(from && to && startMs(from) <= endMs(to));
  const fMs = rangeValid ? startMs(from) : 0;
  const tMs = rangeValid ? endMs(to) : 0;
  const span = Math.max(1, tMs - fMs + 1);
  const pToMs = fMs - 1;
  const pFromMs = fMs - span;

  useEffect(() => {
    if (!rangeValid) return;
    const reqId = ++reqRef.current;
    const isCurrent = () => reqRef.current === reqId;
    Promise.resolve().then(()=>{if(isCurrent())setState(s=>({...s,loading:true,error:''}));});
    Promise.all([fetchPeriod(fMs, tMs, isCurrent), fetchPeriod(pFromMs, pToMs, isCurrent)])
      .then(([curr, prev]) => {
        if (!isCurrent() || curr.cancelled || prev.cancelled) return;
        setState({ loading: false, error: '', currJobs: curr.jobs, prevJobs: prev.jobs, truncated: curr.truncated, truncReason: curr.truncReason, prevTruncated: prev.truncated });
      })
      .catch((err) => {
        if (!isCurrent()) return;
        setState((s) => ({ ...s, loading: false, error: errorText ? errorText(err) : (err?.message || 'Error al cargar historial') }));
      });
    return () => { reqRef.current += 1; };
  }, [fMs, tMs, pFromMs, pToMs, rangeValid, reloadKey]);

  const printerNames = useMemo(() => {
    const map = new Map();
    for (const p of Array.isArray(printers) ? printers : []) if (p?.id) map.set(p.id, p.name || p.label || p.id);
    for (const j of state.currJobs) for (const pt of Array.isArray(j.parts) ? j.parts : []) if (pt?.printerId && !map.has(pt.printerId)) map.set(pt.printerId, pt.printerId);
    return map;
  }, [printers, state.currJobs]);

  const knownGroups = useMemo(() => {
    const set = new Set();
    for (const j of state.currJobs) {
      const g = j.groupId || j.batchId || j.productId || j.source?.id;
      if (g) set.add(String(g));
    }
    return [...set].slice(0, 60);
  }, [state.currJobs]);

  const typeOptions = useMemo(() => {
    const keys = new Set(Object.keys(FALLBACK_TYPES));
    if (TYPES instanceof Map) for (const k of TYPES.keys()) keys.add(k);
    else if (TYPES && typeof TYPES === 'object') for (const k of Object.keys(TYPES)) keys.add(k);
    return [...keys].map((id) => ({ id, label: typeLabel(id) }));
  }, []);

  const currData = useMemo(() => analyzePeriod(state.currJobs, generatedCertificates, { fromMs: fMs, toMs: tMs, printerId, type, groupId }, printerNames, canViewCosts), [state.currJobs, generatedCertificates, fMs, tMs, printerId, type, groupId, printerNames, canViewCosts]);
  const prevData = useMemo(() => analyzePeriod(state.prevJobs, generatedCertificates, { fromMs: pFromMs, toMs: pToMs, printerId, type, groupId }, printerNames, canViewCosts), [state.prevJobs, generatedCertificates, pFromMs, pToMs, printerId, type, groupId, printerNames, canViewCosts]);

  const availableReports = useMemo(() => REPORTS.filter((r) => !r.requiresCosts || canViewCosts), [canViewCosts]);
  const activeReportId = availableReports.some((r) => r.id === reportId) ? reportId : 'monthly';
  const filtersSummary = [
    printerId ? `Impresora: ${printerNames.get(printerId) || printerId}` : 'Todas las impresoras',
    type ? `Tipo: ${typeLabel(type)}` : 'Todos los tipos',
    groupId ? `Grupo/ID: ${groupId}` : 'Todos los grupos',
  ].join(' | ');

  const report = useMemo(() => buildReport(activeReportId, currData, prevData, {
    from, to, compare: comparePrev, filtersSummary, notes: notes.trim(),
    truncatedWarning: state.truncated ? state.truncReason : '',
  }), [activeReportId, currData, prevData, from, to, comparePrev, filtersSummary, notes, state.truncated, state.truncReason]);

  const applyPreset = (id) => { const r = getPresetDates(id); setPreset(id); setFrom(r.from); setTo(r.to); };
  const resetFilters = () => { applyPreset('30d'); setPrinterId(''); setType(''); setGroupId(''); };
  const handleExport = async (fmt) => {
    setExportErr(''); setExporting(fmt);
    try {
      if (fmt === 'archive') {
        const kind={monthly:'production',incidents:'reprints'}[activeReportId]||activeReportId;
        await generateReport({requestId:crypto.randomUUID(),kind,from,to,...(type?{type}:{}),...(printerId?{printerId}:{})});
      } else if (fmt === 'csv') exportReportCSV(report);
      else if (fmt === 'pdf') exportReportPDF(report);
      else if (fmt === 'xlsx') await exportReportXLSX(report);
    } catch (e) { setExportErr(errorText ? errorText(e) : (e?.message || 'No se pudo generar el archivo')); }
    finally { setExporting(''); }
  };

  const notices = (
    <>
      {!rangeValid && <div className="pp-alert pp-alert-err"><Icon name="alert-triangle" size={16} /><span>La fecha inicial debe ser anterior o igual a la fecha final.</span></div>}
      {state.error && <div className="pp-alert pp-alert-err"><Icon name="alert-triangle" size={16} /><span>{state.error}</span><Button icon="refresh-cw" onClick={() => setReloadKey((k) => k + 1)}>Reintentar</Button></div>}
      {(state.truncated || state.prevTruncated) && (
        <div className="pp-alert pp-alert-warn"><Icon name="alert-triangle" size={16} /><span><strong>Historial truncado:</strong> {state.truncated ? state.truncReason : 'El periodo anterior de comparación fue truncado por límite de consulta.'} Reduce el rango de fechas para precisión completa.</span></div>
      )}
    </>
  );

  const filterControls = (compact = false) => (
    <div className={compact ? 'pp-form-stack' : 'pp-filters'}>
      <div className="pp-presets">{PRESETS.map((p) => <button key={p.id} type="button" className={`pp-pill${preset === p.id ? ' pp-active' : ''}`} onClick={() => applyPreset(p.id)}>{p.label}</button>)}</div>
      <div className={compact ? 'pp-fields-col' : 'pp-fields-row'}>
        <label className="pp-field"><span>Desde</span><input type="date" value={from} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} /></label>
        <label className="pp-field"><span>Hasta</span><input type="date" value={to} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} /></label>
        <label className="pp-field"><span>Impresora</span><select value={printerId} onChange={(e) => setPrinterId(e.target.value)}><option value="">Todas</option>{[...printerNames.entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="pp-field"><span>Tipo</span><select value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos</option>{typeOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        <label className="pp-field"><span>Grupo / ID</span><input list="pp-group-ids" value={groupId} placeholder="ID grupo, producto o fuente" onChange={(e) => setGroupId(e.target.value)} /><datalist id="pp-group-ids">{knownGroups.map((g) => <option key={g} value={g} />)}</datalist></label>
        <div className="pp-filter-actions"><Button icon="refresh-cw" onClick={() => setReloadKey((k) => k + 1)} disabled={state.loading}>Actualizar</Button><Button icon="x" onClick={resetFilters}>Limpiar</Button></div>
      </div>
    </div>
  );

  if (view === 'reports') {
    return (
      <section className="pp-an">
        <div className="pp-report-selector">
          {availableReports.map((r) => (
            <button key={r.id} type="button" className={`pp-rtype${activeReportId === r.id ? ' pp-active' : ''}`} onClick={() => setReportId(r.id)}>
              <span className="pp-rtype-ic"><Icon name={r.icon} size={18} /></span>
              <div><strong>{r.label}</strong><small>{r.desc}</small></div>
            </button>
          ))}
        </div>
        {notices}
        <div className="pp-report-layout">
          <aside className="pp-card pp-col-cfg">
            <h3 className="pp-card-title"><Icon name="filter" size={16} />Configuración</h3>
            {filterControls(true)}
            <label className="pp-check"><input type="checkbox" checked={comparePrev} onChange={(e) => setComparePrev(e.target.checked)} /><span>Comparar contra periodo equivalente</span></label>
            <label className="pp-field"><span>Nota institucional (PDF/Excel)</span><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observaciones opcionales..." /></label>
          </aside>

          <div className="pp-card pp-col-prev">
            <div className="pp-prev-head">
              <div><h3 className="pp-card-title">{report.title}</h3><p className="pp-sub">{report.subtitle} · <strong>{report.periodLabel}</strong></p></div>
              <span className="pp-badge">{state.loading ? 'Cargando...' : `${fmtNum(report.rows.length)} filas`}</span>
            </div>
            <div className="pp-mini-kpis">{report.kpis.map((k) => <div key={k.label} className="pp-mini-kpi"><span>{k.label}</span><strong>{k.value}</strong>{k.delta && <small>{k.delta}</small>}</div>)}</div>
            {report.rows.length === 0 && !state.loading ? (
              <Empty icon="file-text" title="Sin registros verificados">No existen datos para este reporte con los filtros actuales.</Empty>
            ) : (
              <>
                {report.chart?.items?.length > 0 && <div className="pp-prev-chart"><BarRanking items={report.chart.items} /></div>}
                <div className="pp-table-wrap">
                  <table className="pp-table">
                    <thead><tr>{report.columns.map((c) => <th key={c.key} className={c.numeric ? 'pp-num' : ''}>{c.label}</th>)}</tr></thead>
                    <tbody>{report.rows.slice(0, 50).map((row, idx) => <tr key={idx}>{report.columns.map((c) => <td key={c.key} className={c.numeric ? 'pp-num' : ''}>{typeof row[c.key] === 'number' ? fmtNum(row[c.key]) : String(row[c.key] ?? '—')}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                {report.rows.length > 50 && <p className="pp-note">Vista previa limitada a 50 filas. La exportación incluye los {fmtNum(report.rows.length)} registros.</p>}
              </>
            )}
          </div>

          <aside className="pp-card pp-col-exp">
            <h3 className="pp-card-title"><Icon name="download" size={16} />Exportación</h3>
            <dl className="pp-meta-list">
              <div><dt>Periodo</dt><dd>{report.periodLabel}</dd></div>
              <div><dt>Filtros</dt><dd>{filtersSummary}</dd></div>
              <div><dt>Registros</dt><dd>{fmtNum(report.rows.length)}</dd></div>
            </dl>
            <div className="pp-exp-btns">
              <Button icon="file" disabled={!rangeValid || state.loading || !!exporting || !!groupId} onClick={() => handleExport('archive')}>{exporting==='archive'?'Archivando…':'Generar en el archivo de reportes'}</Button>
              <Button icon="file-text" disabled={!rangeValid || !!state.error || state.loading || !!exporting} onClick={() => handleExport('pdf')}>{exporting === 'pdf' ? 'Generando PDF...' : 'Exportar PDF institucional'}</Button>
              <Button icon="download" disabled={!rangeValid || !!state.error || state.loading || !!exporting} onClick={() => handleExport('xlsx')}>{exporting === 'xlsx' ? 'Generando Excel...' : 'Exportar Excel (.xlsx)'}</Button>
              <Button icon="download" disabled={!rangeValid || !!state.error || state.loading || !!exporting} onClick={() => handleExport('csv')}>{exporting === 'csv' ? 'Generando CSV...' : 'Exportar CSV'}</Button>
            </div>
            {exportErr && <div className="pp-alert pp-alert-err"><span>{exportErr}</span></div>}

          </aside>
        </div>
      </section>
    );
  }

  const dJobs = deltaBadge(currData.totalJobs, prevData.totalJobs);
  const dAcc = deltaBadge(currData.accepted, prevData.accepted);
  const dCerts = deltaBadge(currData.emittedCerts.length, prevData.emittedCerts.length);
  const dRep = deltaBadge(currData.reprintJobs, prevData.reprintJobs);

  return (
    <section className="pp-an">
      <div className="pp-card">{filterControls(false)}</div>
      {notices}
      <div className="pp-kpi-grid">
        <Metric label="Trabajos principales" value={fmtNum(currData.totalJobs)} icon="layers" tone="primary" detail={`${fmtNum(currData.originalJobs)} orig. · ${fmtNum(currData.reprintJobs)} reimp. · ${dJobs.text}`} />
        <Metric label="Ejemplares aceptados" value={fmtNum(currData.accepted)} icon="check-circle" tone="success" detail={`${fmtNum(currData.rejected)} rechazados · ${dAcc.text}`} />
        <Metric label="Hojas físicas verificadas" value={currData.sheets != null ? fmtNum(currData.sheets) : 'Sin dato'} icon="copy" tone="info" detail={currData.sheetsJobs ? `${fmtNum(currData.sides)} caras · verif. ${currData.sheetsJobs}/${currData.totalJobs}` : 'Se contabilizan los tramos confirmados por el operador'} />
        <Metric label="Certificados emitidos" value={fmtNum(currData.emittedCerts.length)} icon="award" tone="navy" detail={`${fmtNum(currData.uniqueCertIds)} únicos en producción · ${dCerts.text}`} />
        <Metric label="Inventario generado" value={fmtNum(currData.inventoried)} icon="package" tone="info" detail={`${fmtNum(currData.byGroup.length)} grupos / productos activos`} />
        <Metric label="Reimpresiones" value={fmtNum(currData.reprintJobs)} icon="alert-triangle" tone={currData.reprintJobs > 0 ? 'warning' : 'neutral'} detail={`${currData.totalJobs ? ((currData.reprintJobs / currData.totalJobs) * 100).toFixed(1) : '0.0'}% del total · ${dRep.text}`} />
        {canViewCosts && <Metric label="Costo verificado" value={currData.totalCost != null ? fmtCur(currData.totalCost) : 'Sin datos'} icon="dollar-sign" tone="navy" detail={currData.costJobs ? `Verificado en ${currData.costJobs}/${currData.totalJobs} trabajos` : 'Sin costos registrados en periodo'} />}
      </div>

      <div className="pp-charts-grid">
        <div className="pp-card">
          <div className="pp-card-head"><h3 className="pp-card-title">Tendencia de producción ({currData.useMonthly ? 'mensual' : 'diaria'})</h3><label className="pp-check-sm"><input type="checkbox" checked={comparePrev} onChange={(e) => setComparePrev(e.target.checked)} />Periodo anterior</label></div>
          <TrendChart current={currData.series} previous={prevData.series} showPrev={comparePrev} />
        </div>
        <div className="pp-card">
          <h3 className="pp-card-title">Distribución por tipo</h3>
          <DonutChart items={currData.byType} total={currData.totalJobs} />
        </div>
      </div>

      <div className="pp-charts-grid">
        <div className="pp-card"><h3 className="pp-card-title"><Icon name="printer" size={16} />Ranking por impresora</h3><BarRanking items={currData.byPrinter.slice(0, 8).map((p) => ({ label: p.name, value: p.jobs, sub: `${fmtNum(p.parts)} partes` }))} emptyTitle="Sin impresoras registradas" /></div>
        <div className="pp-card"><h3 className="pp-card-title"><Icon name="users" size={16} />Ranking por operador</h3><BarRanking items={currData.byOperator.slice(0, 8).map((o) => ({ label: o.name, value: o.jobs, sub: `${fmtNum(o.accepted)} acept.` }))} emptyTitle="Sin operadores registrados" /></div>
      </div>

      <div className="pp-card">
        <div className="pp-card-head"><h3 className="pp-card-title">Trabajos principales del periodo</h3><span className="pp-badge">{state.loading ? 'Cargando...' : `${fmtNum(currData.totalJobs)} trabajos`}</span></div>
        {currData.jobs.length === 0 && !state.loading ? (
          <Empty icon="layers" title="Sin trabajos en el periodo">Ajusta los filtros de fecha, impresora, tipo o grupo.</Empty>
        ) : (
          <div className="pp-table-wrap">
            <table className="pp-table">
              <thead><tr><th>Fecha</th><th>Trabajo</th><th>Tipo</th><th>Impresora(s)</th><th className="pp-num">Aceptados</th><th className="pp-num">Rechaz.</th><th className="pp-num">Hojas verif.</th><th>Origen</th><th>Operador</th></tr></thead>
              <tbody>
                {currData.jobs.slice(0, 60).map((j) => (
                  <tr key={j.id}>
                    <td>{fmtDate(j._ms)}</td><td><strong>{j.title || j.source?.name || j.id}</strong>{j._grp ? <small className="pp-cell-sub">{j._grp}</small> : null}</td>
                    <td>{typeLabel(j._type)}</td><td>{j._printers}</td><td className="pp-num">{j._acc != null ? fmtNum(j._acc) : '—'}</td>
                    <td className="pp-num">{j._rej != null ? fmtNum(j._rej) : '—'}</td><td className="pp-num">{j._phys.sheets != null ? fmtNum(j._phys.sheets) : '—'}</td>
                    <td>{j._isReprint ? <span className="pp-tag pp-tag-warn">Reimpresión</span> : <span className="pp-tag">Original</span>}</td><td>{j._op}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
