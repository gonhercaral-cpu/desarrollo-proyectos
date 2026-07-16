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
  getVisualTemplates,
  updateSignageCampaign,
  updateSignageAsset,
  updateSignageDevice,
  updateSignagePlaylist,
  updateVisualTemplate,
  updateVisualAdAsset,
  uploadSignageAsset,
} from "../services/digitalSignageService";

const TABS = [
  { key: "library", label: "Biblioteca", icon: "library" },
  { key: "playlists", label: "Playlists", icon: "list" },
  { key: "campaigns", label: "Campañas", icon: "calendar" },
  { key: "devices", label: "Dispositivos", icon: "screen" },
  { key: "health", label: "Salud", icon: "chart" },
  { key: "preview", label: "Vista previa", icon: "eye" },
];

const DIGITAL_SIGNAGE_PLANTELES = [
  "Plaza Estrella planta baja",
  "Plaza Estrella planta alta",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Coffee Beans Factory",
];

const DEFAULT_DIGITAL_SIGNAGE_PLANTEL = DIGITAL_SIGNAGE_PLANTELES[0];

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Domingo", short: "Dom" },
  { value: 1, label: "Lunes", short: "Lun" },
  { value: 2, label: "Martes", short: "Mar" },
  { value: 3, label: "Miércoles", short: "Mié" },
  { value: 4, label: "Jueves", short: "Jue" },
  { value: 5, label: "Viernes", short: "Vie" },
  { value: 6, label: "Sábado", short: "Sáb" },
];

const DEFAULT_ASSET_FORM = {
  title: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  durationSeconds: 10,
};

const DEFAULT_WEB_FORM = {
  title: "",
  url: "",
  plantel: DEFAULT_DIGITAL_SIGNAGE_PLANTEL,
  durationSeconds: 20,
};

const TEMPLATE_OPTIONS = [
  { value: "aviso", label: "Aviso" },
  { value: "promocion", label: "Promoción" },
  { value: "evento", label: "Evento" },
  { value: "coffee", label: "Coffee Beans" },
  { value: "bienvenida", label: "Bienvenida" },
];

const TEMPLATE_THEME_OPTIONS = [
  { value: "azul", label: "Azul institucional" },
  { value: "verde", label: "Verde" },
  { value: "dorado", label: "Dorado" },
  { value: "rojo", label: "Rojo" },
  { value: "cafe", label: "Café" },
];

const VISUAL_TEMPLATE_CATEGORIES = [
  { value: "institucional", label: "Institucional" },
  { value: "promocion", label: "Promoción" },
  { value: "aviso", label: "Aviso" },
  { value: "coffee", label: "Coffee" },
  { value: "evento", label: "Evento" },
  { value: "otro", label: "Otro" },
];

const PUBLISH_STATUS_OPTIONS = [
  { value: "draft", label: "Borrador" },
  { value: "review", label: "En revisión" },
  { value: "published", label: "Publicado" },
  { value: "archived", label: "Archivado" },
];

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

