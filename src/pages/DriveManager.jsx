import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDriveResumableUpload,
  createDriveFolder,
  DRIVE_FOLDER_MIME_TYPE,
  deleteDriveItem,
  ensureDriveDepartmentFolders,
  getDriveRootSettings,
  listDriveTrash,
  listAllowedDriveDepartmentFolders,
  listDriveFolder,
  moveDriveItem,
  renameDriveItem,
  restoreDriveItem,
  saveDriveRootFolderId,
  searchDriveFiles,
} from "../services/driveService";
import { useAuth } from "../context/AuthContext";

const DRIVE_VIEW_STORAGE_KEY = "nubeAesViewMode";
const DRIVE_SEARCH_TYPES = [
  { value: "todos", label: "Todos" },
  { value: "carpetas", label: "Carpetas" },
  { value: "documentos", label: "Documentos" },
  { value: "imagenes", label: "Imagenes" },
  { value: "videos", label: "Videos" },
  { value: "pdf", label: "PDF" },
];
const DRIVE_VIEW_OPTIONS = [
  { value: "list", label: "Lista", icon: "viewList" },
  { value: "small", label: "Pequenas", icon: "viewSmall" },
  { value: "medium", label: "Medianas", icon: "viewMedium" },
  { value: "large", label: "Grandes", icon: "viewLarge" },
];

function DriveIcon({ type = "file" }) {
  if (type === "folder") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4.2l2 2.4h6.8A2.5 2.5 0 0 1 21 8.9v8.6A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-11z" />
      </svg>
    );
  }

  if (type === "pdf") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8.5L19 8v12.5H6V3.5z" />
        <path d="M14 3.5V8h5" />
        <path d="M8.5 14h7" />
        <path d="M8.5 17h5" />
      </svg>
    );
  }

  if (type === "image") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="m5 17 4.5-4.5 3.2 3.2 2.1-2.1L19 17" />
      </svg>
    );
  }

  if (type === "video") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="6" width="12" height="12" rx="2" />
        <path d="m16 10 4-2.5v9L16 14" />
      </svg>
    );
  }

  if (type === "sheet") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8.5L19 8v12.5H6V3.5z" />
        <path d="M14 3.5V8h5" />
        <path d="M8.5 12h7" />
        <path d="M8.5 15h7" />
        <path d="M11 12v6" />
      </svg>
    );
  }

  if (type === "presentation") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="5" width="16" height="12" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M8 13l3-3 2 2 3-4" />
      </svg>
    );
  }

  if (type === "document") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 3.5h8.5L19 8v12.5H6V3.5z" />
        <path d="M14 3.5V8h5" />
        <path d="M9 12h6" />
        <path d="M9 15h6" />
        <path d="M9 18h4" />
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

function DriveModuleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 18.5a4 4 0 0 1 .9-7.9 5.8 5.8 0 0 1 11.1 1.6A3.2 3.2 0 0 1 17.8 18.5H6z" />
      <path d="M9 15h6" />
      <path d="M12 12v6" />
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

  if (name === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M6 7l1 14h10l1-14" />
        <path d="M9 7V4h6v3" />
      </svg>
    );
  }

  if (name === "restore") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16" />
        <path d="M6 7l1 14h10l1-14" />
        <path d="M9 12h6" />
        <path d="M12 9v6" />
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

  if (name === "close") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }

  if (name === "viewList") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6h12" />
        <path d="M8 12h12" />
        <path d="M8 18h12" />
        <path d="M4 6h.01" />
        <path d="M4 12h.01" />
        <path d="M4 18h.01" />
      </svg>
    );
  }

  if (name === "viewSmall" || name === "viewMedium" || name === "viewLarge") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
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

