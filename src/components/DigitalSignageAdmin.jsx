import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  createSignageDevice,
  createSignagePlaylist,
  createWebAsset,
  deleteSignageAsset,
  deleteSignageDevice,
  getSignageAssets,
  getSignageDevices,
  getSignagePlaylists,
  updateSignageAsset,
  updateSignageDevice,
  updateSignagePlaylist,
  uploadSignageAsset,
} from "../services/digitalSignageService";

const TABS = [
  { key: "library", label: "Biblioteca", icon: "library" },
  { key: "playlists", label: "Playlists", icon: "list" },
  { key: "devices", label: "Dispositivos", icon: "screen" },
  { key: "preview", label: "Vista previa", icon: "eye" },
];

const DEFAULT_PLANTELES = [
  "Plaza Estrella",
  "Santa Fe",
  "Otay",
  "Centro",
  "Online",
  "General",
];

const DEFAULT_ASSET_FORM = {
  title: "",
  plantel: "Plaza Estrella",
  durationSeconds: 10,
};

const DEFAULT_WEB_FORM = {
  title: "",
  url: "",
  plantel: "Plaza Estrella",
  durationSeconds: 20,
};

const DEFAULT_PLAYLIST_FORM = {
  name: "",
  plantel: "Plaza Estrella",
};

const DEFAULT_DEVICE_FORM = {
  name: "",
  plantel: "Plaza Estrella",
  location: "",
  assignedPlaylistId: "",
};

