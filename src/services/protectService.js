import { auth } from "./firebase";

const PROTECT_API_BASE = (import.meta.env.VITE_PROTECT_API_BASE_URL || "").replace(/\/+$/, "");

async function getAuthHeaders() {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Debes iniciar sesión para usar UniFi Protect.");
  }

  const idToken = await currentUser.getIdToken();

  return { Authorization: `Bearer ${idToken}` };
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || "No se pudo completar la solicitud a UniFi Protect.");
  }

  return data;
}

export function isProtectBackendConfigured() {
  return Boolean(PROTECT_API_BASE);
}

// status: "connected" | "disconnected" | "unauthorized" | "backend-unavailable"
export async function testProtectConnection() {
  if (!PROTECT_API_BASE) {
    return {
      status: "backend-unavailable",
      message: "Backend no disponible. Configura VITE_PROTECT_API_BASE_URL.",
    };
  }

  let headers;

  try {
    headers = await getAuthHeaders();
  } catch (authError) {
    return { status: "unauthorized", message: authError.message };
  }

  let response;

  try {
    response = await fetch(`${PROTECT_API_BASE}/api/protect/test`, { headers });
  } catch {
    return {
      status: "backend-unavailable",
      message: "No se pudo conectar con el backend. Revisa que esté corriendo y la URL configurada.",
    };
  }

  if (response.status === 401 || response.status === 403) {
    const data = await response.json().catch(() => null);
    return {
      status: "unauthorized",
      message: data?.message || "No autorizado. Solo administradores pueden usar UniFi Protect.",
    };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      status: "backend-unavailable",
      message: data?.message || "El backend de UniFi Protect respondió con un error.",
    };
  }

  return {
    status: data?.connected ? "connected" : "disconnected",
    message:
      data?.message ||
      (data?.connected
        ? "Conectado con UniFi Protect."
        : "No se pudo conectar con UniFi Protect. Revisa la URL/API key del backend."),
  };
}

export async function fetchProtectCameras() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${PROTECT_API_BASE}/api/protect/cameras`, { headers });

  return parseJsonResponse(response);
}

export async function fetchProtectCameraSnapshotBlobUrl(cameraId) {
  const headers = await getAuthHeaders();
  const response = await fetch(`${PROTECT_API_BASE}/api/protect/cameras/${cameraId}/snapshot`, {
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "No se pudo obtener el snapshot de la cámara.");
  }

  const blob = await response.blob();

  return URL.createObjectURL(blob);
}
