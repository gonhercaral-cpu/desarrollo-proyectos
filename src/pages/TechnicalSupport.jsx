import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "../context/AuthContext";
import {
  createTechnicalAsset,
  createTechnicalAssetMovement,
  getTechnicalAssetLogs,
  getTechnicalAssets,
  updateTechnicalAsset,
  deleteTechnicalAsset,
  restoreTechnicalAsset,
} from "../services/technicalAssetsService";
import {
  completeTechnicalMaintenance,
  createDefaultMaintenancesForAsset,
  createTechnicalMaintenance,
  getDefaultMaintenanceChecklistForAsset,
  getTechnicalMaintenances,
} from "../services/technicalMaintenancesService";
import {
  createTechnicalLocation,
  createTechnicalLocationReview,
  getDefaultTechnicalLocationChecklist,
  getTechnicalLocationReviews,
  getTechnicalLocations,
  updateTechnicalLocation,
  updateTechnicalLocationChecklist,
} from "../services/technicalLocationsService";
import {
  createTechnicalSparePart,
  createTechnicalSparePartMovement,
  generateTechnicalSparePartInternalCodeFromParts,
  deactivateTechnicalSparePart,
  getTechnicalSparePartMovements,
  getTechnicalSpareParts,
  restoreTechnicalSparePart,
  updateTechnicalSparePart,
} from "../services/technicalSparePartsService";
import {
  createTechnicalInstallationTemplate,
  deactivateTechnicalInstallationTemplate,
  getTechnicalInstallationTemplates,
  restoreTechnicalInstallationTemplate,
  updateTechnicalInstallationTemplate,
} from "../services/technicalInstallationTemplatesService";
import {
  cancelTechnicalInstallation,
  completeTechnicalInstallation,
  createTechnicalInstallation,
  getTechnicalInstallations,
  updateTechnicalInstallation,
} from "../services/technicalInstallationsService";


const HTML5_QRCODE_SCRIPT_ID = "html5-qrcode-camera-scanner";
const HTML5_QRCODE_CDN_URL = "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js";

function loadHtml5QrcodeLibrary() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("El navegador no está disponible."));
  }

  if (window.Html5Qrcode) {
    return Promise.resolve(window.Html5Qrcode);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById(HTML5_QRCODE_SCRIPT_ID);

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(window.Html5Qrcode), {
        once: true,
      });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("No se pudo cargar el lector de códigos.")),
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.id = HTML5_QRCODE_SCRIPT_ID;
    script.src = HTML5_QRCODE_CDN_URL;
    script.async = true;

    script.onload = () => {
      if (window.Html5Qrcode) {
        resolve(window.Html5Qrcode);
        return;
      }

      reject(new Error("El lector de códigos no quedó disponible."));
    };

    script.onerror = () => {
      reject(new Error("No se pudo cargar el lector de códigos."));
    };

    document.body.appendChild(script);
  });
}

const ASSET_CATEGORIES = [
  "Computadora",
  "Laptop",
  "Monitor",
  "Impresora",
  "Cámara",
  "DVR/NVR",
  "Pantalla",
  "Router",
  "Switch",
  "Access Point",
  "No-break",
  "Bocina",
  "Proyector",
  "Otro",
];

const ASSET_STATUSES = [
  "Activo",
  "En reparación",
  "En mantenimiento",
  "Prestado",
  "Guardado",
  "Dado de baja",
];

const ASSET_CONDITIONS = ["Excelente", "Bueno", "Regular", "Malo"];

const CAMPUS_OPTIONS = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Coffee Beans Factory",
  "Otro",
];

const CAMPUS_FILTER_OPTIONS = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Coffee Beans Factory",
];

const LOCATION_AREAS = [
  "Recepción",
  "Administración",
  "Dirección",
  "Salones",
  "Cabina Online",
  "Imprenta",
  "Café",
  "Soporte Técnico",
  "Otro",
];

const TECHNICAL_LOCATION_TYPES = [
  "Cabina",
  "Salón",
  "Recepción",
  "Coffee Beans",
  "Oficina",
  "Área común",
  "Otro",
];

const TECHNICAL_LOCATION_STATUSES = [
  "Correcto",
  "Requiere atención",
  "Pendiente",
  "Inactivo",
];

const LOCATION_REVIEW_STATUSES = [
  "Correcto",
  "Requiere atención",
  "No funciona",
  "Falta",
  "No aplica",
];

const LOCATION_REVIEW_CADENCE_BY_TYPE = {
  Cabina: { frequency: "Cada 15 días", days: 15 },
  Salón: { frequency: "Cada mes", days: 30 },
  Recepción: { frequency: "Cada mes", days: 30 },
  "Coffee Beans": { frequency: "Cada mes", days: 30 },
  Oficina: { frequency: "Cada 2 meses", days: 60 },
  "Área común": { frequency: "Cada 2 meses", days: 60 },
  Otro: { frequency: "Cada 2 meses", days: 60 },
};

const EMPTY_LOCATION_REVIEW_FORM = {
  generalStatus: "Correcto",
  observations: "",
  pendingActions: "",
};

const SPARE_PART_CATEGORY_OPTIONS = [
  "Impresoras",
  "Computadoras",
  "Periféricos",
  "Cables y adaptadores",
  "Redes",
  "Audio / video",
  "Energía",
  "Herramientas",
  "Consumibles",
  "Otro",
];

const SPARE_PART_TYPE_OPTIONS = [
  "Tinta",
  "Tóner",
  "Tambor",
  "Cabezal",
  "Encoder",
  "Rodillo",
  "Fuente de poder",
  "Memoria RAM",
  "Disco / SSD",
  "Teclado",
  "Mouse",
  "Cable HDMI",
  "Cable auxiliar",
  "Adaptador",
  "Pilas / baterías",
  "Otro",
];

const SPARE_PART_UNIT_OPTIONS = [
  "pieza",
  "paquete",
  "juego",
  "metro",
  "rollo",
  "cartucho",
  "botella",
  "caja",
  "Otro",
];

const SPARE_PART_STOCK_FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "low", label: "Bajo stock" },
  { value: "empty", label: "Sin stock" },
  { value: "inactive", label: "Inactivos" },
];

const EMPTY_SPARE_PART_FORM = {
  name: "",
  barcode: "",
  internalCode: "",
  category: "Impresoras",
  categoryOther: "",
  partType: "Tinta",
  partTypeOther: "",
  brand: "",
  model: "",
  compatibleModels: "",
  quantity: 0,
  minQuantity: 0,
  unit: "pieza",
  unitOther: "",
  storageLocation: "",
  status: "active",
  notes: "",
};

const EMPTY_SPARE_PART_MOVEMENT_FORM = {
  quantity: 1,
  finalQuantity: 0,
  reason: "",
  notes: "",
};

const SPARE_PART_MOVEMENT_TYPES = {
  entry: {
    label: "Entrada",
    sign: "+",
    help: "Suma piezas al inventario.",
  },
  exit: {
    label: "Salida",
    sign: "-",
    help: "Descuenta piezas del inventario.",
  },
  adjustment: {
    label: "Ajuste",
    sign: "=",
    help: "Corrige la existencia final cuando hay una diferencia física.",
  },
};


const INSTALLATION_TEMPLATE_LOCATION_TYPES = [
  "Salón",
  "Cabina",
  "Recepción",
  "Oficina",
  "Coffee Beans",
  "Área común",
  "Otro",
];

const INSTALLATION_TEMPLATE_EQUIPMENT_CATEGORIES = [
  "Computadora",
  "Impresora",
  "Pantalla",
  "Monitor",
  "Audio / video",
  "Redes",
  "Punto de trabajo",
  "Otro",
];

const INSTALLATION_TEMPLATE_SECTIONS = [
  {
    key: "physicalItems",
    title: "Componentes físicos",
    icon: "▣",
    description: "Equipo, accesorios, cables y piezas que deben quedar instalados.",
    placeholder: "Ej. Teclado, mouse, cable HDMI, monitor...",
  },
  {
    key: "softwareItems",
    title: "Programas",
    icon: "⌘",
    description: "Programas, accesos, navegadores o herramientas que deben instalarse.",
    placeholder: "Ej. Navegador actualizado, lector PDF, software de clase...",
  },
  {
    key: "configurationItems",
    title: "Configuraciones",
    icon: "⚙",
    description: "Ajustes técnicos que deben revisarse antes de entregar el equipo.",
    placeholder: "Ej. Configurar audio, resolución, nombre del equipo...",
  },
  {
    key: "testItems",
    title: "Pruebas finales",
    icon: "✓",
    description: "Validaciones finales para confirmar que todo quedó funcionando.",
    placeholder: "Ej. Probar internet, audio, teclado, evidencia fotográfica...",
  },
];

const EMPTY_INSTALLATION_TEMPLATE_FORM = {
  name: "",
  description: "",
  targetLocationType: "Salón",
  targetLocationTypeOther: "",
  equipmentCategory: "Computadora",
  equipmentCategoryOther: "",
  active: true,
  physicalItems: [
    { id: "physical-computer", label: "Computadora / CPU", required: true },
    { id: "physical-monitor", label: "Monitor", required: true },
    { id: "physical-keyboard", label: "Teclado", required: true },
    { id: "physical-mouse", label: "Mouse", required: true },
  ],
  softwareItems: [
    { id: "software-browser", label: "Navegador actualizado", required: true },
    { id: "software-pdf", label: "Lector PDF", required: false },
  ],
  configurationItems: [
    { id: "config-name", label: "Configurar nombre del equipo", required: true },
    { id: "config-audio", label: "Configurar y probar audio", required: true },
  ],
  testItems: [
    { id: "test-internet", label: "Probar conexión a internet", required: true },
    { id: "test-evidence", label: "Tomar evidencia fotográfica", required: true },
  ],
};

const INSTALLATION_TEMPLATE_SAMPLE = {
  name: "Instalación de computadora en salón",
  description:
    "Proceso estándar para instalar una computadora completa en un salón, incluyendo accesorios, programas, configuraciones y pruebas finales.",
  targetLocationType: "Salón",
  targetLocationTypeOther: "",
  equipmentCategory: "Computadora",
  equipmentCategoryOther: "",
  active: true,
  physicalItems: [
    { id: "sample-cpu", label: "Computadora / CPU", required: true },
    { id: "sample-monitor", label: "Monitor", required: true },
    { id: "sample-keyboard", label: "Teclado", required: true },
    { id: "sample-mouse", label: "Mouse", required: true },
    { id: "sample-power", label: "Cables de corriente", required: true },
    { id: "sample-video", label: "Cable HDMI o DisplayPort", required: true },
    { id: "sample-audio-cable", label: "Cable auxiliar", required: false },
    { id: "sample-nobreak", label: "Regulador o no-break si aplica", required: false },
  ],
  softwareItems: [
    { id: "sample-browser", label: "Instalar navegador actualizado", required: true },
    { id: "sample-pdf", label: "Instalar lector PDF", required: true },
    { id: "sample-class", label: "Instalar o validar programas de clase", required: true },
    { id: "sample-shortcuts", label: "Crear accesos directos necesarios", required: false },
    { id: "sample-remote", label: "Instalar herramienta de soporte remoto si aplica", required: false },
  ],
  configurationItems: [
    { id: "sample-name", label: "Configurar nombre del equipo", required: true },
    { id: "sample-internet", label: "Conectar y validar internet", required: true },
    { id: "sample-resolution", label: "Configurar resolución de pantalla", required: true },
    { id: "sample-audio", label: "Configurar salida de audio correcta", required: true },
    { id: "sample-user", label: "Validar usuario o cuenta de trabajo", required: false },
  ],
  testItems: [
    { id: "sample-power-on", label: "Probar encendido y reinicio", required: true },
    { id: "sample-keyboard-mouse", label: "Probar teclado y mouse", required: true },
    { id: "sample-audio-test", label: "Probar reproducción de audio", required: true },
    { id: "sample-programs", label: "Abrir programas principales", required: true },
    { id: "sample-clean", label: "Dejar cableado ordenado", required: true },
    { id: "sample-photo", label: "Tomar evidencia fotográfica", required: true },
  ],
};

