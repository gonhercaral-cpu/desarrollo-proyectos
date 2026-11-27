import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadHistory } from './service.js';
import { Button, Empty, Icon, Metric, Modal, Status } from './UI.jsx';
import { STATUS_META, TYPE_META, formatDate, getJobTypeMeta, getPriorityMeta, getStatusMeta, toDate } from './labels.js';

const PAGE_SIZE = 20;

const REPRINT_SUGGESTIONS = [
  'Reposición por unidades rechazadas en calidad',
  'Falla mecánica o atasco durante la impresión',
  'Daño en acabado o encuadernación',
  'Ajuste de color o nitidez',
];

function sanitizeCsvCell(raw) {
  if (raw === null || raw === undefined) return '""';
  let str = String(raw);
  if (/^[\t\r ]*[=+\-@]/.test(str) || /^[\t\r]/.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function getJobPrinters(job, printerMap) {
  const parts = Array.isArray(job?.parts) ? job.parts : [];
  const names = [];
  const seen = new Set();
  for (const part of parts) {
    const id = part?.printerId;
    const label =
      (id && printerMap.has(id) ? printerMap.get(id).name || id : part?.printerName || id) || '';
    if (label && !seen.has(label)) {
      seen.add(label);
      names.push(label);
    }
  }
  return names;
}

function formatActivitySummary(job) {
  const parts = Array.isArray(job?.parts) ? job.parts : [];
  const pieces = [];
  if (job?.config?.copies !== undefined && job?.config?.copies !== null) {
    pieces.push(`${job.config.copies} copias`);
  }
  if (parts.length > 0) {
    const done = parts.filter((p) => p?.status === 'completed').length;
    pieces.push(`${done}/${parts.length} tramos`);
  }
  if (job?.accepted !== undefined || job?.rejected !== undefined) {
    pieces.push(`Acep. ${job.accepted ?? 0} / Rech. ${job.rejected ?? 0}`);
  }
  if (job?.inventoried) {
    pieces.push('Inventariado');
  }
  if (typeof job?.eventsCount === 'number') {
    pieces.push(`${job.eventsCount} eventos`);
  }
  return pieces.length > 0 ? pieces.join(' · ') : 'Sin actividad adicional';
}

export default function History({ onOpen, onReprint, printers = [] }) {
  const safePrinters = useMemo(() => (Array.isArray(printers) ? printers : []), [printers]);
  const printerMap = useMemo(() => {
    const map = new Map();
    for (const printer of safePrinters) {
      if (printer?.id) map.set(printer.id, printer);
    }
    return map;
  }, [safePrinters]);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [printerFilter, setPrinterFilter] = useState('all');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [debouncedOperator, setDebouncedOperator] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [pageIndex, setPageIndex] = useState(0);
  const [cursorStack, setCursorStack] = useState([null]);
  const [nextCursor, setNextCursor] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);

  const [reprintJob, setReprintJob] = useState(null);
  const [reprintReason, setReprintReason] = useState('');
  const [reprintError, setReprintError] = useState('');
  const [reprintSubmitting, setReprintSubmitting] = useState(false);
  const [bannerMessage, setBannerMessage] = useState('');

  const requestSeqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 260);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedOperator(operatorFilter.trim());
    }, 260);
    return () => clearTimeout(timer);
  }, [operatorFilter]);

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        search: debouncedSearch,
        status: statusFilter,
        type: typeFilter,
        printerId: printerFilter,
        operator: debouncedOperator,
        dateFrom,
        dateTo,
      }),
    [debouncedSearch, statusFilter, typeFilter, printerFilter, debouncedOperator, dateFrom, dateTo]
  );

  const prevFilterKeyRef = useRef(filterKey);

  useEffect(() => {
    if (prevFilterKeyRef.current !== filterKey) {
      prevFilterKeyRef.current = filterKey;
      setPageIndex(0);
      setCursorStack([null]);
      setNextCursor(null);
    }
  }, [filterKey]);

  const currentCursor = cursorStack[pageIndex] ?? null;

  useEffect(() => {
    const seq = ++requestSeqRef.current;
    Promise.resolve().then(()=>{if(seq === requestSeqRef.current){setLoading(true);setError('');}});

    const params = {
      cursor: currentCursor,
      pageSize: PAGE_SIZE,
    };
    if (debouncedSearch) params.search = debouncedSearch;
    if (statusFilter !== 'all') params.status = statusFilter;
    if (typeFilter !== 'all') params.type = typeFilter;
    if (printerFilter !== 'all') params.printerId = printerFilter;
    if (debouncedOperator) params.operator = debouncedOperator;
    if (dateFrom) params.from = new Date(dateFrom+"T00:00:00");
    if (dateTo) params.to = new Date(new Date(dateTo+"T23:59:59.999").getTime()+1);

    Promise.resolve(loadHistory(params))
      .then((res) => {
        if (seq !== requestSeqRef.current) return;
        const list = Array.isArray(res?.jobs)
          ? res.jobs
          : Array.isArray(res)
            ? res
            : [];
        const returnedCursor = res && typeof res === 'object' ? res.cursor ?? null : null;
        setJobs(list);
        setNextCursor(returnedCursor);
      })
      .catch((err) => {
        if (seq !== requestSeqRef.current) return;
        setJobs([]);
        setNextCursor(null);
        setError(err?.message || 'No se pudo cargar el historial de producción.');
      })
      .finally(() => {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      });
  }, [
    currentCursor,
    debouncedSearch,
    statusFilter,
    typeFilter,
    printerFilter,
    debouncedOperator,
    dateFrom,
    dateTo,
    reloadToken,
  ]);

  const visibleJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const op = operatorFilter.trim().toLowerCase();
    const fromBoundary = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const toBoundary = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;

    return jobs.filter((job) => {
      if (statusFilter !== 'all' && job?.status !== statusFilter) return false;
      if (typeFilter !== 'all' && job?.type !== typeFilter) return false;

      if (printerFilter !== 'all') {
        const parts = Array.isArray(job?.parts) ? job.parts : [];
        if (!parts.some((p) => p?.printerId === printerFilter)) return false;
      }

      if (op) {
        const operatorName = String(job?.createdByName || job?.operatorName || '').toLowerCase();
        if (!operatorName.includes(op)) return false;
      }

      if (fromBoundary || toBoundary) {
        const created = toDate(job?.createdAt);
        if (!created) return false;
        if (fromBoundary && created < fromBoundary) return false;
        if (toBoundary && created > toBoundary) return false;
      }

      if (q) {
        const printerNames = getJobPrinters(job, printerMap).join(' ');
        const haystack = [
          job?.id,
          job?.title,
          job?.type,
          job?.status,
          getStatusMeta(job?.status).label,
          getJobTypeMeta(job?.type).label,
          job?.source?.name,
          job?.createdByName,
          job?.productId,
          printerNames,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [jobs, search, statusFilter, typeFilter, printerFilter, operatorFilter, dateFrom, dateTo, printerMap]);

  const typeOptions = useMemo(() => {
    const map = new Map();
    for (const key of ['book', 'certificate', 'credential', 'document', 'general']) {
      map.set(key, TYPE_META[key].label);
    }
    for (const job of jobs) {
      if (job?.type && !map.has(job.type)) {
        map.set(job.type, getJobTypeMeta(job.type).label);
      }
    }
    return Array.from(map.entries());
  }, [jobs]);

  const pageSummary = useMemo(() => {
    let completed = 0;
    let cancelled = 0;
    let totalCopies = 0;
    let totalAccepted = 0;
    let totalRejected = 0;
    const printersUsed = new Set();

    for (const job of visibleJobs) {
      if (job?.status === 'completed') completed += 1;
      if (job?.status === 'cancelled') cancelled += 1;
      totalCopies += Number(job?.config?.copies || 0);
      totalAccepted += Number(job?.accepted || 0);
      totalRejected += Number(job?.rejected || 0);
      for (const name of getJobPrinters(job, printerMap)) {
        printersUsed.add(name);
      }
    }

    return {
      count: visibleJobs.length,
      completed,
      cancelled,
      totalCopies,
      totalAccepted,
      totalRejected,
      printersCount: printersUsed.size,
    };
  }, [visibleJobs, printerMap]);

  const hasFilters =
    search.trim() !== '' ||
    statusFilter !== 'all' ||
    typeFilter !== 'all' ||
    printerFilter !== 'all' ||
    operatorFilter.trim() !== '' ||
    dateFrom !== '' ||
    dateTo !== '';

  function resetFilters() {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter('all');
    setTypeFilter('all');
    setPrinterFilter('all');
    setOperatorFilter('');
    setDebouncedOperator('');
    setDateFrom('');
    setDateTo('');
    setPageIndex(0);
    setCursorStack([null]);
    setNextCursor(null);
  }

  function handleNextPage() {
    if (!nextCursor || loading) return;
    const nextIdx = pageIndex + 1;
    setCursorStack((prev) => {
      const copy = prev.slice(0, nextIdx);
      copy[nextIdx] = nextCursor;
      return copy;
    });
    setPageIndex(nextIdx);
  }

  function handlePrevPage() {
    if (pageIndex === 0 || loading) return;
    setPageIndex((prev) => Math.max(0, prev - 1));
  }

  const handleExportCsv = useCallback(() => {
    if (visibleJobs.length === 0) return;

    const headers = [
      'ID',
      'Título',
      'Categoría',
      'Estado',
      'Fecha',
      'Operador',
      'Impresoras',
      'Documento',
      'Páginas',
      'Copias',
      'Dúplex',
      'Prioridad',
      'Aceptadas',
      'Rechazadas',
      'Inventariado',
      'Producto',
      'Actividad',
    ];

    const rows = visibleJobs.map((job) => [
      job.id || '',
      job.title || '',
      getJobTypeMeta(job.type).label,
      getStatusMeta(job.status).label,
      formatDate(job.createdAt),
      job.createdByName || '',
      getJobPrinters(job, printerMap).join(' | '),
      job.source?.name || '',
      job.source?.pages ?? '',
      job.config?.copies ?? '',
      job.config?.duplex ? 'Sí' : 'No',
      getPriorityMeta(job.config?.priority).label,
      job.accepted ?? '',
      job.rejected ?? '',
      job.inventoried ? 'Sí' : 'No',
      job.productId || '',
      formatActivitySummary(job),
    ]);

    const csvLines = [
      headers.map(sanitizeCsvCell).join(','),
      ...rows.map((row) => row.map(sanitizeCsvCell).join(',')),
    ];

    const csvContent = `\uFEFF${csvLines.join('\r\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `historial-produccion-${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [visibleJobs, printerMap]);

  function openReprintModal(job) {
    setReprintJob(job);
    setReprintReason('');
    setReprintError('');
    setBannerMessage('');
  }

  function closeReprintModal() {
    if (reprintSubmitting) return;
    setReprintJob(null);
    setReprintReason('');
    setReprintError('');
  }

  async function handleReprintSubmit(event) {
    event.preventDefault();
    if (!reprintJob || !onReprint || reprintSubmitting) return;
    const reason = reprintReason.trim();
    if (!reason) {
      setReprintError('Indica el motivo de la reimpresión antes de continuar.');
      return;
    }

    setReprintSubmitting(true);
    setReprintError('');
    try {
      await onReprint(reprintJob, reason);
      setBannerMessage(`Reimpresión solicitada para "${reprintJob.title || reprintJob.id}".`);
      setReprintJob(null);
      setReprintReason('');
    } catch (err) {
      setReprintError(err?.message || 'No se pudo procesar la reimpresión.');
    } finally {
      setReprintSubmitting(false);
    }
  }

  return (
    <section className="pp-history" aria-label="Historial de producción">
      <div className="pp-metrics">
        <Metric
          label="Registros en página"
          value={pageSummary.count}
          icon="list"
          tone="navy"
          detail={`Página ${pageIndex + 1} · ${pageSummary.printersCount} impresoras`}
        />
        <Metric
          label="Completados (página)"
          value={pageSummary.completed}
          icon="checkCircle"
          tone="emerald"
          detail={`${pageSummary.cancelled} cancelados en esta página`}
        />
        <Metric
          label="Copias configuradas"
          value={pageSummary.totalCopies}
          icon="layers"
          tone="blue"
          detail="Suma de registros visibles"
        />
        <Metric
          label="Unidades validadas"
          value={pageSummary.totalAccepted}
          icon="shield"
          tone="violet"
          detail={`${pageSummary.totalRejected} rechazadas en página`}
        />
      </div>

      <div className="pp-card pp-history-toolbar">
        <div className="pp-history-toolbar-top">
          <div>
            <h2 className="pp-section-title">Filtros de historial</h2>
            <p className="pp-muted-text">
              Consulta órdenes históricas, revisa su actividad o exporta los registros visibles.
            </p>
          </div>
          <div className="pp-history-toolbar-actions">
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Limpiar filtros
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              icon="reprint"
              onClick={() => setReloadToken((t) => t + 1)}
              loading={loading}
            >
              Actualizar
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon="download"
              onClick={handleExportCsv}
              disabled={visibleJobs.length === 0}
            >
              Exportar CSV ({visibleJobs.length})
            </Button>
          </div>
        </div>

        <div className="pp-history-filters">
          <div className="pp-field pp-field--wide">
            <label htmlFor="pp-hist-search">Búsqueda</label>
            <div className="pp-search-field">
              <Icon name="search" size={16} className="pp-search-icon" />
              <input
                id="pp-hist-search"
                type="search"
                className="pp-input pp-input--search"
                placeholder="Título, ID, documento, producto..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="pp-field">
            <label htmlFor="pp-hist-status">Estado</label>
            <select
              id="pp-hist-status"
              className="pp-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </div>

          <div className="pp-field">
            <label htmlFor="pp-hist-type">Categoría</label>
            <select
              id="pp-hist-type"
              className="pp-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              {typeOptions.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="pp-field">
            <label htmlFor="pp-hist-printer">Impresora</label>
            <select
              id="pp-hist-printer"
              className="pp-select"
              value={printerFilter}
              onChange={(e) => setPrinterFilter(e.target.value)}
            >
              <option value="all">Todas</option>
              {safePrinters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.id}
                </option>
              ))}
            </select>
          </div>

          <div className="pp-field">
            <label htmlFor="pp-hist-operator">Operador</label>
            <input
              id="pp-hist-operator"
              type="text"
              className="pp-input"
              placeholder="Nombre del operador"
              value={operatorFilter}
              onChange={(e) => setOperatorFilter(e.target.value)}
            />
          </div>

          <div className="pp-field">
            <label htmlFor="pp-hist-from">Desde</label>
            <input
              id="pp-hist-from"
              type="date"
              className="pp-input"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>

          <div className="pp-field">
            <label htmlFor="pp-hist-to">Hasta</label>
            <input
              id="pp-hist-to"
              type="date"
              className="pp-input"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      {bannerMessage ? (
        <div className="pp-feedback pp-feedback--success" role="status">
          <Icon name="checkCircle" size={16} />
          <span>{bannerMessage}</span>
        </div>
      ) : null}

      {error ? (
        <div className="pp-error" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => setReloadToken((t) => t + 1)}>
            Reintentar
          </Button>
        </div>
      ) : null}

      <div className="pp-card pp-history-table-card">
        {loading ? (
          <div className="pp-loading-box" role="status">
            Cargando registros del historial...
          </div>
        ) : visibleJobs.length === 0 ? (
          <Empty
            icon={hasFilters ? 'filter' : 'history'}
            title={hasFilters ? 'Sin resultados para estos filtros' : 'Sin registros en el historial'}
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={resetFilters}>
                  Restablecer filtros
                </Button>
              ) : null
            }
          >
            <p>
              {hasFilters
                ? 'Ajusta los criterios de fecha, estado, categoría o impresora para ampliar la búsqueda.'
                : 'Los trabajos procesados aparecerán aquí conforme se registren en producción.'}
            </p>
          </Empty>
        ) : (
          <>
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th scope="col">Trabajo</th>
                    <th scope="col">Categoría</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Impresora</th>
                    <th scope="col">Operador</th>
                    <th scope="col">Actividad</th>
                    <th scope="col" className="pp-th-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleJobs.map((job) => {
                    const typeMeta = getJobTypeMeta(job.type);
                    const printerNames = getJobPrinters(job, printerMap);

                    return (
                      <tr key={job.id}>
                        <td>
                          <div className="pp-cell-main">
                            <span className="pp-cell-title">{job.title || 'Trabajo sin título'}</span>
                            <span className="pp-cell-sub">
                              <span className="pp-mono">{job.id}</span>
                              {job.source?.name ? ` · ${job.source.name}` : ''}
                              {job.source?.pages ? ` (${job.source.pages} págs.)` : ''}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="pp-tag">
                            <Icon name={typeMeta.icon} size={14} />
                            <span>{typeMeta.label}</span>
                          </span>
                        </td>
                        <td>
                          <Status value={job.status} />
                        </td>
                        <td className="pp-cell-nowrap">{formatDate(job.createdAt)}</td>
                        <td>
                          {printerNames.length > 0 ? (
                            <span className="pp-cell-printers">{printerNames.join(', ')}</span>
                          ) : (
                            <span className="pp-muted-text">Sin asignar</span>
                          )}
                        </td>
                        <td>{job.createdByName || '—'}</td>
                        <td>
                          <span className="pp-cell-activity">{formatActivitySummary(job)}</span>
                        </td>
                        <td className="pp-td-actions">
                          <div className="pp-row-actions">
                            {onOpen ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                icon="eye"
                                onClick={() => onOpen(job)}
                              >
                                Detalle
                              </Button>
                            ) : null}
                            {onReprint && ['completed','quality','confirmation','partial','cancelled'].includes(job.status) ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                icon="reprint"
                                onClick={() => openReprintModal(job)}
                              >
                                Reimprimir
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pp-pagination" aria-label="Paginación del historial">
              <div className="pp-pagination-info">
                <span>Página {pageIndex + 1}</span>
                <span>·</span>
                <span>
                  Mostrando {visibleJobs.length}{' '}
                  {visibleJobs.length === 1 ? 'registro' : 'registros'}
                  {jobs.length !== visibleJobs.length ? ` (de ${jobs.length} cargados)` : ''}
                </span>
              </div>
              <div className="pp-pagination-controls">
                <Button
                  variant="secondary"
                  size="sm"
                  icon="chevronLeft"
                  onClick={handlePrevPage}
                  disabled={pageIndex === 0 || loading}
                >
                  Anterior
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={!nextCursor || loading}
                >
                  <span>Siguiente</span>
                  <Icon name="chevronRight" size={15} />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {reprintJob ? (
        <Modal title="Solicitar reimpresión" onClose={closeReprintModal}>
          <form className="pp-modal-form" onSubmit={handleReprintSubmit} noValidate>
            <div className="pp-modal-summary">
              <div className="pp-modal-summary-title">
                {reprintJob.title || 'Trabajo sin título'}
              </div>
              <div className="pp-modal-summary-meta">
                <span className="pp-mono">ID: {reprintJob.id}</span>
                <span>·</span>
                <Status value={reprintJob.status} />
                <span>·</span>
                <span>{reprintJob.config?.copies ?? 0} copias originales</span>
              </div>
            </div>

            <div className="pp-fields">
              <label className="pp-field">
                <span>Motivo de reimpresión *</span>
                <textarea
                  data-autofocus="true"
                  className="pp-textarea"
                  rows={3}
                  required
                  value={reprintReason}
                  onChange={(e) => {
                    setReprintReason(e.target.value);
                    if (reprintError) setReprintError('');
                  }}
                  placeholder="Describe claramente la causa de la reimpresión..."
                />
              </label>

              <div className="pp-chip-group" aria-label="Motivos frecuentes">
                {REPRINT_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="pp-chip"
                    onClick={() => {
                      setReprintReason(suggestion);
                      if (reprintError) setReprintError('');
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>

            {reprintError ? (
              <div className="pp-error" role="alert">
                <Icon name="alert" size={16} />
                <span>{reprintError}</span>
              </div>
            ) : null}

            <div className="pp-modal-foot">
              <Button variant="secondary" onClick={closeReprintModal} disabled={reprintSubmitting}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                type="submit"
                icon="reprint"
                loading={reprintSubmitting}
              >
                Confirmar reimpresión
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
