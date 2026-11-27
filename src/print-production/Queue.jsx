import { useEffect, useMemo, useRef, useState } from 'react';
import JobActions from './JobActions.jsx';
import { getEvents } from './service.js';
import { Button, Empty, Icon, Metric, Status } from './UI.jsx';
import { STATUS_META, formatDate, getJobTypeMeta, getPriorityMeta } from './labels.js';

const LIFECYCLE_STEPS = [
  { key: 'draft', label: 'Borrador' },
  { key: 'queued', label: 'En cola' },
  { key: 'printing', label: 'Impresión' },
  { key: 'confirmation', label: 'Validación' },
  { key: 'completed', label: 'Completado' },
];

const EVENT_LABELS = {
  note_added:'Nota de operación', reprint_created:'Borrador de reimpresión creado', reprint_requested:'Reimpresión solicitada',
  quality_reviewed:'Calidad registrada', inventory_applied:'Entrada a inventario', supplies_consumed:'Consumo registrado', reconciled:'Tramo conciliado',
  priority_changed:'Prioridad actualizada', agent_accepted:'Trabajo aceptado por el agente', spoolCompleted:'Cola local finalizada',

  created: 'Trabajo creado',
  queued: 'Enviado a cola',
  started: 'Impresión iniciada',
  printing: 'En proceso',
  pause: 'Pausado',
  paused: 'Pausado',
  resume: 'Reanudado',
  resumed: 'Reanudado',
  cancel: 'Cancelado',
  cancelled: 'Cancelado',
  accept: 'Validación registrada',
  validated: 'Validación registrada',
  quality: 'Control de calidad',
  completed: 'Completado',
  inventory: 'Ingreso a inventario',
  inventoried: 'Inventariado',
  reprint: 'Reimpresión solicitada',
  reassign: 'Reasignación de impresora',
  reassigned: 'Reasignación de impresora',
  note: 'Nota operativa',
  incident: 'Incidencia reportada',
  incidencia: 'Incidencia reportada',
  edited: 'Configuración editada',
};

function isCertificateJob(job) {
  const type = String(job?.type || '').toLowerCase();
  return (
    type === 'certificate' ||
    type === 'certificado' ||
    type === 'certificados' ||
    type.includes('certif') ||
    type.includes('constan') ||
    type.includes('diplom')
  );
}

function getPrinterName(printerId, printerMap, fallback) {
  if (printerId && printerMap.has(printerId)) {
    return printerMap.get(printerId).name || printerId;
  }
  return fallback || printerId || 'Sin impresora';
}

function computePartsProgress(job) {
  const parts = Array.isArray(job?.parts) ? job.parts.filter(p => p.status !== 'cancelled' || p.pendingRemainder) : [];
  const totalParts = parts.length;
  if (totalParts === 0) {
    return {
      hasParts: false,
      totalParts: 0,
      completedParts: 0,
      printingParts: 0,
      pausedParts: 0,
      percent: null,
      totalPlannedPages: null,
      completedPlannedPages: null,
    };
  }

  let completedParts = 0;
  let printingParts = 0;
  let pausedParts = 0;
  let totalPlannedPages = 0;
  let completedPlannedPages = 0;
  let hasCompleteRanges = true;

  for (const part of parts) {
    const st = String(part?.status || '').toLowerCase();
    if (st === 'completed') completedParts += 1;
    else if (st === 'printing') printingParts += 1;
    else if (st === 'paused') pausedParts += 1;

    const from = Number(part?.from);
    const to = Number(part?.to);
    const copies = Number(part?.copies ?? job?.config?.copies ?? 1);
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from && Number.isFinite(copies) && copies > 0) {
      const partPages = (to - from + 1) * copies;
      totalPlannedPages += partPages;
      if (st === 'completed') {
        completedPlannedPages += partPages;
      }
    } else {
      hasCompleteRanges = false;
    }
  }

  const percent =
    hasCompleteRanges && totalPlannedPages > 0
      ? Math.round((completedPlannedPages / totalPlannedPages) * 100)
      : Math.round((completedParts / totalParts) * 100);

  return {
    hasParts: true,
    totalParts,
    completedParts,
    printingParts,
    pausedParts,
    percent,
    totalPlannedPages: hasCompleteRanges ? totalPlannedPages : null,
    completedPlannedPages: hasCompleteRanges ? completedPlannedPages : null,
  };
}

