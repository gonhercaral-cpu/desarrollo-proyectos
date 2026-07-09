require("dotenv").config();

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const PORT = process.env.PORT || 8080;
// UNIFI_PROTECT_BASE_URL debe apuntar a la consola Protect, incluyendo el
// prefijo de la integration API, ej: https://IP_LOCAL/proxy/protect/integration/v1
const UNIFI_PROTECT_BASE_URL = (process.env.UNIFI_PROTECT_BASE_URL || "").replace(/\/+$/, "");
const UNIFI_PROTECT_API_KEY = process.env.UNIFI_PROTECT_API_KEY || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const PROTECT_LOGS_COLLECTION = "protectLogs";
const REQUEST_TIMEOUT_MS = 8000;

const PLANTEL_OPTIONS = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Coffee Beans Factory",
];

// Solo para desarrollo: consolas Protect locales usan certificado autofirmado.
// Nunca activar en producción.
if (process.env.UNIFI_PROTECT_ALLOW_SELF_SIGNED === "true") {
  console.warn(
    "UNIFI_PROTECT_ALLOW_SELF_SIGNED=true: verificación TLS deshabilitada. Solo usar en desarrollo."
  );
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

function isProtectConfigured() {
  return Boolean(UNIFI_PROTECT_BASE_URL && UNIFI_PROTECT_API_KEY);
}

function guessPlantel(camera) {
  const haystack = `${camera?.name || ""} ${camera?.group?.name || ""}`.toLowerCase();
  const match = PLANTEL_OPTIONS.find((plantel) => haystack.includes(plantel.toLowerCase()));

  return match || "Otro";
}

// API key siempre en header, nunca en la URL.
async function fetchUnifiProtect(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${UNIFI_PROTECT_BASE_URL}${path}`, {
      headers: {
        "X-API-Key": UNIFI_PROTECT_API_KEY,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function getProtectErrorMessage(response, contentType = "") {
  if (response.status === 404) {
    return "Endpoint no encontrado. Revisa que UNIFI_PROTECT_BASE_URL incluya /proxy/protect/integration/v1.";
  }

  if (contentType.includes("text/html")) {
    return "Estás usando una URL visual/dashboard, no una URL de API.";
  }

  if (response.status === 401) {
    return "UniFi Protect rechazó la API key configurada.";
  }

  return `UniFi Protect respondió con estado ${response.status}.`;
}

function describeProtectError(error) {
  if (error.name === "AbortError") {
    return "UniFi Protect no respondió a tiempo (timeout).";
  }

  if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
    return "No se pudo contactar a UniFi Protect. Revisa la URL configurada.";
  }

  if (error.cause?.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || error.cause?.code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return "Certificado SSL autofirmado. En desarrollo, activa UNIFI_PROTECT_ALLOW_SELF_SIGNED=true.";
  }

  return error.message || "No se pudo contactar a UniFi Protect.";
}

async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.get("Authorization") || "";
    const match = authHeader.match(/^Bearer (.+)$/);

    if (!match) {
      res.status(401).json({ ok: false, code: "unauthenticated", message: "Falta el token de autenticación." });
      return;
    }

    const decodedToken = await admin.auth().verifyIdToken(match[1]);
    const userSnapshot = await admin.firestore().doc(`users/${decodedToken.uid}`).get();

    if (!userSnapshot.exists) {
      res.status(403).json({ ok: false, code: "permission-denied", message: "Tu usuario no tiene perfil en Firestore." });
      return;
    }

    const profile = userSnapshot.data();

    if (profile.role !== "admin" || profile.active !== true) {
      res.status(403).json({ ok: false, code: "permission-denied", message: "Solo un administrador puede acceder a UniFi Protect." });
      return;
    }

    req.protectUser = {
      uid: decodedToken.uid,
      name: profile.name || profile.email || "Administrador",
      email: profile.email || "",
    };

    next();
  } catch (error) {
    console.error("Token inválido en Protect:", error);
    res.status(401).json({ ok: false, code: "unauthenticated", message: "Token inválido o expirado." });
  }
}

async function logProtectAction({ userId, userName, userEmail, cameraId, action }) {
  try {
    await admin.firestore().collection(PROTECT_LOGS_COLLECTION).add({
      userId: userId || "",
      userName: userName || "",
      userEmail: userEmail || "",
      cameraId: cameraId || "",
      action: action || "",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("No se pudo registrar bitácora de Protect:", error);
  }
}

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origen no permitido por CORS."));
    },
  })
);
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "healthy" });
});

app.get("/api/protect/test", requireAdmin, async (req, res) => {
  if (!isProtectConfigured()) {
    res.json({
      connected: false,
      statusCode: null,
      message: "Integración UniFi Protect pendiente de configurar.",
    });
    return;
  }

  try {
    const metaResponse = await fetchUnifiProtect("/meta/info");
    const metaContentType = metaResponse.headers.get("content-type") || "";

    if (!metaResponse.ok) {
      res.json({
        connected: false,
        statusCode: metaResponse.status,
        message: getProtectErrorMessage(metaResponse, metaContentType),
      });
      return;
    }

    if (!metaContentType.includes("application/json")) {
      res.json({
        connected: false,
        statusCode: metaResponse.status,
        message: getProtectErrorMessage(metaResponse, metaContentType),
      });
      return;
    }

    const metaInfo = await metaResponse.json();

    if (!metaInfo?.applicationVersion) {
      res.json({
        connected: false,
        statusCode: metaResponse.status,
        message: "UniFi Protect respondió pero sin la información de versión esperada.",
      });
      return;
    }

    const camerasResponse = await fetchUnifiProtect("/cameras");

    if (!camerasResponse.ok) {
      const camerasContentType = camerasResponse.headers.get("content-type") || "";
      res.json({
        connected: false,
        statusCode: camerasResponse.status,
        message: getProtectErrorMessage(camerasResponse, camerasContentType),
      });
      return;
    }

    res.json({
      connected: true,
      statusCode: 200,
      message: `Conectado a UniFi Protect (versión ${metaInfo.applicationVersion}).`,
    });
  } catch (error) {
    console.error("Error probando conexión con Protect:", error);
    res.json({
      connected: false,
      statusCode: null,
      message: describeProtectError(error),
    });
  }
});

app.get("/api/protect/cameras", requireAdmin, async (req, res) => {
  if (!isProtectConfigured()) {
    res.json({
      ok: true,
      configured: false,
      cameras: [],
      message: "Integración UniFi Protect pendiente de configurar.",
    });
    return;
  }

  try {
    const response = await fetchUnifiProtect("/cameras");
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok || !contentType.includes("application/json")) {
      res.status(502).json({
        ok: false,
        configured: true,
        code: "protect-unreachable",
        message: getProtectErrorMessage(response, contentType),
      });
      return;
    }

    const cameras = await response.json();

    const normalizedCameras = (Array.isArray(cameras) ? cameras : []).map((camera) => {
      const isOnline = Boolean(camera.isConnected ?? camera.state === "CONNECTED");

      return {
        id: camera.id,
        name: camera.name || "Cámara sin nombre",
        state: camera.state || (isOnline ? "CONNECTED" : "DISCONNECTED"),
        isOnline,
        plantel: guessPlantel(camera),
        lastSeen: camera.lastSeen || camera.lastMotion || null,
        snapshotUrl: `/api/protect/cameras/${camera.id}/snapshot`,
      };
    });

    res.json({ ok: true, configured: true, cameras: normalizedCameras });
  } catch (error) {
    console.error("Error consultando cámaras de Protect:", error);
    res.status(502).json({
      ok: false,
      configured: true,
      code: "protect-unreachable",
      message: describeProtectError(error),
    });
  }
});

app.get("/api/protect/cameras/:id/snapshot", requireAdmin, async (req, res) => {
  const cameraId = req.params.id;

  if (!isProtectConfigured()) {
    res.status(503).json({
      ok: false,
      configured: false,
      message: "Integración UniFi Protect pendiente de configurar.",
    });
    return;
  }

  try {
    const response = await fetchUnifiProtect(`/cameras/${cameraId}/snapshot?highQuality=true`);

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const status = response.status === 404 ? 404 : 502;

      res.status(status).json({
        ok: false,
        code: status === 404 ? "camera-not-found" : "snapshot-unavailable",
        message:
          status === 404
            ? "La cámara no existe o está offline."
            : getProtectErrorMessage(response, contentType),
      });
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    await logProtectAction({
      userId: req.protectUser.uid,
      userName: req.protectUser.name,
      userEmail: req.protectUser.email,
      cameraId,
      action: "view_snapshot",
    });

    res.set("Content-Type", "image/jpeg");
    res.send(buffer);
  } catch (error) {
    console.error("Error obteniendo snapshot:", error);
    res.status(502).json({
      ok: false,
      code: "snapshot-unavailable",
      message: describeProtectError(error),
    });
  }
});

app.listen(PORT, () => {
  console.log(`backend-protect escuchando en el puerto ${PORT}`);
});
