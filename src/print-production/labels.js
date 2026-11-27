import { TYPES } from "./model.js";
export const STATUS_META = {
  draft: { label: 'Borrador', tone: 'neutral', icon: 'file' },
  queued: { label: 'En cola', tone: 'blue', icon: 'clock' },
  paused: { label: 'Pausado', tone: 'amber', icon: 'pause' },
  printing: { label: 'En proceso', tone: 'electric', icon: 'printer' },
  partial: { label: 'Parcial', tone:'amber', icon:'clock' },
  submitted: { label: 'Aceptado por la cola', tone:'blue', icon:'printer' },
  confirmation: { label: 'Por confirmar', tone: 'violet', icon: 'checkCircle' },
  quality: { label: 'Control de calidad', tone: 'cyan', icon: 'shield' },
  completed: { label: 'Completado', tone: 'emerald', icon: 'check' },
  cancelled: { label: 'Cancelado', tone: 'rose', icon: 'x' },
};

export const TYPE_META = {
  ...Object.fromEntries(Object.entries(TYPES).map(([id,label])=>[id,{label,icon:"file"}])),
  book: { label: 'Libro', icon: 'book' },
  libro: { label: 'Libro', icon: 'book' },
  manual: { label: 'Manual', icon: 'book' },
  certificate: { label: 'Certificado', icon: 'certificate' },
  certificado: { label: 'Certificado', icon: 'certificate' },
  credential: { label: 'Credencial', icon: 'credential' },
  credencial: { label: 'Credencial', icon: 'credential' },
  document: { label: 'Documento', icon: 'file' },
  documento: { label: 'Documento', icon: 'file' },
  general: { label: 'General', icon: 'layers' },
};

export const PRIORITY_META = {
  urgent: { label: 'Urgente', tone: 'rose' },
  urgente: { label: 'Urgente', tone: 'rose' },
  high: { label: 'Alta', tone: 'amber' },
  alta: { label: 'Alta', tone: 'amber' },
  normal: { label: 'Normal', tone: 'neutral' },
  low: { label: 'Baja', tone: 'slate' },
  baja: { label: 'Baja', tone: 'slate' },
};

export function getStatusMeta(value) {
  const key = String(value || '').toLowerCase();
  if (STATUS_META[key]) return STATUS_META[key];
  return { label: value ? String(value) : 'Sin estado', tone: 'neutral', icon: 'info' };
}

export function getJobTypeMeta(value) {
  const key = String(value || '').toLowerCase();
  if (TYPE_META[key]) return TYPE_META[key];
  if (key.includes('certif') || key.includes('diplom') || key.includes('constan')) {
    return { label: String(value), icon: 'certificate' };
  }
  if (key.includes('creden') || key.includes('gafet') || key.includes('badge')) {
    return { label: String(value), icon: 'credential' };
  }
  if (key.includes('book') || key.includes('libr') || key.includes('manua')) {
    return { label: String(value), icon: 'book' };
  }
  return { label: value ? String(value) : 'General', icon: 'layers' };
}

export function getPriorityMeta(value) {
  const key = String(value || '').toLowerCase();
  if (PRIORITY_META[key]) return PRIORITY_META[key];
  return { label: value ? String(value) : 'Normal', tone: 'neutral' };
}

export function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        const d = value.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }
    const seconds =
      typeof value.seconds === 'number'
        ? value.seconds
        : typeof value._seconds === 'number'
          ? value._seconds
          : null;
    if (seconds !== null) {
      const nanos =
        typeof value.nanoseconds === 'number'
          ? value.nanoseconds
          : typeof value._nanoseconds === 'number'
            ? value._nanoseconds
            : 0;
      const d = new Date(seconds * 1000 + Math.floor(nanos / 1e6));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (typeof value === 'number') {
    const ms = Math.abs(value) < 1e11 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDate(value, options = {}) {
  const date = toDate(value);
  if (!date) return '—';
  try {
    const fmt = options.dateOnly
      ? { day: '2-digit', month: 'short', year: 'numeric' }
      : { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Intl.DateTimeFormat('es-MX', fmt).format(date);
  } catch {
    return date.toLocaleString('es');
  }
}
