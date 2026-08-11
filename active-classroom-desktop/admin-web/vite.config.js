import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { localLibraryPlugin } from "./local-library-plugin.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  root,
  publicDir: "public",
  server: { host: "127.0.0.1", port: 1430, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [localLibraryPlugin(projectRoot)],
});
