import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const sourceFiles = [
  "main.ts", "app.ts", "models.ts", "state/store.ts", "utils/dom.ts",
  "components/login.ts", "components/sidebar.ts", "components/library.ts", "components/inspector.ts", "components/settings-modal.ts",
  "services/files.ts", "services/storage.ts", "services/local-catalog.ts",
];
const styleFiles = ["styles/index.css", "styles/tokens.css", "styles/login.css", "styles/components.css", "styles/responsive.css"];
const source = (await Promise.all(sourceFiles.map((path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")))).join("\n");
const styles = (await Promise.all(styleFiles.map((path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")))).join("\n");

for (const label of ["Biblioteca", "Publicaciones", "Equipos", "Ajustes", "Panel de anuncios", "Observaciones", "Sugerencias", "Subir archivos", "Nueva carpeta", "Inspector", "Vista previa", "Descargar", "Compartir", "Nombre", "Tipo", "Tamaño", "Modificado", "Presentaciones", "Videos", "Audios", "Modo demostración local", "La autenticación no está activa", "Google", "Microsoft"]) {
  assert.ok(source.includes(label), `Falta UI requerida: ${label}`);
}

for (const behavior of ["createLibraryController", "createInspectorController", "createSettingsController", "persistFile", "hydrateLibrary", "mirrorFile", "mirrorFolder", "renameCatalogFolder", "toggle-filters", "grid-view", "list-view", "close-inspector", "fit-preview", "showModal", "dialog.close", "trigger?.focus"] ) {
  assert.ok(source.includes(behavior), `Falta comportamiento: ${behavior}`);
}

assert.ok(source.includes('event.stopPropagation()'), "X de Ajustes debe aislar evento");
assert.ok(source.includes('dialog.addEventListener("click"'), "Falta cierre por backdrop");
assert.ok(source.includes('dialog.addEventListener("cancel"'), "Falta manejo Escape nativo");
assert.ok(source.includes("indexedDB.open"), "Falta IndexedDB");
assert.ok(source.includes("URL.createObjectURL(blob)"), "Falta restaurar URL binaria");
assert.ok(!source.includes("localStorage"), "No usar localStorage para archivos o credenciales");
assert.ok(source.includes('const apiRoot = "/__active_classroom"'), "Falta adaptador de catálogo local");
assert.ok(!source.includes("https://"), "Admin no debe llamar servicios externos");
assert.ok(!source.includes("autoplay"), "Medios no deben autoplay");
assert.ok(source.includes("<audio src="), "Falta preview audio");
assert.ok(source.includes("<video src="), "Falta preview video");
assert.ok(source.includes("<object data="), "Falta preview PDF");
assert.ok(styles.includes("grid-template-rows: 2.3rem minmax(10rem, 1fr) 11.5rem var(--touch)"), "Inspector debe fijar preview/meta/acciones");
assert.ok(styles.includes("object-fit: contain"), "Preview debe contener imagen/video");
assert.ok(styles.includes(".settings-dialog { position: fixed; inset: 0;"), "Ajustes debe estar centrado");
assert.ok(styles.includes("@media (max-width: 1180px)"), "Falta breakpoint mediano");
assert.ok(styles.includes("@media (max-width: 650px)"), "Falta breakpoint móvil");
assert.ok(styles.includes("data:image/svg+xml"), "Falta cursor triangular");
assert.ok((await readFile(new URL("../src/main.ts", import.meta.url), "utf8")).split("\n").length <= 10, "main.ts debe quedar como entrada mínima");

await access(new URL("../public/logo-a-original.png", import.meta.url));
await access(new URL("../public/demo-landscape.svg", import.meta.url));
const catalog = JSON.parse(await readFile(new URL("../../local-library/catalog.json", import.meta.url), "utf8"));
const roots = catalog.folders.filter((folder) => folder.parentId === null);
assert.deepEqual(roots.map((folder) => folder.name), ["Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4", "Nivel 5"]);
for (const root of roots) assert.equal(catalog.folders.filter((folder) => folder.parentId === root.id).length, 16, `${root.name} requiere 16 Units`);
console.log("admin-web smoke: OK");
