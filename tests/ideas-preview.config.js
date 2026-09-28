import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Isolated UI fixture: no production auth, Firestore, or Storage writes.
export default defineConfig({
  plugins: [
    {
      name: "ideas-test-dependencies",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer?.replaceAll("\\", "/").endsWith("/src/pages/IdeasIncubator.jsx")) return;
        if (["../context/AuthContext", "../components/UserAvatar", "../services/ideasService"].includes(source)) {
          return fileURLToPath(new URL("./fixtures/ideas-backend.js", import.meta.url));
        }
      },
    },
    react(),
  ],
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
});
