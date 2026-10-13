import { setCacheStatistics } from "../settings/statistics.ts";
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
import { reconcileLibrary } from "../ui/library-dom";
import { DownloadQueue, type DownloadTask } from "./download-queue";
import { contentOwner, contentPreferences, saveContentPreferences, requiredContent } from "./content-preferences";
import { unitCard } from "../ui/library-view";
import { LocalThumbnails } from "../ui/thumbnails";
import { mergeLibraryPublications } from "./library-publications";
import { syncDiagnostic } from "./sync-diagnostics";
import { openLocalClass, unitSyncMessage } from "./sync";
import "./library.css";
import { ClassroomPlayer } from "../player/ClassroomPlayer";
import { prepareNativeMedia, prepareAmbientMedia, releaseNativeMedia } from "../player/native-media";
import { AmbientLibrary } from "./ambient.ts";
import { BlobTransfers } from "./sync.ts";
import "../player/player.css";

export function mountOfflineLibrary(root: HTMLDivElement): void {
  let device: DeviceState = { phase: "loading", online: false, message: "" };
  let owner = "";
  let retryPublication: Publication | undefined;
  let cache: NativeCache | undefined;
  let cacheReady = false;
  let api: PublicationApi | undefined;
  let queue: DownloadQueue | undefined;
  let ambient: AmbientLibrary | undefined;
  let thumbnailSignature = "";
  let locals: Manifest[] = [];
  let publications: Publication[] = [];
  let selectedLevel = "";
  let search = "";
  let view: "grid" | "list" = "grid";
  let localOnly = false;
  let updatedAt: number | undefined;
  const thumbnails = new LocalThumbnails();
  let player: ClassroomPlayer | undefined;
  const busy = () => !!queue && [...queue.tasks.values()].some(task => ["queued", "downloading"].includes(task.state));
  let message = "";
  let refreshing = false;
  let opening = false;
  let epoch = 0;
  let refreshController: AbortController | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  const unitOrder = new Map<string, number>();
  const errors = new Map<string, string>();
  const feedback = () => message || device.message ? `<p class="offline-feedback ${device.issue || opening ? "" : "visually-hidden"}" role="status">${escape(message || device.message)}</p>` : "";
  function sidebar(inClass = false): string {
    const combined = mergeLibraryPublications(locals, publications);
    const levels = libraryLevelIds([...combined.values()].map(({ local, remote }) => remote?.levelId || local!.unit.levelId));
    return sidebarMarkup({ levels, selectedLevel, localOnly, inClass, deviceName: device.identity ? visibleDeviceName(device.identity) : "", state: device.online ? "Sincronizado" : device.issue && device.issue !== "offline" ? connectionLabel(device.issue) : "Offline", detail: device.issue ? connectionLabel(device.issue) : "", busy: busy() || refreshing, updatedAt });
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
    setCacheStatistics(locals, Object.fromEntries(libraryLevelIds(locals.map(item => item.unit.levelId)).map(id => [id, levelName(id)])));
    if (player) {
      const current = root.querySelector(".classroom-sidebar");
      if (current) { reconcileLibrary(current as HTMLElement, sidebar(true), true); bindSidebar(true); }
      return;
    }
    if (device.phase !== "ready") {
      thumbnails.pause(); thumbnailSignature = "";
      root.innerHTML = `<main class="offline-login"><section class="ui-card ui-stack"><img src="/active-classroom-icon.png" alt="" width="64"/><h1>${device.phase === "loading" ? "Active Classroom" : "Este equipo necesita activarse"}</h1><p>${escape(device.identity ? visibleDeviceName(device.identity) : "Preparando equipo…")}</p>${device.code ? `<strong class="activation-code" aria-label="Código de activación">${escape(`${device.code.slice(0, 5)}-${device.code.slice(5)}`)}</strong>` : ""}<p role="status">${escape(device.message || "Conecta Internet para obtener el código de activación.")}</p><button class="button button-primary" data-activate ${device.phase === "loading" ? "disabled" : ""}>Reintentar activación</button></section></main>`;
      root.querySelector<HTMLButtonElement>("[data-activate]")!.onclick = () => { void reconnect(); };
      return;
    }
    const combined = mergeLibraryPublications(locals, publications);
    const levels = libraryLevelIds([...combined.values()].map(({ local, remote }) => remote?.levelId || local!.unit.levelId));
    for (const id of combined.keys()) if (!unitOrder.has(id)) unitOrder.set(id, unitOrder.size);
    const matches = [...combined.entries()].sort(([left], [right]) => unitOrder.get(left)! - unitOrder.get(right)!).filter(([, { local, remote }]) =>
      (!localOnly || !!local) && (!selectedLevel || (remote?.levelId || local!.unit.levelId) === selectedLevel)
      && (remote?.name || local!.unit.name).toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")));
    const cards = matches.map(([unitId, { local, remote }]) => {
      const task = queue?.tasks.get(unitId);
      const active = task?.state === "queued" || task?.state === "downloading";
      const progress = task?.progress;
      return unitCard({ unitId, local, remote, busy: active, error: errors.get(unitId), opening,
        percent: progress?.total ? Math.min(100, Math.floor(100 * progress.bytes / progress.total)) : 0,
        progressLabel: task?.state === "queued" ? "En cola…" : progress?.phase === "activate" ? "Activando versión verificada…" : progress?.phase === "verify" ? "Verificando integridad…" : progress?.fileName || "Obteniendo manifest…",
        disableSync: active || !remote || !!(!errors.has(unitId) && local && local.version >= remote.version), activating: progress?.phase === "activate",
        staged: task?.state === "staged",
      });
    }).join("");
    const levelControls = levels.filter(level => level === selectedLevel).map(level => {
      const available = publications.filter(item => item.levelId === level);
      const installed = new Map(locals.map(item => [item.unit.unitId, item.version]));
      const completed = available.filter(item => (installed.get(item.unitId) || 0) >= item.version).length;
      const tasks = available.map(item => queue?.tasks.get(item.unitId));
      const active = tasks.some(task => task && ["queued", "downloading"].includes(task.state));
      const failed = tasks.some(task => task?.state === "failed");
      const fraction = tasks.reduce((sum, task) => sum + (task?.state === "downloading" && task.progress?.total ? task.progress.bytes / task.progress.total : 0), 0);
      const percent = available.length ? Math.min(100, Math.floor(100 * (completed + fraction) / available.length)) : 0;
      const state = active ? completed ? "Actualizando" : "Descargando" : failed ? "Error" : completed && completed === available.length ? device.online ? "Actualizado" : "Disponible offline" : locals.some(item => item.unit.levelId === level) ? !device.online || !available.length ? "Disponible offline" : "Disponible offline · parcial" : "No descargado";
      return `<section class="level-download ui-card" data-level-download="${escape(level)}"><strong>${escape(levelName(level))}</strong><span role="status">${state}${active ? ` ${completed} de ${available.length} Units · ${percent}%` : ""}</span>${active ? `<progress max="100" value="${percent}" aria-label="Descarga de ${escape(levelName(level))}"></progress>` : ""}<button class="button button-outline" data-download-level="${escape(level)}" ${!available.length || active ? "disabled" : ""}>${icon("download")}Descargar nivel completo</button><label><input type="checkbox" data-follow-level="${escape(level)}" ${contentPreferences().followedLevels.includes(level) ? "checked" : ""}/> Mantener este nivel disponible sin conexión</label></section>`;
    }).join("");
    reconcileLibrary(root, `<div class="desktop-shell offline-shell">${sidebar().replace("</nav>", `<div class="sidebar-level-download">${levelControls}</div></nav>`)}<section class="library-workspace">
      <header class="library-header"><div class="library-heading"><span class="library-heading-icon">${icon("library")}</span><div><h1>${localOnly ? "Mis clases" : "Biblioteca"}</h1><p>Gestiona y abre tus clases</p></div></div><button class="button button-primary" data-refresh ${refreshing ? "disabled" : ""}>${icon("refresh", refreshing ? "is-spinning" : "")}${refreshing ? "Consultando…" : "Actualizar biblioteca"}</button></header>
      <section class="library-controls" aria-label="Filtros de Biblioteca"><nav class="library-filters" aria-label="Filtrar por nivel"><button class="button ${!selectedLevel ? "button-primary" : "button-level"}" data-level="" aria-pressed="${!selectedLevel}">${icon("levels")}Todos los niveles</button>${levels.map(level => `<button class="button button-level ${selectedLevel === level ? "is-active" : ""}" data-level="${escape(level)}" aria-pressed="${selectedLevel === level}">${escape(levelName(level))}</button>`).join("")}</nav><label class="library-search">${icon("search")}<input data-search type="search" placeholder="Buscar unidades..." aria-label="Buscar unidades" value="${escape(search)}"/></label><div class="library-view-toggle" aria-label="Vista de unidades"><button data-view="grid" aria-label="Vista de cuadrícula" aria-pressed="${view === "grid"}">${icon("grid")}</button><button data-view="list" aria-label="Vista de lista" aria-pressed="${view === "list"}">${icon("list")}</button></div></section>
      <main class="offline-content">${feedback()}<div class="unit-grid ${view === "list" ? "is-list" : ""}">${cards}</div>${!matches.length ? `<p class="library-empty">${combined.size ? "No hay unidades que coincidan con los filtros." : device.online ? "No hay clases publicadas." : "No hay clases locales. Actualiza la biblioteca cuando puedas conectar con el servidor."}</p>` : ""}</main></section></div>`);
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
    root.querySelectorAll<HTMLButtonElement>("[data-cancel]").forEach(button => { button.onclick = () => {
      const unitId = button.dataset.cancel!; queue?.cancel(unitId);
      saveContentPreferences({ pendingUnits: contentPreferences().pendingUnits.filter(id => id !== unitId) });
    }; });
    root.querySelectorAll<HTMLButtonElement>("[data-download-level]").forEach(button => { button.onclick = () => { publications.filter(item => item.levelId === button.dataset.downloadLevel).forEach(item => { synchronize(item); }); }; });
    root.querySelectorAll<HTMLInputElement>("[data-follow-level]").forEach(input => { input.onchange = () => {
      const levels = new Set(contentPreferences().followedLevels);
      if (input.checked) levels.add(input.dataset.followLevel!); else levels.delete(input.dataset.followLevel!);
      saveContentPreferences({ followedLevels: [...levels] });
    }; });
    root.querySelectorAll<HTMLButtonElement>("[data-sync]").forEach(button => { button.onclick = () => { const remote = publications.find(item => item.unitId === button.dataset.sync); if (remote) void synchronize(remote); }; });
    root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach(button => { button.onclick = () => { void open(button.dataset.open!); }; });
    root.querySelectorAll<HTMLButtonElement>("[data-unit-action]").forEach(button => { button.onclick = () => { button.closest("article")?.querySelector<HTMLButtonElement>(`[data-${button.dataset.unitAction}]`)?.click(); }; });
    const signature = matches.map(([id, entry]) => `${id}:${entry.local?.version || 0}`).join("|");
    if (signature !== thumbnailSignature) { thumbnailSignature = signature; thumbnails.pause(); void thumbnails.mount(root, owner, locals); }
  }
  async function refresh(): Promise<void> {
    if (!api || refreshing) return;
    const current = epoch;
    syncDiagnostic("REFRESH_START");
    refreshing = true; render();
    refreshController = new AbortController();
    try {
      const available = await api.list(refreshController.signal);
      if (current !== epoch) return;
      publications = available;
      reconcileContent(true);
      updatedAt = Date.now();
      for (const [unitId, entry] of mergeLibraryPublications(locals, available)) {
        if (entry.localVersion !== undefined) syncDiagnostic("LOCAL_PUBLICATION", { unitId, version: entry.localVersion });
        if (entry.localVersion !== undefined && entry.remoteVersion !== undefined && entry.remoteVersion > entry.localVersion) syncDiagnostic("UPDATE_AVAILABLE", { unitId, version: entry.remoteVersion, localVersion: entry.localVersion });
      }
      void ambient?.sync().catch(() => { console.warn("[Active Classroom Ambient] sync-failed; verified local catalog preserved"); });
      session.connected();
      diagnose("publications", available.length ? "listed" : "empty");
      message = available.length ? "Publicaciones consultadas. Las clases locales se conservan hasta completar cada actualización." : "No hay clases publicadas. Tus clases locales se conservan.";
      syncDiagnostic("REFRESH_COMPLETE");
    } catch (error) { if (current === epoch) { session.reportFailure(error, "publications"); message = device.message; } }
    finally { if (current === epoch) { refreshing = false; render(); } }
  }
  function reconcileContent(retryFailed = false): void {
    if (!queue || !device.online) return;
    for (const publication of requiredContent(locals, publications, contentPreferences())) {
      const task = queue.tasks.get(publication.unitId);
      if (!task || task.publication.version < publication.version || (retryFailed && task.state === "failed")) synchronize(publication);
    }
  }
  function synchronize(publication: Publication): void {
    if (!queue || !cache || !api) return;
    if (locals.some(local => local.unit.unitId === publication.unitId && local.version >= publication.version) && !errors.has(publication.unitId)) return;
    const pending = new Set(contentPreferences().pendingUnits); pending.add(publication.unitId);
    const repair = errors.has(publication.unitId);
    errors.delete(publication.unitId);
    queue.enqueue(publication, repair);
    saveContentPreferences({ pendingUnits: [...pending] });
  }
  function downloadChanged(task: DownloadTask, current: number): void {
    if (current !== epoch) return;
    if (task.state === "failed") errors.set(task.publication.unitId, unitSyncMessage(task.error));
    if (task.state === "ready") {
      errors.delete(task.publication.unitId);
      saveContentPreferences({ pendingUnits: contentPreferences().pendingUnits.filter(id => id !== task.publication.unitId) });
      if (task.manifest) {
        const saved = new Map(locals.map(local => [local.unit.unitId, local]));
        saved.set(task.publication.unitId, task.manifest); locals = [...saved.values()];
        reconcileContent();
      }
      void api?.call("reportActiveClassroomDeviceSync", { unitId: task.publication.unitId, version: task.publication.version }).catch(() => {});
    }
    if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = undefined; if (current === epoch) render(); }, 100);
  }
  async function open(unitId: string): Promise<void> {
    const local = locals.find((item) => item.unit.unitId === unitId);
    if (!cache || !local || opening || player) return;
    const current = epoch;
    const currentCache = cache;
    if (queue) queue.protectedUnit = unitId;
    opening = true; message = "Verificando archivos locales…"; render();
    try {
      if (current !== epoch) return;
      const classroom = await openLocalClass(currentCache, unitId, local.version);
      await ambient?.restore();
      const music = ambient?.catalog;
      if (current === epoch) {
        thumbnails.pause(); thumbnailSignature = "";
        root.innerHTML = `<div class="desktop-shell is-classroom">${sidebar(true)}<div class="classroom-workspace" data-classroom-host></div></div>`;
        bindSidebar(true);
        player = new ClassroomPlayer(root.querySelector<HTMLElement>("[data-classroom-host]")!, classroom, () => {
          player = undefined; if (queue) queue.protectedUnit = ""; message = "Clase cerrada. Verificando biblioteca local…"; render();
          void (async () => { await queue?.activatePending(); return currentCache.list(); })().then((saved) => {
            if (current !== epoch) return;
            locals = saved;
            if (!saved.some((item) => item.unit.unitId === unitId && item.version >= local.version)) errors.set(unitId, "La copia local requiere reparación. Sincroniza de nuevo cuando tengas conexión.");
            message = "Biblioteca local verificada."; render();
          }).catch((error) => { if (current === epoch) { message = String(error); render(); } });
        }, {
          ...(music ? { ambientMusic: { tracks: music.tracks.filter(track => track.active).map(track => ({ ...track, resourceId: track.id })), prepare: async (id: string) => { const track = music.tracks.find(track => track.id === id); if (!track) throw new Error("Audio global no disponible"); return prepareAmbientMedia(currentCache.owner, music.ambientCatalogVersion, track); } } } : {}),
          prepareMediaSource: (id) => prepareNativeMedia(currentCache.owner, classroom, id),
          releaseMediaSource: releaseNativeMedia,
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
    finally { if (current === epoch) { opening = false; if (!player && queue) { queue.protectedUnit = ""; void queue.activatePending().catch(() => {}); } render(); } }
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
      refreshController?.abort(); queue?.close(); ambient?.close(); ambient = undefined;
      locals = []; publications = []; errors.clear(); unitOrder.clear(); player?.destroy(); player = undefined; thumbnailSignature = ""; refreshing = false; opening = false; message = ""; retryPublication = undefined;
      cache = undefined; cacheReady = false; api = undefined; queue = undefined;
      if (state.phase !== "ready") { owner = ""; contentOwner(""); render(); return; }
      owner = session.owner; contentOwner(owner);
      cache = new NativeCache(owner);
      api = new PublicationApi((force) => session.token(force));
      api.onDenied = () => session.revalidateAccess();
      api.onDevice = (label) => session.receiveLabel(label);
      const transfers = new BlobTransfers();
      queue = new DownloadQueue(cache, api, task => downloadChanged(task, current), 2, transfers);
      ambient = new AmbientLibrary(cache, api, transfers);
      try {
        await cache.adoptLegacy().catch(() => { if (current === epoch) message = "No se pudo recuperar alguna clase anterior. Las clases locales existentes se conservan."; });
        await queue.activatePending();
        const saved = await cache.list(); if (current === epoch) locals = saved;
      }
      catch (error) { if (current === epoch) message = error instanceof Error ? error.message : String(error); }
      if (current !== epoch) return;
      cacheReady = true;
      render();
      void ambient?.restore();
      if (device.online) void refresh();
    })();
  });
  async function reconnect(): Promise<void> {
    if (opening || refreshing) return;
    if (!device.identity) { await session.start(navigator.onLine); }
    else await session.connect();
    if (device.phase !== "ready" || !device.online) return;
    await refresh();
    if (retryPublication) {
      const publication = publications.find((item) => item.unitId === retryPublication!.unitId);
      if (publication) void synchronize(publication);
    }
  }
  window.addEventListener("classroom-content-preferences", () => { reconcileContent(); render(); });
  window.addEventListener("beforeunload", () => { queue?.close(); ambient?.close(); });
  window.setInterval(() => { if (device.phase === "ready" && device.online) void refresh(); }, 5 * 60 * 1000);
  void session.start(navigator.onLine);
  window.addEventListener("online", () => { void reconnect(); });
  window.addEventListener("offline", () => { session.offline(); message = "Modo offline. Puedes abrir tus clases descargadas."; render(); });
  // Retry actual connectivity failures even when the OS reports an active network.
  window.setInterval(() => { if (navigator.onLine && device.phase !== "error" && device.phase !== "revoked" && (device.phase === "activation" || !device.online || retryPublication)) void reconnect(); }, 30000);
}
