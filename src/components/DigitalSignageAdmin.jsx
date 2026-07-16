import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  claimPairingCode,
  createSignageCampaign,
  createSignageDevice,
  createSignagePlaylist,
  createTemplateAsset,
  createVisualTemplate,
  createVisualAdAsset,
  createWebAsset,
  deleteSignageAsset,
  deleteSignageCampaign,
  deleteSignageDevice,
  deleteSignagePlaylist,
  deleteVisualTemplate,
  duplicateSignageAsset,
  getSignageAssets,
  getSignageCampaigns,
  getSignageDevices,
  getSignagePlaylists,
  getPlaybackLogs,
  getSignageAuditLogs,
  getVisualTemplates,
  importSignageAssetFromDrive,
  logSignageAudit,
  sendWebAssetCommand,
  updateSignageCampaign,
  updateSignageAsset,
  updateSignageDevice,
  updateSignagePlaylist,
  updateVisualTemplate,
  updateVisualAdAsset,
  uploadSignageAsset,
} from "../services/digitalSignageService";
import { getDriveRootSettings, listDriveFolder } from "../services/driveService";
import DriveImportModal from "./digital-signage/DriveImportModal";
import SignageCampaignsPanel from "./digital-signage/SignageCampaignsPanel";
import SignageDevicesPanel from "./digital-signage/SignageDevicesPanel";
import SignageHealthPanel from "./digital-signage/SignageHealthPanel";
import SignageHistoryPanel from "./digital-signage/SignageHistoryPanel";
import SignageLibraryPanel from "./digital-signage/SignageLibraryPanel";
import SignagePlaybackPanel from "./digital-signage/SignagePlaybackPanel";
import SignagePlaylistsPanel from "./digital-signage/SignagePlaylistsPanel";
import SignagePreviewPanel from "./digital-signage/SignagePreviewPanel";
import VisualAdEditor, { VisualAdPreview } from "./digital-signage/VisualAdEditor";
import {
  DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  DIGITAL_SIGNAGE_PLANTELES,
  SIGNAGE_TABS as TABS,
  TEMPLATE_OPTIONS,
  VISUAL_TEMPLATE_CATEGORIES,
  WEEKDAY_OPTIONS,
  clampDecimal,
  clampNumber,
  compareCampaignPriority,
  formatDuration,
  getAuditDetailsSummary,
  getPublishStatus,
  getPublishStatusLabel,
  getPublishStatusMessage,
  isAuditPublishAction,
  isAuditRemovalAction,
  isPublished,
  normalizeSearch,
} from "../utils/digitalSignage";

const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

const DEFAULT_ASSET_FORM = {
  title: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  durationSeconds: 10,
};

const DEFAULT_DRIVE_IMPORT_FORM = {
  title: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  durationSeconds: 10,
  category: "institucional",
  tags: "",
  publishStatus: "draft",
  active: true,
};

const DEFAULT_WEB_FORM = {
  title: "",
  url: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  durationSeconds: 20,
  webSettings: {
    mode: "iframe",
    reloadIntervalSeconds: "",
    zoom: 100,
    showStatusOverlay: true,
    allowInteraction: false,
    cacheBustOnReload: true,
  },
};

const DEFAULT_TEMPLATE_FORM = {
  templateKey: "aviso",
  title: "",
  subtitle: "",
  body: "",
  footer: "",
  cta: "",
  templateTheme: "azul",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  durationSeconds: 12,
  active: true,
};

const DEFAULT_VISUAL_AD_ELEMENT = {
  id: "text-1",
  type: "text",
  text: "Nuevo texto",
  x: 10,
  y: 12,
  width: 60,
  fontSize: 46,
  fontWeight: "bold",
  color: "#ffffff",
  align: "left",
};

const DEFAULT_VISUAL_AD_FORM = {
  title: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  durationSeconds: 12,
  active: true,
  publishStatus: "draft",
  visualAdData: {
    canvas: {
      aspectRatio: "16:9",
      backgroundType: "solid",
      backgroundColor: "#0f4fc4",
      backgroundUrl: "",
      backgroundStoragePath: "",
    },
    elements: [],
  },
};

const DEFAULT_PLAYLIST_FORM = {
  name: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  publishStatus: "draft",
};

const DEFAULT_CAMPAIGN_FORM = {
  name: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  playlistId: "",
  priority: "normal",
  startDate: "",
  endDate: "",
  active: true,
  publishStatus: "draft",
  schedule: {
    enabled: false,
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "07:00",
    endTime: "14:00",
    timezone: "America/Tijuana",
  },
};

const DEFAULT_DEVICE_FORM = {
  name: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  location: "",
  assignedPlaylistId: "",
};

const DEFAULT_PAIRING_FORM = {
  code: "",
  name: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  location: "",
  assignedPlaylistId: "",
};

const MAX_VISUAL_AD_HISTORY = 30;
const MIN_VISUAL_AD_ZOOM = 0.5;
const MAX_VISUAL_AD_ZOOM = 2;
const VISUAL_AD_ZOOM_STEP = 0.1;
const VISUAL_AD_DRAFT_PREFIX = "digitalSignage:visualAdDraft:";
const VISUAL_AD_DRAFT_NEW_KEY = `${VISUAL_AD_DRAFT_PREFIX}new`;
const VISUAL_AD_DRAFT_DEBOUNCE_MS = 800;
const DEVICES_VIEW_MODE_KEY = "digitalSignage:devicesViewMode";

