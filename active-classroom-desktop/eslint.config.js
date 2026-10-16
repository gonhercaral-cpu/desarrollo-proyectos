import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "src-tauri/**", "admin-web/**"] },
  { files: ["tests/release.test.mjs"], extends: [js.configs.recommended] },
  { files: ["src/offline/**/*.ts", "src/player/**/*.ts", "src/updater/**/*.ts", "src/startup/**/*.ts", "src/ui/**/*.ts", "src/app.ts"], extends: [js.configs.recommended, ...tseslint.configs.recommended], rules: { "no-undef": "off", "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
);
