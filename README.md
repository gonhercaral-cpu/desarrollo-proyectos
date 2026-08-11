# React + Vite

## Entorno Firebase completamente local

El frontend usa Auth, Firestore, Storage y Functions locales solamente cuando se
inicia con `npm run dev:emulators`. El comando `npm run dev` conserva Firebase de
producción.

1. Inicia Firebase y deja esa terminal abierta:

   ```bash
   npm run emulators
   ```

2. En otra terminal, crea o actualiza el administrador local:

   ```bash
   npm run emulators:seed
   ```

3. Inicia Vite conectado a los emuladores:

   ```bash
   npm run dev:emulators
   ```

Credenciales exclusivas del entorno local:

- Correo: `admin.local@active.edu.mx`
- Contraseña: `LocalAdmin123!`

La interfaz de emuladores queda en `http://127.0.0.1:4000`. Los datos se guardan
en `.firebase/emulator-data` al detener Firebase con `Ctrl+C` y se restauran en
el siguiente arranque.

Las reglas usan instancias aisladas en los puertos 8180 y 9299, por lo que pueden
probarse incluso mientras el entorno principal está levantado:

```bash
npm run test:rules
```

## Active Classroom escritorio

La aplicación Tauri original está preservada en `active-classroom-desktop/`, sin
copiar `node_modules`, `dist` ni `src-tauri/target`. Incluye panel docente, vista
de alumnado, importador PPTX, administración web, catálogo local, fixtures,
iconos y pruebas.

Instalación inicial:

```bash
npm run active-classroom:install
```

Trabajo simultáneo, usando terminales separadas:

```bash
npm run dev:emulators
npm run active-classroom:admin
npm run active-classroom:desktop
```

La versión web integrada sigue en `src/active-classroom/`. El código Tauri vive
aislado para migrar sus componentes por etapas sin duplicar sidebar, sesión ni
acceso Firebase. Consulta `docs/active-classroom-desktop-migration.md`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