export default function DigitalSignageAdmin() {
  const { profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("library");
  const [assets, setAssets] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [visualTemplates, setVisualTemplates] = useState([]);
  const [devices, setDevices] = useState([]);
  const [playbackLogs, setPlaybackLogs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [assetForm, setAssetForm] = useState(DEFAULT_ASSET_FORM);
  const [webForm, setWebForm] = useState(DEFAULT_WEB_FORM);
  const [templateForm, setTemplateForm] = useState(DEFAULT_TEMPLATE_FORM);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [visualAdForm, setVisualAdForm] = useState(DEFAULT_VISUAL_AD_FORM);
  const [visualAdFormOpen, setVisualAdFormOpen] = useState(false);
  const [editingVisualAdId, setEditingVisualAdId] = useState("");
  const [visualAdDirty, setVisualAdDirty] = useState(false);
  const [visualAdBackgroundFile, setVisualAdBackgroundFile] = useState(null);
  const [visualAdElementFiles, setVisualAdElementFiles] = useState({});
  const [visualAdBackgroundPreview, setVisualAdBackgroundPreview] = useState("");
  const [selectedVisualElementId, setSelectedVisualElementId] = useState("");
  const [visualAdHistory, setVisualAdHistory] = useState([]);
  const [visualAdFuture, setVisualAdFuture] = useState([]);
  const [visualAdZoom, setVisualAdZoom] = useState(1);
  const [visualAdDraftStatus, setVisualAdDraftStatus] = useState("");
  const [assetFile, setAssetFile] = useState(null);
  const [driveImportOpen, setDriveImportOpen] = useState(false);
  const [driveImportSearch, setDriveImportSearch] = useState("");
  const [driveImportType, setDriveImportType] = useState("imagenes");
  const [driveImportLoading, setDriveImportLoading] = useState(false);
  const [driveImportFiles, setDriveImportFiles] = useState([]);
  const [driveImportFolders, setDriveImportFolders] = useState([]);
  const [driveImportFolderId, setDriveImportFolderId] = useState("");
  const [driveImportBreadcrumbs, setDriveImportBreadcrumbs] = useState([]);
  const [selectedDriveImportFile, setSelectedDriveImportFile] = useState(null);
  const [driveImportForm, setDriveImportForm] = useState(DEFAULT_DRIVE_IMPORT_FORM);
  const [driveImportError, setDriveImportError] = useState("");
  const [playlistForm, setPlaylistForm] = useState(DEFAULT_PLAYLIST_FORM);
  const [campaignForm, setCampaignForm] = useState(DEFAULT_CAMPAIGN_FORM);
  const [editingCampaignId, setEditingCampaignId] = useState("");
  const [editingPlaylistId, setEditingPlaylistId] = useState("");
  const [editingWebAssetId, setEditingWebAssetId] = useState("");
  const [deviceForm, setDeviceForm] = useState(DEFAULT_DEVICE_FORM);
  const [pairingForm, setPairingForm] = useState(DEFAULT_PAIRING_FORM);
  const [editingDeviceId, setEditingDeviceId] = useState("");
  const [deviceFormOpen, setDeviceFormOpen] = useState(false);
  const [pairingFormOpen, setPairingFormOpen] = useState(false);
  const [assetSearch, setAssetSearch] = useState("");
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [assetPlantelFilter, setAssetPlantelFilter] = useState("all");
  const [assetCategoryFilter, setAssetCategoryFilter] = useState("all");
  const [assetStatusFilter, setAssetStatusFilter] = useState("current");
  const [assetPublishFilter, setAssetPublishFilter] = useState("all");
  const [assetSort, setAssetSort] = useState("recent");
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [devicesViewMode, setDevicesViewMode] = useState(getStoredDevicesViewMode);
  const [healthSearch, setHealthSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
  const [playbackDeviceFilter, setPlaybackDeviceFilter] = useState("all");
  const [playbackPlantelFilter, setPlaybackPlantelFilter] = useState("all");
  const [playbackEventFilter, setPlaybackEventFilter] = useState("all");
  const [playbackAssetFilter, setPlaybackAssetFilter] = useState("all");
  const [playbackCampaignFilter, setPlaybackCampaignFilter] = useState("all");
  const [playbackPlaylistFilter, setPlaybackPlaylistFilter] = useState("all");
  const [playbackRangeFilter, setPlaybackRangeFilter] = useState("7");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditEntityFilter, setAuditEntityFilter] = useState("all");
  const [auditRangeFilter, setAuditRangeFilter] = useState("7");
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("");
  const [assetToAddId, setAssetToAddId] = useState("");
  const [previewMode, setPreviewMode] = useState("playlist");
  const [previewPlaylistId, setPreviewPlaylistId] = useState("");
  const [previewCampaignId, setPreviewCampaignId] = useState("");
  const [previewDeviceId, setPreviewDeviceId] = useState("");
  const deviceFormRef = useRef(null);
  const visualAdBackgroundPreviewRef = useRef("");
  const visualAdDraftTimerRef = useRef(null);
  const undoVisualAdChangeRef = useRef(() => {});
  const redoVisualAdChangeRef = useRef(() => {});

  const activeAssets = useMemo(
    () => assets.filter((asset) => asset.active !== false && asset.archived !== true),
    [assets]
  );

  const onlineDevices = useMemo(
    () => devices.filter(isDeviceOnline),
    [devices]
  );

  const unassignedDevices = useMemo(
    () => devices.filter((device) => device.active !== false && !device.assignedPlaylistId),
    [devices]
  );

  const assetUsageMap = useMemo(() => getAssetUsageMap(playlists), [playlists]);

  const filteredAssets = useMemo(() => {
    const normalizedSearch = normalizeSearch(assetSearch);

    return [...assets]
      .filter((asset) => {
        const category = getAssetCategoryValue(asset.category);
        const tags = getAssetTags(asset);
        const matchesSearch =
          !normalizedSearch ||
          [
            asset.title,
            asset.plantel,
            getAssetTypeLabel(asset.type),
            getAssetCategoryLabel(category),
            ...tags,
          ].some((value) => normalizeSearch(value).includes(normalizedSearch));
        const matchesType = assetTypeFilter === "all" || asset.type === assetTypeFilter;
        const matchesPlantel = assetPlantelFilter === "all" || asset.plantel === assetPlantelFilter;
        const matchesCategory = assetCategoryFilter === "all" || category === assetCategoryFilter;
        const matchesPublish =
          assetPublishFilter === "all" ||
          getPublishStatus(asset.publishStatus) === assetPublishFilter;
        const matchesStatus =
          assetStatusFilter === "all" ||
          (assetStatusFilter === "current" && asset.archived !== true) ||
          (assetStatusFilter === "active" && asset.active !== false && asset.archived !== true) ||
          (assetStatusFilter === "inactive" && asset.active === false && asset.archived !== true) ||
          (assetStatusFilter === "archived" && asset.archived === true);

        return matchesSearch && matchesType && matchesPlantel && matchesCategory && matchesPublish && matchesStatus;
      })
      .sort((first, second) => compareAssets(first, second, assetSort));
  }, [
    assetCategoryFilter,
    assetPlantelFilter,
    assetPublishFilter,
    assetSearch,
    assetSort,
    assetStatusFilter,
    assetTypeFilter,
    assets,
  ]);

  const filteredDriveImportFiles = useMemo(() => {
    const normalizedSearch = normalizeSearch(driveImportSearch);

    return driveImportFiles.filter((file) => {
      const mimeType = String(file?.mimeType || "");
      const matchesType =
        driveImportType === "videos"
          ? mimeType.startsWith("video/")
          : mimeType.startsWith("image/");
      const matchesSearch =
        !normalizedSearch ||
        normalizeSearch(file?.name).includes(normalizedSearch);

      return matchesType && matchesSearch;
    });
  }, [driveImportFiles, driveImportSearch, driveImportType]);

  const activeCampaignByDeviceId = useMemo(() => {
    const entries = devices.map((device) => [
      device.id,
      getCurrentCampaignForDevice(campaigns, device),
    ]);

    return new Map(entries);
  }, [campaigns, devices]);

  const filteredDevices = useMemo(() => {
    const normalizedSearch = normalizeSearch(deviceSearch);

    return devices.filter((device) => {
      const status = getDeviceStatus(device);
      const matchesStatus = deviceFilter === "all" || status === deviceFilter;
      const matchesSearch =
        !normalizedSearch ||
        [
          device.name,
          device.id,
          device.deviceToken,
          device.plantel,
          device.location,
          getPlaylistName(device.assignedPlaylistId, playlists),
        ].some((value) => normalizeSearch(value).includes(normalizedSearch));

      return matchesStatus && matchesSearch;
    });
  }, [deviceFilter, deviceSearch, devices, playlists]);

  const selectedDevice = useMemo(
    () =>
      devices.find((device) => device.id === selectedDeviceId) ||
      filteredDevices[0] ||
      devices[0] ||
      null,
    [devices, filteredDevices, selectedDeviceId]
  );

  const healthRows = useMemo(() => {
    const normalizedSearch = normalizeSearch(healthSearch);

    return devices
      .map((device) => {
        const status = getDeviceStatus(device);
        const requiresAttention = deviceRequiresAttention(device, status);

        return {
          device,
          status,
          requiresAttention,
          playlistName: getPlaylistName(device.assignedPlaylistId, playlists),
          contentLabel: getDeviceContentLabel(device, playlists, activeCampaignByDeviceId),
          attentionReason: getDeviceAttentionReason(device, status),
        };
      })
      .filter(({ device, status, requiresAttention, playlistName }) => {
        const matchesFilter =
          healthFilter === "all" ||
          status === healthFilter ||
          (healthFilter === "attention" && requiresAttention) ||
          (healthFilter === "offline" && status === "no-connection");
        const matchesSearch =
          !normalizedSearch ||
          [
            device.name,
            device.plantel,
            device.location,
            device.id,
            playlistName,
          ].some((value) => normalizeSearch(value).includes(normalizedSearch));

        return matchesFilter && matchesSearch;
      });
  }, [activeCampaignByDeviceId, devices, healthFilter, healthSearch, playlists]);

  const healthStats = useMemo(() => {
    const rows = devices.map((device) => {
      const status = getDeviceStatus(device);
      return {
        status,
        requiresAttention: deviceRequiresAttention(device, status),
      };
    });

    return {
      online: rows.filter((row) => row.status === "online").length,
      offline: rows.filter((row) => ["offline", "no-connection"].includes(row.status)).length,
      unassigned: rows.filter((row) => row.status === "unassigned").length,
      inactive: rows.filter((row) => row.status === "inactive").length,
      attention: rows.filter((row) => row.requiresAttention).length,
    };
  }, [devices]);

  const filteredPlaybackLogs = useMemo(() => {
    const minMillis = getAuditRangeStartMillis(playbackRangeFilter);

    return playbackLogs.filter((log) => {
      const createdMillis = getAuditLogMillis(log);
      const matchesRange = !minMillis || createdMillis >= minMillis;
      const matchesDevice = playbackDeviceFilter === "all" || log.deviceId === playbackDeviceFilter;
      const matchesPlantel = playbackPlantelFilter === "all" || log.plantel === playbackPlantelFilter;
      const matchesEvent = playbackEventFilter === "all" || log.eventType === playbackEventFilter;
      const matchesAsset = playbackAssetFilter === "all" || log.assetType === playbackAssetFilter;
      const matchesCampaign = playbackCampaignFilter === "all" || log.campaignId === playbackCampaignFilter;
      const matchesPlaylist = playbackPlaylistFilter === "all" || log.playlistId === playbackPlaylistFilter;

      return matchesRange && matchesDevice && matchesPlantel && matchesEvent && matchesAsset && matchesCampaign && matchesPlaylist;
    });
  }, [
    playbackAssetFilter,
    playbackCampaignFilter,
    playbackDeviceFilter,
    playbackEventFilter,
    playbackLogs,
    playbackPlantelFilter,
    playbackPlaylistFilter,
    playbackRangeFilter,
  ]);

  const playbackStats = useMemo(() => {
    const todayStart = getAuditRangeStartMillis("today");
    const todayLogs = playbackLogs.filter((log) => getAuditLogMillis(log) >= todayStart);

    return {
      playsToday: todayLogs.filter((log) => log.eventType === "play_start").length,
      errorsToday: todayLogs.filter((log) => log.eventType === "play_error").length,
      activeDevices: new Set(todayLogs.map((log) => log.deviceId).filter(Boolean)).size,
      offlineEvents: todayLogs.filter((log) => log.eventType === "offline_cache").length,
    };
  }, [playbackLogs]);

  const auditStats = useMemo(() => {
    const todayStart = getAuditRangeStartMillis("today");
    const todayLogs = auditLogs.filter((log) => getAuditLogMillis(log) >= todayStart);

    return {
      changesToday: todayLogs.length,
      publications: auditLogs.filter(isAuditPublishAction).length,
      edits: auditLogs.filter((log) => normalizeSearch(log.action).includes("editar")).length,
      removals: auditLogs.filter(isAuditRemovalAction).length,
    };
  }, [auditLogs]);

  const filteredAuditLogs = useMemo(() => {
    const normalizedSearch = normalizeSearch(auditSearch);
    const minMillis = getAuditRangeStartMillis(auditRangeFilter);

    return auditLogs.filter((log) => {
      const createdMillis = getAuditLogMillis(log);
      const matchesRange = !minMillis || createdMillis >= minMillis;
      const matchesEntity = matchesAuditEntityFilter(log, auditEntityFilter);
      const matchesSearch =
        !normalizedSearch ||
        [
          log.createdByName,
          log.action,
          log.entityName,
          log.entityId,
          log.entityType,
          getAuditDetailsSummary(log.details),
        ].some((value) => normalizeSearch(value).includes(normalizedSearch));

      return matchesRange && matchesEntity && matchesSearch;
    });
  }, [auditEntityFilter, auditLogs, auditRangeFilter, auditSearch]);

  const selectedDevicePlaylist = useMemo(
    () => {
      const activeCampaign = selectedDevice
        ? activeCampaignByDeviceId.get(selectedDevice.id)
        : null;
      const playlistId = activeCampaign?.playlistId || selectedDevice?.assignedPlaylistId || "";

      return playlists.find((playlist) => playlist.id === playlistId) || null;
    },
    [activeCampaignByDeviceId, playlists, selectedDevice]
  );

  const effectiveSelectedPlaylistId = selectedPlaylistId || playlists[0]?.id || "";
  const selectedPlaylist = useMemo(
    () =>
      playlists.find((playlist) => playlist.id === effectiveSelectedPlaylistId) ||
      null,
    [playlists, effectiveSelectedPlaylistId]
  );

  const previewCampaign = useMemo(
    () =>
      campaigns.find((campaign) => campaign.id === previewCampaignId) ||
      campaigns[0] ||
      null,
    [campaigns, previewCampaignId]
  );

  const previewDevice = useMemo(
    () =>
      devices.find((device) => device.id === previewDeviceId) ||
      devices[0] ||
      null,
    [devices, previewDeviceId]
  );

  const previewPlaylist = useMemo(() => {
    if (previewMode === "campaign") {
      return playlists.find((playlist) => playlist.id === previewCampaign?.playlistId) || null;
    }

    if (previewMode === "device") {
      const campaign = previewDevice ? activeCampaignByDeviceId.get(previewDevice.id) : null;
      const playlistId = campaign?.playlistId || previewDevice?.assignedPlaylistId || "";
      return playlists.find((playlist) => playlist.id === playlistId) || null;
    }

    return (
      playlists.find((playlist) => playlist.id === previewPlaylistId) ||
      playlists[0] ||
      null
    );
  }, [
    activeCampaignByDeviceId,
    playlists,
    previewCampaign,
    previewDevice,
    previewMode,
    previewPlaylistId,
  ]);

  async function loadAll() {
    setLoading(true);
    setMessage("");

    try {
      const [
        nextAssets,
        nextPlaylists,
        nextCampaigns,
        nextVisualTemplates,
        nextDevices,
        nextPlaybackLogs,
        nextAuditLogs,
      ] = await Promise.all([
        getSignageAssets(),
        getSignagePlaylists(),
        getSignageCampaigns(),
        getVisualTemplates(),
        getSignageDevices(),
        getPlaybackLogs({ limitCount: 700 }),
        getSignageAuditLogs({ limitCount: 300 }),
      ]);

      setAssets(nextAssets);
      setPlaylists(nextPlaylists);
      setCampaigns(nextCampaigns);
      setVisualTemplates(nextVisualTemplates);
      setDevices(nextDevices);
      setPlaybackLogs(nextPlaybackLogs);
      setAuditLogs(nextAuditLogs);
    } catch (error) {
      setMessage(error.message || "No se pudo cargar Digital Signage.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return undefined;

    const timeoutId = window.setTimeout(() => {
      loadAll();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isAdmin]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DEVICES_VIEW_MODE_KEY, devicesViewMode);
    } catch (error) {
      console.warn("No se pudo guardar preferencia de vista de dispositivos.", error);
    }
  }, [devicesViewMode]);

  useEffect(
    () => () => {
      if (visualAdBackgroundPreviewRef.current) {
        URL.revokeObjectURL(visualAdBackgroundPreviewRef.current);
      }
      if (visualAdDraftTimerRef.current) {
        window.clearTimeout(visualAdDraftTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!visualAdFormOpen || !visualAdDirty) return undefined;

    const pendingStatusId = window.setTimeout(() => {
      setVisualAdDraftStatus("pending");
    }, 0);

    if (visualAdDraftTimerRef.current) {
      window.clearTimeout(visualAdDraftTimerRef.current);
    }

    visualAdDraftTimerRef.current = window.setTimeout(() => {
      const saved = saveVisualAdDraft(
        editingVisualAdId,
        visualAdForm,
        selectedVisualElementId,
        visualAdBackgroundPreview
      );
      if (saved) setVisualAdDraftStatus("saved");
    }, VISUAL_AD_DRAFT_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(pendingStatusId);
      if (visualAdDraftTimerRef.current) {
        window.clearTimeout(visualAdDraftTimerRef.current);
      }
    };
  }, [
    visualAdFormOpen,
    visualAdDirty,
    visualAdForm,
    selectedVisualElementId,
    editingVisualAdId,
    visualAdBackgroundPreview,
  ]);

  useEffect(() => {
    if (!visualAdFormOpen || !visualAdDirty) return undefined;

    function warnBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [visualAdFormOpen, visualAdDirty]);

  useEffect(() => {
    undoVisualAdChangeRef.current = undoVisualAdChange;
    redoVisualAdChangeRef.current = redoVisualAdChange;
  });

  useEffect(() => {
    if (!visualAdFormOpen) return undefined;

    function handleVisualAdShortcuts(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (isEditableShortcutTarget(event.target)) return;

      const key = String(event.key || "").toLowerCase();
      const shouldUndo = key === "z" && !event.shiftKey;
      const shouldRedo = key === "y" || (key === "z" && event.shiftKey);

      if (shouldUndo) {
        event.preventDefault();
        undoVisualAdChangeRef.current();
      }

      if (shouldRedo) {
        event.preventDefault();
        redoVisualAdChangeRef.current();
      }
    }

    window.addEventListener("keydown", handleVisualAdShortcuts);
    return () => window.removeEventListener("keydown", handleVisualAdShortcuts);
  }, [visualAdFormOpen]);

  async function runAction(action, successMessage) {
    setSaving(true);
    setMessage("");

    try {
      await action();
      await loadAll();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error.message || "No se pudo guardar el cambio.");
    } finally {
      setSaving(false);
    }
  }

  function audit(action, entityType, entityId, entityName, details = {}) {
    return logSignageAudit(action, entityType, entityId, entityName, details, profile);
  }

  async function handleUploadAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      await uploadSignageAsset(assetFile, assetForm, profile);
      setAssetFile(null);
      setAssetForm(DEFAULT_ASSET_FORM);
      event.target.reset();
    }, "Contenido guardado.");
  }

  async function openDriveImportModal() {
    setDriveImportOpen(true);
    setDriveImportError("");
    setDriveImportSearch("");
    setDriveImportFiles([]);
    setDriveImportFolders([]);
    setDriveImportFolderId("");
    setDriveImportBreadcrumbs([]);
    setSelectedDriveImportFile(null);
    setDriveImportForm(DEFAULT_DRIVE_IMPORT_FORM);
    await loadDriveImportRootFolder();
  }

  function closeDriveImportModal() {
    if (saving) return;
    setDriveImportOpen(false);
    setDriveImportError("");
    setSelectedDriveImportFile(null);
  }

  async function loadDriveImportRootFolder() {
    setDriveImportLoading(true);
    setDriveImportError("");

    try {
      const settings = await getDriveRootSettings();
      const rootFolderId = String(settings?.rootFolderId || "").trim();

      if (!rootFolderId) {
        throw new Error("Configura una carpeta raíz en Nube AES antes de importar.");
      }

      await loadDriveImportFolder(rootFolderId, [{ id: rootFolderId, name: "Raíz" }]);
    } catch (error) {
      setDriveImportFiles([]);
      setDriveImportFolders([]);
      setDriveImportFolderId("");
      setDriveImportBreadcrumbs([]);
      setDriveImportError(error.message || "No se pudo cargar Nube AES.");
    } finally {
      setDriveImportLoading(false);
    }
  }

  async function loadDriveImportFolder(folderId, breadcrumbs) {
    const cleanFolderId = String(folderId || "").trim();
    if (!cleanFolderId) return;

    setDriveImportLoading(true);
    setDriveImportError("");
    setSelectedDriveImportFile(null);

    try {
      const result = await listDriveFolder(cleanFolderId);
      const items = Array.isArray(result?.files) ? result.files : [];

      setDriveImportFolderId(cleanFolderId);
      setDriveImportBreadcrumbs(breadcrumbs);
      setDriveImportFolders(items.filter(isDriveFolder));
      setDriveImportFiles(items.filter((item) => !isDriveFolder(item)));
    } catch (error) {
      setDriveImportError(error.message || "No se pudo cargar la carpeta de Nube AES.");
      setDriveImportFolders([]);
      setDriveImportFiles([]);
    } finally {
      setDriveImportLoading(false);
    }
  }

  function openDriveImportFolder(folder) {
    loadDriveImportFolder(folder.id, [
      ...driveImportBreadcrumbs,
      { id: folder.id, name: folder.name || "Carpeta" },
    ]);
  }

  function goToDriveImportBreadcrumb(index) {
    const breadcrumb = driveImportBreadcrumbs[index];
    if (!breadcrumb || breadcrumb.id === driveImportFolderId) return;
    loadDriveImportFolder(breadcrumb.id, driveImportBreadcrumbs.slice(0, index + 1));
  }

  function goBackDriveImportFolder() {
    if (driveImportBreadcrumbs.length <= 1) return;
    goToDriveImportBreadcrumb(driveImportBreadcrumbs.length - 2);
  }

  function selectDriveImportFile(file) {
    setSelectedDriveImportFile(file);
    setDriveImportError("");
    setDriveImportForm((current) => ({
      ...current,
      title: current.title || getTitleFromFileName(file?.name),
      durationSeconds: String(file?.mimeType || "").startsWith("video/") ? 30 : current.durationSeconds,
    }));
  }

  async function handleDriveImportSearch(event) {
    event.preventDefault();
    if (!driveImportFolderId) {
      setDriveImportError("Selecciona una carpeta para buscar archivos.");
    }
  }

  async function handleImportDriveAsset(event) {
    event.preventDefault();

    if (!selectedDriveImportFile) {
      setDriveImportError("Selecciona un archivo de Nube AES.");
      return;
    }

    if (isDriveFileAlreadyImported(selectedDriveImportFile, assets)) {
      setDriveImportError("Este archivo de Nube AES ya fue importado a Digital Signage.");
      return;
    }

    await runAction(async () => {
      await importSignageAssetFromDrive(
        selectedDriveImportFile,
        {
          ...driveImportForm,
          sourceFolderId: driveImportFolderId,
          sourceFolderName: driveImportBreadcrumbs.at(-1)?.name || "",
        },
        profile
      );
      setDriveImportOpen(false);
      setSelectedDriveImportFile(null);
      setDriveImportForm(DEFAULT_DRIVE_IMPORT_FORM);
    }, "Contenido importado desde Nube AES.");
  }

  async function handleCreateWebAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      const payload = {
        ...webForm,
        url: normalizeUrl(webForm.url),
        webSettings: normalizeWebSettingsForSave(webForm.webSettings),
      };

      if (editingWebAssetId) {
        await updateSignageAsset(editingWebAssetId, payload);
        await audit("editar asset web", "web_asset", editingWebAssetId, payload.title, {
          url: payload.url,
          mode: payload.webSettings?.mode,
        });
      } else {
        await createWebAsset(payload, profile);
      }

      resetWebAssetForm();
    }, editingWebAssetId ? "Contenido web actualizado." : "Contenido web guardado.");
  }

  function updateWebFormSettings(updates) {
    setWebForm((current) => ({
      ...current,
      webSettings: {
        ...current.webSettings,
        ...updates,
      },
    }));
  }

  function resetWebAssetForm() {
    setWebForm(DEFAULT_WEB_FORM);
    setEditingWebAssetId("");
  }

  async function handleCreateTemplateAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      await createTemplateAsset(
        {
          title: templateForm.title,
          templateKey: templateForm.templateKey,
          templateTheme: templateForm.templateTheme,
          plantel: templateForm.plantel,
          durationSeconds: templateForm.durationSeconds,
          active: templateForm.active,
          templateData: {
            title: templateForm.title,
            subtitle: templateForm.subtitle,
            body: templateForm.body,
            footer: templateForm.footer,
            cta: templateForm.cta,
          },
        },
        profile
      );
      setTemplateForm(DEFAULT_TEMPLATE_FORM);
      setTemplateFormOpen(false);
    }, "Plantilla guardada.");
  }

  async function handleCreateVisualAdAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      const payload = {
        ...visualAdForm,
        visualAdData: getVisualAdDataForSave(visualAdForm.visualAdData, visualAdBackgroundPreview),
      };

      if (editingVisualAdId) {
        await updateVisualAdAsset(editingVisualAdId, payload, visualAdBackgroundFile, profile, visualAdElementFiles);
      } else {
        await createVisualAdAsset(
          payload,
          visualAdBackgroundFile,
          profile,
          visualAdElementFiles
        );
      }

      removeVisualAdDraft(editingVisualAdId);
      resetVisualAdEditor();
    }, editingVisualAdId ? "Anuncio visual actualizado." : "Anuncio visual guardado.");
  }

  async function handleSaveVisualTemplate() {
    const visualAdData = sanitizeVisualAdDraftForm(visualAdForm, visualAdBackgroundPreview).visualAdData;
    const defaultName = visualAdForm.title || "Nueva plantilla";
    const name = window.prompt("Nombre de la plantilla", defaultName);

    if (!name) return;

    const categoryInput = window.prompt(
      "Categoría: institucional, promocion, aviso, coffee, evento u otro",
      "institucional"
    );
    const category = getVisualTemplateCategoryValue(categoryInput);
    const description = window.prompt("Descripción opcional", "") || "";

    await runAction(async () => {
      await createVisualTemplate(
        {
          name,
          category,
          description,
          visualAdData,
          thumbnailHint: visualAdForm.title || name,
          active: true,
        },
        profile
      );
    }, "Plantilla guardada.");
  }

  function applyVisualTemplate(template) {
    if (!template?.visualAdData) {
      setMessage("Plantilla no disponible.");
      return;
    }

    const visualAdData = normalizeVisualAdDataForEditor(template.visualAdData);

    if (!isVisualAdDataUsable(visualAdData)) {
      setMessage("Plantilla no disponible.");
      return;
    }

    if (
      visualAdForm.visualAdData.elements.length > 0 &&
      !window.confirm("La plantilla reemplazará el diseño actual. ¿Continuar?")
    ) {
      return;
    }

    pushVisualAdHistory();
    setVisualAdForm((current) => ({
      ...current,
      visualAdData: cloneVisualAdData(visualAdData),
    }));
    setSelectedVisualElementId(visualAdData.elements[0]?.id || "");
    setVisualAdBackgroundFile(null);
    setVisualAdBackgroundPreview("");
    setVisualAdElementFiles({});
    setVisualAdDirty(true);
    setMessage("Plantilla aplicada.");
  }

  async function editVisualTemplate(template) {
    if (!template?.id) return;

    const name = window.prompt("Nombre de la plantilla", template.name || "");
    if (!name) return;

    const categoryInput = window.prompt(
      "Categoría: institucional, promocion, aviso, coffee, evento u otro",
      template.category || "otro"
    );
    const description = window.prompt("Descripción opcional", template.description || "") || "";

    await runAction(
      async () => {
        await updateVisualTemplate(template.id, {
          name,
          category: getVisualTemplateCategoryValue(categoryInput),
          description,
        });
        await audit("editar plantilla visual", "visual_template", template.id, name, {
          category: getVisualTemplateCategoryValue(categoryInput),
        });
      },
      "Plantilla actualizada."
    );
  }

  async function toggleVisualTemplate(template) {
    if (!template?.id) return;

    await runAction(
      async () => {
        await updateVisualTemplate(template.id, { active: template.active === false });
        await audit("activar/desactivar plantilla visual", "visual_template", template.id, template.name, {
          active: template.active === false,
        });
      },
      "Plantilla actualizada."
    );
  }

  async function removeVisualTemplate(template) {
    if (!template?.id) return;
    if (!window.confirm(`¿Eliminar plantilla "${template.name || "sin nombre"}"?`)) return;

    await runAction(async () => {
      await deleteVisualTemplate(template.id);
      await audit("eliminar plantilla visual", "visual_template", template.id, template.name);
    }, "Plantilla eliminada.");
  }

  function resetVisualAdEditor() {
    if (visualAdDraftTimerRef.current) {
      window.clearTimeout(visualAdDraftTimerRef.current);
      visualAdDraftTimerRef.current = null;
    }
    setVisualAdForm(DEFAULT_VISUAL_AD_FORM);
    handleVisualAdBackgroundChange(null, { markDirty: false });
    clearVisualAdElementPreviewUrls();
    setVisualAdElementFiles({});
    setSelectedVisualElementId("");
    setEditingVisualAdId("");
    setVisualAdDirty(false);
    setVisualAdFormOpen(false);
    setVisualAdHistory([]);
    setVisualAdFuture([]);
    setVisualAdZoom(1);
    setVisualAdDraftStatus("");
  }

  function openNewVisualAdEditor() {
    const draft = readVisualAdDraft("");
    if (draft) {
      if (window.confirm("Hay un borrador sin guardar. ¿Quieres recuperarlo?")) {
        loadVisualAdDraft(draft, "");
        return;
      }
      removeVisualAdDraft("");
    }

    setVisualAdForm(DEFAULT_VISUAL_AD_FORM);
    handleVisualAdBackgroundChange(null, { markDirty: false });
    clearVisualAdElementPreviewUrls();
    setVisualAdElementFiles({});
    setSelectedVisualElementId("");
    setEditingVisualAdId("");
    setVisualAdDirty(false);
    setVisualAdHistory([]);
    setVisualAdFuture([]);
    setVisualAdZoom(1);
    setVisualAdDraftStatus("");
    setVisualAdFormOpen(true);
  }

  function openEditVisualAdEditor(asset) {
    if (asset?.type !== "visual_ad") return;

    const draft = readVisualAdDraft(asset.id);
    if (draft) {
      if (window.confirm("Hay un borrador local para este anuncio. ¿Quieres recuperarlo?")) {
        loadVisualAdDraft(draft, asset.id);
        return;
      }
      removeVisualAdDraft(asset.id);
    }

    const visualAdData = normalizeVisualAdDataForEditor(asset.visualAdData);
    setVisualAdForm({
      title: asset.title || "",
      plantel: asset.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
      durationSeconds: asset.durationSeconds || 12,
      active: asset.active !== false,
      publishStatus: getPublishStatus(asset.publishStatus),
      visualAdData,
    });
    handleVisualAdBackgroundChange(null, { markDirty: false });
    clearVisualAdElementPreviewUrls();
    setVisualAdElementFiles({});
    setSelectedVisualElementId(visualAdData.elements[0]?.id || "");
    setEditingVisualAdId(asset.id);
    setVisualAdDirty(false);
    setVisualAdHistory([]);
    setVisualAdFuture([]);
    setVisualAdZoom(1);
    setVisualAdDraftStatus("");
    setVisualAdFormOpen(true);
  }

  function closeVisualAdEditor() {
    if (visualAdDirty && !window.confirm("Hay cambios sin guardar. ¿Volver a Biblioteca sin guardar?")) {
      return;
    }

    removeVisualAdDraft(editingVisualAdId);
    resetVisualAdEditor();
  }

  function loadVisualAdDraft(draft, assetId) {
    const form = normalizeVisualAdDraftForm(draft.form);

    setVisualAdForm(form);
    handleVisualAdBackgroundChange(null, { markDirty: false });
    clearVisualAdElementPreviewUrls();
    setVisualAdElementFiles({});
    setSelectedVisualElementId(draft.selectedElementId || form.visualAdData.elements[0]?.id || "");
    setEditingVisualAdId(assetId || "");
    setVisualAdDirty(true);
    setVisualAdHistory([]);
    setVisualAdFuture([]);
    setVisualAdZoom(1);
    setVisualAdDraftStatus("saved");
    setVisualAdFormOpen(true);
  }

  function createVisualAdSnapshot() {
    return {
      form: cloneVisualAdForm(visualAdForm),
      selectedElementId: selectedVisualElementId,
      backgroundFile: visualAdBackgroundFile,
      backgroundPreview: visualAdBackgroundPreview,
      elementFiles: { ...visualAdElementFiles },
    };
  }

  function restoreVisualAdSnapshot(snapshot) {
    if (!snapshot?.form) return;

    setVisualAdForm(cloneVisualAdForm(snapshot.form));
    setSelectedVisualElementId(snapshot.selectedElementId || "");
    setVisualAdBackgroundFile(snapshot.backgroundFile || null);
    setVisualAdBackgroundPreview(snapshot.backgroundPreview || "");
    visualAdBackgroundPreviewRef.current = String(snapshot.backgroundPreview || "").startsWith("blob:")
      ? snapshot.backgroundPreview
      : "";
    setVisualAdElementFiles({ ...(snapshot.elementFiles || {}) });
    setVisualAdDirty(true);
  }

  function pushVisualAdHistory() {
    const snapshot = createVisualAdSnapshot();

    setVisualAdHistory((current) => {
      const next = [...current, snapshot];
      return next.slice(Math.max(0, next.length - MAX_VISUAL_AD_HISTORY));
    });
    setVisualAdFuture([]);
  }

  function undoVisualAdChange() {
    if (!visualAdHistory.length) return;

    const previous = visualAdHistory[visualAdHistory.length - 1];
    setVisualAdFuture((current) => [createVisualAdSnapshot(), ...current].slice(0, MAX_VISUAL_AD_HISTORY));
    setVisualAdHistory((current) => current.slice(0, -1));
    restoreVisualAdSnapshot(previous);
  }

  function redoVisualAdChange() {
    if (!visualAdFuture.length) return;

    const nextSnapshot = visualAdFuture[0];
    setVisualAdHistory((current) => {
      const next = [...current, createVisualAdSnapshot()];
      return next.slice(Math.max(0, next.length - MAX_VISUAL_AD_HISTORY));
    });
    setVisualAdFuture((current) => current.slice(1));
    restoreVisualAdSnapshot(nextSnapshot);
  }

  function zoomVisualAd(delta) {
    setVisualAdZoom((current) =>
      clampDecimal(current + delta, MIN_VISUAL_AD_ZOOM, MAX_VISUAL_AD_ZOOM, 1)
    );
  }

  function fitVisualAdCanvas() {
    setVisualAdZoom(1);
  }

  function updateVisualAdField(field, value, options = {}) {
    if (options.history !== false) pushVisualAdHistory();
    setVisualAdDirty(true);
    setVisualAdForm((current) => ({ ...current, [field]: value }));
  }

  function handleVisualAdBackgroundChange(file, options = {}) {
    const shouldMarkDirty = options.markDirty !== false;

    if (shouldMarkDirty && options.history !== false) {
      pushVisualAdHistory();
    }

    if (visualAdBackgroundPreviewRef.current && !shouldMarkDirty) {
      URL.revokeObjectURL(visualAdBackgroundPreviewRef.current);
      visualAdBackgroundPreviewRef.current = "";
    }

    setVisualAdBackgroundFile(file);

    if (!file) {
      setVisualAdBackgroundPreview("");
      if (shouldMarkDirty) setVisualAdDirty(true);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    visualAdBackgroundPreviewRef.current = objectUrl;
    setVisualAdBackgroundPreview(objectUrl);
    if (shouldMarkDirty) setVisualAdDirty(true);
  }

  function updateVisualAdCanvas(updates, options = {}) {
    if (options.history !== false) pushVisualAdHistory();
    setVisualAdDirty(true);
    setVisualAdForm((current) => ({
      ...current,
      visualAdData: {
        ...current.visualAdData,
        canvas: {
          ...current.visualAdData.canvas,
          ...updates,
        },
      },
    }));
  }

  function handleVisualAdBackgroundTypeChange(backgroundType) {
    updateVisualAdCanvas({ backgroundType });

    if (backgroundType === "solid") {
      handleVisualAdBackgroundChange(null, { history: false });
    }
  }

  function clearVisualAdElementPreviewUrls() {
    visualAdForm.visualAdData.elements.forEach((element) => {
      if (element.type === "image" && String(element.url || "").startsWith("blob:")) {
        URL.revokeObjectURL(element.url);
      }
    });
  }

  function addVisualAdImage(file) {
    if (!file) return;

    pushVisualAdHistory();
    const id = `image-${Date.now()}`;
    const objectUrl = URL.createObjectURL(file);
    const maxZIndex = Math.max(0, ...visualAdForm.visualAdData.elements.map((element) => Number(element.zIndex) || 0));
    const nextElement = normalizeVisualAdElement({
      id,
      type: "image",
      url: objectUrl,
      storagePath: "",
      x: 28,
      y: 24,
      width: 34,
      opacity: 1,
      borderRadius: 0,
      zIndex: maxZIndex + 1,
    });

    setVisualAdDirty(true);
    setVisualAdElementFiles((current) => ({ ...current, [id]: file }));
    setVisualAdForm((current) => ({
      ...current,
      visualAdData: {
        ...current.visualAdData,
        elements: [...current.visualAdData.elements, nextElement],
      },
    }));
    setSelectedVisualElementId(id);
  }

  function replaceVisualAdImage(elementId, file) {
    if (!elementId || !file) return;

    pushVisualAdHistory();
    const objectUrl = URL.createObjectURL(file);
    setVisualAdDirty(true);
    setVisualAdElementFiles((current) => ({ ...current, [elementId]: file }));
    updateVisualAdElement(elementId, { url: objectUrl }, { history: false });
  }

  function addVisualAdText() {
    pushVisualAdHistory();
    const id = `text-${Date.now()}`;
    const nextElement = {
      ...DEFAULT_VISUAL_AD_ELEMENT,
      id,
      text: "Nuevo texto",
      y: Math.min(82, 12 + visualAdForm.visualAdData.elements.length * 10),
      zIndex: getNextVisualAdZIndex(visualAdForm.visualAdData.elements),
    };

    setVisualAdDirty(true);
    setVisualAdForm((current) => ({
      ...current,
      visualAdData: {
        ...current.visualAdData,
        elements: [...current.visualAdData.elements, nextElement],
      },
    }));
    setSelectedVisualElementId(id);
  }

  function applyVisualAdPreset(preset) {
    if (
      visualAdForm.visualAdData.elements.length > 0 &&
      !window.confirm("Este preset reemplazará los elementos actuales. ¿Continuar?")
    ) {
      return;
    }

    const nextElements = getVisualAdPresetElements(preset);
    pushVisualAdHistory();
    setVisualAdDirty(true);
    setVisualAdForm((current) => ({
      ...current,
      visualAdData: {
        ...current.visualAdData,
        elements: nextElements,
      },
    }));
    setSelectedVisualElementId(nextElements[0]?.id || "");
  }

  function alignVisualAdElement(alignment) {
    const element = getSelectedVisualElement(visualAdForm, selectedVisualElementId);
    if (!element) return;

    const width = clampNumber(element.width, 5, 100, element.type === "image" ? 30 : 50);
    const updates = {};

    if (alignment === "left") updates.x = 0;
    if (alignment === "center-x") updates.x = clampNumber((100 - width) / 2, 0, 100, 50);
    if (alignment === "right") updates.x = clampNumber(100 - width, 0, 100, 50);
    if (alignment === "top") updates.y = 0;
    if (alignment === "center-y") updates.y = 50;
    if (alignment === "bottom") updates.y = 86;

    updateVisualAdElement(element.id, updates);
  }

  function updateVisualAdElement(elementId, updates, options = {}) {
    if (options.history !== false) pushVisualAdHistory();
    setVisualAdDirty(true);
    setVisualAdForm((current) => ({
      ...current,
      visualAdData: {
        ...current.visualAdData,
        elements: current.visualAdData.elements.map((element) =>
          element.id === elementId ? normalizeVisualAdElement({ ...element, ...updates }) : element
        ),
      },
    }));
  }

  function duplicateVisualAdElement(element) {
    if (!element) return;

    pushVisualAdHistory();
    const id = `${element.type || "element"}-${Date.now()}`;
    const nextElement = normalizeVisualAdElement({
      ...element,
      id,
      x: clampNumber((Number(element.x) || 0) + 4, 0, 100, 10),
      y: clampNumber((Number(element.y) || 0) + 4, 0, 100, 10),
      zIndex: getNextVisualAdZIndex(visualAdForm.visualAdData.elements),
    });

    setVisualAdDirty(true);
    setVisualAdForm((current) => ({
      ...current,
      visualAdData: {
        ...current.visualAdData,
        elements: [...current.visualAdData.elements, nextElement],
      },
    }));
    if (element.type === "image" && visualAdElementFiles[element.id]) {
      setVisualAdElementFiles((current) => ({ ...current, [id]: current[element.id] }));
    }
    setSelectedVisualElementId(id);
  }

  function moveVisualAdLayer(elementId, direction) {
    const elements = visualAdForm.visualAdData.elements;
    const current = elements.find((element) => element.id === elementId);
    if (!current) return;

    const currentZ = Number(current.zIndex) || elements.findIndex((element) => element.id === elementId) + 1;
    const nextZ = direction > 0
      ? Math.min(999, currentZ + 1)
      : Math.max(0, currentZ - 1);

    updateVisualAdElement(elementId, { zIndex: nextZ });
  }

  function removeVisualAdElement(elementId) {
    pushVisualAdHistory();
    setVisualAdDirty(true);
    setVisualAdForm((current) => {
      const nextElements = current.visualAdData.elements.filter((element) => element.id !== elementId);
      const nextSelected = nextElements[0]?.id || "";
      setSelectedVisualElementId(nextSelected);

      return {
        ...current,
        visualAdData: {
          ...current.visualAdData,
          elements: nextElements,
        },
      };
    });
    setVisualAdElementFiles((current) => {
      const nextFiles = { ...current };
      delete nextFiles[elementId];
      return nextFiles;
    });
  }

  async function handleCreatePlaylist(event) {
    event.preventDefault();

    if (getPublishStatus(playlistForm.publishStatus) === "published") {
      const playlistToValidate = editingPlaylistId
        ? { ...(playlists.find((playlist) => playlist.id === editingPlaylistId) || {}), ...playlistForm }
        : { ...playlistForm, items: [] };
      const issue = getPlaylistPublishIssue(playlistToValidate);
      if (issue) {
        setMessage(issue);
        return;
      }
    }

    await runAction(async () => {
      if (editingPlaylistId) {
        await updateSignagePlaylist(editingPlaylistId, playlistForm);
        await audit("editar playlist", "playlist", editingPlaylistId, playlistForm.name, {
          plantel: playlistForm.plantel,
          publishStatus: playlistForm.publishStatus,
        });
        setSelectedPlaylistId(editingPlaylistId);
      } else {
        const playlist = await createSignagePlaylist(playlistForm, profile);
        setSelectedPlaylistId(playlist.id);
      }
      setPlaylistForm(DEFAULT_PLAYLIST_FORM);
      setEditingPlaylistId("");
    }, editingPlaylistId ? "Playlist actualizada." : "Playlist guardada.");
  }

  function editPlaylist(playlist) {
    setActiveTab("playlists");
    setSelectedPlaylistId(playlist.id);
    setEditingPlaylistId(playlist.id);
    setPlaylistForm({
      name: playlist.name || "",
      plantel: playlist.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
      publishStatus: getPublishStatus(playlist.publishStatus),
    });
  }

  async function duplicatePlaylist(playlist) {
    if (!playlist) return;

    await runAction(async () => {
      const copy = await createSignagePlaylist(
        {
          name: `${playlist.name || "Playlist"} copia`,
          plantel: playlist.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
          active: playlist.active !== false,
          publishStatus: "draft",
          items: playlist.items || [],
        },
        profile
      );
      await audit("duplicar playlist", "playlist", copy.id, copy.name, {
        sourcePlaylistId: playlist.id,
        sourceName: playlist.name || "",
        itemsCount: playlist.items?.length || 0,
      });
      setSelectedPlaylistId(copy.id);
      setEditingPlaylistId("");
      setPlaylistForm(DEFAULT_PLAYLIST_FORM);
    }, "Playlist duplicada.");
  }

  async function handleDeletePlaylist(playlist) {
    if (!playlist?.id) return;

    const usage = getPlaylistUsage(playlist.id, devices, campaigns);
    if (usage.total > 0) {
      setMessage(
        `No se puede eliminar "${playlist.name || "Playlist"}". ${formatPlaylistUsage(usage)} Desasigna primero para no dejar pantallas o campañas sin contenido.`
      );
      return;
    }

    if (!window.confirm(`¿Eliminar la playlist "${playlist.name || "sin nombre"}"? No se eliminarán assets.`)) return;

    await runAction(async () => {
      await deleteSignagePlaylist(playlist.id);
      await audit("eliminar playlist", "playlist", playlist.id, playlist.name, {
        itemsCount: playlist.items?.length || 0,
      });
      setSelectedPlaylistId("");
      if (editingPlaylistId === playlist.id) {
        setEditingPlaylistId("");
        setPlaylistForm(DEFAULT_PLAYLIST_FORM);
      }
    }, "Playlist eliminada.");
  }

  async function handleCampaignSubmit(event) {
    event.preventDefault();

    if (getPublishStatus(campaignForm.publishStatus) === "published") {
      const playlist = playlists.find((item) => item.id === campaignForm.playlistId) || null;
      const issue = getCampaignPublishIssue(campaignForm, playlist);
      if (issue) {
        setMessage(issue);
        return;
      }
    }

    await runAction(async () => {
      if (editingCampaignId) {
        await updateSignageCampaign(editingCampaignId, campaignForm);
        await audit("editar campana", "campaign", editingCampaignId, campaignForm.name, {
          playlistId: campaignForm.playlistId,
          priority: campaignForm.priority,
          scheduleEnabled: campaignForm.schedule?.enabled === true,
          publishStatus: campaignForm.publishStatus,
        });
      } else {
        await createSignageCampaign(campaignForm, profile);
      }

      setCampaignForm(DEFAULT_CAMPAIGN_FORM);
      setEditingCampaignId("");
    }, "Campaña guardada.");
  }

  function editCampaign(campaign) {
    setCampaignForm({
      name: campaign.name || "",
      plantel: campaign.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
      playlistId: campaign.playlistId || "",
      priority: campaign.priority || "normal",
      startDate: campaign.startDate || "",
      endDate: campaign.endDate || "",
      active: campaign.active !== false,
      publishStatus: getPublishStatus(campaign.publishStatus),
      schedule: normalizeCampaignScheduleForm(campaign.schedule),
    });
    setEditingCampaignId(campaign.id);
    setActiveTab("campaigns");
  }

  async function handleDeviceSubmit(event) {
    event.preventDefault();

    await runAction(async () => {
      if (editingDeviceId) {
        await updateSignageDevice(editingDeviceId, deviceForm);
        await audit("editar dispositivo", "device", editingDeviceId, deviceForm.name, {
          plantel: deviceForm.plantel,
          location: deviceForm.location,
          assignedPlaylistId: deviceForm.assignedPlaylistId,
        });
        setMessage("Dispositivo actualizado.");
      } else {
        const device = await createSignageDevice(deviceForm, profile);
        setSelectedDeviceId(device.id);
      }

      setDeviceForm(DEFAULT_DEVICE_FORM);
      setEditingDeviceId("");
      setDeviceFormOpen(false);
    }, editingDeviceId ? "Dispositivo actualizado." : "Dispositivo creado.");
  }

  async function handlePairingSubmit(event) {
    event.preventDefault();

    await runAction(async () => {
      const device = await claimPairingCode(pairingForm.code, pairingForm, profile);
      setSelectedDeviceId(device.id);
      setPairingForm(DEFAULT_PAIRING_FORM);
      setPairingFormOpen(false);
    }, "Pantalla vinculada.");
  }

  async function addAssetToPlaylist() {
    if (!selectedPlaylist || !assetToAddId) return;

    const asset = assets.find((item) => item.id === assetToAddId);
    if (!asset) return;

    const nextItems = [
      ...(selectedPlaylist.items || []),
      buildPlaylistItemFromAsset(asset),
    ];

    await runAction(async () => {
      await updateSignagePlaylist(selectedPlaylist.id, { items: nextItems });
      await audit("agregar contenido a playlist", "playlist", selectedPlaylist.id, selectedPlaylist.name, {
        assetId: asset.id,
        assetName: asset.title || "",
        itemsCount: nextItems.length,
      });
      setAssetToAddId("");
    }, "Playlist guardada.");
  }

  function prepareAssetForPlaylist(asset) {
    if (!playlists.length) {
      setMessage("Crea una playlist antes de agregar contenido.");
      setActiveTab("playlists");
      return;
    }

    setSelectedPlaylistId(selectedPlaylistId || playlists[0].id);
    setAssetToAddId(asset.id);
    setActiveTab("playlists");
    setMessage("Contenido listo para agregar. Elige la playlist y confirma con Agregar.");
  }

  async function editAssetOrganization(asset) {
    if (!asset?.id) return;

    const categoryInput = window.prompt(
      "Categoría: institucional, promocion, aviso, coffee, evento u otro",
      getAssetCategoryValue(asset.category)
    );
    if (categoryInput === null) return;

    const tagsInput = window.prompt("Etiquetas separadas por comas", getAssetTags(asset).join(", "));
    if (tagsInput === null) return;

    await runAction(async () => {
      await updateSignageAsset(asset.id, {
        category: getAssetCategoryValue(categoryInput),
        tags: parseAssetTags(tagsInput),
      });
      await audit("editar asset", "asset", asset.id, asset.title, {
        category: getAssetCategoryValue(categoryInput),
        tags: parseAssetTags(tagsInput),
      });
    }, "Contenido actualizado.");
  }

  function openEditWebAssetForm(asset) {
    if (!asset?.id || asset.type !== "web") return;

    setEditingWebAssetId(asset.id);
    setWebForm({
      title: asset.title || "",
      url: asset.url || "",
      plantel: asset.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
      durationSeconds: asset.durationSeconds || 20,
      webSettings: normalizeWebSettingsForForm(asset.webSettings),
    });
    setMessage("Editando opciones web. Guarda cambios en el panel lateral.");
  }

  async function sendWebReloadCommand(asset) {
    if (!asset?.id || asset.type !== "web") return;

    await runAction(
      () => sendWebAssetCommand(asset.id, { type: "reload" }, profile),
      "Recarga enviada a pantallas."
    );
  }

  async function toggleAssetArchive(asset) {
    if (!asset?.id) return;

    const usageCount = getAssetUsageCount(asset.id, assetUsageMap);
    const nextArchived = asset.archived !== true;

    if (
      nextArchived &&
      usageCount > 0 &&
      !window.confirm(`Este contenido está usado en ${usageCount} playlist${usageCount === 1 ? "" : "s"}. ¿Archivarlo de todos modos?`)
    ) {
      return;
    }

    await runAction(
      async () => {
        const publishStatus = nextArchived ? "archived" : "draft";
        await updateSignageAsset(asset.id, { archived: nextArchived, publishStatus });
        await syncAssetPublishStatusInPlaylists(asset.id, publishStatus);
        await audit(nextArchived ? "archivar asset" : "restaurar asset", "asset", asset.id, asset.title, {
          archived: nextArchived,
          publishStatus,
          usageCount,
        });
      },
      nextArchived ? "Contenido archivado." : "Contenido restaurado."
    );
  }

  async function duplicateAsset(asset) {
    if (!asset?.id) return;

    await runAction(
      () => duplicateSignageAsset(asset.id, profile),
      "Contenido duplicado."
    );
  }

  async function toggleAssetActive(asset) {
    if (!asset?.id) return;

    await runAction(async () => {
      const active = asset.active === false;
      await updateSignageAsset(asset.id, { active });
      await audit("activar/desactivar asset", "asset", asset.id, asset.title, { active });
    }, "Asset actualizado.");
  }

  async function removeAsset(asset) {
    if (!asset?.id) return;
    if (!window.confirm("¿Eliminar asset?")) return;

    await runAction(async () => {
      await deleteSignageAsset(asset.id);
      await audit("eliminar asset", "asset", asset.id, asset.title, {
        type: asset.type || "",
      });
    }, "Asset eliminado.");
  }

  async function changeAssetPublishStatus(asset, publishStatus) {
    if (!asset?.id) return;

    if (publishStatus === "published") {
      if (asset.type === "visual_ad" && !isVisualAdDataUsable(asset.visualAdData)) {
        setMessage("No se puede publicar un anuncio visual inválido.");
        return;
      }

      if (!window.confirm(`¿Publicar "${asset.title || "contenido"}" en pantallas reales?`)) return;
    }

    if (publishStatus === "archived" && !window.confirm(`¿Archivar "${asset.title || "contenido"}"?`)) return;

    await runAction(async () => {
      await updateSignageAsset(asset.id, {
        publishStatus,
        archived: publishStatus === "archived" ? true : asset.archived === true ? false : asset.archived,
      });
      await syncAssetPublishStatusInPlaylists(asset.id, publishStatus);
      await audit("cambiar publishStatus asset", "asset", asset.id, asset.title, {
        previousStatus: getPublishStatus(asset.publishStatus),
        publishStatus,
      });
    }, getPublishStatusMessage("Contenido", publishStatus));
  }

  async function syncAssetPublishStatusInPlaylists(assetId, publishStatus) {
    const affectedPlaylists = playlists.filter((playlist) =>
      (playlist.items || []).some((item) => item.assetId === assetId)
    );

    await Promise.all(
      affectedPlaylists.map((playlist) =>
        updateSignagePlaylist(playlist.id, {
          items: (playlist.items || []).map((item) =>
            item.assetId === assetId ? { ...item, publishStatus } : item
          ),
        })
      )
    );
  }

  async function changePlaylistPublishStatus(playlist, publishStatus) {
    if (!playlist?.id) return;

    if (publishStatus === "published") {
      const issue = getPlaylistPublishIssue(playlist);
      if (issue) {
        setMessage(issue);
        return;
      }

      if (!window.confirm(`¿Publicar playlist "${playlist.name || "sin nombre"}"?`)) return;
    }

    if (publishStatus === "archived" && !window.confirm(`¿Archivar playlist "${playlist.name || "sin nombre"}"?`)) return;

    await runAction(async () => {
      await updateSignagePlaylist(playlist.id, { publishStatus });
      await audit("cambiar publishStatus playlist", "playlist", playlist.id, playlist.name, {
        previousStatus: getPublishStatus(playlist.publishStatus),
        publishStatus,
      });
    }, getPublishStatusMessage("Playlist", publishStatus));
  }

  async function togglePlaylistActive(playlist) {
    if (!playlist?.id) return;

    await runAction(async () => {
      const active = playlist.active === false;
      await updateSignagePlaylist(playlist.id, { active });
      await audit("activar/desactivar playlist", "playlist", playlist.id, playlist.name, { active });
    }, "Playlist guardada.");
  }

  async function changeCampaignPublishStatus(campaign, publishStatus) {
    if (!campaign?.id) return;

    if (publishStatus === "published") {
      const playlist = playlists.find((item) => item.id === campaign.playlistId) || null;
      const issue = getCampaignPublishIssue(campaign, playlist);
      if (issue) {
        setMessage(issue);
        return;
      }

      if (!window.confirm(`¿Publicar campaña "${campaign.name || "sin nombre"}"?`)) return;
    }

    if (publishStatus === "archived" && !window.confirm(`¿Archivar campaña "${campaign.name || "sin nombre"}"?`)) return;

    await runAction(async () => {
      await updateSignageCampaign(campaign.id, { publishStatus });
      await audit("cambiar publishStatus campana", "campaign", campaign.id, campaign.name, {
        previousStatus: getPublishStatus(campaign.publishStatus),
        publishStatus,
      });
    }, getPublishStatusMessage("Campaña", publishStatus));
  }

  function buildPlaylistItemFromAsset(asset) {
    const baseItem = {
        assetId: asset.id,
        title: asset.title || "Contenido",
        type: asset.type || "image",
      url: asset.url || "",
      durationSeconds: asset.durationSeconds || 10,
      publishStatus: getPublishStatus(asset.publishStatus),
    };

    if (asset.type === "visual_ad") {
      return {
        ...baseItem,
        visualAdData: asset.visualAdData,
      };
    }

    if (asset.type === "web") {
      return {
        ...baseItem,
        webSettings: normalizeWebSettingsForSave(asset.webSettings),
      };
    }

    if (asset.type !== "template") return baseItem;

    return {
      ...baseItem,
      templateKey: asset.templateKey || "aviso",
      templateData: asset.templateData || { title: asset.title || "Contenido" },
      templateTheme: asset.templateTheme || "azul",
    };
  }

  async function updatePlaylistItems(items, successMessage = "Playlist guardada.") {
    if (!selectedPlaylist) return;

    await runAction(async () => {
      await updateSignagePlaylist(selectedPlaylist.id, { items });
      await audit("editar contenido de playlist", "playlist", selectedPlaylist.id, selectedPlaylist.name, {
        previousItemsCount: selectedPlaylist.items?.length || 0,
        itemsCount: items.length,
      });
    }, successMessage);
  }

  async function copyPlayerUrl(device) {
    const url = getPlayerUrl(device.deviceToken || device.id);

    try {
      await navigator.clipboard.writeText(url);
      setMessage("URL copiada.");
    } catch {
      setMessage(url);
    }
  }

  async function assignDevicePlaylist(device, playlistId) {
    if (!device?.id) return;

    await runAction(async () => {
      await updateSignageDevice(device.id, { assignedPlaylistId: playlistId });
      await audit(playlistId ? "asignar playlist a dispositivo" : "quitar contenido de dispositivo", "device", device.id, device.name, {
        previousPlaylistId: device.assignedPlaylistId || "",
        assignedPlaylistId: playlistId || "",
      });
    }, playlistId ? "Playlist asignada." : "Contenido asignado removido.");
  }

  function clearDeviceContent(device) {
    if (!window.confirm("Esta pantalla quedará sin contenido asignado. ¿Continuar?")) return;
    assignDevicePlaylist(device, "");
  }

  async function toggleDeviceActive(device) {
    if (!device?.id) return;

    await runAction(async () => {
      const active = device.active === false;
      await updateSignageDevice(device.id, { active });
      await audit("activar/desactivar dispositivo", "device", device.id, device.name, { active });
    }, "Dispositivo actualizado.");
  }

  async function removeDevice(device) {
    if (!device?.id) return;
    if (!window.confirm("¿Eliminar dispositivo?")) return;

    await runAction(async () => {
      await deleteSignageDevice(device.id);
      await audit("eliminar dispositivo", "device", device.id, device.name);
    }, "Dispositivo eliminado.");
  }

  function openNewDeviceForm() {
    setActiveTab("devices");
    setPairingFormOpen(false);
    setEditingDeviceId("");
    setDeviceForm(DEFAULT_DEVICE_FORM);
    setDeviceFormOpen(true);
    window.setTimeout(() => deviceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function openPairingForm() {
    setActiveTab("devices");
    setDeviceFormOpen(false);
    setEditingDeviceId("");
    setPairingForm(DEFAULT_PAIRING_FORM);
    setPairingFormOpen(true);
    window.setTimeout(() => deviceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  function openEditDeviceForm(device) {
    setActiveTab("devices");
    setPairingFormOpen(false);
    setSelectedDeviceId(device.id);
    setEditingDeviceId(device.id);
    setDeviceForm({
      name: device.name || "",
      plantel: device.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
      location: device.location || "",
      assignedPlaylistId: device.assignedPlaylistId || "",
    });
    setDeviceFormOpen(true);
    window.setTimeout(() => deviceFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  if (!isAdmin) {
    return (
      <section className="printshop-page digital-signage-page">
        <div className="printshop-topbar digital-signage-header">
          <div className="printshop-topbar-main">
            <span className="printshop-topbar-module-icon">
              <SignageIcon name="screen" />
            </span>
            <div className="printshop-topbar-copy">
              <p className="section-kicker printshop-kicker">Administración</p>
              <h1>Digital Signage</h1>
              <p>Módulo disponible solo para administradores.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="printshop-page digital-signage-page signage-admin-shell">
      <section className="printshop-topbar digital-signage-header">
        <div className="printshop-topbar-main">
          <span className="printshop-topbar-module-icon">
            <SignageIcon name="screen" />
          </span>
          <div className="printshop-topbar-copy">
            <p className="section-kicker printshop-kicker">Módulo operativo</p>
            <h1>Digital Signage</h1>
            <p>
              Administra contenido, playlists y dispositivos para las pantallas institucionales.
            </p>
          </div>
        </div>
      </section>

      <section className="signage-kpi-grid">
        <KpiCard icon="file" title="Contenidos activos" value={activeAssets.length} helper="Publicados actualmente" tone="blue" />
        <KpiCard icon="list" title="Playlists" value={playlists.length} helper="Playlists creadas" tone="green" />
        <KpiCard icon="screen" title="Dispositivos en línea" value={onlineDevices.length} helper={`de ${devices.length} dispositivos`} tone="purple" />
        <KpiCard icon="warning" title="Sin contenido" value={unassignedDevices.length} helper="Pantallas sin asignar" tone="orange" />
      </section>

      <section className="printshop-section-tabs signage-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "active" : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className="printshop-tab-icon">
              <SignageIcon name={tab.icon} />
            </span>
            {tab.label}
          </button>
        ))}
      </section>

      {message && <p className="digital-signage-message">{message}</p>}
      {loading ? <div className="signage-panel">Cargando Digital Signage...</div> : null}

      {!loading && activeTab === "devices" && (
        <SignageDevicesPanel
          devices={devices}
          filteredDevices={filteredDevices}
          selectedDevice={selectedDevice}
          selectedDevicePlaylist={selectedDevicePlaylist}
          playlists={playlists}
          activeCampaignByDeviceId={activeCampaignByDeviceId}
          saving={saving}
          devicesViewMode={devicesViewMode}
          deviceSearch={deviceSearch}
          deviceFilter={deviceFilter}
          pairingFormOpen={pairingFormOpen}
          pairingForm={pairingForm}
          deviceFormOpen={deviceFormOpen}
          deviceForm={deviceForm}
          editingDeviceId={editingDeviceId}
          deviceFormRef={deviceFormRef}
          onOpenPairingForm={openPairingForm}
          onOpenNewDeviceForm={openNewDeviceForm}
          onDeviceSearchChange={setDeviceSearch}
          onDeviceFilterChange={setDeviceFilter}
          onDevicesViewModeChange={setDevicesViewMode}
          onPairingSubmit={handlePairingSubmit}
          onPairingFormChange={setPairingForm}
          onClosePairingForm={() => {
            setPairingFormOpen(false);
            setPairingForm(DEFAULT_PAIRING_FORM);
          }}
          onDeviceSubmit={handleDeviceSubmit}
          onDeviceFormChange={setDeviceForm}
          onCloseDeviceForm={() => {
            setDeviceFormOpen(false);
            setEditingDeviceId("");
            setDeviceForm(DEFAULT_DEVICE_FORM);
          }}
          onSelectDevice={setSelectedDeviceId}
          onEditDevice={openEditDeviceForm}
          onCopyPlayerUrl={copyPlayerUrl}
          onAssignDevicePlaylist={assignDevicePlaylist}
          onClearDeviceContent={clearDeviceContent}
          onToggleDeviceActive={toggleDeviceActive}
          onRemoveDevice={removeDevice}
          onPlaylists={() => setActiveTab("playlists")}
          onContent={() => setActiveTab("library")}
          onPreview={() => setActiveTab("preview")}
          SignageIcon={SignageIcon}
          PlantelSelect={PlantelSelect}
          DeviceCard={DeviceCard}
          DeviceMonitorGrid={DeviceMonitorGrid}
          QuickDevicePreview={QuickDevicePreview}
          QuickActions={QuickActions}
        />
      )}

      {!loading && activeTab === "campaigns" && (
        <SignageCampaignsPanel
          campaigns={campaigns}
          playlists={playlists}
          form={campaignForm}
          editingCampaignId={editingCampaignId}
          saving={saving}
          onFormChange={setCampaignForm}
          onSubmit={handleCampaignSubmit}
          onEdit={editCampaign}
          onCancelEdit={() => {
            setCampaignForm(DEFAULT_CAMPAIGN_FORM);
            setEditingCampaignId("");
          }}
          onToggle={(campaign) =>
            runAction(
              async () => {
                const active = campaign.active === false;
                await updateSignageCampaign(campaign.id, { active });
                await audit("activar/desactivar campana", "campaign", campaign.id, campaign.name, { active });
              },
              "Campaña guardada."
            )
          }
          onPublishStatusChange={changeCampaignPublishStatus}
          onViewPlaylist={(playlistId) => {
            if (!playlistId) {
              setMessage("Esta campaña no tiene playlist asignada.");
              return;
            }
            setSelectedPlaylistId(playlistId);
            setActiveTab("playlists");
          }}
          onDelete={(campaign) =>
            window.confirm("¿Eliminar campaña?") &&
            runAction(async () => {
              await deleteSignageCampaign(campaign.id);
              await audit("eliminar campana", "campaign", campaign.id, campaign.name);
            }, "Campaña eliminada.")
          }
          PlantelSelect={PlantelSelect}
          StatusBadge={StatusBadge}
          PublishStatusBadge={PublishStatusBadge}
          InfoPair={InfoPair}
          getCampaignDisplayStatus={getCampaignDisplayStatus}
          getCampaignPriorityLabel={getCampaignPriorityLabel}
          getPlaylistItemCountLabel={getPlaylistItemCountLabel}
          normalizeCampaignScheduleForm={normalizeCampaignScheduleForm}
          formatCampaignSchedule={formatCampaignSchedule}
        />
      )}

      {!loading && activeTab === "health" && (
        <SignageHealthPanel
          rows={healthRows}
          stats={healthStats}
          search={healthSearch}
          filter={healthFilter}
          onSearchChange={setHealthSearch}
          onFilterChange={setHealthFilter}
          onOpenDevice={(device) => {
            setSelectedDeviceId(device.id);
            setActiveTab("devices");
          }}
          onCopyDeviceUrl={copyPlayerUrl}
          SignageIcon={SignageIcon}
          StatusBadge={StatusBadge}
          InfoPair={InfoPair}
          formatLastSeen={formatLastSeen}
          getMaskedDeviceToken={getMaskedDeviceToken}
        />
      )}

      {!loading && activeTab === "playback" && (
        <SignagePlaybackPanel
          logs={filteredPlaybackLogs}
          allLogs={playbackLogs}
          stats={playbackStats}
          devices={devices}
          playlists={playlists}
          campaigns={campaigns}
          deviceFilter={playbackDeviceFilter}
          plantelFilter={playbackPlantelFilter}
          eventFilter={playbackEventFilter}
          assetFilter={playbackAssetFilter}
          campaignFilter={playbackCampaignFilter}
          playlistFilter={playbackPlaylistFilter}
          rangeFilter={playbackRangeFilter}
          onDeviceFilterChange={setPlaybackDeviceFilter}
          onPlantelFilterChange={setPlaybackPlantelFilter}
          onEventFilterChange={setPlaybackEventFilter}
          onAssetFilterChange={setPlaybackAssetFilter}
          onCampaignFilterChange={setPlaybackCampaignFilter}
          onPlaylistFilterChange={setPlaybackPlaylistFilter}
          onRangeFilterChange={setPlaybackRangeFilter}
          SignageIcon={SignageIcon}
          TypeBadge={TypeBadge}
          InfoPair={InfoPair}
        />
      )}

      {!loading && activeTab === "history" && (
        <SignageHistoryPanel
          logs={filteredAuditLogs}
          totalCount={auditLogs.length}
          stats={auditStats}
          search={auditSearch}
          entityFilter={auditEntityFilter}
          rangeFilter={auditRangeFilter}
          onSearchChange={setAuditSearch}
          onEntityFilterChange={setAuditEntityFilter}
          onRangeFilterChange={setAuditRangeFilter}
          onClearFilters={() => {
            setAuditSearch("");
            setAuditEntityFilter("all");
            setAuditRangeFilter("7");
          }}
          SignageIcon={SignageIcon}
          TypeBadge={TypeBadge}
          InfoPair={InfoPair}
        />
      )}

      {!loading && activeTab === "library" && (
        <SignageLibraryPanel
          visualAdFormOpen={visualAdFormOpen}
          visualAdForm={visualAdForm}
          editingVisualAdId={editingVisualAdId}
          visualAdDirty={visualAdDirty}
          visualAdDraftStatus={visualAdDraftStatus}
          visualAdBackgroundPreview={visualAdBackgroundPreview}
          selectedVisualElementId={selectedVisualElementId}
          visualTemplates={visualTemplates}
          visualAdHistory={visualAdHistory}
          visualAdFuture={visualAdFuture}
          visualAdZoom={visualAdZoom}
          saving={saving}
          assets={assets}
          filteredAssets={filteredAssets}
          assetSearch={assetSearch}
          assetTypeFilter={assetTypeFilter}
          assetPlantelFilter={assetPlantelFilter}
          assetCategoryFilter={assetCategoryFilter}
          assetStatusFilter={assetStatusFilter}
          assetPublishFilter={assetPublishFilter}
          assetSort={assetSort}
          assetUsageMap={assetUsageMap}
          templateFormOpen={templateFormOpen}
          templateForm={templateForm}
          assetForm={assetForm}
          webForm={webForm}
          editingWebAssetId={editingWebAssetId}
          onVisualAdSubmit={handleCreateVisualAdAsset}
          onVisualAdCancel={closeVisualAdEditor}
          onSaveTemplate={handleSaveVisualTemplate}
          onApplyTemplate={applyVisualTemplate}
          onEditTemplate={editVisualTemplate}
          onToggleTemplate={toggleVisualTemplate}
          onDeleteTemplate={removeVisualTemplate}
          onUndoVisualAd={undoVisualAdChange}
          onRedoVisualAd={redoVisualAdChange}
          onZoomIn={() => zoomVisualAd(VISUAL_AD_ZOOM_STEP)}
          onZoomOut={() => zoomVisualAd(-VISUAL_AD_ZOOM_STEP)}
          onZoomFit={fitVisualAdCanvas}
          onVisualAdFieldChange={updateVisualAdField}
          onVisualAdCanvasChange={updateVisualAdCanvas}
          onVisualAdBackgroundTypeChange={handleVisualAdBackgroundTypeChange}
          onVisualAdBackgroundChange={handleVisualAdBackgroundChange}
          onSelectVisualElement={setSelectedVisualElementId}
          onAddVisualAdText={addVisualAdText}
          onAddVisualAdImage={addVisualAdImage}
          onApplyVisualAdPreset={applyVisualAdPreset}
          onAlignVisualAdElement={alignVisualAdElement}
          onDuplicateVisualAdElement={duplicateVisualAdElement}
          onMoveVisualAdLayer={(direction) => moveVisualAdLayer(selectedVisualElementId, direction)}
          onVisualAdElementChange={(updates) => updateVisualAdElement(selectedVisualElementId, updates)}
          onVisualAdCanvasElementChange={updateVisualAdElement}
          onVisualAdCanvasInteractionStart={pushVisualAdHistory}
          onDeleteVisualAdElement={() => removeVisualAdElement(selectedVisualElementId)}
          onReplaceVisualAdImage={(file) => replaceVisualAdImage(selectedVisualElementId, file)}
          onOpenDriveImportModal={openDriveImportModal}
          onToggleTemplateForm={() => setTemplateFormOpen((current) => !current)}
          onOpenNewVisualAdEditor={openNewVisualAdEditor}
          onAssetSearchChange={setAssetSearch}
          onAssetTypeFilterChange={setAssetTypeFilter}
          onAssetPlantelFilterChange={setAssetPlantelFilter}
          onAssetCategoryFilterChange={setAssetCategoryFilter}
          onAssetStatusFilterChange={setAssetStatusFilter}
          onAssetPublishFilterChange={setAssetPublishFilter}
          onAssetSortChange={setAssetSort}
          onClearAssetFilters={() => {
            setAssetSearch("");
            setAssetTypeFilter("all");
            setAssetPlantelFilter("all");
            setAssetCategoryFilter("all");
            setAssetStatusFilter("current");
            setAssetPublishFilter("all");
            setAssetSort("recent");
          }}
          onEditVisualAdAsset={openEditVisualAdEditor}
          onEditAssetOrganization={editAssetOrganization}
          onPrepareAssetForPlaylist={prepareAssetForPlaylist}
          onOpenEditWebAssetForm={openEditWebAssetForm}
          onSendWebReloadCommand={sendWebReloadCommand}
          onDuplicateAsset={duplicateAsset}
          onToggleAssetActive={toggleAssetActive}
          onChangeAssetPublishStatus={changeAssetPublishStatus}
          onToggleAssetArchive={toggleAssetArchive}
          onRemoveAsset={removeAsset}
          onCreateTemplateAsset={handleCreateTemplateAsset}
          onTemplateFormChange={setTemplateForm}
          onUploadAsset={handleUploadAsset}
          onAssetFormChange={setAssetForm}
          onAssetFileChange={setAssetFile}
          onCreateWebAsset={handleCreateWebAsset}
          onWebFormChange={setWebForm}
          onWebSettingsChange={updateWebFormSettings}
          onResetWebAssetForm={resetWebAssetForm}
          VisualAdEditor={VisualAdEditor}
          AssetThumb={AssetThumb}
          TypeBadge={TypeBadge}
          StatusBadge={StatusBadge}
          PublishStatusBadge={PublishStatusBadge}
          PlantelSelect={PlantelSelect}
          getAssetTypeLabel={getAssetTypeLabel}
          getAssetCategoryLabel={getAssetCategoryLabel}
          getAssetCategoryValue={getAssetCategoryValue}
          getAssetUsageLabel={getAssetUsageLabel}
          getAssetTags={getAssetTags}
        />
      )}

      <DriveImportModal
        open={driveImportOpen}
        files={filteredDriveImportFiles}
        folders={driveImportFolders}
        folderId={driveImportFolderId}
        breadcrumbs={driveImportBreadcrumbs}
        search={driveImportSearch}
        type={driveImportType}
        loading={driveImportLoading}
        saving={saving}
        selectedFile={selectedDriveImportFile}
        form={driveImportForm}
        error={driveImportError}
        assets={assets}
        onClose={closeDriveImportModal}
        onSearchChange={setDriveImportSearch}
        onTypeChange={(value) => {
          setDriveImportType(value);
        }}
        onSearch={handleDriveImportSearch}
        onOpenFolder={openDriveImportFolder}
        onBackFolder={goBackDriveImportFolder}
        onBreadcrumbClick={goToDriveImportBreadcrumb}
        onSelectFile={selectDriveImportFile}
        onFormChange={(updates) => setDriveImportForm((current) => ({ ...current, ...updates }))}
        onSubmit={handleImportDriveAsset}
        SignageIcon={SignageIcon}
        PlantelSelect={PlantelSelect}
      />

      {!loading && activeTab === "playlists" && (
        <SignagePlaylistsPanel
          playlists={playlists}
          selectedPlaylist={selectedPlaylist}
          effectiveSelectedPlaylistId={effectiveSelectedPlaylistId}
          activeAssets={activeAssets}
          assetToAddId={assetToAddId}
          playlistForm={playlistForm}
          editingPlaylistId={editingPlaylistId}
          saving={saving}
          onSelectPlaylist={setSelectedPlaylistId}
          onEditPlaylist={editPlaylist}
          onDuplicatePlaylist={duplicatePlaylist}
          onTogglePlaylistActive={togglePlaylistActive}
          onPlaylistPublishStatusChange={changePlaylistPublishStatus}
          onDeletePlaylist={handleDeletePlaylist}
          onAssetToAddChange={setAssetToAddId}
          onAddAssetToPlaylist={addAssetToPlaylist}
          onPlaylistItemsChange={updatePlaylistItems}
          onSubmitPlaylist={handleCreatePlaylist}
          onPlaylistFormChange={setPlaylistForm}
          onCancelPlaylistEdit={() => {
            setEditingPlaylistId("");
            setPlaylistForm(DEFAULT_PLAYLIST_FORM);
          }}
          StatusBadge={StatusBadge}
          PublishStatusBadge={PublishStatusBadge}
          PlantelSelect={PlantelSelect}
          PlaylistItemsEditor={PlaylistItemsEditor}
          SignagePreviewCard={SignagePreviewCard}
          getPlaylistItemCountLabel={getPlaylistItemCountLabel}
          getPlaylistDurationSeconds={getPlaylistDurationSeconds}
          getPlaylistSummary={getPlaylistSummary}
          getPlaylistPublishIssue={getPlaylistPublishIssue}
          formatDuration={formatDuration}
        />
      )}

      {!loading && activeTab === "preview" && (
        <SignagePreviewPanel
          previewMode={previewMode}
          previewPlaylist={previewPlaylist}
          previewCampaign={previewCampaign}
          previewDevice={previewDevice}
          playlists={playlists}
          campaigns={campaigns}
          devices={devices}
          activeCampaign={previewDevice ? activeCampaignByDeviceId.get(previewDevice.id) : null}
          onPreviewModeChange={setPreviewMode}
          onPreviewPlaylistChange={setPreviewPlaylistId}
          onPreviewCampaignChange={setPreviewCampaignId}
          onPreviewDeviceChange={setPreviewDeviceId}
          onNewDevice={openNewDeviceForm}
          onPlaylists={() => setActiveTab("playlists")}
          onContent={() => setActiveTab("library")}
          onPreview={() => setActiveTab("preview")}
          SignagePreview={SignagePreview}
          PreviewMeta={PreviewMeta}
          QuickActions={QuickActions}
          getPreviewContextLabel={getPreviewContextLabel}
          getShortDeviceId={getShortDeviceId}
        />
      )}
    </section>
  );
}

function KpiCard({ icon, title, value, helper, tone }) {
  return (
    <article className={`signage-kpi-card ${tone}`}>
      <span>
        <SignageIcon name={icon} />
      </span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        <p>{helper}</p>
      </div>
    </article>
  );
}

function DeviceCard({
  device,
  active,
  playlists,
  saving,
  onSelect,
  onEdit,
  onCopy,
  onPlaylistChange,
  onClearContent,
  onToggle,
  onDelete,
  activeCampaign,
}) {
  const status = getDeviceStatus(device);
  const playlistName = getPlaylistName(device.assignedPlaylistId, playlists);
  const contentSource = activeCampaign
    ? `Campaña activa: ${activeCampaign.name || "Sin nombre"}`
    : playlistName
      ? `Playlist directa: ${playlistName}`
      : "Sin contenido asignado";

  return (
    <article className={`signage-device-card ${active ? "selected" : ""}`} onClick={onSelect}>
      <div className={`signage-device-icon ${status}`}>
        <SignageIcon name="screen" />
      </div>

      <div className="signage-device-main">
        <div className="signage-device-title-row">
          <div>
            <strong>{device.name || "Pantalla sin nombre"}</strong>
            <span>{getShortDeviceId(device)}</span>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="signage-device-meta-grid">
          <InfoPair label="Plantel" value={device.plantel || "Sin plantel"} />
          <InfoPair label="Ubicación" value={device.location || "Sin ubicación"} />
          <InfoPair label="Contenido actual" value={contentSource} strong />
          <InfoPair label="Playlist fallback" value={playlistName || "Sin contenido"} />
          <InfoPair label="Última conexión" value={formatLastSeen(device)} />
        </div>

        <div className="signage-device-actions">
          <button type="button" className="visual-outline-button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>
            <SignageIcon name="edit" />
            Editar
          </button>
          <label onClick={(event) => event.stopPropagation()}>
            <SignageIcon name="list" />
            <select value={device.assignedPlaylistId || ""} onChange={(event) => onPlaylistChange(event.target.value)} disabled={saving}>
              <option value="">Asignar playlist</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>{playlist.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="visual-outline-button"
            onClick={(event) => { event.stopPropagation(); onClearContent(); }}
            disabled={saving || !device.assignedPlaylistId}
          >
            Quitar contenido
          </button>
          <details className="signage-action-menu" onClick={(event) => event.stopPropagation()}>
            <summary>Más</summary>
            <div className="signage-action-menu-popover">
              <button type="button" onClick={onCopy} disabled={saving}>
                Copiar URL
              </button>
              <button type="button" onClick={onToggle} disabled={saving}>
                {device.active === false ? "Activar" : "Desactivar"}
              </button>
              <button type="button" className="danger" onClick={onDelete} disabled={saving}>
                Eliminar
              </button>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

function DeviceMonitorGrid({
  devices,
  selectedDevice,
  playlists,
  activeCampaignByDeviceId,
  saving,
  onSelect,
  onEdit,
  onCopy,
  onPlaylistChange,
  onClearContent,
}) {
  if (devices.length === 0) {
    return <p className="digital-empty">Sin dispositivos para mostrar.</p>;
  }

  return (
    <div className="signage-device-monitor-grid">
      {devices.map((device) => {
        const activeCampaign = activeCampaignByDeviceId.get(device.id);
        const playlist = getDevicePreviewPlaylist(device, playlists, activeCampaign);

        return (
          <DeviceMonitorCard
            key={device.id}
            device={device}
            active={selectedDevice?.id === device.id}
            playlist={playlist}
            playlists={playlists}
            activeCampaign={activeCampaign}
            saving={saving}
            onSelect={() => onSelect(device)}
            onEdit={() => onEdit(device)}
            onCopy={() => onCopy(device)}
            onPlaylistChange={(playlistId) => onPlaylistChange(device, playlistId)}
            onClearContent={() => onClearContent(device)}
          />
        );
      })}
    </div>
  );
}

function DeviceMonitorCard({
  device,
  active,
  playlist,
  playlists,
  activeCampaign,
  saving,
  onSelect,
  onEdit,
  onCopy,
  onPlaylistChange,
  onClearContent,
}) {
  const status = getDeviceStatus(device);
  const item = getMonitorPreviewItem(playlist);
  const contentSource = activeCampaign
    ? `Campaña: ${activeCampaign.name || "Sin nombre"}`
    : playlist?.name
      ? `Playlist: ${playlist.name}`
      : "Sin contenido";

  return (
    <article className={`signage-device-monitor-card ${active ? "selected" : ""}`} onClick={onSelect}>
      <DeviceMonitorThumb item={item} />

      <div className="signage-device-monitor-body">
        <div className="signage-device-monitor-title">
          <div>
            <strong>{device.name || "Pantalla sin nombre"}</strong>
            <span>{device.plantel || "Sin plantel"} · {device.location || "Sin ubicación"}</span>
          </div>
          <StatusBadge status={status} />
        </div>

        <div className="signage-device-monitor-meta">
          <InfoPair label="Contenido actual" value={contentSource} strong />
          <InfoPair label="Última conexión" value={formatLastSeen(device)} />
        </div>

        <div className="signage-device-monitor-actions">
          <button type="button" className="visual-outline-button" onClick={(event) => { event.stopPropagation(); onEdit(); }} disabled={saving}>
            Editar
          </button>
          <label onClick={(event) => event.stopPropagation()}>
            <select value={device.assignedPlaylistId || ""} onChange={(event) => onPlaylistChange(event.target.value)} disabled={saving}>
              <option value="">Asignar playlist</option>
              {playlists.map((playlistOption) => (
                <option key={playlistOption.id} value={playlistOption.id}>{playlistOption.name}</option>
              ))}
            </select>
          </label>
          <button type="button" className="visual-outline-button" onClick={(event) => { event.stopPropagation(); onClearContent(); }} disabled={saving || !device.assignedPlaylistId}>
            Quitar contenido
          </button>
          <details className="signage-action-menu" onClick={(event) => event.stopPropagation()}>
            <summary>Más</summary>
            <div className="signage-action-menu-popover">
              <button type="button" onClick={onCopy} disabled={saving}>
                Copiar URL
              </button>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

function DeviceMonitorThumb({ item }) {
  if (!item) {
    return (
      <div className="signage-device-monitor-thumb empty">
        <SignageIcon name="screen" />
        <strong>Sin contenido</strong>
      </div>
    );
  }

  if (item.type === "image") {
    return (
      <div className="signage-device-monitor-thumb">
        <img src={item.url} alt={item.title || "Contenido"} loading="lazy" />
      </div>
    );
  }

  if (item.type === "template") {
    return (
      <div className="signage-device-monitor-thumb">
        <TemplatePreview item={item} />
      </div>
    );
  }

  if (item.type === "visual_ad") {
    return (
      <div className="signage-device-monitor-thumb">
        <VisualAdPreview visualAdData={item.visualAdData} mini />
      </div>
    );
  }

  if (item.type === "video") {
    return (
      <div className="signage-device-monitor-thumb placeholder">
        <SignageIcon name="screen" />
        <strong>Video</strong>
        <span>{item.title || "Contenido de video"}</span>
      </div>
    );
  }

  if (item.type === "web") {
    return (
      <div className="signage-device-monitor-thumb placeholder">
        <strong>WEB</strong>
        <span>{getShortText(item.url || item.title || "Enlace web")}</span>
      </div>
    );
  }

  return (
    <div className="signage-device-monitor-thumb empty">
      <strong>Vista no disponible</strong>
    </div>
  );
}

function QuickDevicePreview({ device, playlist, activeCampaign }) {
  const firstItem = playlist?.items?.[0] || null;

  if (!device) {
    return (
      <section className="signage-panel signage-preview-card">
        <h3>Vista rápida del dispositivo</h3>
        <div className="signage-monitor-preview">
          <div>
            <SignageIcon name="screen" />
            <strong>Sin dispositivo seleccionado</strong>
          </div>
        </div>
        <p className="digital-empty">Selecciona una pantalla registrada para ver su estado y playlist asignada.</p>
      </section>
    );
  }

  return (
    <section className="signage-panel signage-preview-card">
      <h3>Vista rápida del dispositivo</h3>
      <div className="signage-monitor-preview">
        {firstItem?.type === "image" && <img src={firstItem.url} alt={firstItem.title || "Preview"} />}
        {firstItem?.type === "video" && <video src={firstItem.url} muted playsInline />}
        {firstItem?.type === "web" && <iframe src={firstItem.url} title={firstItem.title || "Preview"} />}
        {!firstItem && (
          <div>
            <SignageIcon name="screen" />
            <strong>Sin contenido asignado</strong>
          </div>
        )}
      </div>

      <div className="signage-preview-details">
        <InfoPair label="Nombre del dispositivo" value={device.name || "Sin dispositivo"} />
        <InfoPair label="ID del dispositivo" value={getShortDeviceId(device)} />
        <InfoPair label="Resolución" value="No registrada" />
        <InfoPair label="Fuente" value={activeCampaign ? `Campaña: ${activeCampaign.name || "Sin nombre"}` : "Playlist fallback"} />
        <InfoPair label="Playlist asignada" value={playlist?.name || "Sin contenido"} strong />
        <InfoPair label="Estado" value={<StatusBadge status={device ? getDeviceStatus(device) : "offline"} />} />
        <InfoPair label="Última conexión" value={device ? formatLastSeen(device) : "Sin conexión"} />
      </div>
    </section>
  );
}

function QuickActions({ onNewDevice, onPlaylists, onContent, onPreview }) {
  return (
    <section className="signage-panel signage-quick-actions">
      <h3>Accesos rápidos</h3>
      <div>
        <button type="button" onClick={onNewDevice}><SignageIcon name="plus" />Nuevo dispositivo</button>
        <button type="button" onClick={onPlaylists}><SignageIcon name="list" />Gestionar playlists</button>
        <button type="button" onClick={onContent}><SignageIcon name="calendar" />Programar contenido</button>
        <button type="button" onClick={onPreview}><SignageIcon name="eye" />Vista previa global</button>
        <button type="button" disabled><SignageIcon name="chart" />Reportes</button>
        <button type="button" disabled><SignageIcon name="settings" />Configuración</button>
      </div>
    </section>
  );
}

function SignagePreviewCard({ playlist }) {
  return (
    <section className="signage-panel">
      <h3>Vista rápida de playlist</h3>
      <SignagePreview playlist={playlist} contextLabel={playlist ? `Playlist: ${playlist.name}` : ""} />
    </section>
  );
}

function PreviewMeta({ mode, playlist, campaign, device, activeCampaign }) {
  const emptyText = {
    playlist: "Selecciona una playlist para revisar su contenido.",
    campaign: "Selecciona una campaña para revisar la playlist programada.",
    device: "Selecciona un dispositivo para revisar su contenido activo.",
  };

  if (!playlist) {
    return <p className="digital-empty">{emptyText[mode]}</p>;
  }

  return (
    <div className="signage-preview-meta-list">
      {mode === "playlist" && (
        <>
          <InfoPair label="Previsualizando" value={`Playlist: ${playlist.name}`} strong />
          <InfoPair label="Plantel" value={playlist.plantel || "Sin plantel"} />
        </>
      )}
      {mode === "campaign" && (
        <>
          <InfoPair label="Previsualizando" value={`Campaña: ${campaign?.name || "Sin campaña"}`} strong />
          <InfoPair label="Playlist usada" value={playlist.name || "Sin playlist"} />
          <InfoPair label="Programación" value={formatCampaignSchedule(campaign?.schedule)} />
        </>
      )}
      {mode === "device" && (
        <>
          <InfoPair label="Previsualizando" value={`Dispositivo: ${device?.name || "Sin dispositivo"}`} strong />
          <InfoPair label="Fuente" value={activeCampaign ? `Campaña: ${activeCampaign.name || "Sin nombre"}` : "Playlist fallback"} />
          <InfoPair label="Playlist usada" value={playlist.name || "Sin playlist"} />
        </>
      )}
      <InfoPair label="Contenidos" value={getPlaylistItemCountLabel(playlist)} />
      <InfoPair label="Duración total" value={formatDuration(getPlaylistDurationSeconds(playlist))} />
      {!playlist.items?.length && <p className="signage-warning-note">Esta selección no tiene contenido reproducible.</p>}
    </div>
  );
}

function InfoPair({ label, value, strong = false }) {
  return (
    <div className="signage-info-pair">
      <span>{label}</span>
      {typeof value === "string" ? <strong className={strong ? "linkish" : ""}>{value}</strong> : value}
    </div>
  );
}

function StatusBadge({ status }) {
  const labels = {
    online: "En línea",
    offline: "Desconectado",
    "no-connection": "Sin conexión registrada",
    unassigned: "Sin contenido",
    inactive: "Inactivo",
    active: "Activo",
    scheduled: "Programada",
    ended: "Finalizada",
  };

  return <span className={`signage-status-badge ${status}`}>{labels[status] || status}</span>;
}

function TypeBadge({ type }) {
  return (
    <span className={`signage-type-badge ${type || "unknown"}`}>
      {getAssetTypeLabel(type)}
    </span>
  );
}

function PublishStatusBadge({ status }) {
  const normalizedStatus = getPublishStatus(status);

  return (
    <span className={`signage-publish-badge ${normalizedStatus}`}>
      {getPublishStatusLabel(normalizedStatus)}
    </span>
  );
}

function PlantelSelect({ value, onChange }) {
  const hasLegacyValue = value && !DIGITAL_SIGNAGE_PLANTELES.includes(value);

  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {hasLegacyValue && (
        <option value={value} disabled>{value} (valor actual)</option>
      )}
      {DIGITAL_SIGNAGE_PLANTELES.map((plantel) => (
        <option key={plantel} value={plantel}>{plantel}</option>
      ))}
    </select>
  );
}

function PlaylistItemsEditor({ items, saving, onChange }) {
  function removeItem(index) {
    onChange(items.filter((_, itemIndex) => itemIndex !== index), "Playlist guardada.");
  }

  function moveItem(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;

    const nextItems = [...items];
    const [item] = nextItems.splice(index, 1);
    nextItems.splice(nextIndex, 0, item);
    onChange(nextItems, "Playlist guardada.");
  }

  function updateDuration(index, value) {
    const nextItems = items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, durationSeconds: Number(value) || 10 } : item
    );
    onChange(nextItems, "Playlist guardada.");
  }

  if (items.length === 0) {
    return <p className="digital-empty">Playlist vacía. Agrega contenidos desde el selector superior.</p>;
  }

  return (
    <div className="digital-playlist-items signage-playlist-items">
      {items.map((item, index) => (
        <article className="digital-playlist-item" key={`${item.assetId}-${index}`}>
          <span>{index + 1}</span>
          <div>
            <strong>{item.title}</strong>
            {item.type === "visual_ad" && (
              <VisualAdPreview
                visualAdData={item.visualAdData}
                className="signage-playlist-visual-preview"
                mini
              />
            )}
            <div className="signage-badge-row">
              <TypeBadge type={item.type} />
              <span className="signage-soft-badge">{formatDuration(item.durationSeconds || 10)}</span>
            </div>
          </div>
          <label>
            Seg.
            <input type="number" min="1" max="3600" value={item.durationSeconds || 10} onChange={(event) => updateDuration(index, event.target.value)} disabled={saving} />
          </label>
          <div className="digital-row-actions">
            <button type="button" className="visual-outline-button" onClick={() => moveItem(index, -1)} disabled={saving || index === 0}>
              Arriba
            </button>
            <button type="button" className="visual-outline-button" onClick={() => moveItem(index, 1)} disabled={saving || index === items.length - 1}>
              Abajo
            </button>
            <button type="button" className="danger-table-button" onClick={() => removeItem(index)} disabled={saving}>
              Quitar
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function AssetThumb({ asset }) {
  if (asset.type === "image") {
    return <img src={asset.url} alt={asset.title || "Asset"} />;
  }

  if (asset.type === "video") {
    return <video src={asset.url} muted playsInline />;
  }

  if (asset.type === "template") {
    return (
      <div className={`digital-template-thumb ${asset.templateTheme || "azul"}`}>
        <span>{getTemplateKeyLabel(asset.templateKey)}</span>
        <strong>{asset.templateData?.title || asset.title || "Plantilla"}</strong>
      </div>
    );
  }

  if (asset.type === "visual_ad") {
    return (
      <div className="digital-visual-ad-thumb">
        <VisualAdPreview visualAdData={asset.visualAdData} mini />
      </div>
    );
  }

  return <div className="digital-web-thumb">WEB</div>;
}

function SignagePreview({ playlist, contextLabel = "" }) {
  const [index, setIndex] = useState(0);
  const items = useMemo(() => playlist?.items || [], [playlist]);
  const item = items[index] || null;

  useEffect(() => {
    if (!item || item.type === "video") return undefined;

    const timeout = window.setTimeout(() => {
      setIndex((current) => (items.length ? (current + 1) % items.length : 0));
    }, Math.max(Number(item.durationSeconds || 10), 1) * 1000);

    return () => window.clearTimeout(timeout);
  }, [item, items.length]);

  if (!playlist) {
    return <div className="digital-preview-screen empty">Sin selección para previsualizar</div>;
  }

  if (!item) {
    return <div className="digital-preview-screen empty">Playlist sin contenido</div>;
  }

  return (
    <div className="digital-preview-shell">
      {(!isPublished(playlist.publishStatus) || !isPublished(item.publishStatus)) && (
        <p className="signage-warning-note">Vista previa: este contenido aún no está publicado.</p>
      )}
      <div className="digital-preview-screen">
        {item.type === "image" && <img src={item.url} alt={item.title} />}
        {item.type === "video" && (
          <video
            src={item.url}
            autoPlay
            muted
            playsInline
            onEnded={() => setIndex((current) => (current + 1) % items.length)}
            onError={() => setIndex((current) => (current + 1) % items.length)}
          />
        )}
        {item.type === "web" && <iframe src={item.url} title={item.title} />}
        {item.type === "template" && <TemplatePreview item={item} />}
        {item.type === "visual_ad" && <VisualAdPreview visualAdData={item.visualAdData} />}
      </div>
      <div className="digital-preview-meta">
        <div>
          {contextLabel && <small>{contextLabel}</small>}
          <strong>{item.title}</strong>
        </div>
        <span>{index + 1} / {items.length} - {formatDuration(item.durationSeconds || 10)}</span>
      </div>
    </div>
  );
}

function SignageIcon({ name }) {
  switch (name) {
    case "screen":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="11" rx="2" />
          <path d="M8 20h8" />
          <path d="M12 16v4" />
        </svg>
      );
    case "file":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h4" />
        </svg>
      );
    case "folder":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 7h7l2 2h9v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <path d="M3 7V5a2 2 0 0 1 2-2h4l2 4" />
        </svg>
      );
    case "video":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="6" width="12" height="12" rx="2" />
          <path d="m16 10 4-2v8l-4-2z" />
        </svg>
      );
    case "close":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "list":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
      );
    case "warning":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 19h16L12 4z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "library":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h5v14H4zM10 7h5v12h-5zM16 4h4v15h-4z" />
        </svg>
      );
    case "eye":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "plus":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M16.5 16.5 21 21" />
        </svg>
      );
    case "filter":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16l-6 7v5l-4 2v-7z" />
        </svg>
      );
    case "edit":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 20h4l10-10-4-4L4 16z" />
          <path d="M13 7l4 4" />
        </svg>
      );
    case "link":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
          <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
        </svg>
      );
    case "power":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v9" />
          <path d="M7 6.5a8 8 0 1 0 10 0" />
        </svg>
      );
    case "more":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      );
    case "calendar":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M8 3v4M16 3v4M4 10h16" />
        </svg>
      );
    case "chart":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 20V10M12 20V4M19 20v-7" />
        </svg>
      );
    case "history":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.5" />
          <path d="M4 4v4h4" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "play":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m10 8 6 4-6 4z" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3a7 7 0 0 0-1.7 1L5 6 3 9.5 5 11a7 7 0 0 0 0 2l-2 1.5L5 18l2.4-1a7 7 0 0 0 1.7 1l.4 3h5l.4-3a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5a7 7 0 0 0 .1-1z" />
        </svg>
      );
    default:
      return null;
  }
}

