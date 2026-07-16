export default function SignagePreviewPanel({
  previewMode,
  previewPlaylist,
  previewCampaign,
  previewDevice,
  playlists,
  campaigns,
  devices,
  activeCampaign,
  onPreviewModeChange,
  onPreviewPlaylistChange,
  onPreviewCampaignChange,
  onPreviewDeviceChange,
  onNewDevice,
  onPlaylists,
  onContent,
  onPreview,
  SignagePreview,
  PreviewMeta,
  QuickActions,
  getPreviewContextLabel,
  getShortDeviceId,
}) {
  return (
    <div className="signage-main-grid">
      <section className="signage-panel">
        <div className="signage-panel-heading">
          <div>
            <h2>Vista previa global</h2>
            <p>Selecciona un contenido, playlist, campaña o dispositivo para previsualizar cómo se verá en pantalla.</p>
          </div>
        </div>
        <SignagePreview
          key={`${previewMode}-${previewPlaylist?.id || "empty"}`}
          playlist={previewPlaylist}
          contextLabel={getPreviewContextLabel(previewMode, previewPlaylist, previewCampaign, previewDevice)}
        />
      </section>

      <aside className="signage-side-column">
        <section className="signage-panel">
          <h3>Seleccionar vista</h3>
          <label>
            Tipo de vista
            <select value={previewMode} onChange={(event) => onPreviewModeChange(event.target.value)}>
              <option value="playlist">Playlist</option>
              <option value="campaign">Campaña</option>
              <option value="device">Dispositivo</option>
            </select>
          </label>
          <label>
            Playlist
            <select value={previewPlaylist?.id || ""} onChange={(event) => onPreviewPlaylistChange(event.target.value)} disabled={previewMode !== "playlist"}>
              <option value="">Seleccionar playlist</option>
              {playlists.map((playlist) => (
                <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
              ))}
            </select>
          </label>
          <label>
            Campaña
            <select value={previewCampaign?.id || ""} onChange={(event) => onPreviewCampaignChange(event.target.value)} disabled={previewMode !== "campaign"}>
              <option value="">Seleccionar campaña</option>
              {campaigns.map((campaign) => (
                <option value={campaign.id} key={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
          <label>
            Dispositivo
            <select value={previewDevice?.id || ""} onChange={(event) => onPreviewDeviceChange(event.target.value)} disabled={previewMode !== "device"}>
              <option value="">Seleccionar dispositivo</option>
              {devices.map((device) => (
                <option value={device.id} key={device.id}>{device.name || getShortDeviceId(device)}</option>
              ))}
            </select>
          </label>
          <PreviewMeta
            mode={previewMode}
            playlist={previewPlaylist}
            campaign={previewCampaign}
            device={previewDevice}
            activeCampaign={activeCampaign}
          />
        </section>

        <QuickActions
          onNewDevice={onNewDevice}
          onPlaylists={onPlaylists}
          onContent={onContent}
          onPreview={onPreview}
        />
      </aside>
    </div>
  );
}
