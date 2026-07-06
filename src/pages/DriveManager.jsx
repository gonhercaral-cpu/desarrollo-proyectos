import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createDriveFolder,
  DRIVE_FOLDER_MIME_TYPE,
  getDriveRootSettings,
  listDriveFolder,
  saveDriveRootFolderId,
} from "../services/driveService";

function DriveIcon({ type = "file" }) {
  if (type === "folder") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4.2l2 2.4h6.8A2.5 2.5 0 0 1 21 8.9v8.6A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h8.5L19 8v12.5H6V3.5z" />
      <path d="M14 3.5V8h5" />
      <path d="M9 13h6" />
      <path d="M9 16h4" />
    </svg>
  );
}

function ActionIcon({ name }) {
  if (name === "load") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 12a8 8 0 0 1 13.6-5.7" />
        <path d="M18 3v5h-5" />
        <path d="M20 12a8 8 0 0 1-13.6 5.7" />
        <path d="M6 21v-5h5" />
      </svg>
    );
  }

  if (name === "add") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.8 1.8 0 0 0 .3 2l.1.1-2 2-.1-.1a1.8 1.8 0 0 0-2-.3 1.8 1.8 0 0 0-1 1.6V20h-3v-.1a1.8 1.8 0 0 0-1-1.6 1.8 1.8 0 0 0-2 .3l-.1.1-2-2 .1-.1a1.8 1.8 0 0 0 .3-2 1.8 1.8 0 0 0-1.6-1H5v-3h.1a1.8 1.8 0 0 0 1.6-1 1.8 1.8 0 0 0-.3-2l-.1-.1 2-2 .1.1a1.8 1.8 0 0 0 2 .3 1.8 1.8 0 0 0 1-1.6V4h3v.1a1.8 1.8 0 0 0 1 1.6 1.8 1.8 0 0 0 2-.3l.1-.1 2 2-.1.1a1.8 1.8 0 0 0-.3 2 1.8 1.8 0 0 0 1.6 1h.1v3h-.1a1.8 1.8 0 0 0-1.6 1z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