export default function DigitalSignageAdmin() {
  const { profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("devices");
  const [assets, setAssets] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [assetForm, setAssetForm] = useState(DEFAULT_ASSET_FORM);
  const [webForm, setWebForm] = useState(DEFAULT_WEB_FORM);
  const [assetFile, setAssetFile] = useState(null);
  const [playlistForm, setPlaylistForm] = useState(DEFAULT_PLAYLIST_FORM);
  const [deviceForm, setDeviceForm] = useState(DEFAULT_DEVICE_FORM);
  const [editingDeviceId, setEditingDeviceId] = useState("");
  const [deviceFormOpen, setDeviceFormOpen] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [assetToAddId, setAssetToAddId] = useState("");
  const [previewPlaylistId, setPreviewPlaylistId] = useState("");
  const deviceFormRef = useRef(null);

  const activeAssets = useMemo(
    () => assets.filter((asset) => asset.active !== false),
    [assets]
  );

  const onlineDevices = useMemo(
    () => devices.filter(isDeviceOnline),
    [devices]
  );

  const unassignedDevices = useMemo(
    () => devices.filter((device) => device.active !== false && !device.assignedPlaylistId),
    [devices]
  );

  const filteredDevices = useMemo(() => {
    const normalizedSearch = normalizeSearch(deviceSearch);

    return devices.filter((device) => {
      const status = getDeviceStatus(device);
      const matchesStatus = deviceFilter === "all" || status === deviceFilter;
      const matchesSearch =
        !normalizedSearch ||
        [
          device.name,
          device.id,
          device.deviceToken,
          device.plantel,
          device.location,
          getPlaylistName(device.assignedPlaylistId, playlists),
        ].some((value) => normalizeSearch(value).includes(normalizedSearch));

      return matchesStatus && matchesSearch;
    });
  }, [deviceFilter, deviceSearch, devices, playlists]);

  const selectedDevice = useMemo(
    () =>
      devices.find((device) => device.id === selectedDeviceId) ||
      filteredDevices[0] ||
      devices[0] ||
      null,
    [devices, filteredDevices, selectedDeviceId]
  );

  const selectedDevicePlaylist = useMemo(
    () =>
      playlists.find(
        (playlist) => playlist.id === selectedDevice?.assignedPlaylistId
      ) || null,
    [playlists, selectedDevice?.assignedPlaylistId]
  );

  const effectiveSelectedPlaylistId = selectedPlaylistId || playlists[0]?.id || "";
  const selectedPlaylist = useMemo(
    () =>
      playlists.find((playlist) => playlist.id === effectiveSelectedPlaylistId) ||
      null,
    [playlists, effectiveSelectedPlaylistId]
  );

  const previewPlaylist = useMemo(
    () =>
      playlists.find((playlist) => playlist.id === previewPlaylistId) ||
      playlists[0] ||
      null,
    [playlists, previewPlaylistId]
  );

  async function loadAll() {
    setLoading(true);
    setMessage("");

    try {
      const [nextAssets, nextPlaylists, nextDevices] = await Promise.all([
        getSignageAssets(),
        getSignagePlaylists(),
        getSignageDevices(),
      ]);

      setAssets(nextAssets);
      setPlaylists(nextPlaylists);
      setDevices(nextDevices);
    } catch (error) {
      setMessage(error.message || "No se pudo cargar Digital Signage.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return undefined;

    const timeoutId = window.setTimeout(() => {
      loadAll();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isAdmin]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setMessage("");

    try {
      await action();
      await loadAll();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error.message || "No se pudo guardar el cambio.");
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      await uploadSignageAsset(assetFile, assetForm, profile);
      setAssetFile(null);
      setAssetForm(DEFAULT_ASSET_FORM);
      event.target.reset();
    }, "Asset cargado.");
  }

  async function handleCreateWebAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      await createWebAsset(
        {
          ...webForm,
          url: normalizeUrl(webForm.url),
        },
        profile
      );
      setWebForm(DEFAULT_WEB_FORM);
    }, "Asset web creado.");
  }

  async function handleCreatePlaylist(event) {
    event.preventDefault();

    await runAction(async () => {
      const playlist = await createSignagePlaylist(playlistForm, profile);
      setSelectedPlaylistId(playlist.id);
      setPlaylistForm(DEFAULT_PLAYLIST_FORM);
    }, "Playlist creada.");
  }

  async function handleDeviceSubmit(event) {
    event.preventDefault();

    await runAction(async () => {
      if (editingDeviceId) {
        await updateSignageDevice(editingDeviceId, deviceForm);
        setMessage("Dispositivo actualizado.");
      } else {
        const device = await createSignageDevice(deviceForm, profile);
        setSelectedDeviceId(device.id);
      }

      setDeviceForm(DEFAULT_DEVICE_FORM);
      setEditingDeviceId("");
      setDeviceFormOpen(false);
    }, editingDeviceId ? "Dispositivo actualizado." : "Dispositivo creado.");
  }

  async function addAssetToPlaylist() {
    if (!selectedPlaylist || !assetToAddId) return;

    const asset = assets.find((item) => item.id === assetToAddId);
    if (!asset) return;

    const nextItems = [
      ...(selectedPlaylist.items || []),
      {
        assetId: asset.id,
        title: asset.title || "Contenido",
        type: asset.type || "image",
        url: asset.url || "",
        durationSeconds: asset.durationSeconds || 10,
      },
    ];

    await runAction(async () => {
      await updateSignagePlaylist(selectedPlaylist.id, { items: nextItems });
      setAssetToAddId("");
    }, "Asset agregado a playlist.");
  }

  async function updatePlaylistItems(items, successMessage = "Playlist actualizada.") {
    if (!selectedPlaylist) return;

    await runAction(async () => {
      await updateSignagePlaylist(selectedPlaylist.id, { items });
    }, successMessage);
  }

  async function copyPlayerUrl(device) {
    const url = getPlayerUrl(device.deviceToken || device.id);

    try {
      await navigator.clipboard.writeText(url);
      setMessage("URL copiada.");
    } catch {
      setMessage(url);
    }
  }

  function openNewDeviceForm() {
    setActiveTab("devices");
    setEditingDeviceId("");
    setDeviceForm(DEFAULT_DEVICE_FORM);
    setDeviceFormOpen(true);
    window.setTimeout(() => deviceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function openEditDeviceForm(device) {
    setActiveTab("devices");
    setSelectedDeviceId(device.id);
    setEditingDeviceId(device.id);
    setDeviceForm({
      name: device.name || "",
      plantel: device.plantel || "Plaza Estrella",
      location: device.location || "",
      assignedPlaylistId: device.assignedPlaylistId || "",
    });
    setDeviceFormOpen(true);
    window.setTimeout(() => deviceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  if (!isAdmin) {
    return (
      <section className="printshop-page digital-signage-page">
        <div className="printshop-topbar digital-signage-header">
          <div className="printshop-topbar-main">
            <span className="printshop-topbar-module-icon">
              <SignageIcon name="screen" />
            </span>
            <div className="printshop-topbar-copy">
              <p className="section-kicker printshop-kicker">Administración</p>
              <h1>Digital Signage</h1>
              <p>Módulo disponible solo para administradores.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="printshop-page digital-signage-page signage-admin-shell">
      <section className="printshop-topbar digital-signage-header">
        <div className="printshop-topbar-main">
          <span className="printshop-topbar-module-icon">
            <SignageIcon name="screen" />
          </span>
          <div className="printshop-topbar-copy">
            <p className="section-kicker printshop-kicker">Módulo operativo</p>
            <h1>Digital Signage</h1>
            <p>
              Administra contenido, playlists y dispositivos para las pantallas institucionales.
            </p>
          </div>
        </div>
      </section>

      <section className="signage-kpi-grid">
        <KpiCard icon="file" title="Contenidos activos" value={activeAssets.length} helper="Publicados actualmente" tone="blue" />
        <KpiCard icon="list" title="Playlists" value={playlists.length} helper="Playlists creadas" tone="green" />
        <KpiCard icon="screen" title="Dispositivos en línea" value={onlineDevices.length} helper={`de ${devices.length} dispositivos`} tone="purple" />
        <KpiCard icon="warning" title="Sin contenido" value={unassignedDevices.length} helper="Pantallas sin asignar" tone="orange" />
      </section>

      <section className="printshop-section-tabs signage-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="printshop-tab-icon">
              <SignageIcon name={tab.icon} />
            </span>
            {tab.label}
          </button>
        ))}
      </section>

      {message && <p className="digital-signage-message">{message}</p>}
      {loading ? <div className="signage-panel">Cargando Digital Signage...</div> : null}

      {!loading && activeTab === "devices" && (
        <div className="signage-main-grid">
          <section className="signage-panel signage-devices-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Pantallas registradas</h2>
                <p>Control de pantallas Linux, asignaciones y estado de conexión.</p>
              </div>
              <button type="button" className="visual-primary-button signage-new-button" onClick={openNewDeviceForm}>
                <SignageIcon name="plus" />
                Nuevo dispositivo
              </button>
            </div>

            <div className="signage-device-toolbar">
              <label className="signage-search">
                <input
                  type="search"
                  value={deviceSearch}
                  onChange={(event) => setDeviceSearch(event.target.value)}
                  placeholder="Buscar dispositivo..."
                />
                <SignageIcon name="search" />
              </label>

              <label className="signage-filter">
                <SignageIcon name="filter" />
                <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
                  <option value="all">Filtros</option>
                  <option value="online">En línea</option>
                  <option value="offline">Desconectado</option>
                  <option value="no-connection">Sin conexión registrada</option>
                  <option value="unassigned">Sin contenido</option>
                  <option value="inactive">Inactivo</option>
                </select>
              </label>
            </div>

            {deviceFormOpen && (
              <form className="signage-inline-form" onSubmit={handleDeviceSubmit} ref={deviceFormRef}>
                <div className="signage-form-heading">
                  <strong>{editingDeviceId ? "Editar dispositivo" : "Nuevo dispositivo"}</strong>
                  <button
                    type="button"
                    className="signage-icon-button"
                    onClick={() => {
                      setDeviceFormOpen(false);
                      setEditingDeviceId("");
                      setDeviceForm(DEFAULT_DEVICE_FORM);
                    }}
                    aria-label="Cerrar formulario"
                  >
                    ×
                  </button>
                </div>

                <div className="digital-form-grid">
                  <label>
                    Nombre
                    <input value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} placeholder="Pantalla recepción" />
                  </label>
                  <label>
                    Plantel
                    <PlantelSelect value={deviceForm.plantel} onChange={(value) => setDeviceForm({ ...deviceForm, plantel: value })} />
                  </label>
                  <label>
                    Ubicación
                    <input value={deviceForm.location} onChange={(event) => setDeviceForm({ ...deviceForm, location: event.target.value })} placeholder="Lobby, pasillo, aula..." />
                  </label>
                  <label>
                    Playlist
                    <select value={deviceForm.assignedPlaylistId} onChange={(event) => setDeviceForm({ ...deviceForm, assignedPlaylistId: event.target.value })}>
                      <option value="">Sin playlist</option>
                      {playlists.map((playlist) => (
                        <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="signage-form-actions">
                  <button type="button" className="visual-outline-button" onClick={() => setDeviceFormOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="visual-primary-button" disabled={saving}>
                    {editingDeviceId ? "Guardar cambios" : "Crear dispositivo"}
                  </button>
                </div>
              </form>
            )}

            <div className="signage-device-list">
              {filteredDevices.length === 0 && <p className="digital-empty">Sin dispositivos para mostrar.</p>}
              {filteredDevices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  active={selectedDevice?.id === device.id}
                  playlists={playlists}
                  saving={saving}
                  onSelect={() => setSelectedDeviceId(device.id)}
                  onEdit={() => openEditDeviceForm(device)}
                  onCopy={() => copyPlayerUrl(device)}
                  onPlaylistChange={(playlistId) =>
                    runAction(
                      () => updateSignageDevice(device.id, { assignedPlaylistId: playlistId }),
                      "Playlist asignada."
                    )
                  }
                  onToggle={() =>
                    runAction(
                      () => updateSignageDevice(device.id, { active: device.active === false }),
                      "Dispositivo actualizado."
                    )
                  }
                  onDelete={() =>
                    window.confirm("¿Eliminar dispositivo?") &&
                    runAction(() => deleteSignageDevice(device.id), "Dispositivo eliminado.")
                  }
                />
              ))}
            </div>

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
            <QuickDevicePreview device={selectedDevice} playlist={selectedDevicePlaylist} />
            <QuickActions
              onNewDevice={openNewDeviceForm}
              onPlaylists={() => setActiveTab("playlists")}
              onContent={() => setActiveTab("library")}
              onPreview={() => setActiveTab("preview")}
            />
          </aside>
        </div>
      )}

      {!loading && activeTab === "library" && (
        <div className="signage-main-grid">
          <section className="signage-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Biblioteca</h2>
                <p>Contenido visual disponible para las playlists.</p>
              </div>
            </div>

            <div className="signage-library-grid">
              {assets.length === 0 && <p className="digital-empty">Sin assets registrados.</p>}
              {assets.map((asset) => (
                <article className="signage-asset-card" key={asset.id}>
                  <AssetThumb asset={asset} />
                  <div>
                    <strong>{asset.title || "Sin título"}</strong>
                    <span>{getAssetTypeLabel(asset.type)} · {asset.plantel || "Sin plantel"} · {asset.durationSeconds || 10}s</span>
                    <StatusBadge status={asset.active === false ? "inactive" : "active"} />
                  </div>
                  <div className="signage-card-actions">
                    <button type="button" className="visual-outline-button" onClick={() => runAction(() => updateSignageAsset(asset.id, { active: asset.active === false }), "Asset actualizado.")} disabled={saving}>
                      {asset.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <button type="button" className="danger-table-button" onClick={() => window.confirm("¿Eliminar asset?") && runAction(() => deleteSignageAsset(asset.id), "Asset eliminado.")} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="signage-side-column">
            <form className="signage-panel" onSubmit={handleUploadAsset}>
              <h3>Subir imagen o video</h3>
              <div className="digital-form-grid">
                <label>
                  Título
                  <input value={assetForm.title} onChange={(event) => setAssetForm({ ...assetForm, title: event.target.value })} placeholder="Ej. Promoción julio" />
                </label>
                <label>
                  Plantel
                  <PlantelSelect value={assetForm.plantel} onChange={(value) => setAssetForm({ ...assetForm, plantel: value })} />
                </label>
                <label>
                  Duración seg.
                  <input type="number" min="1" max="3600" value={assetForm.durationSeconds} onChange={(event) => setAssetForm({ ...assetForm, durationSeconds: event.target.value })} />
                </label>
                <label>
                  Archivo
                  <input type="file" accept="image/*,video/*" onChange={(event) => setAssetFile(event.target.files?.[0] || null)} />
                </label>
              </div>
              <button type="submit" className="visual-primary-button" disabled={saving}>Subir asset</button>
            </form>

            <form className="signage-panel" onSubmit={handleCreateWebAsset}>
              <h3>Crear asset web</h3>
              <div className="digital-form-grid">
                <label>
                  Título
                  <input value={webForm.title} onChange={(event) => setWebForm({ ...webForm, title: event.target.value })} placeholder="Ej. Sitio institucional" />
                </label>
                <label>
                  URL
                  <input value={webForm.url} onChange={(event) => setWebForm({ ...webForm, url: event.target.value })} placeholder="https://..." />
                </label>
                <label>
                  Plantel
                  <PlantelSelect value={webForm.plantel} onChange={(value) => setWebForm({ ...webForm, plantel: value })} />
                </label>
                <label>
                  Duración seg.
                  <input type="number" min="1" max="3600" value={webForm.durationSeconds} onChange={(event) => setWebForm({ ...webForm, durationSeconds: event.target.value })} />
                </label>
              </div>
              <button type="submit" className="visual-primary-button" disabled={saving}>Crear web</button>
            </form>
          </aside>
        </div>
      )}

      {!loading && activeTab === "playlists" && (
        <div className="signage-main-grid">
          <section className="signage-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Playlists</h2>
                <p>Orden, duración y estado del contenido programado.</p>
              </div>
            </div>

            <div className="signage-playlist-selector">
              {playlists.map((playlist) => (
                <button
                  type="button"
                  key={playlist.id}
                  className={effectiveSelectedPlaylistId === playlist.id ? "active" : ""}
                  onClick={() => setSelectedPlaylistId(playlist.id)}
                >
                  <strong>{playlist.name}</strong>
                  <span>{playlist.items?.length || 0} items</span>
                </button>
              ))}
            </div>

            {!selectedPlaylist ? (
              <p className="digital-empty">Selecciona o crea una playlist.</p>
            ) : (
              <>
                <div className="signage-playlist-toolbar">
                  <div>
                    <h3>{selectedPlaylist.name}</h3>
                    <p>{selectedPlaylist.plantel || "Sin plantel"}</p>
                  </div>
                  <button type="button" className="visual-outline-button" onClick={() => runAction(() => updateSignagePlaylist(selectedPlaylist.id, { active: selectedPlaylist.active === false }), "Playlist actualizada.")} disabled={saving}>
                    {selectedPlaylist.active === false ? "Activar" : "Desactivar"}
                  </button>
                </div>

                <div className="digital-add-row">
                  <select value={assetToAddId} onChange={(event) => setAssetToAddId(event.target.value)}>
                    <option value="">Seleccionar asset</option>
                    {activeAssets.map((asset) => (
                      <option value={asset.id} key={asset.id}>{asset.title}</option>
                    ))}
                  </select>
                  <button type="button" className="visual-primary-button" onClick={addAssetToPlaylist} disabled={saving || !assetToAddId}>
                    Agregar
                  </button>
                </div>

                <PlaylistItemsEditor items={selectedPlaylist.items || []} saving={saving} onChange={updatePlaylistItems} />
              </>
            )}
          </section>

          <aside className="signage-side-column">
            <form className="signage-panel" onSubmit={handleCreatePlaylist}>
              <h3>Nueva playlist</h3>
              <div className="digital-form-grid">
                <label>
                  Nombre
                  <input value={playlistForm.name} onChange={(event) => setPlaylistForm({ ...playlistForm, name: event.target.value })} placeholder="Ej. Lobby principal" />
                </label>
                <label>
                  Plantel
                  <PlantelSelect value={playlistForm.plantel} onChange={(value) => setPlaylistForm({ ...playlistForm, plantel: value })} />
                </label>
              </div>
              <button type="submit" className="visual-primary-button" disabled={saving}>Crear playlist</button>
            </form>

            <SignagePreviewCard playlist={selectedPlaylist} />
          </aside>
        </div>
      )}

      {!loading && activeTab === "preview" && (
        <div className="signage-main-grid">
          <section className="signage-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Vista previa global</h2>
                <p>Simulador local de reproducción para validar secuencias.</p>
              </div>
            </div>
            <SignagePreview key={previewPlaylist?.id || "empty"} playlist={previewPlaylist} />
          </section>

          <aside className="signage-side-column">
            <section className="signage-panel">
              <h3>Seleccionar playlist</h3>
              <label>
                Playlist
                <select value={previewPlaylist?.id || ""} onChange={(event) => setPreviewPlaylistId(event.target.value)}>
                  {playlists.map((playlist) => (
                    <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                  ))}
                </select>
              </label>
              <p className="digital-helper">Usa esta vista para revisar duración, contenido web, imágenes y videos antes de asignar a pantallas.</p>
            </section>

            <QuickActions
              onNewDevice={openNewDeviceForm}
              onPlaylists={() => setActiveTab("playlists")}
              onContent={() => setActiveTab("library")}
              onPreview={() => setActiveTab("preview")}
            />
          </aside>
        </div>
      )}
    </section>
  );
}

function KpiCard({ icon, title, value, helper, tone }) {
  return (
    <article className={`signage-kpi-card ${tone}`}>
      <span>
        <SignageIcon name={icon} />
      </span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        <p>{helper}</p>
      </div>
    </article>
  );
}

function DeviceCard({
  device,
  active,
  playlists,
  saving,
  onSelect,
  onEdit,
  onCopy,
  onPlaylistChange,
  onToggle,
  onDelete,
}) {
  const status = getDeviceStatus(device);
  const playlistName = getPlaylistName(device.assignedPlaylistId, playlists);

  return (
    <article className={`signage-device-card ${active ? "selected" : ""}`} onClick={onSelect}>
      <div className={`signage-device-icon ${status}`}>
        <SignageIcon name="screen" />
      </div>

      <div className="signage-device-main">
        <div className="signage-device-title-row">
          <div>
            <strong>{device.name || "Pantalla sin nombre"}</strong>
            <span>{getShortDeviceId(device)}</span>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="signage-device-meta-grid">
          <InfoPair label="Plantel" value={device.plantel || "Sin plantel"} />
          <InfoPair label="Ubicación" value={device.location || "Sin ubicación"} />
          <InfoPair label="Playlist asignada" value={playlistName || "Sin contenido"} strong />
          <InfoPair label="Última conexión" value={formatLastSeen(device)} />
        </div>

        <div className="signage-device-actions">
          <button type="button" className="visual-outline-button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>
            <SignageIcon name="edit" />
            Editar
          </button>
          <label onClick={(event) => event.stopPropagation()}>
            <SignageIcon name="list" />
            <select value={device.assignedPlaylistId || ""} onChange={(event) => onPlaylistChange(event.target.value)} disabled={saving}>
              <option value="">Asignar playlist</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
              ))}
            </select>
          </label>
          <button type="button" className="visual-outline-button" onClick={(event) => { event.stopPropagation(); onCopy(); }}>
            <SignageIcon name="link" />
            Copiar URL
          </button>
          <button type="button" className="signage-icon-button" onClick={(event) => { event.stopPropagation(); onToggle(); }} disabled={saving} title={device.active === false ? "Activar" : "Desactivar"}>
            <SignageIcon name="power" />
          </button>
          <button type="button" className="signage-icon-button danger" onClick={(event) => { event.stopPropagation(); onDelete(); }} disabled={saving} title="Eliminar">
            <SignageIcon name="more" />
          </button>
        </div>
      </div>
    </article>
  );
}

function QuickDevicePreview({ device, playlist }) {
  const firstItem = playlist?.items?.[0] || null;

  if (!device) {
    return (
      <section className="signage-panel signage-preview-card">
        <h3>Vista rÃ¡pida del dispositivo</h3>
        <div className="signage-monitor-preview">
          <div>
            <SignageIcon name="screen" />
            <strong>Sin dispositivo seleccionado</strong>
          </div>
        </div>
        <p className="digital-empty">Selecciona una pantalla registrada para ver su estado y playlist asignada.</p>
      </section>
    );
  }

  return (
    <section className="signage-panel signage-preview-card">
      <h3>Vista rápida del dispositivo</h3>
      <div className="signage-monitor-preview">
        {firstItem?.type === "image" && <img src={firstItem.url} alt={firstItem.title || "Preview"} />}
        {firstItem?.type === "video" && <video src={firstItem.url} muted playsInline />}
        {firstItem?.type === "web" && <iframe src={firstItem.url} title={firstItem.title || "Preview"} />}
        {!firstItem && (
          <div>
            <SignageIcon name="screen" />
            <strong>Sin contenido asignado</strong>
          </div>
        )}
      </div>

      <div className="signage-preview-details">
        <InfoPair label="Nombre del dispositivo" value={device.name || "Sin dispositivo"} />
        <InfoPair label="ID del dispositivo" value={getShortDeviceId(device)} />
        <InfoPair label="Resolución" value="No registrada" />
        <InfoPair label="Playlist asignada" value={playlist?.name || "Sin contenido"} strong />
        <InfoPair label="Estado" value={<StatusBadge status={device ? getDeviceStatus(device) : "offline"} />} />
        <InfoPair label="Última conexión" value={device ? formatLastSeen(device) : "Sin conexión"} />
      </div>
    </section>
  );
}

function QuickActions({ onNewDevice, onPlaylists, onContent, onPreview }) {
  return (
    <section className="signage-panel signage-quick-actions">
      <h3>Accesos rápidos</h3>
      <div>
        <button type="button" onClick={onNewDevice}><SignageIcon name="plus" />Nuevo dispositivo</button>
        <button type="button" onClick={onPlaylists}><SignageIcon name="list" />Gestionar playlists</button>
        <button type="button" onClick={onContent}><SignageIcon name="calendar" />Programar contenido</button>
        <button type="button" onClick={onPreview}><SignageIcon name="eye" />Vista previa global</button>
        <button type="button" disabled><SignageIcon name="chart" />Reportes</button>
        <button type="button" disabled><SignageIcon name="settings" />Configuración</button>
      </div>
    </section>
  );
}

function SignagePreviewCard({ playlist }) {
  return (
    <section className="signage-panel">
      <h3>Vista rápida de playlist</h3>
      <SignagePreview playlist={playlist} />
    </section>
  );
}

function InfoPair({ label, value, strong = false }) {
  return (
    <div className="signage-info-pair">
      <span>{label}</span>
      {typeof value === "string" ? <strong className={strong ? "linkish" : ""}>{value}</strong> : value}
    </div>
  );
}

function StatusBadge({ status }) {
  const labels = {
    online: "En línea",
    offline: "Desconectado",
    "no-connection": "Sin conexión registrada",
    unassigned: "Sin contenido",
    inactive: "Inactivo",
    active: "Activo",
  };

  return <span className={`signage-status-badge ${status}`}>{labels[status] || status}</span>;
}

function PlantelSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {DEFAULT_PLANTELES.map((plantel) => (
        <option key={plantel} value={plantel}>{plantel}</option>
      ))}
    </select>
  );
}

function PlaylistItemsEditor({ items, saving, onChange }) {
  function removeItem(index) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index), "Item eliminado.");
  }

  function moveItem(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;

    const nextItems = [...items];
    const [item] = nextItems.splice(index, 1);
    nextItems.splice(nextIndex, 0, item);
    onChange(nextItems, "Orden actualizado.");
  }

  function updateDuration(index, value) {
    const nextItems = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, durationSeconds: Number(value) || 10 } : item
    );
    onChange(nextItems, "Duración actualizada.");
  }

  if (items.length === 0) {
    return <p className="digital-empty">Playlist sin items.</p>;
  }

  return (
    <div className="digital-playlist-items signage-playlist-items">
      {items.map((item, index) => (
        <article className="digital-playlist-item" key={`${item.assetId}-${index}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{item.title}</strong>
            <small>{getAssetTypeLabel(item.type)}</small>
          </div>
          <label>
            Seg.
            <input type="number" min="1" max="3600" value={item.durationSeconds || 10} onChange={(event) => updateDuration(index, event.target.value)} disabled={saving} />
          </label>
          <div className="digital-row-actions">
            <button type="button" className="visual-outline-button" onClick={() => moveItem(index, -1)} disabled={saving || index === 0}>
              Arriba
            </button>
            <button type="button" className="visual-outline-button" onClick={() => moveItem(index, 1)} disabled={saving || index === items.length - 1}>
              Abajo
            </button>
            <button type="button" className="danger-table-button" onClick={() => removeItem(index)} disabled={saving}>
              Quitar
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function AssetThumb({ asset }) {
  if (asset.type === "image") {
    return <img src={asset.url} alt={asset.title || "Asset"} />;
  }

  if (asset.type === "video") {
    return <video src={asset.url} muted playsInline />;
  }

  return <div className="digital-web-thumb">WEB</div>;
}

function SignagePreview({ playlist }) {
  const [index, setIndex] = useState(0);
  const items = playlist?.items || [];
  const item = items[index] || null;

  useEffect(() => {
    if (!item || item.type === "video") return undefined;

    const timeout = window.setTimeout(() => {
      setIndex((current) => (items.length ? (current + 1) % items.length : 0));
    }, Math.max(Number(item.durationSeconds || 10), 1) * 1000);

    return () => window.clearTimeout(timeout);
  }, [item, items.length]);

  if (!playlist) {
    return <div className="digital-preview-screen empty">Sin playlist seleccionada</div>;
  }

  if (!item) {
    return <div className="digital-preview-screen empty">Playlist sin contenido</div>;
  }

  return (
    <div className="digital-preview-shell">
      <div className="digital-preview-screen">
        {item.type === "image" && <img src={item.url} alt={item.title} />}
        {item.type === "video" && (
          <video
            src={item.url}
            autoPlay
            muted
            playsInline
            onEnded={() => setIndex((current) => (current + 1) % items.length)}
            onError={() => setIndex((current) => (current + 1) % items.length)}
          />
        )}
        {item.type === "web" && <iframe src={item.url} title={item.title} />}
      </div>
      <div className="digital-preview-meta">
        <strong>{item.title}</strong>
        <span>{index + 1} / {items.length}</span>
      </div>
    </div>
  );
}

function SignageIcon({ name }) {
  switch (name) {
    case "screen":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="11" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case "list":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    case "warning":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19h16L12 4z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "library":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h5v14H4zM10 7h5v12h-5zM16 4h4v15h-4z" />
        </svg>
      );
    case "eye":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M16.5 16.5 21 21" />
        </svg>
      );
    case "filter":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16l-6 7v5l-4 2v-7z" />
        </svg>
      );
    case "edit":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20h4l10-10-4-4L4 16z" />
          <path d="M13 7l4 4" />
        </svg>
      );
    case "link":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
          <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
        </svg>
      );
    case "power":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v9" />
          <path d="M7 6.5a8 8 0 1 0 10 0" />
        </svg>
      );
    case "more":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16" />
        </svg>
      );
    case "chart":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 20V10M12 20V4M19 20v-7" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3a7 7 0 0 0-1.7 1L5 6 3 9.5 5 11a7 7 0 0 0 0 2l-2 1.5L5 18l2.4-1a7 7 0 0 0 1.7 1l.4 3h5l.4-3a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" />
        </svg>
      );
    default:
      return null;
  }
}

function getAssetTypeLabel(type) {
  const labels = {
    image: "Imagen",
    video: "Video",
    web: "Web",
  };

  return labels[type] || "Asset";
}

function normalizeUrl(value = "") {
  const cleanValue = value.trim();
  if (!cleanValue) return "";
  if (/^https?:\/\//i.test(cleanValue)) return cleanValue;
  return `https://${cleanValue}`;
}

function getPlayerUrl(deviceToken) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/signage/player/${deviceToken}`;
}

function isDeviceOnline(device) {
  if (device?.active === false) return false;

  const lastSeenMillis = getDeviceLastSeenMillis(device);
  if (!lastSeenMillis) return false;

  return Date.now() - lastSeenMillis <= 2 * 60 * 1000;
}

function getDeviceStatus(device) {
  if (device?.active === false) return "inactive";
  if (!device?.assignedPlaylistId) return "unassigned";

  const lastSeenMillis = getDeviceLastSeenMillis(device);
  if (!lastSeenMillis) return "no-connection";

  return Date.now() - lastSeenMillis <= 2 * 60 * 1000 ? "online" : "offline";
}

function getPlaylistName(playlistId, playlists) {
  if (!playlistId) return "";
  return playlists.find((playlist) => playlist.id === playlistId)?.name || "Playlist no encontrada";
}

function getShortDeviceId(device) {
  const value = device?.deviceToken || device?.id || "";
  if (!value) return "Sin ID";
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatLastSeen(device) {
  const millis = getDeviceLastSeenMillis(device);

  if (!millis) return "Sin registro";

  const date = new Date(millis);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const prefix = isToday ? "Hoy" : isYesterday ? "Ayer" : date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });

  return `${prefix}, ${date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
}

function getDeviceLastSeenMillis(device) {
  return (
    Number(device?.lastSeenMillis || 0) ||
    device?.lastSeenAt?.toMillis?.() ||
    0
  );
}

function normalizeSearch(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
