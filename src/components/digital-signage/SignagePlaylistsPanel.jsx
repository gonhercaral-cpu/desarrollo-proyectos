import { useState, useEffect, useRef } from "react";
import {
  PUBLISH_STATUS_OPTIONS,
  DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  getPublishStatus,
} from "../../utils/digitalSignage";
import SignagePlaylistItemsEditor from "./SignagePlaylistItemsEditor";

export default function SignagePlaylistsPanel({
  playlists = [],
  selectedPlaylist = null,
  effectiveSelectedPlaylistId = null,
  activeAssets = [],
  assetToAddId = "",
  playlistForm = { name: "", plantel: "", publishStatus: "draft" },
  editingPlaylistId = null,
  saving = false,
  playlistSaveState = "saved",
  onRetryPlaylistSave,
  onSelectPlaylist,
  onEditPlaylist,
  onDuplicatePlaylist,
  onTogglePlaylistActive,
  onPlaylistPublishStatusChange,
  onDeletePlaylist,
  onAssetToAddChange,
  onAddAssetsToPlaylist,
  onPlaylistItemsChange,
  onSubmitPlaylist,
  onPlaylistFormChange,
  onCancelPlaylistEdit,
  StatusBadge,
  PublishStatusBadge,
  PlantelSelect,
  SignagePreviewCard,
  getPlaylistItemCountLabel,
  getPlaylistDurationSeconds,
  getPlaylistSummary,
  getPlaylistPublishIssue,
  formatDuration,
}) {
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(Boolean(assetToAddId));
  const [assetSearch, setAssetSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [selectedAssetIds, setSelectedAssetIds] = useState(() => assetToAddId ? [assetToAddId] : []);
  const [selectedItemId, setSelectedItemId] = useState(null);

  const assetTriggerBtnRef = useRef(null);
  const playlistModalTriggerRef = useRef(null);
  const assetSearchInputRef = useRef(null);
  const playlistNameInputRef = useRef(null);

  const modalRef = useRef(null);
  const modalOpen = isPlaylistModalOpen || isAssetPickerOpen;
  useEffect(() => {
    if (!modalOpen) return undefined;
    const previous = document.activeElement;
    const modal = modalRef.current;
    (isAssetPickerOpen ? assetSearchInputRef.current : playlistNameInputRef.current)?.focus();
    function trapFocus(event) {
      if (event.key !== "Tab") return;
      const controls = [...modal.querySelectorAll("button, input, select, textarea, [tabindex='0']")]
        .filter((control) => !control.disabled && control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    modal?.addEventListener("keydown", trapFocus);
    return () => { modal?.removeEventListener("keydown", trapFocus); previous?.focus(); };
  }, [modalOpen, isAssetPickerOpen]);

  function selectPlaylist(id) {
    setSelectedItemId(null);
    setSelectedAssetIds([]);
    setIsAssetPickerOpen(false);
    onAssetToAddChange("");
    onSelectPlaylist(id);
  }

  const filteredPlaylists = playlists.filter((playlist) => {
    const term = playlistSearch.trim().toLowerCase();
    if (!term) return true;
    const name = (playlist.name || "").toLowerCase();
    const plantel = (playlist.plantel || "").toLowerCase();
    return name.includes(term) || plantel.includes(term);
  });

  const currentPlaylistItems = selectedPlaylist?.items || [];
  const selectedItem =
    currentPlaylistItems.find((item) => item.itemId === selectedItemId) ||
    currentPlaylistItems[0] ||
    null;

  const filteredAssets = activeAssets.filter((asset) => {
    const term = assetSearch.trim().toLowerCase();
    const matchesTerm = !term || (asset.title || "").toLowerCase().includes(term);
    const matchesType =
      assetTypeFilter === "all" || asset.type === assetTypeFilter;
    return matchesTerm && matchesType;
  });

  const handleOpenNewPlaylistModal = () => {
    if (onCancelPlaylistEdit) onCancelPlaylistEdit();
    if (onPlaylistFormChange) {
      onPlaylistFormChange({
        name: "",
        plantel: playlistForm.plantel || playlists[0]?.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
        publishStatus: "draft",
      });
    }
    setIsPlaylistModalOpen(true);
  };

  const handleOpenEditPlaylistModal = (playlist) => {
    if (onEditPlaylist) onEditPlaylist(playlist);
    setIsPlaylistModalOpen(true);
  };

  const handleClosePlaylistModal = () => {
    if (saving) return;
    setIsPlaylistModalOpen(false);
    if (editingPlaylistId && onCancelPlaylistEdit) {
      onCancelPlaylistEdit();
    }
    if (playlistModalTriggerRef.current) {
      playlistModalTriggerRef.current.focus();
    }
  };

  const handleOpenAssetPicker = () => {
    setAssetSearch("");
    setAssetTypeFilter("all");
    setIsAssetPickerOpen(true);
  };

  const handleCloseAssetPicker = () => {
    setIsAssetPickerOpen(false);
    setSelectedAssetIds([]);
    if (onAssetToAddChange) {
      onAssetToAddChange("");
    }
    if (assetTriggerBtnRef.current) {
      assetTriggerBtnRef.current.focus();
    }
  };

  const handleToggleSelectAsset = (assetId) => {
    setSelectedAssetIds((prev) =>
      prev.includes(assetId)
        ? prev.filter((id) => id !== assetId)
        : [...prev, assetId]
    );
  };

  const handleAddSelectedAssets = () => {
    if (selectedAssetIds.length === 0) return;
    onAddAssetsToPlaylist(selectedAssetIds);
    handleCloseAssetPicker();
  };

  const handlePlaylistModalKeyDown = (event) => {
    if (saving) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      handleClosePlaylistModal();
    }
  };

  const handleAssetPickerKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      handleCloseAssetPicker();
    }
  };

  return (
    <div className="signage-playlists-three-col">
      {/* COLUMNA 1: MIS PLAYLISTS */}
      <section
        className="signage-panel signage-col-playlists"
        aria-label="Listado de playlists"
      >
        <div className="signage-panel-heading signage-sidebar-heading">
          <div>
            <h2>Playlists</h2>
            <p>Listado y selección general.</p>
          </div>
          <button
            ref={playlistModalTriggerRef}
            type="button"
            className="visual-primary-button signage-new-playlist-btn"
            onClick={handleOpenNewPlaylistModal}
            disabled={saving}
          >
            + Nueva playlist
          </button>
        </div>

        <div className="signage-search-box">
          <input
            type="search"
            value={playlistSearch}
            onChange={(e) => setPlaylistSearch(e.target.value)}
            placeholder="Buscar por nombre o plantel..."
            aria-label="Buscar playlists"
          />
        </div>

        <div className="signage-playlist-sidebar-list">
          {filteredPlaylists.length === 0 ? (
            <p className="digital-empty">
              {playlists.length === 0
                ? "Sin playlists registradas. Crea una para comenzar."
                : "No hay playlists que coincidan con la búsqueda."}
            </p>
          ) : (
            filteredPlaylists.map((playlist) => {
              const isSelected = effectiveSelectedPlaylistId === playlist.id;
              return (
                <article
                  key={playlist.id}
                  className={`signage-list-row signage-playlist-sidebar-card ${
                    isSelected ? "active" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="signage-playlist-select"
                    onClick={() => selectPlaylist(playlist.id)}
                    aria-current={isSelected ? "true" : undefined}
                  >
                    <strong>{playlist.name}</strong>
                    <span>{playlist.plantel || "Sin plantel"}</span>
                    <div className="signage-badge-row">
                      <StatusBadge
                        status={playlist.active === false ? "inactive" : "active"}
                      />
                      <PublishStatusBadge status={playlist.publishStatus} />
                      <span className="signage-soft-badge">
                        {getPlaylistItemCountLabel(playlist)}
                      </span>
                      <span className="signage-soft-badge">
                        {formatDuration(getPlaylistDurationSeconds(playlist))}
                      </span>
                    </div>
                    <small>{getPlaylistSummary(playlist)}</small>
                  </button>

                  <div className="signage-list-actions signage-compact-actions">
                    <button
                      type="button"
                      className="visual-outline-button"
                      onClick={() => handleOpenEditPlaylistModal(playlist)}
                      disabled={saving}
                    >
                      Editar
                    </button>
                    <details className="signage-action-menu">
                      <summary aria-label={`Menú de opciones para ${playlist.name}`}>
                        Más
                      </summary>
                      <div className="signage-action-menu-popover">
                        <button
                          type="button"
                          onClick={() => onDuplicatePlaylist(playlist)}
                          disabled={saving}
                        >
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => onTogglePlaylistActive(playlist)}
                          disabled={saving}
                        >
                          {playlist.active === false ? "Activar" : "Desactivar"}
                        </button>
                        <label>
                          Publicación
                          <select
                            className="signage-publish-select"
                            value={getPublishStatus(playlist.publishStatus)}
                            onChange={(event) =>
                              onPlaylistPublishStatusChange(
                                playlist,
                                event.target.value
                              )
                            }
                            disabled={saving}
                          >
                            {PUBLISH_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => onDeletePlaylist(playlist)}
                          disabled={saving}
                        >
                          Eliminar
                        </button>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {/* COLUMNA 2: EDITOR COMPACTO DE CONTENIDOS */}
      <section
        className="signage-panel signage-col-editor"
        aria-label="Editor de contenidos de la playlist"
      >
        {!selectedPlaylist ? (
          <div className="digital-empty signage-editor-placeholder">
            <h3>Ninguna playlist seleccionada</h3>
            <p>Selecciona una playlist de la izquierda o crea una nueva.</p>
          </div>
        ) : (
          <>
            <div className="signage-editor-top-toolbar">
              <div className="signage-editor-heading-meta">
                <div className="signage-editor-title-row">
                  <h3>{selectedPlaylist.name}</h3>
                  <button
                    type="button"
                    className="visual-outline-button signage-edit-meta-btn"
                    onClick={() => handleOpenEditPlaylistModal(selectedPlaylist)}
                    disabled={saving}
                  >
                    Editar datos
                  </button>
                </div>
                <p>
                  {selectedPlaylist.plantel || "Sin plantel"} •{" "}
                  {getPlaylistItemCountLabel(selectedPlaylist)} •{" "}
                  {formatDuration(getPlaylistDurationSeconds(selectedPlaylist))}
                </p>
                <div className="signage-badge-row">
                  <StatusBadge
                    status={selectedPlaylist.active === false ? "inactive" : "active"}
                  />
                  <PublishStatusBadge status={selectedPlaylist.publishStatus} />
                  {playlistSaveState === "saving" && (
                    <span className="signage-save-pill saving" aria-live="polite">
                      Guardando...
                    </span>
                  )}
                  {playlistSaveState === "error" && (
                    <span className="signage-save-pill error" aria-live="assertive">
                      Error al guardar{" "}
                      {onRetryPlaylistSave && (
                        <button
                          type="button"
                          className="signage-inline-retry"
                          onClick={onRetryPlaylistSave}
                        >
                          Reintentar
                        </button>
                      )}
                    </span>
                  )}
                  {playlistSaveState === "saved" && (
                    <span className="signage-save-pill saved">
                      Cambios guardados
                    </span>
                  )}
                  {getPlaylistPublishIssue(selectedPlaylist) && (
                    <span className="signage-soft-badge warning">
                      Revisión necesaria
                    </span>
                  )}
                </div>
              </div>

              <div className="signage-editor-top-actions">
                <button
                  ref={assetTriggerBtnRef}
                  type="button"
                  className="visual-primary-button"
                  onClick={handleOpenAssetPicker}
                  disabled={saving}
                >
                  + Agregar contenido
                </button>
                <details className="signage-action-menu">
                  <summary aria-label="Opciones adicionales de playlist">
                    Más
                  </summary>
                  <div className="signage-action-menu-popover">
                    <button
                      type="button"
                      onClick={() => onDuplicatePlaylist(selectedPlaylist)}
                      disabled={saving}
                    >
                      Duplicar
                    </button>
                    <button
                      type="button"
                      onClick={() => onTogglePlaylistActive(selectedPlaylist)}
                      disabled={saving}
                    >
                      {selectedPlaylist.active === false
                        ? "Activar"
                        : "Desactivar"}
                    </button>
                    <label>
                      Publicación
                      <select
                        className="signage-publish-select"
                        value={getPublishStatus(selectedPlaylist.publishStatus)}
                        onChange={(event) =>
                          onPlaylistPublishStatusChange(
                            selectedPlaylist,
                            event.target.value
                          )
                        }
                        disabled={saving}
                      >
                        {PUBLISH_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => onDeletePlaylist(selectedPlaylist)}
                      disabled={saving}
                    >
                      Eliminar
                    </button>
                  </div>
                </details>
              </div>
            </div>

            <SignagePlaylistItemsEditor
              key={selectedPlaylist.id}
              items={currentPlaylistItems}
              saving={saving}
              onChange={onPlaylistItemsChange}
              onSelectItem={setSelectedItemId}
              selectedItemId={selectedItemId}
            />
          </>
        )}
      </section>

      {/* COLUMNA 3: PREVIEW DEL ITEM SELECCIONADO Y PROPIEDADES */}
      <aside
        className="signage-col-preview"
        aria-label="Previsualización y propiedades"
      >
        {selectedPlaylist ? (
          <div className="signage-preview-stack">
            <SignagePreviewCard
              playlist={{
                ...selectedPlaylist,
                items: selectedItem ? [selectedItem] : currentPlaylistItems,
              }}
              key={selectedItem?.itemId || selectedPlaylist.id}
            />

            <section className="signage-panel signage-playback-info-panel">
              <h4>Propiedades de la playlist</h4>
              <div className="signage-info-group">
                <div className="signage-info-row">
                  <span>Plantel</span>
                  <strong>{selectedPlaylist.plantel || "Sin plantel"}</strong>
                </div>
                <div className="signage-info-row">
                  <span>Estado</span>
                  <StatusBadge
                    status={selectedPlaylist.active === false ? "inactive" : "active"}
                  />
                </div>
                <div className="signage-info-row">
                  <span>Publicación</span>
                  <PublishStatusBadge status={selectedPlaylist.publishStatus} />
                </div>
                <div className="signage-info-row">
                  <span>Total de contenidos</span>
                  <strong>{getPlaylistItemCountLabel(selectedPlaylist)}</strong>
                </div>
                <div className="signage-info-row">
                  <span>Duración total</span>
                  <strong>
                    {formatDuration(getPlaylistDurationSeconds(selectedPlaylist))}
                  </strong>
                </div>
              </div>

              <div className="signage-playback-notice">
                <div className="signage-playback-notice-title">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4" />
                    <path d="M12 8h.01" />
                  </svg>
                  <span>Modo de reproducción: Bucle continuo</span>
                </div>
                <p>
                  La pantalla reproduce los contenidos en el orden de la lista y vuelve a comenzar al terminar.
                </p>
              </div>

              {selectedItem && (
                <div className="signage-selected-item-meta">
                  <h5>Contenido seleccionado</h5>
                  <div className="signage-info-row">
                    <span>Título</span>
                    <strong className="signage-ellipsis">
                      {selectedItem.title || "Sin título"}
                    </strong>
                  </div>
                  <div className="signage-info-row">
                    <span>Tipo</span>
                    <span className="signage-soft-badge">
                      {{ image: "Imagen", video: "Video", web: "Página web", template: "Plantilla", visual_ad: "Anuncio visual" }[selectedItem.type] || "Contenido"}
                    </span>
                  </div>
                  <div className="signage-info-row">
                    <span>Duración</span>
                    <strong>{formatDuration(selectedItem.durationSeconds || 10)}</strong>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="signage-panel digital-empty">
            <p>Selecciona una playlist para previsualizar sus contenidos.</p>
          </div>
        )}
      </aside>

      {/* MODAL CREACIÓN / EDICIÓN DE PLAYLIST */}
      {isPlaylistModalOpen && (
        <div
          className="signage-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClosePlaylistModal();
          }}
          onKeyDown={handlePlaylistModalKeyDown}
        >
          <div
            ref={modalRef}
            className="signage-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="playlist-modal-title"
          >
            <div className="signage-modal-header">
              <h3 id="playlist-modal-title">
                {editingPlaylistId ? "Editar playlist" : "Nueva playlist"}
              </h3>
              <button
                type="button"
                className="signage-modal-close-btn"
                onClick={handleClosePlaylistModal}
                aria-label="Cerrar modal"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={async (event) => {
                const success = await onSubmitPlaylist(event);
                if (success) handleClosePlaylistModal();
              }}
            >
              <div className="signage-modal-body digital-form-grid">
                <label>
                  Nombre
                  <input
                    ref={playlistNameInputRef}
                    value={playlistForm.name || ""}
                    onChange={(event) =>
                      onPlaylistFormChange({
                        ...playlistForm,
                        name: event.target.value,
                      })
                    }
                    placeholder="Ej. Lobby principal"
                    required
                  />
                </label>
                <label>
                  Plantel
                  <PlantelSelect
                    value={playlistForm.plantel || ""}
                    onChange={(value) =>
                      onPlaylistFormChange({ ...playlistForm, plantel: value })
                    }
                  />
                </label>
                <label>
                  Publicación
                  <select
                    value={getPublishStatus(playlistForm.publishStatus)}
                    onChange={(event) =>
                      onPlaylistFormChange({
                        ...playlistForm,
                        publishStatus: event.target.value,
                      })
                    }
                  >
                    {PUBLISH_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="signage-modal-footer">
                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={handleClosePlaylistModal}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="visual-primary-button"
                  disabled={saving || !playlistForm.name?.trim()}
                >
                  {saving
                    ? "Guardando..."
                    : editingPlaylistId
                    ? "Guardar cambios"
                    : "Crear playlist"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ACCESIBLE SELECTOR DE CONTENIDOS */}
      {isAssetPickerOpen && (
        <div
          className="signage-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseAssetPicker();
          }}
          onKeyDown={handleAssetPickerKeyDown}
        >
          <div
            ref={modalRef}
            className="signage-modal-dialog signage-modal-dialog-large"
            role="dialog"
            aria-modal="true"
            aria-labelledby="asset-picker-title"
          >
            <div className="signage-modal-header">
              <div>
                <h3 id="asset-picker-title">Agregar contenido a la playlist</h3>
                <p className="signage-modal-subtitle">
                  Selecciona uno o más elementos. Puedes volver a agregar contenidos que ya están en la playlist.
                </p>
              </div>
              <button
                type="button"
                className="signage-modal-close-btn"
                onClick={handleCloseAssetPicker}
                aria-label="Cerrar selector"
              >
                ✕
              </button>
            </div>

            <div className="signage-modal-body">
              <div className="signage-asset-picker-filters">
                <input
                  ref={assetSearchInputRef}
                  type="search"
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  placeholder="Buscar contenidos por título..."
                  aria-label="Buscar contenidos"
                />
                <select
                  value={assetTypeFilter}
                  onChange={(e) => setAssetTypeFilter(e.target.value)}
                  aria-label="Filtrar por tipo"
                >
                  <option value="all">Todos los tipos</option>
                  <option value="image">Imágenes</option>
                  <option value="video">Videos</option>
                  <option value="web">Páginas web</option>
                  <option value="template">Plantillas</option>
                  <option value="visual_ad">Anuncios visuales</option>
                </select>
              </div>

              <div className="signage-asset-picker-grid">
                {filteredAssets.length === 0 ? (
                  <p className="digital-empty">
                    No se encontraron contenidos activos disponibles.
                  </p>
                ) : (
                  filteredAssets.map((asset) => {
                    const occurrences = currentPlaylistItems.filter(
                      (item) =>
                        String(item.assetId || item.id) === String(asset.id)
                    ).length;
                    const isChecked = selectedAssetIds.includes(asset.id);

                    return (
                      <article
                        key={asset.id}
                        className={`signage-asset-picker-card ${isChecked ? "is-selected" : ""}`}
                        onClick={() => handleToggleSelectAsset(asset.id)}
                      >
                        <div className="signage-asset-picker-card-top">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleSelectAsset(asset.id)}
                            aria-label={`Seleccionar ${asset.title}`}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span className="signage-soft-badge">
                            {{ image: "Imagen", video: "Video", web: "Página web", template: "Plantilla", visual_ad: "Anuncio visual" }[asset.type] || "Contenido"}
                          </span>
                        </div>

                        <div className="signage-asset-picker-thumb">
                          {asset.type === "video" ? (
                            <video
                              src={asset.url || asset.thumbnailUrl}
                              preload="metadata"
                              muted
                              playsInline
                            />
                          ) : asset.type === "image" && (asset.thumbnailUrl || asset.url) ? (
                            <img
                              src={asset.thumbnailUrl || asset.url}
                              alt={asset.title || "Miniatura"}
                              loading="lazy"
                            />
                          ) : (
                            <div className="signage-asset-picker-thumb-fallback">
                              <span>{asset.type || "media"}</span>
                            </div>
                          )}
                        </div>

                        <div className="signage-asset-picker-info">
                          <strong>{asset.title || "Sin título"}</strong>
                          {occurrences > 0 && (
                            <span className="signage-asset-occurrences">
                              En la playlist: {occurrences} {occurrences === 1 ? "vez" : "veces"}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </div>

            <div className="signage-modal-footer signage-asset-picker-footer">
              <div className="signage-selection-counter">
                <span>
                  {selectedAssetIds.length}{" "}
                  {selectedAssetIds.length === 1
                    ? "elemento seleccionado"
                    : "elementos seleccionados"}
                </span>
              </div>
              <div className="signage-modal-actions">
                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={handleCloseAssetPicker}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="visual-primary-button"
                  onClick={handleAddSelectedAssets}
                  disabled={selectedAssetIds.length === 0 || saving}
                >
                  Agregar {selectedAssetIds.length} elementos a la playlist
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
