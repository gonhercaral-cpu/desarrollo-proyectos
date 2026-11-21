'use strict';

const crypto = require('node:crypto');

const DEFAULT_CONFIG = Object.freeze({
  alertsEnabled: false,
  automaticNotifications: false,
  aiEnabled: false,
  timeZone: 'America/Tijuana',
  reminderDays: 15,
  preventiveDays: 7,
  urgentDays: 3,
  inactivityBusinessDays: 7,
  workDays: Object.freeze([1, 2, 3, 4, 5]),
  holidays: Object.freeze([]),
  sendHour: 9,
  sendDays: Object.freeze([1, 2, 3, 4, 5]),
  cooldownHours: 24,
  reportDaily: false,
  reportWeekly: false,
  reportWeekday: 1,
  reportRecipientIds: Object.freeze([]),
  aiMonthlyRequestLimit: 100,
  aiMonthlyTokenLimit: 200000,
  aiMaxInputChars: 12000,
  aiMaxOutputTokens: 1000,
  aiModel: '',
});

const BOOLEAN_KEYS = ['alertsEnabled', 'automaticNotifications', 'aiEnabled', 'reportDaily', 'reportWeekly'];
const INTEGER_BOUNDS = {
  reminderDays: [0, 365],
  preventiveDays: [0, 365],
  urgentDays: [0, 365],
  inactivityBusinessDays: [1, 365],
  sendHour: [0, 23],
  cooldownHours: [0, 720],
  reportWeekday: [0, 6],
  aiMonthlyRequestLimit: [0, 10000],
  aiMonthlyTokenLimit: [0, 20000000],
  aiMaxInputChars: [1000, 24000],
  aiMaxOutputTokens: [128, 4000],
};
const OVERRIDE_KEYS = ['inactivityBusinessDays', 'reminderDays', 'preventiveDays', 'urgentDays', 'timeZone', 'workDays', 'holidays'];

const VERSION_PREFIX = 'sup1-';
const MAX_RANGE_DAYS = 3660;
const MAX_ACTIVITY_SOURCES = 20;
const MAX_EVIDENCE_SOURCES = 10;
const MAX_TEXT = 300;
const MAX_ID = 160;

const STATUS_GROUPS = [
  ['complete', new Set(['finalizado', 'terminado', 'completed', 'completado', 'cerrado', 'closed'])],
  ['cancelled', new Set(['cancelado', 'cancelled', 'canceled'])],
  ['deleted', new Set(['eliminado', 'deleted'])],
  ['archived', new Set(['archived', 'archivado'])],
  ['suspended', new Set(['suspended', 'suspendido', 'pausado', 'en pausa', 'paused', 'inactivo', 'inactive'])],
  ['ready', new Set(['listo para revision', 'ready for review'])],
  ['blocked', new Set(['bloqueado', 'blocked'])],
  ['active', new Set(['activo', 'active', 'en proceso', 'correcciones solicitadas', 'aprobado para entrega', 'en planeacion', 'en espera de informacion', 'en progreso', 'in progress', 'en curso', 'pendiente', 'pending', 'nuevo', 'new', 'planeado', 'planned', 'por iniciar', 'not started', 'en revision', 'in review'])],
];
const TERMINAL_KINDS = new Set(['complete', 'cancelled', 'deleted', 'archived', 'suspended']);
const ITEM_DONE = new Set(['entregado', 'delivered', 'done', 'hecho', 'aprobado', 'approved']);
const REVIEW_PENDING = new Set(['pending', 'pendiente', 'en revision', 'requested', 'solicitada', 'in review']);
const WEIGHTS = {
  DEADLINE_OVERDUE: 100,
  BLOCKED: 40,
  ITEMS_OVERDUE: 35,
  INACTIVE: 30,
  EVIDENCE_REJECTED: 25,
  READY_FOR_REVIEW: 20,
};
const RISK_FLOOR = { bajo: 0, medio: 40, alto: 70, critico: 90 };

