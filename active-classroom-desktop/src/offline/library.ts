import type { User } from "firebase/auth";
import { escapeHtml as escape } from "../utils/dom";
import { login, logout, observeSession, sessionToken } from "./auth";
import { NativeCache } from "./native-cache";
import { PublicationApi } from "./remote";
import { localState, type Manifest, type Publication } from "./manifest";
import { openLocalClass, SyncEngine, type Progress } from "./sync";
import "./library.css";
import { ClassroomPlayer } from "../player/ClassroomPlayer";
import "../player/player.css";

export function mountOfflineLibrary(root: HTMLDivElement): void {
  let user: User | null = null;
  let cache: NativeCache | undefined;
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
  const feedback = () => message ? `<p class="offline-feedback" role="status">${escape(message)}</p>` : "";
  function render(): void {
    if (player) return;
    if (!user) {
      root.innerHTML = `<main class="offline-login"><section class="ui-card ui-stack"><img src="/active-classroom-icon.png" alt="" width="64"/><h1>Active Classroom</h1><p>Inicia sesión para preparar tus clases. Las clases descargadas quedan disponibles sin Internet.</p><form id="classroom-login" class="ui-stack"><label>Correo electrónico<input name="email" type="email" autocomplete="username" required /></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required /></label><button class="button button-primary" type="submit">Iniciar sesión</button></form>${feedback()}</section></main>`;
      root.querySelector<HTMLFormElement>("form")!.onsubmit = async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const fields = new FormData(form);
        const button = form.querySelector("button")!; button.disabled = true;
        try { await login(String(fields.get("email")), String(fields.get("password"))); }
        catch (error) { message = loginError(error); render(); }
      };
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
    root.innerHTML = `<div class="teacher-shell offline-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark"><img src="/active-classroom-icon.png" alt=""/></span><div><strong>Active Classroom</strong><span>Biblioteca de clases</span></div></div><nav class="ui-stack offline-levels" aria-label="Niveles"><button class="button button-quiet" data-level="" aria-pressed="${!selectedLevel}">Todos los niveles</button>${levels.map((level) => `<button class="button button-quiet" data-level="${level}" aria-pressed="${selectedLevel === level}">${escape(levelName(level))}</button>`).join("")}</nav><div class="sidebar-footer"><div><strong>${escape(user.email || "Sesión guardada")}</strong><small>${navigator.onLine ? "Clases disponibles sin conexión" : "Sin conexión · biblioteca local"}</small><button class="button button-quiet" data-logout>Cerrar sesión</button></div></div></aside><section class="workspace"><header class="workspace-header"><div><p class="breadcrumb">Nivel / Unit</p><h1>Biblioteca</h1></div><button class="button button-outline" data-refresh ${refreshing ? "disabled" : ""}>${refreshing ? "Consultando…" : "Actualizar biblioteca"}</button></header><main class="offline-content">${feedback()}<div class="ui-grid">${unitCards}</div>${combined.size === 0 ? "<p>No hay clases locales. Conecta Internet y actualiza la biblioteca para consultar publicaciones.</p>" : ""}</main></section></div>`;
    root.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) => { button.onclick = () => { selectedLevel = button.dataset.level!; render(); }; });
    root.querySelector<HTMLButtonElement>("[data-refresh]")!.onclick = () => { void refresh(); };
    root.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => engine?.cancel());
    root.querySelector<HTMLButtonElement>("[data-logout]")!.onclick = async () => {
      refreshController?.abort(); engine?.cancel();
      await engine?.active?.promise.catch(() => {});
      await logout().catch((error) => { message = String(error); render(); });
    };
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
      publications = available; message = "Publicaciones consultadas. Las clases locales se conservan hasta completar cada actualización.";
    } catch (error) { if (current === epoch) message = error instanceof Error ? error.message : String(error); }
    finally { if (current === epoch) { refreshing = false; render(); } }
  }
  async function synchronize(publication: Publication): Promise<void> {
    if (!engine || !cache || downloading || player || opening) return;
    const current = epoch;
    const currentCache = cache;
    downloading = publication.unitId; errors.delete(publication.unitId); progress = undefined; render();
    try {
      await engine.sync(publication, (value) => {
        if (current !== epoch) return;
        progress = value;
        if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = undefined; if (current === epoch) render(); }, 100);
      });
      const updated = await currentCache.list();
      if (current === epoch) { locals = updated; message = "Versión verificada. Puedes abrir la clase sin conexión."; }
    } catch (error) { if (current === epoch) errors.set(publication.unitId, error instanceof Error ? error.message : String(error)); }
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
  observeSession((session) => {
    void (async () => {
      epoch++; const current = epoch;
      refreshController?.abort(); engine?.cancel();
      user = session; locals = []; publications = []; errors.clear(); player?.destroy(); player = undefined; downloading = ""; progress = undefined; refreshing = false; opening = false; message = "";
      cache = undefined; api = undefined; engine = undefined;
      if (!session) { render(); return; }
      cache = new NativeCache(session.uid);
      api = new PublicationApi((force) => sessionToken(session.uid, force));
      engine = new SyncEngine(cache, api);
      try { const saved = await cache.list(); if (current === epoch) locals = saved; }
      catch (error) { if (current === epoch) message = error instanceof Error ? error.message : String(error); }
      if (current !== epoch) return;
      render();
      if (navigator.onLine) void refresh();
    })();
  });
  window.addEventListener("online", () => { void refresh(); });
  window.addEventListener("offline", () => { message = "Sin conexión. Puedes abrir tus clases descargadas."; render(); });
}

function loginError(error: unknown): string {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "Correo o contraseña incorrectos.";
  if (code === "auth/too-many-requests") return "Demasiados intentos. Espera y vuelve a intentar.";
  return "No se pudo iniciar sesión. Comprueba tu conexión y tus credenciales.";
}