function getAssetTypeLabel(type) {
  const labels = {
    image: "Imagen",
    video: "Video",
    web: "Web",
    template: "Plantilla",
    visual_ad: "Anuncio visual",
    visual: "Anuncio visual",
    announcement: "Anuncio visual",
  };

  return labels[type] || "Asset";
}

function cloneVisualAdForm(form) {
  return JSON.parse(JSON.stringify(form || DEFAULT_VISUAL_AD_FORM));
}

function cloneVisualAdData(visualAdData) {
  return JSON.parse(JSON.stringify(normalizeVisualAdDataForEditor(visualAdData || {})));
}

function isVisualAdDataUsable(visualAdData) {
  const data = normalizeVisualAdDataForEditor(visualAdData || {});
  const canvas = data.canvas || {};
  const elements = Array.isArray(data.elements) ? data.elements : [];

  return Boolean(
    canvas.backgroundColor ||
    canvas.backgroundUrl ||
    elements.some((element) => element.type === "text" ? element.text : element.url)
  );
}

function getVisualTemplateCategoryValue(value = "") {
  const normalized = normalizeSearch(value);
  return VISUAL_TEMPLATE_CATEGORIES.find((category) => category.value === normalized)?.value || "otro";
}

function getVisualAdDraftKey(assetId = "") {
  return assetId ? `${VISUAL_AD_DRAFT_PREFIX}${assetId}` : VISUAL_AD_DRAFT_NEW_KEY;
}

