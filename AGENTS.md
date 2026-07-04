# Repository Guidelines

## Project Structure & Module Organization

This is a Vite + React application backed by Firebase. Main code lives in `src/`: pages in `src/pages`, shared components in `src/components`, auth context in `src/context`, Firebase modules in `src/services`, utilities in `src/utils`, and global styles in `src/styles/app.css` plus `src/index.css`. Static assets belong in `public/` when served directly and `src/assets/` when imported. Firebase security files are at the root: `firestore.rules`, `storage.rules`, and `firestore.indexes.json`. Cloud Functions are a separate package in `functions/`. Rules tests live in `tests/`.

## Build, Test, and Development Commands

- `npm install`: install app dependencies.
- `npm run dev`: start Vite with HMR.
- `npm run build`: create the production `dist/` build.
- `npm run preview`: serve the built app locally.
- `npm run lint`: run ESLint for JS and JSX.
- `npm run test:rules`: run Firestore and Storage rules tests through Firebase emulators.
- `cd functions && npm install`: install Cloud Functions dependencies.
- `cd functions && npm run serve`: start the Functions emulator.

## Coding Style & Naming Conventions

Use modern ES modules and React function components. Follow the existing JSX style: 2-space indentation, double quotes, semicolons, and named helpers for non-trivial logic. Use PascalCase for components and pages such as `Dashboard.jsx`; use camelCase for utilities, services, state variables, and handlers. Keep Firebase access concentrated in `src/services` when possible. User-facing product text is mostly Spanish, so new UI copy should match that tone.

## Testing Guidelines

Automated coverage currently focuses on Firebase security rules with Node's built-in test runner and `@firebase/rules-unit-testing`. Add or update `tests/firebase-rules.test.mjs` when changing rules, auth roles, or collection access. Prefer descriptive Spanish test names that state the allowed or blocked behavior. Run `npm run test:rules` before rule/config changes and `npm run lint` before submitting code.

## Commit & Pull Request Guidelines

Recent history uses short Spanish summaries, for example `Correcciones Imprenta` and `Arreglo etiquetas`. Keep commits concise and scoped to one logical change. Pull requests should include a clear description, testing performed, linked issue or task when available, and screenshots or short recordings for visible UI changes. Note Firebase rule, index, storage, or Functions changes explicitly because they may require emulator checks or deployment coordination.

## Security & Configuration Tips

Do not commit Firebase credentials, service account files, local emulator data, or generated `dist/` artifacts. Treat `firestore.rules` and `storage.rules` as production-sensitive code and keep tests aligned with the role model.