const MARKS = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function clip(value, max) {
  const str = typeof value === 'string' ? value : '';
  return str.length > max ? str.slice(0, max) : str;
}

function normalize(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(MARKS, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .join(' ');
}

function parseIsoDay(value) {
  if (typeof value !== 'string') return null;
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return Math.floor(ms / 86400000);
}

function dayToString(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
}

function toDate(value) {
  let d = null;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const day = parseIsoDay(s);
    d = day !== null ? new Date(day * 86400000) : new Date(s);
  } else if (typeof value === 'number') {
    d = new Date(value);
  } else if (isObject(value)) {
    if (typeof value.toDate === 'function') {
      try {
        d = value.toDate();
      } catch {
        d = null;
      }
    } else {
      const seconds = typeof value.seconds === 'number' ? value.seconds : typeof value._seconds === 'number' ? value._seconds : null;
      if (seconds !== null) {
        const nanos = typeof value.nanoseconds === 'number' ? value.nanoseconds : typeof value._nanoseconds === 'number' ? value._nanoseconds : 0;
        d = new Date(seconds * 1000 + Math.floor((Number.isFinite(nanos) ? nanos : 0) / 1e6));
      }
    }
  }
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) return null;
  return new Date(d.getTime());
}

const formatters = new Map();

function formatterFor(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

function isValidTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

function calendarDay(value, timezone) {
  const timeZone = timezone === undefined ? DEFAULT_CONFIG.timeZone : timezone;
  if (typeof value === 'string' && parseIsoDay(value.trim()) !== null) return value.trim();
  const date = toDate(value);
  if (!date) return null;
  try {
    const parts = formatterFor(timeZone).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  } catch {
    return null;
  }
}

function businessDaysBetween(from, to, config) {
  const cfg = Object.assign({}, DEFAULT_CONFIG, isObject(config) ? config : {});
  const timeZone = isValidTimeZone(cfg.timeZone) ? cfg.timeZone : DEFAULT_CONFIG.timeZone;
  const a = calendarDay(from, timeZone);
  const b = calendarDay(to, timeZone);
  if (!a || !b) return 0;
  const start = parseIsoDay(a);
  let end = parseIsoDay(b);
  if (start === null || end === null || end <= start) return 0;
  end = Math.min(end, start + MAX_RANGE_DAYS);
  const workDays = new Set(Array.isArray(cfg.workDays) ? cfg.workDays : DEFAULT_CONFIG.workDays);
  const holidays = new Set(Array.isArray(cfg.holidays) ? cfg.holidays : []);
  let count = 0;
  for (let d = start + 1; d <= end; d += 1) {
    const weekday = (((d + 4) % 7) + 7) % 7;
    if (!workDays.has(weekday)) continue;
    if (holidays.size && holidays.has(dayToString(d))) continue;
    count += 1;
  }
  return count;
}

function canonical(value, depth) {
  const level = depth || 0;
  if (level > 20 || value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t === 'bigint') return value.toString();
  if (t === 'function' || t === 'symbol') return null;
  if (Array.isArray(value)) return value.map((v) => canonical(v, level + 1));
  if (typeof value.toDate === 'function') {
    const d = toDate(value);
    if (d) return d.toISOString();
  }
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonical(value[key], level + 1);
  return out;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function configError(errors) {
  const error = new RangeError('Configuración de supervisión inválida: ' + errors.join('; '));
  error.errors = errors;
  return error;
}

function cleanWeekdays(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 14) return null;
  if (!value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
  return Array.from(new Set(value)).sort((a, b) => a - b);
}

function cleanHolidays(value) {
  if (!Array.isArray(value) || value.length > 400) return null;
  if (!value.every((d) => typeof d === 'string' && parseIsoDay(d) !== null)) return null;
  return Array.from(new Set(value)).sort();
}

function cleanRecipients(value) {
  if (!Array.isArray(value) || value.length > 20) return null;
  const ok = value.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 128 && id.indexOf('/') === -1);
  return ok ? Array.from(new Set(value)) : null;
}

function validateConfig(input) {
  const source = input === undefined || input === null ? {} : input;
  if (!isPlainObject(source)) throw configError(['la configuración debe ser un objeto']);
  const errors = [];
  const out = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const d = DEFAULT_CONFIG[key];
    out[key] = Array.isArray(d) ? d.slice() : d;
  }
  for (const key of Object.keys(source)) {
    if (!hasOwn(DEFAULT_CONFIG, key)) {
      errors.push('clave no permitida: ' + key);
      continue;
    }
    const value = source[key];
    if (BOOLEAN_KEYS.includes(key)) {
      if (typeof value === 'boolean') out[key] = value;
      else errors.push(key + ' debe ser booleano');
    } else if (hasOwn(INTEGER_BOUNDS, key)) {
      const min = INTEGER_BOUNDS[key][0];
      const max = INTEGER_BOUNDS[key][1];
      if (Number.isInteger(value) && value >= min && value <= max) out[key] = value;
      else errors.push(key + ' debe ser un entero entre ' + min + ' y ' + max);
    } else if (key === 'timeZone') {
      if (isValidTimeZone(value)) out[key] = value;
      else errors.push('timeZone inválida');
    } else if (key === 'workDays' || key === 'sendDays') {
      const days = cleanWeekdays(value);
      if (days) out[key] = days;
      else errors.push(key + ' debe ser un arreglo no vacío de enteros 0-6');
    } else if (key === 'holidays') {
      const list = cleanHolidays(value);
      if (list) out[key] = list;
      else errors.push('holidays debe ser un arreglo de fechas ISO YYYY-MM-DD válidas');
    } else if (key === 'reportRecipientIds') {
      const ids = cleanRecipients(value);
      if (ids) out[key] = ids;
      else errors.push('reportRecipientIds admite hasta 20 textos de 1-128 caracteres sin /');
    } else if (key === 'aiModel') {
      if (typeof value === 'string' && (value === '' || /^gemini-[a-z0-9.-]+$/.test(value))) out[key] = value;
      else errors.push('aiModel debe ser vacío o un identificador gemini-[a-z0-9.-]+');
    }
  }
  if (!(out.reminderDays >= out.preventiveDays && out.preventiveDays >= out.urgentDays && out.urgentDays >= 0)) {
    errors.push('se requiere reminderDays >= preventiveDays >= urgentDays >= 0');
  }
  if (errors.length) throw configError(errors);
  return out;
}

