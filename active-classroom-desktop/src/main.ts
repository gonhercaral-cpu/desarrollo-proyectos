import "./styles/index.css";
import { mountDesktopApp } from "./app";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("No se encontró el contenedor de la aplicación.");
void mountDesktopApp(app);
