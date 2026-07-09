import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  fetchProtectCameraSnapshotBlobUrl,
  fetchProtectCameras,
  testProtectConnection,
} from "../services/protectService";

const PLANTEL_OPTIONS = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Coffee Beans Factory",
  "Otro",
];

const CONNECTION_STATUS_LABELS = {
  connected: { label: "Conectado", dotClass: "status-green" },
  disconnected: { label: "No conectado", dotClass: "status-gray" },
  unauthorized: { label: "No autorizado", dotClass: "status-purple" },
  "backend-unavailable": { label: "Backend no disponible", dotClass: "status-gray" },
};

function ProtectCameraIcon() {
  return (
    <svg className="nav-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h11l2-3h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12.5" cy="13.5" r="3.6" />
    </svg>
  );
}

export default function ProtectCameras() {
  const { isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [configured, setConfigured] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [plantelFilter, setPlantelFilter] = useState("all");
  const [snapshots, setSnapshots] = useState({});

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

    async function loadCameras() {
      setLoading(true);
      setConnectionStatus("");
      setConnectionMessage("");

      try {
        const testResult = await testProtectConnection();

        if (cancelled) return;

        setConnectionStatus(testResult?.status || "backend-unavailable");
        setConnectionMessage(testResult?.message || "");

        if (testResult?.status !== "connected") {
          setConfigured(false);
          setCameras([]);
          return;
        }

        const result = await fetchProtectCameras();

        if (cancelled) return;

        setConfigured(Boolean(result?.configured));
        setCameras(Array.isArray(result?.cameras) ? result.cameras : []);
      } catch (loadError) {
        if (cancelled) return;

        console.error("No se pudo conectar con UniFi Protect:", loadError);
        setConnectionStatus("backend-unavailable");
        setConnectionMessage(
          loadError.message || "No se pudo conectar con UniFi Protect. Revisa la URL/API key del backend."
        );
        setCameras([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCameras();

    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!configured || cameras.length === 0) return undefined;

    let cancelled = false;

    cameras.forEach((camera) => {
      if (!camera.isOnline) return;

      fetchProtectCameraSnapshotBlobUrl(camera.id)
        .then((blobUrl) => {
          if (cancelled) return;
          setSnapshots((current) => ({ ...current, [camera.id]: blobUrl }));
        })
        .catch((snapshotError) => {
          console.error(`No se pudo cargar snapshot de ${camera.id}:`, snapshotError);
        });
    });

    return () => {
      cancelled = true;
    };
  }, [configured, cameras]);

  useEffect(() => {
    return () => {
      Object.values(snapshots).forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCameras = useMemo(() => {
    if (plantelFilter === "all") return cameras;
    return cameras.filter((camera) => camera.plantel === plantelFilter);
  }, [cameras, plantelFilter]);

  if (!isAdmin) {
    return (
      <div className="card">
        <h2>Acceso restringido</h2>
        <p>Solo administradores pueden ver el módulo de UniFi Protect.</p>
      </div>
    );
  }

  return (
    <div className="protect-cameras-page">
      <section className="module-topbar module-topbar-protect">
        <div className="module-topbar-main">
          <span className="module-topbar-module-icon">
            <ProtectCameraIcon />
          </span>

          <div className="module-topbar-copy">
            <p className="section-kicker module-topbar-kicker">Administración</p>
            <h1>UniFi Protect</h1>
            <p>Visualiza las cámaras de los planteles sin salir del sistema.</p>
          </div>
        </div>
      </section>

      {!loading && connectionStatus && (
        <p className="protect-camera-meta protect-connection-status">
          <span
            className={`status-dot ${CONNECTION_STATUS_LABELS[connectionStatus]?.dotClass || "status-gray"}`}
          />
          {CONNECTION_STATUS_LABELS[connectionStatus]?.label || connectionStatus}
        </p>
      )}

      <div className="filter-pills">
        <button
          type="button"
          className={plantelFilter === "all" ? "active" : ""}
          onClick={() => setPlantelFilter("all")}
        >
          Todos los planteles
        </button>

        {PLANTEL_OPTIONS.map((plantel) => (
          <button
            key={plantel}
            type="button"
            className={plantelFilter === plantel ? "active" : ""}
            onClick={() => setPlantelFilter(plantel)}
          >
            {plantel}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card">
          <h3>Cargando cámaras...</h3>
        </div>
      )}

      {!loading && connectionStatus === "backend-unavailable" && (
        <div className="empty-state small">
          <h3>Backend no disponible</h3>
          <p>{connectionMessage || "No se pudo conectar con el backend de UniFi Protect."}</p>
        </div>
      )}

      {!loading && connectionStatus === "unauthorized" && (
        <div className="empty-state small">
          <h3>No autorizado</h3>
          <p>{connectionMessage || "Solo administradores pueden usar UniFi Protect."}</p>
        </div>
      )}

      {!loading && connectionStatus === "disconnected" && (
        <div className="empty-state small">
          <h3>No conectado</h3>
          <p>{connectionMessage || "No se pudo conectar con UniFi Protect. Revisa la URL/API key del backend."}</p>
        </div>
      )}

      {!loading && connectionStatus === "connected" && !configured && (
        <div className="empty-state small">
          <h3>Integración UniFi Protect pendiente de configurar</h3>
          <p>
            Configura el backend (UNIFI_PROTECT_BASE_URL, UNIFI_PROTECT_API_KEY) para ver las
            cámaras aquí.
          </p>
        </div>
      )}

      {!loading && connectionStatus === "connected" && configured && filteredCameras.length === 0 && (
        <div className="empty-state small">
          <h3>Sin cámaras para este filtro</h3>
          <p>Prueba con otro plantel o revisa la configuración en UniFi Protect.</p>
        </div>
      )}

      {!loading && connectionStatus === "connected" && configured && filteredCameras.length > 0 && (
        <div className="protect-camera-grid">
          {filteredCameras.map((camera) => (
            <div className="card protect-camera-card" key={camera.id}>
              <div className="protect-camera-snapshot">
                {snapshots[camera.id] ? (
                  <img src={snapshots[camera.id]} alt={`Snapshot de ${camera.name}`} />
                ) : (
                  <div className="protect-camera-snapshot-placeholder">
                    {camera.isOnline ? "Cargando snapshot..." : "Sin señal"}
                  </div>
                )}
              </div>

              <h3>{camera.name}</h3>

              <p className="protect-camera-meta">
                <span
                  className={`status-dot ${camera.isOnline ? "status-green" : "status-gray"}`}
                />
                {camera.isOnline ? "En línea" : "Desconectada"}
                <span className="protect-camera-plantel">{camera.plantel}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