function applyOverrides(base, overrides) {
  if (overrides === undefined || overrides === null) return { config: base, error: null };
  const fail = { config: base, error: 'supervisionOverrides inválidos: se usó la configuración global' };
  if (!isPlainObject(overrides)) return fail;
  if (!Object.keys(overrides).every((k) => OVERRIDE_KEYS.includes(k))) return fail;
  try {
    return { config: validateConfig(Object.assign({}, base, overrides)), error: null };
  } catch {
    return fail;
  }
}

function classifyStatus(raw) {
  const normalized = normalize(raw);
  for (const group of STATUS_GROUPS) {
    if (group[1].has(normalized)) return { kind: group[0], normalized };
  }
  return { kind: 'unknown', normalized };
}

function isHidden(project) {
  return (
    project.active === false ||
    project.hidden === true || project.hiddenFromHistory === true || project.permanentlyHiddenFromHistory === true || Boolean(project.closedAt) || Boolean(project.finishedAt) || Boolean(project.cancelledAt) ||
    project.deleted === true ||
    project.isDeleted === true ||
    project.archived === true ||
    project.isArchived === true ||
    Boolean(project.deletedAt)
  );
}

function evaluateItems(list, today, timeZone) {
  let pending = 0;
  let blocked = 0;
  let overdue = 0;
  for (const item of asArray(list)) {
    if (!isObject(item)) {
      pending += 1;
      continue;
    }
    const info = classifyStatus(item.status);
    const done = item.completed === true || info.kind === 'complete' || info.kind === 'cancelled' || ITEM_DONE.has(info.normalized);
    if (done) continue;
    pending += 1;
    if (item.blocked === true || info.kind === 'blocked') blocked += 1;
    const day = calendarDay(item.deadline, timeZone);
    if (day && day < today) overdue += 1;
  }
  return { pending, blocked, overdue };
}