function readVisualAdDraft(assetId = "") {
  if (typeof window === "undefined") return null;

  const key = getVisualAdDraftKey(assetId);

  try {
    const rawDraft = window.localStorage.getItem(key);
    if (!rawDraft) return null;

    const draft = JSON.parse(rawDraft);
    if (!draft?.form?.visualAdData) throw new Error("Invalid visual ad draft");

    return draft;
  } catch (error) {
    console.warn("No se pudo leer el borrador de anuncio visual.", error);
    removeVisualAdDraft(assetId);
    return null;
  }
}

function saveVisualAdDraft(assetId, form, selectedElementId, backgroundPreview) {
  if (typeof window === "undefined") return false;

  try {
    const draft = {
      version: 1,
      savedAt: Date.now(),
      assetId: assetId || "",
      selectedElementId: selectedElementId || "",
      form: sanitizeVisualAdDraftForm(form, backgroundPreview),
    };

    window.localStorage.setItem(getVisualAdDraftKey(assetId), JSON.stringify(draft));
    return true;
  } catch (error) {
    console.warn("No se pudo guardar el borrador de anuncio visual.", error);
    return false;
  }
}

function removeVisualAdDraft(assetId = "") {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(getVisualAdDraftKey(assetId));
  } catch (error) {
    console.warn("No se pudo limpiar el borrador de anuncio visual.", error);
  }
}

