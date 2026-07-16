import {
  AUDIT_RANGE_FILTERS,
  DIGITAL_SIGNAGE_PLANTELES,
  PLAYBACK_ASSET_FILTERS,
  PLAYBACK_EVENT_FILTERS,
} from "../../utils/digitalSignage";
import {
  ActiveFilterSummary,
  ActivityTimeline,
  LogMetric,
  PlaybackActivitySummary,
} from "./SignageLogTimeline";

export default function SignagePlaybackPanel({
  logs,
  allLogs,
  stats,
  devices,
  playlists,
  campaigns,
  deviceFilter,
  plantelFilter,
  eventFilter,
  assetFilter,
  campaignFilter,
  playlistFilter,
  rangeFilter,
  onDeviceFilterChange,
  onPlantelFilterChange,
  onEventFilterChange,
  onAssetFilterChange,
  onCampaignFilterChange,
  onPlaylistFilterChange,
  onRangeFilterChange,
  SignageIcon,
  TypeBadge,
  InfoPair,
}) {
  const activeFilters = [
    deviceFilter !== "all" ? `Dispositivo: ${devices.find((device) => device.id === deviceFilter)?.name || deviceFilter}` : null,
    plantelFilter !== "all" ? `Plantel: ${plantelFilter}` : null,
    eventFilter !== "all" ? `Evento: ${PLAYBACK_EVENT_FILTERS.find((option) => option.value === eventFilter)?.label || eventFilter}` : null,
    assetFilter !== "all" ? `Tipo: ${PLAYBACK_ASSET_FILTERS.find((option) => option.value === assetFilter)?.label || assetFilter}` : null,
    campaignFilter !== "all" ? `Campaña: ${campaigns.find((campaign) => campaign.id === campaignFilter)?.name || campaignFilter}` : null,
    playlistFilter !== "all" ? `Playlist: ${playlists.find((playlist) => playlist.id === playlistFilter)?.name || playlistFilter}` : null,
    rangeFilter !== "7" ? `Rango: ${AUDIT_RANGE_FILTERS.find((option) => option.value === rangeFilter)?.label || rangeFilter}` : null,
  ].filter(Boolean);

  return (
    <section className="signage-panel signage-log-page signage-playback-panel">
      <div className="signage-panel-heading">
        <div>
          <h2>Reportes de reproducción</h2>
          <p>Evidencia técnica generada por el player: contenido iniciado, finalizado, errores y uso offline.</p>
        </div>
        <span className="signage-soft-badge">{logs.length} de {allLogs.length} eventos</span>
      </div>

      <div className="signage-log-kpis signage-playback-kpis">
        <LogMetric icon="play" label="Reproducciones hoy" value={stats.playsToday} tone="online" SignageIcon={SignageIcon} />
        <LogMetric icon="warning" label="Errores hoy" value={stats.errorsToday} tone="error" SignageIcon={SignageIcon} />
        <LogMetric icon="screen" label="Dispositivos con actividad" value={stats.activeDevices} tone="device" SignageIcon={SignageIcon} />
        <LogMetric icon="history" label="Eventos offline/cache" value={stats.offlineEvents} tone="offline" SignageIcon={SignageIcon} />
      </div>

      <div className="signage-log-toolbar signage-playback-filters">
        <label>
          Dispositivo
          <select value={deviceFilter} onChange={(event) => onDeviceFilterChange(event.target.value)}>
            <option value="all">Todos</option>
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{device.name || device.id}</option>
            ))}
          </select>
        </label>
        <label>
          Plantel
          <select value={plantelFilter} onChange={(event) => onPlantelFilterChange(event.target.value)}>
            <option value="all">Todos</option>
            {DIGITAL_SIGNAGE_PLANTELES.map((plantel) => (
              <option key={plantel} value={plantel}>{plantel}</option>
            ))}
          </select>
        </label>
        <label>
          Evento
          <select value={eventFilter} onChange={(event) => onEventFilterChange(event.target.value)}>
            {PLAYBACK_EVENT_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select value={assetFilter} onChange={(event) => onAssetFilterChange(event.target.value)}>
            {PLAYBACK_ASSET_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Campaña
          <select value={campaignFilter} onChange={(event) => onCampaignFilterChange(event.target.value)}>
            <option value="all">Todas</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>{campaign.name || campaign.id}</option>
            ))}
          </select>
        </label>
        <label>
          Playlist
          <select value={playlistFilter} onChange={(event) => onPlaylistFilterChange(event.target.value)}>
            <option value="all">Todas</option>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>{playlist.name || playlist.id}</option>
            ))}
          </select>
        </label>
        <label>
          Rango
          <select value={rangeFilter} onChange={(event) => onRangeFilterChange(event.target.value)}>
            {AUDIT_RANGE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="visual-outline-button signage-log-clear"
          onClick={() => {
            onDeviceFilterChange("all");
            onPlantelFilterChange("all");
            onEventFilterChange("all");
            onAssetFilterChange("all");
            onCampaignFilterChange("all");
            onPlaylistFilterChange("all");
            onRangeFilterChange("7");
          }}
        >
          Limpiar filtros
        </button>
      </div>

      <ActiveFilterSummary filters={activeFilters} />

      <ActivityTimeline
        kind="playback"
        logs={logs}
        emptyIcon="play"
        emptyTitle="Aún no hay eventos de reproducción"
        emptyHelper="Los eventos aparecerán cuando una pantalla empiece a reproducir contenido."
        sidebar={<PlaybackActivitySummary logs={logs} stats={stats} InfoPair={InfoPair} />}
        SignageIcon={SignageIcon}
        TypeBadge={TypeBadge}
      />
    </section>
  );
}