function reviewOf(value) {
  const n = normalize(value);
  if (n === 'approved' || n === 'aprobado' || n === 'aprobada' || n === 'accepted') return 'approved';
  if (n === 'rejected' || n === 'rechazado' || n === 'rechazada') return 'rejected';
  return 'pending';
}

function timeOf(raw) {
  const d = toDate(raw);
  return d ? d.getTime() : null;
}

function compareRecent(a, b, keyA, keyB) {
  const ta = a.time === null ? -Infinity : a.time;
  const tb = b.time === null ? -Infinity : b.time;
  if (ta !== tb) return ta > tb ? -1 : 1;
  if (keyA === keyB) return 0;
  return keyA < keyB ? -1 : 1;
}

function collectEvidence(project) {
  const out = [];
  const seen = new Set();
  const add = (file, fallbackAt) => {
    const obj = typeof file === 'string' ? { filePath: file } : file;
    if (!isObject(obj)) return;
    const keys = ['filePath', 'id', 'url', 'downloadUrl'].map((k) => text(obj[k])).filter(Boolean);
    if (keys.some((k) => seen.has(k))) return;
    keys.forEach((k) => seen.add(k));
    const path = text(obj.filePath);
    const name = text(obj.fileName) || path.split('/').pop() || text(obj.id) || 'archivo';
    const at = obj.uploadedAt !== undefined && obj.uploadedAt !== null ? obj.uploadedAt : fallbackAt;
    out.push({
      identity: keys[0] || text(obj.fileName),
      index: out.length,
      name,
      status: reviewOf(obj.reviewStatus || obj.status || (obj.approved === true || obj.isApproved === true ? 'approved' : '')),
      at,
      time: timeOf(at),
      sourceId: null,
    });
  };
  asArray(project.evidenceFiles).forEach((f) => add(f, undefined));
  for (const list of [project.evidence, project.evidences, project.attachments, project.externalEvidence]) asArray(list).forEach((f) => add(f, f.createdAt));
  asArray(project.advances).forEach((a) => {
    if (isObject(a)) asArray(a.files).forEach((f) => add(f, a.createdAt));
  });
  return out;
}