function DriveUploadProgress({ upload }) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(upload?.progress || 0))));
  const status = upload?.status || "uploading";
  const label = upload?.label || "Subiendo...";
  const name = upload?.name || "Archivo";
  const message = upload?.message || "";

  return (
    <article className="drive-upload-progress-card" data-status={status}>
      <div className="drive-upload-progress-header">
        <div>
          <span>{label}</span>
          <strong title={name}>{name}</strong>
        </div>

        <b>{progress}%</b>
      </div>

      <div
        className="drive-upload-progress-track"
        role="progressbar"
        aria-label={`Progreso de subida de ${name}`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      {message ? <small>{message}</small> : null}
    </article>
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
  const [viewMode, setViewMode] = useState(getStoredDriveViewMode);
  const [previewFile, setPreviewFile] = useState(null);
  const [draggingItemId, setDraggingItemId] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState("");
  const [activeTab, setActiveTab] = useState(() => (isAdmin ? "files" : "departments"));
  const [trashActive, setTrashActive] = useState(false);
  const [trashFolderId, setTrashFolderId] = useState("");
  const [trashFiles, setTrashFiles] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [trashError, setTrashError] = useState("");
  const [departmentFolders, setDepartmentFolders] = useState([]);
  const [error, setError] = useState("");
  const [departmentError, setDepartmentError] = useState("");
  const [departmentSuccess, setDepartmentSuccess] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileInputRef = useRef(null);
  const uploadClearTimeoutRef = useRef(null);

  const currentFolderName = breadcrumbs.at(-1)?.name || "Sin carpeta cargada";
  const folderCount = useMemo(() => files.filter(isDriveFolder).length, [files]);
  const fileCount = files.length - folderCount;
  const hasRootFolder = Boolean(rootFolderId);
  const isBusy = settingsLoading || loading;
  const isBrowserLoading = isBusy || uploadingFile || searchLoading || trashLoading;
  const departmentFoldersCount = departmentFolders.length;
  const canUseRootSettings = isAdmin;
  const canUseDepartmentSync = isAdmin;
  const canUseTrash = isAdmin;
  const canUseCurrentFolderActions = Boolean(currentFolderId);
  const canManageItems = !trashActive && (Boolean(currentFolderId) || searchActive);
  const visibleFiles = searchActive ? searchResults : files;
  const browserFiles = trashActive ? trashFiles : visibleFiles;
  const browserError = trashActive ? trashError : error;
  const visibleEmptyMessage = trashActive
    ? "No hay archivos en la papelera."
    : searchActive
      ? "No hay resultados para esta busqueda."
      : "Esta carpeta esta vacia.";
  const hasVisibleFiles = browserFiles.length > 0;
  const visibleFolderCount = useMemo(() => visibleFiles.filter(isDriveFolder).length, [visibleFiles]);
  const visibleFileCount = visibleFiles.length - visibleFolderCount;

  useEffect(() => {
    try {
      window.localStorage.setItem(DRIVE_VIEW_STORAGE_KEY, viewMode);
    } catch {
      // Local preference only; ignore restricted storage.
    }
  }, [viewMode]);

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

  useEffect(() => {
    return () => {
      if (uploadClearTimeoutRef.current) {
        window.clearTimeout(uploadClearTimeoutRef.current);
      }
    };
  }, []);

  function setUploadStatusNow(nextStatus) {
    if (uploadClearTimeoutRef.current) {
      window.clearTimeout(uploadClearTimeoutRef.current);
      uploadClearTimeoutRef.current = null;
    }

    setUploadStatus(nextStatus);
  }

  function clearUploadStatusSoon() {
    if (uploadClearTimeoutRef.current) {
      window.clearTimeout(uploadClearTimeoutRef.current);
    }

    uploadClearTimeoutRef.current = window.setTimeout(() => {
      setUploadStatus(null);
      uploadClearTimeoutRef.current = null;
    }, 1800);
  }

  function handleReloadRoot() {
    if (!rootFolderId) {
      setConfigOpen(true);
      setError("Configura una carpeta raiz para usar Nube AES.");
      return;
    }

    clearTrashView();
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
    clearTrashView();

    if (isDriveFolder(file)) {
      clearDriveSearch();
      loadFolder(file.id, [...breadcrumbs, { id: file.id, name: file.name || "Carpeta" }]);
      return;
    }

    setPreviewFile(file);
  }

  function handleBreadcrumbClick(index) {
    const breadcrumb = breadcrumbs[index];

    if (!breadcrumb || breadcrumb.id === currentFolderId) {
      return;
    }

    clearDriveSearch();
    clearTrashView();
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

    clearTrashView();
    await runDriveSearch();
  }

  function clearDriveSearch() {
    setSearchActive(false);
    setSearchResults([]);
    setSearchLoading(false);
    setOpenActionsItemId("");
  }

  function clearTrashView() {
    setTrashActive(false);
    setTrashFolderId("");
    setTrashFiles([]);
    setTrashLoading(false);
    setTrashLoaded(false);
    setTrashError("");
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

  function resolveTrashFolderId(folderId) {
    return String(folderId || trashFolderId || currentFolderId || rootFolderId || "").trim();
  }

  async function loadTrash({ force = false, folderId } = {}) {
    const cleanFolderId = resolveTrashFolderId(folderId);

    if (!cleanFolderId) {
      setTrashActive(true);
      setTrashFiles([]);
      setTrashLoaded(true);
      setTrashError("Carga una carpeta antes de abrir la papelera.");
      return false;
    }

    if (!force && trashActive && trashLoaded && trashFolderId === cleanFolderId) {
      return true;
    }

    setActiveTab("files");
    clearDriveSearch();
    setTrashActive(true);
    setTrashFolderId(cleanFolderId);
    setTrashFiles([]);
    setTrashLoaded(false);
    setTrashLoading(true);
    setTrashError("");
    setError("");
    setUploadSuccess("");
    setOpenActionsItemId("");

    try {
      const result = await listDriveTrash(cleanFolderId);
      setTrashFiles(Array.isArray(result?.files) ? result.files : []);
      setTrashLoaded(true);
      return true;
    } catch (trashError) {
      setTrashFiles([]);
      setTrashLoaded(true);
      setTrashError(getDriveErrorMessage(trashError, "trash"));
      return false;
    } finally {
      setTrashLoading(false);
    }
  }

  async function handleOpenTrash() {
    setActiveTab("files");
    await loadTrash({ force: true, folderId: rootFolderId || currentFolderId });
  }

  function handleCloseTrash() {
    clearTrashView();
    setError("");
  }

  async function handleRestoreTrashItem(item) {
    const itemName = item?.name || "este elemento";
    const confirmed = window.confirm(`Restaurar "${itemName}" desde la papelera de Drive?`);

    if (!confirmed) {
      return;
    }

    setMutatingItemId(item.id);
    setError("");
    setUploadSuccess("");

    try {
      await restoreDriveItem(item.id);
      setUploadSuccess(`Elemento restaurado: ${itemName}`);
      await loadTrash({ force: true, folderId: trashFolderId || rootFolderId || currentFolderId });

      if (currentFolderId) {
        await reloadCurrentFolder();
      }
    } catch (restoreError) {
      setError(getDriveErrorMessage(restoreError, "mutation"));
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
    setUploadStatusNow(null);
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

    setUploadingFile(true);
    setError("");
    setUploadSuccess("");
    setUploadStatusNow({
      name: file.name,
      status: "preparing",
      label: "Preparando...",
      message: "La subida puede tardar segun tu conexion.",
      progress: 0,
    });
    let uploadStartedAt = Date.now();

    try {
      const mimeType = file.type || "application/octet-stream";
      const session = await createDriveResumableUpload({
        folderId: currentFolderId,
        name: file.name,
        mimeType,
        size: file.size,
      });

      setUploadStatusNow({
        name: file.name,
        status: "uploading",
        label: "Subiendo...",
        message: "La subida puede tardar segun tu conexion.",
        progress: 0,
      });
      uploadStartedAt = Date.now();

      const uploadResult = await uploadFileToDriveSession({
        file,
        uploadUrl: session?.uploadUrl,
        mimeType,
        onProgress: (progress) => {
          setUploadStatusNow({
            name: file.name,
            status: progress >= 100 ? "processing" : "uploading",
            label: progress >= 100 ? "Procesando en Drive..." : "Subiendo...",
            message:
              progress >= 100
                ? "Google Drive esta terminando de registrar el archivo."
                : "La subida puede tardar segun tu conexion.",
            progress,
          });
        },
      });

      setUploadStatusNow({
        name: file.name,
        status: uploadResult?.incomplete ? "verifying" : "processing",
        label: uploadResult?.incomplete ? "Verificando en Drive..." : "Procesando en Drive...",
        message: "Confirmando archivo en la carpeta actual.",
        progress: 100,
      });
      const uploadFound = await reloadFolderAfterUpload({
        name: file.name,
        size: file.size,
        startedAt: uploadStartedAt,
      });

      setUploadStatusNow({
        name: file.name,
        status: "completed",
        label: "Completado",
        message: uploadFound
          ? "Archivo disponible en la carpeta actual."
          : uploadResult?.incomplete
            ? "Google Drive sigue procesando el archivo."
            : "Google Drive puede tardar en mostrarlo.",
        progress: 100,
      });
      clearUploadStatusSoon();
    } catch (uploadError) {
      if (isLikelyCompletedUpload(uploadError)) {
        setError("");
        setUploadStatusNow({
          name: file.name,
          status: "verifying",
          label: "Verificando en Drive...",
          message: "La respuesta final no fue legible, revisando carpeta actual.",
          progress: getUploadErrorProgress(uploadError),
        });

        try {
          const uploadFound = await reloadFolderAfterUpload({
            name: file.name,
            size: file.size,
            startedAt: uploadStartedAt,
          });

          if (uploadFound) {
            setUploadStatusNow({
              name: file.name,
              status: "completed",
              label: "Completado",
              message: "Archivo disponible en la carpeta actual.",
              progress: 100,
            });
            clearUploadStatusSoon();
            return;
          }
        } catch (verificationError) {
          setError("");
          setUploadStatusNow({
            name: file.name,
            status: "error",
            label: "Error",
            message: getDriveErrorMessage(verificationError, "upload"),
            progress: getUploadErrorProgress(uploadError),
          });
          return;
        }
      }

      setError("");
      setUploadStatusNow({
        name: file.name,
        status: "error",
        label: "Error",
        message: getDriveErrorMessage(uploadError, "upload"),
        progress: getUploadErrorProgress(uploadError),
      });
    } finally {
      setUploadingFile(false);
      event.target.value = "";
    }
  }

  async function reloadFolderAfterUpload(fileTarget) {
    const target = normalizeUploadTarget(fileTarget);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) {
        await wait(900 * attempt);
      }

      const result = await listDriveFolder(currentFolderId);
      const nextFiles = Array.isArray(result?.files) ? result.files : [];

      setFiles(nextFiles);
      setCurrentFolderId(currentFolderId);
      setBreadcrumbs(breadcrumbs);

      if (!target.name || nextFiles.some((file) => matchesUploadedFile(file, target))) {
        return true;
      }
    }

    return false;
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
    clearTrashView();
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
    clearTrashView();
    setDepartmentError("");
    clearDriveSearch();
    loadFolder(folderId, [
      ...(rootFolderId ? [{ id: rootFolderId, name: "Raiz" }] : []),
      { id: folderId, name: folder.departmentName || folder.folderName || "Departamento" },
    ]);
  }

  function getDraggedItem() {
    return visibleFiles.find((file) => file.id === draggingItemId) || null;
  }

  function canDropOnFolder(targetFolder) {
    const draggedItem = getDraggedItem();

    if (!draggedItem || !isDriveFolder(targetFolder)) {
      return false;
    }

    if (draggedItem.id === targetFolder.id) {
      return false;
    }

    if (Array.isArray(draggedItem.parents) && draggedItem.parents.includes(targetFolder.id)) {
      return false;
    }

    if (isDriveFolder(draggedItem) && isKnownDescendantOf(targetFolder, draggedItem.id, visibleFiles)) {
      return false;
    }

    return true;
  }

  function handleDragStart(event, item) {
    if (mutatingItemId) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    setDraggingItemId(item.id);
    setOpenActionsItemId("");
    setUploadSuccess("");
  }

  function handleDragEnd() {
    setDraggingItemId("");
    setDragOverFolderId("");
  }

  function handleFolderDragOver(event, folder) {
    if (!canDropOnFolder(folder)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverFolderId(folder.id);
  }

  function handleFolderDragLeave(event, folder) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setDragOverFolderId((current) => (current === folder.id ? "" : current));
    }
  }

  async function handleFolderDrop(event, targetFolder) {
    event.preventDefault();

    const fileId = event.dataTransfer.getData("text/plain") || draggingItemId;
    const draggedItem = visibleFiles.find((file) => file.id === fileId);

    setDragOverFolderId("");

    if (!draggedItem || !canDropOnFolder(targetFolder)) {
      setError("No se puede mover el elemento a esa carpeta.");
      setDraggingItemId("");
      return;
    }

    setMutatingItemId(draggedItem.id);
    setError("");
    setUploadSuccess(`Moviendo ${draggedItem.name || "elemento"}...`);

    try {
      await moveDriveItem(draggedItem.id, targetFolder.id);
      setUploadSuccess(`Movido correctamente: ${draggedItem.name || "elemento"}`);
      await reloadVisibleItems();
    } catch (moveError) {
      setError(getDriveErrorMessage(moveError, "mutation"));
      setUploadSuccess("");
    } finally {
      setMutatingItemId("");
      setDraggingItemId("");
    }
  }

  function renderDriveItem(file) {
    const itemType = getDriveItemType(file);
    const isFolder = itemType === "folder";
    const isMutating = mutatingItemId === file.id;
    const canDropHere = isFolder && canDropOnFolder(file);

    return (
      <article
        key={file.id}
        className={[
          "drive-file-card",
          `view-${viewMode}`,
          `type-${itemType}`,
          draggingItemId === file.id ? "is-dragging" : "",
          dragOverFolderId === file.id && canDropHere ? "is-drop-target" : "",
        ].filter(Boolean).join(" ")}
        draggable={!isMutating}
        onDragStart={(event) => handleDragStart(event, file)}
        onDragEnd={handleDragEnd}
        onDragOver={(event) => handleFolderDragOver(event, file)}
        onDragLeave={(event) => handleFolderDragLeave(event, file)}
        onDrop={(event) => handleFolderDrop(event, file)}
      >
        <button
          className="drive-file-main"
          type="button"
          onClick={() => handleOpenItem(file)}
          disabled={isMutating}
        >
          <span className="drive-file-preview">
            {!isFolder && file.thumbnailLink ? (
              <img src={file.thumbnailLink} alt="" loading="lazy" />
            ) : (
              <span className={`drive-file-icon ${itemType}`}>
                <DriveIcon type={itemType} />
              </span>
            )}
          </span>

          <span className="drive-file-content">
            <strong>{file.name || "Archivo sin nombre"}</strong>
            <small>{isMutating ? "Actualizando..." : getFileMeta(file)}</small>
          </span>

          <span className="drive-file-column drive-file-type">{formatMimeType(file.mimeType)}</span>
          <span className="drive-file-column">{formatDate(file.modifiedTime) || "Sin fecha"}</span>
          <span className="drive-file-column">{file.size ? formatBytes(Number(file.size)) : "-"}</span>
        </button>

        {canManageItems ? (
          <div className="drive-item-actions">
            <button
              className="drive-item-menu-button"
              type="button"
              onClick={() =>
                setOpenActionsItemId((current) => (current === file.id ? "" : file.id))
              }
              disabled={isMutating}
              aria-label={`Acciones para ${file.name || "archivo"}`}
            >
              <ActionIcon name="more" />
            </button>

            {openActionsItemId === file.id ? (
              <div className="drive-item-menu">
                <button type="button" onClick={() => handleOpenItem(file)}>
                  Abrir
                </button>
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
    );
  }

  function renderTrashItem(file) {
    const itemType = getDriveItemType(file);
    const isFolder = itemType === "folder";
    const isMutating = mutatingItemId === file.id;

    return (
      <article
        key={file.id}
        className={[
          "drive-file-card",
          "drive-trash-item",
          `view-${viewMode}`,
          `type-${itemType}`,
        ].join(" ")}
      >
        <button
          className="drive-file-main"
          type="button"
          onClick={() => file.webViewLink && window.open(file.webViewLink, "_blank", "noopener,noreferrer")}
          disabled={isMutating || !file.webViewLink}
        >
          <span className="drive-file-preview">
            {!isFolder && file.thumbnailLink ? (
              <img src={file.thumbnailLink} alt="" loading="lazy" />
            ) : (
              <span className={`drive-file-icon ${itemType}`}>
                <DriveIcon type={itemType} />
              </span>
            )}
          </span>

          <span className="drive-file-content">
            <strong title={file.name || "Archivo sin nombre"}>{file.name || "Archivo sin nombre"}</strong>
            <small>{isMutating ? "Restaurando..." : getFileMeta(file)}</small>
          </span>

          <span className="drive-file-column drive-file-type">{formatMimeType(file.mimeType)}</span>
          <span className="drive-file-column">{formatDate(file.modifiedTime) || "Sin fecha"}</span>
          <span className="drive-file-column">{file.size ? formatBytes(Number(file.size)) : "-"}</span>
        </button>

        <div className="drive-trash-actions">
          <button
            className="visual-primary-button drive-icon-button"
            type="button"
            onClick={() => handleRestoreTrashItem(file)}
            disabled={isMutating}
            title="Restaurar"
            aria-label={`Restaurar ${file.name || "archivo"}`}
          >
            <ActionIcon name="restore" />
            <span>Restaurar</span>
          </button>

          {file.webViewLink ? (
            <a
              className="visual-outline-button drive-icon-button"
              href={file.webViewLink}
              target="_blank"
              rel="noreferrer"
            >
              <ActionIcon name="open" />
              <span>Abrir en Drive</span>
            </a>
          ) : null}
        </div>
      </article>
    );
  }

  return (
    <div className="visual-page drive-manager-page">
      <section className="drive-module-hero">
        <div className="drive-hero-copy">
          <span className="drive-hero-icon">
            <DriveModuleIcon />
          </span>
          <span>Nube AES</span>
          <h2>Nube AES</h2>
          <p>{isAdmin ? "Explora, organiza y previsualiza archivos conectados a Google Drive." : "Accede y organiza archivos de tus departamentos asignados."}</p>
        </div>

        <div className="drive-hero-side">
          <div className="drive-hero-stats">
            <article>
              <span>Carpetas</span>
              <strong>{searchActive ? visibleFolderCount : folderCount}</strong>
            </article>
            <article>
              <span>Archivos</span>
              <strong>{searchActive ? visibleFileCount : fileCount}</strong>
            </article>
            <article>
              <span>{searchActive ? "Resultados" : "Visibles"}</span>
              <strong>{visibleFiles.length}</strong>
            </article>
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
        </div>
      </section>

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
        <section className="drive-toolbar-panel">
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
                  <ActionIcon name="close" />
                  <span>Limpiar</span>
                </button>
              ) : null}
            </div>
          </form>

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
              <small>Archivos grandes compatibles</small>
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
              title={uploadingFile ? "Subiendo archivo" : "Subir archivo"}
              aria-label={uploadingFile ? "Subiendo archivo" : "Subir archivo"}
            >
              <ActionIcon name="upload" />
            </button>
          </div>

          <div className="drive-view-panel">
            <span>Vista</span>
            <div className="drive-view-switcher" role="group" aria-label="Selector de vista">
              {DRIVE_VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={viewMode === option.value ? "active" : ""}
                  type="button"
                  onClick={() => setViewMode(option.value)}
                  title={option.label}
                  aria-label={`Vista ${option.label}`}
                >
                  <ActionIcon name={option.icon} />
                </button>
              ))}
            </div>
          </div>

          {canUseTrash ? (
          <div className="drive-trash-card">
            <span>Papelera</span>
            <button
              className={trashActive ? "visual-primary-button drive-icon-button" : "visual-outline-button drive-icon-button"}
              type="button"
              onClick={handleOpenTrash}
              disabled={trashLoading || (!rootFolderId && !currentFolderId)}
              title={trashActive ? "Recargar papelera" : "Abrir papelera"}
              aria-label={trashActive ? "Recargar papelera" : "Abrir papelera"}
            >
              <ActionIcon name="trash" />
            </button>
          </div>
          ) : null}

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
                title={isBusy ? "Cargando raiz" : "Recargar raiz"}
                aria-label={isBusy ? "Cargando raiz" : "Recargar raiz"}
              >
                <ActionIcon name="load" />
              </button>

              <button
                className="visual-outline-button drive-icon-button"
                type="button"
                onClick={() => setConfigOpen((current) => !current)}
                title={configOpen ? "Ocultar configuracion" : "Cambiar carpeta raiz"}
                aria-label={configOpen ? "Ocultar configuracion" : "Cambiar carpeta raiz"}
              >
                <ActionIcon name="settings" />
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
          <div className="drive-path-card">
            <span>{trashActive ? "Papelera" : searchActive ? "Resultados" : "Carpeta actual"}</span>
            <strong>
              {settingsLoading
                ? "Cargando configuracion..."
                : trashActive
                  ? "Elementos eliminados"
                  : searchActive
                    ? "Busqueda en Nube AES"
                    : currentFolderName}
            </strong>

            <nav className="drive-breadcrumbs" aria-label={trashActive ? "Acciones de papelera" : "Ruta de Google Drive"}>
              {trashActive ? (
                <>
                  <button type="button" onClick={handleCloseTrash} disabled={isBusy}>
                    Volver a archivos
                  </button>
                  <button type="button" onClick={() => loadTrash({ force: true })} disabled={trashLoading}>
                    {trashLoading ? "Cargando" : "Recargar papelera"}
                  </button>
                </>
              ) : breadcrumbs.length === 0 ? (
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

          {browserError ? <div className="drive-error-box">{browserError}</div> : null}
          {uploadSuccess ? <div className="drive-success-box">{uploadSuccess}</div> : null}
          {uploadStatus ? <DriveUploadProgress upload={uploadStatus} /> : null}

          {isBrowserLoading ? (
            <div className={`drive-skeleton-grid view-${viewMode}`} aria-label="Cargando contenido">
              {Array.from({ length: viewMode === "list" ? 5 : 8 }).map((_, index) => (
                <span className="drive-skeleton-card" key={`drive-skeleton-${index}`} />
              ))}
            </div>
          ) : null}

          {!isBrowserLoading &&
          !browserError &&
          (currentFolderId || searchActive || trashActive) &&
          (!trashActive || trashLoaded) &&
          browserFiles.length === 0 ? (
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

          {!isBrowserLoading && hasVisibleFiles ? (
            <div className={`drive-file-grid view-${viewMode}`}>
              {viewMode === "list" ? (
                <div className="drive-file-list-head" aria-hidden="true">
                  <span>Nombre</span>
                  <span>Tipo</span>
                  <span>Fecha</span>
                  <span>Tamano</span>
                  <span>Acciones</span>
                </div>
              ) : null}

              {browserFiles.map((file) => (trashActive ? renderTrashItem(file) : renderDriveItem(file)))}
            </div>
          ) : null}
        </section>
      ) : null}

      {previewFile ? (
        <DrivePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
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

function DrivePreviewModal({ file, onClose }) {
  const previewUrl = buildDrivePreviewUrl(file);
  const fileType = formatMimeType(file?.mimeType);

  return (
    <div className="drive-preview-backdrop" role="dialog" aria-modal="true" aria-label="Vista previa de archivo">
      <div className="drive-preview-modal">
        <header className="drive-preview-header">
          <div>
            <span>{fileType}</span>
            <strong>{file?.name || "Archivo sin nombre"}</strong>
          </div>

          <div className="drive-preview-actions">
            {file?.webViewLink ? (
              <a
                className="visual-outline-button drive-icon-button"
                href={file.webViewLink}
                target="_blank"
                rel="noreferrer"
              >
                <ActionIcon name="open" />
                <span>Abrir en Drive</span>
              </a>
            ) : null}

            <button
              className="drive-preview-close"
              type="button"
              onClick={onClose}
              aria-label="Cerrar vista previa"
            >
              <ActionIcon name="close" />
            </button>
          </div>
        </header>

        <div className="drive-preview-body">
          {previewUrl ? (
            <iframe title={file?.name || "Vista previa"} src={previewUrl} loading="lazy" />
          ) : (
            <div className="drive-preview-empty">
              <DriveIcon type={getDriveItemType(file)} />
              <p>Vista previa no disponible para este archivo.</p>
              {file?.webViewLink ? (
                <a className="visual-primary-button" href={file.webViewLink} target="_blank" rel="noreferrer">
                  Abrir en Drive
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getStoredDriveViewMode() {
  try {
    const savedViewMode = window.localStorage.getItem(DRIVE_VIEW_STORAGE_KEY);
    return DRIVE_VIEW_OPTIONS.some((option) => option.value === savedViewMode) ? savedViewMode : "medium";
  } catch {
    return "medium";
  }
}

function isDriveFolder(file) {
  return file?.mimeType === DRIVE_FOLDER_MIME_TYPE;
}

function getDriveItemType(file) {
  const mimeType = String(file?.mimeType || "");

  if (isDriveFolder(file)) return "folder";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "sheet";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "presentation";
  if (mimeType.includes("document") || mimeType.includes("word") || mimeType === "text/plain") return "document";
  return "file";
}

function isKnownDescendantOf(item, ancestorId, knownItems) {
  const pendingParentIds = Array.isArray(item?.parents) ? [...item.parents] : [];
  const itemsById = new Map(knownItems.map((knownItem) => [knownItem.id, knownItem]));
  const visited = new Set();

  while (pendingParentIds.length > 0) {
    const parentId = pendingParentIds.shift();

    if (!parentId || visited.has(parentId)) {
      continue;
    }

    if (parentId === ancestorId) {
      return true;
    }

    visited.add(parentId);

    const parentItem = itemsById.get(parentId);

    if (parentItem?.parents?.length) {
      pendingParentIds.push(...parentItem.parents);
    }
  }

  return false;
}

function buildDrivePreviewUrl(file) {
  const id = String(file?.id || "").trim();
  const type = getDriveItemType(file);

  if (!id || type === "folder") {
    return "";
  }

  const encodedId = encodeURIComponent(id);

  if (type === "document") {
    return `https://docs.google.com/document/d/${encodedId}/preview`;
  }

  if (type === "sheet") {
    return `https://docs.google.com/spreadsheets/d/${encodedId}/preview`;
  }

  if (type === "presentation") {
    return `https://docs.google.com/presentation/d/${encodedId}/preview`;
  }

  return `https://drive.google.com/file/d/${encodedId}/preview`;
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
  if (mimeType === DRIVE_FOLDER_MIME_TYPE) return "Carpeta";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return "Imagen";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.includes("spreadsheet")) return "Hoja de calculo";
  if (mimeType.includes("document")) return "Documento";
  if (mimeType.includes("presentation")) return "Presentacion";
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

function normalizeUploadTarget(fileTarget) {
  if (typeof fileTarget === "string") {
    return {
      name: fileTarget.trim(),
      size: 0,
      startedAt: 0,
    };
  }

  return {
    name: String(fileTarget?.name || "").trim(),
    size: Number(fileTarget?.size || 0),
    startedAt: Number(fileTarget?.startedAt || 0),
  };
}

function matchesUploadedFile(file, target) {
  if (file?.name !== target.name) {
    return false;
  }

  const fileSize = Number(file?.size || 0);

  if (target.size > 0 && fileSize === target.size) {
    return true;
  }

  if (target.startedAt > 0) {
    const modifiedTime = new Date(file?.modifiedTime || "").getTime();

    return Number.isFinite(modifiedTime) && modifiedTime >= target.startedAt - 2 * 60 * 1000;
  }

  return target.size <= 0;
}

function isLikelyCompletedUpload(error) {
  return Boolean(error?.maybeCompleted) || Number(error?.uploadProgress || 0) >= 98;
}

function getUploadErrorProgress(error) {
  const progress = Number(error?.uploadProgress || 0);

  if (Number.isFinite(progress) && progress > 0) {
    return Math.max(0, Math.min(100, Math.round(progress)));
  }

  return error?.maybeCompleted ? 100 : 0;
}

function uploadFileToDriveSession({ file, uploadUrl, mimeType, onProgress }) {
  return new Promise((resolve, reject) => {
    const cleanUploadUrl = String(uploadUrl || "").trim();

    if (!cleanUploadUrl) {
      reject(new Error("No se pudo preparar la sesion de subida."));
      return;
    }

    const request = new XMLHttpRequest();
    let lastProgress = 0;

    const createUploadError = (message) => {
      const error = new Error(message);
      error.uploadProgress = lastProgress;
      error.maybeCompleted = lastProgress >= 98;
      error.status = request.status || 0;
      return error;
    };

    request.open("PUT", cleanUploadUrl);
    request.setRequestHeader("Content-Type", mimeType || "application/octet-stream");

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) {
        return;
      }

      const progress = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      lastProgress = progress;
      onProgress?.(progress);
    };

    request.onload = () => {
      const responseData = parseJsonSafely(request.responseText);

      if (request.status === 200 || request.status === 201 || request.status === 204) {
        onProgress?.(100);
        resolve(responseData);
        return;
      }

      if (request.status === 308) {
        resolve({ incomplete: true, status: 308, uploadProgress: lastProgress });
        return;
      }

      reject(createUploadError(`Google Drive rechazo la subida (${request.status}).`));
    };

    request.onerror = () =>
      reject(createUploadError("No se pudo confirmar la subida por CORS o red."));
    request.onabort = () => reject(createUploadError("La subida fue cancelada."));
    request.send(file);
  });
}

function parseJsonSafely(value) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    return null;
  }

  try {
    return JSON.parse(cleanValue);
  } catch {
    return null;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
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
