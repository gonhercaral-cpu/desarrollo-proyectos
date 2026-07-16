export default function SignageHealthPanel({
  rows,
  stats,
  search,
  filter,
  onSearchChange,
  onFilterChange,
  onOpenDevice,
  onCopyDeviceUrl,
  SignageIcon,
  StatusBadge,
  InfoPair,
  formatLastSeen,
  getMaskedDeviceToken,
}) {
  return (
    <section className="signage-panel signage-health-panel">
      <div className="signage-panel-heading">
        <div>
          <h2>Panel de salud</h2>
          <p>Monitoreo operativo de pantallas, contenido asignado y conexión reciente.</p>
        </div>
      </div>

      <div className="signage-health-kpis">
        <HealthMetric label="En línea" value={stats.online} status="online" />
        <HealthMetric label="Desconectadas" value={stats.offline} status="offline" />
        <HealthMetric label="Sin contenido" value={stats.unassigned} status="unassigned" />
        <HealthMetric label="Inactivas" value={stats.inactive} status="inactive" />
        <HealthMetric label="Requieren atención" value={stats.attention} status="attention" />
      </div>

      <div className="signage-health-toolbar">
        <label className="signage-search">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por nombre, plantel o ubicación..."
          />
          <SignageIcon name="search" />
        </label>

        <div className="signage-health-filters">
          {[
            ["all", "Todos"],
            ["online", "En línea"],
            ["offline", "Desconectadas"],
            ["unassigned", "Sin contenido"],
            ["inactive", "Inactivas"],
            ["attention", "Requieren atención"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => onFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="signage-health-list">
        {rows.length === 0 && <p className="digital-empty">Sin dispositivos para este filtro.</p>}
        {rows.map((row) => (
          <HealthDeviceRow
            key={row.device.id}
            row={row}
            onOpenDevice={onOpenDevice}
            onCopyDeviceUrl={onCopyDeviceUrl}
            StatusBadge={StatusBadge}
            InfoPair={InfoPair}
            formatLastSeen={formatLastSeen}
            getMaskedDeviceToken={getMaskedDeviceToken}
          />
        ))}
      </div>
    </section>
  );
}

function HealthMetric({ label, value, status }) {
  return (
    <article className={`signage-health-metric ${status}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function HealthDeviceRow({
  row,
  onOpenDevice,
  onCopyDeviceUrl,
  StatusBadge,
  InfoPair,
  formatLastSeen,
  getMaskedDeviceToken,
}) {
  const { device, status, requiresAttention, contentLabel, attentionReason } = row;

  return (
    <article className={`signage-health-row ${requiresAttention ? "needs-attention" : ""}`}>
      <div className="signage-health-main">
        <div>
          <strong>{device.name || "Pantalla sin nombre"}</strong>
          <span>{device.plantel || "Sin plantel"} - {device.location || "Sin ubicación"}</span>
        </div>
        <div className="signage-health-badges">
          <StatusBadge status={status} />
          {requiresAttention && <span className="signage-attention-badge">Requiere atención</span>}
        </div>
      </div>

      {requiresAttention && (
        <p className="signage-attention-reason">{attentionReason}</p>
      )}

      <div className="signage-health-details">
        <InfoPair label="Última conexión" value={formatLastSeen(device)} />
        <InfoPair label="Contenido activo" value={contentLabel} strong />
        <InfoPair label="assignedPlaylistId" value={device.assignedPlaylistId || "Sin asignar"} />
        <InfoPair label="active" value={device.active === false ? "false" : "true"} />
        <InfoPair label="deviceToken" value={getMaskedDeviceToken(device)} />
      </div>

      <div className="signage-card-actions signage-compact-actions">
        <button type="button" className="visual-outline-button" onClick={() => onOpenDevice(device)}>
          Ver dispositivo
        </button>
        <button type="button" className="visual-outline-button" onClick={() => onCopyDeviceUrl(device)}>
          Copiar URL
        </button>
      </div>
    </article>
  );
}
