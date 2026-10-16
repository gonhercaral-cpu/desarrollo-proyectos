import { escapeHtml as escape } from "../utils/dom";
import { createDeviceSession } from "./device-auth";
import type { DeviceState } from "./device-session";
import { visibleDeviceName } from "./device-label";
import { connectionLabel, diagnose } from "./connection";
import { NativeCache } from "./native-cache";
import { PublicationApi } from "./remote";
import { type Manifest, type Publication } from "./manifest";
import { icon } from "../ui/icons";
import { sidebarMarkup, levelName, libraryLevelIds } from "../ui/shell";
import { unitCard } from "../ui/library-view";
import { LocalThumbnails } from "../ui/thumbnails";
import { mergeLibraryPublications } from "./library-publications";
import { syncDiagnostic } from "./sync-diagnostics";
import { openLocalClass, SyncEngine, unitSyncMessage, type Progress } from "./sync";
import "./library.css";
import { ClassroomPlayer } from "../player/ClassroomPlayer";
import { prepareNativeMedia } from "../player/native-media";
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
  let search = "";
  let view: "grid" | "list" = "grid";
  let localOnly = false;
  let updatedAt: number | undefined;
  const thumbnails = new LocalThumbnails();
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
  const feedback = () => message || device.message ? `<p class="offline-feedback ${device.issue || opening ? "" : "visually-hidden"}" role="status">${escape(message || device.message)}</p>` : "";
  function sidebar(inClass = false): string {
    const combined = mergeLibraryPublications(locals, publications);
    const levels = libraryLevelIds([...combined.values()].map(({ local, remote }) => remote?.levelId || local!.unit.levelId));
    return sidebarMarkup({ levels, selectedLevel, localOnly, inClass, deviceName: device.identity ? visibleDeviceName(device.identity) : "", state: device.online ? "Sincronizado" : device.issue && device.issue !== "offline" ? connectionLabel(device.issue) : "Offline", detail: device.issue ? connectionLabel(device.issue) : "", busy: !!downloading || refreshing, updatedAt });
  }
  function bindSidebar(inClass = false): void {
    root.querySelectorAll<HTMLButtonElement>("[data-library-nav], [data-my-classes], .classroom-sidebar [data-level]").forEach(button => {
      button.onclick = () => {
        if (button.hasAttribute("data-my-classes")) localOnly = true;
        else if (button.hasAttribute("data-library-nav")) localOnly = false;
        else selectedLevel = button.dataset.level!;
        if (inClass) root.querySelector<HTMLButtonElement>("[data-exit]")?.click();
        else render();
      };
    });
    root.querySelector<HTMLButtonElement>("[data-sidebar-refresh]")!.onclick = () => { void refresh(); };
  }
  function render(): void {
    if (player) {
      const current = root.querySelector(".classroom-sidebar");
      if (current) { current.outerHTML = sidebar(true); bindSidebar(true); }
      return;
    }
    thumbnails.pause();
    if (device.phase !== "ready") {
      root.innerHTML = `<main class="offline-login"><section class="ui-card ui-stack"><img src="/active-classroom-icon.png" alt="" width="64"/><h1>${device.phase === "loading" ? "Active Classroom" : "Este equipo necesita activarse"}</h1><p>${escape(device.identity ? visibleDeviceName(device.identity) : "Preparando equipo…")}</p>${device.code ? `<strong class="activation-code" aria-label="Código de activación">${escape(`${device.code.slice(0, 5)}-${device.code.slice(5)}`)}</strong>` : ""}<p role="status">${escape(device.message || "Conecta Internet para obtener el código de activación.")}</p><button class="button button-primary" data-activate ${device.phase === "loading" ? "disabled" : ""}>Reintentar activación</button></section></main>`;
      root.querySelector<HTMLButtonElement>("[data-activate]")!.onclick = () => { void reconnect(); };
      return;
    }
    const combined = mergeLibraryPublications(locals, publications);
    const levels = libraryLevelIds([...combined.values()].map(({ local, remote }) => remote?.levelId || local!.unit.levelId));
    const matches = [...combined.entries()].filter(([, { local, remote }]) =>
      (!localOnly || !!local) && (!selectedLevel || (remote?.levelId || local!.unit.levelId) === selectedLevel)
      && (remote?.name || local!.unit.name).toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));
    const cards = matches.map(([unitId, { local, remote }]) => unitCard({ unitId, local, remote,
      busy: downloading === unitId, error: errors.get(unitId), opening,
      percent: progress?.unitId === unitId && progress.total ? Math.min(100, Math.floor(100 * progress.bytes / progress.total)) : 0,
      progressLabel: progress?.phase === "activate" ? "Activando versión verificada…" : progress?.phase === "verify" ? "Verificando integridad…" : progress?.fileName || "Obteniendo manifest…",
      disableSync: !!downloading || !remote || !!(!errors.has(unitId) && local && local.version >= remote.version), activating: progress?.phase === "activate",
    })).join("");
    root.innerHTML = `<div class="desktop-shell offline-shell">${sidebar()}<section class="library-workspace">
      <header class="library-header"><div class="library-heading"><span class="library-heading-icon">${icon("library")}</span><div><h1>${localOnly ? "Mis clases" : "Biblioteca"}</h1><p>Gestiona y abre tus clases</p></div></div><button class="button button-primary" data-refresh ${refreshing ? "disabled" : ""}>${icon("refresh", refreshing ? "is-spinning" : "")}${refreshing ? "Consultando…" : "Actualizar biblioteca"}</button></header>
      <section class="library-controls" aria-label="Filtros de Biblioteca"><nav class="library-filters" aria-label="Filtrar por nivel"><button class="button ${!selectedLevel ? "button-primary" : "button-level"}" data-level="" aria-pressed="${!selectedLevel}">${icon("levels")}Todos los niveles</button>${levels.map(level => `<button class="button button-level ${selectedLevel === level ? "is-active" : ""}" data-level="${escape(level)}" aria-pressed="${selectedLevel === level}">${escape(levelName(level))}</button>`).join("")}</nav><label class="library-search">${icon("search")}<input data-search type="search" placeholder="Buscar unidades..." aria-label="Buscar unidades" value="${escape(search)}"/></label><div class="library-view-toggle" aria-label="Vista de unidades"><button data-view="grid" aria-label="Vista de cuadrícula" aria-pressed="${view === "grid"}">${icon("grid")}</button><button data-view="list" aria-label="Vista de lista" aria-pressed="${view === "list"}">${icon("list")}</button></div></section>
      <main class="offline-content">${feedback()}<div class="unit-grid ${view === "list" ? "is-list" : ""}">${cards}</div>${!matches.length ? `<p class="library-empty">${combined.size ? "No hay unidades que coincidan con los filtros." : device.online ? "No hay clases publicadas." : "No hay clases locales. Actualiza la biblioteca cuando puedas conectar con el servidor."}</p>` : ""}</main></section></div>`;
    bindSidebar();
    root.querySelectorAll<HTMLButtonElement>(".library-filters [data-level]").forEach(button => { button.onclick = () => { selectedLevel = button.dataset.level!; render(); }; });
    root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(button => { button.onclick = () => { view = button.dataset.view as "grid" | "list"; render(); }; });
    root.querySelector<HTMLInputElement>("[data-search]")!.oninput = event => {
      const input = event.target as HTMLInputElement; search = input.value;
      const position = input.selectionStart; render();
      const restored = root.querySelector<HTMLInputElement>("[data-search]")!; restored.focus();
      if (position !== null) { try { restored.setSelectionRange(position, position); } catch { /* Search inputs may not support selection. */ } }
    };
    root.querySelector<HTMLButtonElement>("[data-refresh]")!.onclick = () => { void refresh(); };
    root.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => engine?.cancel());
    root.querySelectorAll<HTMLButtonElement>("[data-sync]").forEach(button => { button.onclick = () => { const remote = publications.find(item => item.unitId === button.dataset.sync); if (remote) void synchronize(remote); }; });
    root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(button => { button.onclick = () => { void open(button.dataset.open!); }; });
    root.querySelectorAll<HTMLButtonElement>("[data-unit-action]").forEach(button => { button.onclick = () => { button.closest("article")?.querySelector<HTMLButtonElement>(`[data-${button.dataset.unitAction}]`)?.click(); }; });
    void thumbnails.mount(root, owner, locals);
  }
  async function refresh(): Promise<void> {
    if (!api || refreshing || player || opening) return;
    const current = epoch;
    syncDiagnostic("REFRESH_START");
    refreshing = true; render();
    refreshController = new AbortController();
    try {
      const available = await api.list(refreshController.signal);
      if (current !== epoch) return;
      publications = available;
      updatedAt = Date.now();
      for (const [unitId, entry] of mergeLibraryPublications(locals, available)) {
        if (entry.localVersion !== undefined) syncDiagnostic("LOCAL_PUBLICATION", { unitId, version: entry.localVersion });
        if (entry.localVersion !== undefined && entry.remoteVersion !== undefined && entry.remoteVersion > entry.localVersion) syncDiagnostic("UPDATE_AVAILABLE", { unitId, version: entry.remoteVersion, localVersion: entry.localVersion });
      }
      session.connected();
      diagnose("publications", available.length ? "listed" : "empty");
      message = available.length ? "Publicaciones consultadas. Las clases locales se conservan hasta completar cada actualización." : "No hay clases publicadas. Tus clases locales se conservan.";
      syncDiagnostic("REFRESH_COMPLETE");
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
    } catch (error) {
      if (current === epoch) {
        errors.set(publication.unitId, unitSyncMessage(error));
        // A failed Unit does not invalidate a successful catalog connection.
        // Authorization revocation is still handled by api.onDenied.
        if (error && typeof error === "object" && "code" in error && ["network", "offline", "backend", "server", "timeout", "auth", "expired", "401", "403"].includes(String(error.code))) retryPublication = publication;
      }
    }
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
        thumbnails.pause();
        root.innerHTML = `<div class="desktop-shell is-classroom">${sidebar(true)}<div class="classroom-workspace" data-classroom-host></div></div>`;
        bindSidebar(true);
        player = new ClassroomPlayer(root.querySelector<HTMLElement>("[data-classroom-host]")!, classroom, () => {
          player = undefined; message = "Clase cerrada. Verificando biblioteca local…"; render();
          void currentCache.list().then((saved) => {
            if (current !== epoch) return;
            locals = saved;
            if (!saved.some((item) => item.unit.unitId === unitId && item.version === local.version)) errors.set(unitId, "La copia local requiere reparación. Sincroniza de nuevo cuando tengas conexión.");
            message = "Biblioteca local verificada."; render();
          }).catch((error) => { if (current === epoch) { message = String(error); render(); } });
        }, {
          prepareMediaSource: (id) => prepareNativeMedia(currentCache.owner, classroom, id),
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