export default function DriveManager() {
  const [rootFolderId, setRootFolderId] = useState("");
  const [rootFolderDraft, setRootFolderDraft] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState("");
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [files, setFiles] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingRoot, setSavingRoot] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [error, setError] = useState("");

  const currentFolderName = breadcrumbs.at(-1)?.name || "Sin carpeta cargada";
  const folderCount = useMemo(() => files.filter(isDriveFolder).length, [files]);
  const fileCount = files.length - folderCount;
  const hasRootFolder = Boolean(rootFolderId);
  const isBusy = settingsLoading || loading;

  const loadFolder = useCallback(async (folderId, nextBreadcrumbs) => {
    const cleanFolderId = String(folderId || "").trim();

    if (!cleanFolderId) {
      setError("Configura una carpeta raiz para usar Nube AES.");
      return false;
    }

    setLoading(true);
    setError("");

    try {
      const result = await listDriveFolder(cleanFolderId);
      setCurrentFolderId(cleanFolderId);
      setBreadcrumbs(nextBreadcrumbs);
      setFiles(Array.isArray(result?.files) ? result.files : []);
      return true;
    } catch (loadError) {
      setError(getDriveErrorMessage(loadError, "drive"));
      setFiles([]);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadRootFolderSetting() {
      setSettingsLoading(true);
      setError("");

      try {
        const settings = await getDriveRootSettings();
        const savedRootFolderId = String(settings?.rootFolderId || "").trim();

        if (!isActive) return;

        if (!savedRootFolderId) {
          setRootFolderId("");
          setRootFolderDraft("");
          setCurrentFolderId("");
          setBreadcrumbs([]);
          setFiles([]);
          setConfigOpen(true);
          return;
        }

        setRootFolderId(savedRootFolderId);
        setRootFolderDraft(savedRootFolderId);
        setConfigOpen(false);
        await loadFolder(savedRootFolderId, [{ id: savedRootFolderId, name: "Raiz" }]);
      } catch (settingsError) {
        if (!isActive) return;
        setError(getDriveErrorMessage(settingsError, "settings"));
        setConfigOpen(true);
      } finally {
        if (isActive) {
          setSettingsLoading(false);
        }
      }
    }

    loadRootFolderSetting();

    return () => {
      isActive = false;
    };
  }, [loadFolder]);

  function handleReloadRoot() {
    if (!rootFolderId) {
      setConfigOpen(true);
      setError("Configura una carpeta raiz para usar Nube AES.");
      return;
    }

    loadFolder(rootFolderId, [{ id: rootFolderId, name: "Raiz" }]);
  }

  async function handleSaveRoot(event) {
    event.preventDefault();

    const cleanRootFolderId = rootFolderDraft.trim();

    if (!cleanRootFolderId) {
      setError("Pega el folderId raiz antes de guardar.");
      return;
    }

    setSavingRoot(true);
    setError("");

    try {
      const savedRootFolderId = await saveDriveRootFolderId(cleanRootFolderId);
      setRootFolderId(savedRootFolderId);
      setRootFolderDraft(savedRootFolderId);
      setConfigOpen(false);
      await loadFolder(savedRootFolderId, [{ id: savedRootFolderId, name: "Raiz" }]);
    } catch (saveError) {
      setError(getDriveErrorMessage(saveError, "settings"));
    } finally {
      setSavingRoot(false);
    }
  }

  function handleOpenItem(file) {
    if (isDriveFolder(file)) {
      loadFolder(file.id, [...breadcrumbs, { id: file.id, name: file.name || "Carpeta" }]);
      return;
    }

    if (file.webViewLink) {
      window.open(file.webViewLink, "_blank", "noopener,noreferrer");
    }
  }

  function handleBreadcrumbClick(index) {
    const breadcrumb = breadcrumbs[index];

    if (!breadcrumb || breadcrumb.id === currentFolderId) {
      return;
    }

    loadFolder(breadcrumb.id, breadcrumbs.slice(0, index + 1));
  }

  async function handleCreateFolder(event) {
    event.preventDefault();

    if (!currentFolderId) {
      setError("Carga una carpeta raiz antes de crear carpetas.");
      return;
    }

    const cleanName = newFolderName.trim();

    if (!cleanName) {
      setError("Escribe el nombre de la carpeta nueva.");
      return;
    }

    setCreatingFolder(true);
    setError("");

    try {
      const createdFolder = await createDriveFolder(currentFolderId, cleanName);
      setNewFolderName("");
      await loadFolder(currentFolderId, breadcrumbs);
      setBreadcrumbs((current) =>
        current.length ? current : [{ id: currentFolderId, name: createdFolder.name || "Raiz" }]
      );
    } catch (createError) {
      setError(getDriveErrorMessage(createError, "drive"));
    } finally {
      setCreatingFolder(false);
    }
  }

  return (
    <div className="visual-page drive-manager-page">
      <div className="visual-page-header drive-manager-header">
        <div>
          <h2>Nube AES</h2>
          <p>Explora carpetas y archivos conectados a Google Drive.</p>
        </div>

        <div className="drive-manager-summary">
          <span>{hasRootFolder ? "Raiz configurada" : "Sin raiz"}</span>
          <strong>{folderCount} carpetas / {fileCount} archivos</strong>
        </div>
      </div>

      {!hasRootFolder && !settingsLoading ? (
        <section className="drive-settings-panel setup">
          <div className="drive-settings-copy">
            <span>Configuracion inicial</span>
            <strong>Conecta la carpeta raiz de Nube AES</strong>
            <p>Este valor se guarda en Firestore como systemSettings/drive.rootFolderId.</p>
          </div>

          <DriveRootForm
            rootFolderDraft={rootFolderDraft}
            savingRoot={savingRoot}
            onRootFolderDraftChange={setRootFolderDraft}
            onSaveRoot={handleSaveRoot}
          />
        </section>
      ) : null}

      {hasRootFolder ? (
        <section className="drive-control-panel">
          <form className="drive-create-form" onSubmit={handleCreateFolder}>
            <label htmlFor="drive-new-folder">Crear carpeta</label>
            <div>
              <input
                id="drive-new-folder"
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder="Nombre de carpeta"
                autoComplete="off"
                disabled={!currentFolderId || creatingFolder || isBusy}
              />
              <button
                className="visual-outline-button drive-icon-button"
                type="submit"
                disabled={!currentFolderId || creatingFolder || isBusy}
              >
                <ActionIcon name="add" />
                <span>{creatingFolder ? "Creando" : "Crear"}</span>
              </button>
            </div>
          </form>

          <div className="drive-current-root-card">
            <div>
              <span>Carpeta raiz</span>
              <strong>Activa</strong>
            </div>

            <div className="drive-root-actions">
              <button
                className="visual-outline-button drive-icon-button"
                type="button"
                onClick={handleReloadRoot}
                disabled={isBusy}
              >
                <ActionIcon name="load" />
                <span>{isBusy ? "Cargando" : "Recargar raiz"}</span>
              </button>

              <button
                className="visual-outline-button drive-icon-button"
                type="button"
                onClick={() => setConfigOpen((current) => !current)}
              >
                <ActionIcon name="settings" />
                <span>{configOpen ? "Ocultar configuracion" : "Cambiar carpeta raiz"}</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {hasRootFolder && configOpen ? (
        <section className="drive-settings-panel">
          <div className="drive-settings-copy">
            <span>Configuracion</span>
            <strong>Cambiar carpeta raiz</strong>
            <p>Al guardar, Nube AES cargara la nueva raiz automaticamente.</p>
          </div>

          <DriveRootForm
            rootFolderDraft={rootFolderDraft}
            savingRoot={savingRoot}
            onRootFolderDraftChange={setRootFolderDraft}
            onSaveRoot={handleSaveRoot}
          />
        </section>
      ) : null}

      <section className="drive-browser-panel">
        <div className="drive-browser-toolbar">
          <div>
            <span>Carpeta actual</span>
            <strong>{settingsLoading ? "Cargando configuracion..." : currentFolderName}</strong>
          </div>

          <nav className="drive-breadcrumbs" aria-label="Ruta de Google Drive">
            {breadcrumbs.length === 0 ? (
              <span>Sin ruta</span>
            ) : (
              breadcrumbs.map((breadcrumb, index) => (
                <button
                  key={`${breadcrumb.id}-${index}`}
                  type="button"
                  onClick={() => handleBreadcrumbClick(index)}
                  disabled={breadcrumb.id === currentFolderId || isBusy}
                >
                  {breadcrumb.name}
                </button>
              ))
            )}
          </nav>
        </div>

        {error ? <div className="drive-error-box">{error}</div> : null}

        {isBusy ? (
          <div className="drive-loading-state">
            {settingsLoading ? "Cargando configuracion de Nube AES..." : "Cargando contenido de Drive..."}
          </div>
        ) : null}

        {!isBusy && !error && currentFolderId && files.length === 0 ? (
          <div className="empty-state drive-empty-state">
            <div>
              <DriveIcon />
            </div>
            <p>Esta carpeta esta vacia.</p>
          </div>
        ) : null}

        {!isBusy && !currentFolderId ? (
          <div className="empty-state drive-empty-state">
            <div>
              <DriveIcon type="folder" />
            </div>
            <p>{hasRootFolder ? "No se pudo cargar la carpeta raiz." : "Configura la carpeta raiz para iniciar."}</p>
          </div>
        ) : null}

        {!isBusy && files.length > 0 ? (
          <div className="drive-file-grid">
            {files.map((file) => (
              <button
                key={file.id}
                className="drive-file-card"
                type="button"
                onClick={() => handleOpenItem(file)}
              >
                <span className={isDriveFolder(file) ? "drive-file-icon folder" : "drive-file-icon"}>
                  <DriveIcon type={isDriveFolder(file) ? "folder" : "file"} />
                </span>

                <span className="drive-file-content">
                  <strong>{file.name || "Archivo sin nombre"}</strong>
                  <small>{getFileMeta(file)}</small>
                </span>

                {!isDriveFolder(file) && file.webViewLink ? (
                  <span className="drive-open-indicator">
                    <ActionIcon name="open" />
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DriveRootForm({
  rootFolderDraft,
  savingRoot,
  onRootFolderDraftChange,
  onSaveRoot,
}) {
  return (
    <form className="drive-root-form" onSubmit={onSaveRoot}>
      <label htmlFor="drive-root-folder">FolderId raiz</label>
      <div>
        <input
          id="drive-root-folder"
          type="text"
          value={rootFolderDraft}
          onChange={(event) => onRootFolderDraftChange(event.target.value)}
          placeholder="ID de carpeta en Google Drive"
          autoComplete="off"
          disabled={savingRoot}
        />
        <button className="visual-primary-button drive-icon-button" type="submit" disabled={savingRoot}>
          <ActionIcon name="load" />
          <span>{savingRoot ? "Guardando" : "Guardar y cargar"}</span>
        </button>
      </div>
    </form>
  );
}

function isDriveFolder(file) {
  return file?.mimeType === DRIVE_FOLDER_MIME_TYPE;
}

function getFileMeta(file) {
  const parts = [];

  if (isDriveFolder(file)) {
    parts.push("Carpeta");
  } else {
    parts.push(formatMimeType(file?.mimeType));
  }

  if (file?.size) {
    parts.push(formatBytes(Number(file.size)));
  }

  if (file?.modifiedTime) {
    parts.push(formatDate(file.modifiedTime));
  }

  return parts.filter(Boolean).join(" / ");
}

function formatMimeType(mimeType = "") {
  if (!mimeType) return "Archivo";
  if (mimeType.includes("spreadsheet")) return "Hoja de calculo";
  if (mimeType.includes("document")) return "Documento";
  if (mimeType.includes("presentation")) return "Presentacion";
  if (mimeType.startsWith("image/")) return "Imagen";
  if (mimeType === "application/pdf") return "PDF";
  return "Archivo";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDriveErrorMessage(error, source = "drive") {
  if (error?.code === "permission-denied") {
    return "Sin permisos Firestore para leer o guardar systemSettings/drive. Tu usuario debe tener role admin en users/{uid}.";
  }

  if (error?.code === "functions/permission-denied") {
    return "Sin permisos en la funcion de Drive. Revisa que users/{uid}.role sea admin y que la funcion use ese UID.";
  }

  if (error?.code === "functions/unauthenticated" || error?.code === "unauthenticated") {
    return "Inicia sesion para usar Nube AES.";
  }

  if (error?.code === "not-found") {
    return "No se encontro la configuracion de Nube AES.";
  }

  if (source === "settings") {
    return error?.message || "No se pudo leer o guardar la configuracion de Nube AES.";
  }

  return error?.message || "No se pudo completar la operacion en Google Drive.";
}