function sanitizeVisualAdDraftForm(form, backgroundPreview = "") {
  const draftForm = normalizeVisualAdDraftForm(form);
  const canvas = draftForm.visualAdData.canvas;
  const backgroundUrl = String(backgroundPreview || canvas.backgroundUrl || "");

  if (isPersistableVisualAdUrl(backgroundUrl)) {
    canvas.backgroundUrl = backgroundUrl;
  } else if (!isPersistableVisualAdUrl(canvas.backgroundUrl)) {
    canvas.backgroundUrl = "";
    if (canvas.backgroundType === "image") {
      canvas.backgroundType = "solid";
    }
  }

  draftForm.visualAdData.elements = draftForm.visualAdData.elements.map((element) => {
    if (element.type !== "image") return element;

    return {
      ...element,
      url: isPersistableVisualAdUrl(element.url) ? element.url : "",
      storagePath: isPersistableVisualAdUrl(element.url) ? element.storagePath || "" : "",
    };
  });

  return draftForm;
}

function normalizeVisualAdDraftForm(form) {
  const nextForm = cloneVisualAdForm({
    ...DEFAULT_VISUAL_AD_FORM,
    ...(form || {}),
    visualAdData: normalizeVisualAdDataForEditor(form?.visualAdData || {}),
  });

  nextForm.title = String(nextForm.title || "");
  nextForm.plantel = nextForm.plantel || DEFAULT_DIGITAL_SIGNAGE_PLANTEL;
  nextForm.durationSeconds = Number(nextForm.durationSeconds) || 12;
  nextForm.active = nextForm.active !== false;

  return nextForm;
}

