import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDriveFolder,
  DRIVE_FOLDER_MIME_TYPE,
  deleteDriveItem,
  ensureDriveDepartmentFolders,
  getDriveRootSettings,
  listAllowedDriveDepartmentFolders,
  listDriveFolder,
  moveDriveItem,
  renameDriveItem,
  saveDriveRootFolderId,
  searchDriveFiles,
  uploadDriveFile,
} from "../services/driveService";
import { useAuth } from "../context/AuthContext";

const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const DRIVE_SEARCH_TYPES = [
  { value: "todos", label: "Todos" },
  { value: "carpetas", label: "Carpetas" },
  { value: "documentos", label: "Documentos" },
  { value: "imagenes", label: "Imagenes" },
  { value: "videos", label: "Videos" },
  { value: "pdf", label: "PDF" },
];

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

  if (name === "upload") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 16V4" />
        <path d="M7 9l5-5 5 5" />
        <path d="M5 20h14" />
      </svg>
    );
  }

  if (name === "more") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
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
  const { isAdmin } = useAuth();
  const [rootFolderId, setRootFolderId] = useState("");
  const [rootFolderDraft, setRootFolderDraft] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState("");
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [files, setFiles] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingRoot, setSavingRoot] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [syncingDepartments, setSyncingDepartments] = useState(false);
  const [departmentFoldersLoading, setDepartmentFoldersLoading] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [openActionsItemId, setOpenActionsItemId] = useState("");
  const [mutatingItemId, setMutatingItemId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("todos");
  const [searchResults, setSearchResults] = useState([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(() => (isAdmin ? "files" : "departments"));
  const [departmentFolders, setDepartmentFolders] = useState([]);
  const [error, setError] = useState("");
  const [departmentError, setDepartmentError] = useState("");
  const [departmentSuccess, setDepartmentSuccess] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const fileInputRef = useRef(null);

  const currentFolderName = breadcrumbs.at(-1)?.name || "Sin carpeta cargada";
  const folderCount = useMemo(() => files.filter(isDriveFolder).length, [files]);
  const fileCount = files.length - folderCount;
  const hasRootFolder = Boolean(rootFolderId);
  const isBusy = settingsLoading || loading;
  const isBrowserLoading = isBusy || uploadingFile || searchLoading;
  const departmentFoldersCount = departmentFolders.length;
  const canUseRootSettings = isAdmin;
  const canUseDepartmentSync = isAdmin;
  const canUseCurrentFolderActions = Boolean(currentFolderId);
  const canManageItems = Boolean(currentFolderId) || searchActive;
  const visibleFiles = searchActive ? searchResults : files;
  const visibleEmptyMessage = searchActive ? "No hay resultados para esta busqueda." : "Esta carpeta esta vacia.";

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

  const loadDepartmentFolders = useCallback(async () => {
    setDepartmentFoldersLoading(true);
    setDepartmentError("");

    try {
      const result = await listAllowedDriveDepartmentFolders();
      setDepartmentFolders(Array.isArray(result?.folders) ? result.folders : []);
    } catch (foldersError) {
      setDepartmentError(getDriveErrorMessage(foldersError, "departmentSettings"));
    } finally {
      setDepartmentFoldersLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadRootFolderSetting() {
      if (!canUseRootSettings) {
        setSettingsLoading(false);
        setRootFolderId("");
        setRootFolderDraft("");
        setCurrentFolderId("");
        setBreadcrumbs([]);
        setFiles([]);
        return;
      }

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
  }, [canUseRootSettings, loadFolder]);

  useEffect(() => {
    if (!isAdmin) {
      const timeoutId = window.setTimeout(() => {
        loadDepartmentFolders();
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    return undefined;
  }, [isAdmin, loadDepartmentFolders]);

  function handleReloadRoot() {
    if (!rootFolderId) {
      setConfigOpen(true);
      setError("Configura una carpeta raiz para usar Nube AES.");
      return;
    }

    clearDriveSearch();
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
      clearDriveSearch();
      await loadFolder(savedRootFolderId, [{ id: savedRootFolderId, name: "Raiz" }]);
    } catch (saveError) {
      setError(getDriveErrorMessage(saveError, "settings"));
    } finally {
      setSavingRoot(false);
    }
  }

  function handleOpenItem(file) {
    if (isDriveFolder(file)) {
      clearDriveSearch();
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

    clearDriveSearch();
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

  async function reloadCurrentFolder() {
    if (!currentFolderId) {
      return;
    }

    await loadFolder(currentFolderId, breadcrumbs);
  }

  async function reloadVisibleItems() {
    if (searchActive) {
      await runDriveSearch();
      return;
    }

    await reloadCurrentFolder();
  }

  async function runDriveSearch() {
    setSearchLoading(true);
    setError("");
    setUploadSuccess("");
    setOpenActionsItemId("");

    try {
      const result = await searchDriveFiles({
        query: searchQuery,
        type: searchType,
        folderId: currentFolderId,
      });

      setSearchResults(Array.isArray(result?.files) ? result.files : []);
      setSearchActive(true);
    } catch (searchError) {
      setSearchResults([]);
      setSearchActive(true);
      setError(getDriveErrorMessage(searchError, "search"));
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleSearchFiles(event) {
    event.preventDefault();

    if (!currentFolderId && isAdmin && !rootFolderId) {
      setError("Configura una carpeta raiz antes de buscar.");
      return;
    }

    await runDriveSearch();
  }

  function clearDriveSearch() {
    setSearchActive(false);
    setSearchResults([]);
    setSearchLoading(false);
    setOpenActionsItemId("");
  }

  async function handleRenameItem(item) {
    const currentName = item?.name || "";
    const nextName = window.prompt("Nuevo nombre", currentName);
    const cleanName = String(nextName || "").trim();

    if (!cleanName || cleanName === currentName) {
      return;
    }

    setMutatingItemId(item.id);
    setError("");
    setUploadSuccess("");
    setOpenActionsItemId("");

    try {
      await renameDriveItem(item.id, cleanName);
      setUploadSuccess(`Elemento renombrado: ${cleanName}`);
      await reloadVisibleItems();
    } catch (renameError) {
      setError(getDriveErrorMessage(renameError, "mutation"));
    } finally {
      setMutatingItemId("");
    }
  }

  async function handleMoveItem(item) {
    const targetFolderId = window.prompt("FolderId destino");
    const cleanTargetFolderId = String(targetFolderId || "").trim();

    if (!cleanTargetFolderId) {
      return;
    }

    setMutatingItemId(item.id);
    setError("");
    setUploadSuccess("");
    setOpenActionsItemId("");

    try {
      await moveDriveItem(item.id, cleanTargetFolderId);
      setUploadSuccess(`Elemento movido: ${item.name || "Archivo"}`);
      await reloadVisibleItems();
    } catch (moveError) {
      setError(getDriveErrorMessage(moveError, "mutation"));
    } finally {
      setMutatingItemId("");
    }
  }

  async function handleDeleteItem(item) {
    const itemName = item?.name || "este elemento";
    const confirmed = window.confirm(`Enviar "${itemName}" a la papelera de Drive?`);

    if (!confirmed) {
      return;
    }

    setMutatingItemId(item.id);
    setError("");
    setUploadSuccess("");
    setOpenActionsItemId("");

    try {
      await deleteDriveItem(item.id);
      setUploadSuccess(`Elemento enviado a papelera: ${itemName}`);
      await reloadVisibleItems();
    } catch (deleteError) {
      setError(getDriveErrorMessage(deleteError, "mutation"));
    } finally {
      setMutatingItemId("");
    }
  }

  function handleUploadClick() {
    if (!currentFolderId) {
      setError("Carga una carpeta antes de subir archivos.");
      return;
    }

    setError("");
    setUploadSuccess("");
    fileInputRef.current?.click();
  }

  async function handleUploadFile(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!currentFolderId) {
      setError("Carga una carpeta antes de subir archivos.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setError("El archivo supera el limite inicial de 25MB.");
      event.target.value = "";
      return;
    }

    setUploadingFile(true);
    setError("");
    setUploadSuccess("");

    try {
      const base64 = await readFileAsBase64(file);

      await uploadDriveFile({
        folderId: currentFolderId,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        base64,
      });

      setUploadSuccess(`Archivo subido: ${file.name}`);
      await loadFolder(currentFolderId, breadcrumbs);
    } catch (uploadError) {
      setError(getDriveErrorMessage(uploadError, "upload"));
    } finally {
      setUploadingFile(false);
      event.target.value = "";
    }
  }

  async function handleSyncDepartmentFolders() {
    if (!rootFolderId) {
      setConfigOpen(true);
      setDepartmentError("Configura la carpeta raiz antes de sincronizar departamentos.");
      return;
    }

    setSyncingDepartments(true);
    setDepartmentError("");
    setDepartmentSuccess("");

    try {
      const result = await ensureDriveDepartmentFolders();
      const folders = Array.isArray(result?.folders) ? result.folders : [];
      setDepartmentFolders(folders.length ? folders : []);
      setDepartmentSuccess(`Sincronizacion completa: ${result?.count || folders.length || 0} departamentos listos.`);
    } catch (syncError) {
      setDepartmentError(getDriveErrorMessage(syncError, "drive"));
    } finally {
      setSyncingDepartments(false);
    }
  }

  function handleOpenDepartmentsTab() {
    setActiveTab("departments");
    setDepartmentSuccess("");

    if (!departmentFolders.length) {
      loadDepartmentFolders();
    }
  }

  function handleOpenDepartmentFolder(folder) {
    const folderId = String(folder?.folderId || "").trim();

    if (!folderId) {
      setDepartmentError("Este departamento todavia no tiene carpeta sincronizada.");
      return;
    }

    setActiveTab("files");
    setDepartmentError("");
    clearDriveSearch();
    loadFolder(folderId, [
      ...(rootFolderId ? [{ id: rootFolderId, name: "Raiz" }] : []),
      { id: folderId, name: folder.departmentName || folder.folderName || "Departamento" },
    ]);
  }

  return (
    <div className="visual-page drive-manager-page">
      <div className="visual-page-header drive-manager-header">
        <div>
          <h2>Nube AES</h2>
          <p>{isAdmin ? "Explora carpetas y archivos conectados a Google Drive." : "Accede a las carpetas vinculadas a tus departamentos."}</p>
        </div>

        <div className="drive-manager-summary">
          <span>{isAdmin ? (hasRootFolder ? "Raiz configurada" : "Sin raiz") : "Mis carpetas"}</span>
          <strong>{folderCount} carpetas / {fileCount} archivos</strong>
        </div>
      </div>

      <div className="drive-tabs" role="tablist" aria-label="Secciones de Nube AES">
        <button
          className={activeTab === "files" ? "active" : ""}
          type="button"
          onClick={() => setActiveTab("files")}
        >
          Archivos
        </button>
        <button
          className={activeTab === "departments" ? "active" : ""}
          type="button"
          onClick={handleOpenDepartmentsTab}
        >
          {isAdmin ? "Departamentos" : "Mis carpetas"}
        </button>
      </div>

      {canUseRootSettings && !hasRootFolder && !settingsLoading ? (
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

      {activeTab === "files" && (hasRootFolder || canUseCurrentFolderActions) ? (
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
                disabled={!canUseCurrentFolderActions || creatingFolder || isBusy}
              />
              <button
                className="visual-outline-button drive-icon-button"
                type="submit"
                disabled={!canUseCurrentFolderActions || creatingFolder || isBusy}
              >
                <ActionIcon name="add" />
                <span>{creatingFolder ? "Creando" : "Crear"}</span>
              </button>
            </div>
          </form>

          <div className="drive-upload-card">
            <div>
              <span>Subida</span>
              <strong>Archivo a carpeta actual</strong>
              <small>Limite inicial 25MB</small>
            </div>

            <input
              ref={fileInputRef}
              className="drive-hidden-file-input"
              type="file"
              onChange={handleUploadFile}
              disabled={!canUseCurrentFolderActions || uploadingFile || isBusy}
            />

            <button
              className="visual-primary-button drive-icon-button"
              type="button"
              onClick={handleUploadClick}
              disabled={!canUseCurrentFolderActions || uploadingFile || isBusy}
            >
              <ActionIcon name="upload" />
              <span>{uploadingFile ? "Subiendo" : "Subir archivo"}</span>
            </button>
          </div>

          {canUseRootSettings ? (
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
          ) : null}
        </section>
      ) : null}

      {canUseRootSettings && hasRootFolder && configOpen ? (
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

      {activeTab === "departments" ? (
        <section className="drive-departments-panel">
          <div className="drive-departments-header">
            <div>
              <span>{isAdmin ? "Carpetas por departamento" : "Mis carpetas"}</span>
              <strong>{departmentFoldersCount} vinculadas</strong>
            </div>

            {canUseDepartmentSync ? (
            <button
              className="visual-primary-button drive-icon-button"
              type="button"
              onClick={handleSyncDepartmentFolders}
              disabled={!hasRootFolder || syncingDepartments || settingsLoading}
            >
              <ActionIcon name="load" />
              <span>{syncingDepartments ? "Sincronizando" : "Sincronizar carpetas de departamentos"}</span>
            </button>
            ) : null}
          </div>

          {departmentError ? <div className="drive-error-box">{departmentError}</div> : null}
          {departmentSuccess ? <div className="drive-success-box">{departmentSuccess}</div> : null}

          {departmentFoldersLoading ? (
            <div className="drive-loading-state">Cargando carpetas de departamentos...</div>
          ) : null}

          {!departmentFoldersLoading && departmentFolders.length === 0 ? (
            <div className="empty-state drive-empty-state">
              <div>
                <DriveIcon type="folder" />
              </div>
              <p>{isAdmin ? "No hay carpetas de departamentos vinculadas." : "No tienes carpetas de departamento asignadas."}</p>
            </div>
          ) : null}

          {!departmentFoldersLoading && departmentFolders.length > 0 ? (
            <div className="drive-department-grid">
              {departmentFolders.map((folder) => (
                <article className="drive-department-card" key={folder.departmentId || folder.id}>
                  <span className="drive-file-icon folder">
                    <DriveIcon type="folder" />
                  </span>

                  <div>
                    <strong>{folder.departmentName || "Departamento"}</strong>
                    <small>{folder.folderName || "Carpeta de Drive"}</small>
                  </div>

                  <button
                    className="visual-outline-button drive-icon-button"
                    type="button"
                    onClick={() => handleOpenDepartmentFolder(folder)}
                    disabled={!folder.folderId || loading}
                  >
                    <ActionIcon name="open" />
                    <span>Abrir carpeta</span>
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "files" ? (
        <section className="drive-browser-panel">
          <div className="drive-browser-toolbar">
            <div>
              <span>{searchActive ? "Resultados" : "Carpeta actual"}</span>
              <strong>{settingsLoading ? "Cargando configuracion..." : searchActive ? "Busqueda en Nube AES" : currentFolderName}</strong>
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

          <form className="drive-search-panel" onSubmit={handleSearchFiles}>
            <label htmlFor="drive-search-query">Buscar</label>
            <div>
              <input
                id="drive-search-query"
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Nombre o contenido"
                autoComplete="off"
                disabled={isBrowserLoading}
              />

              <select
                value={searchType}
                onChange={(event) => setSearchType(event.target.value)}
                disabled={isBrowserLoading}
                aria-label="Filtro por tipo"
              >
                {DRIVE_SEARCH_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>

              <button
                className="visual-primary-button drive-icon-button"
                type="submit"
                disabled={isBrowserLoading}
              >
                <ActionIcon name="load" />
                <span>{searchLoading ? "Buscando" : "Buscar"}</span>
              </button>

              {searchActive ? (
                <button
                  className="visual-outline-button drive-icon-button"
                  type="button"
                  onClick={clearDriveSearch}
                  disabled={searchLoading}
                >
                  <ActionIcon name="settings" />
                  <span>Limpiar busqueda</span>
                </button>
              ) : null}
            </div>
          </form>

          {error ? <div className="drive-error-box">{error}</div> : null}
          {uploadSuccess ? <div className="drive-success-box">{uploadSuccess}</div> : null}

          {isBrowserLoading ? (
            <div className="drive-loading-state">
              {searchLoading
                ? "Buscando en Google Drive..."
                : uploadingFile
                ? "Subiendo archivo a Google Drive..."
                : settingsLoading
                  ? "Cargando configuracion de Nube AES..."
                  : "Cargando contenido de Drive..."}
            </div>
          ) : null}

          {!isBrowserLoading && !error && (currentFolderId || searchActive) && visibleFiles.length === 0 ? (
            <div className="empty-state drive-empty-state">
              <div>
                <DriveIcon />
              </div>
              <p>{visibleEmptyMessage}</p>
            </div>
          ) : null}

          {!isBrowserLoading && !searchActive && !currentFolderId ? (
            <div className="empty-state drive-empty-state">
              <div>
                <DriveIcon type="folder" />
              </div>
              <p>{isAdmin ? (hasRootFolder ? "No se pudo cargar la carpeta raiz." : "Configura la carpeta raiz para iniciar.") : "Abre una carpeta de Mis carpetas para navegar."}</p>
            </div>
          ) : null}

          {!isBrowserLoading && visibleFiles.length > 0 ? (
            <div className="drive-file-grid">
              {visibleFiles.map((file) => (
                <article
                  key={file.id}
                  className="drive-file-card"
                >
                  <button
                    className="drive-file-main"
                    type="button"
                    onClick={() => handleOpenItem(file)}
                    disabled={mutatingItemId === file.id}
                  >
                    <span className={isDriveFolder(file) ? "drive-file-icon folder" : "drive-file-icon"}>
                      <DriveIcon type={isDriveFolder(file) ? "folder" : "file"} />
                    </span>

                    <span className="drive-file-content">
                      <strong>{file.name || "Archivo sin nombre"}</strong>
                      <small>{mutatingItemId === file.id ? "Actualizando..." : getFileMeta(file)}</small>
                    </span>
                  </button>

                  {canManageItems ? (
                    <div className="drive-item-actions">
                      <button
                        className="drive-item-menu-button"
                        type="button"
                        onClick={() =>
                          setOpenActionsItemId((current) => (current === file.id ? "" : file.id))
                        }
                        disabled={mutatingItemId === file.id}
                        aria-label={`Acciones para ${file.name || "archivo"}`}
                      >
                        <ActionIcon name="more" />
                      </button>

                      {openActionsItemId === file.id ? (
                        <div className="drive-item-menu">
                          <button type="button" onClick={() => handleRenameItem(file)}>
                            Renombrar
                          </button>
                          <button type="button" onClick={() => handleMoveItem(file)}>
                            Mover
                          </button>
                          <button type="button" onClick={() => handleDeleteItem(file)}>
                            Eliminar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
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

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };

    reader.onerror = () => reject(new Error("No se pudo leer el archivo seleccionado."));
    reader.readAsDataURL(file);
  });
}

function getDriveErrorMessage(error, source = "drive") {
  if (error?.code === "permission-denied") {
    return "Sin permisos Firestore para leer o guardar systemSettings/drive. Tu usuario debe tener role admin en users/{uid}.";
  }

  if (error?.code === "functions/permission-denied") {
    return source === "upload"
      ? "Sin permisos para subir a Drive. Revisa que users/{uid}.role sea admin y que la carpeta permita escritura."
      : "Sin permisos en la funcion de Drive. Revisa que users/{uid}.role sea admin y que la funcion use ese UID.";
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

  if (source === "departmentSettings") {
    return error?.message || "No se pudieron cargar las carpetas de departamentos.";
  }

  if (source === "upload") {
    return error?.message || "No se pudo subir el archivo a Google Drive.";
  }

  if (source === "mutation") {
    return error?.message || "No se pudo modificar el elemento en Google Drive.";
  }

  if (source === "search") {
    return error?.message || "No se pudo buscar en Google Drive.";
  }

  return error?.message || "No se pudo completar la operacion en Google Drive.";
}