const INSTALLATION_STATUS_OPTIONS = [
  { value: "draft", label: "Borrador" },
  { value: "in_progress", label: "En proceso" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Completada" },
  { value: "cancelled", label: "Cancelada" },
];

const INSTALLATION_STATUS_FILTERS = [
  { value: "active", label: "Activas" },
  { value: "completed", label: "Completadas" },
  { value: "cancelled", label: "Canceladas" },
  { value: "todos", label: "Todas" },
];

const EMPTY_INSTALLATION_FORM = {
  title: "",
  templateId: "",
  campus: "",
  locationId: "",
  locationName: "",
  locationType: "",
  responsibleName: "",
  status: "in_progress",
  notes: "",
  installedEquipment: [],
};

const TECHNICAL_TABS = [
  { id: "resumen", label: "Resumen", icon: "⌂" },
  { id: "mantenimientos", label: "Mantenimientos", icon: "🛠" },
  { id: "equipos", label: "Equipos", icon: "▣" },
  { id: "recambios", label: "Recambios", icon: "▤" },
  { id: "instalaciones", label: "Instalaciones", icon: "▥" },
  { id: "bajas", label: "Bajas", icon: "↓" },
  { id: "ubicaciones-tecnicas", label: "Ubicaciones técnicas", icon: "⌖" },
  { id: "registrar-equipo", label: "Registrar equipo", icon: "+" },
];

const MOVEMENT_TYPES = [
  "Mantenimiento preventivo",
  "Mantenimiento correctivo",
  "Reparación",
  "Cambio de pieza",
  "Limpieza",
  "Configuración",
  "Instalación",
  "Revisión",
  "Préstamo",
  "Devolución",
  "Baja del equipo",
  "Otro movimiento",
];

const MAINTENANCE_FREQUENCIES = [
  "Una vez",
  "Cada semana",
  "Cada 15 días",
  "Cada mes",
  "Cada 2 meses",
  "Cada 3 meses",
  "Cada 6 meses",
  "Cada año",
];

const MAINTENANCE_STATUSES = [
  "Programado",
  "En proceso",
  "Realizado",
  "Cancelado",
];

const CATEGORY_PREFIXES = {
  Computadora: "PC",
  Laptop: "LAP",
  Monitor: "MON",
  Impresora: "IMP",
  Cámara: "CAM",
  "DVR/NVR": "DVR",
  Pantalla: "PAN",
  Router: "ROU",
  Switch: "SW",
  "Access Point": "AP",
  "No-break": "NB",
  Bocina: "BOC",
  Proyector: "PRO",
  Otro: "OTR",
};

const EMPTY_ASSET_FORM = {
  assetTag: "",
  name: "",
  category: "Computadora",
  brand: "",
  model: "",
  serialNumber: "",
  campus: "",
  campusOther: "",
  area: "",
  assignedTo: "",
  technicalLocationId: "",
  technicalLocationName: "",
  technicalLocationType: "",
  status: "Activo",
  condition: "Bueno",
  notes: "",
  maintenanceChecklistTemplate: [],
};

const EMPTY_MOVEMENT_FORM = {
  type: "Mantenimiento preventivo",
  title: "",
  description: "",
  status: "",
  condition: "",
};

const EMPTY_MAINTENANCE_FORM = {
  title: "Limpieza preventiva",
  description: "",
  frequency: "Cada 3 meses",
  nextDate: "",
  assignedTo: "Soporte Técnico",
  status: "Programado",
  checklistTemplate: [],
};

const EMPTY_COMPLETION_FORM = {
  title: "",
  description: "",
  status: "",
  condition: "",
  checklist: [],
};

const EMPTY_LOCATION_FORM = {
  name: "",
  campus: "",
  campusOther: "",
  area: "",
  type: "Cabina",
  status: "Correcto",
  notes: "",
};


function isActiveTechnicalAsset(asset) {
  return Boolean(
    asset &&
      asset.deleted !== true &&
      asset.active !== false &&
      asset.status !== "Eliminado" &&
      asset.status !== "Dado de baja"
  );
}

function isMaintenanceVisibleForActiveAssets(maintenance, activeAssetIds) {
  if (!maintenance) return false;
  if (maintenance.assetDeleted === true || maintenance.deleted === true) return false;
  if (!maintenance.assetId) return true;

  return activeAssetIds.has(maintenance.assetId);
}

export default function TechnicalSupport() {
  const { profile } = useAuth();

  const [assets, setAssets] = useState([]);
  const [maintenances, setMaintenances] = useState([]);
  const [technicalLocations, setTechnicalLocations] = useState([]);

  const [spareParts, setSpareParts] = useState([]);
  const [sparePartMovements, setSparePartMovements] = useState([]);
  const [loadingSpareParts, setLoadingSpareParts] = useState(true);
  const [loadingSparePartMovements, setLoadingSparePartMovements] =
    useState(false);
  const [sparePartSearchTerm, setSparePartSearchTerm] = useState("");
  const [sparePartCategoryFilter, setSparePartCategoryFilter] =
    useState("Todas");
  const [sparePartTypeFilter, setSparePartTypeFilter] = useState("Todos");
  const [sparePartStockFilter, setSparePartStockFilter] = useState("active");
  const [showSparePartForm, setShowSparePartForm] = useState(false);
  const [sparePartForm, setSparePartForm] = useState(EMPTY_SPARE_PART_FORM);
  const [editingSparePartId, setEditingSparePartId] = useState(null);
  const [sparePartFormError, setSparePartFormError] = useState("");
  const [savingSparePart, setSavingSparePart] = useState(false);
  const [scanMode, setScanMode] = useState("entry");
  const [scanCode, setScanCode] = useState("");
  const [scanError, setScanError] = useState("");
  const [selectedScannedPart, setSelectedScannedPart] = useState(null);
  const [sparePartMovementForm, setSparePartMovementForm] = useState(
    EMPTY_SPARE_PART_MOVEMENT_FORM
  );
  const [savingSparePartMovement, setSavingSparePartMovement] = useState(false);
  const [selectedSparePartHistory, setSelectedSparePartHistory] =
    useState(null);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [cameraScannerTarget, setCameraScannerTarget] = useState("scan");
  const [cameraScannerError, setCameraScannerError] = useState("");
  const [cameraScannerStatus, setCameraScannerStatus] = useState("");
  const [cameraScannerEngine, setCameraScannerEngine] = useState("native");
  const cameraVideoRef = useRef(null);
  const cameraReaderRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const cameraAnimationRef = useRef(null);
  const html5ScannerRef = useRef(null);

  const [installationTemplates, setInstallationTemplates] = useState([]);
  const [loadingInstallationTemplates, setLoadingInstallationTemplates] =
    useState(true);
  const [installationTemplateSearchTerm, setInstallationTemplateSearchTerm] =
    useState("");
  const [installationTemplateLocationFilter, setInstallationTemplateLocationFilter] =
    useState("Todos");
  const [installationTemplateStatusFilter, setInstallationTemplateStatusFilter] =
    useState("active");
  const [showInstallationTemplateForm, setShowInstallationTemplateForm] =
    useState(false);
  const [installationTemplateForm, setInstallationTemplateForm] = useState(
    EMPTY_INSTALLATION_TEMPLATE_FORM
  );
  const [editingInstallationTemplateId, setEditingInstallationTemplateId] =
    useState(null);
  const [installationTemplateFormError, setInstallationTemplateFormError] =
    useState("");
  const [savingInstallationTemplate, setSavingInstallationTemplate] =
    useState(false);

  const [installationSubTab, setInstallationSubTab] = useState("templates");
  const [installations, setInstallations] = useState([]);
  const [loadingInstallations, setLoadingInstallations] = useState(true);
  const [installationSearchTerm, setInstallationSearchTerm] = useState("");
  const [installationStatusFilter, setInstallationStatusFilter] =
    useState("active");
  const [showInstallationForm, setShowInstallationForm] = useState(false);
  const [installationForm, setInstallationForm] = useState(EMPTY_INSTALLATION_FORM);
  const [installationFormError, setInstallationFormError] = useState("");
  const [savingInstallation, setSavingInstallation] = useState(false);
  const [selectedInstallation, setSelectedInstallation] = useState(null);
  const [installationAssetSearchTerm, setInstallationAssetSearchTerm] = useState("");
  const [installationAssetCampusFilter, setInstallationAssetCampusFilter] = useState("Todos");
  const [installationAssetCategoryFilter, setInstallationAssetCategoryFilter] = useState("Todas");

  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [campusFilter, setCampusFilter] = useState("Todos");
  const [areaFilter, setAreaFilter] = useState("Todas");
  const [conditionFilter, setConditionFilter] = useState("Todas");

  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM);
  const [assetFormError, setAssetFormError] = useState("");
  const [editingAssetId, setEditingAssetId] = useState(null);
  const [savingAsset, setSavingAsset] = useState(false);

  const [selectedHistoryAsset, setSelectedHistoryAsset] = useState(null);
  const [assetLogs, setAssetLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState("");

  const [selectedMovementAsset, setSelectedMovementAsset] = useState(null);
  const [movementForm, setMovementForm] = useState(EMPTY_MOVEMENT_FORM);
  const [movementError, setMovementError] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);

  const [selectedMaintenanceAsset, setSelectedMaintenanceAsset] = useState(null);
  const [maintenanceForm, setMaintenanceForm] = useState(EMPTY_MAINTENANCE_FORM);
  const [maintenanceFormError, setMaintenanceFormError] = useState("");
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  const [selectedCompletionMaintenance, setSelectedCompletionMaintenance] =
    useState(null);
  const [completionForm, setCompletionForm] = useState(EMPTY_COMPLETION_FORM);
  const [completionError, setCompletionError] = useState("");
  const [completingMaintenance, setCompletingMaintenance] = useState(false);

  const [pageError, setPageError] = useState("");
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [loadingMaintenances, setLoadingMaintenances] = useState(true);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [activeTab, setActiveTab] = useState("resumen");
  const [selectedQrAsset, setSelectedQrAsset] = useState(null);
  const [qrPrintMode, setQrPrintMode] = useState("single");
  const [selectedQuickAsset, setSelectedQuickAsset] = useState(null);
  const [selectedQuickLogs, setSelectedQuickLogs] = useState([]);
  const [loadingQuickLogs, setLoadingQuickLogs] = useState(false);
  const [qrAssetHandled, setQrAssetHandled] = useState(false);
  const [openedFromQr, setOpenedFromQr] = useState(() =>
    typeof window !== "undefined" ? Boolean(getAssetIdFromCurrentUrl()) : false
  );
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= 900 : false
  );
  const [fieldActionMode, setFieldActionMode] = useState(false);

  const [locationSearchTerm, setLocationSearchTerm] = useState("");
  const [locationCampusFilter, setLocationCampusFilter] = useState("Todos");
  const [locationTypeFilter, setLocationTypeFilter] = useState("Todos");
  const [locationStatusFilter, setLocationStatusFilter] = useState("Todos");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState(null);
  const [locationForm, setLocationForm] = useState(EMPTY_LOCATION_FORM);
  const [locationFormError, setLocationFormError] = useState("");
  const [savingLocation, setSavingLocation] = useState(false);

  const [showChecklistEditor, setShowChecklistEditor] = useState(false);
  const [checklistEditorItems, setChecklistEditorItems] = useState([]);
  const [checklistEditorError, setChecklistEditorError] = useState("");
  const [savingChecklist, setSavingChecklist] = useState(false);

  const [showLocationReviewForm, setShowLocationReviewForm] = useState(false);
  const [locationReviewItems, setLocationReviewItems] = useState([]);
  const [locationReviewForm, setLocationReviewForm] = useState(
    EMPTY_LOCATION_REVIEW_FORM
  );
  const [locationReviewError, setLocationReviewError] = useState("");
  const [savingLocationReview, setSavingLocationReview] = useState(false);
  const [locationReviews, setLocationReviews] = useState([]);
  const [loadingLocationReviews, setLoadingLocationReviews] = useState(false);
  const [locationReviewsError, setLocationReviewsError] = useState("");

  const isEditing = Boolean(editingAssetId);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    function handleResize() {
      setIsMobileViewport(window.innerWidth <= 900);
    }

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const shouldUseFieldShell = (openedFromQr || fieldActionMode) && isMobileViewport;

    document.body.classList.toggle(
      "technical-field-mode-active",
      shouldUseFieldShell
    );

    return () => {
      document.body.classList.remove("technical-field-mode-active");
    };
  }, [openedFromQr, fieldActionMode, isMobileViewport]);

  useEffect(() => {
    function cleanPrintModeClasses() {
      document.body.classList.remove(
        "technical-print-single-label",
        "technical-print-all-labels"
      );
    }

    window.addEventListener("afterprint", cleanPrintModeClasses);

    return () => {
      window.removeEventListener("afterprint", cleanPrintModeClasses);
      cleanPrintModeClasses();
    };
  }, []);

  useEffect(() => {
    if (qrAssetHandled || visibleAssets.length === 0) return;

    const assetId = getAssetIdFromCurrentUrl();

    if (!assetId) return;

    const assetFromQr = assets.find((asset) => asset.id === assetId);

    setQrAssetHandled(true);
    setOpenedFromQr(true);

    if (assetFromQr) {
      openQuickAssetPanel(assetFromQr);
      return;
    }

    setActiveTab("equipos");
    setPageError(
      "No se encontró el equipo del código QR. Revisa que el equipo todavía exista en el inventario."
    );
  }, [assets, qrAssetHandled]);

  useEffect(() => {
    if (!selectedQuickAsset?.id) {
      setSelectedQuickLogs([]);
      return;
    }

    let isMounted = true;

    async function loadQuickLogs() {
      try {
        setLoadingQuickLogs(true);
        const logs = await getTechnicalAssetLogs(selectedQuickAsset.id);

        if (isMounted) {
          setSelectedQuickLogs(logs.slice(0, 3));
        }
      } catch (error) {
        console.error("No se pudo cargar el historial rápido del equipo:", error);

        if (isMounted) {
          setSelectedQuickLogs([]);
        }
      } finally {
        if (isMounted) {
          setLoadingQuickLogs(false);
        }
      }
    }

    loadQuickLogs();

    return () => {
      isMounted = false;
    };
  }, [selectedQuickAsset]);

  async function loadInitialData() {
    await Promise.all([
      loadAssets(),
      loadMaintenances(),
      loadTechnicalLocations(),
      loadSpareParts(),
      loadInstallationTemplates(),
      loadInstallations(),
    ]);
  }

  async function loadInstallations() {
    try {
      setLoadingInstallations(true);
      setPageError("");

      const loadedInstallations = await getTechnicalInstallations();

      setInstallations(loadedInstallations);

      return loadedInstallations;
    } catch (error) {
      console.error("No se pudieron cargar las instalaciones:", error);
      setPageError(
        "No se pudieron cargar las instalaciones realizadas. Revisa las reglas de Firestore o la conexión."
      );

      return [];
    } finally {
      setLoadingInstallations(false);
    }
  }

  async function loadInstallationTemplates() {
    try {
      setLoadingInstallationTemplates(true);
      setPageError("");

      const loadedTemplates = await getTechnicalInstallationTemplates();

      setInstallationTemplates(loadedTemplates);

      return loadedTemplates;
    } catch (error) {
      console.error("No se pudieron cargar las plantillas de instalación:", error);
      setPageError(
        "No se pudieron cargar las plantillas de instalación. Revisa las reglas de Firestore o la conexión."
      );

      return [];
    } finally {
      setLoadingInstallationTemplates(false);
    }
  }

  async function loadSpareParts() {
    try {
      setLoadingSpareParts(true);
      setPageError("");

      const loadedSpareParts = await getTechnicalSpareParts();

      setSpareParts(loadedSpareParts);

      return loadedSpareParts;
    } catch (error) {
      console.error("No se pudo cargar el inventario de recambios:", error);
      setPageError(
        "No se pudo cargar el inventario de recambios. Revisa las reglas de Firestore o la conexión."
      );

      return [];
    } finally {
      setLoadingSpareParts(false);
    }
  }

  async function loadTechnicalLocations() {
    try {
      setLoadingLocations(true);
      setPageError("");

      const loadedLocations = await getTechnicalLocations();

      setTechnicalLocations(loadedLocations);

      if (!selectedLocationId && loadedLocations.length > 0) {
        setSelectedLocationId(loadedLocations[0].id);
      }

      return loadedLocations;
    } catch (error) {
      console.error("No se pudieron cargar las ubicaciones técnicas:", error);
      setPageError(
        "No se pudieron cargar las ubicaciones técnicas. Revisa las reglas de Firestore o la conexión."
      );

      return [];
    } finally {
      setLoadingLocations(false);
    }
  }

  async function loadAssets() {
    try {
      setLoadingAssets(true);
      setPageError("");

      const loadedAssets = await getTechnicalAssets();

      setAssets(loadedAssets);

      return loadedAssets;
    } catch (error) {
      console.error("No se pudo cargar el inventario técnico:", error);
      setPageError(
        "No se pudo cargar el inventario técnico. Revisa las reglas de Firestore o la conexión."
      );

      return [];
    } finally {
      setLoadingAssets(false);
    }
  }

  async function loadMaintenances() {
    try {
      setLoadingMaintenances(true);
      setPageError("");

      const loadedMaintenances = await getTechnicalMaintenances();

      setMaintenances(loadedMaintenances);

      return loadedMaintenances;
    } catch (error) {
      console.error("No se pudieron cargar los mantenimientos:", error);
      setPageError(
        "No se pudieron cargar los mantenimientos programados. Revisa las reglas de Firestore o la conexión."
      );

      return [];
    } finally {
      setLoadingMaintenances(false);
    }
  }

  const visibleAssets = useMemo(
    () => assets.filter((asset) => isActiveTechnicalAsset(asset)),
    [assets]
  );

  const inactiveTechnicalAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset?.deleted === true ||
          asset?.active === false ||
          asset?.status === "Eliminado" ||
          asset?.status === "Dado de baja"
      ),
    [assets]
  );

  const visibleAssetIds = useMemo(
    () => new Set(visibleAssets.map((asset) => asset.id)),
    [visibleAssets]
  );

  const filteredAssets = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return visibleAssets.filter((asset) => {
      const matchesSearch =
        !normalizedSearch ||
        String(asset.assetTag || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.name || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.category || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.brand || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.model || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.serialNumber || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.notes || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        normalizeCampusName(asset.campus)
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.campus || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.area || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.assignedTo || "")
          .toLowerCase()
          .includes(normalizedSearch) ||
        String(asset.technicalLocationName || "")
          .toLowerCase()
          .includes(normalizedSearch);

      const matchesCategory =
        categoryFilter === "Todas" || asset.category === categoryFilter;

      const matchesStatus =
        statusFilter === "Todos" || asset.status === statusFilter;

      const matchesCampus =
        campusFilter === "Todos" ||
        normalizeCampusName(asset.campus) === campusFilter;

      const matchesArea = areaFilter === "Todas" || asset.area === areaFilter;

      const matchesCondition =
        conditionFilter === "Todas" || asset.condition === conditionFilter;

      return (
        matchesSearch &&
        matchesCategory &&
        matchesStatus &&
        matchesCampus &&
        matchesArea &&
        matchesCondition
      );
    });
  }, [
    visibleAssets,
    searchTerm,
    categoryFilter,
    statusFilter,
    campusFilter,
    areaFilter,
    conditionFilter,
  ]);

  const visibleMaintenances = maintenances.filter((maintenance) =>
    isMaintenanceVisibleForActiveAssets(maintenance, visibleAssetIds)
  );

  const pendingMaintenances = visibleMaintenances.filter(
    (maintenance) =>
      maintenance.status !== "Realizado" && maintenance.status !== "Cancelado"
  );

  const completedMaintenances = visibleMaintenances.filter(
    (maintenance) => maintenance.status === "Realizado"
  );

  const overdueMaintenances = pendingMaintenances.filter((maintenance) =>
    isMaintenanceOverdue(maintenance.nextDate)
  );

  const todayMaintenances = pendingMaintenances.filter(
    (maintenance) => getMaintenanceUrgency(maintenance.nextDate).level === "today"
  );

  const weekMaintenances = pendingMaintenances.filter(
    (maintenance) => getMaintenanceUrgency(maintenance.nextDate).level === "soon"
  );

  const upcomingMaintenances = pendingMaintenances.filter((maintenance) => {
    const urgencyLevel = getMaintenanceUrgency(maintenance.nextDate).level;
    return urgencyLevel === "soon" || urgencyLevel === "future";
  });

  const calendarMaintenances = pendingMaintenances.slice(0, 3);

  const totalAssets = visibleAssets.length;
  const activeAssets = visibleAssets.filter((asset) => asset.status === "Activo").length;
  const maintenanceAssets = visibleAssets.filter(
    (asset) =>
      asset.status === "En mantenimiento" || asset.status === "En reparación"
  ).length;
  const inactiveAssets = inactiveTechnicalAssets.length;
  const assetsWithQr = visibleAssets.filter((asset) => Boolean(asset.id)).length;
  const campusFilterOptions = CAMPUS_FILTER_OPTIONS;
  const areaFilterOptions = getUniqueAssetValues(visibleAssets, "area");

  const activeSpareParts = useMemo(
    () =>
      spareParts.filter(
        (part) =>
          part?.deleted !== true &&
          part?.active !== false &&
          part?.status !== "inactive"
      ),
    [spareParts]
  );

  const inactiveSpareParts = useMemo(
    () =>
      spareParts.filter(
        (part) =>
          part?.deleted === true ||
          part?.active === false ||
          part?.status === "inactive"
      ),
    [spareParts]
  );

  const sparePartCategoryOptions = useMemo(
    () =>
      buildMergedOptionList(
        SPARE_PART_CATEGORY_OPTIONS,
        spareParts.map((part) => part.category)
      ),
    [spareParts]
  );

  const sparePartTypeOptions = useMemo(
    () =>
      buildMergedOptionList(
        SPARE_PART_TYPE_OPTIONS,
        spareParts.map((part) => part.partType)
      ),
    [spareParts]
  );

  const sparePartUnitOptions = useMemo(
    () =>
      buildMergedOptionList(
        SPARE_PART_UNIT_OPTIONS,
        spareParts.map((part) => part.unit)
      ),
    [spareParts]
  );

  const filteredSpareParts = useMemo(() => {
    const normalizedSearch = sparePartSearchTerm.trim().toLowerCase();

    return spareParts.filter((part) => {
      const isInactive =
        part?.deleted === true ||
        part?.active === false ||
        part?.status === "inactive";
      const quantity = Number(part.quantity || 0);
      const minQuantity = Number(part.minQuantity || 0);
      const isEmpty = quantity <= 0;
      const isLowStock = quantity > 0 && minQuantity > 0 && quantity <= minQuantity;

      const matchesSearch =
        !normalizedSearch ||
        String(part.name || "").toLowerCase().includes(normalizedSearch) ||
        String(part.barcode || "").toLowerCase().includes(normalizedSearch) ||
        String(part.internalCode || "").toLowerCase().includes(normalizedSearch) ||
        String(part.category || "").toLowerCase().includes(normalizedSearch) ||
        String(part.partType || "").toLowerCase().includes(normalizedSearch) ||
        String(part.brand || "").toLowerCase().includes(normalizedSearch) ||
        String(part.model || "").toLowerCase().includes(normalizedSearch) ||
        String(part.compatibleModels || "").toLowerCase().includes(normalizedSearch) ||
        (Array.isArray(part.compatibleModels) &&
          part.compatibleModels.join(" ").toLowerCase().includes(normalizedSearch)) ||
        String(part.storageLocation || "").toLowerCase().includes(normalizedSearch);

      const matchesCategory =
        sparePartCategoryFilter === "Todas" ||
        part.category === sparePartCategoryFilter;

      const matchesType =
        sparePartTypeFilter === "Todos" ||
        part.partType === sparePartTypeFilter;

      const matchesStock =
        sparePartStockFilter === "todos" ||
        (sparePartStockFilter === "active" && !isInactive) ||
        (sparePartStockFilter === "inactive" && isInactive) ||
        (sparePartStockFilter === "empty" && !isInactive && isEmpty) ||
        (sparePartStockFilter === "low" && !isInactive && isLowStock);

      return matchesSearch && matchesCategory && matchesType && matchesStock;
    });
  }, [
    spareParts,
    sparePartSearchTerm,
    sparePartCategoryFilter,
    sparePartTypeFilter,
    sparePartStockFilter,
  ]);

  const sparePartMetrics = useMemo(() => {
    const lowStock = activeSpareParts.filter((part) => {
      const quantity = Number(part.quantity || 0);
      const minQuantity = Number(part.minQuantity || 0);

      return quantity > 0 && minQuantity > 0 && quantity <= minQuantity;
    }).length;

    const emptyStock = activeSpareParts.filter(
      (part) => Number(part.quantity || 0) <= 0
    ).length;

    const withBarcode = activeSpareParts.filter(
      (part) => part.barcode || part.internalCode
    ).length;

    return {
      active: activeSpareParts.length,
      inactive: inactiveSpareParts.length,
      lowStock,
      emptyStock,
      withBarcode,
    };
  }, [activeSpareParts, inactiveSpareParts]);

  const selectedScannedPartMovements = selectedScannedPart
    ? sparePartMovements.filter(
        (movement) => movement.partId === selectedScannedPart.id
      )
    : [];

  const activeInstallationTemplates = useMemo(
    () =>
      installationTemplates.filter(
        (template) =>
          template?.deleted !== true &&
          template?.active !== false &&
          template?.status !== "inactive"
      ),
    [installationTemplates]
  );

  const inactiveInstallationTemplates = useMemo(
    () =>
      installationTemplates.filter(
        (template) =>
          template?.deleted === true ||
          template?.active === false ||
          template?.status === "inactive"
      ),
    [installationTemplates]
  );

  const installationTemplateLocationOptions = useMemo(
    () =>
      buildMergedOptionList(
        INSTALLATION_TEMPLATE_LOCATION_TYPES,
        installationTemplates.map((template) => template.targetLocationType)
      ),
    [installationTemplates]
  );

  const installationTemplateEquipmentCategoryOptions = useMemo(
    () =>
      buildMergedOptionList(
        INSTALLATION_TEMPLATE_EQUIPMENT_CATEGORIES,
        installationTemplates.map((template) => template.equipmentCategory)
      ),
    [installationTemplates]
  );

  const filteredInstallationTemplates = useMemo(() => {
    const normalizedSearch = installationTemplateSearchTerm.trim().toLowerCase();

    return installationTemplates.filter((template) => {
      const isInactive =
        template?.deleted === true ||
        template?.active === false ||
        template?.status === "inactive";

      const searchableText = [
        template.name,
        template.description,
        template.targetLocationType,
        template.equipmentCategory,
        ...(Array.isArray(template.physicalItems)
          ? template.physicalItems.map((item) => item.label)
          : []),
        ...(Array.isArray(template.softwareItems)
          ? template.softwareItems.map((item) => item.label)
          : []),
        ...(Array.isArray(template.configurationItems)
          ? template.configurationItems.map((item) => item.label)
          : []),
        ...(Array.isArray(template.testItems)
          ? template.testItems.map((item) => item.label)
          : []),
      ]
        .join(" ")
        .toLowerCase();

      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
      const matchesLocation =
        installationTemplateLocationFilter === "Todos" ||
        template.targetLocationType === installationTemplateLocationFilter;
      const matchesStatus =
        installationTemplateStatusFilter === "todos" ||
        (installationTemplateStatusFilter === "active" && !isInactive) ||
        (installationTemplateStatusFilter === "inactive" && isInactive);

      return matchesSearch && matchesLocation && matchesStatus;
    });
  }, [
    installationTemplates,
    installationTemplateSearchTerm,
    installationTemplateLocationFilter,
    installationTemplateStatusFilter,
  ]);

  const installationTemplateMetrics = useMemo(() => {
    const classroomTemplates = activeInstallationTemplates.filter((template) =>
      String(template.targetLocationType || "").toLowerCase().includes("sal")
    ).length;

    const totalSteps = activeInstallationTemplates.reduce(
      (total, template) => total + getInstallationTemplateTotalSteps(template),
      0
    );

    return {
      active: activeInstallationTemplates.length,
      inactive: inactiveInstallationTemplates.length,
      classroomTemplates,
      totalSteps,
    };
  }, [activeInstallationTemplates, inactiveInstallationTemplates]);

  const filteredInstallations = useMemo(() => {
    const normalizedSearch = installationSearchTerm.trim().toLowerCase();

    return installations.filter((installation) => {
      const status = installation.status || "in_progress";
      const isCompleted = status === "completed";
      const isCancelled = status === "cancelled";
      const isActive = !isCompleted && !isCancelled && installation.deleted !== true;

      const searchableText = [
        installation.title,
        installation.templateName,
        installation.campus,
        installation.locationName,
        installation.locationType,
        installation.responsibleName,
        installation.notes,
        ...(Array.isArray(installation.installedEquipment)
          ? installation.installedEquipment.flatMap((equipment) => [
              equipment.equipmentCode,
              equipment.equipmentName,
              equipment.category,
              equipment.brand,
              equipment.model,
            ])
          : []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
      const matchesStatus =
        installationStatusFilter === "todos" ||
        (installationStatusFilter === "active" && isActive) ||
        (installationStatusFilter === "completed" && isCompleted) ||
        (installationStatusFilter === "cancelled" && isCancelled);

      return matchesSearch && matchesStatus;
    });
  }, [installations, installationSearchTerm, installationStatusFilter]);

  const installationMetrics = useMemo(() => {
    const active = installations.filter(
      (installation) =>
        installation.deleted !== true &&
        !["completed", "cancelled"].includes(installation.status)
    ).length;
    const completed = installations.filter(
      (installation) => installation.status === "completed"
    ).length;
    const paused = installations.filter(
      (installation) => installation.status === "paused"
    ).length;
    const averageProgress = installations.length
      ? Math.round(
          installations.reduce(
            (total, installation) => total + Number(installation.progress || 0),
            0
          ) / installations.length
        )
      : 0;

    return {
      active,
      completed,
      paused,
      averageProgress,
    };
  }, [installations]);

  useEffect(() => {
    if (!cameraScannerOpen) {
      return undefined;
    }

    let cancelled = false;

    async function startNativeBarcodeDetector() {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
        audio: false,
      });

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      cameraStreamRef.current = stream;

      const video = cameraVideoRef.current;

      if (!video) {
        throw new Error("No se encontró el visor de cámara.");
      }

      video.srcObject = stream;
      video.setAttribute("playsInline", "true");
      await video.play();

      const allFormats = [
        "aztec",
        "code_128",
        "code_39",
        "code_93",
        "codabar",
        "data_matrix",
        "ean_13",
        "ean_8",
        "itf",
        "pdf417",
        "qr_code",
        "upc_a",
        "upc_e",
      ];

      const supportedFormats =
        typeof window.BarcodeDetector.getSupportedFormats === "function"
          ? await window.BarcodeDetector.getSupportedFormats()
          : allFormats;

      const formats = allFormats.filter((format) =>
        supportedFormats.includes(format)
      );

      const detector =
        formats.length > 0
          ? new window.BarcodeDetector({ formats })
          : new window.BarcodeDetector();

      setCameraScannerEngine("native");
      setCameraScannerStatus(
        "Apunta la cámara al código de barras. Se detectará automáticamente."
      );

      async function detectFrame() {
        if (cancelled || !cameraScannerOpen) return;

        try {
          if (video.readyState >= 2) {
            const codes = await detector.detect(video);

            if (codes.length > 0) {
              const detectedCode = String(codes[0]?.rawValue || "").trim();

              if (detectedCode) {
                handleCameraDetectedCode(detectedCode);
                return;
              }
            }
          }
        } catch (error) {
          console.error("No se pudo detectar el código con BarcodeDetector:", error);
        }

        cameraAnimationRef.current = window.requestAnimationFrame(detectFrame);
      }

      detectFrame();
    }

    async function startHtml5QrcodeScanner() {
      await loadHtml5QrcodeLibrary();

      if (cancelled) return;

      const readerElement = cameraReaderRef.current;

      if (!readerElement) {
        throw new Error("No se encontró el lector de cámara.");
      }

      readerElement.innerHTML = "";

      const scanner = new window.Html5Qrcode(readerElement.id, false);
      html5ScannerRef.current = scanner;
      setCameraScannerEngine("html5");
      setCameraScannerStatus(
        "Apunta la cámara al código. Si no lo toma al primer intento, acércalo o mejora la iluminación."
      );

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const boxSize = Math.floor(minEdge * 0.72);

            return { width: boxSize, height: Math.floor(boxSize * 0.55) };
          },
        },
        (decodedText) => {
          const detectedCode = String(decodedText || "").trim();

          if (detectedCode) {
            handleCameraDetectedCode(detectedCode);
          }
        },
        () => {
          // El lector emite errores mientras busca códigos; no se muestran para evitar ruido.
        }
      );
    }

    async function startCameraScanner() {
      try {
        if (!navigator?.mediaDevices?.getUserMedia) {
          setCameraScannerError(
            "No se pudo acceder a la cámara desde este navegador. Revisa permisos o usa un lector físico."
          );
          setCameraScannerStatus("");
          return;
        }

        setCameraScannerStatus("Abriendo cámara...");

        if (typeof window !== "undefined" && "BarcodeDetector" in window) {
          await startNativeBarcodeDetector();
          return;
        }

        await startHtml5QrcodeScanner();
      } catch (error) {
        console.error("No se pudo abrir el escáner de cámara:", error);
        setCameraScannerError(
          "No se pudo abrir el escáner con cámara. Revisa permisos del navegador, conexión a internet o usa un lector físico."
        );
        setCameraScannerStatus("");
        stopCameraScannerResources();
      }
    }

    startCameraScanner();

    return () => {
      cancelled = true;
      stopCameraScannerResources();
    };
  }, [cameraScannerOpen]);

  useEffect(() => {
    return () => {
      stopCameraScannerResources();
    };
  }, []);

  const filteredTechnicalLocations = useMemo(() => {
    const normalizedSearch = locationSearchTerm.trim().toLowerCase();

    return technicalLocations.filter((location) => {
      const matchesSearch =
        !normalizedSearch ||
        String(location.name || "").toLowerCase().includes(normalizedSearch) ||
        String(location.campus || "").toLowerCase().includes(normalizedSearch) ||
        String(location.area || "").toLowerCase().includes(normalizedSearch) ||
        String(location.type || "").toLowerCase().includes(normalizedSearch) ||
        String(location.notes || "").toLowerCase().includes(normalizedSearch);

      const matchesCampus =
        locationCampusFilter === "Todos" ||
        normalizeCampusName(location.campus) === locationCampusFilter;

      const matchesType =
        locationTypeFilter === "Todos" || location.type === locationTypeFilter;

      const matchesStatus =
        locationStatusFilter === "Todos" || location.status === locationStatusFilter;

      return matchesSearch && matchesCampus && matchesType && matchesStatus;
    });
  }, [
    technicalLocations,
    locationSearchTerm,
    locationCampusFilter,
    locationTypeFilter,
    locationStatusFilter,
  ]);

  const selectedTechnicalLocation =
    technicalLocations.find((location) => location.id === selectedLocationId) ||
    filteredTechnicalLocations[0] ||
    technicalLocations[0] ||
    null;

  useEffect(() => {
    if (!selectedTechnicalLocation?.id) {
      setLocationReviews([]);
      return;
    }

    let isMounted = true;

    async function loadSelectedLocationReviews() {
      try {
        setLoadingLocationReviews(true);
        setLocationReviewsError("");

        const reviews = await getTechnicalLocationReviews(
          selectedTechnicalLocation.id
        );

        if (isMounted) {
          setLocationReviews(reviews);
        }
      } catch (error) {
        console.error(
          "No se pudo cargar el historial de la ubicación técnica:",
          error
        );

        if (isMounted) {
          setLocationReviews([]);
          setLocationReviewsError(
            "No se pudo cargar el historial de revisiones de esta ubicación."
          );
        }
      } finally {
        if (isMounted) {
          setLoadingLocationReviews(false);
        }
      }
    }

    loadSelectedLocationReviews();

    return () => {
      isMounted = false;
    };
  }, [selectedTechnicalLocation?.id]);

  const selectedLocationAssets = selectedTechnicalLocation
    ? visibleAssets.filter((asset) =>
        isAssetAssignedToTechnicalLocation(asset, selectedTechnicalLocation)
      )
    : [];

  const selectedLocationMaintenances = selectedTechnicalLocation
    ? visibleMaintenances.filter((maintenance) =>
        isMaintenanceAssignedToTechnicalLocation(
          maintenance,
          selectedTechnicalLocation,
          selectedLocationAssets
        )
      )
    : [];

  const selectedLocationPendingMaintenances = selectedLocationMaintenances.filter(
    (maintenance) =>
      maintenance.status !== "Realizado" && maintenance.status !== "Cancelado"
  );

  const locationsNeedingAttention = technicalLocations.filter((location) =>
    ["Requiere atención", "Pendiente"].includes(location.status)
  ).length;

  const scheduledLocationReviews = technicalLocations
    .filter((location) => location.status !== "Inactivo")
    .map((location) => buildScheduledLocationReview(location))
    .sort((a, b) => String(a.nextDate).localeCompare(String(b.nextDate)));

  const pendingLocationReviews = scheduledLocationReviews.filter((review) => {
    const urgencyLevel = getMaintenanceUrgency(review.nextDate).level;
    return urgencyLevel === "overdue" || urgencyLevel === "today" || urgencyLevel === "soon";
  });

  const overdueLocationReviews = scheduledLocationReviews.filter(
    (review) => getMaintenanceUrgency(review.nextDate).level === "overdue"
  );

  const weekLocationReviews = scheduledLocationReviews.filter((review) => {
    const urgencyLevel = getMaintenanceUrgency(review.nextDate).level;
    return urgencyLevel === "today" || urgencyLevel === "soon";
  });

  const technicalLocationTypesInUse = getUniqueLocationValues(
    technicalLocations,
    "type"
  );

  const recentMaintenances = pendingMaintenances.slice(0, 3);
  const recentAssets = visibleAssets.slice(0, 5);
  const selectedQuickPendingMaintenances = selectedQuickAsset
    ? getPendingMaintenancesForAsset(selectedQuickAsset)
    : [];
  const selectedQuickNextMaintenance =
    selectedQuickPendingMaintenances.length > 0
      ? selectedQuickPendingMaintenances[0]
      : null;
  const fieldModeRequested = openedFromQr && isMobileViewport;
  const fieldActionModeActive = fieldActionMode && isMobileViewport;
  const focusedSubActionActive = Boolean(
    selectedQrAsset ||
      selectedMaintenanceAsset ||
      selectedCompletionMaintenance ||
      selectedMovementAsset ||
      selectedHistoryAsset ||
      showAssetForm ||
      showLocationReviewForm
  );
  const focusedSupportViewActive = Boolean(
    selectedQuickAsset || focusedSubActionActive
  );
  const fieldModeActive = fieldModeRequested && Boolean(selectedQuickAsset);
  const generatedAssetTag = isEditing
    ? assetForm.assetTag || getNextAssetTag(assetForm.category)
    : getNextAssetTag(assetForm.category);
  const generatedAssetName = generateAssetName(assetForm);

  useEffect(() => {
    if (!selectedMaintenanceAsset?.id) return;
    if ((maintenanceForm.checklistTemplate || []).length > 0) return;

    setMaintenanceForm((current) => ({
      ...current,
      checklistTemplate: getDefaultMaintenanceChecklistForAsset(
        selectedMaintenanceAsset,
        current.title || getSuggestedMaintenanceTitle(selectedMaintenanceAsset)
      ),
    }));
  }, [selectedMaintenanceAsset?.id, maintenanceForm.checklistTemplate?.length]);

  useEffect(() => {
    if (!selectedCompletionMaintenance?.id) return;

    const currentChecklist = normalizeCompletionChecklistList(completionForm.checklist || []);
    if (currentChecklist.length > 0) return;

    const relatedAsset =
      selectedQuickAsset ||
      assets.find((asset) => asset.id === selectedCompletionMaintenance.assetId) ||
      null;

    const rebuiltChecklist = buildChecklistForCompletion(
      selectedCompletionMaintenance,
      relatedAsset
    );

    setCompletionForm((current) => ({
      ...current,
      checklist: rebuiltChecklist.length > 0 ? rebuiltChecklist : getFallbackMaintenanceChecklist(),
    }));
  }, [
    selectedCompletionMaintenance?.id,
    completionForm.checklist?.length,
    selectedQuickAsset?.id,
    assets.length,
  ]);

  function getCurrentUserProfile() {
    return {
      ...profile,
      uid: profile?.uid || profile?.id || "",
    };
  }

  function getNextAssetTag(category, currentAssets = assets) {
    const prefix = CATEGORY_PREFIXES[category] || "OTR";

    const usedNumbers = currentAssets
      .filter((asset) =>
        String(asset.assetTag || "").startsWith(`AES-${prefix}-`)
      )
      .map((asset) => {
        const numberPart = String(asset.assetTag || "").replace(
          `AES-${prefix}-`,
          ""
        );

        return Number(numberPart);
      })
      .filter((number) => !Number.isNaN(number));

    const highestNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) : 0;
    const nextNumber = highestNumber + 1;

    return `AES-${prefix}-${String(nextNumber).padStart(4, "0")}`;
  }

  function restoreFieldModePanel() {
    if (!fieldActionMode || !isMobileViewport || !selectedQuickAsset?.id) {
      return false;
    }

    setFieldActionMode(false);
    setOpenedFromQr(true);
    setQrAssetHandled(true);
    setActiveTab("equipos");
    scrollToTop();

    return true;
  }

  function closeAllTopPanels(options = {}) {
    const shouldKeepQuickAsset =
      options.keepQuickAsset ?? (fieldActionMode && isMobileViewport);
    const shouldReturnToField = options.returnToField ?? false;

    closeAssetForm();
    closeHistoryPanel({ returnToField: shouldReturnToField });
    closeMovementForm({ returnToField: shouldReturnToField });
    closeMaintenanceForm({ returnToField: shouldReturnToField });
    closeCompletionForm({ returnToField: shouldReturnToField });
    closeQrPanel({ returnToField: shouldReturnToField });

    if (!shouldKeepQuickAsset) {
      closeQuickAssetPanel();
    }
  }

  function formatAssetLocationText(value = "") {
    return String(value)
      .trim()
      .replace(/\s+/g, " ")
      .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
  }

  function generateAssetName(form = assetForm) {
    const category = form.category || "Equipo";
    const location =
      formatAssetLocationText(form.assignedTo) || formatAssetLocationText(form.area);

    return location ? `${category} ${location}` : category;
  }

  function handleTechnicalTabChange(tabId) {
    if (tabId === "registrar-equipo") {
      openCreateForm();
      return;
    }

    closeAssetForm();

    if (tabId === "ubicaciones-tecnicas" && !selectedLocationId && technicalLocations.length > 0) {
      setSelectedLocationId(technicalLocations[0].id);
    }

    setActiveTab(tabId);
  }

  function handleGlobalSearchChange(event) {
    const value = event.target.value;

    setSearchTerm(value);

    if (value.trim()) {
      setActiveTab("equipos");
    }
  }

  function getResolvedCampus(form = assetForm) {
    if (form.campus === "Otro") {
      return form.campusOther?.trim() || "";
    }

    return form.campus?.trim() || "";
  }

  function getAssetQrValue(asset) {
    if (!asset?.id) return window.location.origin;

    const qrUrl = new URL(window.location.href);

    qrUrl.searchParams.set("page", "technical-support");
    qrUrl.searchParams.set("assetId", asset.id);

    return qrUrl.toString();
  }

  function handleAssetCardKeyDown(event, asset) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openQuickAssetPanel(asset);
    }
  }

  function stopCardClick(event) {
    event.stopPropagation();
  }

  function getPendingMaintenancesForAsset(asset) {
    if (!asset?.id) return [];

    return pendingMaintenances
      .filter((maintenance) => maintenance.assetId === asset.id)
      .sort((first, second) => {
        const firstDate = new Date(`${first.nextDate || "2999-12-31"}T00:00:00`);
        const secondDate = new Date(`${second.nextDate || "2999-12-31"}T00:00:00`);

        return firstDate.getTime() - secondDate.getTime();
      });
  }

  function openQuickAssetPanel(asset) {
    if (!asset?.id) return;

    setFieldActionMode(false);
    closeAssetForm();
    closeHistoryPanel({ returnToField: false });
    closeMovementForm({ returnToField: false });
    closeMaintenanceForm({ returnToField: false });
    closeCompletionForm({ returnToField: false });
    closeQrPanel({ returnToField: false });

    setSelectedQuickAsset(asset);
    setActiveTab("equipos");
    scrollToTop();
  }

  function closeQuickAssetPanel() {
    setSelectedQuickAsset(null);
    setSelectedQuickLogs([]);
  }

  function exitFieldModeForAction() {
    setOpenedFromQr(false);
    setQrAssetHandled(true);
    setFieldActionMode(true);
  }

  function startQuickMaintenance(asset) {
    const nextMaintenance = getPendingMaintenancesForAsset(asset)[0];

    exitFieldModeForAction();

    if (nextMaintenance) {
      openCompletionForm(nextMaintenance, { keepQuickAsset: true, asset });
      setActiveTab("field-action");
      return;
    }

    setPageError(
      "Este equipo no tiene mantenimientos pendientes. Puedes programar uno nuevo para iniciar la revisión."
    );
    openMaintenanceForm(asset, { keepQuickAsset: true });
    setActiveTab("field-action");
  }

  function openQuickMovementAction(asset) {
    exitFieldModeForAction();
    openMovementForm(asset, false, { keepQuickAsset: true });
    setActiveTab("field-action");
  }

  function openQuickHistoryAction(asset) {
    exitFieldModeForAction();
    openHistoryPanel(asset, { keepQuickAsset: true });
    setActiveTab("field-action");
  }

  function openQuickQrAction(asset) {
    exitFieldModeForAction();
    openQrLabelPanel(asset, { keepQuickAsset: true });
    setActiveTab("field-action");
  }


  function openQrLabelPanel(asset, options = {}) {
    closeAllTopPanels({
      keepQuickAsset: options.keepQuickAsset,
      returnToField: false,
    });
    setActiveTab("equipos");
    setSelectedQrAsset(asset);
    scrollToTop();
  }

  function closeQrPanel(options = {}) {
    setSelectedQrAsset(null);

    if (options.returnToField !== false) {
      restoreFieldModePanel();
    }
  }

  function printQrLabel() {
    prepareQrPrint("single");
  }

  function printAllQrLabels() {
    if (visibleAssets.length === 0) {
      setPageError("No hay equipos registrados para imprimir etiquetas.");
      return;
    }

    prepareQrPrint("all");
  }

  function prepareQrPrint(mode) {
    const printClass =
      mode === "all"
        ? "technical-print-all-labels"
        : "technical-print-single-label";

    setQrPrintMode(mode);
    document.body.classList.remove(
      "technical-print-single-label",
      "technical-print-all-labels"
    );
    document.body.classList.add(printClass);

    window.setTimeout(() => {
      window.print();
    }, 80);
  }

  function renderQrLabel(asset) {
    if (!asset) return null;

    return (
      <article className="technical-qr-label">
        <div className="technical-qr-label-header">
          <strong>Active English School</strong>
          <span>Soporte Técnico</span>
        </div>

        <div className="technical-qr-main">
          <div className="technical-qr-code">
            <QRCodeSVG
              value={getAssetQrValue(asset)}
              size={142}
              level="H"
              includeMargin
            />
          </div>

          <div className="technical-qr-info">
            <span className="asset-tag">{asset.assetTag || "Sin código"}</span>
            <h3>{asset.name || "Equipo sin nombre"}</h3>
            <p>
              {normalizeCampusName(asset.campus)} · {asset.area || "Sin área"}
            </p>
            <p>{asset.assignedTo || "Sin ubicación específica"}</p>
          </div>
        </div>

        <div className="technical-qr-footer">
          <span>Escanea para ver ficha, historial y mantenimientos.</span>
        </div>
      </article>
    );
  }

  function openCreateForm() {
    const initialCategory = "Computadora";

    closeAllTopPanels();
    setActiveTab("registrar-equipo");

    setEditingAssetId(null);
    const defaultAssetChecklist = getDefaultMaintenanceChecklistForAsset(
      { category: initialCategory },
      getSuggestedMaintenanceTitle({ category: initialCategory })
    );

    setAssetForm({
      ...EMPTY_ASSET_FORM,
      category: initialCategory,
      assetTag: getNextAssetTag(initialCategory),
      maintenanceChecklistTemplate: defaultAssetChecklist,
    });

    setAssetFormError("");
    setShowAssetForm(true);
    scrollToTop();
  }

  function openEditForm(asset) {
    closeAllTopPanels();
    setActiveTab("registrar-equipo");

    setEditingAssetId(asset.id);

    const existingCampus = normalizeCampusName(asset.campus || "");
    const isKnownCampus = CAMPUS_FILTER_OPTIONS.includes(existingCampus);

    setAssetForm({
      assetTag: asset.assetTag || "",
      name: asset.name || "",
      category: asset.category || "Computadora",
      brand: asset.brand || "",
      model: asset.model || "",
      serialNumber: asset.serialNumber || "",
      campus: isKnownCampus ? existingCampus : "Otro",
      campusOther: isKnownCampus ? "" : existingCampus,
      area: asset.area || "",
      assignedTo: asset.assignedTo || "",
      technicalLocationId: asset.technicalLocationId || "",
      technicalLocationName: asset.technicalLocationName || "",
      technicalLocationType: asset.technicalLocationType || "",
      status: asset.status || "Activo",
      condition: asset.condition || "Bueno",
      notes: asset.notes || "",
      maintenanceChecklistTemplate:
        normalizeMaintenanceTemplate(asset.maintenanceChecklistTemplate || asset.checklistTemplate || asset.checklistBase).length > 0
          ? normalizeMaintenanceTemplate(asset.maintenanceChecklistTemplate || asset.checklistTemplate || asset.checklistBase)
          : getDefaultMaintenanceChecklistForAsset(asset, getSuggestedMaintenanceTitle(asset)),
    });

    setAssetFormError("");
    setShowAssetForm(true);
    scrollToTop();
  }

  function closeAssetForm() {
    if (savingAsset) return;

    setShowAssetForm(false);
    setAssetForm(EMPTY_ASSET_FORM);
    setAssetFormError("");
    setEditingAssetId(null);

    if (activeTab === "registrar-equipo") {
      setActiveTab("equipos");
    }
  }

  function handleAssetFormChange(event) {
    const { name, value } = event.target;

    if (name === "category") {
      setAssetForm((current) => {
        const nextAsset = { ...current, category: value };

        return {
          ...nextAsset,
          maintenanceChecklistTemplate: getDefaultMaintenanceChecklistForAsset(
            nextAsset,
            getSuggestedMaintenanceTitle(nextAsset)
          ),
        };
      });

      return;
    }

    if (name === "campus") {
      setAssetForm((current) => ({
        ...current,
        campus: value,
        campusOther: value === "Otro" ? current.campusOther : "",
      }));

      return;
    }

    if (name === "technicalLocationId") {
      const location = technicalLocations.find((item) => item.id === value);

      setAssetForm((current) => ({
        ...current,
        technicalLocationId: location?.id || "",
        technicalLocationName: location?.name || "",
        technicalLocationType: location?.type || "",
        campus: location
          ? CAMPUS_FILTER_OPTIONS.includes(normalizeCampusName(location.campus))
            ? normalizeCampusName(location.campus)
            : "Otro"
          : current.campus,
        campusOther: location
          ? CAMPUS_FILTER_OPTIONS.includes(normalizeCampusName(location.campus))
            ? ""
            : normalizeCampusName(location.campus)
          : current.campusOther,
        area: location?.area || current.area,
        assignedTo: location?.name || current.assignedTo,
      }));

      return;
    }

    setAssetForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function normalizeMaintenanceTemplate(checklist) {
    if (!Array.isArray(checklist)) return [];

    return checklist
      .map((item) => {
        if (typeof item === "string") {
          return { label: item.trim(), checked: false, note: "" };
        }

        return {
          label: String(item?.label || item?.title || item?.name || "").trim(),
          checked: Boolean(item?.checked),
          note: String(item?.note || item?.notes || "").trim(),
        };
      })
      .filter((item) => item.label);
  }

  function updateAssetChecklistItem(index, field, value) {
    setAssetForm((current) => ({
      ...current,
      maintenanceChecklistTemplate: (current.maintenanceChecklistTemplate || []).map(
        (item, itemIndex) =>
          itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  }

  function addAssetChecklistItem() {
    setAssetForm((current) => ({
      ...current,
      maintenanceChecklistTemplate: [
        ...(current.maintenanceChecklistTemplate || []),
        { label: "Nuevo punto de revisión", checked: false, note: "" },
      ],
    }));
  }

  function removeAssetChecklistItem(index) {
    setAssetForm((current) => ({
      ...current,
      maintenanceChecklistTemplate: (current.maintenanceChecklistTemplate || []).filter(
        (_, itemIndex) => itemIndex !== index
      ),
    }));
  }

  function moveAssetChecklistItem(index, targetIndex) {
    setAssetForm((current) => ({
      ...current,
      maintenanceChecklistTemplate: moveItemInList(
        current.maintenanceChecklistTemplate || [],
        index,
        targetIndex
      ),
    }));
  }

  function reloadAssetDefaultChecklist() {
    setAssetForm((current) => ({
      ...current,
      maintenanceChecklistTemplate: getDefaultMaintenanceChecklistForAsset(
        current,
        getSuggestedMaintenanceTitle(current)
      ),
    }));
  }

  async function handleDeleteAsset(asset) {
    if (!asset?.id) return;

    const confirmed = window.confirm(
      `¿Eliminar el equipo "${asset.name || asset.assetTag || "seleccionado"}"? Esta acción quitará el equipo del inventario.`
    );

    if (!confirmed) return;

    try {
      setPageError("");
      await deleteTechnicalAsset(asset.id, getCurrentUserProfile());

      if (selectedQuickAsset?.id === asset.id) {
        closeQuickAssetPanel();
      }

      await Promise.all([loadAssets(), loadMaintenances()]);
    } catch (error) {
      console.error("No se pudo eliminar el equipo:", error);
      setPageError(
        "No se pudo eliminar el equipo. Revisa tus permisos o intenta de nuevo."
      );
    }
  }

  async function handleRestoreAsset(asset) {
    if (!asset?.id) return;

    const confirmed = window.confirm(
      `¿Restaurar el equipo "${asset.name || asset.assetTag || "seleccionado"}" al inventario activo?`
    );

    if (!confirmed) return;

    try {
      setPageError("");
      await restoreTechnicalAsset(asset.id, getCurrentUserProfile());
      await Promise.all([loadAssets(), loadMaintenances()]);
    } catch (error) {
      console.error("No se pudo restaurar el equipo:", error);
      setPageError(
        "No se pudo restaurar el equipo. Revisa tus permisos o intenta de nuevo."
      );
    }
  }

  async function handleAssetSubmit(event) {
    event.preventDefault();

    const cleanedAsset = {
      ...assetForm,
      assetTag: generatedAssetTag.trim(),
      name: generatedAssetName.trim(),
      brand: assetForm.brand.trim(),
      model: assetForm.model.trim(),
      serialNumber: assetForm.serialNumber.trim(),
      campus: getResolvedCampus(assetForm),
      area: assetForm.area.trim(),
      assignedTo: assetForm.assignedTo.trim(),
      technicalLocationId: assetForm.technicalLocationId || "",
      technicalLocationName: assetForm.technicalLocationName || "",
      technicalLocationType: assetForm.technicalLocationType || "",
      notes: assetForm.notes.trim(),
      maintenanceChecklistTemplate: normalizeMaintenanceTemplate(assetForm.maintenanceChecklistTemplate),
    };

    if (!cleanedAsset.category) {
      setAssetFormError("Selecciona la categoría del equipo.");
      return;
    }

    if (!cleanedAsset.campus) {
      setAssetFormError("Agrega el plantel donde se encuentra el equipo.");
      return;
    }

    if (!cleanedAsset.area) {
      setAssetFormError("Selecciona el área o ubicación general del equipo.");
      return;
    }

    if (!cleanedAsset.assignedTo) {
      setAssetFormError("Agrega la ubicación específica del equipo.");
      return;
    }

    const assetTagAlreadyExists = assets.some(
      (asset) =>
        asset.id !== editingAssetId &&
        String(asset.assetTag || "").toLowerCase() ===
          cleanedAsset.assetTag.toLowerCase()
    );

    if (assetTagAlreadyExists) {
      setAssetFormError("Ya existe un equipo registrado con ese código interno.");
      return;
    }

    try {
      setSavingAsset(true);
      setAssetFormError("");
      setPageError("");

      if (isEditing) {
        await updateTechnicalAsset(
          editingAssetId,
          cleanedAsset,
          getCurrentUserProfile()
        );
      } else {
        const createdAsset = await createTechnicalAsset(
          cleanedAsset,
          getCurrentUserProfile()
        );

        await createDefaultMaintenancesForAsset(
          createdAsset,
          getCurrentUserProfile()
        );
      }

      setSearchTerm("");
      setCategoryFilter("Todas");
      setStatusFilter("Todos");
      setCampusFilter("Todos");
      setAreaFilter("Todas");
      setConditionFilter("Todas");
      closeAssetForm();
      setActiveTab("equipos");

      await Promise.all([loadAssets(), loadMaintenances()]);
    } catch (error) {
      console.error("No se pudo guardar el equipo:", error);
      setAssetFormError(
        isEditing
          ? "No se pudieron guardar los cambios del equipo. Revisa tus permisos o intenta de nuevo."
          : "No se pudo guardar el equipo ni programar sus mantenimientos automáticos. Revisa tus permisos o intenta de nuevo."
      );
    } finally {
      setSavingAsset(false);
    }
  }

  async function openHistoryPanel(asset, options = {}) {
    closeAllTopPanels({
      keepQuickAsset: options.keepQuickAsset,
      returnToField: false,
    });

    try {
      setSelectedHistoryAsset(asset);
      setAssetLogs([]);
      setLogsError("");
      setLoadingLogs(true);

      const logs = await getTechnicalAssetLogs(asset.id);

      setAssetLogs(logs);
      scrollToTop();
    } catch (error) {
      console.error("No se pudo cargar el historial del equipo:", error);
      setLogsError(
        "No se pudo cargar el historial del equipo. Revisa si Firestore necesita crear un índice."
      );
    } finally {
      setLoadingLogs(false);
    }
  }

  async function refreshHistory(assetId) {
    if (!assetId) return;

    try {
      setLoadingLogs(true);
      setLogsError("");

      const logs = await getTechnicalAssetLogs(assetId);

      setAssetLogs(logs);
    } catch (error) {
      console.error("No se pudo actualizar el historial:", error);
      setLogsError("No se pudo actualizar el historial del equipo.");
    } finally {
      setLoadingLogs(false);
    }
  }

  function closeHistoryPanel(options = {}) {
    setSelectedHistoryAsset(null);
    setAssetLogs([]);
    setLogsError("");
    setLoadingLogs(false);

    if (options.returnToField !== false) {
      restoreFieldModePanel();
    }
  }

  function openMovementForm(asset, keepHistoryOpen = false, options = {}) {
    if (!keepHistoryOpen) {
      closeAllTopPanels({
        keepQuickAsset: options.keepQuickAsset,
        returnToField: false,
      });
    } else {
      closeAssetForm();
      closeMaintenanceForm({ returnToField: false });
      closeCompletionForm({ returnToField: false });
    }

    setSelectedMovementAsset(asset);
    setMovementForm({
      ...EMPTY_MOVEMENT_FORM,
      title: "Mantenimiento preventivo",
    });

    setMovementError("");
    scrollToTop();
  }

  function closeMovementForm(options = {}) {
    if (savingMovement) return;

    setSelectedMovementAsset(null);
    setMovementForm(EMPTY_MOVEMENT_FORM);
    setMovementError("");

    if (options.returnToField !== false) {
      restoreFieldModePanel();
    }
  }

  function handleMovementChange(event) {
    const { name, value } = event.target;

    setMovementForm((current) => {
      if (name === "type") {
        return {
          ...current,
          type: value,
          title:
            !current.title || current.title === current.type
              ? value
              : current.title,
        };
      }

      return {
        ...current,
        [name]: value,
      };
    });
  }

  async function handleMovementSubmit(event) {
    event.preventDefault();

    if (!selectedMovementAsset?.id) {
      setMovementError("No se seleccionó ningún equipo.");
      return;
    }

    const cleanedMovement = {
      type: movementForm.type,
      title: movementForm.title?.trim() || movementForm.type || "Movimiento técnico",
      description: movementForm.description.trim(),
      status: movementForm.status,
      condition: movementForm.condition,
    };

    try {
      setSavingMovement(true);
      setMovementError("");
      setPageError("");

      const movementAssetId = selectedMovementAsset.id;

      await createTechnicalAssetMovement(
        selectedMovementAsset,
        cleanedMovement,
        getCurrentUserProfile()
      );

      closeMovementForm();

      const loadedAssets = await loadAssets();
      const updatedAsset = loadedAssets.find((asset) => asset.id === movementAssetId);

      if (selectedHistoryAsset?.id === movementAssetId) {
        if (updatedAsset) {
          setSelectedHistoryAsset(updatedAsset);
        }

        await refreshHistory(movementAssetId);
      }
    } catch (error) {
      console.error("No se pudo registrar el movimiento:", error);
      setMovementError(
        "No se pudo registrar el movimiento. Revisa tus permisos o intenta de nuevo."
      );
    } finally {
      setSavingMovement(false);
    }
  }

  function openMaintenanceForm(asset, options = {}) {
    closeAllTopPanels({
      keepQuickAsset: options.keepQuickAsset,
      returnToField: false,
    });

    const defaultTitle = getSuggestedMaintenanceTitle(asset);
    const savedAssetChecklist = normalizeMaintenanceTemplate(
      asset?.maintenanceChecklistTemplate || asset?.checklistTemplate || asset?.checklistBase
    );
    const defaultChecklist =
      savedAssetChecklist.length > 0
        ? savedAssetChecklist
        : getDefaultMaintenanceChecklistForAsset(asset, defaultTitle);

    setSelectedMaintenanceAsset(asset);
    setMaintenanceForm({
      ...EMPTY_MAINTENANCE_FORM,
      title: defaultTitle,
      assignedTo: "Soporte Técnico",
      frequency: getSuggestedMaintenanceFrequency(asset),
      nextDate: getSuggestedMaintenanceNextDate(asset),
      description: getSuggestedMaintenanceDescription(asset),
      checklistTemplate: defaultChecklist,
    });
    setMaintenanceFormError("");
    scrollToTop();
  }

  function closeMaintenanceForm(options = {}) {
    if (savingMaintenance) return;

    setSelectedMaintenanceAsset(null);
    setMaintenanceForm(EMPTY_MAINTENANCE_FORM);
    setMaintenanceFormError("");

    if (options.returnToField !== false) {
      restoreFieldModePanel();
    }
  }



  function moveItemInList(items, fromIndex, toIndex) {
    if (!Array.isArray(items)) return [];
    if (fromIndex === toIndex) return items;
    if (fromIndex < 0 || fromIndex >= items.length) return items;
    if (toIndex < 0 || toIndex >= items.length) return items;

    const updatedItems = [...items];
    const [movedItem] = updatedItems.splice(fromIndex, 1);
    updatedItems.splice(toIndex, 0, movedItem);
    return updatedItems;
  }

  function handleMaintenanceChange(event) {
    const { name, value } = event.target;

    setMaintenanceForm((current) => ({
      ...current,
      [name]: value,
    }));
  }



  function handleMaintenanceChecklistItemChange(index, field, value) {
    setMaintenanceForm((current) => ({
      ...current,
      checklistTemplate: (current.checklistTemplate || []).map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }));
  }

  function addMaintenanceChecklistItem() {
    setMaintenanceForm((current) => ({
      ...current,
      checklistTemplate: [
        ...(current.checklistTemplate || []),
        { label: "", checked: false, note: "" },
      ],
    }));
  }


  function resetMaintenanceChecklistToDefault() {
    if (!selectedMaintenanceAsset) return;

    setMaintenanceForm((current) => ({
      ...current,
      checklistTemplate: getDefaultMaintenanceChecklistForAsset(
        selectedMaintenanceAsset,
        current.title || getSuggestedMaintenanceTitle(selectedMaintenanceAsset)
      ),
    }));
  }

  function removeMaintenanceChecklistItem(index) {
    setMaintenanceForm((current) => ({
      ...current,
      checklistTemplate: (current.checklistTemplate || []).filter(
        (_, itemIndex) => itemIndex !== index
      ),
    }));
  }

  function moveMaintenanceChecklistItem(index, targetIndex) {
    setMaintenanceForm((current) => ({
      ...current,
      checklistTemplate: moveItemInList(
        current.checklistTemplate || [],
        index,
        targetIndex
      ),
    }));
  }

  async function handleMaintenanceSubmit(event) {
    event.preventDefault();

    if (!selectedMaintenanceAsset?.id) {
      setMaintenanceFormError("No se seleccionó ningún equipo.");
      return;
    }

    const cleanedChecklistTemplate = (maintenanceForm.checklistTemplate || [])
      .map((item) => ({
        label: String(
          item?.label || item?.title || item?.name || item?.text || ""
        ).trim(),
        checked: Boolean(item?.checked),
        note: String(item?.note || item?.notes || item?.observation || "").trim(),
      }))
      .filter((item) => item.label);

    const cleanedMaintenance = {
      ...maintenanceForm,
      title: maintenanceForm.title.trim(),
      description: maintenanceForm.description.trim(),
      assignedTo: maintenanceForm.assignedTo.trim() || "Soporte Técnico",
      checklistTemplate: cleanedChecklistTemplate,
      checklistBase: cleanedChecklistTemplate,
      maintenanceChecklistTemplate: cleanedChecklistTemplate,
      maintenanceChecklist: cleanedChecklistTemplate,
      baseChecklist: cleanedChecklistTemplate,
      templateChecklist: cleanedChecklistTemplate,
      checklistItems: cleanedChecklistTemplate,
      checklist: cleanedChecklistTemplate,
    };

    if (!cleanedMaintenance.title) {
      setMaintenanceFormError("Agrega el título del mantenimiento.");
      return;
    }

    if (!cleanedMaintenance.nextDate) {
      setMaintenanceFormError("Selecciona la fecha del próximo mantenimiento.");
      return;
    }

    if (cleanedMaintenance.checklistTemplate.length === 0) {
      setMaintenanceFormError("Agrega al menos un punto al checklist del mantenimiento.");
      return;
    }

    try {
      setSavingMaintenance(true);
      setMaintenanceFormError("");
      setPageError("");

      await createTechnicalMaintenance(
        selectedMaintenanceAsset,
        cleanedMaintenance,
        getCurrentUserProfile()
      );

      closeMaintenanceForm();
      await loadMaintenances();
    } catch (error) {
      console.error("No se pudo programar el mantenimiento:", error);
      setMaintenanceFormError(
        "No se pudo programar el mantenimiento. Revisa tus permisos o intenta de nuevo."
      );
    } finally {
      setSavingMaintenance(false);
    }
  }

  function openCompletionForm(maintenance, options = {}) {
    closeAssetForm();
    closeMovementForm({ returnToField: false });
    closeMaintenanceForm({ returnToField: false });

    const latestMaintenance =
      maintenances.find((item) => item.id === maintenance?.id) || maintenance || {};

    const relatedAsset =
      options.asset ||
      selectedQuickAsset ||
      assets.find((asset) => asset.id === latestMaintenance?.assetId) ||
      assets.find((asset) => asset.id === maintenance?.assetId) ||
      null;

    const enrichedMaintenance = {
      ...latestMaintenance,
      assetCategory:
        latestMaintenance?.assetCategory ||
        relatedAsset?.category ||
        "Otro",
      assetName:
        latestMaintenance?.assetName ||
        relatedAsset?.name ||
        "",
      assetTag:
        latestMaintenance?.assetTag ||
        relatedAsset?.assetTag ||
        "",
      campus:
        latestMaintenance?.campus ||
        relatedAsset?.campus ||
        "",
      area:
        latestMaintenance?.area ||
        relatedAsset?.area ||
        "",
      assetAssignedTo:
        latestMaintenance?.assetAssignedTo ||
        relatedAsset?.assignedTo ||
        "",
      technicalLocationName:
        latestMaintenance?.technicalLocationName ||
        relatedAsset?.technicalLocationName ||
        "",
      technicalLocationType:
        latestMaintenance?.technicalLocationType ||
        relatedAsset?.technicalLocationType ||
        "",
    };

    const checklist = buildChecklistForCompletion(enrichedMaintenance, relatedAsset);

    setSelectedCompletionMaintenance(enrichedMaintenance);
    setCompletionForm({
      title: enrichedMaintenance.title || "Mantenimiento realizado",
      description:
        enrichedMaintenance.description || "Se realizó el mantenimiento programado.",
      status: "",
      condition: "",
      checklist: checklist.length > 0 ? checklist : getFallbackMaintenanceChecklist(),
    });
    setCompletionError("");
    scrollToTop();
  }

  
function closeCompletionForm(options = {}) {
    if (completingMaintenance) return;

    setSelectedCompletionMaintenance(null);
    setCompletionForm(EMPTY_COMPLETION_FORM);
    setCompletionError("");

    if (options.returnToField !== false) {
      restoreFieldModePanel();
    }
  }

  function handleCompletionChange(event) {
    const { name, value } = event.target;

    setCompletionForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleCompletionChecklistChange(index) {
    setCompletionForm((current) => ({
      ...current,
      checklist: current.checklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, checked: !item.checked } : item
      ),
    }));
  }

  function handleCompletionChecklistNoteChange(index, value) {
    setCompletionForm((current) => ({
      ...current,
      checklist: current.checklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, note: value } : item
      ),
    }));
  }


  function handleCompletionChecklistLabelChange(index, value) {
    setCompletionForm((current) => ({
      ...current,
      checklist: current.checklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, label: value } : item
      ),
    }));
  }

  function addCompletionChecklistItem() {
    setCompletionForm((current) => ({
      ...current,
      checklist: [
        ...current.checklist,
        { label: "", checked: false, note: "" },
      ],
    }));
  }

  function removeCompletionChecklistItem(index) {
    setCompletionForm((current) => ({
      ...current,
      checklist: current.checklist.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function moveCompletionChecklistItem(index, targetIndex) {
    setCompletionForm((current) => ({
      ...current,
      checklist: moveItemInList(current.checklist, index, targetIndex),
    }));
  }

  async function handleCompletionSubmit(event) {
    event.preventDefault();

    if (!selectedCompletionMaintenance?.id) {
      setCompletionError("No se seleccionó ningún mantenimiento.");
      return;
    }

    const cleanedCompletionChecklist = completionForm.checklist
      .map((item) => ({
        label: String(item.label || "").trim(),
        checked: Boolean(item.checked),
        note: String(item.note || "").trim(),
      }))
      .filter((item) => item.label);

    const cleanedCompletion = {
      title: completionForm.title.trim(),
      description: completionForm.description.trim(),
      status: completionForm.status,
      condition: completionForm.condition,
      checklist: cleanedCompletionChecklist,
    };

    if (!cleanedCompletion.title) {
      setCompletionError("Agrega un título para el cierre del mantenimiento.");
      return;
    }

    if (cleanedCompletion.checklist.length === 0) {
      setCompletionError("Agrega al menos un punto al checklist del mantenimiento.");
      return;
    }

    try {
      setCompletingMaintenance(true);
      setCompletionError("");
      setPageError("");

      const completedAssetId = selectedCompletionMaintenance.assetId;

      await completeTechnicalMaintenance(
        selectedCompletionMaintenance,
        cleanedCompletion,
        getCurrentUserProfile()
      );

      closeCompletionForm();

      await Promise.all([loadAssets(), loadMaintenances()]);

      if (selectedHistoryAsset?.id === completedAssetId) {
        await refreshHistory(completedAssetId);
      }
    } catch (error) {
      console.error("No se pudo marcar el mantenimiento como realizado:", error);
      setCompletionError(
        "No se pudo marcar el mantenimiento como realizado. Revisa tus permisos o intenta de nuevo."
      );
    } finally {
      setCompletingMaintenance(false);
    }
  }



  function openLocationForm(location = null) {
    closeAssetForm();
    closeHistoryPanel({ returnToField: false });
    closeMovementForm({ returnToField: false });
    closeMaintenanceForm({ returnToField: false });
    closeCompletionForm({ returnToField: false });
    closeQrPanel({ returnToField: false });
    closeQuickAssetPanel();

    if (location?.id) {
      const existingCampus = normalizeCampusName(location.campus || "");
      const isKnownCampus = CAMPUS_FILTER_OPTIONS.includes(existingCampus);

      setEditingLocationId(location.id);
      setLocationForm({
        name: location.name || "",
        campus: isKnownCampus ? existingCampus : "Otro",
        campusOther: isKnownCampus ? "" : existingCampus,
        area: location.area || "",
        type: location.type || "Cabina",
        status: location.status || "Correcto",
        notes: location.notes || "",
      });
    } else {
      setEditingLocationId(null);
      setLocationForm(EMPTY_LOCATION_FORM);
    }

    setLocationFormError("");
    setShowLocationForm(true);
    setActiveTab("ubicaciones-tecnicas");
    scrollToTop();
  }

  function closeLocationForm() {
    if (savingLocation) return;

    setShowLocationForm(false);
    setEditingLocationId(null);
    setLocationForm(EMPTY_LOCATION_FORM);
    setLocationFormError("");
  }

  function handleLocationFormChange(event) {
    const { name, value } = event.target;

    if (name === "campus") {
      setLocationForm((current) => ({
        ...current,
        campus: value,
        campusOther: value === "Otro" ? current.campusOther : "",
      }));
      return;
    }

    setLocationForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function getResolvedLocationCampus(form = locationForm) {
    if (form.campus === "Otro") {
      return form.campusOther?.trim() || "";
    }

    return form.campus?.trim() || "";
  }

  async function handleLocationSubmit(event) {
    event.preventDefault();

    const currentEditingLocation = editingLocationId
      ? technicalLocations.find((location) => location.id === editingLocationId)
      : null;
    const currentChecklistTemplate =
      currentEditingLocation?.type === locationForm.type
        ? getLocationChecklistTemplate(currentEditingLocation)
        : getDefaultTechnicalLocationChecklist(locationForm.type);

    const cleanedLocation = {
      name: locationForm.name.trim(),
      campus: getResolvedLocationCampus(locationForm),
      area: locationForm.area.trim(),
      type: locationForm.type || "Otro",
      status: locationForm.status || "Correcto",
      notes: locationForm.notes.trim(),
      checklistTemplate: currentChecklistTemplate,
    };

    if (!cleanedLocation.name) {
      setLocationFormError("Agrega el nombre de la ubicación técnica.");
      return;
    }

    if (!cleanedLocation.campus) {
      setLocationFormError("Selecciona el plantel de la ubicación técnica.");
      return;
    }

    if (!cleanedLocation.area) {
      setLocationFormError("Agrega el área relacionada con esta ubicación.");
      return;
    }

    try {
      setSavingLocation(true);
      setLocationFormError("");
      setPageError("");

      let savedLocation;

      if (editingLocationId) {
        savedLocation = await updateTechnicalLocation(
          editingLocationId,
          cleanedLocation,
          getCurrentUserProfile()
        );
      } else {
        savedLocation = await createTechnicalLocation(
          cleanedLocation,
          getCurrentUserProfile()
        );
      }

      closeLocationForm();
      const loadedLocations = await loadTechnicalLocations();
      setSelectedLocationId(savedLocation?.id || loadedLocations[0]?.id || "");
    } catch (error) {
      console.error("No se pudo guardar la ubicación técnica:", error);
      setLocationFormError(
        "No se pudo guardar la ubicación técnica. Revisa tus permisos o intenta de nuevo."
      );
    } finally {
      setSavingLocation(false);
    }
  }

  function assignLocationToAssetForm(location) {
    if (!location?.id) return;

    setAssetForm((current) => ({
      ...current,
      technicalLocationId: location.id,
      technicalLocationName: location.name || "",
      technicalLocationType: location.type || "",
      campus: CAMPUS_FILTER_OPTIONS.includes(normalizeCampusName(location.campus))
        ? normalizeCampusName(location.campus)
        : "Otro",
      campusOther: CAMPUS_FILTER_OPTIONS.includes(normalizeCampusName(location.campus))
        ? ""
        : normalizeCampusName(location.campus),
      area: location.area || current.area,
      assignedTo: location.name || current.assignedTo,
    }));
  }

  function registerAssetForLocation(location) {
    openCreateForm();
    window.setTimeout(() => {
      assignLocationToAssetForm(location);
    }, 0);
  }

  function openMaintenanceFromLocation(asset) {
    setActiveTab("ubicaciones-tecnicas");
    openMaintenanceForm(asset);
  }

  function getLocationChecklistTemplate(location = selectedTechnicalLocation) {
    if (
      Array.isArray(location?.checklistTemplate) &&
      location.checklistTemplate.length > 0
    ) {
      return location.checklistTemplate;
    }

    return getDefaultTechnicalLocationChecklist(location?.type || "Otro");
  }

  function closeChecklistEditor() {
    setShowChecklistEditor(false);
    setChecklistEditorItems([]);
    setChecklistEditorError("");
  }

  function openChecklistEditor(location = selectedTechnicalLocation) {
    if (!location?.id) return;

    setShowLocationReviewForm(false);
    setLocationReviewError("");
    setChecklistEditorError("");
    setChecklistEditorItems(
      getLocationChecklistTemplate(location).map((item) => ({
        label: item.label || "",
        required: item.required !== false,
      }))
    );
    setShowChecklistEditor(true);
  }

  function handleChecklistEditorItemChange(index, field, value) {
    setChecklistEditorItems((currentItems) =>
      currentItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  }

  function addChecklistEditorItem() {
    setChecklistEditorItems((currentItems) => [
      ...currentItems,
      {
        label: "",
        required: true,
      },
    ]);
  }

  function removeChecklistEditorItem(index) {
    setChecklistEditorItems((currentItems) =>
      currentItems.filter((_, itemIndex) => itemIndex !== index)
    );
  }


  function moveChecklistEditorItem(index, targetIndex) {
    setChecklistEditorItems((currentItems) =>
      moveItemInList(currentItems, index, targetIndex)
    );
  }

  async function handleSaveChecklistTemplate(event) {
    event.preventDefault();

    if (!selectedTechnicalLocation?.id) {
      setChecklistEditorError("Selecciona una ubicación técnica.");
      return;
    }

    const cleanedChecklist = checklistEditorItems
      .map((item) => ({
        label: String(item.label || "").trim(),
        required: item.required !== false,
      }))
      .filter((item) => item.label);

    if (cleanedChecklist.length === 0) {
      setChecklistEditorError("Agrega al menos un elemento al checklist.");
      return;
    }

    try {
      setSavingChecklist(true);
      setChecklistEditorError("");
      setPageError("");

      await updateTechnicalLocationChecklist(
        selectedTechnicalLocation.id,
        cleanedChecklist,
        getCurrentUserProfile()
      );

      const loadedLocations = await loadTechnicalLocations();
      const updatedLocation = loadedLocations.find(
        (location) => location.id === selectedTechnicalLocation.id
      );

      setSelectedLocationId(updatedLocation?.id || selectedTechnicalLocation.id);
      closeChecklistEditor();
    } catch (error) {
      console.error("No se pudo guardar el checklist técnico:", error);
      setChecklistEditorError(
        "No se pudo guardar el checklist. Revisa tus permisos o intenta de nuevo."
      );
    } finally {
      setSavingChecklist(false);
    }
  }

  function closeLocationReviewForm() {
    setShowLocationReviewForm(false);
    setLocationReviewItems([]);
    setLocationReviewForm(EMPTY_LOCATION_REVIEW_FORM);
    setLocationReviewError("");
  }

  function openLocationReviewForm(location = selectedTechnicalLocation) {
    if (!location?.id) return;

    setShowChecklistEditor(false);
    setChecklistEditorError("");
    setLocationReviewError("");
    setLocationReviewForm(EMPTY_LOCATION_REVIEW_FORM);
    setLocationReviewItems(
      getLocationChecklistTemplate(location).map((item) => ({
        label: item.label || "",
        required: item.required !== false,
        present: true,
        status: "Correcto",
        note: "",
      }))
    );
    setShowLocationReviewForm(true);
  }


  function startLocationReviewFromSchedule(location) {
    if (!location?.id) return;

    setSelectedLocationId(location.id);
    setActiveTab("ubicaciones-tecnicas");
    openLocationReviewForm(location);
    scrollToTop();
  }

  function handleLocationReviewItemChange(index, field, value) {
    setLocationReviewItems((currentItems) =>
      currentItems.map((item, itemIndex) => {
        if (itemIndex !== index) return item;

        const updatedItem = { ...item, [field]: value };

        if (field === "present" && value === false) {
          updatedItem.status = "Falta";
        }

        if (field === "present" && value === true && item.status === "Falta") {
          updatedItem.status = "Correcto";
        }

        return updatedItem;
      })
    );
  }

  function handleLocationReviewFormChange(event) {
    const { name, value } = event.target;

    setLocationReviewForm((currentForm) => ({
      ...currentForm,
      [name]: value,
    }));
  }

  function inferLocationReviewGeneralStatus(items) {
    if (
      items.some(
        (item) =>
          item.present === false ||
          item.status === "Falta" ||
          item.status === "No funciona"
      )
    ) {
      return "Requiere atención";
    }

    if (items.some((item) => item.status === "Requiere atención")) {
      return "Requiere atención";
    }

    return "Correcto";
  }

  async function handleSaveLocationReview(event) {
    event.preventDefault();

    if (!selectedTechnicalLocation?.id) {
      setLocationReviewError("Selecciona una ubicación técnica.");
      return;
    }

    const cleanedItems = locationReviewItems
      .map((item) => ({
        label: String(item.label || "").trim(),
        required: item.required !== false,
        present: Boolean(item.present),
        status: item.present === false ? "Falta" : item.status || "Correcto",
        note: String(item.note || "").trim(),
      }))
      .filter((item) => item.label);

    if (cleanedItems.length === 0) {
      setLocationReviewError("No hay elementos para revisar.");
      return;
    }

    const inferredStatus = inferLocationReviewGeneralStatus(cleanedItems);
    const finalGeneralStatus =
      locationReviewForm.generalStatus === "Correcto" &&
      inferredStatus === "Requiere atención"
        ? inferredStatus
        : locationReviewForm.generalStatus;

    try {
      setSavingLocationReview(true);
      setLocationReviewError("");
      setPageError("");

      await createTechnicalLocationReview(
        selectedTechnicalLocation,
        {
          ...locationReviewForm,
          generalStatus: finalGeneralStatus,
          checklist: cleanedItems,
        },
        getCurrentUserProfile()
      );

      const [loadedLocations, loadedReviews] = await Promise.all([
        loadTechnicalLocations(),
        getTechnicalLocationReviews(selectedTechnicalLocation.id),
      ]);

      setLocationReviews(loadedReviews);
      setSelectedLocationId(
        loadedLocations.find((location) => location.id === selectedTechnicalLocation.id)
          ?.id || selectedTechnicalLocation.id
      );
      closeLocationReviewForm();
    } catch (error) {
      console.error("No se pudo guardar la revisión técnica:", error);
      setLocationReviewError(
        "No se pudo guardar la revisión. Revisa tus permisos o intenta de nuevo."
      );
    } finally {
      setSavingLocationReview(false);
    }
  }

  function getSuggestedSparePartInternalCode() {
    return generateTechnicalSparePartInternalCodeFromParts(spareParts);
  }

  function openSparePartForm(part = null) {
    if (part) {
      const categoryFields = getEditableOptionFields(
        part.category,
        SPARE_PART_CATEGORY_OPTIONS
      );
      const typeFields = getEditableOptionFields(
        part.partType,
        SPARE_PART_TYPE_OPTIONS
      );
      const unitFields = getEditableOptionFields(
        part.unit,
        SPARE_PART_UNIT_OPTIONS
      );

      setSparePartForm({
        name: part.name || "",
        barcode: part.barcode || "",
        internalCode: part.internalCode || getSuggestedSparePartInternalCode(),
        category: categoryFields.value,
        categoryOther: categoryFields.other,
        partType: typeFields.value,
        partTypeOther: typeFields.other,
        brand: part.brand || "",
        model: part.model || "",
        compatibleModels: Array.isArray(part.compatibleModels)
          ? part.compatibleModels.join("\n")
          : String(part.compatibleModels || ""),
        quantity: Number(part.quantity || 0),
        minQuantity: Number(part.minQuantity || 0),
        unit: unitFields.value,
        unitOther: unitFields.other,
        storageLocation: part.storageLocation || "",
        status: part.status || "active",
        notes: part.notes || "",
      });
      setEditingSparePartId(part.id);
    } else {
      setSparePartForm({
        ...EMPTY_SPARE_PART_FORM,
        internalCode: getSuggestedSparePartInternalCode(),
      });
      setEditingSparePartId(null);
    }

    setSparePartFormError("");
    setShowSparePartForm(true);
    setActiveTab("recambios");
  }

  function closeSparePartForm() {
    setShowSparePartForm(false);
    setEditingSparePartId(null);
    setSparePartForm(EMPTY_SPARE_PART_FORM);
    setSparePartFormError("");
  }

  function handleSparePartFormChange(event) {
    const { name, value } = event.target;

    setSparePartForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSparePartSubmit(event) {
    event.preventDefault();

    try {
      setSavingSparePart(true);
      setSparePartFormError("");
      setPageError("");

      if (editingSparePartId) {
        await updateTechnicalSparePart(
          editingSparePartId,
          sparePartForm,
          getCurrentUserProfile()
        );
      } else {
        await createTechnicalSparePart(sparePartForm, getCurrentUserProfile());
      }

      await loadSpareParts();
      closeSparePartForm();
    } catch (error) {
      console.error("No se pudo guardar el recambio:", error);
      setSparePartFormError(
        error?.message ||
          "No se pudo guardar el recambio. Revisa la información o intenta de nuevo."
      );
    } finally {
      setSavingSparePart(false);
    }
  }

  async function handleDeactivateSparePart(part) {
    if (!part?.id) return;

    const confirmed = window.confirm(
      `¿Quieres desactivar el recambio "${part.name || "sin nombre"}"?`
    );

    if (!confirmed) return;

    try {
      setPageError("");
      await deactivateTechnicalSparePart(part.id, getCurrentUserProfile());
      await loadSpareParts();
    } catch (error) {
      console.error("No se pudo desactivar el recambio:", error);
      setPageError("No se pudo desactivar el recambio. Revisa tus permisos.");
    }
  }

  async function handleRestoreSparePart(part) {
    if (!part?.id) return;

    try {
      setPageError("");
      await restoreTechnicalSparePart(part.id, getCurrentUserProfile());
      await loadSpareParts();
    } catch (error) {
      console.error("No se pudo reactivar el recambio:", error);
      setPageError("No se pudo reactivar el recambio. Revisa tus permisos.");
    }
  }

  function getSparePartByScanCode(code) {
    const normalizedCode = String(code || "").trim().toLowerCase();

    if (!normalizedCode) return null;

    return spareParts.find((part) => {
      const candidateCodes = [
        part.barcode,
        part.internalCode,
        part.id,
      ].map((value) => String(value || "").trim().toLowerCase());

      return candidateCodes.includes(normalizedCode);
    });
  }

  function processSparePartScanCode(code) {
    const cleanedCode = String(code || "").trim();
    const foundPart = getSparePartByScanCode(cleanedCode);

    setScanCode(cleanedCode);

    if (!foundPart) {
      setSelectedScannedPart(null);
      setScanError(
        "No se encontró un recambio con ese código. Puedes registrarlo primero o revisar el código escaneado."
      );
      return;
    }

    if (foundPart.active === false || foundPart.status === "inactive") {
      setSelectedScannedPart(foundPart);
      setScanError(
        "Este recambio está inactivo. Reactívalo antes de registrar entradas o salidas."
      );
      return;
    }

    setSelectedScannedPart(foundPart);
    setSparePartMovementForm({
      ...EMPTY_SPARE_PART_MOVEMENT_FORM,
      finalQuantity: Number(foundPart.quantity || 0),
    });
    setScanError("");
    loadSparePartMovements(foundPart);
  }

  function handleScanSubmit(event) {
    event.preventDefault();
    processSparePartScanCode(scanCode);
  }

  function clearScannedPart() {
    setSelectedScannedPart(null);
    setScanCode("");
    setScanError("");
    setSparePartMovementForm(EMPTY_SPARE_PART_MOVEMENT_FORM);
  }

  function stopCameraScannerResources() {
    if (cameraAnimationRef.current) {
      window.cancelAnimationFrame(cameraAnimationRef.current);
      cameraAnimationRef.current = null;
    }

    if (html5ScannerRef.current) {
      const scanner = html5ScannerRef.current;
      html5ScannerRef.current = null;

      Promise.resolve(scanner.stop?.())
        .catch(() => {})
        .finally(() => {
          try {
            scanner.clear?.();
          } catch (error) {
            console.error("No se pudo limpiar el lector de códigos:", error);
          }
        });
    }

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }

    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }

    if (cameraReaderRef.current) {
      cameraReaderRef.current.innerHTML = "";
    }
  }

  function openCameraScanner(target = "scan") {
    setCameraScannerTarget(target);
    setCameraScannerEngine("native");
    setCameraScannerError("");
    setCameraScannerStatus("Preparando cámara...");
    setCameraScannerOpen(true);
  }

  function closeCameraScanner() {
    stopCameraScannerResources();
    setCameraScannerOpen(false);
    setCameraScannerStatus("");
    setCameraScannerError("");
  }

  function handleCameraDetectedCode(code) {
    const cleanedCode = String(code || "").trim();

    if (!cleanedCode) return;

    closeCameraScanner();

    if (cameraScannerTarget === "formBarcode") {
      setSparePartForm((current) => ({
        ...current,
        barcode: cleanedCode,
      }));
      return;
    }

    processSparePartScanCode(cleanedCode);
  }

  function handleSparePartMovementFormChange(event) {
    const { name, value } = event.target;

    setSparePartMovementForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSparePartMovementSubmit(event) {
    event.preventDefault();

    if (!selectedScannedPart?.id) {
      setScanError("Primero escanea o escribe el código del recambio.");
      return;
    }

    try {
      setSavingSparePartMovement(true);
      setScanError("");
      setPageError("");

      await createTechnicalSparePartMovement(
        selectedScannedPart,
        {
          type: scanMode,
          quantity: sparePartMovementForm.quantity,
          finalQuantity: sparePartMovementForm.finalQuantity,
          reason: sparePartMovementForm.reason,
          notes: sparePartMovementForm.notes,
          scannedCode: scanCode,
        },
        getCurrentUserProfile()
      );

      const loadedSpareParts = await loadSpareParts();
      const refreshedPart =
        loadedSpareParts.find((part) => part.id === selectedScannedPart.id) ||
        selectedScannedPart;

      setSelectedScannedPart(refreshedPart);
      setSparePartMovementForm({
        ...EMPTY_SPARE_PART_MOVEMENT_FORM,
        finalQuantity: Number(refreshedPart.quantity || 0),
      });
      await loadSparePartMovements(refreshedPart);
    } catch (error) {
      console.error("No se pudo registrar el movimiento del recambio:", error);
      setScanError(
        error?.message ||
          "No se pudo registrar el movimiento. Revisa la cantidad o intenta de nuevo."
      );
    } finally {
      setSavingSparePartMovement(false);
    }
  }

  async function loadSparePartMovements(part = selectedSparePartHistory || selectedScannedPart) {
    if (!part?.id) {
      setSparePartMovements([]);
      return [];
    }

    try {
      setLoadingSparePartMovements(true);

      const movements = await getTechnicalSparePartMovements(part.id);

      setSparePartMovements((current) => {
        const otherMovements = current.filter(
          (movement) => movement.partId !== part.id
        );

        return [...movements, ...otherMovements];
      });

      return movements;
    } catch (error) {
      console.error("No se pudo cargar el historial del recambio:", error);
      setScanError("No se pudo cargar el historial de movimientos.");
      return [];
    } finally {
      setLoadingSparePartMovements(false);
    }
  }

  async function openSparePartHistory(part) {
    setSelectedSparePartHistory(part);
    setActiveTab("recambios");
    await loadSparePartMovements(part);
  }

  function closeSparePartHistory() {
    setSelectedSparePartHistory(null);
  }

  function cloneInstallationTemplateForm(template = EMPTY_INSTALLATION_TEMPLATE_FORM) {
    return {
      name: template.name || "",
      description: template.description || "",
      targetLocationType: template.targetLocationType || "Salón",
      targetLocationTypeOther: template.targetLocationTypeOther || "",
      equipmentCategory: template.equipmentCategory || "Computadora",
      equipmentCategoryOther: template.equipmentCategoryOther || "",
      active: template.active !== false && template.status !== "inactive",
      physicalItems: normalizeInstallationTemplateItems(template.physicalItems),
      softwareItems: normalizeInstallationTemplateItems(template.softwareItems),
      configurationItems: normalizeInstallationTemplateItems(template.configurationItems),
      testItems: normalizeInstallationTemplateItems(template.testItems),
    };
  }

  function normalizeInstallationTemplateItems(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item, index) => ({
        id: item?.id || `item-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        label: String(item?.label || "").trim(),
        required: item?.required !== false,
      }))
      .filter((item) => item.label);
  }

  function createInstallationTemplateItem(sectionKey) {
    return {
      id: `${sectionKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: "",
      required: true,
    };
  }

  function getInstallationTemplateTotalSteps(template) {
    return INSTALLATION_TEMPLATE_SECTIONS.reduce(
      (total, section) => total + (Array.isArray(template?.[section.key]) ? template[section.key].length : 0),
      0
    );
  }

  function getInstallationTemplateRequiredSteps(template) {
    return INSTALLATION_TEMPLATE_SECTIONS.reduce((total, section) => {
      const items = Array.isArray(template?.[section.key]) ? template[section.key] : [];
      return total + items.filter((item) => item.required !== false).length;
    }, 0);
  }

  function openInstallationTemplateForm(template = null) {
    if (template) {
      setInstallationTemplateForm(cloneInstallationTemplateForm(template));
      setEditingInstallationTemplateId(template.id);
    } else {
      setInstallationTemplateForm(cloneInstallationTemplateForm(EMPTY_INSTALLATION_TEMPLATE_FORM));
      setEditingInstallationTemplateId(null);
    }

    setInstallationTemplateFormError("");
    setShowInstallationTemplateForm(true);
    setActiveTab("instalaciones");
    scrollToTop();
  }

  function closeInstallationTemplateForm() {
    setShowInstallationTemplateForm(false);
    setEditingInstallationTemplateId(null);
    setInstallationTemplateForm(cloneInstallationTemplateForm(EMPTY_INSTALLATION_TEMPLATE_FORM));
    setInstallationTemplateFormError("");
  }

  function loadSampleInstallationTemplate() {
    setInstallationTemplateForm(cloneInstallationTemplateForm(INSTALLATION_TEMPLATE_SAMPLE));
    setInstallationTemplateFormError("");
  }

  function handleInstallationTemplateFormChange(event) {
    const { name, value, type, checked } = event.target;

    setInstallationTemplateForm((current) => {
      const nextValue = type === "checkbox" ? checked : value;
      const nextForm = {
        ...current,
        [name]: nextValue,
      };

      if (name === "targetLocationType" && value !== "Otro") {
        nextForm.targetLocationTypeOther = "";
      }

      if (name === "equipmentCategory" && value !== "Otro") {
        nextForm.equipmentCategoryOther = "";
      }

      return nextForm;
    });
  }

  function addInstallationTemplateItem(sectionKey) {
    setInstallationTemplateForm((current) => ({
      ...current,
      [sectionKey]: [
        ...(Array.isArray(current[sectionKey]) ? current[sectionKey] : []),
        createInstallationTemplateItem(sectionKey),
      ],
    }));
  }

  function updateInstallationTemplateItem(sectionKey, itemIndex, fieldName, value) {
    setInstallationTemplateForm((current) => ({
      ...current,
      [sectionKey]: (Array.isArray(current[sectionKey]) ? current[sectionKey] : []).map(
        (item, index) =>
          index === itemIndex
            ? {
                ...item,
                [fieldName]: value,
              }
            : item
      ),
    }));
  }

  function removeInstallationTemplateItem(sectionKey, itemIndex) {
    setInstallationTemplateForm((current) => ({
      ...current,
      [sectionKey]: (Array.isArray(current[sectionKey]) ? current[sectionKey] : []).filter(
        (_, index) => index !== itemIndex
      ),
    }));
  }

  async function handleInstallationTemplateSubmit(event) {
    event.preventDefault();

    try {
      setSavingInstallationTemplate(true);
      setInstallationTemplateFormError("");

      if (editingInstallationTemplateId) {
        await updateTechnicalInstallationTemplate(
          editingInstallationTemplateId,
          installationTemplateForm,
          getCurrentUserProfile()
        );
      } else {
        await createTechnicalInstallationTemplate(
          installationTemplateForm,
          getCurrentUserProfile()
        );
      }

      await loadInstallationTemplates();
      closeInstallationTemplateForm();
    } catch (error) {
      console.error("No se pudo guardar la plantilla de instalación:", error);
      setInstallationTemplateFormError(
        error?.message || "No se pudo guardar la plantilla de instalación."
      );
    } finally {
      setSavingInstallationTemplate(false);
    }
  }

  async function handleDeactivateInstallationTemplate(template) {
    if (!template?.id) return;

    const confirmed = window.confirm(
      `¿Quieres desactivar la plantilla "${template.name || "sin nombre"}"? Podrás reactivarla después.`
    );

    if (!confirmed) return;

    try {
      await deactivateTechnicalInstallationTemplate(
        template.id,
        getCurrentUserProfile()
      );
      await loadInstallationTemplates();
    } catch (error) {
      console.error("No se pudo desactivar la plantilla:", error);
      setPageError("No se pudo desactivar la plantilla de instalación.");
    }
  }

  async function handleRestoreInstallationTemplate(template) {
    if (!template?.id) return;

    try {
      await restoreTechnicalInstallationTemplate(
        template.id,
        getCurrentUserProfile()
      );
      await loadInstallationTemplates();
    } catch (error) {
      console.error("No se pudo reactivar la plantilla:", error);
      setPageError("No se pudo reactivar la plantilla de instalación.");
    }
  }

  function getInstallationStatusLabel(status = "in_progress") {
    return (
      INSTALLATION_STATUS_OPTIONS.find((option) => option.value === status)?.label ||
      "En proceso"
    );
  }

  function getInstallationStatusClass(status = "in_progress") {
    if (status === "completed") return "completed";
    if (status === "cancelled") return "cancelled";
    if (status === "paused") return "paused";
    if (status === "draft") return "draft";
    return "progress";
  }

  function getInstallationChecklistSections(source = {}) {
    return INSTALLATION_TEMPLATE_SECTIONS.reduce((result, section) => {
      const items = Array.isArray(source?.[section.key]) ? source[section.key] : [];

      result[section.key] = items
        .map((item, index) => ({
          id:
            item?.id ||
            `${section.key}-${Date.now()}-${index}-${Math.random()
              .toString(36)
              .slice(2, 7)}`,
          templateItemId: item?.templateItemId || item?.id || "",
          sectionKey: item?.sectionKey || section.key,
          label: String(item?.label || "").trim(),
          required: item?.required !== false,
          completed: item?.completed === true,
          notes: String(item?.notes || ""),
          completedAt: item?.completedAt || "",
          completedBy: item?.completedBy || "",
        }))
        .filter((item) => item.label);

      return result;
    }, {});
  }

  function buildInstallationChecklistFromTemplate(template) {
    return INSTALLATION_TEMPLATE_SECTIONS.reduce((result, section) => {
      const items = Array.isArray(template?.[section.key]) ? template[section.key] : [];

      result[section.key] = items
        .map((item, index) => ({
          id:
            item?.id ||
            `${section.key}-${Date.now()}-${index}-${Math.random()
              .toString(36)
              .slice(2, 7)}`,
          templateItemId: item?.id || "",
          sectionKey: section.key,
          label: String(item?.label || "").trim(),
          required: item?.required !== false,
          completed: false,
          notes: "",
          completedAt: "",
          completedBy: "",
        }))
        .filter((item) => item.label);

      return result;
    }, {});
  }

  function getInstallationProgressSummary(checklistSections = {}) {
    const allItems = INSTALLATION_TEMPLATE_SECTIONS.flatMap((section) =>
      Array.isArray(checklistSections?.[section.key])
        ? checklistSections[section.key]
        : []
    );
    const totalSteps = allItems.length;
    const completedSteps = allItems.filter((item) => item.completed === true).length;
    const requiredSteps = allItems.filter((item) => item.required !== false).length;
    const requiredCompletedSteps = allItems.filter(
      (item) => item.required !== false && item.completed === true
    ).length;
    const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    return {
      totalSteps,
      completedSteps,
      requiredSteps,
      requiredCompletedSteps,
      progress,
      requiredPendingSteps: Math.max(requiredSteps - requiredCompletedSteps, 0),
    };
  }

  function getInstallationTemplateById(templateId) {
    return installationTemplates.find((template) => template.id === templateId) || null;
  }

  function cloneInstallationForm(base = EMPTY_INSTALLATION_FORM) {
    return {
      title: base.title || "",
      templateId: base.templateId || "",
      campus: base.campus || "",
      locationId: base.locationId || "",
      locationName: base.locationName || "",
      locationType: base.locationType || "",
      responsibleName: base.responsibleName || profile?.name || "Soporte Técnico",
      status: base.status || "in_progress",
      notes: base.notes || "",
      installedEquipment: normalizeInstalledEquipmentForInstallation(
        base.installedEquipment || []
      ),
    };
  }

  function getSuggestedInstallationTitle(template, locationName = "") {
    const templateName = template?.name || "Instalación técnica";

    if (locationName) {
      return `${templateName} - ${locationName}`;
    }

    return templateName;
  }

  function openInstallationForm(template = null) {
    const selectedTemplate =
      template ||
      activeInstallationTemplates[0] ||
      installationTemplates.find((item) => item.active !== false) ||
      null;

    setInstallationForm(
      cloneInstallationForm({
        ...EMPTY_INSTALLATION_FORM,
        templateId: selectedTemplate?.id || "",
        title: selectedTemplate ? getSuggestedInstallationTitle(selectedTemplate) : "",
        responsibleName: profile?.name || "Soporte Técnico",
      })
    );
    setInstallationFormError("");
    setShowInstallationForm(true);
    setSelectedInstallation(null);
    setInstallationSubTab("installations");
    setActiveTab("instalaciones");
    scrollToTop();
  }

  function closeInstallationForm() {
    setShowInstallationForm(false);
    setInstallationForm(cloneInstallationForm(EMPTY_INSTALLATION_FORM));
    setInstallationFormError("");
  }

  function handleInstallationFormChange(event) {
    const { name, value } = event.target;

    setInstallationForm((current) => {
      const nextForm = {
        ...current,
        [name]: value,
      };

      if (name === "templateId") {
        const template = getInstallationTemplateById(value);
        if (template && (!current.title || current.title === getSuggestedInstallationTitle(getInstallationTemplateById(current.templateId)))) {
          nextForm.title = getSuggestedInstallationTitle(template, current.locationName);
        }
      }

      if (name === "locationId") {
        const selectedLocation = technicalLocations.find((location) => location.id === value);

        nextForm.locationName = selectedLocation?.name || "";
        nextForm.locationType = selectedLocation?.type || "";
        nextForm.campus = selectedLocation?.campus || current.campus || "";

        const template = getInstallationTemplateById(current.templateId);
        if (template && (!current.title || current.title === getSuggestedInstallationTitle(template))) {
          nextForm.title = getSuggestedInstallationTitle(template, selectedLocation?.name || "");
        }
      }

      return nextForm;
    });
  }

  async function handleInstallationSubmit(event) {
    event.preventDefault();

    try {
      setSavingInstallation(true);
      setInstallationFormError("");
      setPageError("");

      const selectedTemplate = getInstallationTemplateById(installationForm.templateId);

      if (!selectedTemplate) {
        throw new Error("Selecciona una plantilla activa para crear la instalación.");
      }

      const selectedLocation = technicalLocations.find(
        (location) => location.id === installationForm.locationId
      );
      const locationName = selectedLocation?.name || installationForm.locationName || "";
      const title =
        installationForm.title.trim() ||
        getSuggestedInstallationTitle(selectedTemplate, locationName);
      const checklistSections = buildInstallationChecklistFromTemplate(selectedTemplate);
      const progressSummary = getInstallationProgressSummary(checklistSections);

      const newInstallation = await createTechnicalInstallation(
        {
          ...installationForm,
          title,
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name || "",
          targetLocationType: selectedTemplate.targetLocationType || "",
          equipmentCategory: selectedTemplate.equipmentCategory || "",
          locationId: selectedLocation?.id || installationForm.locationId || "",
          locationName,
          locationType:
            selectedLocation?.type ||
            installationForm.locationType ||
            selectedTemplate.targetLocationType ||
            "",
          campus: selectedLocation?.campus || installationForm.campus || "",
          installedEquipment: [],
          checklistSections,
          ...progressSummary,
        },
        getCurrentUserProfile()
      );

      await loadInstallations();
      setSelectedInstallation(newInstallation);
      closeInstallationForm();
      setInstallationSubTab("installations");
    } catch (error) {
      console.error("No se pudo crear la instalación:", error);
      setInstallationFormError(
        error?.message || "No se pudo crear la instalación. Revisa la información."
      );
    } finally {
      setSavingInstallation(false);
    }
  }

  function openInstallationDetail(installation) {
    setSelectedInstallation({
      ...installation,
      installedEquipment: normalizeInstalledEquipmentForInstallation(
        installation.installedEquipment || []
      ),
      checklistSections: getInstallationChecklistSections(installation.checklistSections),
    });
    setShowInstallationForm(false);
    setInstallationAssetSearchTerm("");
    setInstallationAssetCampusFilter("Todos");
    setInstallationAssetCategoryFilter("Todas");
    setInstallationSubTab("installations");
    setActiveTab("instalaciones");
    scrollToTop();
  }

  function closeInstallationDetail() {
    setSelectedInstallation(null);
  }

  function updateSelectedInstallationItem(sectionKey, itemIndex, fieldName, value) {
    setSelectedInstallation((current) => {
      if (!current) return current;

      const checklistSections = getInstallationChecklistSections(current.checklistSections);
      const items = Array.isArray(checklistSections[sectionKey])
        ? checklistSections[sectionKey]
        : [];

      checklistSections[sectionKey] = items.map((item, index) => {
        if (index !== itemIndex) return item;

        const updatedItem = {
          ...item,
          [fieldName]: value,
        };

        if (fieldName === "completed") {
          updatedItem.completedAt = value ? new Date().toISOString() : "";
          updatedItem.completedBy = value ? profile?.name || "Soporte Técnico" : "";
        }

        return updatedItem;
      });

      const progressSummary = getInstallationProgressSummary(checklistSections);

      return {
        ...current,
        checklistSections,
        ...progressSummary,
      };
    });
  }

  async function saveSelectedInstallation(nextStatus = null) {
    if (!selectedInstallation?.id) return;

    try {
      setSavingInstallation(true);
      setPageError("");

      const checklistSections = getInstallationChecklistSections(
        selectedInstallation.checklistSections
      );
      const progressSummary = getInstallationProgressSummary(checklistSections);
      const status = nextStatus || selectedInstallation.status || "in_progress";

      if (status === "completed" && progressSummary.requiredPendingSteps > 0) {
        throw new Error(
          `Aún faltan ${progressSummary.requiredPendingSteps} paso(s) obligatorio(s) para completar la instalación.`
        );
      }

      let updatedInstallation;

      if (status === "completed") {
        updatedInstallation = await completeTechnicalInstallation(
          selectedInstallation.id,
          {
            ...selectedInstallation,
            status,
            checklistSections,
            ...progressSummary,
          },
          getCurrentUserProfile()
        );
      } else if (status === "cancelled") {
        updatedInstallation = await cancelTechnicalInstallation(
          selectedInstallation.id,
          {
            ...selectedInstallation,
            status,
            checklistSections,
            ...progressSummary,
          },
          getCurrentUserProfile()
        );
      } else {
        updatedInstallation = await updateTechnicalInstallation(
          selectedInstallation.id,
          {
            ...selectedInstallation,
            status,
            checklistSections,
            ...progressSummary,
          },
          getCurrentUserProfile()
        );
      }

      await loadInstallations();
      setSelectedInstallation({
        ...selectedInstallation,
        ...updatedInstallation,
        installedEquipment: normalizeInstalledEquipmentForInstallation(
          updatedInstallation.installedEquipment || selectedInstallation.installedEquipment || []
        ),
        checklistSections,
      });
    } catch (error) {
      console.error("No se pudo guardar la instalación:", error);
      setPageError(error?.message || "No se pudo guardar el avance de la instalación.");
    } finally {
      setSavingInstallation(false);
    }
  }

  function normalizeInstalledEquipmentForInstallation(items = []) {
    if (!Array.isArray(items)) {
      return [];
    }

    const seenIds = new Set();

    return items
      .map((item) => {
        const equipmentId = String(
          item?.equipmentId || item?.assetId || item?.id || ""
        ).trim();

        if (!equipmentId || seenIds.has(equipmentId)) {
          return null;
        }

        seenIds.add(equipmentId);

        return {
          equipmentId,
          equipmentCode: String(
            item?.equipmentCode || item?.assetTag || item?.code || ""
          ).trim(),
          equipmentName: String(
            item?.equipmentName || item?.name || item?.assetName || ""
          ).trim(),
          category: String(item?.category || "").trim(),
          brand: String(item?.brand || "").trim(),
          model: String(item?.model || "").trim(),
          serialNumber: String(item?.serialNumber || "").trim(),
          campus: String(item?.campus || "").trim(),
          area: String(item?.area || "").trim(),
          status: String(item?.status || "").trim(),
          condition: String(item?.condition || "").trim(),
          previousLocationId: String(
            item?.previousLocationId || item?.technicalLocationId || ""
          ).trim(),
          previousLocationName: String(
            item?.previousLocationName || item?.technicalLocationName || ""
          ).trim(),
          previousLocationType: String(
            item?.previousLocationType || item?.technicalLocationType || ""
          ).trim(),
          assignedLocationId: String(item?.assignedLocationId || "").trim(),
          assignedLocationName: String(item?.assignedLocationName || "").trim(),
          assignedLocationType: String(item?.assignedLocationType || "").trim(),
          addedAt: String(item?.addedAt || "").trim(),
          addedBy: String(item?.addedBy || "").trim(),
          notes: String(item?.notes || "").trim(),
        };
      })
      .filter(Boolean);
  }

  function buildInstallationEquipmentSnapshot(asset, installation = selectedInstallation) {
    const selectedLocation = technicalLocations.find(
      (location) => location.id === (installation?.locationId || "")
    );

    return {
      equipmentId: asset.id,
      equipmentCode: asset.assetTag || "",
      equipmentName: asset.name || "",
      category: asset.category || "",
      brand: asset.brand || "",
      model: asset.model || "",
      serialNumber: asset.serialNumber || "",
      campus: asset.campus || "",
      area: asset.area || "",
      status: asset.status || "",
      condition: asset.condition || "",
      previousLocationId: asset.technicalLocationId || "",
      previousLocationName: asset.technicalLocationName || "",
      previousLocationType: asset.technicalLocationType || "",
      assignedLocationId: installation?.locationId || selectedLocation?.id || "",
      assignedLocationName:
        installation?.locationName || selectedLocation?.name || "",
      assignedLocationType:
        installation?.locationType || selectedLocation?.type || "",
      addedAt: new Date().toISOString(),
      addedBy: profile?.name || "Soporte Técnico",
      notes: "",
    };
  }

  function getInstallationEquipmentSearchText(item = {}) {
    return [
      item.equipmentCode,
      item.equipmentName,
      item.category,
      item.brand,
      item.model,
      item.serialNumber,
      item.campus,
      item.area,
      item.status,
      item.condition,
      item.previousLocationName,
      item.assignedLocationName,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function getFilteredInstallationAssetOptions(installation) {
    const linkedIds = new Set(
      normalizeInstalledEquipmentForInstallation(installation?.installedEquipment).map(
        (equipment) => equipment.equipmentId
      )
    );
    const normalizedSearch = installationAssetSearchTerm.trim().toLowerCase();

    return visibleAssets.filter((asset) => {
      if (linkedIds.has(asset.id)) return false;

      const assetSearchText = getInstallationEquipmentSearchText({
        equipmentCode: asset.assetTag,
        equipmentName: asset.name,
        category: asset.category,
        brand: asset.brand,
        model: asset.model,
        serialNumber: asset.serialNumber,
        campus: asset.campus,
        area: asset.area,
        status: asset.status,
        condition: asset.condition,
        previousLocationName: asset.technicalLocationName,
      });

      const matchesSearch =
        !normalizedSearch || assetSearchText.includes(normalizedSearch);
      const matchesCampus =
        installationAssetCampusFilter === "Todos" ||
        normalizeCampusName(asset.campus) === installationAssetCampusFilter ||
        asset.campus === installationAssetCampusFilter;
      const matchesCategory =
        installationAssetCategoryFilter === "Todas" ||
        asset.category === installationAssetCategoryFilter;

      return matchesSearch && matchesCampus && matchesCategory;
    });
  }

  function addAssetToSelectedInstallation(asset) {
    if (!asset?.id) return;

    setSelectedInstallation((current) => {
      if (!current) return current;

      const installedEquipment = normalizeInstalledEquipmentForInstallation(
        current.installedEquipment
      );
      const alreadyLinked = installedEquipment.some(
        (equipment) => equipment.equipmentId === asset.id
      );

      if (alreadyLinked) return current;

      const nextInstalledEquipment = [
        ...installedEquipment,
        buildInstallationEquipmentSnapshot(asset, current),
      ];

      return {
        ...current,
        installedEquipment: nextInstalledEquipment,
        installedEquipmentCount: nextInstalledEquipment.length,
      };
    });
  }

  function removeAssetFromSelectedInstallation(equipmentId) {
    setSelectedInstallation((current) => {
      if (!current) return current;

      const nextInstalledEquipment = normalizeInstalledEquipmentForInstallation(
        current.installedEquipment
      ).filter((equipment) => equipment.equipmentId !== equipmentId);

      return {
        ...current,
        installedEquipment: nextInstalledEquipment,
        installedEquipmentCount: nextInstalledEquipment.length,
      };
    });
  }

  function renderInstalledEquipmentManager(installation) {
    const installedEquipment = normalizeInstalledEquipmentForInstallation(
      installation?.installedEquipment
    );
    const assetOptions = getFilteredInstallationAssetOptions(installation);
    const isLocked =
      savingInstallation ||
      installation?.status === "completed" ||
      installation?.status === "cancelled";

    return (
      <section className="installation-equipment-panel">
        <div className="installation-equipment-header">
          <div>
            <p className="section-kicker equipment-kicker">Equipos instalados</p>
            <h4>Equipos vinculados a esta instalación</h4>
            <p>
              Selecciona del inventario técnico los equipos que quedaron incluidos en esta instalación.
            </p>
          </div>
          <span>{installedEquipment.length} equipo(s)</span>
        </div>

        <div className="installation-equipment-linked-list">
          {installedEquipment.length > 0 ? (
            installedEquipment.map((equipment) => (
              <article className="installation-equipment-linked-card" key={equipment.equipmentId}>
                <div>
                  <strong>
                    {equipment.equipmentCode || "Sin código"} · {equipment.equipmentName || "Equipo sin nombre"}
                  </strong>
                  <p>
                    {equipment.category || "Sin categoría"}
                    {equipment.brand ? ` · ${equipment.brand}` : ""}
                    {equipment.model ? ` ${equipment.model}` : ""}
                  </p>
                  <small>
                    Ubicación previa: {equipment.previousLocationName || "Sin ubicación previa"} · Destino: {equipment.assignedLocationName || installation?.locationName || "Sin destino"}
                  </small>
                </div>
                <button
                  className="danger-table-button"
                  type="button"
                  onClick={() => removeAssetFromSelectedInstallation(equipment.equipmentId)}
                  disabled={isLocked}
                >
                  Quitar
                </button>
              </article>
            ))
          ) : (
            <div className="installation-equipment-empty">
              Todavía no hay equipos vinculados a esta instalación.
            </div>
          )}
        </div>

        <div className="installation-equipment-selector">
          <div className="installation-equipment-selector-header">
            <div>
              <h5>Agregar equipo del inventario</h5>
              <p>Busca por código, nombre, categoría, marca, modelo o ubicación actual.</p>
            </div>
          </div>

          <div className="installation-equipment-filters">
            <div className="visual-search wide installation-equipment-search">
              <span>⌕</span>
              <input
                type="search"
                value={installationAssetSearchTerm}
                onChange={(event) => setInstallationAssetSearchTerm(event.target.value)}
                placeholder="Buscar equipo técnico..."
                disabled={isLocked}
              />
            </div>

            <select
              value={installationAssetCampusFilter}
              onChange={(event) => setInstallationAssetCampusFilter(event.target.value)}
              disabled={isLocked}
            >
              <option value="Todos">Todos los planteles</option>
              {campusFilterOptions.map((campus) => (
                <option key={campus} value={campus}>
                  {campus}
                </option>
              ))}
            </select>

            <select
              value={installationAssetCategoryFilter}
              onChange={(event) => setInstallationAssetCategoryFilter(event.target.value)}
              disabled={isLocked}
            >
              <option value="Todas">Todas las categorías</option>
              {ASSET_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          {assetOptions.length > 0 ? (
            <div className="installation-equipment-options">
              {assetOptions.slice(0, 12).map((asset) => (
                <article className="installation-equipment-option" key={asset.id}>
                  <div>
                    <strong>
                      {asset.assetTag || "Sin código"} · {asset.name || "Equipo sin nombre"}
                    </strong>
                    <p>
                      {asset.category || "Sin categoría"} · {asset.campus || "Sin plantel"}
                    </p>
                    <small>
                      {asset.technicalLocationName || asset.area || "Sin ubicación actual"}
                      {asset.status ? ` · ${asset.status}` : ""}
                    </small>
                  </div>
                  <button
                    type="button"
                    onClick={() => addAssetToSelectedInstallation(asset)}
                    disabled={isLocked}
                  >
                    Agregar
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="installation-equipment-empty">
              No hay equipos disponibles con esos filtros o todos ya están vinculados.
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderInstallationChecklistEditor(installation) {
    const checklistSections = getInstallationChecklistSections(installation?.checklistSections);

    return (
      <div className="installation-run-checklist">
        {INSTALLATION_TEMPLATE_SECTIONS.map((section) => {
          const items = Array.isArray(checklistSections[section.key])
            ? checklistSections[section.key]
            : [];

          return (
            <section className="installation-run-section" key={section.key}>
              <div className="installation-run-section-header">
                <span>{section.icon}</span>
                <div>
                  <h4>{section.title}</h4>
                  <p>{section.description}</p>
                </div>
              </div>

              <div className="installation-run-item-list">
                {items.length > 0 ? (
                  items.map((item, index) => (
                    <article
                      className={`installation-run-item ${item.completed ? "completed" : ""}`}
                      key={item.id || index}
                    >
                      <label className="installation-run-check-row">
                        <input
                          type="checkbox"
                          checked={item.completed === true}
                          onChange={(event) =>
                            updateSelectedInstallationItem(
                              section.key,
                              index,
                              "completed",
                              event.target.checked
                            )
                          }
                          disabled={savingInstallation || installation.status === "completed" || installation.status === "cancelled"}
                        />
                        <span>{item.completed ? "✓" : ""}</span>
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.required !== false ? "Obligatorio" : "Opcional"}</small>
                          {item.completedAt && (
                            <small>
                              Completado: {formatInstallationItemDate(item.completedAt)}
                              {item.completedBy ? ` · ${item.completedBy}` : ""}
                            </small>
                          )}
                        </div>
                      </label>

                      <textarea
                        value={item.notes || ""}
                        onChange={(event) =>
                          updateSelectedInstallationItem(
                            section.key,
                            index,
                            "notes",
                            event.target.value
                          )
                        }
                        placeholder="Notas de este paso, si aplica..."
                        disabled={savingInstallation || installation.status === "completed" || installation.status === "cancelled"}
                      />
                    </article>
                  ))
                ) : (
                  <div className="installation-template-empty-section">
                    Esta sección no tiene pasos en la plantilla usada.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  function renderInstallationTemplateSectionEditor(section) {
    const items = Array.isArray(installationTemplateForm[section.key])
      ? installationTemplateForm[section.key]
      : [];

    return (
      <section className="installation-template-section" key={section.key}>
        <div className="installation-template-section-header">
          <div>
            <span>{section.icon}</span>
            <div>
              <h4>{section.title}</h4>
              <p>{section.description}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => addInstallationTemplateItem(section.key)}
            disabled={savingInstallationTemplate}
          >
            + Agregar paso
          </button>
        </div>

        <div className="installation-template-item-list">
          {items.length > 0 ? (
            items.map((item, index) => (
              <div className="installation-template-item-row" key={item.id || index}>
                <input
                  type="text"
                  value={item.label}
                  onChange={(event) =>
                    updateInstallationTemplateItem(
                      section.key,
                      index,
                      "label",
                      event.target.value
                    )
                  }
                  placeholder={section.placeholder}
                  disabled={savingInstallationTemplate}
                />

                <label className="installation-required-toggle">
                  <input
                    type="checkbox"
                    checked={item.required !== false}
                    onChange={(event) =>
                      updateInstallationTemplateItem(
                        section.key,
                        index,
                        "required",
                        event.target.checked
                      )
                    }
                    disabled={savingInstallationTemplate}
                  />
                  Obligatorio
                </label>

                <button
                  type="button"
                  className="danger-table-button"
                  onClick={() => removeInstallationTemplateItem(section.key, index)}
                  disabled={savingInstallationTemplate || items.length <= 1}
                >
                  Eliminar
                </button>
              </div>
            ))
          ) : (
            <div className="installation-template-empty-section">
              No hay pasos en esta sección.
              <button
                type="button"
                onClick={() => addInstallationTemplateItem(section.key)}
                disabled={savingInstallationTemplate}
              >
                Agregar primer paso
              </button>
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderInstallationTemplatesPanel() {
    return (
      <section className="installation-templates-workspace">
        <div className="installation-templates-header">
          <div>
            <p className="section-kicker equipment-kicker">Procesos de instalación</p>
            <h2>Plantillas de instalación técnica</h2>
            <p>
              Crea estándares reutilizables para que cada instalación tenga los mismos pasos físicos, programas, configuraciones y pruebas finales.
            </p>
          </div>

          <div className="installation-templates-header-actions">
            <button
              className="visual-outline-button"
              type="button"
              onClick={loadInstallationTemplates}
              disabled={loadingInstallationTemplates}
            >
              Actualizar
            </button>
            <button
              className="visual-primary-button"
              type="button"
              onClick={() => openInstallationTemplateForm()}
            >
              + Nueva plantilla
            </button>
          </div>
        </div>

        <div className="installation-templates-metrics-grid">
          <article>
            <span>Activas</span>
            <strong>{installationTemplateMetrics.active}</strong>
            <p>Plantillas disponibles</p>
          </article>
          <article className="muted">
            <span>Inactivas</span>
            <strong>{installationTemplateMetrics.inactive}</strong>
            <p>Plantillas pausadas</p>
          </article>
          <article>
            <span>Para salones</span>
            <strong>{installationTemplateMetrics.classroomTemplates}</strong>
            <p>Estándares de aula</p>
          </article>
          <article className="warning">
            <span>Pasos activos</span>
            <strong>{installationTemplateMetrics.totalSteps}</strong>
            <p>Checklist acumulado</p>
          </article>
        </div>

        {showInstallationTemplateForm && (
          <section className="installation-template-form-panel">
            <div className="technical-panel-header">
              <div>
                <h3>
                  {editingInstallationTemplateId
                    ? "Editar plantilla"
                    : "Crear plantilla de instalación"}
                </h3>
                <p>
                  Define el checklist estándar que después se cargará automáticamente en una instalación real.
                </p>
              </div>

              <div className="installation-template-form-actions-top">
                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={loadSampleInstallationTemplate}
                  disabled={savingInstallationTemplate}
                >
                  Cargar ejemplo
                </button>
                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={closeInstallationTemplateForm}
                  disabled={savingInstallationTemplate}
                >
                  Cerrar
                </button>
              </div>
            </div>

            {installationTemplateFormError && (
              <div className="form-error">{installationTemplateFormError}</div>
            )}

            <form className="technical-form" onSubmit={handleInstallationTemplateSubmit}>
              <div className="technical-form-grid">
                <label>
                  Nombre de la plantilla
                  <input
                    type="text"
                    name="name"
                    value={installationTemplateForm.name}
                    onChange={handleInstallationTemplateFormChange}
                    placeholder="Ej. Instalación de computadora en salón"
                    disabled={savingInstallationTemplate}
                  />
                </label>

                <label>
                  Tipo de ubicación
                  <select
                    name="targetLocationType"
                    value={installationTemplateForm.targetLocationType}
                    onChange={handleInstallationTemplateFormChange}
                    disabled={savingInstallationTemplate}
                  >
                    {installationTemplateLocationOptions.map((locationType) => (
                      <option key={locationType} value={locationType}>
                        {locationType}
                      </option>
                    ))}
                  </select>
                </label>

                {installationTemplateForm.targetLocationType === "Otro" && (
                  <label className="installation-template-custom-field">
                    Otro tipo de ubicación
                    <input
                      type="text"
                      name="targetLocationTypeOther"
                      value={installationTemplateForm.targetLocationTypeOther || ""}
                      onChange={handleInstallationTemplateFormChange}
                      placeholder="Ej. Bodega, Dirección, Laboratorio..."
                      disabled={savingInstallationTemplate}
                    />
                    <small>Si lo dejas vacío, se guardará como Otro.</small>
                  </label>
                )}

                <label>
                  Categoría de equipo
                  <select
                    name="equipmentCategory"
                    value={installationTemplateForm.equipmentCategory}
                    onChange={handleInstallationTemplateFormChange}
                    disabled={savingInstallationTemplate}
                  >
                    {installationTemplateEquipmentCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                {installationTemplateForm.equipmentCategory === "Otro" && (
                  <label className="installation-template-custom-field">
                    Otra categoría de equipo
                    <input
                      type="text"
                      name="equipmentCategoryOther"
                      value={installationTemplateForm.equipmentCategoryOther || ""}
                      onChange={handleInstallationTemplateFormChange}
                      placeholder="Ej. Ticketera, proyector, cámara, router..."
                      disabled={savingInstallationTemplate}
                    />
                    <small>Si lo dejas vacío, se guardará como Otro.</small>
                  </label>
                )}

                <div className="installation-template-active-toggle">
                  <span>Estado de la plantilla</span>
                  <label>
                    <input
                      type="checkbox"
                      name="active"
                      checked={installationTemplateForm.active !== false}
                      onChange={handleInstallationTemplateFormChange}
                      disabled={savingInstallationTemplate}
                    />
                    Activa para futuras instalaciones
                  </label>
                </div>

                <label className="technical-form-full">
                  Descripción
                  <textarea
                    name="description"
                    value={installationTemplateForm.description}
                    onChange={handleInstallationTemplateFormChange}
                    rows="3"
                    placeholder="Describe cuándo debe usarse esta plantilla."
                    disabled={savingInstallationTemplate}
                  />
                </label>
              </div>

              <div className="installation-template-sections-editor">
                {INSTALLATION_TEMPLATE_SECTIONS.map((section) =>
                  renderInstallationTemplateSectionEditor(section)
                )}
              </div>

              <div className="installation-template-summary-box">
                <div>
                  <span>Total de pasos</span>
                  <strong>{getInstallationTemplateTotalSteps(installationTemplateForm)}</strong>
                </div>
                <div>
                  <span>Obligatorios</span>
                  <strong>{getInstallationTemplateRequiredSteps(installationTemplateForm)}</strong>
                </div>
                <div>
                  <span>Uso previsto</span>
                  <strong>
                    {installationTemplateForm.targetLocationType} · {installationTemplateForm.equipmentCategory}
                  </strong>
                </div>
              </div>

              <div className="technical-form-actions">
                <button
                  type="button"
                  onClick={closeInstallationTemplateForm}
                  disabled={savingInstallationTemplate}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={savingInstallationTemplate}
                >
                  {savingInstallationTemplate
                    ? "Guardando..."
                    : editingInstallationTemplateId
                    ? "Guardar cambios"
                    : "Crear plantilla"}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="installation-templates-list-panel">
          <div className="installation-templates-toolbar">
            <div className="visual-search wide installation-template-search">
              <span>⌕</span>
              <input
                type="search"
                value={installationTemplateSearchTerm}
                onChange={(event) => setInstallationTemplateSearchTerm(event.target.value)}
                placeholder="Buscar por nombre, ubicación, categoría o paso..."
              />
            </div>

            <select
              value={installationTemplateLocationFilter}
              onChange={(event) => setInstallationTemplateLocationFilter(event.target.value)}
            >
              <option value="Todos">Todas las ubicaciones</option>
              {installationTemplateLocationOptions.map((locationType) => (
                <option key={locationType} value={locationType}>
                  {locationType}
                </option>
              ))}
            </select>

            <select
              value={installationTemplateStatusFilter}
              onChange={(event) => setInstallationTemplateStatusFilter(event.target.value)}
            >
              <option value="active">Activas</option>
              <option value="inactive">Inactivas</option>
              <option value="todos">Todas</option>
            </select>
          </div>

          {loadingInstallationTemplates ? (
            <div className="empty-state compact-empty-state">
              <h3>Cargando plantillas...</h3>
              <p>Estamos consultando los procesos guardados.</p>
            </div>
          ) : filteredInstallationTemplates.length > 0 ? (
            <div className="installation-template-card-grid">
              {filteredInstallationTemplates.map((template) => {
                const isInactive =
                  template?.deleted === true ||
                  template?.active === false ||
                  template?.status === "inactive";

                return (
                  <article
                    className={`installation-template-card ${isInactive ? "inactive" : ""}`}
                    key={template.id}
                  >
                    <div className="installation-template-card-top">
                      <span className="installation-template-icon">▥</span>
                      <div>
                        <strong>{template.name || "Plantilla sin nombre"}</strong>
                        <p>
                          {template.targetLocationType || "Sin ubicación"} · {template.equipmentCategory || "Sin categoría"}
                        </p>
                      </div>
                      <span className={`installation-template-status ${isInactive ? "inactive" : "active"}`}>
                        {isInactive ? "Inactiva" : "Activa"}
                      </span>
                    </div>

                    <p className="installation-template-description">
                      {template.description || "Sin descripción registrada."}
                    </p>

                    <div className="installation-template-card-metrics">
                      {INSTALLATION_TEMPLATE_SECTIONS.map((section) => (
                        <div key={section.key}>
                          <span>{section.title}</span>
                          <strong>
                            {Array.isArray(template[section.key]) ? template[section.key].length : 0}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <div className="installation-template-card-footer">
                      <span>
                        {getInstallationTemplateTotalSteps(template)} pasos · {getInstallationTemplateRequiredSteps(template)} obligatorios
                      </span>
                      <div>
                        <button
                          type="button"
                          onClick={() => openInstallationTemplateForm(template)}
                        >
                          Editar
                        </button>
                        {isInactive ? (
                          <button
                            type="button"
                            className="restore-table-button"
                            onClick={() => handleRestoreInstallationTemplate(template)}
                          >
                            Reactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="danger-table-button"
                            onClick={() => handleDeactivateInstallationTemplate(template)}
                          >
                            Desactivar
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state compact-empty-state">
              <h3>No hay plantillas con esos filtros</h3>
              <p>Crea una plantilla o limpia los filtros para ver otros procesos.</p>
            </div>
          )}
        </section>
      </section>
    );
  }

  function renderInstallationRunsPanel() {
    const selectedSummary = selectedInstallation
      ? getInstallationProgressSummary(
          getInstallationChecklistSections(selectedInstallation.checklistSections)
        )
      : null;

    return (
      <section className="installation-runs-workspace">
        <div className="installation-runs-header">
          <div>
            <p className="section-kicker equipment-kicker">Instalaciones reales</p>
            <h2>Instalaciones realizadas desde plantilla</h2>
            <p>
              Crea instalaciones reales, carga automáticamente el checklist de la plantilla y da seguimiento paso a paso.
            </p>
          </div>

          <div className="installation-runs-header-actions">
            <button
              className="visual-outline-button"
              type="button"
              onClick={loadInstallations}
              disabled={loadingInstallations}
            >
              Actualizar
            </button>
            <button
              className="visual-primary-button"
              type="button"
              onClick={() => openInstallationForm()}
              disabled={activeInstallationTemplates.length === 0}
            >
              + Nueva instalación
            </button>
          </div>
        </div>

        {activeInstallationTemplates.length === 0 && (
          <div className="technical-alert-strip installation-alert-strip">
            <div className="technical-alert-main">
              <span>!</span>
              <div>
                <strong>Primero necesitas una plantilla activa</strong>
                <p>
                  Crea o reactiva una plantilla para poder generar instalaciones reales con checklist guiada.
                </p>
              </div>
            </div>
            <button
              className="visual-outline-button"
              type="button"
              onClick={() => setInstallationSubTab("templates")}
            >
              Ir a plantillas
            </button>
          </div>
        )}

        <div className="installation-runs-metrics-grid">
          <article>
            <span>Activas</span>
            <strong>{installationMetrics.active}</strong>
            <p>En proceso, borrador o pausadas</p>
          </article>
          <article className="success">
            <span>Completadas</span>
            <strong>{installationMetrics.completed}</strong>
            <p>Instalaciones cerradas</p>
          </article>
          <article className="warning">
            <span>Pausadas</span>
            <strong>{installationMetrics.paused}</strong>
            <p>Requieren seguimiento</p>
          </article>
          <article>
            <span>Avance promedio</span>
            <strong>{installationMetrics.averageProgress}%</strong>
            <p>Promedio general</p>
          </article>
        </div>

        {showInstallationForm && (
          <section className="installation-run-form-panel">
            <div className="technical-panel-header">
              <div>
                <h3>Nueva instalación</h3>
                <p>
                  Selecciona una plantilla y una ubicación. El checklist se cargará automáticamente al guardar.
                </p>
              </div>

              <button
                className="visual-outline-button"
                type="button"
                onClick={closeInstallationForm}
                disabled={savingInstallation}
              >
                Cerrar
              </button>
            </div>

            {installationFormError && (
              <div className="form-error">{installationFormError}</div>
            )}

            <form className="technical-form" onSubmit={handleInstallationSubmit}>
              <div className="technical-form-grid">
                <label>
                  Plantilla
                  <select
                    name="templateId"
                    value={installationForm.templateId}
                    onChange={handleInstallationFormChange}
                    disabled={savingInstallation}
                  >
                    <option value="">Selecciona una plantilla</option>
                    {activeInstallationTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · {template.targetLocationType || "Sin ubicación"}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Ubicación técnica
                  <select
                    name="locationId"
                    value={installationForm.locationId}
                    onChange={handleInstallationFormChange}
                    disabled={savingInstallation}
                  >
                    <option value="">Sin ubicación específica</option>
                    {technicalLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.campus || "Sin plantel"} · {location.name || "Sin nombre"}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Título
                  <input
                    type="text"
                    name="title"
                    value={installationForm.title}
                    onChange={handleInstallationFormChange}
                    placeholder="Ej. Computadora nueva en Salón 4"
                    disabled={savingInstallation}
                  />
                </label>

                <label>
                  Plantel
                  <select
                    name="campus"
                    value={installationForm.campus}
                    onChange={handleInstallationFormChange}
                    disabled={savingInstallation}
                  >
                    <option value="">Selecciona plantel</option>
                    {CAMPUS_OPTIONS.map((campus) => (
                      <option key={campus} value={campus}>
                        {campus}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Responsable
                  <input
                    type="text"
                    name="responsibleName"
                    value={installationForm.responsibleName}
                    onChange={handleInstallationFormChange}
                    placeholder="Ej. Tony Campos"
                    disabled={savingInstallation}
                  />
                </label>

                <label>
                  Estado inicial
                  <select
                    name="status"
                    value={installationForm.status}
                    onChange={handleInstallationFormChange}
                    disabled={savingInstallation}
                  >
                    {INSTALLATION_STATUS_OPTIONS.filter(
                      (status) => !["completed", "cancelled"].includes(status.value)
                    ).map((status) => (
                      <option key={status.value} value={status.value}>
                        {status.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="technical-form-full">
                  Notas generales
                  <textarea
                    name="notes"
                    value={installationForm.notes}
                    onChange={handleInstallationFormChange}
                    rows="3"
                    placeholder="Notas iniciales de la instalación."
                    disabled={savingInstallation}
                  />
                </label>
              </div>

              <div className="technical-form-actions">
                <button
                  type="button"
                  onClick={closeInstallationForm}
                  disabled={savingInstallation}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={savingInstallation}
                >
                  {savingInstallation ? "Creando..." : "Crear instalación"}
                </button>
              </div>
            </form>
          </section>
        )}

        {selectedInstallation && selectedSummary && (
          <section className="installation-run-detail-panel">
            <div className="installation-run-detail-header">
              <div>
                <p className="section-kicker equipment-kicker">Checklist guiada</p>
                <h3>{selectedInstallation.title || "Instalación sin título"}</h3>
                <p>
                  {selectedInstallation.templateName || "Sin plantilla"} · {selectedInstallation.campus || "Sin plantel"} · {selectedInstallation.locationName || "Sin ubicación"}
                </p>
              </div>

              <div className="installation-run-detail-actions">
                <span className={`installation-run-status ${getInstallationStatusClass(selectedInstallation.status)}`}>
                  {getInstallationStatusLabel(selectedInstallation.status)}
                </span>
                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={closeInstallationDetail}
                  disabled={savingInstallation}
                >
                  Cerrar detalle
                </button>
              </div>
            </div>

            <div className="installation-run-progress-card">
              <div>
                <span>Avance</span>
                <strong>{selectedSummary.progress}%</strong>
                <p>
                  {selectedSummary.completedSteps} de {selectedSummary.totalSteps} pasos completados · {selectedSummary.requiredPendingSteps} obligatorios pendientes
                </p>
              </div>
              <div className="mini-track">
                <div
                  className="mini-fill mini-blue"
                  style={{ width: `${selectedSummary.progress}%` }}
                />
              </div>
            </div>

            <div className="installation-run-status-row">
              <label>
                Estado
                <select
                  value={selectedInstallation.status || "in_progress"}
                  onChange={(event) =>
                    setSelectedInstallation((current) =>
                      current ? { ...current, status: event.target.value } : current
                    )
                  }
                  disabled={savingInstallation || selectedInstallation.status === "completed" || selectedInstallation.status === "cancelled"}
                >
                  {INSTALLATION_STATUS_OPTIONS.map((status) => (
                    <option key={status.value} value={status.value}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Notas generales
                <textarea
                  value={selectedInstallation.notes || ""}
                  onChange={(event) =>
                    setSelectedInstallation((current) =>
                      current ? { ...current, notes: event.target.value } : current
                    )
                  }
                  disabled={savingInstallation || selectedInstallation.status === "completed" || selectedInstallation.status === "cancelled"}
                />
              </label>
            </div>

            {renderInstallationChecklistEditor(selectedInstallation)}

            {renderInstalledEquipmentManager(selectedInstallation)}

            <div className="technical-form-actions installation-run-save-actions">
              <button
                type="button"
                onClick={() => saveSelectedInstallation()}
                disabled={savingInstallation || selectedInstallation.status === "completed" || selectedInstallation.status === "cancelled"}
              >
                Guardar avance
              </button>
              <button
                className="visual-outline-button"
                type="button"
                onClick={() => saveSelectedInstallation("paused")}
                disabled={savingInstallation || selectedInstallation.status === "completed" || selectedInstallation.status === "cancelled"}
              >
                Pausar
              </button>
              <button
                className="visual-primary-button"
                type="button"
                onClick={() => saveSelectedInstallation("completed")}
                disabled={savingInstallation || selectedInstallation.status === "completed" || selectedInstallation.status === "cancelled"}
              >
                Finalizar instalación
              </button>
              <button
                className="danger-table-button"
                type="button"
                onClick={() => {
                  const confirmed = window.confirm("¿Quieres cancelar esta instalación?");
                  if (confirmed) {
                    saveSelectedInstallation("cancelled");
                  }
                }}
                disabled={savingInstallation || selectedInstallation.status === "completed" || selectedInstallation.status === "cancelled"}
              >
                Cancelar instalación
              </button>
            </div>
          </section>
        )}

        <section className="installation-runs-list-panel">
          <div className="installation-runs-toolbar">
            <div className="visual-search wide installation-run-search">
              <span>⌕</span>
              <input
                type="search"
                value={installationSearchTerm}
                onChange={(event) => setInstallationSearchTerm(event.target.value)}
                placeholder="Buscar por título, plantilla, plantel o responsable..."
              />
            </div>

            <select
              value={installationStatusFilter}
              onChange={(event) => setInstallationStatusFilter(event.target.value)}
            >
              {INSTALLATION_STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>

          {loadingInstallations ? (
            <div className="empty-state compact-empty-state">
              <h3>Cargando instalaciones...</h3>
              <p>Estamos consultando los registros guardados.</p>
            </div>
          ) : filteredInstallations.length > 0 ? (
            <div className="installation-run-card-grid">
              {filteredInstallations.map((installation) => {
                const progress = Number(installation.progress || 0);
                const statusClass = getInstallationStatusClass(installation.status);

                return (
                  <article className="installation-run-card" key={installation.id}>
                    <div className="installation-run-card-top">
                      <span className="installation-run-icon">▥</span>
                      <div>
                        <strong>{installation.title || "Instalación sin título"}</strong>
                        <p>
                          {installation.templateName || "Sin plantilla"} · {installation.locationName || "Sin ubicación"}
                        </p>
                      </div>
                      <span className={`installation-run-status ${statusClass}`}>
                        {getInstallationStatusLabel(installation.status)}
                      </span>
                    </div>

                    <div className="installation-run-card-meta">
                      <span><strong>Plantel</strong>{installation.campus || "Sin plantel"}</span>
                      <span><strong>Responsable</strong>{installation.responsibleName || "Sin responsable"}</span>
                      <span><strong>Pasos</strong>{Number(installation.completedSteps || 0)} / {Number(installation.totalSteps || 0)}</span>
                      <span><strong>Equipos</strong>{Number(installation.installedEquipmentCount || installation.installedEquipment?.length || 0)}</span>
                    </div>

                    <div className="installation-run-card-progress">
                      <div>
                        <span>Avance</span>
                        <strong>{progress}%</strong>
                      </div>
                      <div className="mini-track">
                        <div className="mini-fill mini-blue" style={{ width: `${progress}%` }} />
                      </div>
                    </div>

                    <div className="installation-run-card-footer">
                      <span>{formatLogDate(installation.updatedAt || installation.createdAt)}</span>
                      <button
                        type="button"
                        onClick={() => openInstallationDetail(installation)}
                      >
                        {installation.status === "completed" ? "Ver detalle" : "Continuar"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state compact-empty-state">
              <h3>No hay instalaciones con esos filtros</h3>
              <p>Crea una instalación nueva o cambia los filtros para ver otros registros.</p>
            </div>
          )}
        </section>
      </section>
    );
  }

  function renderInstallationsPanel() {
    return (
      <section className="installations-workspace">
        <div className="installation-subtabs">
          <button
            type="button"
            className={installationSubTab === "templates" ? "active" : ""}
            onClick={() => setInstallationSubTab("templates")}
          >
            Plantillas
          </button>
          <button
            type="button"
            className={installationSubTab === "installations" ? "active" : ""}
            onClick={() => setInstallationSubTab("installations")}
          >
            Instalaciones realizadas
          </button>
        </div>

        {installationSubTab === "templates"
          ? renderInstallationTemplatesPanel()
          : renderInstallationRunsPanel()}
      </section>
    );
  }

  function renderSparePartsPanel() {
    return (
      <section className="spare-parts-workspace">
        <div className="spare-parts-header">
          <div>
            <p className="section-kicker equipment-kicker">Inventario de recambios</p>
            <h2>Recambios y consumibles</h2>
            <p>
              Controla piezas, consumibles y accesorios con códigos de barra,
              entradas, salidas e historial.
            </p>
          </div>

          <div className="spare-parts-header-actions">
            <button
              className="visual-outline-button"
              type="button"
              onClick={loadSpareParts}
              disabled={loadingSpareParts}
            >
              Actualizar
            </button>
            <button
              className="visual-primary-button"
              type="button"
              onClick={() => openSparePartForm()}
            >
              + Registrar recambio
            </button>
          </div>
        </div>

        <div className="spare-parts-metrics-grid">
          <article>
            <span>Activos</span>
            <strong>{sparePartMetrics.active}</strong>
            <p>Recambios disponibles para uso</p>
          </article>
          <article className="warning">
            <span>Bajo stock</span>
            <strong>{sparePartMetrics.lowStock}</strong>
            <p>Igual o debajo del mínimo</p>
          </article>
          <article className="danger">
            <span>Sin stock</span>
            <strong>{sparePartMetrics.emptyStock}</strong>
            <p>Requieren reposición</p>
          </article>
          <article>
            <span>Con código</span>
            <strong>{sparePartMetrics.withBarcode}</strong>
            <p>Listos para escaneo</p>
          </article>
        </div>

        <section className="spare-scan-panel">
          <div className="spare-scan-header">
            <div>
              <h3>Entrada / salida por escaneo</h3>
              <p>
                Haz clic en el campo y usa un lector físico, escribe el código,
                o abre la cámara para escanearlo.
              </p>
            </div>

            <div className="spare-scan-mode-tabs">
              {Object.entries(SPARE_PART_MOVEMENT_TYPES).map(([mode, config]) => (
                <button
                  key={mode}
                  type="button"
                  className={scanMode === mode ? "active" : ""}
                  onClick={() => {
                    setScanMode(mode);
                    setScanError("");
                  }}
                >
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          <form className="spare-scan-form" onSubmit={handleScanSubmit}>
            <label>
              Código de barras / código interno
              <input
                type="text"
                value={scanCode}
                onChange={(event) => setScanCode(event.target.value)}
                placeholder="Escanea o escribe el código..."
                disabled={savingSparePartMovement}
                autoComplete="off"
              />
            </label>

            <div className="spare-scan-actions">
              <button
                className="visual-primary-button"
                type="submit"
                disabled={savingSparePartMovement || !scanCode.trim()}
              >
                Buscar
              </button>
              <button
                className="visual-outline-button"
                type="button"
                onClick={() => openCameraScanner("scan")}
                disabled={savingSparePartMovement || cameraScannerOpen}
              >
                Abrir cámara
              </button>
            </div>
          </form>

          {scanError && <div className="form-error">{scanError}</div>}

          {selectedScannedPart && (
            <div className="spare-scan-result">
              <div className="spare-scan-part-card">
                <span className="spare-part-icon">▤</span>
                <div>
                  <strong>{selectedScannedPart.name || "Recambio sin nombre"}</strong>
                  <p>
                    {selectedScannedPart.category || "Sin categoría"} ·{" "}
                    {selectedScannedPart.partType || "Sin tipo"}
                  </p>
                  <small>
                    Código:{" "}
                    {selectedScannedPart.barcode ||
                      selectedScannedPart.internalCode ||
                      "Sin código"}
                  </small>
                </div>
                <b>
                  {Number(selectedScannedPart.quantity || 0)}{" "}
                  {selectedScannedPart.unit || "pieza"}
                </b>
              </div>

              <form
                className="spare-movement-form"
                onSubmit={handleSparePartMovementSubmit}
              >
                <div className="spare-movement-current">
                  <span>{SPARE_PART_MOVEMENT_TYPES[scanMode].help}</span>
                  <strong>
                    Existencia actual: {Number(selectedScannedPart.quantity || 0)}{" "}
                    {selectedScannedPart.unit || "pieza"}
                  </strong>
                </div>

                {scanMode === "adjustment" ? (
                  <label>
                    Existencia final
                    <input
                      type="number"
                      min="0"
                      name="finalQuantity"
                      value={sparePartMovementForm.finalQuantity}
                      onChange={handleSparePartMovementFormChange}
                      disabled={savingSparePartMovement}
                    />
                  </label>
                ) : (
                  <label>
                    Cantidad
                    <input
                      type="number"
                      min="1"
                      name="quantity"
                      value={sparePartMovementForm.quantity}
                      onChange={handleSparePartMovementFormChange}
                      disabled={savingSparePartMovement}
                    />
                  </label>
                )}

                <label>
                  Motivo
                  <input
                    type="text"
                    name="reason"
                    value={sparePartMovementForm.reason}
                    onChange={handleSparePartMovementFormChange}
                    placeholder={
                      scanMode === "entry"
                        ? "Compra, reposición, devolución..."
                        : scanMode === "exit"
                        ? "Uso en mantenimiento, instalación, préstamo..."
                        : "Conteo físico, corrección, merma..."
                    }
                    disabled={savingSparePartMovement}
                  />
                </label>

                <label className="technical-form-full">
                  Notas
                  <textarea
                    name="notes"
                    value={sparePartMovementForm.notes}
                    onChange={handleSparePartMovementFormChange}
                    rows="2"
                    placeholder="Detalles adicionales del movimiento."
                    disabled={savingSparePartMovement}
                  />
                </label>

                <div className="spare-movement-actions">
                  <button
                    type="button"
                    onClick={clearScannedPart}
                    disabled={savingSparePartMovement}
                  >
                    Limpiar
                  </button>
                  <button
                    className="visual-primary-button"
                    type="submit"
                    disabled={savingSparePartMovement}
                  >
                    {savingSparePartMovement
                      ? "Guardando..."
                      : `Registrar ${SPARE_PART_MOVEMENT_TYPES[scanMode].label.toLowerCase()}`}
                  </button>
                </div>
              </form>

              <div className="spare-mini-history">
                <div className="spare-mini-history-header">
                  <strong>Últimos movimientos</strong>
                  <button
                    type="button"
                    onClick={() => openSparePartHistory(selectedScannedPart)}
                  >
                    Ver historial completo
                  </button>
                </div>

                {loadingSparePartMovements ? (
                  <p>Cargando historial...</p>
                ) : selectedScannedPartMovements.length > 0 ? (
                  selectedScannedPartMovements.slice(0, 3).map((movement) => (
                    <article key={movement.id}>
                      <span className={`spare-movement-type ${movement.type}`}>
                        {formatSpareMovementType(movement.type)}
                      </span>
                      <div>
                        <strong>
                          {formatSpareMovementQuantity(movement)}
                        </strong>
                        <p>{movement.reason || "Sin motivo registrado"}</p>
                      </div>
                      <small>{formatLogDate(movement.createdAt)}</small>
                    </article>
                  ))
                ) : (
                  <p>Este recambio todavía no tiene movimientos registrados.</p>
                )}
              </div>
            </div>
          )}
        </section>

        {showSparePartForm && (
          <section className="spare-part-form-panel">
            <div className="technical-panel-header">
              <div>
                <h3>
                  {editingSparePartId ? "Editar recambio" : "Registrar recambio"}
                </h3>
                <p>
                  Agrega código de barras si el producto ya lo trae, o un código
                  interno si vas a etiquetarlo tú.
                </p>
              </div>

              <button
                className="visual-outline-button"
                type="button"
                onClick={closeSparePartForm}
                disabled={savingSparePart}
              >
                Cerrar
              </button>
            </div>

            {sparePartFormError && (
              <div className="form-error">{sparePartFormError}</div>
            )}

            <form className="technical-form" onSubmit={handleSparePartSubmit}>
              <div className="technical-form-grid">
                <label>
                  Nombre del recambio
                  <input
                    type="text"
                    name="name"
                    value={sparePartForm.name}
                    onChange={handleSparePartFormChange}
                    placeholder="Ej. Tinta Epson 544 negra"
                    disabled={savingSparePart}
                  />
                </label>

                <label>
                  Código de barras
                  <div className="technical-inline-input-action">
                    <input
                      type="text"
                      name="barcode"
                      value={sparePartForm.barcode}
                      onChange={handleSparePartFormChange}
                      placeholder="Escanea o escribe el código del producto"
                      disabled={savingSparePart}
                    />
                    <button
                      type="button"
                      onClick={() => openCameraScanner("formBarcode")}
                      disabled={savingSparePart || cameraScannerOpen}
                    >
                      Cámara
                    </button>
                  </div>
                </label>

                <label>
                  Código interno automático
                  <input
                    type="text"
                    name="internalCode"
                    value={sparePartForm.internalCode}
                    readOnly
                    placeholder="Se generará automáticamente"
                    disabled={savingSparePart}
                  />
                  <small className="field-helper-text">
                    El sistema genera este código. Úsalo para imprimir etiquetas internas cuando el producto no traiga código de barras.
                  </small>
                </label>

                <label>
                  Categoría
                  <select
                    name="category"
                    value={sparePartForm.category}
                    onChange={handleSparePartFormChange}
                    disabled={savingSparePart}
                  >
                    {sparePartCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                {sparePartForm.category === "Otro" && (
                  <label>
                    Otra categoría
                    <input
                      type="text"
                      name="categoryOther"
                      value={sparePartForm.categoryOther}
                      onChange={handleSparePartFormChange}
                      placeholder="Escribe la nueva categoría"
                      disabled={savingSparePart}
                    />
                  </label>
                )}

                <label>
                  Tipo
                  <select
                    name="partType"
                    value={sparePartForm.partType}
                    onChange={handleSparePartFormChange}
                    disabled={savingSparePart}
                  >
                    {sparePartTypeOptions.map((partType) => (
                      <option key={partType} value={partType}>
                        {partType}
                      </option>
                    ))}
                  </select>
                </label>

                {sparePartForm.partType === "Otro" && (
                  <label>
                    Otro tipo
                    <input
                      type="text"
                      name="partTypeOther"
                      value={sparePartForm.partTypeOther}
                      onChange={handleSparePartFormChange}
                      placeholder="Escribe el nuevo tipo"
                      disabled={savingSparePart}
                    />
                  </label>
                )}

                <label>
                  Marca
                  <input
                    type="text"
                    name="brand"
                    value={sparePartForm.brand}
                    onChange={handleSparePartFormChange}
                    placeholder="Ej. Epson, Brother, Kingston"
                    disabled={savingSparePart}
                  />
                </label>

                <label>
                  Modelo
                  <input
                    type="text"
                    name="model"
                    value={sparePartForm.model}
                    onChange={handleSparePartFormChange}
                    placeholder="Ej. 544 Black, TN-750, DDR4"
                    disabled={savingSparePart}
                  />
                </label>

                <label>
                  Cantidad actual
                  <input
                    type="number"
                    min="0"
                    name="quantity"
                    value={sparePartForm.quantity}
                    onChange={handleSparePartFormChange}
                    disabled={savingSparePart}
                  />
                </label>

                <label>
                  Mínimo recomendado
                  <input
                    type="number"
                    min="0"
                    name="minQuantity"
                    value={sparePartForm.minQuantity}
                    onChange={handleSparePartFormChange}
                    disabled={savingSparePart}
                  />
                </label>

                <label>
                  Unidad
                  <select
                    name="unit"
                    value={sparePartForm.unit}
                    onChange={handleSparePartFormChange}
                    disabled={savingSparePart}
                  >
                    {sparePartUnitOptions.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </label>

                {sparePartForm.unit === "Otro" && (
                  <label>
                    Otra unidad
                    <input
                      type="text"
                      name="unitOther"
                      value={sparePartForm.unitOther}
                      onChange={handleSparePartFormChange}
                      placeholder="Ej. litro, caja, bolsa"
                      disabled={savingSparePart}
                    />
                  </label>
                )}

                <label>
                  Ubicación de resguardo
                  <input
                    type="text"
                    name="storageLocation"
                    value={sparePartForm.storageLocation}
                    onChange={handleSparePartFormChange}
                    placeholder="Ej. Gabinete soporte técnico"
                    disabled={savingSparePart}
                  />
                </label>

                <label className="technical-form-full">
                  Compatible con
                  <textarea
                    name="compatibleModels"
                    value={sparePartForm.compatibleModels}
                    onChange={handleSparePartFormChange}
                    rows="3"
                    placeholder="Una línea por modelo o separados por coma. Ej. Epson L3110, Epson L3150"
                    disabled={savingSparePart}
                  />
                </label>

                <label className="technical-form-full">
                  Notas
                  <textarea
                    name="notes"
                    value={sparePartForm.notes}
                    onChange={handleSparePartFormChange}
                    rows="3"
                    placeholder="Observaciones, equivalencias, cuidados o detalles de compra."
                    disabled={savingSparePart}
                  />
                </label>
              </div>

              <div className="technical-form-actions">
                <button
                  type="button"
                  onClick={closeSparePartForm}
                  disabled={savingSparePart}
                >
                  Cancelar
                </button>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={savingSparePart}
                >
                  {savingSparePart
                    ? "Guardando..."
                    : editingSparePartId
                    ? "Guardar cambios"
                    : "Registrar recambio"}
                </button>
              </div>
            </form>
          </section>
        )}

        <section className="spare-parts-list-panel">
          <div className="spare-parts-toolbar">
            <label className="visual-search spare-search">
              <span>⌕</span>
              <input
                type="text"
                value={sparePartSearchTerm}
                onChange={(event) => setSparePartSearchTerm(event.target.value)}
                placeholder="Buscar por nombre, código, marca, modelo..."
              />
            </label>

            <select
              value={sparePartCategoryFilter}
              onChange={(event) => setSparePartCategoryFilter(event.target.value)}
              disabled={loadingSpareParts}
            >
              <option value="Todas">Todas las categorías</option>
              {sparePartCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            <select
              value={sparePartTypeFilter}
              onChange={(event) => setSparePartTypeFilter(event.target.value)}
              disabled={loadingSpareParts}
            >
              <option value="Todos">Todos los tipos</option>
              {sparePartTypeOptions.map((partType) => (
                <option key={partType} value={partType}>
                  {partType}
                </option>
              ))}
            </select>

            <select
              value={sparePartStockFilter}
              onChange={(event) => setSparePartStockFilter(event.target.value)}
              disabled={loadingSpareParts}
            >
              {SPARE_PART_STOCK_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </div>

          {loadingSpareParts ? (
            <div className="empty-state">
              <h3>Cargando recambios...</h3>
              <p>Estamos consultando el inventario de piezas.</p>
            </div>
          ) : filteredSpareParts.length > 0 ? (
            <div className="spare-parts-grid">
              {filteredSpareParts.map((part) => {
                const quantity = Number(part.quantity || 0);
                const minQuantity = Number(part.minQuantity || 0);
                const isInactive = part.active === false || part.status === "inactive";
                const stockClass =
                  quantity <= 0
                    ? "empty"
                    : minQuantity > 0 && quantity <= minQuantity
                    ? "low"
                    : "ok";

                return (
                  <article
                    className={`spare-part-card ${isInactive ? "inactive" : ""}`}
                    key={part.id}
                  >
                    <div className="spare-part-card-top">
                      <span className="spare-part-icon">▤</span>
                      <div>
                        <strong>{part.name || "Recambio sin nombre"}</strong>
                        <p>
                          {part.category || "Sin categoría"} ·{" "}
                          {part.partType || "Sin tipo"}
                        </p>
                      </div>
                      <span className={`spare-stock-badge ${stockClass}`}>
                        {quantity <= 0
                          ? "Sin stock"
                          : stockClass === "low"
                          ? "Bajo stock"
                          : "Stock OK"}
                      </span>
                    </div>

                    <div className="spare-part-card-details">
                      <p>
                        <strong>Código:</strong>{" "}
                        {part.barcode || part.internalCode || "Sin código"}
                      </p>
                      <p>
                        <strong>Marca / modelo:</strong>{" "}
                        {[part.brand, part.model].filter(Boolean).join(" · ") ||
                          "Sin datos"}
                      </p>
                      <p>
                        <strong>Compatible con:</strong>{" "}
                        {formatCompatibleModels(part.compatibleModels)}
                      </p>
                      <p>
                        <strong>Ubicación:</strong>{" "}
                        {part.storageLocation || "Sin ubicación"}
                      </p>
                    </div>

                    <div className="spare-part-stock-row">
                      <div>
                        <span>Disponible</span>
                        <strong>
                          {quantity} {part.unit || "pieza"}
                        </strong>
                      </div>
                      <div>
                        <span>Mínimo</span>
                        <strong>
                          {minQuantity} {part.unit || "pieza"}
                        </strong>
                      </div>
                    </div>

                    <div className="spare-part-actions">
                      <button type="button" onClick={() => openSparePartForm(part)}>
                        Editar
                      </button>
                      <button type="button" onClick={() => openSparePartHistory(part)}>
                        Historial
                      </button>
                      {isInactive ? (
                        <button
                          type="button"
                          className="restore-table-button"
                          onClick={() => handleRestoreSparePart(part)}
                        >
                          Reactivar
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="danger-table-button"
                          onClick={() => handleDeactivateSparePart(part)}
                        >
                          Desactivar
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <h3>No se encontraron recambios</h3>
              <p>
                Registra el primer recambio o ajusta los filtros de búsqueda.
              </p>
            </div>
          )}
        </section>

        {selectedSparePartHistory && (
          <section className="spare-history-panel">
            <div className="technical-panel-header">
              <div>
                <h3>Historial de {selectedSparePartHistory.name}</h3>
                <p>
                  Entradas, salidas y ajustes registrados para este recambio.
                </p>
              </div>

              <button
                className="visual-outline-button"
                type="button"
                onClick={closeSparePartHistory}
              >
                Cerrar historial
              </button>
            </div>

            {loadingSparePartMovements ? (
              <div className="empty-state small">
                <h3>Cargando movimientos...</h3>
                <p>Estamos consultando la bitácora del recambio.</p>
              </div>
            ) : (
              <div className="spare-history-list">
                {sparePartMovements
                  .filter((movement) => movement.partId === selectedSparePartHistory.id)
                  .map((movement) => (
                    <article key={movement.id}>
                      <span className={`spare-movement-type ${movement.type}`}>
                        {formatSpareMovementType(movement.type)}
                      </span>
                      <div>
                        <strong>{formatSpareMovementQuantity(movement)}</strong>
                        <p>{movement.reason || "Sin motivo registrado"}</p>
                        {movement.notes && <small>{movement.notes}</small>}
                      </div>
                      <aside>
                        <strong>
                          {Number(movement.previousQuantity || 0)} →{" "}
                          {Number(movement.newQuantity || 0)}
                        </strong>
                        <small>{formatLogDate(movement.createdAt)}</small>
                        <small>{movement.createdBy || "Sin responsable"}</small>
                      </aside>
                    </article>
                  ))}

                {sparePartMovements.filter(
                  (movement) => movement.partId === selectedSparePartHistory.id
                ).length === 0 && (
                  <div className="empty-state small">
                    <h3>Sin movimientos</h3>
                    <p>Este recambio todavía no tiene historial.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {cameraScannerOpen && (
          <div className="modal-backdrop">
            <section className="camera-scanner-card">
              <div className="camera-scanner-header">
                <div>
                  <h3>Escanear código de barras</h3>
                  <p>
                    {cameraScannerTarget === "formBarcode"
                      ? "Apunta al código del producto para guardarlo en el recambio."
                      : "Apunta al código para localizar el recambio y registrar el movimiento."}
                  </p>
                </div>
                <button type="button" onClick={closeCameraScanner}>
                  ×
                </button>
              </div>

              <div className={`camera-scanner-video-wrap ${cameraScannerEngine === "html5" ? "html5" : "native"}`}>
                <video
                  ref={cameraVideoRef}
                  className="camera-scanner-video"
                  muted
                  playsInline
                  autoPlay
                />
                <div
                  id="technical-spare-parts-camera-reader"
                  ref={cameraReaderRef}
                  className="camera-scanner-html5-reader"
                />
                <div className="camera-scanner-frame" aria-hidden="true" />
              </div>

              {cameraScannerStatus && (
                <p className="camera-scanner-status">{cameraScannerStatus}</p>
              )}

              {cameraScannerError && (
                <div className="form-error">{cameraScannerError}</div>
              )}

              <div className="camera-scanner-actions">
                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={closeCameraScanner}
                >
                  Cancelar
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    );
  }

  function renderFieldModePanel() {
    if (!selectedQuickAsset) return null;

    return (
      <main className="field-mode-shell">
        <section className="field-mode-hero">
          <div className="field-mode-topline">
            <span className="field-mode-kicker">Modo técnico en campo</span>
            <button
              type="button"
              className="field-mode-close-button"
              onClick={exitFieldModeForAction}
            >
              Ver panel completo
            </button>
          </div>

          <div className="field-mode-asset-title">
            <span className="field-mode-code">
              {selectedQuickAsset.assetTag || "Sin código"}
            </span>
            <h1>{selectedQuickAsset.name || "Equipo sin nombre"}</h1>
            <p>{selectedQuickAsset.category || "Sin categoría"}</p>
          </div>

          <div className="field-mode-status-row">
            <span className={`field-mode-status ${String(selectedQuickAsset.status || "")
              .toLowerCase()
              .replaceAll(" ", "-")}`}>
              {selectedQuickAsset.status || "Sin estatus"}
            </span>
            <span className="field-mode-condition">
              Condición: {selectedQuickAsset.condition || "Sin condición"}
            </span>
          </div>
        </section>

        <section className="field-mode-location-card">
          <h2>Ubicación</h2>
          <div className="field-mode-location-grid">
            <article>
              <span>Plantel</span>
              <strong>{normalizeCampusName(selectedQuickAsset.campus)}</strong>
            </article>
            <article>
              <span>Área</span>
              <strong>{selectedQuickAsset.area || "Sin área"}</strong>
            </article>
            <article>
              <span>Ubicación específica</span>
              <strong>{selectedQuickAsset.assignedTo || "Sin ubicación específica"}</strong>
            </article>
            <article>
              <span>Serie</span>
              <strong>{selectedQuickAsset.serialNumber || "Sin número de serie"}</strong>
            </article>
          </div>
        </section>

        <section className="field-mode-actions-card">
          <button
            className="field-mode-primary-action"
            type="button"
            onClick={() => startQuickMaintenance(selectedQuickAsset)}
          >
            <span>🛠</span>
            {selectedQuickNextMaintenance ? "Iniciar mantenimiento" : "Programar mantenimiento"}
          </button>

          <div className="field-mode-secondary-actions">
            <button type="button" onClick={() => openQuickMovementAction(selectedQuickAsset)}>
              <span>↔</span>
              Movimiento
            </button>
            <button type="button" onClick={() => openQuickHistoryAction(selectedQuickAsset)}>
              <span>☰</span>
              Historial
            </button>
            <button type="button" onClick={() => openQuickQrAction(selectedQuickAsset)}>
              <span>▦</span>
              QR
            </button>
          </div>
        </section>

        <section className="field-mode-maintenance-card">
          <div className="field-mode-section-header">
            <div>
              <h2>Mantenimientos pendientes</h2>
              <p>Los trabajos más próximos para este equipo.</p>
            </div>
            <strong>{selectedQuickPendingMaintenances.length}</strong>
          </div>

          {selectedQuickPendingMaintenances.length > 0 ? (
            <div className="field-mode-maintenance-list">
              {selectedQuickPendingMaintenances.slice(0, 2).map((maintenance) => {
                const urgency = getMaintenanceUrgency(maintenance.nextDate);

                return (
                  <article
                    className={`field-mode-maintenance-item urgency-${urgency.level}`}
                    key={maintenance.id}
                  >
                    <div>
                      <span>{urgency.icon}</span>
                      <strong>{maintenance.title}</strong>
                      <p>{urgency.label} · {formatMaintenanceDate(maintenance.nextDate)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        exitFieldModeForAction();
                        openCompletionForm(maintenance, { keepQuickAsset: true, asset: selectedQuickAsset });
                        setActiveTab("field-action");
                      }}
                    >
                      Iniciar
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="field-mode-empty-card">
              <strong>Sin mantenimientos pendientes</strong>
              <p>Este equipo no tiene revisiones programadas por ahora.</p>
            </div>
          )}
        </section>

        <section className="field-mode-history-card">
          <div className="field-mode-section-header">
            <div>
              <h2>Últimos movimientos</h2>
              <p>Resumen rápido del historial.</p>
            </div>
          </div>

          {loadingQuickLogs ? (
            <div className="field-mode-empty-card">
              <strong>Cargando historial...</strong>
              <p>Consultando movimientos recientes.</p>
            </div>
          ) : selectedQuickLogs.length > 0 ? (
            <div className="field-mode-history-list">
              {selectedQuickLogs.map((log) => (
                <article key={log.id}>
                  <span>{getMovementIcon(log.type)}</span>
                  <div>
                    <strong>{log.title || "Movimiento registrado"}</strong>
                    <p>{formatLogDate(log.createdAt)}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="field-mode-empty-card">
              <strong>Sin historial reciente</strong>
              <p>Aún no hay movimientos registrados para este equipo.</p>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (fieldModeRequested) {
    return (
      <div className="technical-support-page field-mode-page">
        {pageError && <div className="form-error field-mode-error">{pageError}</div>}
        {fieldModeActive ? (
          renderFieldModePanel()
        ) : (
          <main className="field-mode-shell">
            <section className="field-mode-loading-card">
              <span>⌛</span>
              <h1>Cargando ficha técnica...</h1>
              <p>Estamos abriendo la información del equipo escaneado.</p>
            </section>
          </main>
        )}
      </div>
    );
  }

  return (
    <div
      className={`technical-support-page technical-support-redesign-v3 ${
        fieldActionModeActive ? "field-action-mode" : ""
      } ${focusedSupportViewActive ? "technical-focused-view" : ""}`}
    >
      <section className="technical-page-topbar">
        <div>
          <p className="section-kicker">Soporte Técnico</p>
          <h1>Soporte Técnico</h1>
          <span>Gestión de equipos y mantenimientos</span>
        </div>

        <label className="technical-global-search">
          <span>⌕</span>
          <input
            type="text"
            value={searchTerm}
            onChange={handleGlobalSearchChange}
            placeholder="Buscar equipos, códigos, ubicaciones..."
          />
        </label>
      </section>

      {pageError && <div className="form-error">{pageError}</div>}

      {focusedSupportViewActive && (
        <div className="technical-focused-helper">
          <span>Vista enfocada</span>
          <strong>Termina o regresa para volver al panel de Soporte Técnico.</strong>
        </div>
      )}

      {!focusedSupportViewActive && (
      <section className="technical-command-grid" aria-label="Indicadores principales de soporte técnico">
        <button
          className="technical-command-card danger"
          type="button"
          onClick={() => setActiveTab("mantenimientos")}
        >
          <span className="technical-command-icon">⚠</span>
          <div>
            <strong>{overdueMaintenances.length}</strong>
            <h3>Mantenimientos vencidos</h3>
            <p>Requieren atención inmediata.</p>
          </div>
          <b>Ver casos →</b>
        </button>

        <button
          className="technical-command-card warning"
          type="button"
          onClick={() => setActiveTab("mantenimientos")}
        >
          <span className="technical-command-icon">📅</span>
          <div>
            <strong>{weekMaintenances.length}</strong>
            <h3>Vencen esta semana</h3>
            <p>Trabajos próximos por atender.</p>
          </div>
          <b>Revisar agenda →</b>
        </button>

        <button
          className="technical-command-card info"
          type="button"
          onClick={() => setActiveTab("equipos")}
        >
          <span className="technical-command-icon">▣</span>
          <div>
            <strong>{totalAssets}</strong>
            <h3>Equipos registrados</h3>
            <p>Inventario técnico actual.</p>
          </div>
          <b>Ver inventario →</b>
        </button>

        <button
          className="technical-command-card success"
          type="button"
          onClick={() => setActiveTab("mantenimientos")}
        >
          <span className="technical-command-icon">🔧</span>
          <div>
            <strong>{upcomingMaintenances.length}</strong>
            <h3>Mantenimientos próximos</h3>
            <p>Próximas revisiones programadas.</p>
          </div>
          <b>Ver calendario →</b>
        </button>


        <button
          className="technical-command-card info"
          type="button"
          onClick={() => setActiveTab("mantenimientos")}
        >
          <span className="technical-command-icon">⌖</span>
          <div>
            <strong>{pendingLocationReviews.length}</strong>
            <h3>Revisiones de ubicación</h3>
            <p>Checklist técnico periódico por ubicación.</p>
          </div>
          <b>Revisar ubicaciones →</b>
        </button>
      </section>
      )}

      {!focusedSupportViewActive && (
      <nav className="technical-tabs" aria-label="Navegación de Soporte Técnico">
        {TECHNICAL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => handleTechnicalTabChange(tab.id)}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>
      )}

      {selectedQrAsset && (
        <section className="technical-panel technical-qr-label-panel technical-focused-panel">
          <div className="technical-panel-header">
            <div>
              <h2>Etiqueta QR del equipo</h2>
              <p>
                Imprime esta etiqueta y pégala en el equipo físico. Al escanearla,
                se abrirá la ficha del equipo en el sistema.
              </p>
            </div>

            <div className="technical-form-actions">
              <button
                className="visual-primary-button"
                type="button"
                onClick={printQrLabel}
              >
                Imprimir solo esta etiqueta
              </button>

              <button
                className="visual-outline-button"
                type="button"
                onClick={printAllQrLabels}
              >
                Imprimir todas
              </button>

              <button
                className="visual-outline-button"
                type="button"
                onClick={closeQrPanel}
              >
                Cerrar
              </button>
            </div>
          </div>

          <div className="technical-qr-layout">
            <div className="technical-qr-print-area">
{renderQrLabel(selectedQrAsset)}
            </div>

            <aside className="technical-qr-help-card">
              <div className="asset-auto-preview-icon">QR</div>
              <h3>¿Qué abrirá este código?</h3>
              <p>
                El QR apunta a la ficha del equipo dentro del sistema. Si el técnico
                no ha iniciado sesión, primero verá el login y después podrá acceder
                a la información del equipo.
              </p>

              <div className="asset-generated-row">
                <span>URL del QR</span>
                <strong>{getAssetQrValue(selectedQrAsset)}</strong>
              </div>

              <div className="asset-generated-note">
                <strong>Siguiente mejora recomendada</strong>
                <span>
                  Al escanear el QR se abrirá la ficha rápida del equipo para
                  consultar datos, historial e iniciar mantenimiento.
                </span>
              </div>
            </aside>
          </div>
        </section>
      )}


      <div className="technical-qr-batch-print-area" aria-hidden="true">
        {visibleAssets.map((asset) => (
          <div className="technical-qr-batch-item" key={`qr-print-${asset.id}`}>
            {renderQrLabel(asset)}
          </div>
        ))}
      </div>

      {selectedQuickAsset && !focusedSubActionActive && (
        <section className="technical-panel technical-quick-asset-panel technical-focused-panel">
          <div className="technical-quick-asset-hero">
            <div className="technical-quick-asset-icon">▣</div>

            <div className="technical-quick-asset-title">
              <span className="asset-tag">
                {selectedQuickAsset.assetTag || "Sin código"}
              </span>
              <h2>{selectedQuickAsset.name || "Equipo sin nombre"}</h2>
              <p>
                {selectedQuickAsset.category || "Sin categoría"} ·{" "}
                {normalizeCampusName(selectedQuickAsset.campus)} ·{" "}
                {selectedQuickAsset.assignedTo ||
                  selectedQuickAsset.area ||
                  "Sin ubicación específica"}
              </p>
            </div>

            <button
              className="visual-outline-button"
              type="button"
              onClick={closeQuickAssetPanel}
            >
              Regresar
            </button>
          </div>

          <div className="technical-quick-layout">
            <div className="technical-quick-main">
              <div className="technical-quick-info-grid">
                <article>
                  <span>Plantel</span>
                  <strong>{normalizeCampusName(selectedQuickAsset.campus)}</strong>
                </article>

                <article>
                  <span>Área / ubicación</span>
                  <strong>{selectedQuickAsset.area || "Sin área"}</strong>
                </article>

                <article>
                  <span>Ubicación específica</span>
                  <strong>
                    {selectedQuickAsset.assignedTo || "Sin ubicación específica"}
                  </strong>
                </article>

                <article>
                  <span>Ubicación técnica</span>
                  <strong>
                    {selectedQuickAsset.technicalLocationName || "Sin ubicación técnica"}
                  </strong>
                </article>

                <article>
                  <span>Estatus</span>
                  <strong>{selectedQuickAsset.status || "Sin estatus"}</strong>
                </article>

                <article>
                  <span>Condición</span>
                  <strong>{selectedQuickAsset.condition || "Sin condición"}</strong>
                </article>

                <article>
                  <span>Serie</span>
                  <strong>
                    {selectedQuickAsset.serialNumber || "Sin número de serie"}
                  </strong>
                </article>
              </div>

              <div className="technical-quick-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => startQuickMaintenance(selectedQuickAsset)}
                >
                  {selectedQuickNextMaintenance
                    ? "Iniciar mantenimiento"
                    : "Programar mantenimiento"}
                </button>

                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={() => openEditForm(selectedQuickAsset)}
                >
                  Editar equipo
                </button>

                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={() => openQuickMovementAction(selectedQuickAsset)}
                >
                  Registrar movimiento
                </button>

                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={() => openQuickHistoryAction(selectedQuickAsset)}
                >
                  Ver historial
                </button>

                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={() => openQuickQrAction(selectedQuickAsset)}
                >
                  Imprimir etiqueta QR
                </button>
              </div>
            </div>

            <aside className="technical-quick-maintenance-card">
              <div className="technical-panel-header compact">
                <div>
                  <h3>Mantenimientos pendientes</h3>
                  <p>Trabajos vinculados a este equipo.</p>
                </div>
                <strong>{selectedQuickPendingMaintenances.length}</strong>
              </div>

              {selectedQuickPendingMaintenances.length > 0 ? (
                <div className="technical-quick-maintenance-list">
                  {selectedQuickPendingMaintenances.slice(0, 3).map((maintenance) => {
                    const urgency = getMaintenanceUrgency(maintenance.nextDate);

                    return (
                      <article
                        className={`technical-quick-maintenance-item urgency-${urgency.level}`}
                        key={maintenance.id}
                      >
                        <span>{urgency.icon}</span>
                        <div>
                          <strong>{maintenance.title}</strong>
                          <p>{urgency.label}</p>
                          <small>{formatMaintenanceDate(maintenance.nextDate)}</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            closeQuickAssetPanel();
                            openCompletionForm(maintenance);
                          }}
                        >
                          Iniciar
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state small">
                  <h3>Sin mantenimientos pendientes</h3>
                  <p>Programa una revisión para este equipo.</p>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}


      {showLocationReviewForm && selectedTechnicalLocation && (
        <section className="technical-panel technical-focused-panel location-review-focused-panel-v2">
          <div className="location-review-hero-v2">
            <div className="location-review-hero-icon-v2">
              {getLocationTypeIcon(selectedTechnicalLocation.type)}
            </div>

            <div className="location-review-hero-content-v2">
              <p className="section-kicker equipment-kicker">Revisión técnica de ubicación</p>
              <h2>{selectedTechnicalLocation.name}</h2>
              <span>
                {normalizeCampusName(selectedTechnicalLocation.campus)} · {selectedTechnicalLocation.area || "Sin área"} · {selectedTechnicalLocation.type || "Ubicación técnica"}
              </span>
            </div>

            <button
              className="visual-outline-button"
              type="button"
              onClick={closeLocationReviewForm}
              disabled={savingLocationReview}
            >
              ← Regresar
            </button>
          </div>

          {locationReviewError && (
            <div className="form-error">{locationReviewError}</div>
          )}

          <form className="location-review-form-v2" onSubmit={handleSaveLocationReview}>
            <div className="location-review-summary-v2">
              <article>
                <span>Elementos</span>
                <strong>{locationReviewItems.length}</strong>
                <small>puntos del checklist</small>
              </article>

              <article>
                <span>Presentes</span>
                <strong>
                  {locationReviewItems.filter((item) => Boolean(item.present)).length}
                </strong>
                <small>marcados como presentes</small>
              </article>

              <label className="location-review-status-card-v2">
                <span>Resultado general</span>
                <select
                  name="generalStatus"
                  value={locationReviewForm.generalStatus}
                  onChange={handleLocationReviewFormChange}
                  disabled={savingLocationReview}
                >
                  <option value="Correcto">Correcto</option>
                  <option value="Requiere atención">Requiere atención</option>
                  <option value="Pendiente">Pendiente</option>
                </select>
              </label>
            </div>

            <div className="location-review-checklist-v2">
              {locationReviewItems.map((item, index) => (
                <article
                  className={`location-review-card-v2 ${item.present ? "present" : "missing"}`}
                  key={`focused-location-review-${index}`}
                >
                  <div className="location-review-card-top-v2">
                    <span>{index + 1}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.required ? "Obligatorio" : "Opcional"}</small>
                    </div>
                  </div>

                  <div className="location-review-card-controls-v2">
                    <label className="location-present-toggle-v2">
                      <input
                        type="checkbox"
                        checked={Boolean(item.present)}
                        onChange={(event) =>
                          handleLocationReviewItemChange(
                            index,
                            "present",
                            event.target.checked
                          )
                        }
                        disabled={savingLocationReview}
                      />
                      <span>{item.present ? "Presente" : "No presente"}</span>
                    </label>

                    <select
                      value={item.status}
                      onChange={(event) =>
                        handleLocationReviewItemChange(
                          index,
                          "status",
                          event.target.value
                        )
                      }
                      disabled={savingLocationReview || !item.present}
                    >
                      {LOCATION_REVIEW_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>

                  <textarea
                    value={item.note}
                    onChange={(event) =>
                      handleLocationReviewItemChange(index, "note", event.target.value)
                    }
                    placeholder={
                      item.present
                        ? "Observación opcional sobre este elemento..."
                        : "Explica qué falta o qué se encontró..."
                    }
                    disabled={savingLocationReview}
                  />
                </article>
              ))}
            </div>

            <div className="location-review-notes-v2">
              <label>
                <span>Observaciones generales</span>
                <textarea
                  name="observations"
                  value={locationReviewForm.observations}
                  onChange={handleLocationReviewFormChange}
                  placeholder="Ej. Mouse con falla en clic izquierdo."
                  disabled={savingLocationReview}
                />
              </label>

              <label>
                <span>Acciones pendientes</span>
                <textarea
                  name="pendingActions"
                  value={locationReviewForm.pendingActions}
                  onChange={handleLocationReviewFormChange}
                  placeholder="Ej. Reponer lámpara 2 y cambiar mouse."
                  disabled={savingLocationReview}
                />
              </label>
            </div>

            <div className="technical-form-actions location-review-actions-v2">
              <button
                type="button"
                onClick={closeLocationReviewForm}
                disabled={savingLocationReview}
              >
                Regresar
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={savingLocationReview}
              >
                {savingLocationReview
                  ? "Guardando revisión..."
                  : "Guardar revisión técnica"}
              </button>
            </div>
          </form>
        </section>
      )}

      {!focusedSupportViewActive && activeTab === "resumen" && (
        <section className="technical-overview-layout">
          <div className="technical-overview-main">
            <section className="technical-panel technical-compact-panel">
              <div className="technical-panel-header compact">
                <div>
                  <h2>Mantenimientos recientes</h2>
                  <p>Los casos que Soporte Técnico debe atender primero.</p>
                </div>
                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={() => setActiveTab("mantenimientos")}
                >
                  Ver todo
                </button>
              </div>

              {recentMaintenances.length > 0 ? (
                <div className="technical-mini-list">
                  {recentMaintenances.map((maintenance) => {
                    const urgency = getMaintenanceUrgency(maintenance.nextDate);

                    return (
                      <article
                        className={`technical-mini-item urgency-${urgency.level}`}
                        key={maintenance.id}
                      >
                        <span className="technical-mini-icon">{urgency.icon}</span>
                        <div>
                          <strong>{maintenance.title}</strong>
                          <p>
                            {maintenance.assetName || "Equipo sin nombre"} · {maintenance.assetTag}
                          </p>
                        </div>
                        <div className="technical-mini-date">
                          <b>{urgency.label}</b>
                          <small>{formatMaintenanceDate(maintenance.nextDate)}</small>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state small">
                  <h3>Sin mantenimientos pendientes</h3>
                  <p>Cuando haya trabajos programados aparecerán aquí.</p>
                </div>
              )}
            </section>

            <section className="technical-panel technical-compact-panel">
              <div className="technical-panel-header compact">
                <div>
                  <h2>Últimos equipos registrados</h2>
                  <p>Vista rápida del inventario sin saturar la pantalla.</p>
                </div>
                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={() => setActiveTab("equipos")}
                >
                  Ver inventario
                </button>
              </div>

              {recentAssets.length > 0 ? (
                <div className="technical-preview-table">
                  <div className="technical-preview-head">
                    <span>Código</span>
                    <span>Equipo</span>
                    <span>Ubicación</span>
                  </div>
                  {recentAssets.map((asset) => (
                    <div className="technical-preview-row" key={asset.id}>
                      <strong>{asset.assetTag || "Sin código"}</strong>
                      <span>{asset.name || "Sin nombre"}</span>
                      <span>{asset.assignedTo || asset.area || "Sin ubicación"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state small">
                  <h3>Sin equipos registrados</h3>
                  <p>Registra el primer equipo para iniciar el inventario.</p>
                </div>
              )}
            </section>
          </div>

          <aside className="technical-overview-side">
            <section className="technical-panel technical-calendar-panel">
              <div className="technical-panel-header compact">
                <div>
                  <h2>Calendario de mantenimientos</h2>
                  <p>Próximos trabajos que Soporte Técnico debe atender.</p>
                </div>
                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={() => setActiveTab("mantenimientos")}
                >
                  Ver calendario
                </button>
              </div>

              {calendarMaintenances.length > 0 ? (
                <div className="technical-calendar-list">
                  {calendarMaintenances.map((maintenance) => {
                    const urgency = getMaintenanceUrgency(maintenance.nextDate);

                    return (
                      <article
                        className={`technical-calendar-card urgency-${urgency.level}`}
                        key={maintenance.id}
                      >
                        <span className="technical-calendar-icon">{urgency.icon}</span>
                        <div>
                          <strong>{maintenance.assetName || maintenance.title}</strong>
                          <p>{maintenance.assetTag || "Sin código"}</p>
                          <small>{maintenance.title}</small>
                        </div>
                        <div className="technical-calendar-date">
                          <b>{urgency.label}</b>
                          <span>{formatMaintenanceDate(maintenance.nextDate)}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state small">
                  <h3>Sin mantenimientos próximos</h3>
                  <p>Cuando haya revisiones programadas aparecerán aquí.</p>
                </div>
              )}

              <button
                className="technical-calendar-footer"
                type="button"
                onClick={() => setActiveTab("mantenimientos")}
              >
                Ver todos los mantenimientos →
              </button>
            </section>
          </aside>
        </section>
      )}

      {selectedMaintenanceAsset && (
        <section className="technical-panel technical-focused-panel">
          <div className="technical-panel-header">
            <div>
              <h2>Programar mantenimiento</h2>
              <p>
                {selectedMaintenanceAsset.assetTag} ·{" "}
                {selectedMaintenanceAsset.name}
              </p>
            </div>

            <button
              className="visual-outline-button"
              type="button"
              onClick={closeMaintenanceForm}
              disabled={savingMaintenance}
            >
              Cerrar
            </button>
          </div>

          {maintenanceFormError && (
            <div className="form-error">{maintenanceFormError}</div>
          )}

          <form className="technical-form" onSubmit={handleMaintenanceSubmit}>
            <div className="technical-form-grid">
              <label>
                Título del mantenimiento
                <input
                  type="text"
                  name="title"
                  value={maintenanceForm.title}
                  onChange={handleMaintenanceChange}
                  placeholder="Ej. Limpieza preventiva"
                  disabled={savingMaintenance}
                />
              </label>

              <label>
                Frecuencia
                <select
                  name="frequency"
                  value={maintenanceForm.frequency}
                  onChange={handleMaintenanceChange}
                  disabled={savingMaintenance}
                >
                  {MAINTENANCE_FREQUENCIES.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {frequency}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Fecha programada
                <input
                  type="date"
                  name="nextDate"
                  value={maintenanceForm.nextDate}
                  onChange={handleMaintenanceChange}
                  disabled={savingMaintenance}
                />
              </label>

              <label>
                Responsable
                <input
                  type="text"
                  name="assignedTo"
                  value={maintenanceForm.assignedTo}
                  onChange={handleMaintenanceChange}
                  placeholder="Soporte Técnico"
                  disabled={savingMaintenance}
                />
              </label>

              <label>
                Estatus
                <select
                  name="status"
                  value={maintenanceForm.status}
                  onChange={handleMaintenanceChange}
                  disabled={savingMaintenance}
                >
                  {MAINTENANCE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label className="technical-form-full">
                Descripción
                <textarea
                  name="description"
                  value={maintenanceForm.description}
                  onChange={handleMaintenanceChange}
                  placeholder="Describe qué se debe revisar, limpiar, actualizar o comprobar..."
                  rows="4"
                  disabled={savingMaintenance}
                />
              </label>
            </div>

            <section className="maintenance-template-editor-card">
              <div className="maintenance-template-editor-header">
                <div>
                  <h3>Checklist base del mantenimiento</h3>
                  <p>
                    Edita los puntos que se llenarán cuando se marque este mantenimiento como realizado.
                  </p>
                </div>

                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={resetMaintenanceChecklistToDefault}
                  disabled={savingMaintenance || !selectedMaintenanceAsset}
                >
                  Usar checklist predefinido
                </button>

                <button
                  type="button"
                  className="visual-outline-button"
                  onClick={addMaintenanceChecklistItem}
                  disabled={savingMaintenance}
                >
                  + Agregar punto
                </button>
              </div>

              {(maintenanceForm.checklistTemplate || []).length === 0 && (
                <div className="location-review-empty-card">
                  <strong>Checklist vacío</strong>
                  <p>Usa el checklist predefinido del equipo o agrega puntos manualmente.</p>
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={resetMaintenanceChecklistToDefault}
                    disabled={savingMaintenance || !selectedMaintenanceAsset}
                  >
                    Cargar checklist predefinido
                  </button>
                </div>
              )}

              <div className="maintenance-template-edit-list">
                {(maintenanceForm.checklistTemplate || []).map((item, index) => (
                  <article className="maintenance-template-edit-row" key={`maintenance-template-${index}`}>
                    <div className="checklist-order-controls">
                      <button
                        type="button"
                        onClick={() => moveMaintenanceChecklistItem(index, index - 1)}
                        disabled={savingMaintenance || index === 0}
                        title="Subir"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveMaintenanceChecklistItem(index, index + 1)}
                        disabled={
                          savingMaintenance ||
                          index === (maintenanceForm.checklistTemplate || []).length - 1
                        }
                        title="Bajar"
                      >
                        ↓
                      </button>
                    </div>

                    <label className="checklist-position-select">
                      Posición
                      <select
                        value={index}
                        onChange={(event) =>
                          moveMaintenanceChecklistItem(index, Number(event.target.value))
                        }
                        disabled={savingMaintenance}
                      >
                        {(maintenanceForm.checklistTemplate || []).map((_, positionIndex) => (
                          <option key={positionIndex} value={positionIndex}>
                            {positionIndex + 1}
                          </option>
                        ))}
                      </select>
                    </label>

                    <input
                      type="text"
                      value={item.label}
                      onChange={(event) =>
                        handleMaintenanceChecklistItemChange(index, "label", event.target.value)
                      }
                      placeholder="Nombre del punto a revisar"
                      disabled={savingMaintenance}
                    />

                    <button
                      type="button"
                      className="location-remove-button"
                      onClick={() => removeMaintenanceChecklistItem(index)}
                      disabled={
                        savingMaintenance ||
                        (maintenanceForm.checklistTemplate || []).length <= 1
                      }
                    >
                      Eliminar
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <div className="technical-form-actions">
              <button
                type="button"
                onClick={closeMaintenanceForm}
                disabled={savingMaintenance}
              >
                Cancelar
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={savingMaintenance}
              >
                {savingMaintenance ? "Guardando..." : "Guardar mantenimiento"}
              </button>
            </div>
          </form>
        </section>
      )}

      {selectedCompletionMaintenance && (
        <section className="technical-panel technical-focused-panel">
          <div className="technical-panel-header">
            <div>
              <h2>Iniciar mantenimiento</h2>
              <p>
                {selectedCompletionMaintenance.assetTag} ·{" "}
                {selectedCompletionMaintenance.assetName}
              </p>
            </div>

            <button
              className="visual-outline-button"
              type="button"
              onClick={closeCompletionForm}
              disabled={completingMaintenance}
            >
              Cerrar
            </button>
          </div>

          {completionError && <div className="form-error">{completionError}</div>}

          <form className="technical-form" onSubmit={handleCompletionSubmit}>
            <div className="technical-form-grid">
              <label>
                Título del cierre
                <input
                  type="text"
                  name="title"
                  value={completionForm.title}
                  onChange={handleCompletionChange}
                  disabled={completingMaintenance}
                />
              </label>

              <label>
                Cambiar estatus del equipo, opcional
                <select
                  name="status"
                  value={completionForm.status}
                  onChange={handleCompletionChange}
                  disabled={completingMaintenance}
                >
                  <option value="">No cambiar estatus</option>
                  {ASSET_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Cambiar condición del equipo, opcional
                <select
                  name="condition"
                  value={completionForm.condition}
                  onChange={handleCompletionChange}
                  disabled={completingMaintenance}
                >
                  <option value="">No cambiar condición</option>
                  {ASSET_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </label>

              <label className="technical-form-full">
                Descripción del trabajo realizado
                <textarea
                  name="description"
                  value={completionForm.description}
                  onChange={handleCompletionChange}
                  placeholder="Describe qué se hizo durante el mantenimiento..."
                  rows="4"
                  disabled={completingMaintenance}
                />
              </label>
            </div>

            <div className="maintenance-checklist-box visual-checklist-box">
              <div className="maintenance-checklist-header">
                <div>
                  <h3>Checklist del mantenimiento</h3>
                  <p>
                    Marca los puntos revisados. Si algo queda pendiente, agrega
                    una nota para explicar qué pasó o qué falta resolver.
                  </p>
                </div>
                <div className="maintenance-checklist-header-actions">
                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={() => {
                      const relatedAsset =
                        selectedQuickAsset ||
                        assets.find((asset) => asset.id === selectedCompletionMaintenance.assetId) ||
                        null;

                      setCompletionForm((current) => ({
                        ...current,
                        checklist: buildChecklistForCompletion(
                          {
                            ...selectedCompletionMaintenance,
                            checklistTemplate: [],
                            maintenanceChecklistTemplate: [],
                            maintenanceChecklist: [],
                            checklistBase: [],
                            checklist: [],
                          },
                          relatedAsset
                        ),
                      }));
                    }}
                    disabled={completingMaintenance}
                  >
                    Usar checklist predefinido
                  </button>

                  <button
                    type="button"
                    className="visual-outline-button"
                    onClick={addCompletionChecklistItem}
                    disabled={completingMaintenance}
                  >
                    + Agregar punto
                  </button>

                  <div className="checklist-score-card">
                    <strong>
                      {completionForm.checklist.filter((item) => item.checked).length}/
                      {completionForm.checklist.length}
                    </strong>
                    <span>completados</span>
                  </div>
                </div>
              </div>

              <div className="checklist-progress-wrap">
                <div className="checklist-progress-info">
                  <span>Avance de revisión</span>
                  <strong>{getChecklistProgress(completionForm.checklist)}%</strong>
                </div>
                <div className="checklist-progress-track">
                  <div
                    className="checklist-progress-fill"
                    style={{ width: `${getChecklistProgress(completionForm.checklist)}%` }}
                  />
                </div>
              </div>

              <div className="maintenance-checklist-grid visual-checklist-grid editable-maintenance-checklist-grid">
                {completionForm.checklist.map((item, index) => (
                  <div
                    className={`maintenance-checklist-item visual-checklist-item editable-maintenance-checklist-item ${
                      item.checked ? "checked" : "pending"
                    }`}
                    key={`completion-checklist-${index}`}
                  >
                    <div className="editable-checklist-topline">
                      <div className="checklist-order-controls">
                        <button
                          type="button"
                          onClick={() => moveCompletionChecklistItem(index, index - 1)}
                          disabled={completingMaintenance || index === 0}
                          title="Subir"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCompletionChecklistItem(index, index + 1)}
                          disabled={
                            completingMaintenance ||
                            index === completionForm.checklist.length - 1
                          }
                          title="Bajar"
                        >
                          ↓
                        </button>
                      </div>

                      <label className="checklist-position-select">
                        Posición
                        <select
                          value={index}
                          onChange={(event) =>
                            moveCompletionChecklistItem(index, Number(event.target.value))
                          }
                          disabled={completingMaintenance}
                        >
                          {completionForm.checklist.map((_, positionIndex) => (
                            <option key={positionIndex} value={positionIndex}>
                              {positionIndex + 1}
                            </option>
                          ))}
                        </select>
                      </label>

                      <button
                        type="button"
                        className="location-remove-button"
                        onClick={() => removeCompletionChecklistItem(index)}
                        disabled={completingMaintenance || completionForm.checklist.length <= 1}
                      >
                        Eliminar
                      </button>
                    </div>

                    <label className="visual-checklist-main editable-checklist-main">
                      <input
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => handleCompletionChecklistChange(index)}
                        disabled={completingMaintenance}
                      />
                      <span className="visual-check-icon">
                        {item.checked ? "✓" : "!"}
                      </span>
                      <input
                        id={`completion-checklist-label-${index}`}
                        name={`completionChecklistLabel${index}`}
                        className="editable-checklist-label-input"
                        type="text"
                        value={item.label}
                        onChange={(event) =>
                          handleCompletionChecklistLabelChange(index, event.target.value)
                        }
                        placeholder="Punto del checklist"
                        disabled={completingMaintenance}
                      />
                    </label>

                    {!item.checked && (
                      <label className="checklist-note-field">
                        Nota si queda pendiente
                        <textarea
                          value={item.note || ""}
                          onChange={(event) =>
                            handleCompletionChecklistNoteChange(index, event.target.value)
                          }
                          placeholder="Ej. No se actualizó porque no había internet, falta cable, no encendió, requiere pieza, etc."
                          rows="2"
                          disabled={completingMaintenance}
                        />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="technical-form-actions">
              <button
                type="button"
                onClick={closeCompletionForm}
                disabled={completingMaintenance}
              >
                Cancelar
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={completingMaintenance}
              >
                {completingMaintenance ? "Guardando..." : "Iniciar mantenimiento"}
              </button>
            </div>
          </form>
        </section>
      )}

      {selectedMovementAsset && (
        <section className="technical-panel">
          <div className="technical-panel-header">
            <div>
              <h2>Registrar movimiento</h2>
              <p>
                {selectedMovementAsset.assetTag} · {selectedMovementAsset.name}
              </p>
              <p className="movement-helper-text">
                Usa movimientos solo para eventos puntuales: préstamo, cambio de pieza, reparación, baja o algún ajuste manual. El mantenimiento preventivo se registra desde el flujo de mantenimiento.
              </p>
            </div>

            <button
              className="visual-outline-button"
              type="button"
              onClick={closeMovementForm}
              disabled={savingMovement}
            >
              Cerrar
            </button>
          </div>

          {movementError && <div className="form-error">{movementError}</div>}

          <form className="technical-form" onSubmit={handleMovementSubmit}>
            <div className="technical-form-grid">
              <label>
                Tipo de movimiento
                <select
                  name="type"
                  value={movementForm.type}
                  onChange={handleMovementChange}
                  disabled={savingMovement}
                >
                  {MOVEMENT_TYPES.map((movementType) => (
                    <option key={movementType} value={movementType}>
                      {movementType}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Cambiar estatus, opcional
                <select
                  name="status"
                  value={movementForm.status}
                  onChange={handleMovementChange}
                  disabled={savingMovement}
                >
                  <option value="">No cambiar estatus</option>
                  {ASSET_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Cambiar condición, opcional
                <select
                  name="condition"
                  value={movementForm.condition}
                  onChange={handleMovementChange}
                  disabled={savingMovement}
                >
                  <option value="">No cambiar condición</option>
                  {ASSET_CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </label>

              <label className="technical-form-full">
                Descripción
                <textarea
                  name="description"
                  value={movementForm.description}
                  onChange={handleMovementChange}
                  placeholder="Describe qué se hizo, qué se encontró, piezas revisadas, recomendaciones o pendientes..."
                  rows="4"
                  disabled={savingMovement}
                />
              </label>
            </div>

            <div className="technical-form-actions">
              <button
                type="button"
                onClick={closeMovementForm}
                disabled={savingMovement}
              >
                Cancelar
              </button>

              <button
                className="primary-button"
                type="submit"
                disabled={savingMovement}
              >
                {savingMovement ? "Guardando..." : "Guardar movimiento"}
              </button>
            </div>
          </form>
        </section>
      )}

      {selectedHistoryAsset && (
        <section className="technical-panel technical-history-panel technical-focused-panel">
          <div className="technical-panel-header">
            <div>
              <h2>Historial del equipo</h2>
              <p>
                {selectedHistoryAsset.assetTag} · {selectedHistoryAsset.name}
              </p>
            </div>

            <div className="technical-form-actions">
              <button
                className="visual-outline-button"
                type="button"
                onClick={() => openMovementForm(selectedHistoryAsset, true)}
              >
                + Registrar movimiento
              </button>

              <button
                className="visual-outline-button"
                type="button"
                onClick={() => openQrLabelPanel(selectedHistoryAsset)}
              >
                Etiqueta QR
              </button>

              <button
                className="visual-outline-button"
                type="button"
                onClick={closeHistoryPanel}
              >
                Cerrar historial
              </button>
            </div>
          </div>

          {logsError && <div className="form-error">{logsError}</div>}

          <div className="technical-asset-details">
            <p>
              <strong>Categoría:</strong>{" "}
              {selectedHistoryAsset.category || "Sin categoría"}
            </p>
            <p>
              <strong>Plantel:</strong>{" "}
              {normalizeCampusName(selectedHistoryAsset.campus)}
            </p>
            <p>
              <strong>Área:</strong> {selectedHistoryAsset.area || "Sin área"}
            </p>
            <p>
              <strong>Estatus actual:</strong>{" "}
              {selectedHistoryAsset.status || "Sin estatus"}
            </p>
            <p>
              <strong>Condición actual:</strong>{" "}
              {selectedHistoryAsset.condition || "Sin condición"}
            </p>
          </div>

          {loadingLogs ? (
            <div className="empty-state">
              <h3>Cargando historial...</h3>
              <p>Estamos consultando los movimientos del equipo.</p>
            </div>
          ) : (
            <>
              {assetLogs.length > 0 ? (
                <div className="technical-timeline">
                  {assetLogs.map((log) => (
                    <article className="technical-timeline-item" key={log.id}>
                      <div className="technical-timeline-marker">
                        {getMovementIcon(log.type)}
                      </div>

                      <div className="technical-timeline-content">
                        <div className="technical-timeline-top">
                          <div>
                            <span className="technical-log-type">
                              {getMovementTypeLabel(log.type)}
                            </span>

                            <h3>{log.title || "Movimiento registrado"}</h3>
                          </div>

                          <span className="technical-log-date">
                            {formatLogDate(log.createdAt)}
                          </span>
                        </div>

                        <p className="technical-log-description">
                          {log.description || "Sin descripción."}
                        </p>

                        {hasStatusChange(log) && (
                          <div className="technical-change-row">
                            <strong>Estatus:</strong>
                            <span>{log.previousStatus || "Sin estatus"}</span>
                            <span>→</span>
                            <span>{log.newStatus || "Sin estatus"}</span>
                          </div>
                        )}

                        {hasConditionChange(log) && (
                          <div className="technical-change-row">
                            <strong>Condición:</strong>
                            <span>
                              {log.previousCondition || "Sin condición"}
                            </span>
                            <span>→</span>
                            <span>{log.newCondition || "Sin condición"}</span>
                          </div>
                        )}

                        {Array.isArray(log.checklist) && log.checklist.length > 0 && (
                          <div className="technical-log-checklist visual-log-checklist">
                            <div className="log-checklist-header">
                              <strong>Checklist registrado</strong>
                              <span>{getChecklistProgress(log.checklist)}% completado</span>
                            </div>
                            <div className="log-checklist-grid">
                              {log.checklist.map((item, index) => (
                                <div
                                  className={`log-checklist-item ${
                                    item.checked ? "done" : "pending"
                                  }`}
                                  key={`${item.label}-${index}`}
                                >
                                  <span>{item.checked ? "✓" : "!"}</span>
                                  <div>
                                    <strong>{item.label}</strong>
                                    {!item.checked && item.note && (
                                      <p>{item.note}</p>
                                    )}
                                    {!item.checked && !item.note && (
                                      <p>Sin nota registrada.</p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="technical-history-meta">
                          <span>
                            {log.createdBy
                              ? `Por ${log.createdBy}`
                              : "Usuario no registrado"}
                          </span>

                          {log.assetTag && <span>{log.assetTag}</span>}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h3>Sin historial</h3>
                  <p>
                    Este equipo todavía no tiene movimientos registrados en el
                    historial.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      )}


      {!focusedSupportViewActive && activeTab === "bajas" && (
        <section className="technical-equipment-workspace equipment-history-workspace">
          <div className="equipment-page-header">
            <div>
              <p className="section-kicker equipment-kicker">Inventario técnico</p>
              <h2>Historial de bajas</h2>
              <p>
                Consulta los equipos eliminados o dados de baja. Se conservan en la base
                de datos para historial, pero no aparecen en mantenimientos activos ni en el resumen.
              </p>
            </div>

            <div className="equipment-header-actions">
              <button
                className="visual-outline-button"
                type="button"
                onClick={() => setActiveTab("equipos")}
              >
                Regresar a equipos
              </button>
              <button
                className="visual-outline-button"
                type="button"
                onClick={loadInitialData}
                disabled={loadingAssets || loadingMaintenances}
              >
                Actualizar
              </button>
            </div>
          </div>

          <div className="equipment-history-summary">
            <article>
              <span className="equipment-metric-icon gray">↓</span>
              <div>
                <strong>{inactiveTechnicalAssets.length}</strong>
                <p>Equipos en historial</p>
                <small>Eliminados o dados de baja</small>
              </div>
            </article>
            <article>
              <span className="equipment-metric-icon orange">!</span>
              <div>
                <strong>{inactiveTechnicalAssets.filter((asset) => asset.status === "Dado de baja").length}</strong>
                <p>Dados de baja</p>
                <small>Salida operativa</small>
              </div>
            </article>
            <article>
              <span className="equipment-metric-icon red">×</span>
              <div>
                <strong>{inactiveTechnicalAssets.filter((asset) => asset.deleted === true || asset.status === "Eliminado").length}</strong>
                <p>Eliminados</p>
                <small>Ocultos del inventario activo</small>
              </div>
            </article>
          </div>

          <div className="equipment-list-header">
            <div>
              <h3>Equipos fuera del inventario activo</h3>
              <p>
                {loadingAssets
                  ? "Cargando historial..."
                  : `Mostrando ${inactiveTechnicalAssets.length} equipos eliminados o dados de baja.`}
              </p>
            </div>
          </div>

          {inactiveTechnicalAssets.length > 0 ? (
            <div className="equipment-list-table-wrap">
              <table className="equipment-list-table equipment-history-table">
                <thead>
                  <tr>
                    <th>Equipo</th>
                    <th>Ubicación anterior</th>
                    <th>Categoría</th>
                    <th>Motivo / estatus</th>
                    <th>Fecha</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveTechnicalAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td>
                        <button
                          type="button"
                          className="equipment-list-name-button"
                          onClick={() => openQuickAssetPanel(asset)}
                        >
                          <span className="equipment-list-icon muted">
                            {getAssetCategoryIcon(asset.category)}
                          </span>
                          <span>
                            <strong>{asset.name || "Equipo sin nombre"}</strong>
                            <small>{asset.assetTag || "Sin código"}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="equipment-list-location">
                          {normalizeCampusName(asset.campus)} · {asset.assignedTo || asset.area || "Sin ubicación"}
                        </span>
                        {asset.technicalLocationName && (
                          <small className="equipment-list-subline">
                            Ubicación técnica: {asset.technicalLocationName}
                          </small>
                        )}
                      </td>
                      <td>{asset.category || "Sin categoría"}</td>
                      <td>
                        <span className="equipment-chip status-eliminado">
                          {asset.status || "Eliminado"}
                        </span>
                      </td>
                      <td>{formatLogDate(asset.deletedAt || asset.updatedAt || asset.createdAt)}</td>
                      <td>
                        <div className="equipment-list-actions-cell">
                          <button type="button" onClick={() => openQuickAssetPanel(asset)}>
                            Ver historial
                          </button>
                          <button
                            type="button"
                            className="restore-table-button"
                            onClick={() => handleRestoreAsset(asset)}
                          >
                            Restaurar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3>Sin equipos en historial</h3>
              <p>Cuando elimines o des de baja un equipo, aparecerá aquí.</p>
            </div>
          )}
        </section>
      )}

      {!focusedSupportViewActive && activeTab === "ubicaciones-tecnicas" && (
        <section
          className={`technical-locations-workspace ${
            showLocationForm || showChecklistEditor || showLocationReviewForm
              ? "location-focused-action"
              : ""
          } ${showLocationForm ? "location-form-focused" : ""} ${
            showChecklistEditor ? "location-checklist-focused" : ""
          } ${showLocationReviewForm ? "location-review-focused" : ""}`}
        >
          <div className="equipment-page-header">
            <div>
              <p className="section-kicker equipment-kicker">Soporte técnico</p>
              <h2>Ubicaciones técnicas</h2>
              <p>
                Revisa cabinas, salones, recepción y áreas con equipo técnico.
                Cada ubicación puede tener equipos asignados y mantenimientos vinculados.
              </p>
            </div>

            <div className="equipment-header-actions">
              <button
                className="visual-outline-button"
                type="button"
                onClick={loadTechnicalLocations}
                disabled={loadingLocations}
              >
                Actualizar
              </button>

              <button
                className="visual-primary-button"
                type="button"
                onClick={() => openLocationForm()}
              >
                + Registrar ubicación
              </button>
            </div>
          </div>

          <div className="technical-location-metrics">
            <article>
              <span className="equipment-metric-icon purple">⌖</span>
              <div>
                <strong>{technicalLocations.length}</strong>
                <p>Ubicaciones técnicas</p>
                <small>Registradas</small>
              </div>
            </article>

            <article>
              <span className="equipment-metric-icon orange">!</span>
              <div>
                <strong>{locationsNeedingAttention}</strong>
                <p>Requieren atención</p>
                <small>Pendientes o con detalle</small>
              </div>
            </article>

            <article>
              <span className="equipment-metric-icon green">▣</span>
              <div>
                <strong>{visibleAssets.length}</strong>
                <p>Equipos activos</p>
                <small>Disponibles para vincular</small>
              </div>
            </article>

            <article>
              <span className="equipment-metric-icon gray">🛠</span>
              <div>
                <strong>{pendingMaintenances.length}</strong>
                <p>Mantenimientos activos</p>
                <small>Solo equipos vigentes</small>
              </div>
            </article>
          </div>

          {showLocationForm && (
            <section className="technical-panel location-form-panel">
              <div className="technical-panel-header">
                <div>
                  <h2>
                    {editingLocationId
                      ? "Editar ubicación técnica"
                      : "Registrar ubicación técnica"}
                  </h2>
                  <p>
                    Registra únicamente áreas donde Soporte Técnico revisa
                    elementos técnicos, periféricos o equipos asignados.
                  </p>
                </div>

                <button
                  className="visual-outline-button"
                  type="button"
                  onClick={closeLocationForm}
                  disabled={savingLocation}
                >
                  Regresar
                </button>
              </div>

              {locationFormError && (
                <div className="form-error">{locationFormError}</div>
              )}

              <form className="technical-form" onSubmit={handleLocationSubmit}>
                <div className="technical-form-grid">
                  <label>
                    Nombre de la ubicación
                    <input
                      type="text"
                      name="name"
                      value={locationForm.name}
                      onChange={handleLocationFormChange}
                      placeholder="Ej. Cabina 1, Salón 3, Recepción"
                      disabled={savingLocation}
                    />
                  </label>

                  <label>
                    Tipo de ubicación
                    <select
                      name="type"
                      value={locationForm.type}
                      onChange={handleLocationFormChange}
                      disabled={savingLocation}
                    >
                      {TECHNICAL_LOCATION_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Plantel
                    <select
                      name="campus"
                      value={locationForm.campus}
                      onChange={handleLocationFormChange}
                      disabled={savingLocation}
                    >
                      <option value="">Seleccionar plantel</option>
                      {CAMPUS_OPTIONS.map((campus) => (
                        <option key={campus} value={campus}>
                          {campus}
                        </option>
                      ))}
                    </select>
                  </label>

                  {locationForm.campus === "Otro" && (
                    <label>
                      Especificar otro plantel
                      <input
                        type="text"
                        name="campusOther"
                        value={locationForm.campusOther}
                        onChange={handleLocationFormChange}
                        placeholder="Nombre del plantel o ubicación"
                        disabled={savingLocation}
                      />
                    </label>
                  )}

                  <label>
                    Área relacionada
                    <select
                      name="area"
                      value={locationForm.area}
                      onChange={handleLocationFormChange}
                      disabled={savingLocation}
                    >
                      <option value="">Seleccionar área</option>
                      {LOCATION_AREAS.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Estado general
                    <select
                      name="status"
                      value={locationForm.status}
                      onChange={handleLocationFormChange}
                      disabled={savingLocation}
                    >
                      {TECHNICAL_LOCATION_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="technical-form-full">
                    Notas
                    <textarea
                      name="notes"
                      value={locationForm.notes}
                      onChange={handleLocationFormChange}
                      placeholder="Ej. Cabina online con dos monitores, lámparas, no-break y bocinas."
                      rows="3"
                      disabled={savingLocation}
                    />
                  </label>
                </div>

                <div className="technical-form-actions">
                  <button
                    type="button"
                    onClick={closeLocationForm}
                    disabled={savingLocation}
                  >
                    Regresar
                  </button>

                  <button
                    className="primary-button"
                    type="submit"
                    disabled={savingLocation}
                  >
                    {savingLocation
                      ? "Guardando..."
                      : editingLocationId
                      ? "Guardar cambios"
                      : "Registrar ubicación"}
                  </button>
                </div>
              </form>
            </section>
          )}

          <div className="technical-location-layout">
            <section className="technical-panel technical-location-list-panel">
              <div className="technical-panel-header compact">
                <div>
                  <h2>Ubicaciones</h2>
                  <p>
                    {loadingLocations
                      ? "Cargando ubicaciones..."
                      : `Mostrando ${filteredTechnicalLocations.length} de ${technicalLocations.length} ubicaciones.`}
                  </p>
                </div>
              </div>

              <div className="technical-location-filters">
                <input
                  type="text"
                  value={locationSearchTerm}
                  onChange={(event) => setLocationSearchTerm(event.target.value)}
                  placeholder="Buscar ubicación..."
                  disabled={loadingLocations}
                />

                <select
                  value={locationCampusFilter}
                  onChange={(event) => setLocationCampusFilter(event.target.value)}
                  disabled={loadingLocations}
                >
                  <option value="Todos">Todos los planteles</option>
                  {campusFilterOptions.map((campus) => (
                    <option key={campus} value={campus}>
                      {campus}
                    </option>
                  ))}
                </select>

                <select
                  value={locationTypeFilter}
                  onChange={(event) => setLocationTypeFilter(event.target.value)}
                  disabled={loadingLocations}
                >
                  <option value="Todos">Todos los tipos</option>
                  {TECHNICAL_LOCATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>

                <select
                  value={locationStatusFilter}
                  onChange={(event) => setLocationStatusFilter(event.target.value)}
                  disabled={loadingLocations}
                >
                  <option value="Todos">Todos los estados</option>
                  {TECHNICAL_LOCATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>

              {loadingLocations ? (
                <div className="empty-state small">
                  <h3>Cargando ubicaciones...</h3>
                  <p>Consultando ubicaciones técnicas registradas.</p>
                </div>
              ) : filteredTechnicalLocations.length > 0 ? (
                <div className="technical-location-card-grid">
                  {filteredTechnicalLocations.map((location) => {
                    const locationAssets = visibleAssets.filter((asset) =>
                      isAssetAssignedToTechnicalLocation(asset, location)
                    );
                    const statusClass = getLocationStatusClass(location.status);

                    return (
                      <article
                        className={`technical-location-card ${
                          selectedTechnicalLocation?.id === location.id
                            ? "selected"
                            : ""
                        }`}
                        key={location.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedLocationId(location.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedLocationId(location.id);
                          }
                        }}
                      >
                        <div className="location-card-icon">
                          {getLocationTypeIcon(location.type)}
                        </div>

                        <div>
                          <div className="location-card-title-row">
                            <h3>{location.name}</h3>
                            <span className={`location-status ${statusClass}`}>
                              {location.status || "Sin estado"}
                            </span>
                          </div>
                          <p>{normalizeCampusName(location.campus)}</p>
                          <small>
                            {location.type || "Sin tipo"} · {locationAssets.length} equipo
                            {locationAssets.length === 1 ? "" : "s"}
                          </small>

                          <div className="location-card-actions">
                            <button type="button">Ver ubicación</button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state small">
                  <h3>Sin ubicaciones técnicas</h3>
                  <p>Registra cabinas, salones o áreas técnicas para iniciar.</p>
                </div>
              )}
            </section>

            <aside className="technical-panel technical-location-detail-panel">
              {selectedTechnicalLocation ? (
                <>
                  <div className="location-detail-hero">
                    <div className="location-detail-icon">
                      {getLocationTypeIcon(selectedTechnicalLocation.type)}
                    </div>

                    <div>
                      <span className="location-detail-kicker">
                        {selectedTechnicalLocation.type || "Ubicación técnica"}
                      </span>
                      <h2>{selectedTechnicalLocation.name}</h2>
                      <p>
                        {normalizeCampusName(selectedTechnicalLocation.campus)} · {selectedTechnicalLocation.area || "Sin área"}
                      </p>
                    </div>
                  </div>

                  <div className="location-detail-actions">
                    <button
                      className="visual-primary-button"
                      type="button"
                      onClick={() => registerAssetForLocation(selectedTechnicalLocation)}
                    >
                      + Registrar equipo aquí
                    </button>

                    <button
                      className="visual-outline-button"
                      type="button"
                      onClick={() => openLocationForm(selectedTechnicalLocation)}
                    >
                      Editar ubicación
                    </button>
                  </div>

                  <section className="location-checklist-card">
                    <div className="location-section-title with-actions">
                      <div>
                        <h3>Checklist técnico base</h3>
                        <p>
                          Elementos que deben revisarse cada vez que se inspecciona esta ubicación.
                        </p>
                      </div>

                      <span>
                        {getLocationChecklistTemplate(selectedTechnicalLocation).length} elementos
                      </span>
                    </div>

                    <div className="location-detail-actions compact-actions">
                      <button
                        className="visual-primary-button"
                        type="button"
                        onClick={() => openLocationReviewForm(selectedTechnicalLocation)}
                      >
                        Iniciar revisión técnica
                      </button>

                      <button
                        className="visual-outline-button"
                        type="button"
                        onClick={() => openChecklistEditor(selectedTechnicalLocation)}
                      >
                        Editar checklist
                      </button>
                    </div>

                    {showChecklistEditor && (
                      <form
                        className="location-checklist-editor"
                        onSubmit={handleSaveChecklistTemplate}
                      >
                        <div className="location-editor-header">
                          <div>
                            <h4>Editar checklist de {selectedTechnicalLocation.name}</h4>
                            <p>
                              Agrega, elimina o cambia los elementos que el técnico debe revisar.
                            </p>
                          </div>

                          <button
                            type="button"
                            className="visual-outline-button"
                            onClick={addChecklistEditorItem}
                            disabled={savingChecklist}
                          >
                            + Agregar elemento
                          </button>
                        </div>

                        {checklistEditorError && (
                          <div className="form-error">{checklistEditorError}</div>
                        )}

                        <div className="location-checklist-edit-list">
                          {checklistEditorItems.map((item, index) => (
                            <article className="location-checklist-edit-row" key={`edit-${index}`}>
                              <div className="checklist-order-controls">
                                <button
                                  type="button"
                                  onClick={() => moveChecklistEditorItem(index, index - 1)}
                                  disabled={savingChecklist || index === 0}
                                  title="Subir"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveChecklistEditorItem(index, index + 1)}
                                  disabled={
                                    savingChecklist || index === checklistEditorItems.length - 1
                                  }
                                  title="Bajar"
                                >
                                  ↓
                                </button>
                              </div>

                              <label className="checklist-position-select">
                                Posición
                                <select
                                  value={index}
                                  onChange={(event) =>
                                    moveChecklistEditorItem(index, Number(event.target.value))
                                  }
                                  disabled={savingChecklist}
                                >
                                  {checklistEditorItems.map((_, positionIndex) => (
                                    <option key={positionIndex} value={positionIndex}>
                                      {positionIndex + 1}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <input
                                type="text"
                                value={item.label}
                                onChange={(event) =>
                                  handleChecklistEditorItemChange(
                                    index,
                                    "label",
                                    event.target.value
                                  )
                                }
                                placeholder="Nombre del elemento"
                                disabled={savingChecklist}
                              />

                              <label className="location-required-toggle">
                                <input
                                  type="checkbox"
                                  checked={item.required !== false}
                                  onChange={(event) =>
                                    handleChecklistEditorItemChange(
                                      index,
                                      "required",
                                      event.target.checked
                                    )
                                  }
                                  disabled={savingChecklist}
                                />
                                Obligatorio
                              </label>

                              <button
                                type="button"
                                className="location-remove-button"
                                onClick={() => removeChecklistEditorItem(index)}
                                disabled={savingChecklist || checklistEditorItems.length <= 1}
                              >
                                Eliminar
                              </button>
                            </article>
                          ))}
                        </div>

                        <div className="technical-form-actions">
                          <button
                            type="button"
                            onClick={closeChecklistEditor}
                            disabled={savingChecklist}
                          >
                            Regresar
                          </button>

                          <button
                            className="primary-button"
                            type="submit"
                            disabled={savingChecklist}
                          >
                            {savingChecklist ? "Guardando..." : "Guardar checklist"}
                          </button>
                        </div>
                      </form>
                    )}

                    {showLocationReviewForm && (
                      <form
                        className="location-review-form"
                        onSubmit={handleSaveLocationReview}
                      >
                        <div className="location-editor-header">
                          <div>
                            <h4>Revisión técnica de {selectedTechnicalLocation.name}</h4>
                            <p>
                              Marca si cada elemento está presente, su estado y cualquier detalle.
                            </p>
                          </div>

                          <select
                            name="generalStatus"
                            value={locationReviewForm.generalStatus}
                            onChange={handleLocationReviewFormChange}
                            disabled={savingLocationReview}
                          >
                            <option value="Correcto">Resultado general: Correcto</option>
                            <option value="Requiere atención">
                              Resultado general: Requiere atención
                            </option>
                            <option value="Pendiente">Resultado general: Pendiente</option>
                          </select>
                        </div>

                        {locationReviewError && (
                          <div className="form-error">{locationReviewError}</div>
                        )}

                        <div className="location-review-list">
                          {locationReviewItems.map((item, index) => (
                            <article className="location-review-row" key={`review-${index}`}>
                              <div className="location-review-row-main">
                                <span>{index + 1}</span>
                                <div>
                                  <strong>{item.label}</strong>
                                  <small>
                                    {item.required ? "Obligatorio" : "Opcional"}
                                  </small>
                                </div>
                              </div>

                              <label className="location-present-toggle">
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.present)}
                                  onChange={(event) =>
                                    handleLocationReviewItemChange(
                                      index,
                                      "present",
                                      event.target.checked
                                    )
                                  }
                                  disabled={savingLocationReview}
                                />
                                Presente
                              </label>

                              <select
                                value={item.status}
                                onChange={(event) =>
                                  handleLocationReviewItemChange(
                                    index,
                                    "status",
                                    event.target.value
                                  )
                                }
                                disabled={savingLocationReview || !item.present}
                              >
                                {LOCATION_REVIEW_STATUSES.map((status) => (
                                  <option key={status} value={status}>
                                    {status}
                                  </option>
                                ))}
                              </select>

                              <textarea
                                value={item.note}
                                onChange={(event) =>
                                  handleLocationReviewItemChange(
                                    index,
                                    "note",
                                    event.target.value
                                  )
                                }
                                placeholder={
                                  item.present
                                    ? "Observación opcional..."
                                    : "Explica qué falta o qué se encontró..."
                                }
                                disabled={savingLocationReview}
                              />
                            </article>
                          ))}
                        </div>

                        <div className="location-review-notes-grid">
                          <label>
                            Observaciones generales
                            <textarea
                              name="observations"
                              value={locationReviewForm.observations}
                              onChange={handleLocationReviewFormChange}
                              placeholder="Ej. Mouse con falla en clic izquierdo."
                              disabled={savingLocationReview}
                            />
                          </label>

                          <label>
                            Acciones pendientes
                            <textarea
                              name="pendingActions"
                              value={locationReviewForm.pendingActions}
                              onChange={handleLocationReviewFormChange}
                              placeholder="Ej. Reponer lámpara 2 y cambiar mouse."
                              disabled={savingLocationReview}
                            />
                          </label>
                        </div>

                        <div className="technical-form-actions">
                          <button
                            type="button"
                            onClick={closeLocationReviewForm}
                            disabled={savingLocationReview}
                          >
                            Regresar
                          </button>

                          <button
                            className="primary-button"
                            type="submit"
                            disabled={savingLocationReview}
                          >
                            {savingLocationReview
                              ? "Guardando revisión..."
                              : "Guardar revisión técnica"}
                          </button>
                        </div>
                      </form>
                    )}

                    <div className="location-checklist-grid">
                      {getLocationChecklistTemplate(selectedTechnicalLocation).map(
                        (item, index) => (
                          <div
                            className="location-checklist-item"
                            key={`${item.label}-${index}`}
                          >
                            <span>{index + 1}</span>
                            <strong>{item.label}</strong>
                            <small>{item.required === false ? "Opcional" : "Obligatorio"}</small>
                          </div>
                        )
                      )}
                    </div>
                  </section>

                  <section className="location-reviews-card">
                    <div className="location-section-title">
                      <div>
                        <h3>Historial de revisiones</h3>
                        <p>Últimas revisiones técnicas guardadas para esta ubicación.</p>
                      </div>
                      <span>{locationReviews.length}</span>
                    </div>

                    {locationReviewsError && (
                      <div className="form-error">{locationReviewsError}</div>
                    )}

                    {loadingLocationReviews ? (
                      <div className="empty-state small">
                        <h3>Cargando revisiones...</h3>
                        <p>Consultando historial de la ubicación.</p>
                      </div>
                    ) : locationReviews.length > 0 ? (
                      <div className="location-review-history-list">
                        {locationReviews.slice(0, 3).map((review) => (
                          <article className="location-review-history-item" key={review.id}>
                            <div>
                              <span className={`location-status ${getLocationStatusClass(review.generalStatus)}`}>
                                {review.generalStatus || "Sin resultado"}
                              </span>
                              <strong>
                                {formatLogDate(review.createdAt)}
                              </strong>
                              <p>
                                {review.observations ||
                                  review.pendingActions ||
                                  "Revisión guardada sin observaciones generales."}
                              </p>
                            </div>
                            <small>
                              {review.reviewedBy
                                ? `Por ${review.reviewedBy}`
                                : "Técnico no registrado"}
                            </small>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state small">
                        <h3>Sin revisiones guardadas</h3>
                        <p>
                          Cuando guardes una revisión técnica aparecerá aquí.
                        </p>
                      </div>
                    )}
                  </section>

                  <section className="location-assets-card">
                    <div className="location-section-title">
                      <h3>Equipos asignados</h3>
                      <span>{selectedLocationAssets.length}</span>
                    </div>

                    {selectedLocationAssets.length > 0 ? (
                      <div className="location-asset-list">
                        {selectedLocationAssets.map((asset) => {
                          const nextMaintenance = getPendingMaintenancesForAsset(asset)[0];
                          const urgency = nextMaintenance
                            ? getMaintenanceUrgency(nextMaintenance.nextDate)
                            : null;

                          return (
                            <article className="location-asset-item" key={asset.id}>
                              <div>
                                <span className="asset-tag">{asset.assetTag}</span>
                                <strong>{asset.name || "Equipo sin nombre"}</strong>
                                <p>
                                  {asset.category || "Sin categoría"} · {asset.condition || "Sin condición"}
                                </p>
                                {nextMaintenance ? (
                                  <small>
                                    Próximo: {urgency.label} · {formatMaintenanceDate(nextMaintenance.nextDate)}
                                  </small>
                                ) : (
                                  <small>Sin mantenimientos pendientes</small>
                                )}
                              </div>

                              <div className="location-asset-actions">
                                <button type="button" onClick={() => openQuickAssetPanel(asset)}>
                                  Ver ficha
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    nextMaintenance
                                      ? openCompletionForm(nextMaintenance, { asset })
                                      : openMaintenanceFromLocation(asset)
                                  }
                                >
                                  {nextMaintenance ? "Iniciar" : "Programar"}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="empty-state small">
                        <h3>Sin equipos vinculados</h3>
                        <p>
                          Registra un equipo en esta ubicación o edita un equipo
                          existente para vincularlo.
                        </p>
                      </div>
                    )}
                  </section>

                  <section className="location-maintenance-card">
                    <div className="location-section-title">
                      <h3>Mantenimientos de esta ubicación</h3>
                      <span>{selectedLocationPendingMaintenances.length}</span>
                    </div>

                    {selectedLocationPendingMaintenances.length > 0 ? (
                      <div className="location-maintenance-list">
                        {selectedLocationPendingMaintenances.slice(0, 4).map((maintenance) => {
                          const urgency = getMaintenanceUrgency(maintenance.nextDate);

                          return (
                            <article
                              className={`location-maintenance-item urgency-${urgency.level}`}
                              key={maintenance.id}
                            >
                              <span>{urgency.icon}</span>
                              <div>
                                <strong>{maintenance.title}</strong>
                                <p>{maintenance.assetName || "Equipo sin nombre"}</p>
                              </div>
                              <small>{formatMaintenanceDate(maintenance.nextDate)}</small>
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="empty-state small">
                        <h3>Sin mantenimientos pendientes</h3>
                        <p>Los mantenimientos de sus equipos aparecerán aquí.</p>
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <div className="empty-state small">
                  <h3>Selecciona una ubicación</h3>
                  <p>El detalle aparecerá en esta sección.</p>
                </div>
              )}
            </aside>
          </div>
        </section>
      )}

      {showAssetForm && activeTab === "registrar-equipo" && (
        <section className="technical-panel technical-register-panel">
          <div className="technical-panel-header register-equipment-hero">
            <div>
              <p className="section-kicker equipment-kicker">Inventario técnico</p>
              <h2>{isEditing ? "Editar equipo" : "Registrar nuevo equipo"}</h2>
              <p>
                Captura la información básica, vincula una ubicación técnica y ajusta el checklist base que se usará en futuros mantenimientos.
              </p>
            </div>

            <button
              className="visual-outline-button"
              type="button"
              onClick={closeAssetForm}
              disabled={savingAsset}
            >
              ← Regresar
            </button>
          </div>

          {assetFormError && <div className="form-error">{assetFormError}</div>}

          <form className="technical-register-layout" onSubmit={handleAssetSubmit}>
            <div className="technical-register-form-card">
              <div className="technical-form-grid simplified">
                <label>
                  Categoría
                  <select
                    name="category"
                    value={assetForm.category}
                    onChange={handleAssetFormChange}
                    disabled={savingAsset}
                  >
                    {ASSET_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Plantel
                  <select
                    name="campus"
                    value={assetForm.campus}
                    onChange={handleAssetFormChange}
                    disabled={savingAsset}
                  >
                    <option value="">Seleccionar plantel</option>
                    {CAMPUS_OPTIONS.map((campus) => (
                      <option key={campus} value={campus}>
                        {campus}
                      </option>
                    ))}
                  </select>
                </label>

                {assetForm.campus === "Otro" && (
                  <label className="technical-other-campus-field">
                    Especificar otro plantel
                    <input
                      type="text"
                      name="campusOther"
                      value={assetForm.campusOther}
                      onChange={handleAssetFormChange}
                      placeholder="Escribe el nombre del plantel o ubicación"
                      disabled={savingAsset}
                    />
                  </label>
                )}

                <label className="technical-form-full">
                  Área / ubicación
                  <div className="location-chip-group">
                    {LOCATION_AREAS.map((area) => (
                      <button
                        key={area}
                        type="button"
                        className={assetForm.area === area ? "active" : ""}
                        onClick={() =>
                          handleAssetFormChange({
                            target: { name: "area", value: area },
                          })
                        }
                        disabled={savingAsset}
                      >
                        {area}
                      </button>
                    ))}
                  </div>
                </label>

                <label>
                  Ubicación específica
                  <input
                    type="text"
                    name="assignedTo"
                    value={assetForm.assignedTo}
                    onChange={handleAssetFormChange}
                    placeholder="Ej. Recepción principal, Salón 3, Cabina Online 1"
                    disabled={savingAsset}
                  />
                </label>

                <label>
                  Ubicación técnica, opcional
                  <select
                    name="technicalLocationId"
                    value={assetForm.technicalLocationId}
                    onChange={handleAssetFormChange}
                    disabled={savingAsset || loadingLocations}
                  >
                    <option value="">Sin vincular a ubicación técnica</option>
                    {technicalLocations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name} · {normalizeCampusName(location.campus)} · {location.type}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Condición
                  <select
                    name="condition"
                    value={assetForm.condition}
                    onChange={handleAssetFormChange}
                    disabled={savingAsset}
                  >
                    {ASSET_CONDITIONS.map((condition) => (
                      <option key={condition} value={condition}>
                        {condition}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Marca
                  <input
                    type="text"
                    name="brand"
                    value={assetForm.brand}
                    onChange={handleAssetFormChange}
                    placeholder="Ej. Dell, HP, Brother, Epson..."
                    disabled={savingAsset}
                  />
                </label>

                <label>
                  Modelo
                  <input
                    type="text"
                    name="model"
                    value={assetForm.model}
                    onChange={handleAssetFormChange}
                    placeholder="Ej. OptiPlex 7090"
                    disabled={savingAsset}
                  />
                </label>

                <label>
                  Número de serie
                  <input
                    type="text"
                    name="serialNumber"
                    value={assetForm.serialNumber}
                    onChange={handleAssetFormChange}
                    placeholder="Número de serie del equipo"
                    disabled={savingAsset}
                  />
                </label>

                <label>
                  Estatus
                  <select
                    name="status"
                    value={assetForm.status}
                    onChange={handleAssetFormChange}
                    disabled={savingAsset}
                  >
                    {ASSET_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="technical-form-full">
                  Notas
                  <textarea
                    name="notes"
                    value={assetForm.notes}
                    onChange={handleAssetFormChange}
                    placeholder="Información adicional del equipo, accesorios, estado físico o instalación..."
                    rows="4"
                    disabled={savingAsset}
                  />
                </label>

                <div className="technical-form-full asset-checklist-editor-card">
                  <div className="maintenance-checklist-header">
                    <div>
                      <h3>Checklist base de mantenimiento</h3>
                      <p>
                        Estos puntos aparecerán automáticamente cada vez que se inicie o programe un mantenimiento para este equipo.
                      </p>
                    </div>

                    <div className="maintenance-checklist-header-actions">
                      <button
                        type="button"
                        className="visual-outline-button"
                        onClick={reloadAssetDefaultChecklist}
                        disabled={savingAsset}
                      >
                        Usar checklist predefinido
                      </button>

                      <button
                        type="button"
                        className="visual-outline-button"
                        onClick={addAssetChecklistItem}
                        disabled={savingAsset}
                      >
                        + Agregar punto
                      </button>
                    </div>
                  </div>

                  <div className="editable-maintenance-checklist-grid asset-base-checklist-grid">
                    {(assetForm.maintenanceChecklistTemplate || []).map((item, index) => (
                      <div className="editable-checklist-row" key={`${item.label}-${index}`}>
                        <div className="checklist-order-controls">
                          <button
                            type="button"
                            onClick={() => moveAssetChecklistItem(index, index - 1)}
                            disabled={savingAsset || index === 0}
                            title="Subir"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveAssetChecklistItem(index, index + 1)}
                            disabled={
                              savingAsset ||
                              index === (assetForm.maintenanceChecklistTemplate || []).length - 1
                            }
                            title="Bajar"
                          >
                            ↓
                          </button>
                        </div>

                        <label className="checklist-position-select">
                          Posición
                          <select
                            value={index}
                            onChange={(event) =>
                              moveAssetChecklistItem(index, Number(event.target.value))
                            }
                            disabled={savingAsset}
                          >
                            {(assetForm.maintenanceChecklistTemplate || []).map((_, positionIndex) => (
                              <option key={positionIndex} value={positionIndex}>
                                {positionIndex + 1}
                              </option>
                            ))}
                          </select>
                        </label>

                        <input
                          type="text"
                          value={item.label || ""}
                          onChange={(event) =>
                            updateAssetChecklistItem(index, "label", event.target.value)
                          }
                          placeholder="Punto de revisión"
                          disabled={savingAsset}
                        />

                        <button
                          type="button"
                          className="danger-table-button"
                          onClick={() => removeAssetChecklistItem(index)}
                          disabled={
                            savingAsset ||
                            (assetForm.maintenanceChecklistTemplate || []).length <= 1
                          }
                        >
                          Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <aside className="asset-auto-preview-card">
              <div className="asset-auto-preview-icon">✦</div>
              <h3>Se generará automáticamente</h3>
              <p>
                El sistema usará la categoría y ubicación para crear datos claros
                y consistentes.
              </p>

              <div className="asset-generated-row">
                <span>Código interno</span>
                <strong>{generatedAssetTag}</strong>
              </div>

              <div className="asset-generated-row">
                <span>Nombre del equipo</span>
                <strong>{generatedAssetName}</strong>
              </div>

              <div className="asset-generated-note">
                <strong>Ubicación registrada</strong>
                <span>
                  {assetForm.assignedTo || assetForm.area || getResolvedCampus(assetForm)
                    ? `${getResolvedCampus(assetForm) || "Sin plantel"} · ${assetForm.area || "Sin área"} · ${assetForm.assignedTo || "Sin ubicación específica"}`
                    : "Completa plantel, área y ubicación específica"}
                </span>
              </div>

              <div className="asset-generated-note">
                <strong>Ubicación técnica vinculada</strong>
                <span>
                  {assetForm.technicalLocationName
                    ? `${assetForm.technicalLocationName} · ${assetForm.technicalLocationType || "Sin tipo"}`
                    : "Puedes vincular el equipo a una ubicación técnica para integrarlo con checklists y mantenimientos."}
                </span>
              </div>

              <div className="technical-form-actions preview-actions">
                <button
                  type="button"
                  onClick={openCreateForm}
                  disabled={savingAsset}
                >
                  Limpiar
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={savingAsset}
                >
                  {savingAsset
                    ? "Guardando..."
                    : isEditing
                    ? "Guardar cambios"
                    : "Registrar equipo"}
                </button>
              </div>
            </aside>
          </form>
        </section>
      )}

      {!focusedSupportViewActive && activeTab === "mantenimientos" && (
        <section className="maintenance-workspace-clean">
          <div className="maintenance-clean-header">
            <div>
              <p className="section-kicker equipment-kicker">Mantenimientos</p>
              <h2>Mantenimientos programados</h2>
              <p>
                Vista simplificada para atender lo urgente sin saturar la pantalla.
              </p>
            </div>

            <div className="maintenance-clean-actions">
              <button
                className="visual-outline-button"
                type="button"
                onClick={loadMaintenances}
                disabled={loadingMaintenances}
              >
                Actualizar
              </button>
              <button
                className="visual-outline-button"
                type="button"
                onClick={() => setActiveTab("equipos")}
              >
                Ver inventario
              </button>
            </div>
          </div>

          <div className="maintenance-clean-metrics">
            <article>
              <span>Pendientes</span>
              <strong>{pendingMaintenances.length}</strong>
              <p>Equipos por atender</p>
            </article>
            <article className="attention">
              <span>Vencidos / hoy</span>
              <strong>{overdueMaintenances.length + todayMaintenances.length}</strong>
              <p>Prioridad alta</p>
            </article>
            <article>
              <span>Esta semana</span>
              <strong>{weekMaintenances.length}</strong>
              <p>Próximos trabajos</p>
            </article>
            <article>
              <span>Ubicaciones</span>
              <strong>{pendingLocationReviews.length}</strong>
              <p>Revisiones periódicas</p>
            </article>
          </div>

          <div className="maintenance-clean-layout">
            <section className="maintenance-clean-card">
              <div className="maintenance-clean-card-header">
                <div>
                  <h3>Atención prioritaria</h3>
                  <p>
                    Se muestran primero los mantenimientos vencidos, de hoy y próximos.
                  </p>
                </div>
                <span>{pendingMaintenances.length} pendientes</span>
              </div>

              {loadingMaintenances ? (
                <div className="empty-state compact-empty-state">
                  <h3>Cargando mantenimientos...</h3>
                  <p>Estamos consultando los trabajos programados.</p>
                </div>
              ) : pendingMaintenances.length > 0 ? (
                <div className="maintenance-clean-list">
                  {pendingMaintenances.slice(0, 10).map((maintenance) => {
                    const urgency = getMaintenanceUrgency(maintenance.nextDate);

                    return (
                      <article
                        className={`maintenance-clean-row urgency-${urgency.level}`}
                        key={maintenance.id}
                      >
                        <div className="maintenance-clean-icon">{urgency.icon}</div>

                        <div className="maintenance-clean-main">
                          <span className="asset-tag">{maintenance.assetTag || "Sin código"}</span>
                          <h4>{maintenance.title || "Mantenimiento programado"}</h4>
                          <p>
                            {maintenance.assetName || "Sin equipo"} · {maintenance.assetCategory || "Sin categoría"}
                          </p>
                        </div>

                        <div className="maintenance-clean-meta">
                          <strong>{urgency.label}</strong>
                          <span>{formatMaintenanceDate(maintenance.nextDate)}</span>
                          <small>{maintenance.frequency || "Sin frecuencia"}</small>
                        </div>

                        <button
                          type="button"
                          className="visual-primary-button"
                          onClick={() => openCompletionForm(maintenance)}
                        >
                          Iniciar mantenimiento
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state compact-empty-state">
                  <h3>No hay mantenimientos pendientes</h3>
                  <p>Cuando un equipo requiera atención aparecerá aquí.</p>
                </div>
              )}
            </section>

            <aside className="maintenance-side-clean">
              <section className="maintenance-clean-card compact">
                <div className="maintenance-clean-card-header vertical">
                  <div>
                    <h3>Revisiones de ubicaciones</h3>
                    <p>
                      Se calculan automáticamente. No necesitas programarlas una por una.
                    </p>
                  </div>
                  <span>{pendingLocationReviews.length} pendientes</span>
                </div>

                {!loadingLocations && scheduledLocationReviews.length > 0 ? (
                  <div className="location-review-mini-list">
                    {scheduledLocationReviews.slice(0, 4).map((review) => {
                      const urgency = getMaintenanceUrgency(review.nextDate);

                      return (
                        <button
                          type="button"
                          className="location-review-mini-row"
                          key={`scheduled-location-mini-${review.location.id}`}
                          onClick={() => startLocationReviewFromSchedule(review.location)}
                        >
                          <span>{urgency.icon}</span>
                          <div>
                            <strong>{review.location.name}</strong>
                            <small>
                              {review.frequency} · {formatMaintenanceDate(review.nextDate)}
                            </small>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="maintenance-side-note">No hay revisiones de ubicación pendientes.</p>
                )}

                <button
                  type="button"
                  className="visual-outline-button full-width-button"
                  onClick={() => setActiveTab("ubicaciones-tecnicas")}
                >
                  Ver ubicaciones técnicas
                </button>
              </section>

              <section className="maintenance-clean-card compact">
                <div className="maintenance-clean-card-header vertical">
                  <div>
                    <h3>Cómo usar esta pantalla</h3>
                    <p>
                      Aquí solo se atienden trabajos. La programación automática nace desde el equipo y su frecuencia.
                    </p>
                  </div>
                </div>

                <div className="maintenance-guidance-list">
                  <p><strong>Iniciar mantenimiento</strong> abre el checklist y registra el trabajo.</p>
                  <p><strong>Programar mantenimiento</strong> queda dentro de la ficha del equipo, solo para ajustes.</p>
                  <p><strong>Movimiento</strong> queda para préstamos, bajas, reparaciones o cambios puntuales.</p>
                </div>
              </section>
            </aside>
          </div>
        </section>
      )}

      {!focusedSupportViewActive && activeTab === "recambios" && renderSparePartsPanel()}

      {!focusedSupportViewActive && activeTab === "instalaciones" && renderInstallationsPanel()}

      {!focusedSupportViewActive && activeTab === "equipos" && (
        <section className="technical-equipment-workspace">
          <div className="equipment-page-header">
            <div>
              <p className="section-kicker equipment-kicker">Inventario técnico</p>
              <h2>Equipos</h2>
              <p>
                Gestiona el inventario técnico sin saturar la pantalla. Haz clic en
                una tarjeta para abrir su ficha rápida.
              </p>
            </div>

            <div className="equipment-header-actions">
              <button
                className="visual-outline-button"
                type="button"
                onClick={printAllQrLabels}
                disabled={visibleAssets.length === 0}
              >
                Imprimir etiquetas activas
              </button>

              <button
                className="visual-primary-button"
                type="button"
                onClick={openCreateForm}
              >
                + Registrar equipo
              </button>
            </div>
          </div>

          <div className="equipment-quick-metrics">
            <article>
              <span className="equipment-metric-icon">▣</span>
              <div>
                <strong>{activeAssets}</strong>
                <p>Equipos activos</p>
                <small>En operación</small>
              </div>
            </article>

            <article>
              <span className="equipment-metric-icon orange">⌘</span>
              <div>
                <strong>{maintenanceAssets}</strong>
                <p>En mantenimiento</p>
                <small>Intervención programada</small>
              </div>
            </article>

            <article>
              <span className="equipment-metric-icon green">QR</span>
              <div>
                <strong>{assetsWithQr}</strong>
                <p>Con código QR</p>
                <small>Identificados</small>
              </div>
            </article>

            <article>
              <span className="equipment-metric-icon gray">i</span>
              <div>
                <strong>{totalAssets}</strong>
                <p>Equipos visibles</p>
                <small>Inventario activo</small>
              </div>
            </article>
          </div>

          <div className="equipment-filter-bar">
            <select
              value={campusFilter}
              onChange={(event) => setCampusFilter(event.target.value)}
              disabled={loadingAssets}
            >
              <option value="Todos">Todos los planteles</option>
              {campusFilterOptions.map((campus) => (
                <option key={campus} value={campus}>
                  {campus}
                </option>
              ))}
            </select>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              disabled={loadingAssets}
            >
              <option value="Todas">Todas las categorías</option>
              {ASSET_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            <select
              value={areaFilter}
              onChange={(event) => setAreaFilter(event.target.value)}
              disabled={loadingAssets}
            >
              <option value="Todas">Todas las áreas/ubicaciones</option>
              {areaFilterOptions.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>

            <select
              value={conditionFilter}
              onChange={(event) => setConditionFilter(event.target.value)}
              disabled={loadingAssets}
            >
              <option value="Todas">Condición: Todas</option>
              {ASSET_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  Condición: {condition}
                </option>
              ))}
            </select>

            <button
              className="visual-outline-button compact-filter-button"
              type="button"
              onClick={() => {
                setSearchTerm("");
                setCategoryFilter("Todas");
                setStatusFilter("Todos");
                setCampusFilter("Todos");
                setAreaFilter("Todas");
                setConditionFilter("Todas");
              }}
              disabled={loadingAssets}
            >
              Limpiar
            </button>
          </div>

          <div className="equipment-list-header">
            <div>
              <h3>Inventario registrado</h3>
              <p>
                {loadingAssets
                  ? "Cargando inventario técnico..."
                  : `Mostrando ${filteredAssets.length} de ${visibleAssets.length} equipos activos.`}
              </p>
            </div>

            <div className="equipment-list-actions">
              <button
                className="visual-outline-button"
                type="button"
                onClick={printAllQrLabels}
                disabled={visibleAssets.length === 0 || loadingAssets}
              >
                Imprimir etiquetas activas
              </button>

              <button
                className="visual-outline-button"
                type="button"
                onClick={() => setActiveTab("bajas")}
              >
                Ver bajas ({inactiveTechnicalAssets.length})
              </button>

              <button
                className="visual-outline-button"
                type="button"
                onClick={loadInitialData}
                disabled={loadingAssets || loadingMaintenances}
              >
                Actualizar
              </button>
            </div>
          </div>

          {loadingAssets ? (
            <div className="empty-state">
              <h3>Cargando inventario...</h3>
              <p>Estamos consultando los equipos registrados.</p>
            </div>
          ) : (
            <>
              <div className="equipment-list-table-wrap">
                <table className="equipment-list-table">
                  <thead>
                    <tr>
                      <th>Equipo</th>
                      <th>Ubicación</th>
                      <th>Categoría</th>
                      <th>Condición</th>
                      <th>Estatus</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.map((asset) => {
                      const cardStatusClass = String(asset.status || "")
                        .toLowerCase()
                        .replaceAll(" ", "-");
                      const conditionStatusClass = String(asset.condition || "")
                        .toLowerCase()
                        .replaceAll(" ", "-");

                      return (
                        <tr key={asset.id}>
                          <td>
                            <button
                              type="button"
                              className="equipment-list-name-button"
                              onClick={() => openQuickAssetPanel(asset)}
                            >
                              <span className="equipment-list-icon">
                                {getAssetCategoryIcon(asset.category)}
                              </span>
                              <span>
                                <strong>{asset.name || "Equipo sin nombre"}</strong>
                                <small>{asset.assetTag || "Sin código"}</small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <span className="equipment-list-location">
                              {normalizeCampusName(asset.campus)} · {asset.assignedTo || asset.area || "Sin ubicación"}
                            </span>
                            {asset.technicalLocationName && (
                              <small className="equipment-list-subline">
                                Ubicación técnica: {asset.technicalLocationName}
                              </small>
                            )}
                          </td>
                          <td>{asset.category || "Sin categoría"}</td>
                          <td>
                            <span className={`equipment-chip condition-${conditionStatusClass}`}>
                              {asset.condition || "Sin condición"}
                            </span>
                          </td>
                          <td>
                            <span className={`equipment-chip status-${cardStatusClass}`}>
                              {asset.status || "Sin estatus"}
                            </span>
                          </td>
                          <td>
                            <div className="equipment-list-actions-cell">
                              <button type="button" onClick={() => openQuickAssetPanel(asset)}>
                                Ver ficha
                              </button>
                              <button type="button" onClick={() => startQuickMaintenance(asset)}>
                                Iniciar mantenimiento
                              </button>
                              <button
                                type="button"
                                className="danger-table-button"
                                onClick={() => handleDeleteAsset(asset)}
                              >
                                Eliminar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredAssets.length === 0 && (
                <div className="empty-state">
                  <h3>No se encontraron equipos</h3>
                  <p>
                    {visibleAssets.length === 0
                      ? "Todavía no hay equipos registrados. Presiona “+ Registrar equipo” para agregar el primero."
                      : "Prueba cambiando los filtros o el texto de búsqueda."}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function buildMergedOptionList(defaultOptions, dynamicOptions = []) {
  const normalizedDefaults = Array.isArray(defaultOptions) ? defaultOptions : [];
  const merged = [...normalizedDefaults];

  dynamicOptions
    .map((option) => String(option || "").trim())
    .filter(Boolean)
    .forEach((option) => {
      if (!merged.some((current) => current.toLowerCase() === option.toLowerCase())) {
        merged.splice(Math.max(merged.length - 1, 0), 0, option);
      }
    });

  if (!merged.includes("Otro")) {
    merged.push("Otro");
  }

  return merged;
}

function getEditableOptionFields(value, defaultOptions) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return {
      value: defaultOptions[0] || "Otro",
      other: "",
    };
  }

  const existingOption = defaultOptions.find(
    (option) => option.toLowerCase() === normalizedValue.toLowerCase()
  );

  if (existingOption) {
    return {
      value: existingOption,
      other: "",
    };
  }

  return {
    value: "Otro",
    other: normalizedValue,
  };
}

function formatCompatibleModels(value) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "Sin compatibilidad registrada";
  }

  return String(value || "").trim() || "Sin compatibilidad registrada";
}

function formatSpareMovementType(type = "") {
  const labels = {
    entry: "Entrada",
    exit: "Salida",
    adjustment: "Ajuste",
  };

  return labels[type] || "Movimiento";
}

function formatSpareMovementQuantity(movement) {
  const quantity = Number(movement?.quantity || 0);
  const unit = movement?.unit || "pieza";

  if (movement?.type === "entry") {
    return `+${quantity} ${unit}`;
  }

  if (movement?.type === "exit") {
    return `-${quantity} ${unit}`;
  }

  return `Existencia final: ${Number(movement?.newQuantity || 0)} ${unit}`;
}

function normalizeCampusName(campus = "") {
  const originalCampus = String(campus || "").trim();

  if (!originalCampus) {
    return "Sin plantel";
  }

  const normalized = originalCampus
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    normalized.includes("estrella") ||
    normalized.includes("plaza est") ||
    normalized === "est"
  ) {
    return "Plaza Estrella";
  }

  if (
    normalized.includes("bugambilias") ||
    normalized.includes("bugambilia") ||
    normalized.includes("bugabuga") ||
    normalized.includes("buga")
  ) {
    return "Plaza Bugambilias";
  }

  if (normalized.includes("aranjuez")) {
    return "Plaza Aranjuez";
  }

  if (
    normalized.includes("coffee") ||
    normalized.includes("beans") ||
    normalized.includes("factory") ||
    normalized.includes("cafe")
  ) {
    return "Coffee Beans Factory";
  }

  return originalCampus;
}

function getUniqueAssetValues(assets, fieldName) {
  return Array.from(
    new Set(
      assets
        .map((asset) => String(asset?.[fieldName] || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));
}

function getAssetCategoryIcon(category = "") {
  const icons = {
    Computadora: "▣",
    Laptop: "▱",
    Monitor: "▣",
    Impresora: "▤",
    Cámara: "◉",
    "DVR/NVR": "▥",
    Pantalla: "▭",
    Router: "⌁",
    Switch: "⇄",
    "Access Point": "⌁",
    "No-break": "⚡",
    Bocina: "♪",
    Proyector: "▭",
    Otro: "i",
  };

  return icons[category] || "i";
}

function getChecklistProgress(checklist) {
  if (!Array.isArray(checklist) || checklist.length === 0) {
    return 0;
  }

  const completedItems = checklist.filter((item) => item.checked).length;

  return Math.round((completedItems / checklist.length) * 100);
}

function normalizeCompletionChecklistItem(item) {
  if (typeof item === "string") {
    return {
      label: item.trim(),
      checked: false,
      note: "",
    };
  }

  const label = String(
    item?.label ||
      item?.title ||
      item?.name ||
      item?.text ||
      item?.description ||
      ""
  ).trim();

  return {
    label,
    checked: Boolean(item?.checked),
    note: String(item?.note || item?.notes || item?.observation || "").trim(),
  };
}

function normalizeCompletionChecklistList(checklist) {
  if (!Array.isArray(checklist)) {
    return [];
  }

  return checklist
    .map((item) => normalizeCompletionChecklistItem(item))
    .filter((item) => item.label);
}

function getFallbackMaintenanceChecklist() {
  return [
    "Equipo físicamente presente",
    "Equipo enciende correctamente",
    "Funcionamiento general revisado",
    "Conexiones revisadas",
    "Limpieza básica realizada",
    "Observaciones registradas",
    "Equipo listo para uso",
  ].map((label) => ({ label, checked: false, note: "" }));
}

function buildChecklistForCompletion(maintenance, relatedAsset = null) {
  const sourceMaintenance = maintenance || {};

  const possibleSavedChecklists = [
    sourceMaintenance.checklistTemplate,
    sourceMaintenance.maintenanceChecklistTemplate,
    sourceMaintenance.maintenanceChecklist,
    sourceMaintenance.checklistBase,
    sourceMaintenance.baseChecklist,
    sourceMaintenance.templateChecklist,
    sourceMaintenance.checklist,
    sourceMaintenance.items,
  ];

  for (const checklistSource of possibleSavedChecklists) {
    const normalizedChecklist = normalizeCompletionChecklistList(checklistSource);

    if (normalizedChecklist.length > 0) {
      return normalizedChecklist;
    }
  }

  const assetForDefault = relatedAsset || {
    id: sourceMaintenance.assetId || "",
    name: sourceMaintenance.assetName || "",
    category: sourceMaintenance.assetCategory || sourceMaintenance.category || "Otro",
    campus: sourceMaintenance.campus || "",
    area: sourceMaintenance.area || "",
    assignedTo:
      sourceMaintenance.assetAssignedTo ||
      sourceMaintenance.assetLocation ||
      sourceMaintenance.assetAssignedLocation ||
      sourceMaintenance.assignedTo ||
      "",
    technicalLocationName: sourceMaintenance.technicalLocationName || "",
    technicalLocationType: sourceMaintenance.technicalLocationType || "",
    notes: sourceMaintenance.notes || "",
  };

  const serviceDefaultChecklist = normalizeCompletionChecklistList(
    getDefaultMaintenanceChecklistForAsset(
      assetForDefault,
      sourceMaintenance.title || "Mantenimiento preventivo"
    )
  );

  if (serviceDefaultChecklist.length > 0) {
    return serviceDefaultChecklist;
  }

  return getFallbackMaintenanceChecklist();
}

function getSuggestedMaintenanceTitle(asset) {
  const category = asset?.category || "Equipo";
  const text = `${asset?.name || ""} ${asset?.area || ""} ${asset?.assignedTo || ""} ${asset?.technicalLocationName || ""} ${asset?.technicalLocationType || ""}`.toLowerCase();

  if (category === "Computadora" && (text.includes("cabina") || text.includes("online") || text.includes("en línea") || text.includes("en linea"))) {
    return "Revisión preventiva de computadora de cabina online";
  }

  if (category === "Computadora" && (text.includes("salón") || text.includes("salon") || text.includes("aula"))) {
    return "Revisión preventiva de computadora de salón";
  }

  if (category === "Computadora") return "Mantenimiento preventivo de computadora";
  if (category === "Laptop") return "Mantenimiento preventivo de laptop";
  if (category === "Impresora") return "Mantenimiento preventivo de impresora";
  if (category === "Cámara") return "Revisión preventiva de cámara";
  if (category === "DVR/NVR") return "Revisión preventiva de DVR/NVR";
  if (["Router", "Switch", "Access Point"].includes(category)) return `Revisión preventiva de ${category.toLowerCase()}`;
  if (category === "No-break") return "Prueba preventiva de no-break";
  if (["Pantalla", "Monitor"].includes(category)) return `Revisión preventiva de ${category.toLowerCase()}`;
  if (category === "Bocina") return "Revisión preventiva de bocina";
  if (category === "Proyector") return "Mantenimiento preventivo de proyector";

  return "Revisión preventiva general";
}

function getSuggestedMaintenanceFrequency(asset) {
  const category = asset?.category || "Otro";
  const text = `${asset?.name || ""} ${asset?.area || ""} ${asset?.assignedTo || ""} ${asset?.technicalLocationName || ""} ${asset?.technicalLocationType || ""}`.toLowerCase();

  if (category === "Computadora" && (text.includes("cabina") || text.includes("online") || text.includes("en línea") || text.includes("en linea"))) return "Cada 15 días";
  if (category === "Impresora" && (text.includes("recepción") || text.includes("recepcion") || text.includes("administración") || text.includes("administracion"))) return "Cada 15 días";
  if (["Laptop", "Impresora", "DVR/NVR", "Router", "Switch", "Access Point", "Proyector"].includes(category)) return "Cada mes";
  if (category === "Computadora") return "Cada 2 meses";
  return "Cada 3 meses";
}

function getSuggestedMaintenanceDays(asset) {
  const frequency = getSuggestedMaintenanceFrequency(asset);

  if (frequency === "Cada 15 días") return 15;
  if (frequency === "Cada mes") return 30;
  if (frequency === "Cada 2 meses") return 60;
  if (frequency === "Cada 3 meses") return 90;
  if (frequency === "Cada 6 meses") return 180;
  if (frequency === "Cada año") return 365;

  return 90;
}

function getSuggestedMaintenanceNextDate(asset) {
  const date = new Date();
  date.setDate(date.getDate() + getSuggestedMaintenanceDays(asset));
  return date.toISOString().slice(0, 10);
}

function getSuggestedMaintenanceDescription(asset) {
  const category = asset?.category || "equipo";
  const checklist = getDefaultMaintenanceChecklistForAsset(asset, getSuggestedMaintenanceTitle(asset));
  const mainPoints = checklist
    .slice(0, 6)
    .map((item) => item.label)
    .filter(Boolean)
    .join(", ");

  return `Revisión preventiva de ${String(category).toLowerCase()}: ${mainPoints}. Puedes editar, eliminar, agregar o reordenar los puntos antes de guardar.`;
}

function getLocationReviewCadence(location) {
  const cadence =
    LOCATION_REVIEW_CADENCE_BY_TYPE[location?.type || "Otro"] ||
    LOCATION_REVIEW_CADENCE_BY_TYPE.Otro;

  return {
    frequency: location?.reviewFrequency || cadence.frequency,
    days: Number(location?.reviewIntervalDays || cadence.days),
  };
}

function toDateFromFirestoreOrString(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function getDateStringAfterDays(baseDate, daysToAdd) {
  const date = baseDate ? new Date(baseDate) : new Date();
  date.setDate(date.getDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

function buildScheduledLocationReview(location) {
  const cadence = getLocationReviewCadence(location);
  const lastReviewDate = toDateFromFirestoreOrString(
    location?.lastReviewAt || location?.updatedAt || location?.createdAt
  );

  const storedNextDate = String(location?.nextReviewDate || "").trim();

  return {
    location,
    frequency: cadence.frequency,
    intervalDays: cadence.days,
    nextDate: storedNextDate || (lastReviewDate
      ? getDateStringAfterDays(lastReviewDate, cadence.days)
      : new Date().toISOString().slice(0, 10)),
  };
}

function getAssetIdFromCurrentUrl() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashQuery = String(window.location.hash || "").includes("?")
    ? String(window.location.hash).split("?").slice(1).join("?")
    : "";
  const hashParams = new URLSearchParams(hashQuery);

  return (
    searchParams.get("assetId") ||
    searchParams.get("asset") ||
    searchParams.get("technicalAssetId") ||
    hashParams.get("assetId") ||
    hashParams.get("asset") ||
    hashParams.get("technicalAssetId") ||
    ""
  );
}

function hasStatusChange(log) {
  return Boolean(log?.previousStatus || log?.newStatus);
}

function hasConditionChange(log) {
  return Boolean(log?.previousCondition || log?.newCondition);
}

function getMovementTypeLabel(type = "") {
  const labels = {
    ASSET_CREATED: "Registro automático",
    ASSET_UPDATED: "Actualización automática",
    TECHNICAL_MOVEMENT: "Movimiento técnico",
  };

  return labels[type] || type || "Movimiento técnico";
}

function getMovementIcon(type = "") {
  if (type === "ASSET_CREATED") return "＋";
  if (type === "ASSET_UPDATED") return "✎";

  const normalizedType = String(type).toLowerCase();

  if (normalizedType.includes("preventivo")) return "🛠";
  if (normalizedType.includes("correctivo")) return "⚙";
  if (normalizedType.includes("reparación")) return "🔧";
  if (normalizedType.includes("pieza")) return "▣";
  if (normalizedType.includes("limpieza")) return "✦";
  if (normalizedType.includes("configuración")) return "⌘";
  if (normalizedType.includes("instalación")) return "⬇";
  if (normalizedType.includes("revisión")) return "◎";
  if (normalizedType.includes("préstamo")) return "↗";
  if (normalizedType.includes("devolución")) return "↙";
  if (normalizedType.includes("baja")) return "!";
  return "•";
}

function formatInstallationItemDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }

  return date.toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatLogDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  if (value instanceof Date) {
    return value.toLocaleString("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  return "Sin fecha";
}

function formatMaintenanceDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("es-MX", {
    dateStyle: "medium",
  });
}

function getMaintenanceUrgency(value) {
  if (!value) {
    return {
      level: "unknown",
      label: "Sin fecha",
      icon: "•",
      days: null,
    };
  }

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const maintenanceDate = new Date(`${value}T00:00:00`);

  if (Number.isNaN(maintenanceDate.getTime())) {
    return {
      level: "unknown",
      label: "Sin fecha",
      icon: "•",
      days: null,
    };
  }

  const differenceInDays = Math.round(
    (maintenanceDate.getTime() - startOfToday.getTime()) / 86400000
  );

  if (differenceInDays < 0) {
    return {
      level: "overdue",
      label: `Vencido hace ${Math.abs(differenceInDays)} día${
        Math.abs(differenceInDays) === 1 ? "" : "s"
      }`,
      icon: "⚠",
      days: differenceInDays,
    };
  }

  if (differenceInDays === 0) {
    return {
      level: "today",
      label: "Vence hoy",
      icon: "◷",
      days: 0,
    };
  }

  if (differenceInDays <= 7) {
    return {
      level: "soon",
      label: `Vence en ${differenceInDays} día${
        differenceInDays === 1 ? "" : "s"
      }`,
      icon: "📅",
      days: differenceInDays,
    };
  }

  return {
    level: "future",
    label: `En ${differenceInDays} días`,
    icon: "🛠",
    days: differenceInDays,
  };
}

function isMaintenanceOverdue(value) {
  return getMaintenanceUrgency(value).level === "overdue";
}


function getUniqueLocationValues(locations, fieldName) {
  return Array.from(
    new Set(
      locations
        .map((location) => String(location?.[fieldName] || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "es"));
}

function isAssetAssignedToTechnicalLocation(asset, location) {
  if (!asset?.id || !location?.id) return false;

  if (asset.technicalLocationId && asset.technicalLocationId === location.id) {
    return true;
  }

  const assetCampus = normalizeCampusName(asset.campus || "").toLowerCase();
  const locationCampus = normalizeCampusName(location.campus || "").toLowerCase();
  const assetAssigned = String(asset.assignedTo || "").trim().toLowerCase();
  const assetArea = String(asset.area || "").trim().toLowerCase();
  const locationName = String(location.name || "").trim().toLowerCase();
  const locationArea = String(location.area || "").trim().toLowerCase();

  return Boolean(
    locationName &&
      assetCampus === locationCampus &&
      (assetAssigned === locationName ||
        (assetAssigned.includes(locationName) && locationName.length >= 4) ||
        (assetArea && locationArea && assetArea === locationArea && assetAssigned === locationName))
  );
}

function isMaintenanceAssignedToTechnicalLocation(
  maintenance,
  location,
  locationAssets = []
) {
  if (!maintenance?.id || !location?.id) return false;

  if (
    maintenance.technicalLocationId &&
    maintenance.technicalLocationId === location.id
  ) {
    return true;
  }

  return locationAssets.some((asset) => asset.id === maintenance.assetId);
}

function getLocationStatusClass(status = "") {
  const normalizedStatus = String(status).toLowerCase();

  if (normalizedStatus.includes("correcto")) return "correct";
  if (normalizedStatus.includes("atención")) return "attention";
  if (normalizedStatus.includes("pendiente")) return "pending";
  if (normalizedStatus.includes("inactivo")) return "inactive";

  return "pending";
}

function getLocationTypeIcon(type = "") {
  const normalizedType = String(type).toLowerCase();

  if (normalizedType.includes("cabina")) return "🎧";
  if (normalizedType.includes("sal")) return "▣";
  if (normalizedType.includes("recepción") || normalizedType.includes("recepcion")) {
    return "☷";
  }
  if (normalizedType.includes("coffee") || normalizedType.includes("café") || normalizedType.includes("cafe")) {
    return "☕";
  }
  if (normalizedType.includes("oficina")) return "▤";

  return "⌖";
}

function scrollToTop() {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}
