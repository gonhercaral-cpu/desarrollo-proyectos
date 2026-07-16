import {
  DIGITAL_SIGNAGE_PLANTELES,
  PUBLISH_STATUS_OPTIONS,
  TEMPLATE_OPTIONS,
  TEMPLATE_THEME_OPTIONS,
  VISUAL_TEMPLATE_CATEGORIES,
  getPublishStatus,
} from "../../utils/digitalSignage";

export default function SignageLibraryPanel({
  visualAdFormOpen,
  visualAdForm,
  editingVisualAdId,
  visualAdDirty,
  visualAdDraftStatus,
  visualAdBackgroundPreview,
  selectedVisualElementId,
  visualTemplates,
  visualAdHistory,
  visualAdFuture,
  visualAdZoom,
  saving,
  assets,
  filteredAssets,
  assetSearch,
  assetTypeFilter,
  assetPlantelFilter,
  assetCategoryFilter,
  assetStatusFilter,
  assetPublishFilter,
  assetSort,
  assetUsageMap,
  templateFormOpen,
  templateForm,
  assetForm,
  webForm,
  editingWebAssetId,
  onVisualAdSubmit,
  onVisualAdCancel,
  onSaveTemplate,
  onApplyTemplate,
  onEditTemplate,
  onToggleTemplate,
  onDeleteTemplate,
  onUndoVisualAd,
  onRedoVisualAd,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onVisualAdFieldChange,
  onVisualAdCanvasChange,
  onVisualAdBackgroundTypeChange,
  onVisualAdBackgroundChange,
  onSelectVisualElement,
  onAddVisualAdText,
  onAddVisualAdImage,
  onApplyVisualAdPreset,
  onAlignVisualAdElement,
  onDuplicateVisualAdElement,
  onMoveVisualAdLayer,
  onVisualAdElementChange,
  onVisualAdCanvasElementChange,
  onVisualAdCanvasInteractionStart,
  onDeleteVisualAdElement,
  onReplaceVisualAdImage,
  onOpenDriveImportModal,
  onToggleTemplateForm,
  onOpenNewVisualAdEditor,
  onAssetSearchChange,
  onAssetTypeFilterChange,
  onAssetPlantelFilterChange,
  onAssetCategoryFilterChange,
  onAssetStatusFilterChange,
  onAssetPublishFilterChange,
  onAssetSortChange,
  onClearAssetFilters,
  onEditVisualAdAsset,
  onEditAssetOrganization,
  onPrepareAssetForPlaylist,
  onOpenEditWebAssetForm,
  onSendWebReloadCommand,
  onDuplicateAsset,
  onToggleAssetActive,
  onChangeAssetPublishStatus,
  onToggleAssetArchive,
  onRemoveAsset,
  onCreateTemplateAsset,
  onTemplateFormChange,
  onUploadAsset,
  onAssetFormChange,
  onAssetFileChange,
  onCreateWebAsset,
  onWebFormChange,
  onWebSettingsChange,
  onResetWebAssetForm,
  VisualAdEditor,
  AssetThumb,
  TypeBadge,
  StatusBadge,
  PublishStatusBadge,
  PlantelSelect,
  getAssetTypeLabel,
  getAssetCategoryLabel,
  getAssetCategoryValue,
  getAssetUsageLabel,
  getAssetTags,
}) {
  if (visualAdFormOpen) {
    return (
      <VisualAdEditor
        form={visualAdForm}
        saving={saving}
        mode={editingVisualAdId ? "edit" : "create"}
        dirty={visualAdDirty}
        draftStatus={visualAdDraftStatus}
        backgroundPreview={visualAdBackgroundPreview}
        selectedElementId={selectedVisualElementId}
        visualTemplates={visualTemplates}
        canUndo={visualAdHistory.length > 0}
        canRedo={visualAdFuture.length > 0}
        zoom={visualAdZoom}
        onSubmit={onVisualAdSubmit}
        onCancel={onVisualAdCancel}
        onSaveTemplate={onSaveTemplate}
        onApplyTemplate={onApplyTemplate}
        onEditTemplate={onEditTemplate}
        onToggleTemplate={onToggleTemplate}
        onDeleteTemplate={onDeleteTemplate}
        onUndo={onUndoVisualAd}
        onRedo={onRedoVisualAd}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomFit={onZoomFit}
        onFieldChange={onVisualAdFieldChange}
        onCanvasChange={onVisualAdCanvasChange}
        onBackgroundTypeChange={onVisualAdBackgroundTypeChange}
        onBackgroundChange={onVisualAdBackgroundChange}
        onSelectElement={onSelectVisualElement}
        onAddText={onAddVisualAdText}
        onAddImage={onAddVisualAdImage}
        onApplyPreset={onApplyVisualAdPreset}
        onAlignElement={onAlignVisualAdElement}
        onDuplicateElement={onDuplicateVisualAdElement}
        onLayerChange={onMoveVisualAdLayer}
        onElementChange={onVisualAdElementChange}
        onCanvasElementChange={onVisualAdCanvasElementChange}
        onCanvasInteractionStart={onVisualAdCanvasInteractionStart}
        onElementDelete={onDeleteVisualAdElement}
        onElementImageReplace={onReplaceVisualAdImage}
        PlantelSelect={PlantelSelect}
      />
    );
  }

  return (
    <div className="signage-main-grid">
      <section className="signage-panel">
        <div className="signage-panel-heading">
          <div>
            <h2>Biblioteca</h2>
            <p>Sube imágenes, videos, enlaces web o crea anuncios visuales para usarlos en playlists.</p>
          </div>
          <button
            type="button"
            className="visual-primary-button"
            onClick={onOpenDriveImportModal}
          >
            Importar desde Nube AES
          </button>
          <button
            type="button"
            className="visual-outline-button"
            onClick={onToggleTemplateForm}
          >
            Nueva plantilla
          </button>
          <button
            type="button"
            className="visual-outline-button"
            onClick={onOpenNewVisualAdEditor}
          >
            Nuevo anuncio visual
          </button>
        </div>

        <div className="signage-library-toolbar">
          <label>
            Buscar
            <input value={assetSearch} onChange={(event) => onAssetSearchChange(event.target.value)} placeholder="Nombre, etiqueta, plantel..." />
          </label>
          <label>
            Tipo
            <select value={assetTypeFilter} onChange={(event) => onAssetTypeFilterChange(event.target.value)}>
              <option value="all">Todos</option>
              <option value="image">Imagen</option>
              <option value="video">Video</option>
              <option value="web">Web</option>
              <option value="template">Plantilla</option>
              <option value="visual_ad">Anuncio visual</option>
            </select>
          </label>
          <label>
            Plantel
            <select value={assetPlantelFilter} onChange={(event) => onAssetPlantelFilterChange(event.target.value)}>
              <option value="all">Todos</option>
              {DIGITAL_SIGNAGE_PLANTELES.map((plantel) => (
                <option key={plantel} value={plantel}>{plantel}</option>
              ))}
            </select>
          </label>
          <label>
            Categoría
            <select value={assetCategoryFilter} onChange={(event) => onAssetCategoryFilterChange(event.target.value)}>
              <option value="all">Todas</option>
              {VISUAL_TEMPLATE_CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>{category.label}</option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select value={assetStatusFilter} onChange={(event) => onAssetStatusFilterChange(event.target.value)}>
              <option value="current">Sin archivar</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="archived">Archivados</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <label>
            Publicación
            <select value={assetPublishFilter} onChange={(event) => onAssetPublishFilterChange(event.target.value)}>
              <option value="all">Todos</option>
              {PUBLISH_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Orden
            <select value={assetSort} onChange={(event) => onAssetSortChange(event.target.value)}>
              <option value="recent">Recientes</option>
              <option value="name">Nombre</option>
              <option value="duration">Duración</option>
              <option value="type">Tipo</option>
            </select>
          </label>
          <button
            type="button"
            className="visual-outline-button"
            onClick={onClearAssetFilters}
          >
            Limpiar filtros
          </button>
        </div>

        <div className="signage-library-grid">
          {assets.length === 0 && <p className="digital-empty">Sin assets registrados.</p>}
          {assets.length > 0 && filteredAssets.length === 0 && (
            <p className="digital-empty">No hay contenidos que coincidan con los filtros.</p>
          )}
          {filteredAssets.map((asset) => (
            <article className={`signage-list-row signage-asset-card ${asset.archived === true ? "archived" : ""}`} key={asset.id}>
              <div className="signage-list-thumb">
                <AssetThumb asset={asset} />
              </div>
              <div className="signage-list-main">
                <strong>{asset.title || "Sin título"}</strong>
                <span>{getAssetTypeLabel(asset.type)} - {asset.plantel || "Sin plantel"} - {asset.durationSeconds || 10}s - {getAssetCategoryLabel(getAssetCategoryValue(asset.category))}</span>
                <div className="signage-list-meta">
                  <TypeBadge type={asset.type} />
                  <span className="signage-chip">{asset.plantel || "Sin plantel"}</span>
                  <span className="signage-chip">{asset.durationSeconds || 10}s</span>
                  <span className="signage-chip">{getAssetCategoryLabel(getAssetCategoryValue(asset.category))}</span>
                  <StatusBadge status={asset.active === false ? "inactive" : "active"} />
                  <PublishStatusBadge status={asset.publishStatus} />
                  {asset.archived === true && <span className="signage-soft-badge archived">Archivado</span>}
                  {asset.source === "nube_aes" && <span className="signage-soft-badge">Nube AES</span>}
                  <span className="signage-soft-badge">
                    {getAssetUsageLabel(asset.id, assetUsageMap)}
                  </span>
                  {getAssetTags(asset).map((tag) => (
                    <span className="signage-tag-badge" key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <div className="signage-list-actions">
                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={() => asset.type === "visual_ad" ? onEditVisualAdAsset(asset) : onEditAssetOrganization(asset)}
                  disabled={saving}
                >
                  {asset.type === "visual_ad" ? "Editar anuncio" : "Editar"}
                </button>
                <button type="button" className="visual-outline-button" onClick={() => onPrepareAssetForPlaylist(asset)} disabled={saving}>
                  Agregar a playlist
                </button>
                <details className="signage-action-menu">
                  <summary>Más</summary>
                  <div className="signage-action-menu-popover">
                    {asset.type === "web" && (
                      <>
                        <button type="button" onClick={() => onOpenEditWebAssetForm(asset)} disabled={saving}>
                          Opciones web
                        </button>
                        <button type="button" onClick={() => onSendWebReloadCommand(asset)} disabled={saving}>
                          Enviar recarga
                        </button>
                      </>
                    )}
                    {asset.type !== "visual_ad" && (
                      <button type="button" onClick={() => onEditAssetOrganization(asset)} disabled={saving}>
                        Organización
                      </button>
                    )}
                    <button type="button" onClick={() => onDuplicateAsset(asset)} disabled={saving}>
                      Duplicar
                    </button>
                    <button type="button" onClick={() => onToggleAssetActive(asset)} disabled={saving}>
                      {asset.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <label>
                      Publicación
                      <select
                        className="signage-publish-select"
                        value={getPublishStatus(asset.publishStatus)}
                        onChange={(event) => onChangeAssetPublishStatus(asset, event.target.value)}
                        disabled={saving}
                      >
                        {PUBLISH_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={() => onToggleAssetArchive(asset)} disabled={saving}>
                      {asset.archived === true ? "Restaurar" : "Archivar"}
                    </button>
                    <button type="button" className="danger" onClick={() => onRemoveAsset(asset)} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </details>
              </div>
            </article>
          ))}
        </div>
      </section>

      <aside className="signage-side-column">
        {templateFormOpen && (
          <form className="signage-panel signage-template-form" onSubmit={onCreateTemplateAsset}>
            <h3>Nueva plantilla</h3>
            <div className="digital-form-grid">
              <label>
                Tipo
                <select value={templateForm.templateKey} onChange={(event) => onTemplateFormChange({ ...templateForm, templateKey: event.target.value })}>
                  {TEMPLATE_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Tema
                <select value={templateForm.templateTheme} onChange={(event) => onTemplateFormChange({ ...templateForm, templateTheme: event.target.value })}>
                  {TEMPLATE_THEME_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Titulo
                <input value={templateForm.title} onChange={(event) => onTemplateFormChange({ ...templateForm, title: event.target.value })} placeholder="Ej. Bienvenidos" required />
              </label>
              <label>
                Subtitulo
                <input value={templateForm.subtitle} onChange={(event) => onTemplateFormChange({ ...templateForm, subtitle: event.target.value })} placeholder="Ej. Ciclo escolar 2026" />
              </label>
              <label className="digital-full-field">
                Texto principal
                <textarea value={templateForm.body} onChange={(event) => onTemplateFormChange({ ...templateForm, body: event.target.value })} rows="3" placeholder="Mensaje breve para pantalla." />
              </label>
              <label>
                Footer
                <input value={templateForm.footer} onChange={(event) => onTemplateFormChange({ ...templateForm, footer: event.target.value })} placeholder="Ej. Active English School" />
              </label>
              <label>
                CTA
                <input value={templateForm.cta} onChange={(event) => onTemplateFormChange({ ...templateForm, cta: event.target.value })} placeholder="Ej. Inscribete hoy" />
              </label>
              <label>
                Plantel
                <PlantelSelect value={templateForm.plantel} onChange={(value) => onTemplateFormChange({ ...templateForm, plantel: value })} />
              </label>
              <label>
                Duracion seg.
                <input type="number" min="1" max="3600" value={templateForm.durationSeconds} onChange={(event) => onTemplateFormChange({ ...templateForm, durationSeconds: event.target.value })} />
              </label>
              <label className="digital-checkbox-label">
                <input type="checkbox" checked={templateForm.active} onChange={(event) => onTemplateFormChange({ ...templateForm, active: event.target.checked })} />
                Activa
              </label>
            </div>
            <button type="submit" className="visual-primary-button" disabled={saving}>Crear plantilla</button>
          </form>
        )}

        <form className="signage-panel" onSubmit={onUploadAsset}>
          <h3>Subir imagen o video</h3>
          <div className="digital-form-grid">
            <label>
              Título
              <input value={assetForm.title} onChange={(event) => onAssetFormChange({ ...assetForm, title: event.target.value })} placeholder="Ej. Promoción julio" />
            </label>
            <label>
              Plantel
              <PlantelSelect value={assetForm.plantel} onChange={(value) => onAssetFormChange({ ...assetForm, plantel: value })} />
            </label>
            <label>
              Duración seg.
              <input type="number" min="1" max="3600" value={assetForm.durationSeconds} onChange={(event) => onAssetFormChange({ ...assetForm, durationSeconds: event.target.value })} />
            </label>
            <label>
              Archivo
              <input type="file" accept="image/*,video/*" onChange={(event) => onAssetFileChange(event.target.files?.[0] || null)} />
            </label>
          </div>
          <button type="submit" className="visual-primary-button" disabled={saving}>Subir asset</button>
        </form>

        <form className="signage-panel" onSubmit={onCreateWebAsset}>
          <h3>{editingWebAssetId ? "Editar asset web" : "Crear asset web"}</h3>
          <div className="digital-form-grid">
            <label>
              Título
              <input value={webForm.title} onChange={(event) => onWebFormChange({ ...webForm, title: event.target.value })} placeholder="Ej. Sitio institucional" />
            </label>
            <label>
              URL
              <input value={webForm.url} onChange={(event) => onWebFormChange({ ...webForm, url: event.target.value })} placeholder="https://..." />
            </label>
            <label>
              Plantel
              <PlantelSelect value={webForm.plantel} onChange={(value) => onWebFormChange({ ...webForm, plantel: value })} />
            </label>
            <label>
              Duración seg.
              <input type="number" min="1" max="3600" value={webForm.durationSeconds} onChange={(event) => onWebFormChange({ ...webForm, durationSeconds: event.target.value })} />
            </label>
            <label>
              Modo
              <select value={webForm.webSettings.mode} onChange={(event) => onWebSettingsChange({ mode: event.target.value })}>
                <option value="iframe">Iframe</option>
                <option value="redirect">Pagina completa / redirect</option>
              </select>
            </label>
            <label>
              Recargar cada seg.
              <input type="number" min="0" max="86400" value={webForm.webSettings.reloadIntervalSeconds} onChange={(event) => onWebSettingsChange({ reloadIntervalSeconds: event.target.value })} placeholder="Sin recarga" />
            </label>
            <label>
              Zoom %
              <input type="number" min="50" max="150" value={webForm.webSettings.zoom} onChange={(event) => onWebSettingsChange({ zoom: event.target.value })} />
            </label>
            <label className="digital-checkbox-label">
              <input type="checkbox" checked={webForm.webSettings.showStatusOverlay} onChange={(event) => onWebSettingsChange({ showStatusOverlay: event.target.checked })} />
              Mostrar overlay
            </label>
            <label className="digital-checkbox-label">
              <input type="checkbox" checked={webForm.webSettings.allowInteraction} onChange={(event) => onWebSettingsChange({ allowInteraction: event.target.checked })} />
              Permitir interaccion
            </label>
            <label className="digital-checkbox-label">
              <input type="checkbox" checked={webForm.webSettings.cacheBustOnReload} onChange={(event) => onWebSettingsChange({ cacheBustOnReload: event.target.checked })} />
              Cache bust al recargar
            </label>
            <p className="digital-helper digital-full-field">
              Algunas paginas externas bloquean iframe por seguridad. En ese caso usa modo pagina completa/redirect.
            </p>
          </div>
          <div className="signage-form-actions">
            {editingWebAssetId && (
              <button type="button" className="visual-outline-button" onClick={onResetWebAssetForm} disabled={saving}>
                Cancelar edicion
              </button>
            )}
            <button type="submit" className="visual-primary-button" disabled={saving}>
              {editingWebAssetId ? "Guardar web" : "Crear web"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}