function isPersistableVisualAdUrl(url = "") {
  const value = String(url || "");
  return Boolean(value && !value.startsWith("blob:") && !value.startsWith("data:"));
}

function isEditableShortcutTarget(target) {
  const element = target instanceof Element ? target : null;
  if (!element) return false;

  const tagName = element.tagName?.toLowerCase();
  return (
    element.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  );
}

function normalizeVisualAdElement(element = {}) {
  const type = element.type === "image" ? "image" : "text";
  const baseElement = {
    id: element.id || `${type}-${Date.now()}`,
    type,
    x: clampNumber(element.x, 0, 100, 10),
    y: clampNumber(element.y, 0, 100, 10),
    width: clampNumber(element.width, 5, 100, type === "image" ? 30 : 50),
    locked: element.locked === true,
    rotation: clampNumber(element.rotation, -180, 180, 0),
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };

  if (element.height !== undefined) {
    baseElement.height = clampNumber(element.height, 5, 100, 20);
  }

  if (type === "image") {
    return {
      ...baseElement,
      url: String(element.url || ""),
      storagePath: String(element.storagePath || ""),
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: clampNumber(element.borderRadius, 0, 100, 0),
    };
  }

  return {
    ...baseElement,
    text: String(element.text || ""),
    fontSize: clampNumber(element.fontSize, 12, 160, 48),
    fontWeight: element.fontWeight === "bold" ? "bold" : "normal",
    color: /^#[0-9a-fA-F]{6}$/.test(element.color || "") ? element.color : "#ffffff",
    align: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}

function normalizeVisualAdDataForEditor(visualAdData = {}) {
  const canvas = visualAdData.canvas || {};
  const backgroundType = canvas.backgroundType === "image" ? "image" : "solid";
  const elements = Array.isArray(visualAdData.elements)
    ? visualAdData.elements.map(normalizeVisualAdElement)
    : [DEFAULT_VISUAL_AD_ELEMENT];

  return {
    canvas: {
      aspectRatio: "16:9",
      backgroundType,
      backgroundUrl: backgroundType === "image" ? canvas.backgroundUrl || "" : "",
      backgroundStoragePath: backgroundType === "image" ? canvas.backgroundStoragePath || "" : "",
      backgroundColor: /^#[0-9a-fA-F]{6}$/.test(canvas.backgroundColor || "")
        ? canvas.backgroundColor
        : "#0f4fc4",
    },
    elements,
  };
}

function getVisualAdPresetElements(preset) {
  const presets = {
    "center-title": [
      {
        id: "text-title",
        text: "Título principal",
        x: 12,
        y: 38,
        width: 76,
        fontSize: 72,
        fontWeight: "bold",
        color: "#ffffff",
        align: "center",
      },
    ],
    "title-subtitle": [
      {
        id: "text-title",
        text: "Título principal",
        x: 10,
        y: 28,
        width: 80,
        fontSize: 64,
        fontWeight: "bold",
        color: "#ffffff",
        align: "center",
      },
      {
        id: "text-subtitle",
        text: "Subtítulo del anuncio",
        x: 18,
        y: 52,
        width: 64,
        fontSize: 34,
        fontWeight: "normal",
        color: "#ffffff",
        align: "center",
      },
    ],
    "bottom-text": [
      {
        id: "text-bottom",
        text: "Texto inferior",
        x: 8,
        y: 78,
        width: 84,
        fontSize: 34,
        fontWeight: "bold",
        color: "#ffffff",
        align: "center",
      },
    ],
    "image-left": [
      {
        id: "text-image-placeholder",
        type: "text",
        text: "Espacio para imagen",
        x: 8,
        y: 34,
        width: 36,
        fontSize: 28,
        fontWeight: "bold",
        color: "#ffffff",
        align: "center",
        zIndex: 1,
      },
      {
        id: "text-title-right",
        type: "text",
        text: "Título del anuncio",
        x: 50,
        y: 28,
        width: 42,
        fontSize: 52,
        fontWeight: "bold",
        color: "#ffffff",
        align: "left",
        zIndex: 2,
      },
      {
        id: "text-body-right",
        type: "text",
        text: "Agrega aquí los detalles principales.",
        x: 50,
        y: 54,
        width: 40,
        fontSize: 28,
        fontWeight: "normal",
        color: "#ffffff",
        align: "left",
        zIndex: 3,
      },
    ],
    urgent: [
      {
        id: "text-urgent",
        text: "Aviso urgente",
        x: 8,
        y: 18,
        width: 84,
        fontSize: 68,
        fontWeight: "bold",
        color: "#ffffff",
        align: "center",
      },
      {
        id: "text-detail",
        text: "Información importante para la comunidad.",
        x: 14,
        y: 56,
        width: 72,
        fontSize: 32,
        fontWeight: "normal",
        color: "#ffffff",
        align: "center",
      },
    ],
    coffee: [
      {
        id: "text-coffee-title",
        type: "text",
        text: "Coffee Beans Factory",
        x: 8,
        y: 22,
        width: 84,
        fontSize: 58,
        fontWeight: "bold",
        color: "#ffffff",
        align: "center",
        zIndex: 1,
      },
      {
        id: "text-coffee-promo",
        type: "text",
        text: "Promoción especial del día",
        x: 18,
        y: 50,
        width: 64,
        fontSize: 34,
        fontWeight: "bold",
        color: "#fbbf24",
        align: "center",
        zIndex: 2,
      },
      {
        id: "text-coffee-footer",
        type: "text",
        text: "Pregunta en mostrador",
        x: 24,
        y: 72,
        width: 52,
        fontSize: 24,
        fontWeight: "normal",
        color: "#ffffff",
        align: "center",
        zIndex: 3,
      },
    ],
  };

  return (presets[preset] || presets["center-title"]).map(normalizeVisualAdElement);
}

function getVisualAdDataForSave(visualAdData = {}, previewUrl = "") {
  const canvas = visualAdData.canvas || {};
  const backgroundType = canvas.backgroundType === "image" ? "image" : "solid";

  return {
    canvas: {
      aspectRatio: "16:9",
      backgroundType,
      backgroundUrl: backgroundType === "image" ? previewUrl || canvas.backgroundUrl || "" : "",
      backgroundStoragePath: backgroundType === "image" ? canvas.backgroundStoragePath || "" : "",
      backgroundColor: /^#[0-9a-fA-F]{6}$/.test(canvas.backgroundColor || "")
        ? canvas.backgroundColor
        : "#0f4fc4",
    },
    elements: Array.isArray(visualAdData.elements)
      ? visualAdData.elements
          .map(normalizeVisualAdElement)
          .filter((element) => element.type === "image" ? Boolean(element.url) : element.text.trim())
      : [],
  };
}

function getSelectedVisualElement(form, selectedId) {
  return form.visualAdData.elements.find((element) => element.id === selectedId) || null;
}

function getNextVisualAdZIndex(elements = []) {
  return Math.max(0, ...elements.map((element) => Number(element.zIndex) || 0)) + 1;
}

function getAssetUsageMap(playlists = []) {
  const usageMap = new Map();

  playlists.forEach((playlist) => {
    (playlist.items || []).forEach((item) => {
      if (!item.assetId) return;
      const current = usageMap.get(item.assetId) || [];
      usageMap.set(item.assetId, [...current, playlist.name || "Playlist sin nombre"]);
    });
  });

  return usageMap;
}

function getAssetUsageLabel(assetId, usageMap) {
  const usage = usageMap.get(assetId) || [];
  if (!usage.length) return "Usado en 0 playlists";
  if (usage.length === 1) return "Usado en 1 playlist";
  return `Usado en ${usage.length} playlists`;
}

function getAssetUsageCount(assetId, usageMap) {
  return (usageMap.get(assetId) || []).length;
}

function getPlaylistPublishIssue(playlist = {}) {
  const items = playlist.items || [];

  if (!items.length) return "No se puede publicar una playlist vacía.";

  const hasUnpublishedItems = items.some((item) => !isPublished(item.publishStatus));
  if (hasUnpublishedItems) {
    return "La playlist contiene contenidos no publicados.";
  }

  return "";
}

function getCampaignPublishIssue(campaign = {}, playlist = null) {
  if (!campaign.playlistId || !playlist) return "No se puede publicar una campaña sin playlist válida.";
  if (!isPublished(playlist.publishStatus)) return "No se puede publicar una campaña con playlist no publicada.";
  if (getPlaylistPublishIssue(playlist)) return getPlaylistPublishIssue(playlist);
  return "";
}

function getAssetCategoryValue(category = "") {
  const normalized = normalizeSearch(category);
  return VISUAL_TEMPLATE_CATEGORIES.some((option) => option.value === normalized) ? normalized : "otro";
}

function getAssetCategoryLabel(category = "") {
  return VISUAL_TEMPLATE_CATEGORIES.find((option) => option.value === category)?.label || "Otro";
}

function getAssetTags(asset) {
  return Array.isArray(asset?.tags)
    ? asset.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
    : [];
}

function parseAssetTags(value = "") {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 12)
    )
  );
}

