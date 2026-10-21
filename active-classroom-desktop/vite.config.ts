import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [viteStaticCopy({ targets: ["cmaps", "standard_fonts", "wasm", "iccs"].map((folder) => ({
    src: `node_modules/pdfjs-dist/${folder}`,
    dest: "pdfjs",
    // v4 preserves source directories; runtime URLs start directly at /pdfjs/.
    rename: { stripBase: 2 },
  })) })],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
  },
});

