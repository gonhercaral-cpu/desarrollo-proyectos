import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createPairingSession,
  subscribePairingSession,
  updatePairingSessionHeartbeat,
} from "../services/digitalSignageService";

const PAIRING_HEARTBEAT_MS = 30 * 1000;

export default function SignageSetup() {
  const navigate = useNavigate();
  const [requestKey, setRequestKey] = useState(0);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const expiresAtMillis = useMemo(() => getSessionExpiryMillis(session), [session]);
  const isExpired =
    session?.status === "expired" ||
    (expiresAtMillis > 0 && now >= expiresAtMillis && session?.status !== "claimed");

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let heartbeatId = 0;

    createPairingSession()
      .then((nextSession) => {
        if (cancelled) return;

        setSession(nextSession);
        setError("");
        setLoading(false);

        unsubscribe = subscribePairingSession(
          nextSession.id,
          (updatedSession) => {
            if (!updatedSession) {
              setError("No se pudo encontrar la sesión de vinculación.");
              return;
            }

            setSession(updatedSession);

            if (updatedSession.status === "claimed" && updatedSession.deviceToken) {
              navigate(`/signage/player/${updatedSession.deviceToken}`, { replace: true });
            }
          },
          () => {
            setError("No se pudo escuchar la vinculación.");
          }
        );

        updatePairingSessionHeartbeat(nextSession.id, nextSession.setupSecret).catch(() => {});
        heartbeatId = window.setInterval(() => {
          updatePairingSessionHeartbeat(nextSession.id, nextSession.setupSecret).catch(() => {});
        }, PAIRING_HEARTBEAT_MS);
      })
      .catch((createError) => {
        if (cancelled) return;
        setError(createError.message || "No se pudo generar el código.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe();
      if (heartbeatId) window.clearInterval(heartbeatId);
    };
  }, [navigate, requestKey]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  function regenerateCode() {
    setSession(null);
    setError("");
    setLoading(true);
    setRequestKey((current) => current + 1);
  }

  return (
    <main className="signage-setup-screen">
      <section className="signage-setup-card">
        <span>Active English School</span>
        <small>Digital Signage</small>
        <h1>Código de vinculación</h1>

        <div className={`signage-setup-code ${isExpired ? "expired" : ""}`}>
          {loading ? "..." : session?.code || "Sin código"}
        </div>

        <p>
          Ingresa este código en el módulo Digital Signage para vincular esta pantalla.
        </p>

        <strong className="signage-setup-status">
          {getSetupStatus({ error, isExpired, loading, session })}
        </strong>

        {isExpired && (
          <button type="button" onClick={regenerateCode}>
            Generar nuevo código
          </button>
        )}

        {error && !loading && !isExpired && (
          <button type="button" onClick={regenerateCode}>
            Reintentar
          </button>
        )}
      </section>
    </main>
  );
}

function getSetupStatus({ error, isExpired, loading, session }) {
  if (loading) return "Generando código...";
  if (error) return error;
  if (isExpired) return "Código expirado.";
  if (session?.status === "claimed") return "Pantalla vinculada. Redirigiendo...";
  return "Esperando vinculación...";
}

function getSessionExpiryMillis(session) {
  const expiresAt = session?.expiresAt;
  if (!expiresAt) return 0;
  if (typeof expiresAt.toMillis === "function") return expiresAt.toMillis();
  if (expiresAt instanceof Date) return expiresAt.getTime();
  return Number(expiresAt) || 0;
}