function compareAssets(first, second, sortKey) {
  if (sortKey === "name") {
    return String(first.title || "").localeCompare(String(second.title || ""), "es");
  }

  if (sortKey === "duration") {
    return (Number(first.durationSeconds) || 0) - (Number(second.durationSeconds) || 0);
  }

  if (sortKey === "type") {
    return String(first.type || "").localeCompare(String(second.type || ""), "es");
  }

  return getDocumentTime(second) - getDocumentTime(first);
}

function getDocumentTime(documentData = {}) {
  return (
    documentData.updatedAt?.toMillis?.() ||
    documentData.createdAt?.toMillis?.() ||
    Number(documentData.updatedAt) ||
    Number(documentData.createdAt) ||
    0
  );
}

function getPlaylistUsage(playlistId, devices = [], campaigns = []) {
  const usedByDevices = devices.filter((device) => device.assignedPlaylistId === playlistId);
  const usedByCampaigns = campaigns.filter((campaign) => campaign.playlistId === playlistId);

  return {
    devices: usedByDevices,
    campaigns: usedByCampaigns,
    total: usedByDevices.length + usedByCampaigns.length,
  };
}

function formatPlaylistUsage(usage) {
  const parts = [];

  if (usage.devices.length) {
    parts.push(`Usada por ${usage.devices.length} dispositivo${usage.devices.length === 1 ? "" : "s"}: ${usage.devices.map((device) => device.name || getShortDeviceId(device)).join(", ")}`);
  }

  if (usage.campaigns.length) {
    parts.push(`Usada por ${usage.campaigns.length} campaña${usage.campaigns.length === 1 ? "" : "s"}: ${usage.campaigns.map((campaign) => campaign.name || "Campaña sin nombre").join(", ")}`);
  }

  return parts.join(" ");
}

