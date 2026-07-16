import {
  getAuditActionLabel,
  getAuditActionTone,
  getAuditDetailsSummary,
  getAuditEntityLabel,
  getAuditToneLabel,
  getPlaybackEventLabel,
  getPlaybackEventTone,
  getPlaybackSourceLabel,
  isAuditPublishAction,
} from "../../utils/digitalSignage";

export function LogMetric({ icon, label, value, tone, SignageIcon }) {
  return (
    <article className={`signage-log-metric ${tone}`}>
      <span className="signage-log-metric-icon"><SignageIcon name={icon} /></span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

export function ActiveFilterSummary({ filters }) {
  if (!filters.length) return null;

  return (
    <div className="signage-active-filters">
      <strong>Mostrando eventos filtrados</strong>
      <div>
        {filters.map((filter) => (
          <span className="signage-chip" key={filter}>{filter}</span>
        ))}
      </div>
    </div>
  );
}

export function ActivityTimeline({
  kind,
  logs,
  emptyIcon,
  emptyTitle,
  emptyHelper,
  sidebar,
  SignageIcon,
  TypeBadge,
}) {
  const visibleLogs = logs.slice(0, 100);
  const groups = groupLogsByDate(visibleLogs);

  return (
    <div className="signage-activity-layout">
      <div className="signage-activity-main">
        {visibleLogs.length === 0 ? (
          <LogEmptyState icon={emptyIcon} title={emptyTitle} helper={emptyHelper} SignageIcon={SignageIcon} />
        ) : (
          <div className="signage-timeline">
            {groups.map((group) => (
              <section className="signage-timeline-group" key={group.key}>
                <h3 className="signage-timeline-date">{group.label}</h3>
                <div className="signage-timeline-items">
                  {group.items.map((log) => (
                    <TimelineItem key={log.id} kind={kind} log={log} TypeBadge={TypeBadge} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <aside className="signage-activity-sidebar">
        {sidebar}
      </aside>
    </div>
  );
}

export function PlaybackActivitySummary({ logs, stats, InfoPair }) {
  const latest = logs[0] || null;
  const lastError = logs.find((log) => log.eventType === "play_error") || null;
  const busiestDevice = getMostFrequentLabel(logs, (log) => log.deviceName || log.deviceId);

  return (
    <section className="signage-activity-summary">
      <h3>Resumen</h3>
      <InfoPair label="Evento más reciente" value={latest ? getPlaybackEventLabel(latest.eventType) : "Sin eventos"} />
      <InfoPair label="Último error" value={lastError ? lastError.errorMessage || lastError.assetTitle || "Error reciente" : "Sin errores recientes"} />
      <InfoPair label="Más actividad" value={busiestDevice || "Sin actividad"} />
      <InfoPair label="Estado general" value={stats.errorsToday > 0 ? "Requiere atención" : "Sin errores recientes"} />
    </section>
  );
}

export function AuditActivitySummary({ logs, stats, InfoPair }) {
  const latest = logs[0] || null;
  const activeUser = getMostFrequentLabel(logs, (log) => log.createdByName);
  const todayStart = getAuditRangeStartMillis("today");
  const publicationsToday = logs.filter((log) => getLogMillis(log) >= todayStart && isAuditPublishAction(log)).length;

  return (
    <section className="signage-activity-summary">
      <h3>Resumen</h3>
      <InfoPair label="Última acción" value={latest ? getAuditActionLabel(latest.action) : "Sin actividad"} />
      <InfoPair label="Usuario activo" value={activeUser || "Sin actividad"} />
      <InfoPair label="Cambios hoy" value={String(stats.changesToday)} />
      <InfoPair label="Publicaciones hoy" value={String(publicationsToday)} />
    </section>
  );
}

function LogEmptyState({ icon, title, helper, SignageIcon }) {
  return (
    <div className="signage-log-empty">
      <span><SignageIcon name={icon} /></span>
      <strong>{title}</strong>
      <p>{helper}</p>
    </div>
  );
}

function TimelineItem({ kind, log, TypeBadge }) {
  const isPlayback = kind === "playback";
  const tone = isPlayback ? getPlaybackEventTone(log.eventType) : getAuditActionTone(log.action);
  const title = isPlayback ? getPlaybackEventLabel(log.eventType) : getAuditActionLabel(log.action);
  const subtitle = isPlayback ? getPlaybackTimelineSubtitle(log) : getAuditTimelineSubtitle(log);
  const details = getLogDetailPairs(isPlayback ? getPlaybackDetails(log) : log.details);

  return (
    <article className={`signage-timeline-item ${tone}`}>
      <div className="signage-timeline-rail">
        <span className={`signage-timeline-icon ${tone}`}>{getTimelineSymbol(tone)}</span>
      </div>

      <div className="signage-timeline-content">
        <div className="signage-timeline-header">
          <div>
            <strong className="signage-timeline-title">{title}</strong>
            <span className="signage-timeline-subtitle">{subtitle}</span>
          </div>
          <time className="signage-timeline-time">{formatTimelineTime(log.createdAt)}</time>
        </div>

        <div className="signage-timeline-meta">
          {isPlayback ? (
            <>
              <span className={`signage-log-badge ${tone}`}>{getPlaybackEventLabel(log.eventType)}</span>
              <span className="signage-chip">{log.deviceName || log.deviceId || "Dispositivo"}</span>
              <span className="signage-chip">{log.plantel || "Sin plantel"}</span>
              {log.assetType && <TypeBadge type={log.assetType} />}
              {log.source && <span className="signage-soft-badge">{getPlaybackSourceLabel(log.source)}</span>}
              {log.errorMessage && <span className="signage-log-error">{log.errorMessage}</span>}
            </>
          ) : (
            <>
              <span className={`signage-log-badge ${tone}`}>{getAuditToneLabel(tone)}</span>
              <span className={`signage-audit-badge ${log.entityType || "system"}`}>
                {getAuditEntityLabel(log.entityType)}
              </span>
              <span className="signage-chip">{log.createdByName || "Administrador"}</span>
              <span className="signage-soft-badge">{getAuditDetailsSummary(log.details)}</span>
            </>
          )}
        </div>

        {details.length > 0 && (
          <details className="signage-log-detail">
            <summary className="signage-log-detail-toggle">Ver detalles</summary>
            <div className="signage-log-detail-panel">
              {details.map(([label, value]) => (
                <div className="signage-log-detail-pair" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </article>
  );
}

function groupLogsByDate(logs = []) {
  const groups = new Map();

  logs.forEach((log) => {
    const group = getTimelineDateGroup(getLogMillis(log));

    if (!groups.has(group.key)) {
      groups.set(group.key, { ...group, items: [] });
    }

    groups.get(group.key).items.push(log);
  });

  return Array.from(groups.values());
}

function getTimelineDateGroup(millis) {
  if (!millis) return { key: "sin-fecha", label: "Sin fecha" };

  const date = new Date(millis);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startTarget) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return { key: "hoy", label: "Hoy" };
  if (diffDays === 1) return { key: "ayer", label: "Ayer" };
  if (diffDays > 1 && diffDays < 7) return { key: "esta-semana", label: "Esta semana" };

  return {
    key: date.toISOString().slice(0, 10),
    label: date.toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" }),
  };
}

function formatTimelineTime(timestamp) {
  const millis = timestamp?.toMillis?.() || 0;
  if (!millis) return "Sin hora";

  return new Date(millis).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimelineSymbol(tone = "") {
  const symbols = {
    play: "▶",
    success: "✓",
    error: "!",
    warning: "!",
    offline: "◷",
    resolved: "↻",
    device: "•",
  };

  return symbols[tone] || "•";
}

function getPlaybackTimelineSubtitle(log = {}) {
  const asset = log.assetTitle || "Evento del reproductor";
  const device = log.deviceName || log.deviceId || "Dispositivo";
  const relation = log.campaignName || log.campaignId || log.playlistName || log.playlistId || "";

  return [asset, device, relation].filter(Boolean).join(" · ");
}

function getAuditTimelineSubtitle(log = {}) {
  const user = log.createdByName || "Administrador";
  const entity = log.entityName || log.entityId || "Elemento sin nombre";

  return `${user} · ${entity}`;
}

function getPlaybackDetails(log = {}) {
  return {
    deviceName: log.deviceName,
    plantel: log.plantel,
    location: log.location,
    assetTitle: log.assetTitle,
    assetType: log.assetType,
    playlistName: log.playlistName || log.playlistId,
    campaignName: log.campaignName || log.campaignId,
    source: log.source ? getPlaybackSourceLabel(log.source) : "",
    durationSeconds: log.durationSeconds,
    errorMessage: log.errorMessage,
    localTimestamp: log.localTimestamp,
  };
}

function getLogDetailPairs(details = {}) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];

  return Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 10)
    .map(([key, value]) => [
      getLogDetailLabel(key),
      Array.isArray(value) ? value.join(", ") : String(value),
    ]);
}

function getLogDetailLabel(key = "") {
  const labels = {
    sourceFileName: "Archivo",
    sourceFolderName: "Carpeta",
    source: "Origen",
    publishStatus: "Publicación",
    previousStatus: "Estado anterior",
    active: "Activo",
    plantel: "Plantel",
    playlistId: "Playlist",
    playlistName: "Playlist",
    assignedPlaylistId: "Playlist asignada",
    campaignId: "Campaña",
    campaignName: "Campaña",
    priority: "Prioridad",
    itemsCount: "Contenidos",
    type: "Tipo",
    deviceName: "Dispositivo",
    location: "Ubicación",
    assetTitle: "Contenido",
    assetType: "Tipo de contenido",
    durationSeconds: "Duración",
    errorMessage: "Error",
    localTimestamp: "Hora local",
  };

  return labels[key] || key;
}

function getMostFrequentLabel(items = [], getLabel) {
  const counts = new Map();

  items.forEach((item) => {
    const label = String(getLabel(item) || "").trim();
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });

  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function getLogMillis(log = {}) {
  return (
    Number(log.createdAtMillis || 0) ||
    log.createdAt?.toMillis?.() ||
    0
  );
}

function getAuditRangeStartMillis(range = "7") {
  const now = new Date();

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  const days = Number(range);
  if (!Number.isFinite(days) || days <= 0) return 0;

  return Date.now() - days * 24 * 60 * 60 * 1000;
}