function extractEstimate(job) {
  if (!job) return null;
  const items = [];
  const est = job.estimate && typeof job.estimate === 'object' ? job.estimate : null;

  const minutes =
    job.etaMinutes ?? job.estimatedMinutes ??
    job.estimatedDuration ??
    est?.minutes ??
    est?.durationMinutes ??
    job.config?.estimatedMinutes;
  if (minutes !== undefined && minutes !== null && minutes !== '') {
    const num = Number(minutes);
    items.push({
      label: 'Duración estimada',
      value: Number.isFinite(num) ? `${num} min` : String(minutes),
    });
  }

  const eta = job.eta ?? job.estimatedCompletionAt ?? job.estimatedAt ?? est?.eta ?? est?.completionAt;
  if (eta) {
    items.push({
      label: 'Entrega estimada',
      value: formatDate(eta),
    });
  }

  const estPages = job.estimatedPages ?? est?.pages;
  if (estPages !== undefined && estPages !== null && estPages !== '') {
    items.push({
      label: 'Volumen estimado',
      value: `${estPages} págs.`,
    });
  }

  if (typeof job.estimate === 'string' && job.estimate.trim()) {
    items.push({
      label: 'Referencia estimada',
      value: job.estimate.trim(),
    });
  }

  return items.length > 0 ? items : null;
}

function normalizeEvent(ev, index) {
  ev = {...ev?.details, ...ev};
  const rawType = String(ev?.type || ev?.action || ev?.kind || 'event').toLowerCase();
  const isIncident =
    rawType === 'incident' ||
    rawType === 'incidencia' ||
    ev?.kind === 'incident' ||
    ev?.payload?.kind === 'incident' ||
    Boolean(ev?.severity || ev?.payload?.severity);
  const isNote = isIncident || rawType === 'note' || rawType === 'nota' || rawType === 'note_added';

  const title =
    ev?.title ||
    (isIncident ? 'Incidencia reportada' : EVENT_LABELS[rawType]) ||
    ev?.label ||
    rawType;

  const detail =
    ev?.message ||
    ev?.text ||
    ev?.note ||
    ev?.reason ||
    ev?.detail ||
    ev?.payload?.text ||
    ev?.payload?.note ||
    ev?.payload?.reason ||
    '';

  const actor =
    ev?.byName || ev?.actor || ev?.actorName ||
    ev?.userName ||
    ev?.createdByName ||
    ev?.by ||
    ev?.user ||
    '';

  const at = ev?.createdAt || ev?.timestamp || ev?.at || ev?.date || null;
  const severity = ev?.severity || ev?.payload?.severity || null;

  const metaParts = [];
  const accepted = ev?.accepted ?? ev?.payload?.accepted;
  const rejected = ev?.rejected ?? ev?.payload?.rejected;
  if (accepted !== undefined || rejected !== undefined) {
    metaParts.push(`Aceptadas: ${accepted ?? 0} · Rechazadas: ${rejected ?? 0}`);
  }
  const copies = ev?.copies ?? ev?.payload?.copies;
  if (copies !== undefined && rawType === 'reprint') {
    metaParts.push(`Copias solicitadas: ${copies}`);
  }
  const quantity = ev?.quantity ?? ev?.payload?.quantity;
  if (quantity !== undefined && (rawType === 'inventory' || rawType === 'inventoried')) {
    metaParts.push(`Unidades inventariadas: ${quantity}`);
  }

  return {
    id: ev?.id || `ev-${index}`,
    rawType,
    isNote,
    isIncident,
    severity,
    title,
    detail,
    meta: metaParts.join(' · '),
    actor,
    at,
  };
}

function getStageIndex(status) {
  switch (status) {
    case 'draft':
      return 0;
    case 'queued':
      return 1;
    case 'printing':
    case 'paused':
      return 2;
    case 'confirmation':
    case 'quality':
      return 3;
    case 'completed':
      return 4;
    default:
      return -1;
  }
}

