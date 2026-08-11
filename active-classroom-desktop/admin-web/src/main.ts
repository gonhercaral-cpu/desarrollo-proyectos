import "./styles/index.css";
import { mountApp } from "./app";

const root = document.querySelector<HTMLDivElement>("#admin-app");
if (!root) throw new Error("No se encontró contenedor de administración.");
mountApp(root);
