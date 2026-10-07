import { escapeHtml as escape } from "../utils/dom.ts";
import { localState, type Manifest, type Publication } from "../offline/manifest.ts";
import { icon, resourceIcon } from "./icons.ts";
import { levelName } from "./shell.ts";
export interface UnitVisual {
  unitId: string; local?: Manifest; remote?: Publication; busy: boolean; error?: string;
  percent: number; progressLabel: string; disableSync: boolean; opening: boolean; activating: boolean;
}
export function unitCard(model: UnitVisual): string {
  const { unitId, local, remote } = model;
  const state = model.busy ? "Descargando" : model.error ? "Error" : localState(local, remote);
  const stateIcon = model.busy ? "refresh" : state === "Error" ? "error" : state === "Actualizada" ? "check" : state === "No descargada" ? "download" : "refresh";
  const tone = state === "Actualizada" ? "positive" : state === "Error" ? "error" : state === "Actualización disponible" ? "update" : "pending";
  const title = remote?.name || local!.unit.name;
  const resource = local?.resources?.find(item => item.resourceId === local.mainPresentationId);
  const sync = model.error ? "Reintentar" : local ? "Actualizar" : "Descargar";
  return `<article class="ui-card unit-sync-card" data-unit-card="${escape(unitId)}">
    <div class="unit-thumbnail" data-thumbnail="${escape(unitId)}"><div class="unit-cover-fallback">${icon(resourceIcon(resource?.download.mimeType || ""))}<span>${local ? "Vista previa local" : "Vista previa al descargar"}</span></div>
      <details class="unit-menu"><summary aria-label="Acciones de ${escape(title)}">${icon("more")}</summary><div><button data-unit-action="sync" ${model.disableSync ? "disabled" : ""}>${icon("refresh")}${sync}</button><button data-unit-action="open" ${!local || model.opening ? "disabled" : ""}>${icon("play")}Abrir clase</button></div></details></div>
    <div class="unit-card-body"><p class="unit-level">${escape(levelName(remote?.levelId || local!.unit.levelId))}</p><h2>${escape(title)}</h2><p class="unit-versions">Publicada: ${remote ? `v${remote.version}` : "Sin consultar"}<span> · </span>Local: ${local ? `v${local.version}` : "—"}</p>
    <strong class="sync-label is-${tone}">${icon(stateIcon, model.busy ? "is-spinning" : "")}${state}</strong>
    ${model.busy ? `<progress max="100" value="${model.percent}" aria-label="Progreso de descarga"></progress><small>${model.percent}% · ${escape(model.progressLabel)}</small>` : ""}
    ${model.error ? `<p role="alert" class="sync-error">${escape(model.error)}</p>` : ""}
    <div class="unit-actions"><button class="button button-outline" data-sync="${escape(unitId)}" ${model.disableSync ? "disabled" : ""}>${icon(local ? "refresh" : "download")}${sync}</button><button class="button button-primary" data-open="${escape(unitId)}" ${!local || model.opening ? "disabled" : ""}>${icon("play")}Abrir clase</button>${model.busy ? `<button class="button button-quiet" data-cancel ${model.activating ? "disabled" : ""}>Cancelar</button>` : ""}</div></div></article>`;
}
