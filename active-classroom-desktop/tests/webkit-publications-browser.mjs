import { PublicationApi } from "../src/offline/remote.ts";
import { sha256 } from "../src/offline/manifest.ts";
import { connectionError, connectionLabel } from "../src/offline/connection.ts";

const check = (condition, message) => { if (!condition) throw new Error(message); };
async function run() {
  const fixture = await (await fetch("/fixture")).json();
  const nativeFetch = window.fetch;
  // Redirect to the local fixture while preserving the receiver under test.
  function localFetch(url, init) { const parsed = new URL(url); return nativeFetch.call(this, `${parsed.pathname}${parsed.search}`, init); }
  const api = new PublicationApi(async () => "webkit-test-id-token", localFetch);
  const labels = []; api.onDevice = async (device) => { labels.push(device.displayName); };
  const publications = await api.list(); check(publications[0].unitId === fixture.publication.unitId, "Catálogo incorrecto");
  const manifest = await api.manifest(publications[0]); check(manifest.version === fixture.manifest.version, "Manifest incorrecto");
  const chunks = [];
  await api.download(manifest, manifest.resources[0], async (chunk) => chunks.push(chunk), new AbortController().signal);
  check(await sha256(new Uint8Array(await new Blob(chunks).arrayBuffer())) === manifest.resources[0].download.checksums.sha256, "Integridad incorrecta");
  check(labels.length === 2 && labels.every((name) => name === "Equipo Prueba"), "Nombre visible perdido");
  for (const status of [401, 403, 404, 500, 503]) {
    let failure;
    try { await api.request(`probe?status=${status}`, {}, async () => null); } catch (error) { failure = error; }
    check(failure?.code === String(status), `Estado HTTP ${status} perdido`);
    check(connectionLabel(connectionError(failure, "publications").code) !== "Modo offline", "Estado HTTP confundido con offline");
  }
  return { ok: true, checks: "list, manifest, file, sha256, displayName, 401, 403, 404, 500, 503" };
}
run().then((result) => {
  document.querySelector("#result").textContent = JSON.stringify(result);
  window.webkit?.messageHandlers?.result?.postMessage(JSON.stringify(result));
}).catch((error) => {
  const result = { ok: false, message: error.message };
  document.querySelector("#result").textContent = JSON.stringify(result);
  window.webkit?.messageHandlers?.result?.postMessage(JSON.stringify(result));
});