export default function Queue({
  jobs = [],
  printers = [],
  selectedId,
  onSelect,
  onAction,
  onDocument,
  onNavigate,
  onEdit,
  isAdmin = false, settings, user, supplyItems,
}) {
  const safeJobs = useMemo(() => (Array.isArray(jobs) ? jobs : []), [jobs]);
  const safePrinters = useMemo(() => (Array.isArray(printers) ? printers : []), [printers]);

  const printerMap = useMemo(() => {
    const map = new Map();
    for (const printer of safePrinters) {
      if (printer?.id) map.set(printer.id, printer);
    }
    return map;
  }, [safePrinters]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [printerFilter, setPrinterFilter] = useState('all');
  const [internalSelectedId, setInternalSelectedId] = useState(null);

  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventsVersion, setEventsVersion] = useState(0);
  const [timelineTab, setTimelineTab] = useState('all');

  const detailTopRef = useRef(null);

  const availableTypes = useMemo(() => {
    const set = new Set();
    for (const job of safeJobs) {
      if (job?.type) set.add(job.type);
    }
    return Array.from(set);
  }, [safeJobs]);

  const kpis = useMemo(() => {
    let printing = 0;
    let printingCopies = 0;
    let queued = 0;
    let draft = 0;
    let paused = 0;
    let review = 0;
    let completed = 0;
    let inventoried = 0;

    for (const job of safeJobs) {
      const copies = Number(job?.config?.copies || 0);
      switch (job?.status) {
        case 'printing':
          printing += 1;
          printingCopies += copies;
          break;
        case 'queued':
          queued += 1;
          break;
        case 'draft':
          draft += 1;
          break;
        case 'paused':
          paused += 1;
          break;
        case 'confirmation':
        case 'quality':
          review += 1;
          break;
        case 'completed':
          completed += 1;
          if (job?.inventoried) inventoried += 1;
          break;
        default:
          break;
      }
    }

    return {
      printing,
      printingDetail: printingCopies > 0 ? `${printingCopies} copias en producción` : 'Sin copias activas',
      queued,
      queuedDetail: draft > 0 ? `${draft} en borrador` : 'Listos para asignar',
      paused,
      pausedDetail: review > 0 ? `${review} en validación o calidad` : 'Sin bloqueos adicionales',
      completed,
      completedDetail: `${inventoried} con ingreso a inventario`,
    };
  }, [safeJobs]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return safeJobs.filter((job) => {
      if (statusFilter === 'active') {
        if (job.status === 'completed' || job.status === 'cancelled') return false;
      } else if (statusFilter !== 'all' && job.status !== statusFilter) {
        return false;
      }

      if (typeFilter !== 'all' && job.type !== typeFilter) return false;

      if (printerFilter !== 'all') {
        const parts = Array.isArray(job.parts) ? job.parts : [];
        if (!parts.some((p) => p?.printerId === printerFilter)) return false;
      }

      if (q) {
        const parts = Array.isArray(job.parts) ? job.parts : [];
        const printerNames = parts
          .map((p) => getPrinterName(p?.printerId, printerMap, p?.printerName))
          .join(' ');
        const haystack = [
          job.id,
          job.title,
          job.type,
          job.source?.name,
          job.createdByName,
          job.productId,
          printerNames,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [safeJobs, search, statusFilter, typeFilter, printerFilter, printerMap]);

  const effectiveSelectedId = selectedId !== undefined ? selectedId : internalSelectedId;

  const selectedJob = useMemo(() => {
    if (filteredJobs.length === 0) return null;
    if (effectiveSelectedId) {
      const found = filteredJobs.find((j) => j.id === effectiveSelectedId);
      if (found) return found;
    }
    return filteredJobs[0];
  }, [filteredJobs, effectiveSelectedId]);

  const selectedJobId = selectedJob?.id || null;


  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      if (cancelled) return;
      setEventsError('');
      setTimelineTab('all');
      if (!selectedJobId) {setEvents([]);setEventsLoading(false);return;}
      setEventsLoading(true);
      try {
        const list=await getEvents(selectedJobId);
        if(!cancelled)setEvents(list);
      } catch(error) {
        if(!cancelled){setEvents([]);setEventsError(error.message);}
      } finally {if(!cancelled)setEventsLoading(false);}
    });
    return () => {
      cancelled = true;
    };
  }, [selectedJobId, eventsVersion]);

  const normalizedEvents = useMemo(
    () => events.map((ev, index) => normalizeEvent(ev, index)),
    [events]
  );

  const visibleEvents = useMemo(() => {
    if (timelineTab === 'notes') {
      return normalizedEvents.filter((ev) => ev.isNote);
    }
    return normalizedEvents;
  }, [normalizedEvents, timelineTab]);

  const notesCount = useMemo(
    () => normalizedEvents.filter((ev) => ev.isNote).length,
    [normalizedEvents]
  );

  const hasFilters =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    typeFilter !== 'all' ||
    printerFilter !== 'all';

  function resetFilters() {
    setSearch('');
    setStatusFilter('all');
    setTypeFilter('all');
    setPrinterFilter('all');
  }

  function handleSelectJob(job) {
    setInternalSelectedId(job.id);
    onSelect?.(job.id);
  }

  const progress = useMemo(() => computePartsProgress(selectedJob), [selectedJob]);
  const estimateItems = useMemo(() => extractEstimate(selectedJob), [selectedJob]);
  const stageIndex = selectedJob ? getStageIndex(selectedJob.status) : -1;

  return (
    <section className="pp-queue" aria-label="Cola de producción">
      <div className="pp-metrics">
        <Metric
          label="En proceso"
          value={kpis.printing}
          icon="printer"
          tone="blue"
          detail={kpis.printingDetail}
        />
        <Metric
          label="En cola"
          value={kpis.queued}
          icon="clock"
          tone="navy"
          detail={kpis.queuedDetail}
        />
        <Metric
          label="Pausado"
          value={kpis.paused}
          icon="pause"
          tone="amber"
          detail={kpis.pausedDetail}
        />
        <Metric
          label="Terminado"
          value={kpis.completed}
          icon="checkCircle"
          tone="emerald"
          detail={kpis.completedDetail}
        />
      </div>

      {safeJobs.length === 0 ? (
        <div className="pp-card">
          <Empty
            icon="printer"
            title="La cola de producción está vacía"
            action={
              onNavigate ? (
                <Button
                  variant="primary"
                  icon="plus"
                  onClick={() => onNavigate('new')}
                >
                  Crear trabajo de impresión
                </Button>
              ) : null
            }
          >
            <p>
              Aún no hay trabajos registrados en la cola. Cuando se envíen órdenes desde el
              módulo de producción o solicitudes, aparecerán aquí para seguimiento y control.
            </p>
          </Empty>
        </div>
      ) : (
        <div className="pp-queue-layout">
          <aside className="pp-card pp-queue-sidebar" aria-label="Listado y filtros de cola">
            <div className="pp-sidebar-head">
              <div className="pp-search-field">
                <Icon name="search" size={16} className="pp-search-icon" />
                <label htmlFor="pp-queue-search" className="pp-sr-only">
                  Buscar trabajos en cola
                </label>
                <input
                  id="pp-queue-search"
                  type="search"
                  className="pp-input pp-input--search"
                  placeholder="Buscar por título, ID, archivo, operador..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="pp-filter-row">
                <div className="pp-filter-item">
                  <label htmlFor="pp-queue-status" className="pp-sr-only">
                    Filtrar por estado
                  </label>
                  <select
                    id="pp-queue-status"
                    className="pp-select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">Todos los estados</option>
                    <option value="active">Solo activos</option>
                    {Object.entries(STATUS_META).map(([key, meta]) => (
                      <option key={key} value={key}>
                        {meta.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pp-filter-item">
                  <label htmlFor="pp-queue-type" className="pp-sr-only">
                    Filtrar por tipo
                  </label>
                  <select
                    id="pp-queue-type"
                    className="pp-select"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="all">Todas las categorías</option>
                    {availableTypes.map((t) => (
                      <option key={t} value={t}>
                        {getJobTypeMeta(t).label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {safePrinters.length > 0 ? (
                <div className="pp-filter-item">
                  <label htmlFor="pp-queue-printer" className="pp-sr-only">
                    Filtrar por impresora
                  </label>
                  <select
                    id="pp-queue-printer"
                    className="pp-select"
                    value={printerFilter}
                    onChange={(e) => setPrinterFilter(e.target.value)}
                  >
                    <option value="all">Todas las impresoras</option>
                    {safePrinters.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="pp-sidebar-meta">
                <span>
                  {filteredJobs.length} de {safeJobs.length} trabajos
                </span>
                {hasFilters ? (
                  <button type="button" className="pp-link-btn" onClick={resetFilters}>
                    Limpiar filtros
                  </button>
                ) : null}
              </div>
            </div>

            {filteredJobs.length === 0 ? (
              <div className="pp-sidebar-empty">
                <Empty
                  icon="filter"
                  title="Sin coincidencias"
                  action={
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                      Restablecer filtros
                    </Button>
                  }
                >
                  <p>No hay trabajos que coincidan con los filtros seleccionados.</p>
                </Empty>
              </div>
            ) : (
              <ul className="pp-queue-list" role="listbox" aria-label="Trabajos en cola">
                {filteredJobs.map((job) => {
                  const isSelected = selectedJob?.id === job.id;
                  const typeMeta = getJobTypeMeta(job.type);
                  const priorityMeta = getPriorityMeta(job.config?.priority);
                  const jobProgress = computePartsProgress(job);
                  const parts = Array.isArray(job.parts) ? job.parts : [];
                  const uniquePrinters = Array.from(
                    new Set(
                      parts
                        .map((p) => getPrinterName(p?.printerId, printerMap, p?.printerName))
                        .filter(Boolean)
                    )
                  );

                  return (
                    <li key={job.id} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        className={`pp-queue-row ${isSelected ? 'pp-queue-row--active' : ''}`.trim()}
                        onClick={() => handleSelectJob(job)}
                      >
                        <div className="pp-queue-row-top">
                          <span className="pp-queue-row-type">
                            <Icon name={typeMeta.icon} size={15} />
                            <span>{typeMeta.label}</span>
                          </span>
                          <Status value={job.status} />
                        </div>

                        <div className="pp-queue-row-title">{job.title || 'Trabajo sin título'}</div>

                        <div className="pp-queue-row-sub">
                          <span>{job.config?.copies ?? 0} copias</span>
                          {job.source?.pages ? <span>· {job.source.pages} págs.</span> : null}
                          {job.config?.priority && job.config.priority !== 'normal' ? (
                            <span className={`pp-pill pp-pill--${priorityMeta.tone}`}>
                              {priorityMeta.label}
                            </span>
                          ) : null}
                        </div>

                        <div className="pp-queue-row-foot">
                          <span className="pp-truncate">
                            {uniquePrinters.length > 0
                              ? uniquePrinters.join(', ')
                              : 'Sin impresora asignada'}
                          </span>
                          <span>{formatDate(job.createdAt, { dateOnly: true })}</span>
                        </div>

                        {jobProgress.hasParts ? (
                          <div className="pp-mini-progress" aria-label={`Avance por tramos: ${jobProgress.percent}%`}>
                            <div className="pp-mini-progress-track">
                              <div
                                className="pp-mini-progress-bar"
                                style={{ width: `${jobProgress.percent}%` }}
                              />
                            </div>
                            <span className="pp-mini-progress-text">
                              {jobProgress.completedParts}/{jobProgress.totalParts}
                            </span>
                          </div>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <div className="pp-queue-detail" ref={detailTopRef}>
            {!selectedJob ? (
              <div className="pp-card">
                <Empty icon="list" title="Selecciona un trabajo">
                  <p>Elige un registro de la lista izquierda para consultar su estado, tramos e historial.</p>
                </Empty>
              </div>
            ) : (
              <>
                <div className="pp-card pp-detail-hero">
                  <div className="pp-detail-hero-top">
                    <div className="pp-detail-title-group">
                      <div className="pp-detail-eyebrow">
                        <span className="pp-tag">
                          <Icon name={getJobTypeMeta(selectedJob.type).icon} size={14} />
                          <span>{getJobTypeMeta(selectedJob.type).label}</span>
                        </span>
                        <span className="pp-mono">ID: {selectedJob.id}</span>
                        {selectedJob.productId ? (
                          <span className="pp-tag pp-tag--subtle">
                            <Icon name="box" size={14} />
                            <span>Prod. {selectedJob.productId}</span>
                          </span>
                        ) : null}
                      </div>
                      <h2 className="pp-detail-title">{selectedJob.title || 'Trabajo sin título'}</h2>
                      <div className="pp-detail-meta">
                        <span>
                          <Icon name="user" size={14} />
                          <span>{selectedJob.createdByName || 'Operador no especificado'}</span>
                        </span>
                        <span>
                          <Icon name="calendar" size={14} />
                          <span>{formatDate(selectedJob.createdAt)}</span>
                        </span>
                        {selectedJob.config?.priority ? (
                          <span className={`pp-pill pp-pill--${getPriorityMeta(selectedJob.config.priority).tone}`}>
                            Prioridad {getPriorityMeta(selectedJob.config.priority).label}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="pp-detail-hero-side">
                      <Status value={selectedJob.status} />
                      <div className="pp-detail-quick-actions">
                        {selectedJob.source && onDocument ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon="eye"
                            onClick={() => onDocument(selectedJob.source)}
                          >
                            Vista previa
                          </Button>
                        ) : null}
                        {onEdit && selectedJob.status === 'draft' ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon="edit"
                            onClick={() => onEdit(selectedJob)}
                          >
                            Editar
                          </Button>
                        ) : null}
                        {isCertificateJob(selectedJob) && onNavigate ? (
                          <Button
                            variant="primary"
                            size="sm"
                            icon="external"
                            onClick={() => onNavigate('requests', selectedJob)}
                          >
                            Ir a Solicitudes
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="pp-spec-strip">
                    <div className="pp-spec-item">
                      <span className="pp-spec-label">Documento</span>
                      <span className="pp-spec-value pp-truncate" title={selectedJob.source?.name || ''}>
                        {selectedJob.source?.name || 'Sin archivo vinculado'}
                      </span>
                    </div>
                    <div className="pp-spec-item">
                      <span className="pp-spec-label">Páginas</span>
                      <span className="pp-spec-value">
                        {selectedJob.source?.pages ?? '—'}
                      </span>
                    </div>
                    <div className="pp-spec-item">
                      <span className="pp-spec-label">Copias</span>
                      <span className="pp-spec-value">
                        {selectedJob.config?.copies ?? '—'}
                      </span>
                    </div>
                    <div className="pp-spec-item">
                      <span className="pp-spec-label">Impresión</span>
                      <span className="pp-spec-value">
                        {selectedJob.config?.duplex ? 'Dúplex (ambas caras)' : 'Una cara'}
                      </span>
                    </div>
                    <div className="pp-spec-item">
                      <span className="pp-spec-label">Inventario</span>
                      <span className="pp-spec-value">
                        {selectedJob.inventoried ? (
                          <span className="pp-inline-status pp-inline-status--ok">
                            <Icon name="box" size={14} />
                            <span>Inventariado</span>
                          </span>
                        ) : (
                          <span className="pp-inline-status">
                            <Icon name="box" size={14} />
                            <span>Pendiente</span>
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="pp-progress-card">
                    <div className="pp-progress-head">
                      <div>
                        <h3 className="pp-section-title">Estado real y avance</h3>
                        <p className="pp-muted-text">
                          {progress.hasParts
                            ? `Avance calculado a partir de tramos cerrados (${progress.completedParts} de ${progress.totalParts}). No incluye telemetría en vivo del equipo.`
                            : 'Seguimiento basado únicamente en cambios de estado registrados.'}
                        </p>
                      </div>
                      {progress.hasParts ? (
                        <div className="pp-progress-pct">{progress.percent}%</div>
                      ) : null}
                    </div>

                    {progress.hasParts ? (
                      <div className="pp-progress-bar-wrap">
                        <div
                          className="pp-progress-track"
                          role="progressbar"
                          aria-valuenow={progress.percent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Avance de tramos completados"
                        >
                          <div
                            className="pp-progress-fill"
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                        <div className="pp-progress-stats">
                          <span>Completados: {progress.completedParts}</span>
                          <span>En proceso: {progress.printingParts}</span>
                          <span>Pausados: {progress.pausedParts}</span>
                          {progress.totalPlannedPages !== null ? (
                            <span>
                              Páginas de tramos cerrados: {progress.completedPlannedPages} / {progress.totalPlannedPages}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <ol className="pp-stepper" aria-label="Etapas del trabajo">
                        {LIFECYCLE_STEPS.map((step, idx) => {
                          const isDone = stageIndex > idx || (stageIndex === 4 && idx === 4);
                          const isCurrent = stageIndex === idx && selectedJob.status !== 'cancelled';
                          return (
                            <li
                              key={step.key}
                              className={`pp-step ${isDone ? 'pp-step--done' : ''} ${isCurrent ? 'pp-step--current' : ''}`.trim()}
                            >
                              <span className="pp-step-dot" aria-hidden="true" />
                              <span className="pp-step-label">{step.label}</span>
                            </li>
                          );
                        })}
                      </ol>
                    )}

                    {(selectedJob.accepted !== undefined || selectedJob.rejected !== undefined) ? (
                      <div className="pp-validation-strip">
                        <span className="pp-validation-chip pp-validation-chip--ok">
                          <Icon name="check" size={14} />
                          <span>Aceptadas: {selectedJob.accepted ?? 0}</span>
                        </span>
                        <span className="pp-validation-chip pp-validation-chip--bad">
                          <Icon name="x" size={14} />
                          <span>Rechazadas: {selectedJob.rejected ?? 0}</span>
                        </span>
                      </div>
                    ) : null}

                    {estimateItems ? (
                      <div className="pp-estimate-box" role="note" aria-label="Datos estimados">
                        <div className="pp-estimate-badge">
                          <Icon name="clock" size={14} />
                          <span>Estimación referencial</span>
                        </div>
                        <div className="pp-estimate-values">
                          {estimateItems.map((item) => (
                            <span key={item.label}>
                              <strong>{item.label}:</strong> {item.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {onAction && <JobActions key={selectedJob.id} job={selectedJob} printers={printers} isAdmin={isAdmin} settings={settings} user={user} supplyItems={supplyItems} onAction={onAction} onRecorded={()=>setEventsVersion(v=>v+1)}/>}
                </div>

                <div className="pp-detail-split">
                  <section className="pp-card pp-detail-block" aria-label="Asignaciones y rangos">
                    <div className="pp-block-head">
                      <div>
                        <h3 className="pp-section-title">Distribución y rangos</h3>
                        <p className="pp-muted-text">
                          Asignaciones por impresora y páginas configuradas.
                        </p>
                      </div>
                      <span className="pp-badge pp-badge--neutral">
                        {(selectedJob.parts || []).length} tramos
                      </span>
                    </div>

                    {!Array.isArray(selectedJob.parts) || selectedJob.parts.length === 0 ? (
                      <div className="pp-inline-empty">
                        <Icon name="printer" size={20} />
                        <span>Sin asignaciones de impresora registradas para este trabajo.</span>
                      </div>
                    ) : (
                      <div className="pp-parts-list">
                        {selectedJob.parts.map((part, idx) => {
                          const printer = printerMap.get(part.printerId);
                          const printerName = getPrinterName(part.printerId, printerMap, part.printerName);
                          const from = Number(part.from);
                          const to = Number(part.to);
                          const copies = Number(part.copies ?? selectedJob.config?.copies ?? 1);
                          const rangeCount =
                            Number.isFinite(from) && Number.isFinite(to) && to >= from
                              ? to - from + 1
                              : null;
                          const volume =
                            rangeCount !== null && Number.isFinite(copies) && copies > 0
                              ? rangeCount * copies
                              : null;

                          return (
                            <div key={part.id || idx} className="pp-part-card">
                              <div className="pp-part-head">
                                <div className="pp-part-printer">
                                  <span className="pp-part-icon" aria-hidden="true">
                                    <Icon name="printer" size={16} />
                                  </span>
                                  <div>
                                    <div className="pp-part-name">{printerName}</div>
                                    <div className="pp-part-sub">
                                      Tramo #{idx + 1}
                                      {printer?.location ? ` · ${printer.location}` : ''}
                                      {printer?.status ? ` · Equipo: ${printer.status}` : ''}
                                    </div>
                                  </div>
                                </div>
                                <Status value={part.status || selectedJob.status} />
                              </div>

                              <div className="pp-part-metrics">
                                <div>
                                  <span className="pp-spec-label">Rango</span>
                                  <span className="pp-part-val">
                                    Págs. {part.from ?? '—'}–{part.to ?? '—'}
                                    {rangeCount !== null ? ` (${rangeCount} págs.)` : ''}
                                  </span>
                                </div>
                                <div>
                                  <span className="pp-spec-label">Copias</span>
                                  <span className="pp-part-val">{part.copies ?? '—'}</span>
                                </div>
                                <div>
                                  <span className="pp-spec-label">Total del tramo</span>
                                  <span className="pp-part-val">
                                    {volume !== null ? `${volume} págs.` : '—'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  <section className="pp-card pp-detail-block" aria-label="Línea de tiempo y notas">
                    <div className="pp-block-head">
                      <div>
                        <h3 className="pp-section-title">Línea de tiempo y bitácora</h3>
                        <p className="pp-muted-text">
                          Eventos, cambios de estado, notas e incidencias registradas.
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="reprint"
                        onClick={() => setEventsVersion((v) => v + 1)}
                        loading={eventsLoading}
                        aria-label="Actualizar línea de tiempo"
                      >
                        Actualizar
                      </Button>
                    </div>

                    <div className="pp-segmented" role="tablist" aria-label="Filtro de bitácora">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={timelineTab === 'all'}
                        className={`pp-segmented-btn ${timelineTab === 'all' ? 'pp-segmented-btn--active' : ''}`.trim()}
                        onClick={() => setTimelineTab('all')}
                      >
                        Todo ({normalizedEvents.length})
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={timelineTab === 'notes'}
                        className={`pp-segmented-btn ${timelineTab === 'notes' ? 'pp-segmented-btn--active' : ''}`.trim()}
                        onClick={() => setTimelineTab('notes')}
                      >
                        Notas e incidencias ({notesCount})
                      </button>
                    </div>

                    {eventsLoading ? (
                      <div className="pp-loading-box" role="status">
                        Cargando eventos del trabajo...
                      </div>
                    ) : eventsError ? (
                      <div className="pp-error" role="alert">
                        <Icon name="alert" size={16} />
                        <span>{eventsError}</span>
                      </div>
                    ) : visibleEvents.length === 0 ? (
                      <div className="pp-inline-empty">
                        <Icon name="history" size={20} />
                        <span>
                          {timelineTab === 'notes'
                            ? 'No hay notas ni incidencias registradas en este trabajo.'
                            : 'Aún no se registran eventos para este trabajo.'}
                        </span>
                      </div>
                    ) : (
                      <ol className="pp-timeline">
                        {visibleEvents.map((ev) => (
                          <li
                            key={ev.id}
                            className={`pp-timeline-item ${ev.isIncident ? 'pp-timeline-item--incident' : ev.isNote ? 'pp-timeline-item--note' : ''}`.trim()}
                          >
                            <span className="pp-timeline-dot" aria-hidden="true" />
                            <div className="pp-timeline-content">
                              <div className="pp-timeline-top">
                                <span className="pp-timeline-title">{ev.title}</span>
                                {ev.severity ? (
                                  <span className={`pp-pill pp-pill--${ev.severity === 'high' ? 'rose' : ev.severity === 'medium' ? 'amber' : 'neutral'}`}>
                                    Severidad {ev.severity === 'high' ? 'alta' : ev.severity === 'medium' ? 'media' : 'baja'}
                                  </span>
                                ) : null}
                                <time className="pp-timeline-time">{formatDate(ev.at)}</time>
                              </div>
                              {ev.detail ? <p className="pp-timeline-detail">{ev.detail}</p> : null}
                              {ev.meta ? <div className="pp-timeline-meta">{ev.meta}</div> : null}
                              {ev.actor ? (
                                <div className="pp-timeline-actor">
                                  <Icon name="user" size={13} />
                                  <span>{ev.actor}</span>
                                </div>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