export default function DigitalSignageAdmin() {
  const { profile, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("library");
  const [assets, setAssets] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [visualTemplates, setVisualTemplates] = useState([]);
  const [devices, setDevices] = useState([]);
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
  const [playlistForm, setPlaylistForm] = useState(DEFAULT_PLAYLIST_FORM);
  const [campaignForm, setCampaignForm] = useState(DEFAULT_CAMPAIGN_FORM);
  const [editingCampaignId, setEditingCampaignId] = useState("");
  const [editingPlaylistId, setEditingPlaylistId] = useState("");
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
  const [healthSearch, setHealthSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState("all");
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
      const [nextAssets, nextPlaylists, nextCampaigns, nextVisualTemplates, nextDevices] = await Promise.all([
        getSignageAssets(),
        getSignagePlaylists(),
        getSignageCampaigns(),
        getVisualTemplates(),
        getSignageDevices(),
      ]);

      setAssets(nextAssets);
      setPlaylists(nextPlaylists);
      setCampaigns(nextCampaigns);
      setVisualTemplates(nextVisualTemplates);
      setDevices(nextDevices);
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

    setVisualAdDraftStatus("pending");

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
    if (!visualAdFormOpen) return undefined;

    function handleVisualAdShortcuts(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      if (isEditableShortcutTarget(event.target)) return;

      const key = String(event.key || "").toLowerCase();
      const shouldUndo = key === "z" && !event.shiftKey;
      const shouldRedo = key === "y" || (key === "z" && event.shiftKey);

      if (shouldUndo) {
        event.preventDefault();
        undoVisualAdChange();
      }

      if (shouldRedo) {
        event.preventDefault();
        redoVisualAdChange();
      }
    }

    window.addEventListener("keydown", handleVisualAdShortcuts);
    return () => window.removeEventListener("keydown", handleVisualAdShortcuts);
  }, [
    visualAdFormOpen,
    visualAdHistory,
    visualAdFuture,
    visualAdForm,
    selectedVisualElementId,
    visualAdBackgroundFile,
    visualAdBackgroundPreview,
    visualAdElementFiles,
  ]);

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

  async function handleUploadAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      await uploadSignageAsset(assetFile, assetForm, profile);
      setAssetFile(null);
      setAssetForm(DEFAULT_ASSET_FORM);
      event.target.reset();
    }, "Contenido guardado.");
  }

  async function handleCreateWebAsset(event) {
    event.preventDefault();

    await runAction(async () => {
      await createWebAsset(
        {
          ...webForm,
          url: normalizeUrl(webForm.url),
        },
        profile
      );
      setWebForm(DEFAULT_WEB_FORM);
    }, "Contenido web guardado.");
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
      () =>
        updateVisualTemplate(template.id, {
          name,
          category: getVisualTemplateCategoryValue(categoryInput),
          description,
        }),
      "Plantilla actualizada."
    );
  }

  async function toggleVisualTemplate(template) {
    if (!template?.id) return;

    await runAction(
      () => updateVisualTemplate(template.id, { active: template.active === false }),
      "Plantilla actualizada."
    );
  }

  async function removeVisualTemplate(template) {
    if (!template?.id) return;
    if (!window.confirm(`¿Eliminar plantilla "${template.name || "sin nombre"}"?`)) return;

    await runAction(() => deleteVisualTemplate(template.id), "Plantilla eliminada.");
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

    await runAction(
      () =>
        updateSignageAsset(asset.id, {
          category: getAssetCategoryValue(categoryInput),
          tags: parseAssetTags(tagsInput),
        }),
      "Contenido actualizado."
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

    await runAction(
      () => updateSignagePlaylist(playlist.id, { publishStatus }),
      getPublishStatusMessage("Playlist", publishStatus)
    );
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

    await runAction(
      () => updateSignageCampaign(campaign.id, { publishStatus }),
      getPublishStatusMessage("Campaña", publishStatus)
    );
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
        <div className="signage-main-grid">
          <section className="signage-panel signage-devices-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Pantallas registradas</h2>
                <p>Control de pantallas Linux, asignaciones y estado de conexión.</p>
              </div>
              <div className="signage-panel-actions">
                <button type="button" className="visual-outline-button signage-new-button" onClick={openPairingForm}>
                  <SignageIcon name="link" />
                  Vincular pantalla
                </button>
                <button type="button" className="visual-primary-button signage-new-button" onClick={openNewDeviceForm}>
                  <SignageIcon name="plus" />
                  Nuevo dispositivo
                </button>
              </div>
            </div>

            <div className="signage-device-toolbar">
              <label className="signage-search">
                <input
                  type="search"
                  value={deviceSearch}
                  onChange={(event) => setDeviceSearch(event.target.value)}
                  placeholder="Buscar dispositivo..."
                />
                <SignageIcon name="search" />
              </label>

              <label className="signage-filter">
                <SignageIcon name="filter" />
                <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)}>
                  <option value="all">Filtros</option>
                  <option value="online">En línea</option>
                  <option value="offline">Desconectado</option>
                  <option value="no-connection">Sin conexión registrada</option>
                  <option value="unassigned">Sin contenido</option>
                  <option value="inactive">Inactivo</option>
                </select>
              </label>
            </div>

            <p className="signage-helper-note">
              Este dispositivo reproduce campañas activas; si no hay campañas vigentes, usa su playlist asignada.
            </p>

            {pairingFormOpen && (
              <form className="signage-inline-form signage-pairing-form" onSubmit={handlePairingSubmit} ref={deviceFormRef}>
                <div className="signage-form-heading">
                  <strong>Vincular pantalla</strong>
                  <button
                    type="button"
                    className="signage-icon-button"
                    onClick={() => {
                      setPairingFormOpen(false);
                      setPairingForm(DEFAULT_PAIRING_FORM);
                    }}
                    aria-label="Cerrar formulario"
                  >
                    ×
                  </button>
                </div>

                <p className="digital-helper">
                  Abre /signage/setup en la pantalla nueva e ingresa aquí el código mostrado.
                </p>

                <div className="digital-form-grid">
                  <label>
                    Código
                    <input value={pairingForm.code} onChange={(event) => setPairingForm({ ...pairingForm, code: event.target.value.toUpperCase() })} placeholder="AES-4821" />
                  </label>
                  <label>
                    Nombre
                    <input value={pairingForm.name} onChange={(event) => setPairingForm({ ...pairingForm, name: event.target.value })} placeholder="Pantalla recepción" />
                  </label>
                  <label>
                    Plantel
                    <PlantelSelect value={pairingForm.plantel} onChange={(value) => setPairingForm({ ...pairingForm, plantel: value })} />
                  </label>
                  <label>
                    Ubicación
                    <input value={pairingForm.location} onChange={(event) => setPairingForm({ ...pairingForm, location: event.target.value })} placeholder="Lobby, pasillo, aula..." />
                  </label>
                  <label>
                    Playlist opcional
                    <select value={pairingForm.assignedPlaylistId} onChange={(event) => setPairingForm({ ...pairingForm, assignedPlaylistId: event.target.value })}>
                      <option value="">Sin playlist</option>
                      {playlists.map((playlist) => (
                        <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="signage-form-actions">
                  <button type="button" className="visual-outline-button" onClick={() => setPairingFormOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="visual-primary-button" disabled={saving}>
                    Vincular pantalla
                  </button>
                </div>
              </form>
            )}

            {deviceFormOpen && (
              <form className="signage-inline-form" onSubmit={handleDeviceSubmit} ref={deviceFormRef}>
                <div className="signage-form-heading">
                  <strong>{editingDeviceId ? "Editar dispositivo" : "Nuevo dispositivo"}</strong>
                  <button
                    type="button"
                    className="signage-icon-button"
                    onClick={() => {
                      setDeviceFormOpen(false);
                      setEditingDeviceId("");
                      setDeviceForm(DEFAULT_DEVICE_FORM);
                    }}
                    aria-label="Cerrar formulario"
                  >
                    ×
                  </button>
                </div>

                <div className="digital-form-grid">
                  <label>
                    Nombre
                    <input value={deviceForm.name} onChange={(event) => setDeviceForm({ ...deviceForm, name: event.target.value })} placeholder="Pantalla recepción" />
                  </label>
                  <label>
                    Plantel
                    <PlantelSelect value={deviceForm.plantel} onChange={(value) => setDeviceForm({ ...deviceForm, plantel: value })} />
                  </label>
                  <label>
                    Ubicación
                    <input value={deviceForm.location} onChange={(event) => setDeviceForm({ ...deviceForm, location: event.target.value })} placeholder="Lobby, pasillo, aula..." />
                  </label>
                  <label>
                    Playlist
                    <select value={deviceForm.assignedPlaylistId} onChange={(event) => setDeviceForm({ ...deviceForm, assignedPlaylistId: event.target.value })}>
                      <option value="">Sin playlist</option>
                      {playlists.map((playlist) => (
                        <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="signage-form-actions">
                  <button type="button" className="visual-outline-button" onClick={() => setDeviceFormOpen(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="visual-primary-button" disabled={saving}>
                    {editingDeviceId ? "Guardar cambios" : "Crear dispositivo"}
                  </button>
                </div>
              </form>
            )}

            <div className="signage-device-list">
              {filteredDevices.length === 0 && <p className="digital-empty">Sin dispositivos para mostrar.</p>}
              {filteredDevices.map((device) => (
                <DeviceCard
                  key={device.id}
                  device={device}
                  active={selectedDevice?.id === device.id}
                  playlists={playlists}
                  activeCampaign={activeCampaignByDeviceId.get(device.id)}
                  saving={saving}
                  onSelect={() => setSelectedDeviceId(device.id)}
                  onEdit={() => openEditDeviceForm(device)}
                  onCopy={() => copyPlayerUrl(device)}
                  onPlaylistChange={(playlistId) =>
                    runAction(
                      () => updateSignageDevice(device.id, { assignedPlaylistId: playlistId }),
                      "Playlist asignada."
                    )
                  }
                  onToggle={() =>
                    runAction(
                      () => updateSignageDevice(device.id, { active: device.active === false }),
                      "Dispositivo actualizado."
                    )
                  }
                  onDelete={() =>
                    window.confirm("¿Eliminar dispositivo?") &&
                    runAction(() => deleteSignageDevice(device.id), "Dispositivo eliminado.")
                  }
                />
              ))}
            </div>

            <footer className="signage-list-footer">
              <span>Mostrando {filteredDevices.length ? 1 : 0} a {filteredDevices.length} de {devices.length} dispositivos</span>
              <div className="signage-pagination" aria-hidden="true">
                <button type="button" disabled>‹</button>
                <button type="button" className="active">1</button>
                <button type="button" disabled>›</button>
              </div>
            </footer>
          </section>

          <aside className="signage-side-column">
            <QuickDevicePreview
              device={selectedDevice}
              playlist={selectedDevicePlaylist}
              activeCampaign={selectedDevice ? activeCampaignByDeviceId.get(selectedDevice.id) : null}
            />
            <QuickActions
              onNewDevice={openNewDeviceForm}
              onPlaylists={() => setActiveTab("playlists")}
              onContent={() => setActiveTab("library")}
              onPreview={() => setActiveTab("preview")}
            />
          </aside>
        </div>
      )}

      {!loading && activeTab === "campaigns" && (
        <CampaignsPanel
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
              () => updateSignageCampaign(campaign.id, { active: campaign.active === false }),
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
            runAction(() => deleteSignageCampaign(campaign.id), "Campaña eliminada.")
          }
        />
      )}

      {!loading && activeTab === "health" && (
        <HealthPanel
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
        />
      )}

      {!loading && activeTab === "library" && (
        <>
          {visualAdFormOpen ? (
            <VisualAdEditor
              form={visualAdForm}
              saving={saving}
              mode={editingVisualAdId ? "edit" : "create"}
              dirty={visualAdDirty}
              draftStatus={visualAdDraftStatus}
              backgroundPreview={visualAdBackgroundPreview}
              selectedElementId={selectedVisualElementId}
              visualTemplates={visualTemplates}
              canUndo={visualAdHistory.length > 0}
              canRedo={visualAdFuture.length > 0}
              zoom={visualAdZoom}
              onSubmit={handleCreateVisualAdAsset}
              onCancel={closeVisualAdEditor}
              onSaveTemplate={handleSaveVisualTemplate}
              onApplyTemplate={applyVisualTemplate}
              onEditTemplate={editVisualTemplate}
              onToggleTemplate={toggleVisualTemplate}
              onDeleteTemplate={removeVisualTemplate}
              onUndo={undoVisualAdChange}
              onRedo={redoVisualAdChange}
              onZoomIn={() => zoomVisualAd(VISUAL_AD_ZOOM_STEP)}
              onZoomOut={() => zoomVisualAd(-VISUAL_AD_ZOOM_STEP)}
              onZoomFit={fitVisualAdCanvas}
              onFieldChange={updateVisualAdField}
              onCanvasChange={updateVisualAdCanvas}
              onBackgroundTypeChange={handleVisualAdBackgroundTypeChange}
              onBackgroundChange={handleVisualAdBackgroundChange}
              onSelectElement={setSelectedVisualElementId}
              onAddText={addVisualAdText}
              onAddImage={addVisualAdImage}
              onApplyPreset={applyVisualAdPreset}
              onAlignElement={alignVisualAdElement}
              onDuplicateElement={duplicateVisualAdElement}
              onLayerChange={(direction) => moveVisualAdLayer(selectedVisualElementId, direction)}
              onElementChange={(updates) => updateVisualAdElement(selectedVisualElementId, updates)}
              onCanvasElementChange={updateVisualAdElement}
              onCanvasInteractionStart={pushVisualAdHistory}
              onElementDelete={() => removeVisualAdElement(selectedVisualElementId)}
              onElementImageReplace={(file) => replaceVisualAdImage(selectedVisualElementId, file)}
            />
          ) : (
          <div className="signage-main-grid">
          <section className="signage-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Biblioteca</h2>
                <p>Sube imágenes, videos, enlaces web o crea anuncios visuales para usarlos en playlists.</p>
              </div>
              <button
                type="button"
                className="visual-primary-button"
                onClick={() => setTemplateFormOpen((current) => !current)}
              >
                Nueva plantilla
              </button>
              <button
                type="button"
                className="visual-outline-button"
                onClick={openNewVisualAdEditor}
              >
                Nuevo anuncio visual
              </button>
            </div>

            <div className="signage-library-toolbar">
              <label>
                Buscar
                <input value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Nombre, etiqueta, plantel..." />
              </label>
              <label>
                Tipo
                <select value={assetTypeFilter} onChange={(event) => setAssetTypeFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  <option value="image">Imagen</option>
                  <option value="video">Video</option>
                  <option value="web">Web</option>
                  <option value="template">Plantilla</option>
                  <option value="visual_ad">Anuncio visual</option>
                </select>
              </label>
              <label>
                Plantel
                <select value={assetPlantelFilter} onChange={(event) => setAssetPlantelFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {DIGITAL_SIGNAGE_PLANTELES.map((plantel) => (
                    <option key={plantel} value={plantel}>{plantel}</option>
                  ))}
                </select>
              </label>
              <label>
                Categoría
                <select value={assetCategoryFilter} onChange={(event) => setAssetCategoryFilter(event.target.value)}>
                  <option value="all">Todas</option>
                  {VISUAL_TEMPLATE_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Estado
                <select value={assetStatusFilter} onChange={(event) => setAssetStatusFilter(event.target.value)}>
                  <option value="current">Sin archivar</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Inactivos</option>
                  <option value="archived">Archivados</option>
                  <option value="all">Todos</option>
                </select>
              </label>
              <label>
                Publicación
                <select value={assetPublishFilter} onChange={(event) => setAssetPublishFilter(event.target.value)}>
                  <option value="all">Todos</option>
                  {PUBLISH_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Orden
                <select value={assetSort} onChange={(event) => setAssetSort(event.target.value)}>
                  <option value="recent">Recientes</option>
                  <option value="name">Nombre</option>
                  <option value="duration">Duración</option>
                  <option value="type">Tipo</option>
                </select>
              </label>
              <button
                type="button"
                className="visual-outline-button"
                onClick={() => {
                  setAssetSearch("");
                  setAssetTypeFilter("all");
                  setAssetPlantelFilter("all");
                  setAssetCategoryFilter("all");
                  setAssetStatusFilter("current");
                  setAssetPublishFilter("all");
                  setAssetSort("recent");
                }}
              >
                Limpiar filtros
              </button>
            </div>

            <div className="signage-library-grid">
              {assets.length === 0 && <p className="digital-empty">Sin assets registrados.</p>}
              {assets.length > 0 && filteredAssets.length === 0 && (
                <p className="digital-empty">No hay contenidos que coincidan con los filtros.</p>
              )}
              {filteredAssets.map((asset) => (
                <article className={`signage-asset-card ${asset.archived === true ? "archived" : ""}`} key={asset.id}>
                  <AssetThumb asset={asset} />
                  <div>
                    <strong>{asset.title || "Sin título"}</strong>
                    <span>{getAssetTypeLabel(asset.type)} - {asset.plantel || "Sin plantel"} - {asset.durationSeconds || 10}s - {getAssetCategoryLabel(getAssetCategoryValue(asset.category))}</span>
                    <div className="signage-badge-row">
                      <TypeBadge type={asset.type} />
                      <StatusBadge status={asset.active === false ? "inactive" : "active"} />
                      <PublishStatusBadge status={asset.publishStatus} />
                      {asset.archived === true && <span className="signage-soft-badge archived">Archivado</span>}
                      <span className="signage-soft-badge">
                        {getAssetUsageLabel(asset.id, assetUsageMap)}
                      </span>
                      {getAssetTags(asset).map((tag) => (
                        <span className="signage-tag-badge" key={tag}>{tag}</span>
                      ))}
                    </div>
                  </div>
                  <div className="signage-card-actions">
                    {asset.type === "visual_ad" && (
                      <button type="button" className="visual-outline-button" onClick={() => openEditVisualAdEditor(asset)} disabled={saving}>
                        Editar anuncio
                      </button>
                    )}
                    <button type="button" className="visual-outline-button" onClick={() => editAssetOrganization(asset)} disabled={saving}>
                      Editar
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => prepareAssetForPlaylist(asset)} disabled={saving}>
                      Agregar a playlist
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => duplicateAsset(asset)} disabled={saving}>
                      Duplicar
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => runAction(() => updateSignageAsset(asset.id, { active: asset.active === false }), "Asset actualizado.")} disabled={saving}>
                      {asset.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <select
                      className="signage-publish-select"
                      value={getPublishStatus(asset.publishStatus)}
                      onChange={(event) => changeAssetPublishStatus(asset, event.target.value)}
                      disabled={saving}
                    >
                      {PUBLISH_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button type="button" className="visual-outline-button" onClick={() => toggleAssetArchive(asset)} disabled={saving}>
                      {asset.archived === true ? "Restaurar" : "Archivar"}
                    </button>
                    <button type="button" className="danger-table-button" onClick={() => window.confirm("¿Eliminar asset?") && runAction(() => deleteSignageAsset(asset.id), "Asset eliminado.")} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="signage-side-column">
            {templateFormOpen && (
              <form className="signage-panel signage-template-form" onSubmit={handleCreateTemplateAsset}>
                <h3>Nueva plantilla</h3>
                <div className="digital-form-grid">
                  <label>
                    Tipo
                    <select value={templateForm.templateKey} onChange={(event) => setTemplateForm({ ...templateForm, templateKey: event.target.value })}>
                      {TEMPLATE_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tema
                    <select value={templateForm.templateTheme} onChange={(event) => setTemplateForm({ ...templateForm, templateTheme: event.target.value })}>
                      {TEMPLATE_THEME_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Titulo
                    <input value={templateForm.title} onChange={(event) => setTemplateForm({ ...templateForm, title: event.target.value })} placeholder="Ej. Bienvenidos" required />
                  </label>
                  <label>
                    Subtitulo
                    <input value={templateForm.subtitle} onChange={(event) => setTemplateForm({ ...templateForm, subtitle: event.target.value })} placeholder="Ej. Ciclo escolar 2026" />
                  </label>
                  <label className="digital-full-field">
                    Texto principal
                    <textarea value={templateForm.body} onChange={(event) => setTemplateForm({ ...templateForm, body: event.target.value })} rows="3" placeholder="Mensaje breve para pantalla." />
                  </label>
                  <label>
                    Footer
                    <input value={templateForm.footer} onChange={(event) => setTemplateForm({ ...templateForm, footer: event.target.value })} placeholder="Ej. Active English School" />
                  </label>
                  <label>
                    CTA
                    <input value={templateForm.cta} onChange={(event) => setTemplateForm({ ...templateForm, cta: event.target.value })} placeholder="Ej. Inscribete hoy" />
                  </label>
                  <label>
                    Plantel
                    <PlantelSelect value={templateForm.plantel} onChange={(value) => setTemplateForm({ ...templateForm, plantel: value })} />
                  </label>
                  <label>
                    Duracion seg.
                    <input type="number" min="1" max="3600" value={templateForm.durationSeconds} onChange={(event) => setTemplateForm({ ...templateForm, durationSeconds: event.target.value })} />
                  </label>
                  <label className="digital-checkbox-label">
                    <input type="checkbox" checked={templateForm.active} onChange={(event) => setTemplateForm({ ...templateForm, active: event.target.checked })} />
                    Activa
                  </label>
                </div>
                <button type="submit" className="visual-primary-button" disabled={saving}>Crear plantilla</button>
              </form>
            )}

            <form className="signage-panel" onSubmit={handleUploadAsset}>
              <h3>Subir imagen o video</h3>
              <div className="digital-form-grid">
                <label>
                  Título
                  <input value={assetForm.title} onChange={(event) => setAssetForm({ ...assetForm, title: event.target.value })} placeholder="Ej. Promoción julio" />
                </label>
                <label>
                  Plantel
                  <PlantelSelect value={assetForm.plantel} onChange={(value) => setAssetForm({ ...assetForm, plantel: value })} />
                </label>
                <label>
                  Duración seg.
                  <input type="number" min="1" max="3600" value={assetForm.durationSeconds} onChange={(event) => setAssetForm({ ...assetForm, durationSeconds: event.target.value })} />
                </label>
                <label>
                  Archivo
                  <input type="file" accept="image/*,video/*" onChange={(event) => setAssetFile(event.target.files?.[0] || null)} />
                </label>
              </div>
              <button type="submit" className="visual-primary-button" disabled={saving}>Subir asset</button>
            </form>

            <form className="signage-panel" onSubmit={handleCreateWebAsset}>
              <h3>Crear asset web</h3>
              <div className="digital-form-grid">
                <label>
                  Título
                  <input value={webForm.title} onChange={(event) => setWebForm({ ...webForm, title: event.target.value })} placeholder="Ej. Sitio institucional" />
                </label>
                <label>
                  URL
                  <input value={webForm.url} onChange={(event) => setWebForm({ ...webForm, url: event.target.value })} placeholder="https://..." />
                </label>
                <label>
                  Plantel
                  <PlantelSelect value={webForm.plantel} onChange={(value) => setWebForm({ ...webForm, plantel: value })} />
                </label>
                <label>
                  Duración seg.
                  <input type="number" min="1" max="3600" value={webForm.durationSeconds} onChange={(event) => setWebForm({ ...webForm, durationSeconds: event.target.value })} />
                </label>
              </div>
              <button type="submit" className="visual-primary-button" disabled={saving}>Crear web</button>
            </form>
          </aside>
          </div>
          )}
        </>
      )}

      {!loading && activeTab === "playlists" && (
        <div className="signage-main-grid">
          <section className="signage-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Playlists</h2>
                <p>Orden, duración y estado del contenido programado.</p>
              </div>
            </div>

            <div className="signage-playlist-selector">
              {playlists.length === 0 && (
                <p className="digital-empty">Sin playlists registradas. Crea una playlist para agrupar contenidos.</p>
              )}
              {playlists.map((playlist) => (
                <article
                  key={playlist.id}
                  className={`signage-playlist-card ${effectiveSelectedPlaylistId === playlist.id ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="signage-playlist-select"
                    onClick={() => setSelectedPlaylistId(playlist.id)}
                  >
                    <strong>{playlist.name}</strong>
                    <span>{playlist.plantel || "Sin plantel"}</span>
                    <div className="signage-badge-row">
                      <StatusBadge status={playlist.active === false ? "inactive" : "active"} />
                      <PublishStatusBadge status={playlist.publishStatus} />
                      <span className="signage-soft-badge">{getPlaylistItemCountLabel(playlist)}</span>
                      <span className="signage-soft-badge">{formatDuration(getPlaylistDurationSeconds(playlist))}</span>
                    </div>
                    <small>{getPlaylistSummary(playlist)}</small>
                  </button>
                  <div className="signage-card-actions signage-compact-actions">
                    <button type="button" className="visual-outline-button" onClick={() => setSelectedPlaylistId(playlist.id)} disabled={saving}>
                      Ver contenido
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => editPlaylist(playlist)} disabled={saving}>
                      Editar
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => duplicatePlaylist(playlist)} disabled={saving}>
                      Duplicar
                    </button>
                    <select
                      className="signage-publish-select"
                      value={getPublishStatus(playlist.publishStatus)}
                      onChange={(event) => changePlaylistPublishStatus(playlist, event.target.value)}
                      disabled={saving}
                    >
                      {PUBLISH_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button type="button" className="danger-table-button" onClick={() => handleDeletePlaylist(playlist)} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
            </div>

            {!selectedPlaylist ? (
              <p className="digital-empty">Selecciona o crea una playlist.</p>
            ) : (
              <>
                <div className="signage-playlist-toolbar">
                  <div>
                    <h3>{selectedPlaylist.name}</h3>
                    <p>
                      {selectedPlaylist.plantel || "Sin plantel"} - {getPlaylistItemCountLabel(selectedPlaylist)} - {formatDuration(getPlaylistDurationSeconds(selectedPlaylist))}
                    </p>
                    <div className="signage-badge-row">
                      <StatusBadge status={selectedPlaylist.active === false ? "inactive" : "active"} />
                      <PublishStatusBadge status={selectedPlaylist.publishStatus} />
                      <span className="signage-soft-badge">{selectedPlaylist.items?.length ? "Contenido guardado" : "Playlist vacía"}</span>
                      {getPlaylistPublishIssue(selectedPlaylist) && (
                        <span className="signage-soft-badge warning">Revisión necesaria</span>
                      )}
                    </div>
                  </div>
                  <div className="signage-playlist-toolbar-actions">
                    <button type="button" className="visual-outline-button" onClick={() => editPlaylist(selectedPlaylist)} disabled={saving}>
                      Editar
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => duplicatePlaylist(selectedPlaylist)} disabled={saving}>
                      Duplicar
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => runAction(() => updateSignagePlaylist(selectedPlaylist.id, { active: selectedPlaylist.active === false }), "Playlist guardada.")} disabled={saving}>
                      {selectedPlaylist.active === false ? "Activar" : "Desactivar"}
                    </button>
                    <select
                      className="signage-publish-select"
                      value={getPublishStatus(selectedPlaylist.publishStatus)}
                      onChange={(event) => changePlaylistPublishStatus(selectedPlaylist, event.target.value)}
                      disabled={saving}
                    >
                      {PUBLISH_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button type="button" className="danger-table-button" onClick={() => handleDeletePlaylist(selectedPlaylist)} disabled={saving}>
                      Eliminar
                    </button>
                  </div>
                </div>

                <div className="digital-add-row">
                  <select value={assetToAddId} onChange={(event) => setAssetToAddId(event.target.value)}>
                    <option value="">Seleccionar asset</option>
                    {activeAssets.map((asset) => (
                      <option value={asset.id} key={asset.id}>{asset.title}</option>
                    ))}
                  </select>
                  <button type="button" className="visual-primary-button" onClick={addAssetToPlaylist} disabled={saving || !assetToAddId}>
                    Agregar
                  </button>
                </div>

                <PlaylistItemsEditor items={selectedPlaylist.items || []} saving={saving} onChange={updatePlaylistItems} />
              </>
            )}
          </section>

          <aside className="signage-side-column">
            <form className="signage-panel" onSubmit={handleCreatePlaylist}>
              <h3>{editingPlaylistId ? "Editar playlist" : "Nueva playlist"}</h3>
              <div className="digital-form-grid">
                <label>
                  Nombre
                  <input value={playlistForm.name} onChange={(event) => setPlaylistForm({ ...playlistForm, name: event.target.value })} placeholder="Ej. Lobby principal" />
                </label>
                <label>
                  Plantel
                  <PlantelSelect value={playlistForm.plantel} onChange={(value) => setPlaylistForm({ ...playlistForm, plantel: value })} />
                </label>
                <label>
                  Publicación
                  <select value={getPublishStatus(playlistForm.publishStatus)} onChange={(event) => setPlaylistForm({ ...playlistForm, publishStatus: event.target.value })}>
                    {PUBLISH_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="signage-form-actions">
                {editingPlaylistId && (
                  <button type="button" className="visual-outline-button" onClick={() => { setEditingPlaylistId(""); setPlaylistForm(DEFAULT_PLAYLIST_FORM); }}>
                    Cancelar edición
                  </button>
                )}
                <button type="submit" className="visual-primary-button" disabled={saving}>
                  {editingPlaylistId ? "Guardar playlist" : "Crear playlist"}
                </button>
              </div>
            </form>

            <SignagePreviewCard playlist={selectedPlaylist} />
          </aside>
        </div>
      )}

      {!loading && activeTab === "preview" && (
        <div className="signage-main-grid">
          <section className="signage-panel">
            <div className="signage-panel-heading">
              <div>
                <h2>Vista previa global</h2>
                <p>Selecciona un contenido, playlist, campaña o dispositivo para previsualizar cómo se verá en pantalla.</p>
              </div>
            </div>
            <SignagePreview
              key={`${previewMode}-${previewPlaylist?.id || "empty"}`}
              playlist={previewPlaylist}
              contextLabel={getPreviewContextLabel(previewMode, previewPlaylist, previewCampaign, previewDevice)}
            />
          </section>

          <aside className="signage-side-column">
            <section className="signage-panel">
              <h3>Seleccionar vista</h3>
              <label>
                Tipo de vista
                <select value={previewMode} onChange={(event) => setPreviewMode(event.target.value)}>
                  <option value="playlist">Playlist</option>
                  <option value="campaign">Campaña</option>
                  <option value="device">Dispositivo</option>
                </select>
              </label>
              <label>
                Playlist
                <select value={previewPlaylist?.id || ""} onChange={(event) => setPreviewPlaylistId(event.target.value)} disabled={previewMode !== "playlist"}>
                  <option value="">Seleccionar playlist</option>
                  {playlists.map((playlist) => (
                    <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Campaña
                <select value={previewCampaign?.id || ""} onChange={(event) => setPreviewCampaignId(event.target.value)} disabled={previewMode !== "campaign"}>
                  <option value="">Seleccionar campaña</option>
                  {campaigns.map((campaign) => (
                    <option value={campaign.id} key={campaign.id}>{campaign.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Dispositivo
                <select value={previewDevice?.id || ""} onChange={(event) => setPreviewDeviceId(event.target.value)} disabled={previewMode !== "device"}>
                  <option value="">Seleccionar dispositivo</option>
                  {devices.map((device) => (
                    <option value={device.id} key={device.id}>{device.name || getShortDeviceId(device)}</option>
                  ))}
                </select>
              </label>
              <PreviewMeta
                mode={previewMode}
                playlist={previewPlaylist}
                campaign={previewCampaign}
                device={previewDevice}
                activeCampaign={previewDevice ? activeCampaignByDeviceId.get(previewDevice.id) : null}
              />
            </section>

            <QuickActions
              onNewDevice={openNewDeviceForm}
              onPlaylists={() => setActiveTab("playlists")}
              onContent={() => setActiveTab("library")}
              onPreview={() => setActiveTab("preview")}
            />
          </aside>
        </div>
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

function CampaignsPanel({
  campaigns,
  playlists,
  form,
  editingCampaignId,
  saving,
  onFormChange,
  onSubmit,
  onEdit,
  onCancelEdit,
  onToggle,
  onPublishStatusChange,
  onViewPlaylist,
  onDelete,
}) {
  function updateField(field, value) {
    onFormChange({ ...form, [field]: value });
  }

  function updateSchedule(nextSchedule) {
    onFormChange({
      ...form,
      schedule: normalizeCampaignScheduleForm({
        ...form.schedule,
        ...nextSchedule,
      }),
    });
  }

  function toggleDay(day) {
    const currentDays = form.schedule?.daysOfWeek || [];
    const nextDays = currentDays.includes(day)
      ? currentDays.filter((item) => item !== day)
      : [...currentDays, day].sort((a, b) => a - b);

    updateSchedule({ daysOfWeek: nextDays });
  }

  return (
    <div className="signage-main-grid">
      <section className="signage-panel">
        <div className="signage-panel-heading">
          <div>
            <h2>Campañas</h2>
            <p>Vigencia, prioridad y programación semanal para contenido institucional.</p>
          </div>
        </div>

        <div className="signage-campaign-list">
          {campaigns.length === 0 && <p className="digital-empty">Sin campañas registradas. Crea una campaña para programar playlists por fecha y horario.</p>}
          {campaigns.map((campaign) => {
            const playlist = playlists.find((item) => item.id === campaign.playlistId) || null;
            const campaignStatus = getCampaignDisplayStatus(campaign);
            const playlistHasIssue = !playlist || playlist.active === false;

            return (
              <article className={`signage-campaign-card ${playlistHasIssue ? "needs-attention" : ""}`} key={campaign.id}>
                <div className="signage-campaign-main">
                  <div>
                    <strong>{campaign.name || "Campaña sin nombre"}</strong>
                    <span>{campaign.plantel || "Sin plantel"} - {playlist?.name || "Playlist no encontrada"}</span>
                  </div>
                  <div className="signage-health-badges">
                    <span className={`signage-status-badge ${campaignStatus.status}`}>{campaignStatus.label}</span>
                    <PublishStatusBadge status={campaign.publishStatus} />
                    <span className={`signage-priority-badge ${campaign.priority || "normal"}`}>
                      {getCampaignPriorityLabel(campaign.priority)}
                    </span>
                  </div>
                </div>

                <div className="signage-campaign-meta">
                  <InfoPair label="Playlist asignada" value={playlist?.name || "Playlist no encontrada"} strong />
                  <InfoPair label="Contenidos" value={playlist && playlist.active !== false ? getPlaylistItemCountLabel(playlist) : "Sin playlist válida"} />
                  <InfoPair label="Vigencia" value={`${campaign.startDate || "Sin inicio"} a ${campaign.endDate || "Sin fin"}`} />
                  <InfoPair label="Programación" value={formatCampaignSchedule(campaign.schedule)} strong />
                </div>

                {!playlist && (
                  <p className="signage-warning-note">Esta campaña no tiene una playlist válida asignada.</p>
                )}
                {playlist?.active === false && (
                  <p className="signage-warning-note">La playlist asignada está inactiva.</p>
                )}
                {playlist && !isPublished(playlist.publishStatus) && (
                  <p className="signage-warning-note">La playlist asignada no está publicada.</p>
                )}

                <div className="signage-card-actions">
                  <button type="button" className="visual-outline-button" onClick={() => onEdit(campaign)} disabled={saving}>
                    Editar
                  </button>
                  <button type="button" className="visual-outline-button" onClick={() => onViewPlaylist(campaign.playlistId)} disabled={saving || !playlist}>
                    Ver playlist
                  </button>
                  <button type="button" className="visual-outline-button" onClick={() => onToggle(campaign)} disabled={saving}>
                    {campaign.active === false ? "Activar" : "Desactivar"}
                  </button>
                  <select
                    className="signage-publish-select"
                    value={getPublishStatus(campaign.publishStatus)}
                    onChange={(event) => onPublishStatusChange(campaign, event.target.value)}
                    disabled={saving}
                  >
                    {PUBLISH_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <button type="button" className="danger-table-button" onClick={() => onDelete(campaign)} disabled={saving}>
                    Eliminar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="signage-side-column">
        <form className="signage-panel" onSubmit={onSubmit}>
          <h3>{editingCampaignId ? "Editar campaña" : "Nueva campaña"}</h3>
          <div className="digital-form-grid">
            <label>
              Nombre
              <input value={form.name} onChange={(event) => updateField("name", event.target.value)} placeholder="Ej. Promoción matutina" />
            </label>
            <label>
              Plantel
              <PlantelSelect value={form.plantel} onChange={(value) => updateField("plantel", value)} />
            </label>
            <label>
              Playlist
              <select value={form.playlistId} onChange={(event) => updateField("playlistId", event.target.value)}>
                <option value="">Seleccionar playlist</option>
                {playlists.map((playlist) => (
                  <option value={playlist.id} key={playlist.id}>{playlist.name}</option>
                ))}
              </select>
            </label>
            <label>
              Prioridad
              <select value={form.priority} onChange={(event) => updateField("priority", event.target.value)}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </label>
            <label>
              Publicación
              <select value={getPublishStatus(form.publishStatus)} onChange={(event) => updateField("publishStatus", event.target.value)}>
                {PUBLISH_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Fecha inicio
              <input type="date" value={form.startDate} onChange={(event) => updateField("startDate", event.target.value)} />
            </label>
            <label>
              Fecha fin
              <input type="date" value={form.endDate} onChange={(event) => updateField("endDate", event.target.value)} />
            </label>
          </div>

          <section className="signage-schedule-box">
            <label className="signage-toggle-row">
              <input
                type="checkbox"
                checked={form.schedule?.enabled === true}
                onChange={(event) => updateSchedule({ enabled: event.target.checked })}
              />
              Usar horario específico
            </label>
            <p className="digital-helper">
              Si no activas esta opción, la campaña se mostrará todo el día durante su vigencia.
            </p>

            {form.schedule?.enabled === true && (
              <>
                <div className="signage-day-picker">
                  {WEEKDAY_OPTIONS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      className={form.schedule.daysOfWeek.includes(day.value) ? "active" : ""}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.short}
                    </button>
                  ))}
                </div>

                <div className="digital-form-grid">
                  <label>
                    Hora inicio
                    <input type="time" value={form.schedule.startTime} onChange={(event) => updateSchedule({ startTime: event.target.value })} />
                  </label>
                  <label>
                    Hora fin
                    <input type="time" value={form.schedule.endTime} onChange={(event) => updateSchedule({ endTime: event.target.value })} />
                  </label>
                  <label>
                    Zona horaria
                    <input value={form.schedule.timezone} readOnly />
                  </label>
                </div>
              </>
            )}
          </section>

          <div className="signage-form-actions">
            {editingCampaignId && (
              <button type="button" className="visual-outline-button" onClick={onCancelEdit}>
                Cancelar edición
              </button>
            )}
            <button type="submit" className="visual-primary-button" disabled={saving}>
              {editingCampaignId ? "Guardar campaña" : "Crear campaña"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function HealthPanel({
  rows,
  stats,
  search,
  filter,
  onSearchChange,
  onFilterChange,
  onOpenDevice,
  onCopyDeviceUrl,
}) {
  return (
    <section className="signage-panel signage-health-panel">
      <div className="signage-panel-heading">
        <div>
          <h2>Panel de salud</h2>
          <p>Monitoreo operativo de pantallas, contenido asignado y conexión reciente.</p>
        </div>
      </div>

      <div className="signage-health-kpis">
        <HealthMetric label="En línea" value={stats.online} status="online" />
        <HealthMetric label="Desconectadas" value={stats.offline} status="offline" />
        <HealthMetric label="Sin contenido" value={stats.unassigned} status="unassigned" />
        <HealthMetric label="Inactivas" value={stats.inactive} status="inactive" />
        <HealthMetric label="Requieren atención" value={stats.attention} status="attention" />
      </div>

      <div className="signage-health-toolbar">
        <label className="signage-search">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar por nombre, plantel o ubicación..."
          />
          <SignageIcon name="search" />
        </label>

        <div className="signage-health-filters">
          {[
            ["all", "Todos"],
            ["online", "En línea"],
            ["offline", "Desconectadas"],
            ["unassigned", "Sin contenido"],
            ["inactive", "Inactivas"],
            ["attention", "Requieren atención"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => onFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="signage-health-list">
        {rows.length === 0 && <p className="digital-empty">Sin dispositivos para este filtro.</p>}
        {rows.map((row) => (
          <HealthDeviceRow
            key={row.device.id}
            row={row}
            onOpenDevice={onOpenDevice}
            onCopyDeviceUrl={onCopyDeviceUrl}
          />
        ))}
      </div>
    </section>
  );
}

function HealthMetric({ label, value, status }) {
  return (
    <article className={`signage-health-metric ${status}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function HealthDeviceRow({ row, onOpenDevice, onCopyDeviceUrl }) {
  const { device, status, requiresAttention, contentLabel, attentionReason } = row;

  return (
    <article className={`signage-health-row ${requiresAttention ? "needs-attention" : ""}`}>
      <div className="signage-health-main">
        <div>
          <strong>{device.name || "Pantalla sin nombre"}</strong>
          <span>{device.plantel || "Sin plantel"} - {device.location || "Sin ubicación"}</span>
        </div>
        <div className="signage-health-badges">
          <StatusBadge status={status} />
          {requiresAttention && <span className="signage-attention-badge">Requiere atención</span>}
        </div>
      </div>

      {requiresAttention && (
        <p className="signage-attention-reason">{attentionReason}</p>
      )}

      <div className="signage-health-details">
        <InfoPair label="Última conexión" value={formatLastSeen(device)} />
        <InfoPair label="Contenido activo" value={contentLabel} strong />
        <InfoPair label="assignedPlaylistId" value={device.assignedPlaylistId || "Sin asignar"} />
        <InfoPair label="active" value={device.active === false ? "false" : "true"} />
        <InfoPair label="deviceToken" value={getMaskedDeviceToken(device)} />
      </div>

      <div className="signage-card-actions signage-compact-actions">
        <button type="button" className="visual-outline-button" onClick={() => onOpenDevice(device)}>
          Ver dispositivo
        </button>
        <button type="button" className="visual-outline-button" onClick={() => onCopyDeviceUrl(device)}>
          Copiar URL
        </button>
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
          <button type="button" className="visual-outline-button" onClick={(event) => { event.stopPropagation(); onCopy(); }}>
            <SignageIcon name="link" />
            Copiar URL
          </button>
          <button type="button" className="signage-icon-button" onClick={(event) => { event.stopPropagation(); onToggle(); }} disabled={saving} title={device.active === false ? "Activar" : "Desactivar"}>
            <SignageIcon name="power" />
          </button>
          <button type="button" className="signage-icon-button danger" onClick={(event) => { event.stopPropagation(); onDelete(); }} disabled={saving} title="Eliminar">
            <SignageIcon name="more" />
          </button>
        </div>
      </div>
    </article>
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

function VisualAdEditor({
  form,
  saving,
  mode,
  dirty,
  draftStatus,
  backgroundPreview,
  selectedElementId,
  visualTemplates,
  canUndo,
  canRedo,
  zoom,
  onSubmit,
  onCancel,
  onSaveTemplate,
  onApplyTemplate,
  onEditTemplate,
  onToggleTemplate,
  onDeleteTemplate,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onFieldChange,
  onCanvasChange,
  onBackgroundTypeChange,
  onBackgroundChange,
  onSelectElement,
  onAddText,
  onAddImage,
  onApplyPreset,
  onAlignElement,
  onDuplicateElement,
  onLayerChange,
  onElementChange,
  onCanvasElementChange,
  onCanvasInteractionStart,
  onElementDelete,
  onElementImageReplace,
}) {
  const previewRef = useRef(null);
  const [controlTab, setControlTab] = useState("general");
  const selectedElement = getSelectedVisualElement(form, selectedElementId);
  const visualAdData = getVisualAdDataForSave(form.visualAdData, backgroundPreview);

  function openFullscreenPreview() {
    previewRef.current?.requestFullscreen?.();
  }

  return (
    <form className="signage-visual-editor-focused" onSubmit={onSubmit}>
      <div className="signage-visual-editor-topbar">
        <button type="button" className="visual-outline-button" onClick={onCancel}>
          ← Volver a Biblioteca
        </button>
        <div>
          <h3>{mode === "edit" ? "Editar anuncio visual" : "Nuevo anuncio visual"}</h3>
          <span>{getVisualAdEditorStatusLabel(saving, dirty, draftStatus)}</span>
        </div>
        <div className="signage-form-actions">
          <button type="button" className="visual-outline-button" onClick={onUndo} disabled={!canUndo || saving}>
            Deshacer
          </button>
          <button type="button" className="visual-outline-button" onClick={onRedo} disabled={!canRedo || saving}>
            Rehacer
          </button>
          <button type="button" className="visual-outline-button" onClick={onSaveTemplate} disabled={saving}>
            Guardar como plantilla
          </button>
          <button type="button" className="visual-outline-button" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="visual-outline-button" onClick={openFullscreenPreview}>
            Vista previa pantalla completa
          </button>
          <button type="submit" className="visual-primary-button" disabled={saving}>
            Guardar anuncio
          </button>
        </div>
      </div>

      <div className="signage-visual-editor-workspace">
        <section className="signage-visual-editor-preview-area">
          <div className="signage-visual-editor-preview-header">
            <div>
              <strong>Preview 16:9</strong>
            <span>{form.title || "Anuncio sin título"}</span>
            </div>
            <div className="signage-visual-zoom-controls" aria-label="Zoom del canvas">
              <button type="button" onClick={onZoomOut} disabled={zoom <= MIN_VISUAL_AD_ZOOM}>
                Zoom -
              </button>
              <strong>{Math.round(zoom * 100)}%</strong>
              <button type="button" onClick={onZoomIn} disabled={zoom >= MAX_VISUAL_AD_ZOOM}>
                Zoom +
              </button>
              <button type="button" onClick={onZoomFit}>
                Ajustar
              </button>
            </div>
          </div>
          <div ref={previewRef} className="signage-visual-editor-canvas-frame">
            <div className="signage-visual-editor-viewport">
              <div className="signage-visual-editor-zoom-shell" style={{ width: `${Math.round(zoom * 100)}%` }}>
                <VisualAdCanvas
                  visualAdData={visualAdData}
                  selectedElementId={selectedElementId}
                  onSelectElement={onSelectElement}
                  onInteractionStart={onCanvasInteractionStart}
                  onElementMove={(elementId, updates) => {
                    onSelectElement(elementId);
                    onCanvasElementChange(elementId, updates, { history: false });
                  }}
                  className="signage-visual-editor-canvas-large"
                  emptyText="Agrega un texto para comenzar."
                />
              </div>
            </div>
          </div>
        </section>

        <aside className="signage-visual-editor-sidepanel">
          <div className="signage-visual-editor-control-tabs">
            {[
              ["general", "General"],
              ["background", "Fondo"],
              ["texts", "Textos"],
              ["style", "Estilo"],
              ["templates", "Plantillas"],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={controlTab === key ? "active" : ""}
                onClick={() => setControlTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="signage-visual-editor-scroll-panel">
            {controlTab === "general" && (
              <section className="signage-visual-editor-section">
                <h4>Datos generales</h4>
                <div className="digital-form-grid">
                  <label>
                    Título
                    <input value={form.title} onChange={(event) => onFieldChange("title", event.target.value)} placeholder="Ej. Anuncio recepción" required />
                  </label>
                  <label>
                    Plantel
                    <PlantelSelect value={form.plantel} onChange={(value) => onFieldChange("plantel", value)} />
                  </label>
                  <label>
                    Duración seg.
                    <input type="number" min="1" max="3600" value={form.durationSeconds} onChange={(event) => onFieldChange("durationSeconds", event.target.value)} />
                  </label>
                  <label className="digital-checkbox-label">
                    <input type="checkbox" checked={form.active} onChange={(event) => onFieldChange("active", event.target.checked)} />
                    Activo
                  </label>
                  <label>
                    Publicación
                    <select value={getPublishStatus(form.publishStatus)} onChange={(event) => onFieldChange("publishStatus", event.target.value)}>
                      {PUBLISH_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </section>
            )}

            {controlTab === "background" && (
              <section className="signage-visual-editor-section">
                <h4>Fondo</h4>
                <div className="signage-visual-controls">
                  <label>
                    Tipo de fondo
                    <select value={form.visualAdData.canvas.backgroundType} onChange={(event) => onBackgroundTypeChange(event.target.value)}>
                      <option value="solid">Color sólido</option>
                  <option value="image">Imagen</option>
                </select>
              </label>
              <label>
                Color de fondo
                <input type="color" value={form.visualAdData.canvas.backgroundColor} onChange={(event) => onCanvasChange({ backgroundColor: event.target.value })} />
              </label>
                  {form.visualAdData.canvas.backgroundType === "image" && (
                    <label className="digital-full-field">
                      Imagen de fondo
                      <input type="file" accept="image/*" onChange={(event) => onBackgroundChange(event.target.files?.[0] || null)} />
                    </label>
                  )}
              {form.visualAdData.canvas.backgroundType === "image" && (
                <button type="button" className="visual-outline-button digital-full-field" onClick={() => onBackgroundTypeChange("solid")}>
                  Quitar imagen de fondo
                </button>
              )}
                </div>
              </section>
            )}

            {controlTab === "texts" && (
              <section className="signage-visual-editor-section">
                <div className="signage-section-title-row">
                  <h4>Elementos de texto</h4>
                  <button type="button" className="visual-outline-button" onClick={onAddText}>
                    Agregar texto
                  </button>
                </div>
                <label className="visual-outline-button signage-visual-file-button">
                  Agregar imagen
                  <input type="file" accept="image/*" onChange={(event) => onAddImage(event.target.files?.[0] || null)} />
                </label>
                <div className="signage-visual-preset-grid">
                  <button type="button" onClick={() => onApplyPreset("center-title")}>Título grande centrado</button>
                  <button type="button" onClick={() => onApplyPreset("title-subtitle")}>Título + subtítulo</button>
                  <button type="button" onClick={() => onApplyPreset("image-left")}>Imagen izquierda + texto derecha</button>
                  <button type="button" onClick={() => onApplyPreset("urgent")}>Aviso urgente</button>
                  <button type="button" onClick={() => onApplyPreset("coffee")}>Promoción Coffee Beans</button>
                </div>
                <div className="signage-visual-elements-list signage-visual-element-list">
                  {form.visualAdData.elements.length === 0 && <p className="digital-empty">Sin elementos agregados.</p>}
                  {form.visualAdData.elements.map((element, index) => (
                    <div
                      key={element.id}
                      className={`signage-visual-element-list-row ${element.id === selectedElementId ? "active" : ""}`}
                    >
                      <button type="button" onClick={() => onSelectElement(element.id)}>
                        <span>{index + 1}</span>
                        <strong>{getVisualAdElementLabel(element)}</strong>
                        {element.locked === true && <em className="signage-visual-locked-badge">Bloqueado</em>}
                      </button>
                      <button type="button" className="visual-outline-button" onClick={() => onDuplicateElement(element)}>
                        Duplicar
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {controlTab === "style" && (
              <section className="signage-visual-editor-section">
                <h4>Propiedades del texto</h4>
                {selectedElement ? (
                  <>
                  <div className="signage-visual-layer-actions">
                    <button type="button" className="visual-outline-button" onClick={() => onDuplicateElement(selectedElement)}>
                      Duplicar
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => onLayerChange(1)}>
                      Traer adelante
                    </button>
                    <button type="button" className="visual-outline-button" onClick={() => onLayerChange(-1)}>
                      Enviar atrás
                    </button>
                  </div>
                  <div className="signage-visual-align-actions">
                    <button type="button" className="visual-outline-button" onClick={() => onAlignElement("left")}>Izquierda</button>
                    <button type="button" className="visual-outline-button" onClick={() => onAlignElement("center-x")}>Centro H</button>
                    <button type="button" className="visual-outline-button" onClick={() => onAlignElement("right")}>Derecha</button>
                    <button type="button" className="visual-outline-button" onClick={() => onAlignElement("top")}>Arriba</button>
                    <button type="button" className="visual-outline-button" onClick={() => onAlignElement("center-y")}>Centro V</button>
                    <button type="button" className="visual-outline-button" onClick={() => onAlignElement("bottom")}>Abajo</button>
                  </div>
                  <VisualAdElementControls
                    element={selectedElement}
                    onChange={onElementChange}
                    onDelete={onElementDelete}
                    onImageReplace={onElementImageReplace}
                  />
                  </>
                ) : (
                  <p className="digital-empty">Selecciona o agrega un texto.</p>
                )}
              </section>
            )}

            {controlTab === "templates" && (
              <section className="signage-visual-editor-section">
                <div className="signage-section-title-row">
                  <h4>Plantillas guardadas</h4>
                  <button type="button" className="visual-outline-button" onClick={onSaveTemplate} disabled={saving}>
                    Guardar actual
                  </button>
                </div>
                <p className="signage-helper-note">
                  Usa una plantilla como punto de partida. Cambiar el anuncio no modifica la plantilla original.
                </p>
                <div className="signage-visual-template-list">
                  {visualTemplates.length === 0 && <p className="digital-empty">Sin plantillas guardadas.</p>}
                  {visualTemplates.map((template) => (
                    <article className={`signage-visual-template-card ${template.active === false ? "inactive" : ""}`} key={template.id}>
                      <VisualAdPreview visualAdData={template.visualAdData} mini />
                      <div>
                        <strong>{template.name || "Plantilla sin nombre"}</strong>
                        <span>{getVisualTemplateCategoryLabel(template.category)} - {template.active === false ? "Inactiva" : "Activa"}</span>
                        {template.description && <small>{template.description}</small>}
                      </div>
                      <div className="signage-visual-template-actions">
                        <button type="button" className="visual-primary-button" onClick={() => onApplyTemplate(template)} disabled={saving || template.active === false}>
                          Usar
                        </button>
                        <button type="button" className="visual-outline-button" onClick={() => onEditTemplate(template)} disabled={saving}>
                          Editar
                        </button>
                        <button type="button" className="visual-outline-button" onClick={() => onToggleTemplate(template)} disabled={saving}>
                          {template.active === false ? "Activar" : "Desactivar"}
                        </button>
                        <button type="button" className="danger-table-button" onClick={() => onDeleteTemplate(template)} disabled={saving}>
                          Eliminar
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        </aside>
      </div>
    </form>
  );
}

function VisualAdPreview({
  visualAdData,
  className = "",
  mini = false,
  placeholder = "Vista no disponible",
}) {
  const data = normalizeVisualAdDataForEditor(visualAdData || {});
  const canvas = data.canvas || {};
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const hasBackgroundImage = canvas.backgroundType === "image" && canvas.backgroundUrl;
  const hasContent = hasBackgroundImage || canvas.backgroundColor || elements.length > 0;
  const previewStyle = {
    backgroundColor: canvas.backgroundColor || "#0f4fc4",
  };

  if (!hasContent) {
    return (
      <div className={`signage-visual-ad-preview signage-visual-ad-preview-placeholder ${mini ? "signage-visual-ad-preview-mini" : ""} ${className}`}>
        {placeholder}
      </div>
    );
  }

  return (
    <div
      className={`signage-visual-ad-preview ${mini ? "signage-visual-ad-preview-mini" : ""} ${className}`}
      style={previewStyle}
      aria-label="Miniatura de anuncio visual"
    >
      {hasBackgroundImage && (
        <div
          className="signage-visual-ad-preview-bg"
          style={{ backgroundImage: `url("${canvas.backgroundUrl}")` }}
        />
      )}
      {[...elements].sort(compareVisualAdElements).map((element) => (
        <div
          key={element.id}
          className={[
            "signage-visual-ad-preview-element",
            element.type === "image" ? "image" : "text",
          ].join(" ")}
          style={getVisualPreviewElementStyle(element)}
        >
          {element.type === "image" ? (
            element.url ? (
              <img
                src={element.url}
                alt=""
                loading="lazy"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null
          ) : (
            element.text || ""
          )}
        </div>
      ))}
    </div>
  );
}

function VisualAdCanvas({
  visualAdData,
  selectedElementId = "",
  onSelectElement,
  onElementMove,
  onInteractionStart,
  className = "",
  emptyText = "",
}) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [guide, setGuide] = useState({ vertical: false, horizontal: false });
  const canvas = visualAdData?.canvas || {};
  const elements = Array.isArray(visualAdData?.elements) ? visualAdData.elements : [];
  const style = {
    backgroundColor: canvas.backgroundColor || "#0f4fc4",
    backgroundImage:
      canvas.backgroundType === "image" && canvas.backgroundUrl
        ? `url("${canvas.backgroundUrl}")`
        : "none",
  };

  function handlePointerDown(event, element) {
    onSelectElement?.(element.id);

    if (element.locked === true) {
      return;
    }

    if (!onElementMove) {
      return;
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onInteractionStart?.();
    dragRef.current = {
      mode: "move",
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      baseX: Number(element.x) || 0,
      baseY: Number(element.y) || 0,
      baseWidth: Number(element.width) || (element.type === "image" ? 30 : 50),
      rect,
    };
  }

  function handleResizePointerDown(event, element) {
    if (element.locked === true || !onElementMove) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelectElement?.(element.id);
    onInteractionStart?.();
    dragRef.current = {
      mode: "resize",
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      baseX: Number(element.x) || 0,
      baseY: Number(element.y) || 0,
      baseWidth: Number(element.width) || (element.type === "image" ? 30 : 50),
      rect,
    };
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || !onElementMove) return;

    const deltaX = ((event.clientX - drag.startX) / drag.rect.width) * 100;
    const deltaY = ((event.clientY - drag.startY) / drag.rect.height) * 100;

    if (drag.mode === "resize") {
      const width = clampNumber(drag.baseWidth + deltaX, 5, 100, drag.baseWidth);
      const centerX = drag.baseX + width / 2;
      const nearVertical = Math.abs(centerX - 50) <= 2;
      setGuide({ vertical: nearVertical, horizontal: false });
      onElementMove(drag.id, { width });
      return;
    }

    let nextX = clampNumber(drag.baseX + deltaX, 0, 100, drag.baseX);
    let nextY = clampNumber(drag.baseY + deltaY, 0, 100, drag.baseY);
    const centerX = nextX + drag.baseWidth / 2;
    const nearVertical = Math.abs(centerX - 50) <= 2;
    const nearHorizontal = Math.abs(nextY - 50) <= 2;

    if (nearVertical) nextX = clampNumber(50 - drag.baseWidth / 2, 0, 100, nextX);
    if (nearHorizontal) nextY = 50;

    setGuide({ vertical: nearVertical, horizontal: nearHorizontal });
    onElementMove(drag.id, { x: nextX, y: nextY });
  }

  function stopDrag() {
    dragRef.current = null;
    setGuide({ vertical: false, horizontal: false });
  }

  return (
    <div
      ref={canvasRef}
      className={`signage-visual-canvas ${className}`}
      style={style}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onPointerLeave={stopDrag}
    >
      {!elements.length && emptyText && (
        <div className="signage-visual-empty-hint">{emptyText}</div>
      )}
      {guide.vertical && <span className="signage-visual-guide vertical" />}
      {guide.horizontal && <span className="signage-visual-guide horizontal" />}
      {[...elements].sort(compareVisualAdElements).map((element) => (
        <button
          type="button"
          key={element.id}
          className={[
            "signage-visual-element",
            "signage-visual-canvas-element",
            element.type === "image" ? "signage-visual-image-element" : "signage-visual-text-element",
            element.id === selectedElementId ? "selected" : "",
          ].join(" ")}
          style={getVisualElementStyle(element)}
          onPointerDown={(event) => handlePointerDown(event, element)}
          onClick={() => onSelectElement?.(element.id)}
        >
          {element.type === "image" ? (
            <img src={element.url} alt="Elemento visual" draggable="false" />
          ) : (
            element.text || "Texto"
          )}
          {element.id === selectedElementId && element.locked === true && (
            <span className="signage-visual-locked-badge canvas">Bloqueado</span>
          )}
          {element.id === selectedElementId && element.locked !== true && (
            <span
              className="signage-visual-resize-handle"
              onPointerDown={(event) => handleResizePointerDown(event, element)}
            />
          )}
        </button>
      ))}
    </div>
  );
}

function VisualAdElementControls({ element, onChange, onDelete, onImageReplace }) {
  if (element.type === "image") {
    return (
      <div className="signage-visual-controls signage-visual-element-panel">
        <label className="digital-checkbox-label digital-full-field">
          <input type="checkbox" checked={element.locked === true} onChange={(event) => onChange({ locked: event.target.checked })} />
          Bloquear elemento
        </label>
        <label>
          X
          <input type="range" min="0" max="100" value={element.x} onChange={(event) => onChange({ x: event.target.value })} />
          <span>{element.x}%</span>
        </label>
        <label>
          Y
          <input type="range" min="0" max="100" value={element.y} onChange={(event) => onChange({ y: event.target.value })} />
          <span>{element.y}%</span>
        </label>
        <label>
          Ancho
          <input type="range" min="5" max="100" value={element.width} onChange={(event) => onChange({ width: event.target.value })} />
          <span>{element.width}%</span>
        </label>
        <label>
          Opacidad
          <input type="range" min="0" max="1" step="0.05" value={element.opacity ?? 1} onChange={(event) => onChange({ opacity: event.target.value })} />
          <span>{Math.round((Number(element.opacity ?? 1)) * 100)}%</span>
        </label>
        <label>
          Radio borde
          <input type="range" min="0" max="100" value={element.borderRadius || 0} onChange={(event) => onChange({ borderRadius: event.target.value })} />
          <span>{element.borderRadius || 0}px</span>
        </label>
        <label className="digital-full-field">
          Reemplazar imagen
          <input type="file" accept="image/*" onChange={(event) => onImageReplace(event.target.files?.[0] || null)} />
        </label>
        <button type="button" className="danger-table-button" onClick={onDelete}>
          Eliminar imagen
        </button>
      </div>
    );
  }

  return (
    <div className="signage-visual-controls signage-visual-element-panel">
      <label className="digital-checkbox-label digital-full-field">
        <input type="checkbox" checked={element.locked === true} onChange={(event) => onChange({ locked: event.target.checked })} />
        Bloquear elemento
      </label>
      <label className="digital-full-field">
        Texto
        <textarea value={element.text} onChange={(event) => onChange({ text: event.target.value })} rows="2" />
      </label>
      <label>
        X
        <input type="range" min="0" max="100" value={element.x} onChange={(event) => onChange({ x: event.target.value })} />
        <span>{element.x}%</span>
      </label>
      <label>
        Y
        <input type="range" min="0" max="100" value={element.y} onChange={(event) => onChange({ y: event.target.value })} />
        <span>{element.y}%</span>
      </label>
      <label>
        Ancho
        <input type="range" min="5" max="100" value={element.width} onChange={(event) => onChange({ width: event.target.value })} />
        <span>{element.width}%</span>
      </label>
      <label>
        Tamaño
        <input type="number" min="12" max="160" value={element.fontSize} onChange={(event) => onChange({ fontSize: event.target.value })} />
      </label>
      <label>
        Color
        <input type="color" value={element.color} onChange={(event) => onChange({ color: event.target.value })} />
      </label>
      <label>
        Alineación
        <select value={element.align} onChange={(event) => onChange({ align: event.target.value })}>
          <option value="left">Izquierda</option>
          <option value="center">Centro</option>
          <option value="right">Derecha</option>
        </select>
      </label>
      <label className="digital-checkbox-label">
        <input type="checkbox" checked={element.fontWeight === "bold"} onChange={(event) => onChange({ fontWeight: event.target.checked ? "bold" : "normal" })} />
        Negrita
      </label>
      <button type="button" className="danger-table-button" onClick={onDelete}>
        Eliminar texto
      </button>
    </div>
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
  const items = playlist?.items || [];
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
        <p className="signage-warning-note">Vista previa: este contenido aÃºn no estÃ¡ publicado.</p>
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

function getVisualTemplateCategoryLabel(value = "") {
  return VISUAL_TEMPLATE_CATEGORIES.find((category) => category.value === value)?.label || "Otro";
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

function getVisualAdEditorStatusLabel(saving, dirty, draftStatus) {
  if (saving) return "Guardando...";
  if (draftStatus === "saved") return "Borrador guardado";
  if (dirty) return "Cambios sin guardar";
  return "Guardado";
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

function getVisualElementStyle(element) {
  if (element.type === "image") {
    return {
      left: `${clampNumber(element.x, 0, 100, 10)}%`,
      top: `${clampNumber(element.y, 0, 100, 10)}%`,
      width: `${clampNumber(element.width, 5, 100, 30)}%`,
      height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: `${clampNumber(element.borderRadius, 0, 100, 0)}px`,
      transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
      zIndex: clampNumber(element.zIndex, 0, 999, 1),
    };
  }

  return {
    left: `${clampNumber(element.x, 0, 100, 10)}%`,
    top: `${clampNumber(element.y, 0, 100, 10)}%`,
    width: `${clampNumber(element.width, 5, 100, 50)}%`,
    height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
    color: element.color || "#ffffff",
    fontSize: `clamp(12px, ${clampNumber(element.fontSize, 12, 160, 48) / 18}vw, ${clampNumber(element.fontSize, 12, 160, 48)}px)`,
    fontWeight: element.fontWeight === "bold" ? 900 : 500,
    textAlign: ["left", "center", "right"].includes(element.align) ? element.align : "left",
    transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };
}

function getVisualPreviewElementStyle(element) {
  const baseStyle = {
    left: `${clampNumber(element.x, 0, 100, 10)}%`,
    top: `${clampNumber(element.y, 0, 100, 10)}%`,
    width: `${clampNumber(element.width, 5, 100, element.type === "image" ? 30 : 50)}%`,
    height: element.height ? `${clampNumber(element.height, 5, 100, 20)}%` : "auto",
    transform: element.rotation ? `rotate(${clampNumber(element.rotation, -180, 180, 0)}deg)` : "none",
    zIndex: clampNumber(element.zIndex, 0, 999, 1),
  };

  if (element.type === "image") {
    return {
      ...baseStyle,
      opacity: clampDecimal(element.opacity, 0, 1, 1),
      borderRadius: `${clampNumber(element.borderRadius, 0, 100, 0)}px`,
    };
  }

  const fontSize = clampNumber(element.fontSize, 12, 160, 48);

  return {
    ...baseStyle,
    color: element.color || "#ffffff",
    fontSize: `clamp(7px, ${fontSize / 18}cqw, ${fontSize}px)`,
    fontWeight: element.fontWeight === "bold" ? 900 : 500,
    textAlign: ["left", "center", "right"].includes(element.align) ? element.align : "left",
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
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

function getVisualAdElementLabel(element) {
  if (element?.type === "image") return "Imagen";
  const text = String(element?.text || "").trim();
  if (!text) return "Texto";
  return `Texto: ${text.slice(0, 28)}${text.length > 28 ? "..." : ""}`;
}

function getNextVisualAdZIndex(elements = []) {
  return Math.max(0, ...elements.map((element) => Number(element.zIndex) || 0)) + 1;
}

function compareVisualAdElements(first, second) {
  return (Number(first.zIndex) || 0) - (Number(second.zIndex) || 0);
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

function getPublishStatus(status = "") {
  return PUBLISH_STATUS_OPTIONS.some((option) => option.value === status) ? status : "published";
}

function isPublished(status = "") {
  return getPublishStatus(status) === "published";
}

function getPublishStatusLabel(status = "") {
  const normalizedStatus = getPublishStatus(status);
  return PUBLISH_STATUS_OPTIONS.find((option) => option.value === normalizedStatus)?.label || "Publicado";
}

function getPublishStatusMessage(entityLabel, publishStatus) {
  const labels = {
    draft: `${entityLabel} guardado como borrador.`,
    review: `${entityLabel} enviado a revisión.`,
    published: `${entityLabel} publicado.`,
    archived: `${entityLabel} archivado.`,
  };

  return labels[getPublishStatus(publishStatus)] || `${entityLabel} actualizado.`;
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

function formatDuration(seconds) {
  const safeSeconds = Math.max(Number(seconds) || 0, 0);
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
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

function compareCampaignPriority(first, second) {
  return getCampaignPriorityWeight(second.priority) - getCampaignPriorityWeight(first.priority);
}

function getCampaignPriorityWeight(priority) {
  if (priority === "urgente") return 3;
  if (priority === "alta") return 2;
  return 1;
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

function normalizeSearch(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