function getPlaylistDurationSeconds(playlist) {
  return (playlist?.items || []).reduce(
    (total, item) => total + (Number(item.durationSeconds) || 0),
    0
  );
}

function getPlaylistItemCountLabel(playlist) {
  const count = playlist?.items?.length || 0;
  return `${count} contenido${count === 1 ? "" : "s"}`;
}

function getPlaylistSummary(playlist) {
  const items = playlist?.items || [];
  if (!items.length) return "Sin contenidos todavía";

  const summary = items
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.title || getAssetTypeLabel(item.type)}`)
    .join(" · ");

  return items.length > 3 ? `${summary} · +${items.length - 3} más` : summary;
}

function getCampaignDisplayStatus(campaign, now = new Date()) {
  if (campaign?.active === false) return { status: "inactive", label: "Inactiva" };

  const today = getDateKey(now);
  const startDate = String(campaign?.startDate || "").slice(0, 10);
  const endDate = String(campaign?.endDate || "").slice(0, 10);

  if (startDate && today < startDate) return { status: "scheduled", label: "Programada" };
  if (endDate && today > endDate) return { status: "ended", label: "Finalizada" };
  return { status: "active", label: "Activa" };
}

function getCurrentCampaignForDevice(campaigns = [], device) {
  if (!device || device.active === false) return null;

  return campaigns
    .filter((campaign) => isCampaignVisuallyApplicable(campaign, device))
    .sort(compareCampaignPriority)[0] || null;
}

function isCampaignVisuallyApplicable(campaign, device) {
  if (!campaign || campaign.active === false || !campaign.playlistId) return false;
  if (!isPublished(campaign.publishStatus)) return false;
  if (getCampaignDisplayStatus(campaign).status !== "active") return false;
  if (!isCampaignScheduleNow(campaign.schedule)) return false;

  const deviceIds = Array.isArray(campaign.deviceIds) ? campaign.deviceIds : [];
  if (deviceIds.length) {
    return deviceIds.includes(device.id) || deviceIds.includes(device.deviceToken);
  }

  return !campaign.plantel || campaign.plantel === device.plantel;
}

function isCampaignScheduleNow(schedule = {}) {
  if (schedule?.enabled !== true) return true;

  const now = new Date();
  const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = timeTextToMinutes(schedule.startTime);
  const endMinutes = timeTextToMinutes(schedule.endTime);

  return (
    days.includes(now.getDay()) &&
    startMinutes >= 0 &&
    endMinutes > startMinutes &&
    currentMinutes >= startMinutes &&
    currentMinutes < endMinutes
  );
}

function timeTextToMinutes(value = "") {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return -1;
  return hours * 60 + minutes;
}

function getDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getDeviceAttentionReason(device, status = getDeviceStatus(device)) {
  if (status === "inactive") return "Dispositivo inactivo";
  if (status === "unassigned") return "Sin contenido asignado";
  if (status === "no-connection") return "Sin primer heartbeat";
  if (status === "offline") return "Sin conexión reciente";
  if (hasRecentDeviceError(device)) return device?.lastErrorMessage || device?.lastError || "Error reciente reportado";
  return "Sin atención requerida";
}

function getPreviewContextLabel(mode, playlist, campaign, device) {
  if (mode === "campaign") return `Campaña: ${campaign?.name || "Sin campaña"}`;
  if (mode === "device") return `Dispositivo: ${device?.name || "Sin dispositivo"}`;
  return `Playlist: ${playlist?.name || "Sin playlist"}`;
}

function getTemplateKeyLabel(templateKey) {
  return TEMPLATE_OPTIONS.find((option) => option.value === templateKey)?.label || "Plantilla";
}

function TemplatePreview({ item }) {
  const data = item.templateData || {};

  return (
    <div className={`digital-template-preview ${item.templateTheme || "azul"}`}>
      <span>{getTemplateKeyLabel(item.templateKey)}</span>
      <strong>{data.title || item.title || "Plantilla"}</strong>
      {data.subtitle && <p>{data.subtitle}</p>}
      {data.body && <small>{data.body}</small>}
      {data.cta && <em>{data.cta}</em>}
    </div>
  );
}

function normalizeUrl(value = "") {
  const cleanValue = value.trim();
  if (!cleanValue) return "";
  if (/^https?:\/\//i.test(cleanValue)) return cleanValue;
  return `https://${cleanValue}`;
}

function getImportedDriveAsset(driveFileId, assets = []) {
  const cleanFileId = String(driveFileId || "").trim();
  if (!cleanFileId) return null;
  return assets.find((asset) => String(asset?.sourceFileId || "").trim() === cleanFileId) || null;
}

function isDriveFileAlreadyImported(file, assets = []) {
  return Boolean(getImportedDriveAsset(file?.id, assets));
}

function isDriveFolder(file) {
  return file?.mimeType === DRIVE_FOLDER_MIME_TYPE;
}

function getTitleFromFileName(fileName = "") {
  const cleanName = String(fileName || "").trim();
  if (!cleanName) return "";
  return cleanName.replace(/\.[^/.]+$/, "");
}

function normalizeWebSettingsForForm(settings = {}) {
  const reloadIntervalSeconds = Number(settings?.reloadIntervalSeconds);
  const hasReload = Number.isFinite(reloadIntervalSeconds) && reloadIntervalSeconds > 0;
  const zoom = Number(settings?.zoom);

  return {
    mode: settings?.mode === "redirect" ? "redirect" : "iframe",
    reloadIntervalSeconds: hasReload ? String(Math.min(Math.round(reloadIntervalSeconds), 86400)) : "",
    zoom: Number.isFinite(zoom) ? Math.min(Math.max(Math.round(zoom), 50), 150) : 100,
    showStatusOverlay: settings?.showStatusOverlay === true,
    allowInteraction: settings?.allowInteraction === true,
    cacheBustOnReload: settings?.cacheBustOnReload !== false,
  };
}

function normalizeWebSettingsForSave(settings = {}) {
  const formSettings = normalizeWebSettingsForForm(settings);

  return {
    mode: formSettings.mode,
    ...(formSettings.reloadIntervalSeconds
      ? { reloadIntervalSeconds: Number(formSettings.reloadIntervalSeconds) }
      : {}),
    zoom: Number(formSettings.zoom) || 100,
    showStatusOverlay: formSettings.showStatusOverlay,
    allowInteraction: formSettings.allowInteraction,
    cacheBustOnReload: formSettings.cacheBustOnReload,
    ...(settings?.lastCommand ? { lastCommand: settings.lastCommand } : {}),
  };
}

function getPlayerUrl(deviceToken) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/signage/player/${deviceToken}`;
}

function isDeviceOnline(device) {
  if (device?.active === false) return false;

  const lastSeenMillis = getDeviceLastSeenMillis(device);
  if (!lastSeenMillis) return false;

  return Date.now() - lastSeenMillis <= 2 * 60 * 1000;
}

function getDeviceStatus(device) {
  if (device?.active === false) return "inactive";
  if (!device?.assignedPlaylistId) return "unassigned";

  const lastSeenMillis = getDeviceLastSeenMillis(device);
  if (!lastSeenMillis) return "no-connection";

  return Date.now() - lastSeenMillis <= 2 * 60 * 1000 ? "online" : "offline";
}

function normalizeCampaignScheduleForm(schedule = {}) {
  const enabled = schedule?.enabled === true;
  const daysOfWeek = Array.isArray(schedule?.daysOfWeek)
    ? Array.from(
        new Set(
          schedule.daysOfWeek
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        )
      ).sort((a, b) => a - b)
    : [];

  return {
    enabled,
    daysOfWeek: enabled ? daysOfWeek : schedule?.daysOfWeek || [1, 2, 3, 4, 5],
    startTime: schedule?.startTime || "07:00",
    endTime: schedule?.endTime || "14:00",
    timezone: schedule?.timezone || "America/Tijuana",
  };
}

function formatCampaignSchedule(schedule = {}) {
  if (schedule?.enabled !== true) return "Todo el día";

  const days = Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [];
  const dayLabel = formatWeekdayRange(days);

  return `${dayLabel} - ${schedule.startTime || "--:--"}-${schedule.endTime || "--:--"}`;
}

function formatWeekdayRange(days) {
  const sortedDays = Array.from(new Set(days)).sort((a, b) => a - b);
  const weekdayByValue = new Map(WEEKDAY_OPTIONS.map((day) => [day.value, day.short]));

  if (sortedDays.length === 7) return "Todos los días";
  if (sortedDays.join(",") === "1,2,3,4,5") return "Lun-Vie";
  if (sortedDays.join(",") === "1,2,3,4,5,6") return "Lun-Sáb";

  return sortedDays.map((day) => weekdayByValue.get(day) || day).join(", ") || "Sin días";
}

function getCampaignPriorityLabel(priority) {
  const labels = {
    urgente: "Urgente",
    alta: "Alta",
    normal: "Normal",
  };

  return labels[priority] || "Normal";
}

function getStoredDevicesViewMode() {
  if (typeof window === "undefined") return "list";

  try {
    const value = window.localStorage.getItem(DEVICES_VIEW_MODE_KEY);
    return value === "monitors" ? "monitors" : "list";
  } catch (error) {
    console.warn("No se pudo leer preferencia de vista de dispositivos.", error);
    return "list";
  }
}

function getDevicePreviewPlaylist(device, playlists, activeCampaign) {
  const playlistId = activeCampaign?.playlistId || device?.assignedPlaylistId || "";
  return playlists.find((playlist) => playlist.id === playlistId) || null;
}

function getMonitorPreviewItem(playlist) {
  const items = Array.isArray(playlist?.items) ? playlist.items : [];
  return items.find((item) => item?.type) || null;
}

function deviceRequiresAttention(device, status = getDeviceStatus(device)) {
  return (
    ["inactive", "unassigned", "offline", "no-connection"].includes(status) ||
    hasRecentDeviceError(device)
  );
}

function hasRecentDeviceError(device) {
  const errorMillis =
    Number(device?.lastErrorMillis || 0) ||
    device?.lastErrorAt?.toMillis?.() ||
    device?.lastPlayerErrorAt?.toMillis?.() ||
    0;

  if (!errorMillis) return Boolean(device?.lastError || device?.lastErrorMessage);

  return Date.now() - errorMillis <= 24 * 60 * 60 * 1000;
}

function getDeviceContentLabel(device, playlists, activeCampaignByDeviceId = new Map()) {
  const activeCampaign = activeCampaignByDeviceId.get(device?.id);

  if (activeCampaign) {
    return `Campaña: ${activeCampaign.name || "Sin nombre"}`;
  }

  const campaignName =
    device?.campaignName ||
    device?.activeCampaignName ||
    device?.currentCampaignName ||
    "";
  const campaignId =
    device?.assignedCampaignId ||
    device?.campaignId ||
    device?.activeCampaignId ||
    "";

  if (campaignName) return `Campaña: ${campaignName}`;
  if (campaignId) return `Campaña: ${getShortText(campaignId)}`;

  return getPlaylistName(device?.assignedPlaylistId, playlists) || "Sin contenido";
}

function getPlaylistName(playlistId, playlists) {
  if (!playlistId) return "";
  return playlists.find((playlist) => playlist.id === playlistId)?.name || "Playlist no encontrada";
}

function getMaskedDeviceToken(device) {
  const value = device?.deviceToken || device?.id || "";
  if (!value) return "Sin token";
  if (value.length <= 10) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getShortText(value = "") {
  const cleanValue = String(value || "");
  return cleanValue.length > 18 ? `${cleanValue.slice(0, 12)}...` : cleanValue;
}

function getShortDeviceId(device) {
  const value = device?.deviceToken || device?.id || "";
  if (!value) return "Sin ID";
  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function formatLastSeen(device) {
  const millis = getDeviceLastSeenMillis(device);

  if (!millis) return "Sin registro";

  const date = new Date(millis);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const prefix = isToday ? "Hoy" : isYesterday ? "Ayer" : date.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });

  return `${prefix}, ${date.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`;
}

function getDeviceLastSeenMillis(device) {
  return (
    Number(device?.lastSeenMillis || 0) ||
    device?.lastSeenAt?.toMillis?.() ||
    0
  );
}

function getAuditLogMillis(log = {}) {
  return (
    Number(log.createdAtMillis || 0) ||
    log.createdAt?.toMillis?.() ||
    0
  );
}

function getAuditRangeStartMillis(range = "7") {
  const now = new Date();

  if (range === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  const days = Number(range);
  if (!Number.isFinite(days) || days <= 0) return 0;

  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function matchesAuditEntityFilter(log = {}, filter = "all") {
  if (filter === "all") return true;

  const entityType = String(log.entityType || "");
  const action = normalizeSearch(log.action);
  const groups = {
    content: ["asset", "visual_template"],
    playlists: ["playlist"],
    campaigns: ["campaign"],
    devices: ["device", "pairing"],
    imports: ["nube_aes_import"],
    web: ["web_asset"],
  };

  if (groups[filter]?.includes(entityType)) return true;
  if (filter === "imports" && action.includes("nube")) return true;
  if (filter === "web" && action.includes("web")) return true;

  return false;
}
