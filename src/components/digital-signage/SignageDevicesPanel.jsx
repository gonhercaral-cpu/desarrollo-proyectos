export default function SignageDevicesPanel({
  devices,
  filteredDevices,
  selectedDevice,
  selectedDevicePlaylist,
  playlists,
  activeCampaignByDeviceId,
  saving,
  devicesViewMode,
  deviceSearch,
  deviceFilter,
  pairingFormOpen,
  pairingForm,
  deviceFormOpen,
  deviceForm,
  editingDeviceId,
  deviceFormRef,
  onOpenPairingForm,
  onOpenNewDeviceForm,
  onDeviceSearchChange,
  onDeviceFilterChange,
  onDevicesViewModeChange,
  onPairingSubmit,
  onPairingFormChange,
  onClosePairingForm,
  onDeviceSubmit,
  onDeviceFormChange,
  onCloseDeviceForm,
  onSelectDevice,
  onEditDevice,
  onCopyPlayerUrl,
  onAssignDevicePlaylist,
  onClearDeviceContent,
  onToggleDeviceActive,
  onRemoveDevice,
  onPlaylists,
  onContent,
  onPreview,
  SignageIcon,
  PlantelSelect,
  DeviceCard,
  DeviceMonitorGrid,
  QuickDevicePreview,
  QuickActions,
}) {
  return (
    <div className="signage-main-grid">
      <section className="signage-panel signage-devices-panel">
        <div className="signage-panel-heading">
          <div>
            <h2>Pantallas registradas</h2>
            <p>Control de pantallas Linux, asignaciones y estado de conexión.</p>
          </div>
          <div className="signage-panel-actions">
            <button type="button" className="visual-outline-button signage-new-button" onClick={onOpenPairingForm}>
              <SignageIcon name="link" />
              Vincular pantalla
            </button>
            <button type="button" className="visual-primary-button signage-new-button" onClick={onOpenNewDeviceForm}>
              <SignageIcon name="plus" />
              Nuevo dispositivo
            </button>
          </div>
        </div>

        <div className="signage-device-toolbar">
          <label className="signage-search">
            <input
              type="search"
              value={deviceSearch}
              onChange={(event) => onDeviceSearchChange(event.target.value)}
              placeholder="Buscar dispositivo..."
            />
            <SignageIcon name="search" />
          </label>

          <label className="signage-filter">
            <SignageIcon name="filter" />
            <select value={deviceFilter} onChange={(event) => onDeviceFilterChange(event.target.value)}>
              <option value="all">Filtros</option>
              <option value="online">En línea</option>
              <option value="offline">Desconectado</option>
              <option value="no-connection">Sin conexión registrada</option>
              <option value="unassigned">Sin contenido</option>
              <option value="inactive">Inactivo</option>
            </select>
          </label>

          <div className="signage-view-toggle" aria-label="Vista de dispositivos">
            <button
              type="button"
              className={devicesViewMode === "list" ? "active" : ""}
              onClick={() => onDevicesViewModeChange("list")}
            >
              Lista
            </button>
            <button
              type="button"
              className={devicesViewMode === "monitors" ? "active" : ""}
              onClick={() => onDevicesViewModeChange("monitors")}
            >
              Monitores
            </button>
          </div>
        </div>

        <p className="signage-helper-note">
          Este dispositivo reproduce campañas activas; si no hay campañas vigentes, usa su playlist asignada.
        </p>

        {pairingFormOpen && (
          <form className="signage-inline-form signage-pairing-form" onSubmit={onPairingSubmit} ref={deviceFormRef}>
            <div className="signage-form-heading">
              <strong>Vincular pantalla</strong>
              <button
                type="button"
                className="signage-icon-button"
                onClick={onClosePairingForm}
                aria-label="Cerrar formulario"
              >
                ×
              </button>
            </div>

            <p className="digital-helper">
              Abre /signage/setup en la pantalla nueva e ingresa aquí el código mostrado.
            </p>

            <div className="digital-form-grid">
              <label>
                Código
                <input value={pairingForm.code} onChange={(event) => onPairingFormChange({ ...pairingForm, code: event.target.value.toUpperCase() })} placeholder="AES-4821" />
              </label>
              <label>
                Nombre
                <input value={pairingForm.name} onChange={(event) => onPairingFormChange({ ...pairingForm, name: event.target.value })} placeholder="Pantalla recepción" />
              </label>
              <label>
                Plantel
                <PlantelSelect value={pairingForm.plantel} onChange={(value) => onPairingFormChange({ ...pairingForm, plantel: value })} />
              </label>
              <label>
                Ubicación
                <input value={pairingForm.location} onChange={(event) => onPairingFormChange({ ...pairingForm, location: event.target.value })} placeholder="Lobby, pasillo, aula..." />
              </label>
              <label>
                Playlist opcional
                <select value={pairingForm.assignedPlaylistId} onChange={(event) => onPairingFormChange({ ...pairingForm, assignedPlaylistId: event.target.value })}>
                  <option value="">Sin playlist</option>
                  {playlists.map((playlist) => (
                    <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="signage-form-actions">
              <button type="button" className="visual-outline-button" onClick={onClosePairingForm}>
                Cancelar
              </button>
              <button type="submit" className="visual-primary-button" disabled={saving}>
                Vincular pantalla
              </button>
            </div>
          </form>
        )}

        {deviceFormOpen && (
          <form className="signage-inline-form" onSubmit={onDeviceSubmit} ref={deviceFormRef}>
            <div className="signage-form-heading">
              <strong>{editingDeviceId ? "Editar dispositivo" : "Nuevo dispositivo"}</strong>
              <button
                type="button"
                className="signage-icon-button"
                onClick={onCloseDeviceForm}
                aria-label="Cerrar formulario"
              >
                ×
              </button>
            </div>

            <div className="digital-form-grid">
              <label>
                Nombre
                <input value={deviceForm.name} onChange={(event) => onDeviceFormChange({ ...deviceForm, name: event.target.value })} placeholder="Pantalla recepción" />
              </label>
              <label>
                Plantel
                <PlantelSelect value={deviceForm.plantel} onChange={(value) => onDeviceFormChange({ ...deviceForm, plantel: value })} />
              </label>
              <label>
                Ubicación
                <input value={deviceForm.location} onChange={(event) => onDeviceFormChange({ ...deviceForm, location: event.target.value })} placeholder="Lobby, pasillo, aula..." />
              </label>
              <label>
                Playlist
                <select value={deviceForm.assignedPlaylistId} onChange={(event) => onDeviceFormChange({ ...deviceForm, assignedPlaylistId: event.target.value })}>
                  <option value="">Sin playlist</option>
                  {playlists.map((playlist) => (
                    <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="signage-form-actions">
              <button type="button" className="visual-outline-button" onClick={onCloseDeviceForm}>
                Cancelar
              </button>
              <button type="submit" className="visual-primary-button" disabled={saving}>
                {editingDeviceId ? "Guardar cambios" : "Crear dispositivo"}
              </button>
            </div>
          </form>
        )}

        {devicesViewMode === "monitors" ? (
          <DeviceMonitorGrid
            devices={filteredDevices}
            selectedDevice={selectedDevice}
            playlists={playlists}
            activeCampaignByDeviceId={activeCampaignByDeviceId}
            saving={saving}
            onSelect={(device) => onSelectDevice(device.id)}
            onEdit={onEditDevice}
            onCopy={onCopyPlayerUrl}
            onPlaylistChange={(device, playlistId) => onAssignDevicePlaylist(device, playlistId)}
            onClearContent={onClearDeviceContent}
          />
        ) : (
          <div className="signage-device-list">
            {filteredDevices.length === 0 && <p className="digital-empty">Sin dispositivos para mostrar.</p>}
            {filteredDevices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                active={selectedDevice?.id === device.id}
                playlists={playlists}
                activeCampaign={activeCampaignByDeviceId.get(device.id)}
                saving={saving}
                onSelect={() => onSelectDevice(device.id)}
                onEdit={() => onEditDevice(device)}
                onCopy={() => onCopyPlayerUrl(device)}
                onPlaylistChange={(playlistId) => onAssignDevicePlaylist(device, playlistId)}
                onClearContent={() => onClearDeviceContent(device)}
                onToggle={() => onToggleDeviceActive(device)}
                onDelete={() => onRemoveDevice(device)}
              />
            ))}
          </div>
        )}

        <footer className="signage-list-footer">
          <span>Mostrando {filteredDevices.length ? 1 : 0} a {filteredDevices.length} de {devices.length} dispositivos</span>
          <div className="signage-pagination" aria-hidden="true">
            <button type="button" disabled>‹</button>
            <button type="button" className="active">1</button>
            <button type="button" disabled>›</button>
          </div>
        </footer>
      </section>

      <aside className="signage-side-column">
        <QuickDevicePreview
          device={selectedDevice}
          playlist={selectedDevicePlaylist}
          activeCampaign={selectedDevice ? activeCampaignByDeviceId.get(selectedDevice.id) : null}
        />
        <QuickActions
          onNewDevice={onOpenNewDeviceForm}
          onPlaylists={onPlaylists}
          onContent={onContent}
          onPreview={onPreview}
        />
      </aside>
    </div>
  );
}