function collectActivity(project) {
  const items = [];
  const push = (type, list) => {
    asArray(list).forEach((raw, index) => {
      if (!isObject(raw)) return;
      items.push({
        type,
        id: text(raw.id) || String(index),
        text: typeof raw.text === 'string' ? raw.text : '',
        raw: raw.createdAt,
        time: timeOf(raw.createdAt),
        sourceId: null,
      });
    });
  };
  push('advance', project.advances);
  push('comment', project.comments);
  return items;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function evaluateProject(project, config, now) {
  if (!isObject(project)) throw new TypeError('project debe ser un objeto');
  const nowDate = toDate(now);
  if (!nowDate) throw new TypeError('now debe ser una fecha válida');
  const base = validateConfig(config);
  const missing = [];
  const applied = applyOverrides(base, project.supervisionOverrides);
  if (applied.error) missing.push(applied.error);
  const cfg = applied.config;
  const tz = cfg.timeZone;
  const today = calendarDay(nowDate, tz);

  const idText = text(project.id);
  const pid = idText || 'sin-id';
  if (!idText) missing.push('Falta el identificador del proyecto');
  const title = typeof project.title === 'string' ? project.title.trim().slice(0, 180) : '';
  const statusRaw = typeof project.status === 'string' ? project.status.trim() : '';
  const statusInfo = classifyStatus(statusRaw);
  const kind = statusInfo.kind;
  const active = !TERMINAL_KINDS.has(kind) && !isHidden(project);
  const assigneeUid = text(project.assignedToUid) || text(project.assignedToId) || null;
  const assigneeName = text(project.assignedToName).slice(0, 120) || null;
  const progress = typeof project.progress === 'number' && Number.isFinite(project.progress) ? Math.min(100, Math.max(0, project.progress)) : 0;

  const deadlineDay = calendarDay(project.deadline, tz);
  const daysRemaining = deadlineDay ? parseIsoDay(deadlineDay) - parseIsoDay(today) : null;

  const evidence = collectEvidence(project).sort((a, b) => compareRecent(a, b, a.identity + a.name, b.identity + b.name));
  const activity = collectActivity(project).sort((a, b) => compareRecent(a, b, a.type + ':' + a.id, b.type + ':' + b.id));

  const checklist = isObject(project.reviewChecklist) ? project.reviewChecklist : null;
  const checklistItems = checklist ? asArray(checklist.items) : [];
  const checklistChecked = checklistItems.filter((i) => isObject(i) && i.checked === true).length;
  const checklistComplete = Boolean(checklist) && checklist.enabled === true && checklistItems.length > 0 && checklistChecked === checklistItems.length;

  const used = new Set();
  const sources = [];
  const pushSource = (baseId, type, content, at, analyzed) => {
    let candidate = clip(baseId, MAX_ID);
    let n = 2;
    while (used.has(candidate)) {
      candidate = clip(baseId, MAX_ID - 6) + '#' + n;
      n += 1;
    }
    used.add(candidate);
    const date = toDate(at);
    sources.push({ id: candidate, type, text: clip(content, MAX_TEXT), at: date ? date.toISOString() : null, contentAnalyzed: analyzed });
    return candidate;
  };
  const projectSourceId = pushSource('project:' + pid, 'project', (title || pid) + ' [' + (statusRaw || 'sin estado') + '], avance reportado ' + progress + '%, plazo ' + (deadlineDay || 'no registrado'), project.createdAt, true);
  if (checklist) {
    const label = checklist.enabled === true ? 'Checklist de revisión: ' + checklistChecked + '/' + checklistItems.length + ' completados' : 'Checklist de revisión deshabilitada';
    pushSource('project:' + pid + ':checklist', 'checklist', label, null, true);
  }
  activity.slice(0, MAX_ACTIVITY_SOURCES).forEach((a) => {
    a.sourceId = pushSource(a.type + ':' + a.id, a.type, a.text, a.raw, false);
  });
  evidence.slice(0, MAX_EVIDENCE_SOURCES).forEach((e) => {
    e.sourceId = pushSource('evidence:' + (e.identity || e.index), 'evidence', e.name, e.at, false);
  });

  const candidates = [];
  activity.forEach((a) => {
    if (a.time !== null && a.time <= nowDate.getTime()) candidates.push({ time: a.time, raw: a.raw });
  });
  asArray(project.history).forEach((h) => {
    if (!isObject(h)) return;
    const type = normalize(h.type);
    if (type !== 'avance' && type !== 'comentario') return;
    const time = timeOf(h.createdAt);
    if (time !== null && time <= nowDate.getTime()) candidates.push({ time, raw: h.createdAt });
  });
  const lastProgress = timeOf(project.lastProgressAt);
  if (lastProgress !== null && lastProgress <= nowDate.getTime()) candidates.push({ time: lastProgress, raw: project.lastProgressAt });
  let last = null;
  for (const c of candidates) {
    if (!last || c.time > last.time) last = c;
  }
  if (!last) {
    const created = timeOf(project.createdAt);
    if (created !== null && created <= nowDate.getTime()) last = { time: created, raw: project.createdAt };
  }
  const lastActivityAt = last ? new Date(last.time).toISOString() : null;

  let risk = 'bajo';
  let riskScore = 0;
  let overdue = false;
  let dueSoon = false;
  let inactive = false;
  let pendingEvidence = 0;
  let decisionPending = false;
  let readyForClosure = false;
  const reasons = [];

  if (active) {
    if (kind === 'unknown') missing.push(statusRaw ? 'Estado no reconocido: ' + clip(statusRaw, 64) : 'Falta el estado del proyecto');
    if (!deadlineDay) missing.push(project.deadline === undefined || project.deadline === null || project.deadline === '' ? 'Falta la fecha límite' : 'Fecha límite inválida');
    if (!assigneeUid && !assigneeName) missing.push('Falta responsable asignado');
    if (typeof project.progress !== 'number' || !Number.isFinite(project.progress)) missing.push('Falta el avance reportado');
    if (!last) missing.push('Sin actividad verificable: no hay avances, comentarios ni fecha de creación');

    const pendingCount = evidence.filter((e) => e.status === 'pending').length;
    const rejected = evidence.filter((e) => e.status === 'rejected');
    const approvedCount = evidence.filter((e) => e.status === 'approved').length;
    pendingEvidence = pendingCount;

    const groups = [project.deliverables, project.activities, project.milestones].map((l) => evaluateItems(l, today, tz));
    const itemsPending = groups.reduce((s, g) => s + g.pending, 0);
    const itemsBlocked = groups.reduce((s, g) => s + g.blocked, 0);
    const itemsOverdue = groups.reduce((s, g) => s + g.overdue, 0);
    const blocked = kind === 'blocked' || itemsBlocked > 0;

    overdue = daysRemaining !== null && daysRemaining < 0;
    dueSoon = daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= cfg.preventiveDays;
    let businessGap = 0;
    if (last) {
      businessGap = businessDaysBetween(calendarDay(last.raw, tz), today, cfg);
      inactive = businessGap >= cfg.inactivityBusinessDays;
    }
    const adminStatus = isObject(project.adminReview) ? normalize(project.adminReview.status) : '';
    const reviewPending = kind === 'ready' || REVIEW_PENDING.has(adminStatus);

    const lastSource = last && activity.length && activity[0].time === last.time && activity[0].sourceId ? activity[0].sourceId : projectSourceId;
    const rejectedSource = rejected.find((e) => e.sourceId);

    if (overdue) reasons.push({ code: 'DEADLINE_OVERDUE', message: 'El plazo venció hace ' + Math.abs(daysRemaining) + ' ' + plural(Math.abs(daysRemaining), 'día', 'días'), source: projectSourceId });
    if (blocked) reasons.push({ code: 'BLOCKED', message: 'Hay bloqueos registrados', source: projectSourceId });
    if (itemsOverdue > 0) reasons.push({ code: 'ITEMS_OVERDUE', message: 'Hay ' + itemsOverdue + ' elemento(s) con fecha vencida entre entregables, actividades e hitos', source: projectSourceId });
    if (inactive) reasons.push({ code: 'INACTIVE', message: 'Sin avances ni comentarios verificables desde hace ' + businessGap + ' días laborables', source: lastSource });
    if (rejected.length > 0) reasons.push({ code: 'EVIDENCE_REJECTED', message: rejected.length + ' evidencia(s) rechazada(s)', source: rejectedSource ? rejectedSource.sourceId : projectSourceId });
    if (kind === 'ready') reasons.push({ code: 'READY_FOR_REVIEW', message: 'El proyecto está listo para revisión', source: projectSourceId });

    if (overdue) risk = 'critico';
    else if ((blocked || itemsOverdue > 0) && daysRemaining !== null && daysRemaining <= cfg.urgentDays) risk = 'alto';
    else if (blocked || itemsOverdue > 0 || inactive || rejected.length > 0 || kind === 'ready') risk = 'medio';

    const weighted = reasons.reduce((s, r) => s + (WEIGHTS[r.code] || 0), 0);
    riskScore = Math.min(100, Math.max(RISK_FLOOR[risk], weighted));

    if (pendingCount > 0) reasons.push({ code: 'EVIDENCE_PENDING', message: pendingCount + ' evidencia(s) pendiente(s) de revisión', source: projectSourceId });
    if (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= cfg.reminderDays) {
      reasons.push({ code: 'REMINDER_WINDOW', message: 'Faltan ' + daysRemaining + ' ' + plural(daysRemaining, 'día', 'días') + ' para el plazo', source: projectSourceId });
    }
    if (risk !== 'bajo' && daysRemaining !== null && daysRemaining >= 0) {
      if (daysRemaining <= cfg.urgentDays) reasons.push({ code: 'DEADLINE_URGENT', message: 'Plazo urgente con riesgo detectado (' + daysRemaining + ' ' + plural(daysRemaining, 'día', 'días') + ')', source: projectSourceId });
      else if (daysRemaining <= cfg.preventiveDays) reasons.push({ code: 'DEADLINE_PREVENTIVE', message: 'Plazo cercano con riesgo detectado (' + daysRemaining + ' días)', source: projectSourceId });
    }

    decisionPending = risk !== 'bajo' || pendingCount > 0 || reviewPending;
    readyForClosure =
      kind === 'ready' &&
      evidence.length >= 1 &&
      approvedCount === evidence.length &&
      checklistComplete &&
      !blocked &&
      itemsPending === 0;
  }

  let suggestedMessage = '';
  if (active && reasons.length > 0) {
    const shown = reasons.slice(0, 3).map((r) => r.message).join('; ');
    suggestedMessage = 'Proyecto «' + (title || pid) + '»: ' + shown + '. Revisa el estado y confirma los siguientes pasos.';
  }

  const seenMissing = new Set();
  const missingInformation = missing.filter((m) => (seenMissing.has(m) ? false : seenMissing.add(m)));

  const core = {
    projectId: idText,
    title,
    status: statusRaw,
    assigneeUid,
    assigneeName,
    deadline: deadlineDay,
    progress,
    active,
    risk,
    riskScore,
    reasons,
    daysRemaining,
    inactive,
    overdue,
    dueSoon,
    pendingEvidence,
    decisionPending,
    readyForClosure,
    missingInformation,
    lastActivityAt,
    sources,
    suggestedMessage: !active ? '' : (suggestedMessage || ('Por favor, comparte los pendientes y el siguiente compromiso de entrega del proyecto «' + (title || pid) + '».')).slice(0, 600),
  };
  const version = VERSION_PREFIX + hash({ core, config: cfg, businessDay: today }).slice(0, 24);
  return Object.assign({}, core, { computedAt: nowDate.toISOString(), version });
}

function metricsFor(summary) {
  const s = isObject(summary) ? summary : {};
  const flag = (v) => (v === true ? 1 : 0);
  const isActive = s.active === true;
  const pending = Number(s.pendingEvidence);
  return {
    active: flag(isActive),
    completed: classifyStatus(s.status).kind === 'complete' ? 1 : 0,
    attention: isActive && (s.risk === 'medio' || s.risk === 'alto' || s.risk === 'critico') ? 1 : 0,
    pendingEvidence: isActive && Number.isFinite(pending) && pending > 0 ? pending : 0,
    dueSoon: flag(isActive && s.dueSoon === true),
    decisions: flag(isActive && s.decisionPending === true),
    inactive: flag(isActive && s.inactive === true),
    overdue: flag(isActive && s.overdue === true),
    readyForClosure: flag(isActive && s.readyForClosure === true),
    partialEvidenceProjects: flag(isActive && s.evidenceCountPartial === true),
  };
}

module.exports = {
  DEFAULT_CONFIG,
  validateConfig,
  evaluateProject,
  metricsFor,
  hash,
  normalize,
  calendarDay,
  businessDaysBetween,
};
