import {
  PUBLISH_STATUS_OPTIONS,
  getPublishStatus,
} from "../../utils/digitalSignage";

export default function SignagePlaylistsPanel({
  playlists,
  selectedPlaylist,
  effectiveSelectedPlaylistId,
  activeAssets,
  assetToAddId,
  playlistForm,
  editingPlaylistId,
  saving,
  onSelectPlaylist,
  onEditPlaylist,
  onDuplicatePlaylist,
  onTogglePlaylistActive,
  onPlaylistPublishStatusChange,
  onDeletePlaylist,
  onAssetToAddChange,
  onAddAssetToPlaylist,
  onPlaylistItemsChange,
  onSubmitPlaylist,
  onPlaylistFormChange,
  onCancelPlaylistEdit,
  StatusBadge,
  PublishStatusBadge,
  PlantelSelect,
  PlaylistItemsEditor,
  SignagePreviewCard,
  getPlaylistItemCountLabel,
  getPlaylistDurationSeconds,
  getPlaylistSummary,
  getPlaylistPublishIssue,
  formatDuration,
}) {
  return (
    <div className="signage-main-grid">
      <section className="signage-panel">
        <div className="signage-panel-heading">
          <div>
            <h2>Playlists</h2>
            <p>Orden, duración y estado del contenido programado.</p>
          </div>
        </div>

        <div className="signage-playlist-selector">
          {playlists.length === 0 && (
            <p className="digital-empty">Sin playlists registradas. Crea una playlist para agrupar contenidos.</p>
          )}
          {playlists.map((playlist) => (
            <article
              key={playlist.id}
              className={`signage-list-row signage-playlist-card ${effectiveSelectedPlaylistId === playlist.id ? "active" : ""}`}
            >
              <button
                type="button"
                className="signage-playlist-select"
                onClick={() => onSelectPlaylist(playlist.id)}
              >
                <strong>{playlist.name}</strong>
                <span>{playlist.plantel || "Sin plantel"}</span>
                <div className="signage-badge-row">
                  <StatusBadge status={playlist.active === false ? "inactive" : "active"} />
                  <PublishStatusBadge status={playlist.publishStatus} />
                  <span className="signage-soft-badge">{getPlaylistItemCountLabel(playlist)}</span>
                  <span className="signage-soft-badge">{formatDuration(getPlaylistDurationSeconds(playlist))}</span>
                </div>
                <small>{getPlaylistSummary(playlist)}</small>
              </button>
              <div className="signage-list-actions signage-compact-actions">
                <button type="button" className="visual-outline-button" onClick={() => onSelectPlaylist(playlist.id)} disabled={saving}>
                  Ver contenido
                </button>
                <button type="button" className="visual-outline-button" onClick={() => onEditPlaylist(playlist)} disabled={saving}>
                  Editar
                </button>
                <details className="signage-action-menu">
                  <summary>Más</summary>
                  <div className="signage-action-menu-popover">
                    <button type="button" onClick={() => onDuplicatePlaylist(playlist)} disabled={saving}>
                      Duplicar
                    </button>
                    <button type="button" onClick={() => onTogglePlaylistActive(playlist)} disabled={saving}>
                      {playlist.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <label>
                      Publicación
                      <select
                        className="signage-publish-select"
                        value={getPublishStatus(playlist.publishStatus)}
                        onChange={(event) => onPlaylistPublishStatusChange(playlist, event.target.value)}
                        disabled={saving}
                      >
                        {PUBLISH_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="danger" onClick={() => onDeletePlaylist(playlist)} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </details>
              </div>
            </article>
          ))}
        </div>

        {!selectedPlaylist ? (
          <p className="digital-empty">Selecciona o crea una playlist.</p>
        ) : (
          <>
            <div className="signage-playlist-toolbar">
              <div>
                <h3>{selectedPlaylist.name}</h3>
                <p>
                  {selectedPlaylist.plantel || "Sin plantel"} - {getPlaylistItemCountLabel(selectedPlaylist)} - {formatDuration(getPlaylistDurationSeconds(selectedPlaylist))}
                </p>
                <div className="signage-badge-row">
                  <StatusBadge status={selectedPlaylist.active === false ? "inactive" : "active"} />
                  <PublishStatusBadge status={selectedPlaylist.publishStatus} />
                  <span className="signage-soft-badge">{selectedPlaylist.items?.length ? "Contenido guardado" : "Playlist vacía"}</span>
                  {getPlaylistPublishIssue(selectedPlaylist) && (
                    <span className="signage-soft-badge warning">Revisión necesaria</span>
                  )}
                </div>
              </div>
              <div className="signage-playlist-toolbar-actions">
                <button type="button" className="visual-outline-button" onClick={() => onEditPlaylist(selectedPlaylist)} disabled={saving}>
                  Editar
                </button>
                <details className="signage-action-menu">
                  <summary>Más</summary>
                  <div className="signage-action-menu-popover">
                    <button type="button" onClick={() => onDuplicatePlaylist(selectedPlaylist)} disabled={saving}>
                      Duplicar
                    </button>
                    <button type="button" onClick={() => onTogglePlaylistActive(selectedPlaylist)} disabled={saving}>
                      {selectedPlaylist.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <label>
                      Publicación
                      <select
                        className="signage-publish-select"
                        value={getPublishStatus(selectedPlaylist.publishStatus)}
                        onChange={(event) => onPlaylistPublishStatusChange(selectedPlaylist, event.target.value)}
                        disabled={saving}
                      >
                        {PUBLISH_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="danger" onClick={() => onDeletePlaylist(selectedPlaylist)} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </details>
              </div>
            </div>

            <div className="digital-add-row">
              <select value={assetToAddId} onChange={(event) => onAssetToAddChange(event.target.value)}>
                <option value="">Seleccionar asset</option>
                {activeAssets.map((asset) => (
                  <option value={asset.id} key={asset.id}>{asset.title}</option>
                ))}
              </select>
              <button type="button" className="visual-primary-button" onClick={onAddAssetToPlaylist} disabled={saving || !assetToAddId}>
                Agregar
              </button>
            </div>

            <PlaylistItemsEditor items={selectedPlaylist.items || []} saving={saving} onChange={onPlaylistItemsChange} />
          </>
        )}
      </section>

      <aside className="signage-side-column">
        <form className="signage-panel" onSubmit={onSubmitPlaylist}>
          <h3>{editingPlaylistId ? "Editar playlist" : "Nueva playlist"}</h3>
          <div className="digital-form-grid">
            <label>
              Nombre
              <input value={playlistForm.name} onChange={(event) => onPlaylistFormChange({ ...playlistForm, name: event.target.value })} placeholder="Ej. Lobby principal" />
            </label>
            <label>
              Plantel
              <PlantelSelect value={playlistForm.plantel} onChange={(value) => onPlaylistFormChange({ ...playlistForm, plantel: value })} />
            </label>
            <label>
              Publicación
              <select value={getPublishStatus(playlistForm.publishStatus)} onChange={(event) => onPlaylistFormChange({ ...playlistForm, publishStatus: event.target.value })}>
                {PUBLISH_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="signage-form-actions">
            {editingPlaylistId && (
              <button type="button" className="visual-outline-button" onClick={onCancelPlaylistEdit}>
                Cancelar edición
              </button>
            )}
            <button type="submit" className="visual-primary-button" disabled={saving}>
              {editingPlaylistId ? "Guardar playlist" : "Crear playlist"}
            </button>
          </div>
        </form>

        <SignagePreviewCard playlist={selectedPlaylist} />
      </aside>
    </div>
  );
}
