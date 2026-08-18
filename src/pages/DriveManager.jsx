import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createDriveResumableUpload,
  createDriveFolder,
  createPrivateFolder,
  DRIVE_FOLDER_MIME_TYPE,
  deleteDriveItem,
  getCloudFileContent,
  ensureDriveDepartmentFolders,
  getDriveRootSettings,
  getDriveStorageQuota,
  listDriveActivityLogs,
  listDriveItemShares,
  listDriveShareableUsers,
  listDriveTrash,
  listAllowedDriveDepartmentFolders,
  listDriveFolder,
  listMyDrive,
  listSharedWithMe,
  logDriveResumableUploadCompleted,
  moveDriveItem,
  renameDriveItem,
  restoreDriveItem,
  saveDriveRootFolderId,
  searchDriveFiles,
  shareDriveItem,
  unshareDriveItem,
} from "../services/driveService";
import { useAuth } from "../context/AuthContext";
import FileViewerModal from "../components/FileViewerModal";
import { importDocxToEditorial } from "../services/docxService";
import { canAccessEditorial } from "../utils/departmentMembership";
import { detectFileKind } from "../utils/fileTypes";

const DRIVE_VIEW_STORAGE_KEY = "nubeAesViewMode";
const DRIVE_VIEW_OPTIONS = [
  { value: "list", label: "Lista", icon: "viewList" },
  { value: "small", label: "Pequenas", icon: "viewSmall" },
  { value: "medium", label: "Medianas", icon: "viewMedium" },
  { value: "large", label: "Grandes", icon: "viewLarge" },
];

const DRIVE_SHORTCUTS_STORAGE_KEY = "nubeAesShortcuts";
const DRIVE_HIDDEN_SHORTCUTS_STORAGE_KEY = "nubeAesHiddenShortcuts";

function getStoredDriveShortcuts() {
  try {
    const raw = window.localStorage.getItem(DRIVE_SHORTCUTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getStoredHiddenShortcuts() {
  try {
    const raw = window.localStorage.getItem(DRIVE_HIDDEN_SHORTCUTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

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
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 18.5a4 4 0 0 1 .9-7.9 5.8 5.8 0 0 1 11.1 1.6A3.2 3.2 0 0 1 17.8 18.5H6z" />
      <path d="M9 15h6" />
      <path d="M12 12v6" />
    </svg>
  );
}

function ActionIcon({ name }) {
  if (name === "search") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m16 16 4 4" />
      </svg>
    );
  }

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

  if (name === "back") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" />
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

  if (name === "folder") {
    return <DriveIcon type="folder" />;
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

  if (name === "open") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    );
  }

  if (name === "share") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="8" cy="12" r="3" />
        <circle cx="17" cy="7" r="3" />
        <circle cx="17" cy="17" r="3" />
        <path d="m10.6 10.5 3.8-2" />
        <path d="m10.6 13.5 3.8 2" />
      </svg>
    );
  }

  if (name === "printer") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 8V4h10v4" />
        <rect x="6" y="14" width="12" height="7" rx="1.5" />
        <rect x="4" y="8" width="16" height="9" rx="2" />
        <circle cx="17" cy="11.5" r="1" />
      </svg>
    );
  }

  if (name === "video") {
    return <DriveIcon type="video" />;
  }

  if (name === "tool") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 5.5l4 4" />
        <path d="M4 20l6.5-6.5" />
        <path d="M12.5 3.5l8 8-2.5 2.5-8-8z" />
      </svg>
    );
  }

  if (name === "megaphone") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 13h4l10-5v11L8 14H4z" />
        <path d="m8 14 2 6" />
      </svg>
    );
  }

  if (name === "building") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 21V5l7-3 7 3v16" />
        <path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h6" />
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

function DriveUploadProgress({ upload, onCancel }) {
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
      {["preparing", "uploading"].includes(status) && onCancel ? (
        <button type="button" className="drive-upload-cancel-button" onClick={onCancel}>
          Cancelar carga
        </button>
      ) : null}
    </article>
  );
}

