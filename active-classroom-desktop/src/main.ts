import "./styles/index.css";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontró el contenedor de la aplicación.");
if (isTauri() && getCurrentWindow().label === "audience") {
  void import("./player/projection/mountProjection").then(({ mountProjection }) => mountProjection(app));
} else {
  void import("./app").then(({ mountDesktopApp }) => mountDesktopApp(app));
}
