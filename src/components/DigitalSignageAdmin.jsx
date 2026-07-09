import { useEffect, useMemo, useState } from "react";
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
  { key: "library", label: "Biblioteca" },
  { key: "playlists", label: "Playlists" },
  { key: "devices", label: "Dispositivos" },
  { key: "preview", label: "Vista previa" },
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
  const [activeTab, setActiveTab] = useState("library");
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
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [assetToAddId, setAssetToAddId] = useState("");
  const [previewPlaylistId, setPreviewPlaylistId] = useState("");
  const effectiveSelectedPlaylistId = selectedPlaylistId || playlists[0]?.id || "";

  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === effectiveSelectedPlaylistId) || null,
    [playlists, effectiveSelectedPlaylistId]
  );

  const previewPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === previewPlaylistId) || playlists[0] || null,
    [playlists, previewPlaylistId]
  );

  const activeAssets = useMemo(
    () => assets.filter((asset) => asset.active !== false),
    [assets]
  );

  useEffect(() => {
    if (isAdmin) {
      loadAll();
    }
  }, [isAdmin]);

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

  async function handleCreateDevice(event) {
    event.preventDefault();

    await runAction(async () => {
      await createSignageDevice(deviceForm, profile);
      setDeviceForm(DEFAULT_DEVICE_FORM);
    }, "Dispositivo creado.");
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

  if (!isAdmin) {
    return (
      <section className="visual-page digital-signage-page">
        <div className="visual-page-header">
          <div>
            <h2>Digital Signage</h2>
            <p>Modulo disponible solo para administradores.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="visual-page digital-signage-page">
      <div className="visual-page-header digital-signage-header">
        <div>
          <span className="visual-page-kicker">Administracion</span>
          <h2>Digital Signage</h2>
          <p>Gestiona contenido, playlists y pantallas en modo quiosco.</p>
        </div>

        <div className="visual-page-actions">
          <button type="button" className="visual-outline-button" onClick={loadAll} disabled={loading || saving}>
            Actualizar
          </button>
        </div>
      </div>

      <nav className="digital-signage-tabs" aria-label="Digital Signage">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {message && <p className="digital-signage-message">{message}</p>}
      {loading ? <div className="card digital-signage-card">Cargando Digital Signage...</div> : null}

      {!loading && activeTab === "library" && (
        <div className="digital-signage-grid">
          <div className="digital-signage-stack">
            <form className="digital-signage-card" onSubmit={handleUploadAsset}>
              <h3>Subir imagen o video</h3>
              <div className="digital-form-grid">
                <label>
                  Titulo
                  <input value={assetForm.title} onChange={(event) => setAssetForm({ ...assetForm, title: event.target.value })} placeholder="Ej. Promocion julio" />
                </label>
                <label>
                  Plantel
                  <PlantelSelect value={assetForm.plantel} onChange={(value) => setAssetForm({ ...assetForm, plantel: value })} />
                </label>
                <label>
                  Duracion seg.
                  <input type="number" min="1" max="3600" value={assetForm.durationSeconds} onChange={(event) => setAssetForm({ ...assetForm, durationSeconds: event.target.value })} />
                </label>
                <label>
                  Archivo
                  <input type="file" accept="image/*,video/*" onChange={(event) => setAssetFile(event.target.files?.[0] || null)} />
                </label>
              </div>
              <button type="submit" className="visual-primary-button" disabled={saving}>
                Subir asset
              </button>
            </form>

            <form className="digital-signage-card" onSubmit={handleCreateWebAsset}>
              <h3>Crear asset web</h3>
              <div className="digital-form-grid">
                <label>
                  Titulo
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
                  Duracion seg.
                  <input type="number" min="1" max="3600" value={webForm.durationSeconds} onChange={(event) => setWebForm({ ...webForm, durationSeconds: event.target.value })} />
                </label>
              </div>
              <button type="submit" className="visual-primary-button" disabled={saving}>
                Crear web
              </button>
            </form>
          </div>

          <div className="digital-signage-card">
            <div className="digital-card-heading">
              <h3>Biblioteca</h3>
              <span>{assets.length} assets</span>
            </div>

            <div className="digital-assets-list">
              {assets.length === 0 && <p className="digital-empty">Sin assets registrados.</p>}
              {assets.map((asset) => (
                <article className="digital-asset-row" key={asset.id}>
                  <AssetThumb asset={asset} />
                  <div>
                    <strong>{asset.title || "Sin titulo"}</strong>
                    <span>{getAssetTypeLabel(asset.type)} - {asset.plantel || "Sin plantel"} - {asset.durationSeconds || 10}s</span>
                    <small>{asset.active === false ? "Inactivo" : "Activo"}</small>
                  </div>
                  <div className="digital-row-actions">
                    <button type="button" className="visual-outline-button" onClick={() => runAction(() => updateSignageAsset(asset.id, { active: asset.active === false }), "Asset actualizado.")} disabled={saving}>
                      {asset.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <button type="button" className="danger-table-button" onClick={() => window.confirm("Eliminar asset?") && runAction(() => deleteSignageAsset(asset.id), "Asset eliminado.")} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === "playlists" && (
        <div className="digital-signage-grid">
          <div className="digital-signage-stack">
            <form className="digital-signage-card" onSubmit={handleCreatePlaylist}>
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
              <button type="submit" className="visual-primary-button" disabled={saving}>
                Crear playlist
              </button>
            </form>

            <div className="digital-signage-card">
              <h3>Playlists</h3>
              <div className="digital-pill-list">
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
            </div>
          </div>

          <div className="digital-signage-card">
            {!selectedPlaylist ? (
              <p className="digital-empty">Selecciona o crea una playlist.</p>
            ) : (
              <>
                <div className="digital-card-heading">
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

                <PlaylistItemsEditor
                  items={selectedPlaylist.items || []}
                  saving={saving}
                  onChange={updatePlaylistItems}
                />
              </>
            )}
          </div>
        </div>
      )}

      {!loading && activeTab === "devices" && (
        <div className="digital-signage-grid">
          <form className="digital-signage-card" onSubmit={handleCreateDevice}>
            <h3>Nuevo dispositivo</h3>
            <div className="digital-form-grid">
              <label>
                Nombre
                <input value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} placeholder="Pantalla recepcion" />
              </label>
              <label>
                Plantel
                <PlantelSelect value={deviceForm.plantel} onChange={(value) => setDeviceForm({ ...deviceForm, plantel: value })} />
              </label>
              <label>
                Ubicacion
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
            <button type="submit" className="visual-primary-button" disabled={saving}>
              Crear dispositivo
            </button>
          </form>

          <div className="digital-signage-card">
            <div className="digital-card-heading">
              <h3>Dispositivos</h3>
              <span>{devices.length} registrados</span>
            </div>

            <div className="digital-device-list">
              {devices.length === 0 && <p className="digital-empty">Sin dispositivos registrados.</p>}
              {devices.map((device) => (
                <article className="digital-device-row" key={device.id}>
                  <div>
                    <strong>{device.name || "Pantalla sin nombre"}</strong>
                    <span>{device.plantel || "Sin plantel"} - {device.location || "Sin ubicacion"}</span>
                    <small className={isDeviceOnline(device) ? "online" : "offline"}>
                      {isDeviceOnline(device) ? "Online" : "Offline"}
                    </small>
                  </div>

                  <label>
                    Playlist
                    <select value={device.assignedPlaylistId || ""} onChange={(event) => runAction(() => updateSignageDevice(device.id, { assignedPlaylistId: event.target.value }), "Dispositivo actualizado.")}>
                      <option value="">Sin playlist</option>
                      {playlists.map((playlist) => (
                        <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                      ))}
                    </select>
                  </label>

                  <code>{getPlayerUrl(device.deviceToken || device.id)}</code>

                  <div className="digital-row-actions">
                    <button type="button" className="visual-outline-button" onClick={() => copyPlayerUrl(device)}>
                      Copiar URL
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => runAction(() => updateSignageDevice(device.id, { active: device.active === false }), "Dispositivo actualizado.")} disabled={saving}>
                      {device.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <button type="button" className="danger-table-button" onClick={() => window.confirm("Eliminar dispositivo?") && runAction(() => deleteSignageDevice(device.id), "Dispositivo eliminado.")} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && activeTab === "preview" && (
        <div className="digital-signage-grid compact">
          <div className="digital-signage-card">
            <h3>Vista previa</h3>
            <label>
              Playlist
              <select value={previewPlaylist?.id || ""} onChange={(event) => setPreviewPlaylistId(event.target.value)}>
                {playlists.map((playlist) => (
                  <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                ))}
              </select>
            </label>
            <p className="digital-helper">Simulador local de la secuencia seleccionada.</p>
          </div>

          <div className="digital-signage-card">
            <SignagePreview key={previewPlaylist?.id || "empty"} playlist={previewPlaylist} />
          </div>
        </div>
      )}
    </section>
  );
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
    onChange(nextItems, "Duracion actualizada.");
  }

  if (items.length === 0) {
    return <p className="digital-empty">Playlist sin items.</p>;
  }

  return (
    <div className="digital-playlist-items">
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
    return (
      <video src={asset.url} muted playsInline />
    );
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
  const lastSeenMillis =
    Number(device?.lastSeenMillis || 0) ||
    device?.lastSeenAt?.toMillis?.() ||
    0;

  if (!lastSeenMillis) return false;

  return Date.now() - lastSeenMillis <= 2 * 60 * 1000;
}