export default function DriveManager({ onUploadStateChange }) {
  const { isAdmin, uid: currentUid, profile } = useAuth();
  const navigate = useNavigate();
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
  const [openActionsItemId, setOpenActionsItemId] = useState("");
  const [mutatingItemId, setMutatingItemId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState("todos");
  const [searchResults, setSearchResults] = useState([]);
  const [searchActive, setSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [viewMode, setViewMode] = useState(getStoredDriveViewMode);
  const [previewFile, setPreviewFile] = useState(null);
  const [selectedDetailFile, setSelectedDetailFile] = useState(null);
  const [draggingItemId, setDraggingItemId] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState("");
  const [activeTab, setActiveTab] = useState(() => (isAdmin ? "files" : "departments"));
  const [trashActive, setTrashActive] = useState(false);
  const [trashFolderId, setTrashFolderId] = useState("");
  const [trashFiles, setTrashFiles] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashLoaded, setTrashLoaded] = useState(false);
  const [trashError, setTrashError] = useState("");
  const [activityActive, setActivityActive] = useState(false);
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityLoaded, setActivityLoaded] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [departmentFolders, setDepartmentFolders] = useState([]);
  const [customShortcuts, setCustomShortcuts] = useState(() => getStoredDriveShortcuts());
  const [hiddenShortcutIds, setHiddenShortcutIds] = useState(() => getStoredHiddenShortcuts());
  const [shortcutPickerOpen, setShortcutPickerOpen] = useState(false);
  const [shortcutWarning, setShortcutWarning] = useState("");
  const [myDriveActive, setMyDriveActive] = useState(false);
  const [sharedWithMeItems, setSharedWithMeItems] = useState([]);
  const [sharedWithMeLoading, setSharedWithMeLoading] = useState(false);
  const [sharedWithMeError, setSharedWithMeError] = useState("");
  const [shareModalItem, setShareModalItem] = useState(null);
  const [shareModalUsers, setShareModalUsers] = useState([]);
  const [shareModalUsersLoading, setShareModalUsersLoading] = useState(false);
  const [itemShares, setItemShares] = useState([]);
  const [itemSharesLoading, setItemSharesLoading] = useState(false);
  const [shareModalError, setShareModalError] = useState("");
  const [shareModalSaving, setShareModalSaving] = useState(false);
  const [renameModalItem, setRenameModalItem] = useState(null);
  const [renameModalValue, setRenameModalValue] = useState("");
  const [renameModalError, setRenameModalError] = useState("");
  const [renameModalSaving, setRenameModalSaving] = useState(false);
  const [moveModalItem, setMoveModalItem] = useState(null);
  const [moveModalFolderId, setMoveModalFolderId] = useState("");
  const [moveModalBreadcrumbs, setMoveModalBreadcrumbs] = useState([]);
  const [moveModalFolders, setMoveModalFolders] = useState([]);
  const [moveModalLoading, setMoveModalLoading] = useState(false);
  const [moveModalError, setMoveModalError] = useState("");
  const [moveModalSaving, setMoveModalSaving] = useState(false);
  const [detailActiveTab, setDetailActiveTab] = useState("details");
  const [detailActivityLogs, setDetailActivityLogs] = useState([]);
  const [detailActivityLoading, setDetailActivityLoading] = useState(false);
  const [detailActivityError, setDetailActivityError] = useState("");
  const [detailShares, setDetailShares] = useState([]);
  const [detailSharesLoading, setDetailSharesLoading] = useState(false);
  const [detailSharesError, setDetailSharesError] = useState("");
  const [error, setError] = useState("");
  const [departmentError, setDepartmentError] = useState("");
  const [departmentSuccess, setDepartmentSuccess] = useState("");
  const [storageQuota, setStorageQuota] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileInputRef = useRef(null);
  const uploadClearTimeoutRef = useRef(null);
  const uploadRequestRef = useRef(null);
  const uploadCancelledRef = useRef(false);

  const currentFolderName = breadcrumbs.at(-1)?.name || "Sin carpeta cargada";
  const folderCount = useMemo(() => files.filter(isDriveFolder).length, [files]);
  const fileCount = files.length - folderCount;
  const hasRootFolder = Boolean(rootFolderId);
  const isBusy = settingsLoading || loading;
  const isBrowserLoading = isBusy || uploadingFile || searchLoading || trashLoading || activityLoading;
  const departmentFoldersCount = departmentFolders.length;
  const canUseRootSettings = isAdmin;
  const canUseDepartmentSync = isAdmin;
  const canUseTrash = true;
  const canUseActivity = isAdmin;
  const canUseCurrentFolderActions = Boolean(currentFolderId);
  const canManageItems = !trashActive && (Boolean(currentFolderId) || searchActive);
  const canEditCurrentDriveItems = myDriveActive || breadcrumbs.some((breadcrumb) => breadcrumb.shareRole === "editor");
  const visibleFiles = searchActive ? searchResults : files;
  const browserFiles = trashActive ? trashFiles : visibleFiles;
  const browserError = activityActive ? activityError : trashActive ? trashError : error;
  const visibleEmptyMessage = trashActive
    ? "No hay archivos en tu papelera."
    : searchActive
      ? "No hay resultados para esta busqueda."
      : "Esta carpeta esta vacia.";
  const folderItems = useMemo(() => browserFiles.filter(isDriveFolder), [browserFiles]);
  const fileItems = useMemo(() => browserFiles.filter((file) => !isDriveFolder(file)), [browserFiles]);
  const quickAccessItems = useMemo(() => folderItems.slice(0, 5), [folderItems]);
  const detailFile = selectedDetailFile || fileItems[0] || folderItems[0] || null;
  const storageDisplay = useMemo(() => getStorageQuotaDisplay(storageQuota), [storageQuota]);
  const canUseEditorial = canAccessEditorial(profile, isAdmin);

  const loadPreviewFile = useCallback((file) => getCloudFileContent(file), []);

  async function handleOpenInEditorial(file, content) {
    const result = await importDocxToEditorial({
      blob: content.blob,
      sourceFile: {
        ...file,
        deliveredName: content.deliveredName,
        deliveredMimeType: content.deliveredMimeType,
        exported: content.exported,
      },
      user: profile,
    });
    navigate(`/editorial/${result.projectId}`);
  }

  const shortcutCandidates = useMemo(() => {
    const seen = new Set();
    const candidates = [];

    [...departmentFolders, ...folderItems].forEach((item) => {
      const id = item.folderId || item.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      candidates.push(item);
    });

    return candidates;
  }, [departmentFolders, folderItems]);

  const sidebarShortcutItems = (customShortcuts.length
    ? customShortcuts
    : (departmentFolders.length ? departmentFolders.slice(0, 5) : folderItems.slice(0, 5)))
    .filter((item) => !hiddenShortcutIds.includes(item.folderId || item.id));

  useEffect(() => {
    try {
      window.localStorage.setItem(DRIVE_SHORTCUTS_STORAGE_KEY, JSON.stringify(customShortcuts));
    } catch {
      // Local preference only; ignore restricted storage.
    }
  }, [customShortcuts]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRIVE_HIDDEN_SHORTCUTS_STORAGE_KEY, JSON.stringify(hiddenShortcutIds));
    } catch {
      // Local preference only; ignore restricted storage.
    }
  }, [hiddenShortcutIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRIVE_VIEW_STORAGE_KEY, viewMode);
    } catch {
      // Local preference only; ignore restricted storage.
    }
  }, [viewMode]);

  useEffect(() => {
    setDetailActiveTab("details");
    setDetailActivityLogs([]);
    setDetailActivityError("");
    setDetailShares([]);
    setDetailSharesError("");
  }, [detailFile?.id]);

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

    getDriveStorageQuota()
      .then((quota) => {
        if (isActive) {
          setStorageQuota(quota || { available: false });
        }
      })
      .catch(() => {
        if (isActive) {
          setStorageQuota({ available: false });
        }
      });

    return () => {
      isActive = false;
    };
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
        await loadFolder(savedRootFolderId, [{ id: savedRootFolderId, name: "Raíz" }]);
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
    const timeoutId = window.setTimeout(() => {
      loadDepartmentFolders();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [loadDepartmentFolders]);

  useEffect(() => {
    onUploadStateChange?.(uploadingFile);
    if (!uploadingFile) return undefined;

    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [uploadingFile, onUploadStateChange]);

  useEffect(() => {
    return () => {
      if (uploadClearTimeoutRef.current) {
        window.clearTimeout(uploadClearTimeoutRef.current);
      }
      uploadCancelledRef.current = true;
      uploadRequestRef.current?.abort();
      onUploadStateChange?.(false);
    };
  }, [onUploadStateChange]);

  function handleCancelUpload() {
    uploadCancelledRef.current = true;
    uploadRequestRef.current?.abort();
    uploadRequestRef.current = null;
    setError("");
    setUploadStatusNow({
      name: uploadStatus?.name || "Archivo",
      status: "cancelled",
      label: "Carga cancelada",
      message: "Transferencia detenida. No se registró una carga incompleta.",
      progress: uploadStatus?.progress || 0,
    });
    clearUploadStatusSoon();
  }

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
      await loadFolder(savedRootFolderId, [{ id: savedRootFolderId, name: "Raíz" }]);
    } catch (saveError) {
      setError(getDriveErrorMessage(saveError, "settings"));
    } finally {
      setSavingRoot(false);
    }
  }

  function handleOpenItem(file) {
    clearTrashView();
    clearActivityView();

    if (isDriveFolder(file)) {
      setSelectedDetailFile(null);
      clearDriveSearch();
      loadFolder(file.id, [...breadcrumbs, { id: file.id, name: file.name || "Carpeta" }]);
      return;
    }

    setSelectedDetailFile(file);
  }

  function handleOpenSharedItem(item) {
    if (isDriveFolder(item)) {
      clearTrashView();
      clearActivityView();
      clearDriveSearch();
      setActiveTab("files");
      setMyDriveActive(false);
      setSelectedDetailFile(null);
      loadFolder(item.id, [{ id: item.id, name: item.name || "Compartido", shareRole: item.shareRole || "viewer" }]);
      return;
    }

    setPreviewFile(item);
  }

  function handleBreadcrumbClick(index) {
    const breadcrumb = breadcrumbs[index];

    if (!breadcrumb || breadcrumb.id === currentFolderId) {
      return;
    }

    clearDriveSearch();
    clearTrashView();
    clearActivityView();
    loadFolder(breadcrumb.id, breadcrumbs.slice(0, index + 1));
  }

  async function handleQuickCreateFolder() {
    if (!currentFolderId) {
      setError("Carga una carpeta raiz antes de crear carpetas.");
      return;
    }

    const nextName = window.prompt("Nombre de carpeta");
    const cleanName = String(nextName || "").trim();

    if (!cleanName) {
      return;
    }

    setCreatingFolder(true);
    setError("");

    try {
      if (myDriveActive) {
        await createPrivateFolder({ name: cleanName, parentId: currentFolderId });
      } else {
        await createDriveFolder(currentFolderId, cleanName);
      }
      await loadFolder(currentFolderId, breadcrumbs);
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
    clearActivityView();
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

  function clearActivityView() {
    setActivityActive(false);
    setActivityLogs([]);
    setActivityLoading(false);
    setActivityLoaded(false);
    setActivityError("");
  }

  function handleRenameItem(item) {
    setRenameModalItem(item);
    setRenameModalValue(item?.name || "");
    setRenameModalError("");
    setOpenActionsItemId("");
  }

  function closeRenameModal() {
    setRenameModalItem(null);
    setRenameModalValue("");
    setRenameModalError("");
  }

  async function submitRenameModal(event) {
    event.preventDefault();

    const cleanName = String(renameModalValue || "").trim();
    const currentName = renameModalItem?.name || "";

    if (!cleanName) {
      setRenameModalError("Indica un nombre.");
      return;
    }

    if (!renameModalItem?.id || cleanName === currentName) {
      closeRenameModal();
      return;
    }

    setRenameModalSaving(true);
    setRenameModalError("");
    setMutatingItemId(renameModalItem.id);

    try {
      await renameDriveItem(renameModalItem.id, cleanName);
      setUploadSuccess(`Elemento renombrado: ${cleanName}`);
      closeRenameModal();
      await reloadVisibleItems();
    } catch (renameError) {
      setRenameModalError(getDriveErrorMessage(renameError, "mutation"));
    } finally {
      setRenameModalSaving(false);
      setMutatingItemId("");
    }
  }

  function getMoveRootFolders(sourceItem = moveModalItem) {
    const roots = [];
    const seen = new Set();

    function addRoot(folder) {
      const folderId = String(folder?.folderId || folder?.id || "").trim();
      if (!folderId || seen.has(folderId) || folderId === sourceItem?.id) return;

      seen.add(folderId);
      roots.push({
        id: folderId,
        name: folder.departmentName || folder.folderName || folder.name || "Carpeta",
        shareRole: folder.shareRole || "",
      });
    }

    folderItems.forEach(addRoot);
    departmentFolders.forEach(addRoot);
    customShortcuts.forEach(addRoot);
    sharedWithMeItems.filter((item) => item.shareRole === "editor").forEach(addRoot);

    return roots;
  }

  async function loadMoveModalFolder(folderId, nextBreadcrumbs, sourceItem = moveModalItem) {
    const cleanFolderId = String(folderId || "").trim();

    if (!cleanFolderId) {
      setMoveModalFolders(getMoveRootFolders(sourceItem));
      setMoveModalFolderId("");
      setMoveModalBreadcrumbs([]);
      return;
    }

    setMoveModalLoading(true);
    setMoveModalError("");

    try {
      const result = await listDriveFolder(cleanFolderId);
      const folders = (Array.isArray(result?.files) ? result.files : [])
        .filter((item) => isDriveFolder(item))
        .filter((item) => item.id !== sourceItem?.id && !isKnownDescendantOf(item, sourceItem?.id, visibleFiles));

      setMoveModalFolderId(cleanFolderId);
      setMoveModalBreadcrumbs(nextBreadcrumbs);
      setMoveModalFolders(folders);
    } catch (moveLoadError) {
      setMoveModalError(getDriveErrorMessage(moveLoadError, "drive"));
      setMoveModalFolders([]);
    } finally {
      setMoveModalLoading(false);
    }
  }

  function handleMoveItem(item) {
    setMoveModalItem(item);
    setMoveModalError("");
    setOpenActionsItemId("");

    if (currentFolderId) {
      loadMoveModalFolder(
        currentFolderId,
        breadcrumbs.length ? breadcrumbs : [{ id: currentFolderId, name: currentFolderName || "Raiz" }],
        item
      );
      return;
    }

    setMoveModalFolders(getMoveRootFolders(item));
    setMoveModalFolderId("");
    setMoveModalBreadcrumbs([]);
  }

  function closeMoveModal() {
    setMoveModalItem(null);
    setMoveModalFolderId("");
    setMoveModalBreadcrumbs([]);
    setMoveModalFolders([]);
    setMoveModalError("");
  }

  async function submitMoveModal() {
    if (!moveModalItem?.id || !moveModalFolderId) {
      setMoveModalError("Selecciona una carpeta destino.");
      return;
    }

    if (moveModalItem.id === moveModalFolderId || moveModalItem.parents?.includes(moveModalFolderId)) {
      setMoveModalError("Selecciona una carpeta diferente.");
      return;
    }

    setMoveModalSaving(true);
    setMoveModalError("");
    setMutatingItemId(moveModalItem.id);

    try {
      await moveDriveItem(moveModalItem.id, moveModalFolderId);
      setUploadSuccess(`Elemento movido: ${moveModalItem.name || "Archivo"}`);
      closeMoveModal();
      await reloadVisibleItems();
    } catch (moveError) {
      setMoveModalError(getDriveErrorMessage(moveError, "mutation"));
    } finally {
      setMoveModalSaving(false);
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
    if (folderId !== undefined) {
      return String(folderId || "").trim();
    }

    return String(folderId || trashFolderId || currentFolderId || rootFolderId || "").trim();
  }

  async function loadTrash({ force = false, folderId } = {}) {
    const cleanFolderId = resolveTrashFolderId(folderId);

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
    clearActivityView();
    await loadTrash({ force: true, folderId: isAdmin ? rootFolderId || currentFolderId : "" });
  }

  function handleCloseTrash() {
    clearTrashView();
    setError("");
  }

  async function loadActivity({ force = false } = {}) {
    if (!force && activityActive && activityLoaded) {
      return true;
    }

    setActiveTab("files");
    clearDriveSearch();
    clearTrashView();
    setActivityActive(true);
    setActivityLogs([]);
    setActivityLoaded(false);
    setActivityLoading(true);
    setActivityError("");
    setError("");
    setUploadSuccess("");
    setOpenActionsItemId("");

    try {
      const result = await listDriveActivityLogs({ limitCount: 50 });
      setActivityLogs(Array.isArray(result?.logs) ? result.logs : []);
      setActivityLoaded(true);
      return true;
    } catch (activityLoadError) {
      setActivityLogs([]);
      setActivityLoaded(true);
      setActivityError(getDriveErrorMessage(activityLoadError, "activity"));
      return false;
    } finally {
      setActivityLoading(false);
    }
  }

  async function handleOpenActivity() {
    await loadActivity({ force: true });
  }

  function handleCloseActivity() {
    clearActivityView();
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
      await loadTrash({ force: true, folderId: isAdmin ? trashFolderId || rootFolderId || currentFolderId : "" });

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
    uploadCancelledRef.current = false;
    setError("");
    setUploadSuccess("");
    setUploadStatusNow({
      name: file.name,
      status: "preparing",
      label: "Preparando...",
      message: "La subida puede tardar segun tu conexion.",
      progress: 0,
    });
    let uploadStartedAt = getTimestampMs();

    try {
      const mimeType = file.type || "application/octet-stream";
      const session = await createDriveResumableUpload({
        folderId: currentFolderId,
        name: file.name,
        mimeType,
        size: file.size,
      });

      if (uploadCancelledRef.current) {
        const cancelledError = new Error("La subida fue cancelada.");
        cancelledError.code = "upload-cancelled";
        throw cancelledError;
      }

      setUploadStatusNow({
        name: file.name,
        status: "uploading",
        label: "Subiendo...",
        message: "La subida puede tardar segun tu conexion.",
        progress: 0,
      });
      uploadStartedAt = getTimestampMs();

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
        onRequest: (request) => {
          uploadRequestRef.current = request;
        },
      });
      uploadRequestRef.current = null;

      if (uploadCancelledRef.current) {
        const cancelledError = new Error("La subida fue cancelada.");
        cancelledError.code = "upload-cancelled";
        throw cancelledError;
      }

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
      await recordUploadCompleted({
        file,
        fileId: uploadResult?.id,
        mimeType,
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
      if (uploadError?.code === "upload-cancelled") {
        setError("");
        setUploadStatusNow({
          name: file.name,
          status: "cancelled",
          label: "Carga cancelada",
          message: "Transferencia detenida.",
          progress: getUploadErrorProgress(uploadError),
        });
        clearUploadStatusSoon();
        return;
      }

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
            await recordUploadCompleted({
              file,
              mimeType: file.type || "application/octet-stream",
            });
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
      uploadRequestRef.current = null;
      setUploadingFile(false);
      event.target.value = "";
    }
  }

  async function reloadFolderAfterUpload(fileTarget) {
    const target = normalizeUploadTarget(fileTarget);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (uploadCancelledRef.current) {
        const cancelledError = new Error("La subida fue cancelada.");
        cancelledError.code = "upload-cancelled";
        throw cancelledError;
      }
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

  async function recordUploadCompleted({ file, fileId = "", mimeType }) {
    try {
      await logDriveResumableUploadCompleted({
        folderId: currentFolderId,
        fileId,
        name: file.name,
        mimeType: mimeType || file.type || "application/octet-stream",
        size: file.size,
      });
    } catch {
      // Activity log should not block a completed Drive upload.
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
    clearTrashView();
    clearActivityView();
    setActiveTab("departments");
    setMyDriveActive(false);
    setDepartmentSuccess("");

    if (!departmentFolders.length) {
      loadDepartmentFolders();
    }
  }

  async function handleOpenSharedView() {
    clearTrashView();
    clearActivityView();
    clearDriveSearch();
    setActiveTab("shared");
    setMyDriveActive(false);
    setDepartmentSuccess("");
    setSelectedDetailFile(null);
    setSharedWithMeLoading(true);
    setSharedWithMeError("");

    try {
      const result = await listSharedWithMe();
      setSharedWithMeItems(Array.isArray(result?.items) ? result.items : []);
    } catch (sharedError) {
      setSharedWithMeError(getDriveErrorMessage(sharedError, "shared"));
      setSharedWithMeItems([]);
    } finally {
      setSharedWithMeLoading(false);
    }
  }

  async function handleOpenMyDrive() {
    setActiveTab("files");
    clearTrashView();
    clearActivityView();
    clearDriveSearch();
    setMyDriveActive(true);
    setSharedWithMeError("");
    setSharedWithMeItems([]);
    setSelectedDetailFile(null);
    setPreviewFile(null);
    setOpenActionsItemId("");
    setDepartmentSuccess("");
    setError("");
    setFiles([]);
    setCurrentFolderId("");
    setBreadcrumbs([{ id: rootFolderId || "my-drive-root", name: "Raíz" }]);

    try {
      if (rootFolderId) {
        await loadFolder(rootFolderId, [{ id: rootFolderId, name: "Raíz" }], { force: true });
        return;
      }

      setLoading(true);
      const result = await listMyDrive();
      const folderId = result?.folderId || "";
      setCurrentFolderId(folderId);
      setBreadcrumbs([{ id: folderId, name: "Raíz" }]);
      setFiles(Array.isArray(result?.files) ? result.files : []);
    } catch (myDriveError) {
      setError(getDriveErrorMessage(myDriveError, "drive"));
      setFiles([]);
      setCurrentFolderId("");
      setBreadcrumbs([]);
    } finally {
      setLoading(false);
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
    clearActivityView();
    setDepartmentError("");
    clearDriveSearch();
    setMyDriveActive(false);
    loadFolder(folderId, [
      ...(rootFolderId ? [{ id: rootFolderId, name: "Raíz" }] : []),
      { id: folderId, name: folder.departmentName || folder.folderName || "Departamento" },
    ]);
  }

  async function handleOpenShareModal(item) {
    setShareModalItem(item);
    setShareModalError("");
    setItemSharesLoading(true);

    if (!shareModalUsers.length) {
      setShareModalUsersLoading(true);
      try {
        const result = await listDriveShareableUsers();
        const users = Array.isArray(result?.users) ? result.users : [];
        setShareModalUsers(users.filter((user) => user.uid !== currentUid));
      } catch {
        setShareModalError("No se pudieron cargar los colaboradores.");
      } finally {
        setShareModalUsersLoading(false);
      }
    }

    try {
      const result = await listDriveItemShares(item.id);
      setItemShares(Array.isArray(result?.shares) ? result.shares : []);
    } catch (sharesError) {
      setShareModalError(getDriveErrorMessage(sharesError, "share"));
      setItemShares([]);
    } finally {
      setItemSharesLoading(false);
    }
  }

  function handleCloseShareModal() {
    setShareModalItem(null);
    setItemShares([]);
    setShareModalError("");
  }

  async function handleShareSubmit(sharedWithUid, role) {
    if (!shareModalItem?.id || !sharedWithUid) return;

    setShareModalSaving(true);
    setShareModalError("");

    try {
      await shareDriveItem({ fileId: shareModalItem.id, sharedWithUid, role });
      const result = await listDriveItemShares(shareModalItem.id);
      setItemShares(Array.isArray(result?.shares) ? result.shares : []);
    } catch (shareError) {
      setShareModalError(getDriveErrorMessage(shareError, "share"));
    } finally {
      setShareModalSaving(false);
    }
  }

  async function handleRemoveShare(sharedWithUid) {
    if (!shareModalItem?.id || !sharedWithUid) return;

    setShareModalSaving(true);
    setShareModalError("");

    try {
      await unshareDriveItem({ fileId: shareModalItem.id, sharedWithUid });
      setItemShares((current) => current.filter((share) => share.sharedWithUid !== sharedWithUid));
    } catch (unshareError) {
      setShareModalError(getDriveErrorMessage(unshareError, "share"));
    } finally {
      setShareModalSaving(false);
    }
  }

  function handleAddShortcut(item) {
    const id = item.folderId || item.id;
    if (!id) return;

    const alreadyExists = sidebarShortcutItems.some((shortcut) => (shortcut.folderId || shortcut.id) === id);
    if (alreadyExists) {
      setShortcutWarning("Ese acceso directo ya esta agregado.");
      return;
    }

    setCustomShortcuts((current) => [
      ...current,
      {
        id,
        folderId: item.folderId || item.id,
        departmentName: item.departmentName || null,
        folderName: item.folderName || item.name || "Carpeta",
      },
    ]);
    setHiddenShortcutIds((current) => current.filter((hiddenId) => hiddenId !== id));
    setShortcutWarning("");
    setShortcutPickerOpen(false);
  }

  function handleRemoveShortcut(event, shortcutId) {
    event?.stopPropagation();
    event?.preventDefault();

    if (!shortcutId) {
      return;
    }

    const confirmed = window.confirm("Quitar este acceso directo? La carpeta real no se eliminara.");

    if (!confirmed) {
      return;
    }

    setCustomShortcuts((current) => current.filter((item) => (item.folderId || item.id) !== shortcutId));
    setHiddenShortcutIds((current) => (current.includes(shortcutId) ? current : [...current, shortcutId]));
    setShortcutWarning("");
  }

  async function handleDetailTabChange(tab) {
    setDetailActiveTab(tab);

    if (!detailFile?.id) {
      return;
    }

    if (tab === "activity") {
      setDetailActivityLoading(true);
      setDetailActivityError("");

      try {
        const result = await listDriveActivityLogs({ limitCount: 25, fileId: detailFile.id });
        setDetailActivityLogs(Array.isArray(result?.logs) ? result.logs : []);
      } catch (activityError) {
        setDetailActivityError(getDriveErrorMessage(activityError, "activity"));
        setDetailActivityLogs([]);
      } finally {
        setDetailActivityLoading(false);
      }
    }

    if (tab === "shares") {
      setDetailSharesLoading(true);
      setDetailSharesError("");

      try {
        const result = await listDriveItemShares(detailFile.id);
        setDetailShares(Array.isArray(result?.shares) ? result.shares : []);
      } catch (sharesError) {
        setDetailSharesError(getDriveErrorMessage(sharesError, "shared"));
        setDetailShares([]);
      } finally {
        setDetailSharesLoading(false);
      }
    }
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
    <div className="visual-page drive-manager-page drive-cloud-page">
      <section className="printshop-topbar drive-cloud-topbar">
        <div className="printshop-topbar-main">
          <span className="printshop-topbar-module-icon">
            <DriveModuleIcon />
          </span>
          <div className="printshop-topbar-copy">
            <p className="printshop-kicker">NUBE AES</p>
            <h1>Nube AES</h1>
            <p>{isAdmin ? "Explora, organiza y previsualiza archivos conectados a Google Drive." : "Accede y organiza archivos de tus departamentos asignados."}</p>
          </div>
        </div>

        <div className="drive-cloud-kpis">
          <article>
            <span>Carpetas</span>
            <strong>{folderCount}</strong>
          </article>
          <article>
            <span>Archivos</span>
            <strong>{fileCount}</strong>
          </article>
          <article>
            <span>Compartidos</span>
            <strong>{departmentFoldersCount || 0}</strong>
          </article>
          <article className="wide">
            <span>Almacenamiento</span>
            <strong>{storageDisplay.label}</strong>
            {storageDisplay.hasLimit ? (
              <i><b style={{ width: `${storageDisplay.percent}%` }} /></i>
            ) : null}
          </article>
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
        <section className="drive-cloud-toolbar">
          <form className="drive-cloud-search" onSubmit={handleSearchFiles}>
            <ActionIcon name="search" />
            <input
              id="drive-search-query"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar en Nube AES..."
              autoComplete="off"
              disabled={isBrowserLoading}
            />
            <kbd>Ctrl K</kbd>
          </form>

          <div className="drive-cloud-chips" role="group" aria-label="Filtros de Nube AES">
            {[
              ["todos", "Todos"],
              ["carpetas", "Carpetas"],
              ["documentos", "Archivos"],
            ].map(([value, label]) => (
              <button
                key={`${label}-${value}`}
                className={searchType === value && !trashActive && !activityActive ? "active" : ""}
                type="button"
                onClick={() => setSearchType(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="drive-cloud-actions">
            <button
              className="visual-outline-button drive-icon-button"
              type="button"
              onClick={handleQuickCreateFolder}
              disabled={!canUseCurrentFolderActions || creatingFolder || isBusy}
            >
              <ActionIcon name="add" />
              <span>Nueva carpeta</span>
            </button>

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
              <span>Subir</span>
            </button>
          </div>

          <div className="drive-cloud-view-switcher" role="group" aria-label="Selector de vista">
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

      <section className="drive-cloud-shell">
        <aside className="drive-cloud-sidebar">
          <button className={!trashActive && !activityActive && activeTab === "files" && myDriveActive ? "active" : ""} type="button" onClick={handleOpenMyDrive}>
            <ActionIcon name="viewSmall" />
            <span>Mi unidad</span>
          </button>
          <button className={activeTab === "departments" ? "active" : ""} type="button" onClick={handleOpenDepartmentsTab}>
            <ActionIcon name="folder" />
            <span>Departamentos</span>
          </button>
          <button className={activeTab === "shared" ? "active" : ""} type="button" onClick={handleOpenSharedView}>
            <ActionIcon name="viewList" />
            <span>Compartidos conmigo</span>
          </button>
          {canUseTrash ? (
            <button className={trashActive ? "active" : ""} type="button" onClick={handleOpenTrash}>
              <ActionIcon name="trash" />
              <span>Papelera</span>
            </button>
          ) : null}
          {canUseActivity ? (
            <button className={activityActive ? "active" : ""} type="button" onClick={handleOpenActivity}>
              <ActionIcon name="load" />
              <span>Actividad</span>
            </button>
          ) : null}

          <div className="drive-cloud-shortcuts">
            <div className="drive-shortcuts-header">
              <span>Accesos directos</span>
              <button type="button" aria-label="Agregar acceso" onClick={() => { setShortcutWarning(""); setShortcutPickerOpen(true); }}>+</button>
            </div>
            {sidebarShortcutItems.map((item) => (
              <div className="drive-shortcut-row" key={item.id || item.folderId}>
                <button
                  className="drive-shortcut-open"
                  type="button"
                  onClick={() => item.folderId ? handleOpenDepartmentFolder(item) : handleOpenItem(item)}
                >
                  <span className={`drive-shortcut-icon ${getShortcutIconTone(item)}`}>
                    <ActionIcon name={getShortcutIconName(item)} />
                  </span>
                  <span>{item.departmentName || item.folderName || item.name || "Carpeta"}</span>
                </button>
                <button
                  className="drive-shortcut-remove"
                  type="button"
                  onClick={(event) => handleRemoveShortcut(event, item.folderId || item.id)}
                  aria-label={`Quitar acceso ${item.departmentName || item.folderName || item.name || "Carpeta"}`}
                  title="Quitar acceso"
                >
                  <span aria-hidden="true">x</span>
                </button>
              </div>
            ))}
          </div>

          <div className="drive-cloud-storage">
            <span>Almacenamiento</span>
            <strong>{storageDisplay.hasUsage ? storageDisplay.label : storageDisplay.helper}</strong>
            {storageDisplay.hasUsage ? (
              <i><b style={{ width: `${storageDisplay.percent}%` }} /></i>
            ) : null}
            <button type="button" onClick={() => setConfigOpen((current) => !current)}>
              Administrar almacenamiento
            </button>
          </div>
        </aside>

        <main className="drive-cloud-main">
          <div className="drive-cloud-breadcrumbs">
            <nav aria-label="Ruta de Google Drive">
              {activityActive || trashActive || activeTab === "shared" ? (
                <>
                  <button type="button" onClick={activeTab === "shared" ? handleOpenMyDrive : activityActive ? handleCloseActivity : handleCloseTrash}>Mi unidad</button>
                  <span>/</span>
                  <strong>{activityActive ? "Actividad" : trashActive ? "Papelera" : "Compartidos conmigo"}</strong>
                </>
              ) : breadcrumbs.length === 0 ? (
                <strong>Raíz</strong>
              ) : (
                breadcrumbs.map((breadcrumb, index) => (
                  <button
                    key={`${breadcrumb.id}-${index}`}
                    type="button"
                    onClick={() => handleBreadcrumbClick(index)}
                    disabled={breadcrumb.id === currentFolderId}
                  >
                    {breadcrumb.name}
                  </button>
                ))
              )}
            </nav>
            <button className="drive-kebab" type="button" onClick={activityActive ? () => loadActivity({ force: true }) : trashActive ? () => loadTrash({ force: true }) : reloadVisibleItems}>
              <ActionIcon name="more" />
            </button>
          </div>

          {browserError ? <div className="drive-error-box">{browserError}</div> : null}
          {uploadSuccess ? <div className="drive-success-box">{uploadSuccess}</div> : null}
          {uploadStatus ? <DriveUploadProgress upload={uploadStatus} onCancel={handleCancelUpload} /> : null}

          {isBrowserLoading ? (
            <div className={`drive-skeleton-grid view-${viewMode}`} aria-label="Cargando contenido">
              {Array.from({ length: viewMode === "list" ? 5 : 8 }).map((_, index) => (
                <span className="drive-skeleton-card" key={`drive-skeleton-${index}`} />
              ))}
            </div>
          ) : null}

          {!isBrowserLoading && activityActive && activityLogs.length > 0 ? (
            <div className="drive-activity-list">
              {activityLogs.map((log) => (
                <article className="drive-activity-item" key={log.id}>
                  <span className="drive-activity-icon"><ActionIcon name="load" /></span>
                  <div>
                    <strong>{getDriveActivityLabel(log.action)}</strong>
                    <p>{getDriveActivitySummary(log)}</p>
                    <small>{log.userName || log.userEmail || "Usuario"} - {formatActivityDate(log.createdAt) || "Sin fecha"}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {!isBrowserLoading && !activityActive && activeTab === "departments" ? (
            <section className="drive-folder-section">
              <div className="drive-section-heading">
                <h3>Departamentos</h3>
                {canUseDepartmentSync ? (
                  <button type="button" onClick={handleSyncDepartmentFolders} disabled={syncingDepartments || departmentFoldersLoading}>
                    {syncingDepartments ? "Sincronizando" : "Sincronizar"}
                  </button>
                ) : null}
              </div>
              {departmentError ? <div className="drive-error-box">{departmentError}</div> : null}
              {departmentSuccess ? <div className="drive-success-box">{departmentSuccess}</div> : null}
              {departmentFoldersLoading ? (
                <div className="drive-skeleton-grid view-small" aria-label="Cargando departamentos">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <span className="drive-skeleton-card" key={`department-skeleton-${index}`} />
                  ))}
                </div>
              ) : (
                <div className="drive-department-grid">
                  {departmentFolders.map((folder) => (
                    <article className="drive-folder-tile" key={folder.departmentId || folder.id}>
                      <span className="drive-folder-art"><DriveIcon type="folder" /></span>
                      <div>
                        <strong>{folder.departmentName || "Departamento"}</strong>
                        <small>{folder.folderName || "Carpeta de Drive"}</small>
                      </div>
                      <button type="button" onClick={() => handleOpenDepartmentFolder(folder)} disabled={!folder.folderId || loading}>
                        <ActionIcon name="open" />
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {!isBrowserLoading && !activityActive && activeTab === "shared" ? (
            <section className="drive-folder-section">
              <div className="drive-section-heading">
                <h3>Compartidos conmigo</h3>
                <button type="button" onClick={handleOpenSharedView} disabled={sharedWithMeLoading}>
                  {sharedWithMeLoading ? "Cargando" : "Recargar"}
                </button>
              </div>
              {sharedWithMeError ? <div className="drive-error-box">{sharedWithMeError}</div> : null}
              {sharedWithMeLoading ? (
                <div className="drive-skeleton-grid view-small" aria-label="Cargando compartidos">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <span className="drive-skeleton-card" key={`shared-skeleton-${index}`} />
                  ))}
                </div>
              ) : sharedWithMeItems.length > 0 ? (
                <div className="drive-department-grid">
                  {sharedWithMeItems.map((item) => (
                    <article className="drive-folder-tile" key={item.id}>
                      <span className="drive-folder-art"><DriveIcon type={getDriveItemType(item)} /></span>
                      <div>
                        <strong>{item.name || "Elemento compartido"}</strong>
                        <small>{item.shareRole === "editor" ? "Puedes editar" : "Solo puedes ver"}</small>
                      </div>
                      <button type="button" onClick={() => handleOpenSharedItem(item)}>
                        <ActionIcon name="open" />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state drive-empty-state">
                  <div><DriveIcon type="folder" /></div>
                  <p>No hay archivos compartidos contigo.</p>
                </div>
              )}
            </section>
          ) : null}

          {!isBrowserLoading && !activityActive && activeTab === "files" && !trashActive && browserFiles.length > 0 ? (
            <>
              <section className="drive-quick-section">
                <h3>Acceso rapido</h3>
                <div className="drive-quick-grid">
                  {(quickAccessItems.length ? quickAccessItems : folderItems.slice(0, 5)).map((folder) => (
                    <button className="drive-quick-card" key={folder.id} type="button" onClick={() => handleOpenItem(folder)}>
                      <span className="drive-folder-art"><DriveIcon type="folder" /></span>
                      <div>
                        <strong>{folder.name || "Carpeta"}</strong>
                        <small>{getFileMeta(folder)}</small>
                      </div>
                      <ActionIcon name="more" />
                    </button>
                  ))}
                </div>
              </section>

              <section className="drive-folder-section">
                <div className="drive-section-heading">
                  <h3>Carpetas</h3>
                  <button type="button">Mas reciente</button>
                </div>
                <div className="drive-folder-grid">
                  {folderItems.map((folder) => (
                    <article
                      className={`drive-folder-tile ${dragOverFolderId === folder.id && canDropOnFolder(folder) ? "is-drop-target" : ""}`}
                      key={folder.id}
                      draggable={!mutatingItemId}
                      onDragStart={(event) => handleDragStart(event, folder)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(event) => handleFolderDragOver(event, folder)}
                      onDragLeave={(event) => handleFolderDragLeave(event, folder)}
                      onDrop={(event) => handleFolderDrop(event, folder)}
                    >
                      <button className="drive-folder-open-button" type="button" onClick={() => handleOpenItem(folder)}>
                        <span className="drive-folder-art"><DriveIcon type="folder" /></span>
                        <div>
                          <strong>{folder.name || "Carpeta"}</strong>
                          <small>{getFileMeta(folder)}</small>
                        </div>
                      </button>
                      {canManageItems && canEditCurrentDriveItems ? (
                        <>
                          <button
                            className="drive-folder-action-button"
                            type="button"
                            onClick={() => setOpenActionsItemId((current) => (current === folder.id ? "" : folder.id))}
                            aria-label={`Acciones de ${folder.name || "carpeta"}`}
                          >
                            <ActionIcon name="more" />
                          </button>
                          {openActionsItemId === folder.id ? (
                            <div className="drive-table-menu">
                              <button type="button" onClick={() => handleOpenItem(folder)}>Abrir</button>
                              {myDriveActive ? (
                                <button type="button" onClick={() => handleOpenShareModal(folder)}>Compartir</button>
                              ) : null}
                              <button type="button" onClick={() => handleRenameItem(folder)}>Renombrar</button>
                              <button type="button" onClick={() => handleMoveItem(folder)}>Mover</button>
                              <button type="button" onClick={() => handleDeleteItem(folder)}>Eliminar</button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>

              <section className="drive-recent-section">
                <h3>Archivos</h3>
                <div className="drive-recent-table">
                  <div className="drive-recent-head">
                    <span>Nombre</span>
                    <span>Propietario</span>
                    <span>Ultima modificacion</span>
                    <span>Tamano</span>
                    <span />
                  </div>
                  {fileItems.map((file) => (
                    <article
                      className={selectedDetailFile?.id === file.id ? "active" : ""}
                      key={file.id}
                      draggable={!mutatingItemId}
                      onDoubleClick={() => setPreviewFile(file)}
                      onDragStart={(event) => handleDragStart(event, file)}
                      onDragEnd={handleDragEnd}
                    >
                      <button type="button" onClick={() => setSelectedDetailFile(file)}>
                        <span className={`drive-file-mini ${getDriveItemType(file)}`}><DriveIcon type={getDriveItemType(file)} /></span>
                        <strong title={file.name || "Archivo"}>{file.name || "Archivo sin nombre"}</strong>
                      </button>
                      <span>{file.ownerName || "Nube AES"}</span>
                      <span>{formatDate(file.modifiedTime) || "Sin fecha"}</span>
                      <span>{file.size ? formatBytes(Number(file.size)) : "-"}</span>
                      {canManageItems ? (
                        <button type="button" onClick={() => setOpenActionsItemId((current) => (current === file.id ? "" : file.id))}>
                          <ActionIcon name="more" />
                        </button>
                      ) : (
                        <span />
                      )}
                      {canManageItems && openActionsItemId === file.id ? (
                        <div className="drive-table-menu">
                          <button type="button" onClick={() => setPreviewFile(file)}>Abrir</button>
                          <button type="button" onClick={() => setSelectedDetailFile(file)}>Detalles</button>
                          <button type="button" onClick={() => setPreviewFile(file)}>Vista previa</button>
                          {myDriveActive ? (
                            <button type="button" onClick={() => handleOpenShareModal(file)}>Compartir</button>
                          ) : null}
                          <button type="button" onClick={() => handleRenameItem(file)}>Renombrar</button>
                          <button type="button" onClick={() => handleMoveItem(file)}>Mover</button>
                          <button type="button" onClick={() => handleDeleteItem(file)}>Eliminar</button>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {!isBrowserLoading && trashActive && trashFiles.length > 0 ? (
            <div className={`drive-file-grid view-${viewMode}`}>
              {trashFiles.map((file) => renderTrashItem(file))}
            </div>
          ) : null}

          {!isBrowserLoading && !browserError && (activityActive ? activityLoaded && activityLogs.length === 0 : trashActive ? trashLoaded && trashFiles.length === 0 : activeTab === "files" && browserFiles.length === 0) ? (
            <div className="empty-state drive-empty-state">
              <div><DriveIcon type={trashActive ? "folder" : "file"} /></div>
              <p>{activityActive ? "No hay actividad registrada." : visibleEmptyMessage}</p>
            </div>
          ) : null}
        </main>

        <aside className="drive-cloud-details">
          <header>
            <strong>{detailFile?.name || "Selecciona un archivo"}</strong>
            <button type="button" onClick={() => setSelectedDetailFile(null)}><ActionIcon name="close" /></button>
          </header>
          <nav>
            <button className={detailActiveTab === "details" ? "active" : ""} type="button" onClick={() => handleDetailTabChange("details")}>Detalles</button>
            <button className={detailActiveTab === "activity" ? "active" : ""} type="button" onClick={() => handleDetailTabChange("activity")}>Actividad</button>
            <button className={detailActiveTab === "shares" ? "active" : ""} type="button" onClick={() => handleDetailTabChange("shares")}>Compartidos</button>
          </nav>
          <div className="drive-detail-preview">
            {detailFile?.thumbnailLink ? (
              <img src={detailFile.thumbnailLink} alt="" />
            ) : (
              <DriveIcon type={getDriveItemType(detailFile)} />
            )}
            {detailFile && !isDriveFolder(detailFile) ? (
              <button type="button" onClick={() => setPreviewFile(detailFile)}>
                <ActionIcon name="open" />
              </button>
            ) : null}
          </div>
          {detailActiveTab === "details" ? (
            <>
              <section>
                <h4>Informacion general</h4>
                <dl>
                  <div><dt>Tipo</dt><dd>{formatMimeType(detailFile?.mimeType)}</dd></div>
                  <div><dt>Tamano</dt><dd>{detailFile?.size ? formatBytes(Number(detailFile.size)) : "-"}</dd></div>
                  <div><dt>Ubicacion</dt><dd>{currentFolderName}</dd></div>
                  <div><dt>Propietario</dt><dd>{detailFile?.ownerName || "Nube AES"}</dd></div>
                  <div><dt>Modificado</dt><dd>{formatDate(detailFile?.modifiedTime) || "-"}</dd></div>
                </dl>
              </section>
              <section>
                <h4>Etiquetas</h4>
                <div className="drive-detail-tags">
                  <span>Drive</span>
                  <span>Nube AES</span>
                  <span>{formatMimeType(detailFile?.mimeType)}</span>
                </div>
              </section>
            </>
          ) : null}
          {detailActiveTab === "activity" ? (
            <section>
              <h4>Actividad</h4>
              {detailActivityError ? <div className="drive-error-box">{detailActivityError}</div> : null}
              {detailActivityLoading ? (
                <p className="drive-shortcut-picker-empty">Cargando...</p>
              ) : detailActivityLogs.length ? (
                <div className="drive-activity-list compact">
                  {detailActivityLogs.map((log) => (
                    <article className="drive-activity-item" key={log.id}>
                      <span className="drive-activity-icon"><ActionIcon name="load" /></span>
                      <div>
                        <strong>{getDriveActivityLabel(log.action)}</strong>
                        <p>{getDriveActivitySummary(log)}</p>
                        <small>{log.userName || log.userEmail || "Usuario"} - {formatActivityDate(log.createdAt) || "Sin fecha"}</small>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="drive-shortcut-picker-empty">No hay actividad para este elemento.</p>
              )}
            </section>
          ) : null}
          {detailActiveTab === "shares" ? (
            <section>
              <h4>Compartidos</h4>
              {detailSharesError ? <div className="drive-error-box">{detailSharesError}</div> : null}
              {detailSharesLoading ? (
                <p className="drive-shortcut-picker-empty">Cargando...</p>
              ) : detailShares.length ? (
                <ul className="drive-share-chip-list">
                  {detailShares.map((share) => (
                    <li key={share.sharedWithUid} className="drive-share-chip">
                      <span>{share.sharedWithEmail || share.sharedWithUid}</span>
                      <em>{share.role === "editor" ? "Editor" : "Viewer"}</em>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="drive-shortcut-picker-empty">No hay usuarios con acceso compartido.</p>
              )}
            </section>
          ) : null}
          {detailFile && !isDriveFolder(detailFile) ? (
            <button className="drive-share-button" type="button" onClick={() => setPreviewFile(detailFile)}>
              <ActionIcon name="share" />
              <span>Abrir archivo</span>
            </button>
          ) : (
            <button className="drive-share-button" type="button" disabled>
              <ActionIcon name="share" />
              <span>Abrir en Drive</span>
            </button>
          )}
        </aside>
      </section>

      {previewFile ? (
        <FileViewerModal
          key={previewFile.id}
          file={previewFile}
          loadFile={loadPreviewFile}
          canOpenEditorial={canUseEditorial}
          onOpenEditorial={handleOpenInEditorial}
          onClose={() => setPreviewFile(null)}
        />
      ) : null}

      {shortcutPickerOpen ? (
        <ShortcutPickerModal
          candidates={shortcutCandidates}
          existingItems={customShortcuts}
          warning={shortcutWarning}
          onPick={handleAddShortcut}
          onClose={() => setShortcutPickerOpen(false)}
        />
      ) : null}

      {renameModalItem ? (
        <RenameItemModal
          item={renameModalItem}
          value={renameModalValue}
          error={renameModalError}
          saving={renameModalSaving}
          onValueChange={setRenameModalValue}
          onSubmit={submitRenameModal}
          onClose={closeRenameModal}
        />
      ) : null}

      {moveModalItem ? (
        <MoveItemModal
          item={moveModalItem}
          currentFolderId={moveModalFolderId}
          breadcrumbs={moveModalBreadcrumbs}
          folders={moveModalFolders}
          loading={moveModalLoading}
          error={moveModalError}
          saving={moveModalSaving}
          onOpenFolder={(folder) =>
            loadMoveModalFolder(folder.id || folder.folderId, [
              ...moveModalBreadcrumbs,
              { id: folder.id || folder.folderId, name: folder.name || folder.folderName || "Carpeta", shareRole: folder.shareRole || "" },
            ])
          }
          onBack={() => {
            const nextBreadcrumbs = moveModalBreadcrumbs.slice(0, -1);
            const parent = nextBreadcrumbs.at(-1);
            if (parent?.id) {
              loadMoveModalFolder(parent.id, nextBreadcrumbs);
            } else {
              loadMoveModalFolder("", []);
            }
          }}
          onMoveHere={submitMoveModal}
          onClose={closeMoveModal}
        />
      ) : null}

      {shareModalItem ? (
        <ShareModal
          item={shareModalItem}
          users={shareModalUsers}
          usersLoading={shareModalUsersLoading}
          shares={itemShares}
          sharesLoading={itemSharesLoading}
          error={shareModalError}
          saving={shareModalSaving}
          onShare={handleShareSubmit}
          onUnshare={handleRemoveShare}
          onClose={handleCloseShareModal}
        />
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
          placeholder="Ej. 1AbCDEF..."
        />
        <button type="submit" disabled={savingRoot}>
          {savingRoot ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}
function ShortcutPickerModal({ candidates, existingItems, warning, onPick, onClose }) {
  const existingIds = useMemo(
    () => new Set(existingItems.map((item) => item.folderId || item.id)),
    [existingItems]
  );

  return (
    <div className="drive-preview-backdrop" role="dialog" aria-modal="true" aria-label="Agregar acceso directo">
      <div className="drive-preview-modal drive-shortcut-picker-modal">
        <header className="drive-preview-header">
          <div>
            <span>Accesos directos</span>
            <strong>Agregar acceso directo</strong>
          </div>

          <button
            className="drive-preview-close"
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <ActionIcon name="close" />
          </button>
        </header>

        <div className="drive-preview-body drive-shortcut-picker-body">
          {warning ? <div className="drive-error-box">{warning}</div> : null}

          {candidates.length === 0 ? (
            <p className="drive-shortcut-picker-empty">No hay carpetas o departamentos disponibles todavia.</p>
          ) : (
            <ul className="drive-shortcut-picker-list">
              {candidates.map((item) => {
                const id = item.folderId || item.id;
                const label = item.departmentName || item.folderName || item.name || "Carpeta";
                const alreadyAdded = existingIds.has(id);

                return (
                  <li key={id}>
                    <button
                      type="button"
                      disabled={alreadyAdded}
                      onClick={() => onPick(item)}
                    >
                      <span className={`drive-shortcut-icon ${getShortcutIconTone(item)}`}>
                        <ActionIcon name={getShortcutIconName(item)} />
                      </span>
                      <span>{label}</span>
                      {alreadyAdded ? <em>Ya agregado</em> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function RenameItemModal({ item, value, error, saving, onValueChange, onSubmit, onClose }) {
  return (
    <div className="drive-preview-backdrop" role="dialog" aria-modal="true" aria-label="Renombrar elemento">
      <div className="drive-preview-modal drive-shortcut-picker-modal drive-action-modal">
        <header className="drive-preview-header">
          <div>
            <span>Renombrar</span>
            <strong title={item?.name}>{item?.name || "Elemento"}</strong>
          </div>
          <button className="drive-preview-close" type="button" onClick={onClose} aria-label="Cerrar" disabled={saving}>
            <ActionIcon name="close" />
          </button>
        </header>

        <form className="drive-preview-body drive-action-form" onSubmit={onSubmit}>
          {error ? <div className="drive-error-box">{error}</div> : null}
          <label>
            <span>Nombre</span>
            <input
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              autoFocus
              disabled={saving}
            />
          </label>
          <div className="drive-action-modal-actions">
            <button type="button" className="visual-outline-button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="visual-primary-button" disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MoveItemModal({
  item,
  currentFolderId,
  breadcrumbs,
  folders,
  loading,
  error,
  saving,
  onOpenFolder,
  onBack,
  onMoveHere,
  onClose,
}) {
  const currentName = breadcrumbs.at(-1)?.name || "Ubicaciones";
  const isSameParent = Array.isArray(item?.parents) && item.parents.includes(currentFolderId);

  return (
    <div className="drive-preview-backdrop" role="dialog" aria-modal="true" aria-label="Mover elemento">
      <div className="drive-preview-modal drive-shortcut-picker-modal drive-action-modal">
        <header className="drive-preview-header">
          <div>
            <span>Mover a...</span>
            <strong title={item?.name}>{item?.name || "Elemento"}</strong>
          </div>
          <button className="drive-preview-close" type="button" onClick={onClose} aria-label="Cerrar" disabled={saving}>
            <ActionIcon name="close" />
          </button>
        </header>

        <div className="drive-preview-body drive-action-form">
          {error ? <div className="drive-error-box">{error}</div> : null}

          <div className="drive-move-modal-path">
            <button type="button" onClick={onBack} disabled={loading || saving || breadcrumbs.length === 0}>
              <ActionIcon name="back" />
            </button>
            <strong title={currentName}>{currentName}</strong>
          </div>

          {loading ? (
            <p className="drive-shortcut-picker-empty">Cargando carpetas...</p>
          ) : folders.length ? (
            <ul className="drive-move-folder-list">
              {folders.map((folder) => (
                <li key={folder.id || folder.folderId}>
                  <button type="button" onClick={() => onOpenFolder(folder)} disabled={saving}>
                    <span className="drive-folder-art"><DriveIcon type="folder" /></span>
                    <span>{folder.departmentName || folder.folderName || folder.name || "Carpeta"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="drive-shortcut-picker-empty">No hay subcarpetas disponibles.</p>
          )}

          <div className="drive-action-modal-actions">
            <button type="button" className="visual-outline-button" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className="visual-primary-button"
              onClick={onMoveHere}
              disabled={saving || loading || !currentFolderId || item?.id === currentFolderId || isSameParent}
            >
              {saving ? "Moviendo..." : "Mover aqui"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShareModal({ item, users, usersLoading, shares, sharesLoading, error, saving, onShare, onUnshare, onClose }) {
  const [selectedUid, setSelectedUid] = useState("");
  const [selectedRole, setSelectedRole] = useState("viewer");

  const sharedUids = useMemo(() => new Set(shares.map((share) => share.sharedWithUid)), [shares]);
  const availableUsers = useMemo(
    () => users.filter((user) => !sharedUids.has(user.uid)),
    [users, sharedUids]
  );

  function handleSubmit(event) {
    event.preventDefault();
    if (!selectedUid) return;
    onShare(selectedUid, selectedRole);
    setSelectedUid("");
  }

  return (
    <div className="drive-preview-backdrop" role="dialog" aria-modal="true" aria-label="Compartir elemento">
      <div className="drive-preview-modal drive-shortcut-picker-modal">
        <header className="drive-preview-header">
          <div>
            <span>Compartir</span>
            <strong title={item?.name}>{item?.name || "Elemento"}</strong>
          </div>

          <button className="drive-preview-close" type="button" onClick={onClose} aria-label="Cerrar">
            <ActionIcon name="close" />
          </button>
        </header>

        <div className="drive-preview-body drive-shortcut-picker-body">
          {error ? <div className="drive-error-box">{error}</div> : null}

          <form className="drive-share-form" onSubmit={handleSubmit}>
            <select
              value={selectedUid}
              onChange={(event) => setSelectedUid(event.target.value)}
              disabled={usersLoading || saving}
            >
              <option value="">{usersLoading ? "Cargando colaboradores..." : "Elige un colaborador"}</option>
              {availableUsers.map((user) => (
                <option key={user.uid} value={user.uid}>
                  {user.name || user.email}
                </option>
              ))}
            </select>

            <select
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value)}
              disabled={saving}
            >
              <option value="viewer">Puede ver</option>
              <option value="editor">Puede editar</option>
            </select>

            <button type="submit" className="visual-primary-button" disabled={!selectedUid || saving}>
              Compartir
            </button>
          </form>
          {!usersLoading && !error && availableUsers.length === 0 ? (
            <p className="drive-shortcut-picker-empty">No hay colaboradores disponibles.</p>
          ) : null}

          <h4 className="drive-share-list-title">Personas con acceso</h4>

          {sharesLoading ? (
            <p className="drive-shortcut-picker-empty">Cargando...</p>
          ) : shares.length === 0 ? (
            <p className="drive-shortcut-picker-empty">Todavia no compartiste este elemento.</p>
          ) : (
            <ul className="drive-share-chip-list">
              {shares.map((share) => (
                <li key={share.sharedWithUid} className="drive-share-chip">
                  <span>{share.sharedWithEmail || share.sharedWithUid}</span>
                  <em>{share.role === "editor" ? "Editor" : "Viewer"}</em>
                  <button
                    type="button"
                    onClick={() => onUnshare(share.sharedWithUid)}
                    disabled={saving}
                    aria-label={`Quitar acceso de ${share.sharedWithEmail || share.sharedWithUid}`}
                  >
                    <ActionIcon name="close" />
                  </button>
                </li>
              ))}
            </ul>
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

function getTimestampMs() {
  return Number(new Date());
}

function getDriveItemType(file) {
  const kind = detectFileKind(file);
  if (kind === "docx" || kind === "text") return "document";
  if (kind === "unsupported") return "file";
  return kind;
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

function getStorageQuotaDisplay(quota) {
  const usage = Number(quota?.usage || quota?.usageInDrive || 0);
  const limit = Number(quota?.limit || 0);
  const hasUsage = Number.isFinite(usage) && usage > 0;
  const hasLimit = Number.isFinite(limit) && limit > 0;
  const percent = hasUsage && hasLimit ? Math.min(100, Math.round((usage / limit) * 100)) : 0;

  if (!quota?.available || !hasUsage) {
    return {
      label: "No disponible",
      helper: "No disponible",
      percent: 0,
      hasLimit: false,
      hasUsage: false,
    };
  }

  if (!hasLimit) {
    return {
      label: `Uso actual: ${formatBytes(usage) || "0 B"}`,
      helper: "Uso actual",
      percent: 0,
      hasLimit: false,
      hasUsage: true,
    };
  }

  return {
    label: `${formatBytes(usage)} / ${formatBytes(limit)}`,
    helper: `${percent}% utilizado`,
    percent,
    hasLimit: true,
    hasUsage: true,
  };
}

function getShortcutIconName(item) {
  const label = normalizeDriveText(
    item?.departmentName ||
    item?.folderName ||
    item?.name ||
    ""
  );

  if (label.includes("imprenta")) return "printer";
  if (label.includes("produccion") || label.includes("audiovisual") || label.includes("video")) return "video";
  if (label.includes("soporte") || label.includes("tecnico")) return "tool";
  if (label.includes("redes") || label.includes("social")) return "megaphone";
  if (label.includes("direccion")) return "building";
  return "folder";
}

function getShortcutIconTone(item) {
  const iconName = getShortcutIconName(item);
  return iconName === "folder" ? "folder" : iconName;
}

function normalizeDriveText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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

function getDriveActivityLabel(action) {
  const labels = {
    create_folder: "Creo carpeta",
    upload_file: "Subio archivo",
    upload_started: "Inicio subida",
    upload_completed: "Subio archivo",
    rename_item: "Renombro",
    move_item: "Movio",
    delete_item: "Envio a papelera",
    restore_item: "Restauro",
  };

  return labels[action] || "Actividad";
}

function getDriveActivitySummary(log) {
  const fileName = log?.fileName || "Elemento de Drive";
  const metadata = log?.metadata || {};

  if (log?.action === "rename_item") {
    return `${metadata.previousName || "Nombre anterior"} -> ${metadata.newName || fileName}`;
  }

  if (log?.action === "move_item") {
    return `${fileName} movido a carpeta ${metadata.targetFolderId || log.folderId || "destino"}.`;
  }

  if (log?.action === "upload_started") {
    return `${fileName} preparado para subida grande.`;
  }

  if (log?.action === "create_folder") {
    return `${fileName} en carpeta ${metadata.parentId || log.folderId || "raiz"}.`;
  }

  return fileName;
}

function formatActivityDate(value) {
  const rawValue = value?.toDate ? value.toDate() : value?.seconds ? value.seconds * 1000 : value;
  const date = new Date(rawValue);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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

function uploadFileToDriveSession({ file, uploadUrl, mimeType, onProgress, onRequest }) {
  return new Promise((resolve, reject) => {
    const cleanUploadUrl = String(uploadUrl || "").trim();

    if (!cleanUploadUrl) {
      reject(new Error("No se pudo preparar la sesion de subida."));
      return;
    }

    const request = new XMLHttpRequest();
    onRequest?.(request);
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
    request.onabort = () => {
      const error = createUploadError("La subida fue cancelada.");
      error.code = "upload-cancelled";
      reject(error);
    };
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
  if (error?.code === "functions/internal" || error?.code === "internal") {
    if (source === "shared") {
      return error?.message && error.message !== "internal"
        ? error.message
        : "No se pudieron cargar los archivos compartidos contigo.";
    }

    return error?.message && error.message !== "internal"
      ? error.message
      : "No se pudo completar la operacion en Google Drive.";
  }

  if (error?.code === "permission-denied") {
    return "Sin permisos Firestore para leer o guardar systemSettings/drive. Tu usuario debe tener role admin en users/{uid}.";
  }

  if (error?.code === "functions/permission-denied") {
    if (source === "upload") {
      return "Sin permisos para subir a Drive. Revisa que users/{uid}.role sea admin y que la carpeta permita escritura.";
    }

    if (source === "share") {
      return error?.message || "No tienes permiso para compartir este elemento.";
    }

    return error?.message || "Sin permisos en la funcion de Drive.";
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

  if (source === "shared") {
    return error?.message || "No se pudieron cargar los archivos compartidos contigo.";
  }

  if (source === "share") {
    return error?.message || "No se pudieron cargar los permisos compartidos.";
  }

  return error?.message || "No se pudo completar la operacion en Google Drive.";
}
