import { escapeHtml as escape } from "../utils/dom";
import { createDeviceSession } from "./device-auth";
import type { DeviceState } from "./device-session";
import { visibleDeviceName } from "./device-label";
import { connectionLabel, diagnose } from "./connection";
import { NativeCache } from "./native-cache";
import { PublicationApi } from "./remote";
import { localState, type Manifest, type Publication } from "./manifest";
import { openLocalClass, SyncEngine, type Progress } from "./sync";
import "./library.css";
import { ClassroomPlayer } from "../player/ClassroomPlayer";
import "../player/player.css";

export function mountOfflineLibrary(root: HTMLDivElement): void {
  let device: DeviceState = { phase: "loading", online: false, message: "" };
  let owner = "";
  let retryPublication: Publication | undefined;
  let cache: NativeCache | undefined;
  let cacheReady = false;
  let api: PublicationApi | undefined;
  let engine: SyncEngine | undefined;
  let locals: Manifest[] = [];
  let publications: Publication[] = [];
  let selectedLevel = "";
  let player: ClassroomPlayer | undefined;
  let progress: Progress | undefined;
  let downloading = "";
  let message = "";
  let refreshing = false;
  let opening = false;
  let epoch = 0;
  let refreshController: AbortController | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  const errors = new Map<string, string>();
  const levelName = (id: string) => /^level-\d+$/.test(id) ? `Nivel ${id.slice(6)}` : id;
  const feedback = () => message || device.message ? `<p class="offline-feedback" role="status">${escape(message || device.message)}</p>` : "";
  function render(): void {
    if (player) return;
    if (device.phase !== "ready") {
      root.innerHTML = `<main class="offline-login"><section class="ui-card ui-stack"><img src="/active-classroom-icon.png" alt="" width="64"/><h1>${device.phase === "loading" ? "Active Classroom" : "Este equipo necesita activarse"}</h1><p>${escape(device.identity ? visibleDeviceName(device.identity) : "Preparando equipo…")}</p>${device.code ? `<strong class="activation-code" aria-label="Código de activación">${escape(`${device.code.slice(0, 5)}-${device.code.slice(5)}`)}</strong>` : ""}<p role="status">${escape(device.message || "Conecta Internet para obtener el código de activación.")}</p><button class="button button-primary" data-activate ${device.phase === "loading" ? "disabled" : ""}>Reintentar activación</button></section></main>`;
      root.querySelector<HTMLButtonElement>("[data-activate]")!.onclick = () => { void reconnect(); };
      return;
    }
    const combined = new Map<string, { local?: Manifest; remote?: Publication }>();
    for (const local of locals) combined.set(local.unit.unitId, { local });
    for (const remote of publications) combined.set(remote.unitId, { ...combined.get(remote.unitId), remote });
    const levels = [...new Set([...combined.values()].map(({ local, remote }) => remote?.levelId || local!.unit.levelId))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
    const unitCards = [...combined.entries()].filter(([, item]) => !selectedLevel || (item.remote?.levelId || item.local!.unit.levelId) === selectedLevel).map(([unitId, { local, remote }]) => {
      const busy = downloading === unitId;
      const state = busy ? "Descargando" : errors.has(unitId) ? "Error" : localState(local, remote);
      const percent = progress?.unitId === unitId ? (progress.total ? Math.min(100, Math.floor(100 * progress.bytes / progress.total)) : 0) : 0;
      return `<article class="ui-card unit-sync-card"><p class="section-kicker">${escape(levelName(remote?.levelId || local!.unit.levelId))}</p><h2>${escape(remote?.name || local!.unit.name)}</h2><p>Publicada: ${remote ? `v${remote.version}` : "Sin consultar"} · Local: ${local ? `v${local.version}` : "—"}</p><strong class="sync-label ${state === "Error" ? "sync-error" : ""}">${state}</strong>${busy ? `<progress max="100" value="${percent}" aria-label="Progreso de descarga"></progress><small>${percent}% · ${escape(progress?.phase === "activate" ? "Activando versión verificada…" : progress?.phase === "verify" ? "Verificando integridad…" : progress?.fileName || "Obteniendo manifest…")}</small>` : ""}${errors.has(unitId) ? `<p role="alert" class="sync-error">${escape(errors.get(unitId)!)}</p>` : ""}<div class="ui-cluster"><button class="button button-outline" data-sync="${unitId}" ${downloading || !remote || (!errors.has(unitId) && local && local.version >= remote.version) ? "disabled" : ""}>${errors.has(unitId) ? "Reintentar" : local ? "Actualizar" : "Descargar"}</button><button class="button button-primary" data-open="${unitId}" ${!local || opening ? "disabled" : ""}>Abrir clase</button>${busy ? `<button class="button button-quiet" data-cancel ${progress?.phase === "activate" ? "disabled" : ""}>Cancelar</button>` : ""}</div></article>`;
    }).join("");
    root.innerHTML = `<div class="teacher-shell offline-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark"><img src="/active-classroom-icon.png" alt=""/></span><div><strong>Active Classroom</strong><span>Biblioteca de clases</span></div></div><nav class="ui-stack offline-levels" aria-label="Niveles"><button class="button button-quiet" data-level="" aria-pressed="${!selectedLevel}">Todos los niveles</button>${levels.map((level) => `<button class="button button-quiet" data-level="${level}" aria-pressed="${selectedLevel === level}">${escape(levelName(level))}</button>`).join("")}</nav><div class="sidebar-footer"><div><strong>${escape(visibleDeviceName(device.identity))}</strong><small>${device.online ? downloading || refreshing ? "Sincronizando" : "Actualizado" : escape(connectionLabel(device.issue))}</small></div></div></aside><section class="workspace"><header class="workspace-header"><div><p class="breadcrumb">Nivel / Unit</p><h1>Biblioteca</h1></div><button class="button button-outline" data-refresh ${refreshing ? "disabled" : ""}>${refreshing ? "Consultando…" : "Actualizar biblioteca"}</button></header><main class="offline-content">${feedback()}<div class="ui-grid">${unitCards}</div>${combined.size === 0 ? device.online ? "<p>No hay clases publicadas.</p>" : "<p>No hay clases locales. Actualiza la biblioteca cuando puedas conectar con el servidor.</p>" : ""}</main></section></div>`;
    root.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) => { button.onclick = () => { selectedLevel = button.dataset.level!; render(); }; });
    root.querySelector<HTMLButtonElement>("[data-refresh]")!.onclick = () => { void refresh(); };
    root.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => engine?.cancel());
    root.querySelectorAll<HTMLButtonElement>("[data-sync]").forEach((button) => { button.onclick = () => { const remote = publications.find((item) => item.unitId === button.dataset.sync); if (remote) void synchronize(remote); }; });
    root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => { button.onclick = () => { void open(button.dataset.open!); }; });
  }
  async function refresh(): Promise<void> {
    if (!api || refreshing || player || opening) return;
    const current = epoch;
    refreshing = true; render();
    refreshController = new AbortController();
    try {
      const available = await api.list(refreshController.signal);
      if (current !== epoch) return;
      publications = available;
      session.connected();
      diagnose("publications", available.length ? "listed" : "empty");
      message = available.length ? "Publicaciones consultadas. Las clases locales se conservan hasta completar cada actualización." : "No hay clases publicadas. Tus clases locales se conservan.";
    } catch (error) { if (current === epoch) { session.reportFailure(error, "publications"); message = device.message; } }
    finally { if (current === epoch) { refreshing = false; render(); } }
  }
  async function synchronize(publication: Publication): Promise<void> {
    if (!engine || !cache || !api || downloading || player || opening) return;
    const current = epoch;
    const currentCache = cache;
    const currentApi = api;
    downloading = publication.unitId; errors.delete(publication.unitId); progress = undefined; render();
    try {
      await engine.sync(publication, (value) => {
        if (current !== epoch) return;
        progress = value;
        if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = undefined; if (current === epoch) render(); }, 100);
      });
      const updated = await currentCache.list();
      if (current === epoch) {
        locals = updated; retryPublication = undefined; message = "Versión verificada. Puedes abrir la clase sin conexión.";
        // Reporting is best effort after activation; it cannot invalidate a verified offline class.
        if (!player && !opening) void currentApi.call("reportActiveClassroomDeviceSync", { unitId: publication.unitId, version: publication.version }).catch(() => {});
      }
    } catch (error) { if (current === epoch) { errors.set(publication.unitId, error instanceof Error ? error.message : String(error)); if (error && typeof error === "object" && "code" in error && ["network", "offline", "backend", "server", "timeout", "auth", "expired", "401", "403"].includes(String(error.code))) { retryPublication = publication; session.reportFailure(error, "publications"); } } }
    finally { if (current === epoch) { downloading = ""; progress = undefined; render(); } }
  }
  async function open(unitId: string): Promise<void> {
    const local = locals.find((item) => item.unit.unitId === unitId);
    if (!cache || !local || opening || player) return;
    const current = epoch;
    const currentCache = cache;
    opening = true; message = "Verificando archivos locales…"; render();
    try {
      refreshController?.abort(); engine?.cancel();
      await engine?.active?.promise.catch(() => {});
      if (current !== epoch) return;
      const classroom = await openLocalClass(currentCache, unitId, local.version);
      if (current === epoch) {
        player = new ClassroomPlayer(root, classroom, () => {
          player = undefined; message = "Clase cerrada. Verificando biblioteca local…"; render();
          void currentCache.list().then((saved) => {
            if (current !== epoch) return;
            locals = saved;
            if (!saved.some((item) => item.unit.unitId === unitId && item.version === local.version)) errors.set(unitId, "La copia local requiere reparación. Sincroniza de nuevo cuando tengas conexión.");
            message = "Biblioteca local verificada."; render();
          }).catch((error) => { if (current === epoch) { message = String(error); render(); } });
        }, {
          verifyResource: async (id) => {
            const resource = classroom.manifest.resources.find((item) => item.resourceId === id);
            return !!resource && await currentCache.has(resource.download.checksums.sha256, resource.download.sizeBytes);
          },
        });
      }
    } catch (error) {
      const recovered = await currentCache.list().catch(() => null);
      if (current === epoch) {
        message = error instanceof Error ? error.message : String(error);
        errors.set(unitId, message);
        if (recovered) locals = recovered;
      }
    }
    finally { if (current === epoch) { opening = false; render(); } }
  }
  root.innerHTML = `<main class="desktop-loading"><strong>Active Classroom</strong><span>Restaurando sesión y biblioteca local…</span></main>`;
  const session = createDeviceSession((state) => {
    const becameOnline = !device.online && state.online;
    device = state;
    void (async () => {
      if (state.phase === "ready" && owner === session.owner && cache) {
        render();
        if (becameOnline && cacheReady) void refresh();
        return;
      }
      epoch++; const current = epoch;
      refreshController?.abort(); engine?.cancel();
      locals = []; publications = []; errors.clear(); player?.destroy(); player = undefined; downloading = ""; progress = undefined; refreshing = false; opening = false; message = ""; retryPublication = undefined;
      cache = undefined; cacheReady = false; api = undefined; engine = undefined;
      if (state.phase !== "ready") { owner = ""; render(); return; }
      owner = session.owner;
      cache = new NativeCache(owner);
      api = new PublicationApi((force) => session.token(force));
      api.onDenied = () => session.revalidateAccess();
      api.onDevice = (label) => session.receiveLabel(label);
      engine = new SyncEngine(cache, api);
      try {
        await cache.adoptLegacy().catch(() => { if (current === epoch) message = "No se pudo recuperar alguna clase anterior. Las clases locales existentes se conservan."; });
        const saved = await cache.list(); if (current === epoch) locals = saved;
      }
      catch (error) { if (current === epoch) message = error instanceof Error ? error.message : String(error); }
      if (current !== epoch) return;
      cacheReady = true;
      render();
      if (device.online) void refresh();
    })();
  });
  async function reconnect(): Promise<void> {
    if (player || opening || downloading || refreshing) return;
    if (!device.identity) { await session.start(navigator.onLine); }
    else await session.connect();
    if (device.phase !== "ready" || !device.online) return;
    await refresh();
    if (retryPublication) {
      const publication = publications.find((item) => item.unitId === retryPublication!.unitId);
      if (publication) void synchronize(publication);
    }
  }
  void session.start(navigator.onLine);
  window.addEventListener("online", () => { void reconnect(); });
  window.addEventListener("offline", () => { session.offline(); message = "Modo offline. Puedes abrir tus clases descargadas."; render(); });
  // Retry actual connectivity failures even when the OS reports an active network.
  window.setInterval(() => { if (navigator.onLine && device.phase !== "error" && device.phase !== "revoked" && (device.phase === "activation" || !device.online || retryPublication)) void reconnect(); }, 30000);
}
