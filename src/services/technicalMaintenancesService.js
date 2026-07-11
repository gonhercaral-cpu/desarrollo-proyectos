import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { createTechnicalAssetMovement } from "./technicalAssetsService";

const TECHNICAL_MAINTENANCES_COLLECTION = "technicalMaintenances";

export async function getTechnicalMaintenances() {
  const maintenancesRef = collection(db, TECHNICAL_MAINTENANCES_COLLECTION);

  const q = query(maintenancesRef, orderBy("nextDate", "asc"));

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

export async function getTechnicalMaintenancesByAsset(assetId) {
  if (!assetId) {
    throw new Error("Falta el ID del equipo.");
  }

  const maintenancesRef = collection(db, TECHNICAL_MAINTENANCES_COLLECTION);

  const q = query(
    maintenancesRef,
    where("assetId", "==", assetId),
    orderBy("nextDate", "asc")
  );

  const snapshot = await getDocs(q);

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
}

function normalizeChecklist(checklist) {
  if (!Array.isArray(checklist)) {
    return [];
  }

  return checklist
    .map((item) => {
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
    })
    .filter((item) => item.label);
}

function getChecklistFromMaintenanceData(maintenanceData, asset) {
  const possibleChecklists = [
    maintenanceData?.checklistTemplate,
    maintenanceData?.maintenanceChecklistTemplate,
    maintenanceData?.maintenanceChecklist,
    maintenanceData?.checklistBase,
    maintenanceData?.baseChecklist,
    maintenanceData?.templateChecklist,
    maintenanceData?.checklistItems,
    maintenanceData?.checklist,
    maintenanceData?.items,
  ];

  for (const checklist of possibleChecklists) {
    const normalizedChecklist = normalizeChecklist(checklist);

    if (normalizedChecklist.length > 0) {
      return normalizedChecklist;
    }
  }

  const assetBaseChecklist = normalizeChecklist(
    asset?.maintenanceChecklistTemplate || asset?.checklistTemplate || asset?.checklistBase
  );

  if (assetBaseChecklist.length > 0) {
    return assetBaseChecklist;
  }

  return getDefaultMaintenanceChecklistForAsset(
    asset,
    maintenanceData?.title || "Mantenimiento preventivo"
  );
}

export async function createTechnicalMaintenance(
  asset,
  maintenanceData,
  currentUserProfile
) {
  if (!asset?.id) {
    throw new Error("Falta el ID del equipo.");
  }

  if (!maintenanceData) {
    throw new Error("No se recibió la información del mantenimiento.");
  }

  if (!maintenanceData.title?.trim()) {
    throw new Error("El título del mantenimiento es obligatorio.");
  }

  if (!maintenanceData.nextDate) {
    throw new Error("La fecha del próximo mantenimiento es obligatoria.");
  }

  const maintenancesRef = collection(db, TECHNICAL_MAINTENANCES_COLLECTION);
  const checklistTemplate = getChecklistFromMaintenanceData(maintenanceData, asset);

  const newMaintenance = {
    assetId: asset.id,
    assetTag: asset.assetTag || "",
    assetName: asset.name || "",
    assetCategory: asset.category || "",
    campus: asset.campus || "",
    area: asset.area || "",
    technicalLocationId: asset.technicalLocationId || "",
    technicalLocationName: asset.technicalLocationName || "",
    technicalLocationType: asset.technicalLocationType || "",
    assetStatus: asset.status || "",
    assetDeleted: asset.deleted === true || asset.status === "Eliminado",
    assetCondition: asset.condition || "",

    title: maintenanceData.title.trim(),
    description: maintenanceData.description?.trim() || "",
    frequency: maintenanceData.frequency || "Una vez",
    nextDate: maintenanceData.nextDate,
    assignedTo: maintenanceData.assignedTo?.trim() || "Soporte Técnico",
    status: maintenanceData.status || "Programado",

    // Se guarda con varios nombres para mantener compatibilidad con flujos anteriores
    // y asegurar que la ficha técnica, la pestaña de mantenimientos y el cierre
    // lean exactamente el mismo checklist editado.
    checklistTemplate,
    maintenanceChecklistTemplate: checklistTemplate,
    maintenanceChecklist: checklistTemplate,
    checklistBase: checklistTemplate,
    baseChecklist: checklistTemplate,
    templateChecklist: checklistTemplate,
    checklistItems: checklistTemplate,
    checklist: checklistTemplate,

    createdBy: currentUserProfile?.name || "",
    createdByEmail: currentUserProfile?.email || "",
    createdById: currentUserProfile?.uid || currentUserProfile?.id || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
    completedBy: "",
    completedById: "",
  };

  const documentRef = await addDoc(maintenancesRef, newMaintenance);

  return {
    id: documentRef.id,
    ...newMaintenance,
  };
}

export async function updateTechnicalMaintenance(
  maintenanceId,
  maintenanceData
) {
  if (!maintenanceId) {
    throw new Error("Falta el ID del mantenimiento.");
  }

  if (!maintenanceData) {
    throw new Error("No se recibió la información del mantenimiento.");
  }

  const maintenanceRef = doc(
    db,
    TECHNICAL_MAINTENANCES_COLLECTION,
    maintenanceId
  );

  const updatedMaintenance = {
    title: maintenanceData.title?.trim() || "",
    description: maintenanceData.description?.trim() || "",
    frequency: maintenanceData.frequency || "Una vez",
    nextDate: maintenanceData.nextDate || "",
    assignedTo: maintenanceData.assignedTo?.trim() || "Soporte Técnico",
    status: maintenanceData.status || "Programado",
    checklistTemplate: getChecklistFromMaintenanceData(
      maintenanceData,
      {
        id: maintenanceData.assetId || "",
        name: maintenanceData.assetName || "",
        category: maintenanceData.assetCategory || "Otro",
        campus: maintenanceData.campus || "",
        area: maintenanceData.area || "",
        assignedTo: maintenanceData.assetAssignedTo || maintenanceData.assignedTo || "",
        technicalLocationName: maintenanceData.technicalLocationName || "",
        technicalLocationType: maintenanceData.technicalLocationType || "",
      }
    ),
    checklistBase: getChecklistFromMaintenanceData(
      maintenanceData,
      {
        id: maintenanceData.assetId || "",
        name: maintenanceData.assetName || "",
        category: maintenanceData.assetCategory || "Otro",
        campus: maintenanceData.campus || "",
        area: maintenanceData.area || "",
        assignedTo: maintenanceData.assetAssignedTo || maintenanceData.assignedTo || "",
        technicalLocationName: maintenanceData.technicalLocationName || "",
        technicalLocationType: maintenanceData.technicalLocationType || "",
      }
    ),
    maintenanceChecklistTemplate: getChecklistFromMaintenanceData(
      maintenanceData,
      {
        id: maintenanceData.assetId || "",
        name: maintenanceData.assetName || "",
        category: maintenanceData.assetCategory || "Otro",
        campus: maintenanceData.campus || "",
        area: maintenanceData.area || "",
        assignedTo: maintenanceData.assetAssignedTo || maintenanceData.assignedTo || "",
        technicalLocationName: maintenanceData.technicalLocationName || "",
        technicalLocationType: maintenanceData.technicalLocationType || "",
      }
    ),
    checklist: getChecklistFromMaintenanceData(
      maintenanceData,
      {
        id: maintenanceData.assetId || "",
        name: maintenanceData.assetName || "",
        category: maintenanceData.assetCategory || "Otro",
        campus: maintenanceData.campus || "",
        area: maintenanceData.area || "",
        assignedTo: maintenanceData.assetAssignedTo || maintenanceData.assignedTo || "",
        technicalLocationName: maintenanceData.technicalLocationName || "",
        technicalLocationType: maintenanceData.technicalLocationType || "",
      }
    ),
    updatedAt: serverTimestamp(),
  };

  await updateDoc(maintenanceRef, updatedMaintenance);

  return {
    id: maintenanceId,
    ...updatedMaintenance,
  };
}

export async function completeTechnicalMaintenance(
  maintenance,
  completionData,
  currentUserProfile
) {
  if (!maintenance?.id) {
    throw new Error("Falta el ID del mantenimiento.");
  }

  if (!maintenance.assetId) {
    throw new Error("Falta el ID del equipo relacionado.");
  }

  const maintenanceRef = doc(
    db,
    TECHNICAL_MAINTENANCES_COLLECTION,
    maintenance.id
  );

  const completedChecklist = normalizeChecklist(completionData?.checklist);

  const completedMaintenance = {
    status: "Realizado",
    checklist: completedChecklist,
    checklistCompleted: completedChecklist,
    completionTitle:
      completionData?.title?.trim() ||
      maintenance.title ||
      "Mantenimiento realizado",
    completionDescription:
      completionData?.description?.trim() ||
      maintenance.description ||
      "Se realizó el mantenimiento programado.",
    completedAt: serverTimestamp(),
    completedBy: currentUserProfile?.name || "",
    completedById: currentUserProfile?.uid || currentUserProfile?.id || "",
    updatedAt: serverTimestamp(),
  };

  await updateDoc(maintenanceRef, completedMaintenance);

  await createTechnicalAssetMovement(
    {
      id: maintenance.assetId,
      assetTag: maintenance.assetTag || "",
      name: maintenance.assetName || "",
      technicalLocationId: maintenance.technicalLocationId || "",
      technicalLocationName: maintenance.technicalLocationName || "",
      technicalLocationType: maintenance.technicalLocationType || "",
      status: maintenance.assetStatus || "",
      condition: maintenance.assetCondition || "",
    },
    {
      type: "Mantenimiento preventivo",
      title: completedMaintenance.completionTitle,
      description: completedMaintenance.completionDescription,
      status: completionData?.status || "",
      condition: completionData?.condition || "",
      checklist: completedChecklist,
    },
    currentUserProfile
  );

  return {
    id: maintenance.id,
    ...maintenance,
    ...completedMaintenance,
  };
}

const CHECKLIST_LIBRARY = {
  onlineComputer: [
    "Equipo físicamente presente",
    "Computadora enciende correctamente",
    "Monitor funciona correctamente",
    "Teclado presente y funcionando",
    "Mouse presente y funcionando",
    "Internet estable",
    "Cámara/webcam funciona",
    "Micrófono funciona",
    "Audio funciona correctamente",
    "Programas necesarios instalados",
    "Programas actualizados",
    "Navegador funcionando",
    "Plataforma online funcionando",
    "Accesos o cuentas configuradas",
    "Cableado ordenado",
    "Equipo listo para clase en línea",
  ],
  classroomComputer: [
    "Equipo físicamente presente",
    "Computadora enciende correctamente",
    "Monitor o pantalla funciona",
    "Teclado presente y funcionando",
    "Mouse presente y funcionando",
    "Internet estable",
    "Audio funciona correctamente",
    "Programas necesarios instalados",
    "Programas actualizados",
    "Material o accesos de clase disponibles",
    "Cableado ordenado",
    "Equipo listo para impartir clase",
  ],
  computer: [
    "Equipo físicamente presente",
    "Computadora enciende correctamente",
    "Monitor, teclado y mouse funcionan",
    "Internet estable",
    "Disco y memoria revisados",
    "Temperatura revisada",
    "Antivirus o seguridad revisada",
    "Programas necesarios instalados",
    "Programas actualizados",
    "Limpieza física realizada",
    "Equipo listo para uso",
  ],
  laptop: [
    "Equipo físicamente presente",
    "Laptop enciende correctamente",
    "Cargador presente y funcionando",
    "Batería revisada",
    "Internet estable",
    "Audio y cámara funcionan",
    "Programas necesarios instalados",
    "Programas actualizados",
    "Temperatura revisada",
    "Limpieza física realizada",
    "Equipo listo para uso",
  ],
  printer: [
    "Equipo físicamente presente",
    "Impresora enciende correctamente",
    "Conexión USB o red funcionando",
    "Tóner o tinta suficiente",
    "Bandejas funcionando",
    "Rodillos revisados",
    "Sin atascos de papel",
    "Prueba de impresión correcta",
    "Calidad de impresión aceptable",
    "Insumos revisados",
    "Equipo listo para uso",
  ],
  camera: [
    "Equipo físicamente presente",
    "Cámara encendida o conectada",
    "Imagen visible correctamente",
    "Lente limpio",
    "Ángulo o enfoque correcto",
    "Visión nocturna revisada",
    "Cableado o conexión revisada",
    "Equipo listo para uso",
  ],
  dvr: [
    "Equipo físicamente presente",
    "DVR/NVR enciende correctamente",
    "Disco duro detectado",
    "Grabación funcionando",
    "Fecha y hora correctas",
    "Cámaras conectadas visibles",
    "Acceso remoto revisado",
    "Ventilación correcta",
    "Equipo listo para uso",
  ],
  network: [
    "Equipo físicamente presente",
    "Equipo enciende correctamente",
    "Conexión a internet funcionando",
    "Cableado revisado",
    "Puertos o conexiones revisadas",
    "Velocidad o estabilidad revisada",
    "Ubicación y ventilación correctas",
    "Reinicio preventivo realizado si aplica",
    "Equipo listo para uso",
  ],
  nobreak: [
    "Equipo físicamente presente",
    "No-break enciende correctamente",
    "Batería revisada",
    "Carga revisada",
    "Tiempo de respaldo probado",
    "Conexiones revisadas",
    "Estado físico revisado",
    "Equipo listo para uso",
  ],
  display: [
    "Equipo físicamente presente",
    "Equipo enciende correctamente",
    "Imagen visible correctamente",
    "Entradas HDMI/USB revisadas",
    "Control remoto o botones funcionan",
    "Audio revisado si aplica",
    "Montaje o base estable",
    "Limpieza física realizada",
    "Equipo listo para uso",
  ],
  audio: [
    "Equipo físicamente presente",
    "Equipo enciende correctamente",
    "Audio funcionando",
    "Volumen revisado",
    "Cables y conectores revisados",
    "Fuente de energía revisada",
    "Limpieza física realizada",
    "Equipo listo para uso",
  ],
  projector: [
    "Equipo físicamente presente",
    "Proyector enciende correctamente",
    "Imagen y enfoque correctos",
    "Entradas de video revisadas",
    "Control remoto funciona",
    "Ventilación revisada",
    "Lámpara revisada",
    "Limpieza física realizada",
    "Equipo listo para uso",
  ],
  generic: [
    "Equipo físicamente presente",
    "Equipo enciende correctamente",
    "Funcionamiento general revisado",
    "Conexiones revisadas",
    "Limpieza básica realizada",
    "Observaciones registradas",
    "Equipo listo para uso",
  ],
};

function toChecklist(items) {
  return items.map((label) => ({ label, checked: false, note: "" }));
}

function normalizeAssetText(asset) {
  return [
    asset?.name,
    asset?.category,
    asset?.campus,
    asset?.area,
    asset?.assignedTo,
    asset?.technicalLocationName,
    asset?.technicalLocationType,
    asset?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isOnlineBoothAsset(asset) {
  const text = normalizeAssetText(asset);

  return (
    text.includes("cabina") ||
    text.includes("online") ||
    text.includes("en línea") ||
    text.includes("en linea")
  );
}

function isClassroomAsset(asset) {
  const text = normalizeAssetText(asset);

  return (
    text.includes("salón") ||
    text.includes("salon") ||
    text.includes("aula") ||
    text.includes("classroom")
  );
}

function isHighUsePrinter(asset) {
  const text = normalizeAssetText(asset);

  return (
    text.includes("imprenta") ||
    text.includes("recepción") ||
    text.includes("recepcion") ||
    text.includes("administración") ||
    text.includes("administracion") ||
    text.includes("certificados") ||
    text.includes("libros")
  );
}

export function getDefaultMaintenanceChecklistForAsset(asset, title = "") {
  const category = asset?.category || "Otro";
  const normalizedTitle = String(title).toLowerCase();

  if (category === "Computadora" && isOnlineBoothAsset(asset)) {
    return toChecklist(CHECKLIST_LIBRARY.onlineComputer);
  }

  if (category === "Computadora" && isClassroomAsset(asset)) {
    return toChecklist(CHECKLIST_LIBRARY.classroomComputer);
  }

  if (category === "Computadora") return toChecklist(CHECKLIST_LIBRARY.computer);
  if (category === "Laptop") return toChecklist(CHECKLIST_LIBRARY.laptop);
  if (category === "Impresora") return toChecklist(CHECKLIST_LIBRARY.printer);
  if (category === "Cámara") return toChecklist(CHECKLIST_LIBRARY.camera);
  if (category === "DVR/NVR") return toChecklist(CHECKLIST_LIBRARY.dvr);
  if (["Router", "Switch", "Access Point"].includes(category)) {
    return toChecklist(CHECKLIST_LIBRARY.network);
  }
  if (category === "No-break") return toChecklist(CHECKLIST_LIBRARY.nobreak);
  if (["Pantalla", "Monitor"].includes(category)) {
    return toChecklist(CHECKLIST_LIBRARY.display);
  }
  if (category === "Bocina") return toChecklist(CHECKLIST_LIBRARY.audio);
  if (category === "Proyector") return toChecklist(CHECKLIST_LIBRARY.projector);

  if (normalizedTitle.includes("impresora")) return toChecklist(CHECKLIST_LIBRARY.printer);
  if (normalizedTitle.includes("red")) return toChecklist(CHECKLIST_LIBRARY.network);

  return toChecklist(CHECKLIST_LIBRARY.generic);
}

const DEFAULT_MAINTENANCE_PLANS = {
  Computadora: [
    {
      title: "Mantenimiento preventivo de computadora",
      description:
        "Limpieza física, revisión de disco, memoria RAM, temperatura, antivirus, actualizaciones, periféricos, programas necesarios y funcionamiento general.",
      frequency: "Cada 2 meses",
      daysToAdd: 60,
    },
  ],

  Laptop: [
    {
      title: "Mantenimiento preventivo de laptop",
      description:
        "Limpieza física, revisión de batería, cargador, temperatura, disco, memoria RAM, actualizaciones, programas necesarios y funcionamiento general.",
      frequency: "Cada mes",
      daysToAdd: 30,
    },
  ],

  Impresora: [
    {
      title: "Mantenimiento preventivo de impresora",
      description:
        "Limpieza general, revisión de rodillos, tóner o tinta, bandejas, calidad de impresión, conexión de red/USB y prueba de impresión.",
      frequency: "Cada mes",
      daysToAdd: 30,
    },
  ],

  Cámara: [
    {
      title: "Revisión preventiva de cámara",
      description:
        "Limpieza de lente, revisión de enfoque, ángulo de visión, conexión, imagen, visión nocturna y funcionamiento general.",
      frequency: "Cada 3 meses",
      daysToAdd: 90,
    },
  ],

  "DVR/NVR": [
    {
      title: "Revisión preventiva de DVR/NVR",
      description:
        "Revisión de grabación, disco duro, fecha y hora, cámaras conectadas, acceso remoto, ventilación y funcionamiento general.",
      frequency: "Cada mes",
      daysToAdd: 30,
    },
  ],

  Pantalla: [
    {
      title: "Revisión preventiva de pantalla",
      description:
        "Limpieza exterior, revisión de imagen, entradas HDMI/USB, control remoto, montaje, audio y funcionamiento general.",
      frequency: "Cada 3 meses",
      daysToAdd: 90,
    },
  ],

  Router: [
    {
      title: "Revisión preventiva de router",
      description:
        "Revisión de conexión, velocidad, cableado, reinicio preventivo, ubicación, ventilación y funcionamiento general del router.",
      frequency: "Cada mes",
      daysToAdd: 30,
    },
  ],

  Switch: [
    {
      title: "Revisión preventiva de switch",
      description:
        "Revisión de puertos, cableado, velocidad de red, ventilación, alimentación eléctrica y funcionamiento general.",
      frequency: "Cada mes",
      daysToAdd: 30,
    },
  ],

  "Access Point": [
    {
      title: "Revisión preventiva de access point",
      description:
        "Revisión de cobertura WiFi, velocidad, ubicación, alimentación, cableado, reinicio preventivo y funcionamiento general.",
      frequency: "Cada mes",
      daysToAdd: 30,
    },
  ],

  "No-break": [
    {
      title: "Prueba preventiva de no-break",
      description:
        "Revisión de batería, tiempo de respaldo, carga, conexiones, estado físico y prueba básica de funcionamiento.",
      frequency: "Cada 3 meses",
      daysToAdd: 90,
    },
  ],

  Bocina: [
    {
      title: "Revisión preventiva de bocina",
      description:
        "Revisión de audio, cables, conectores, volumen, fuente de energía, montaje y limpieza general.",
      frequency: "Cada 3 meses",
      daysToAdd: 90,
    },
  ],

  Proyector: [
    {
      title: "Mantenimiento preventivo de proyector",
      description:
        "Limpieza exterior, revisión de lámpara, enfoque, entradas de video, ventilación, control remoto y funcionamiento general.",
      frequency: "Cada mes",
      daysToAdd: 30,
    },
  ],

  Monitor: [
    {
      title: "Revisión preventiva de monitor",
      description:
        "Limpieza exterior, revisión de imagen, cable de video, cable de corriente, base, botones y funcionamiento general.",
      frequency: "Cada 3 meses",
      daysToAdd: 90,
    },
  ],

  Otro: [
    {
      title: "Revisión preventiva general",
      description:
        "Revisión física, funcionamiento general, conexiones, limpieza básica y observaciones importantes del equipo.",
      frequency: "Cada 3 meses",
      daysToAdd: 90,
    },
  ],
};

function getDefaultMaintenancePlansForAsset(asset) {
  const category = asset?.category || "Otro";

  if (category === "Computadora" && isOnlineBoothAsset(asset)) {
    return [
      {
        title: "Revisión preventiva de computadora de cabina online",
        description:
          "Revisión de encendido, internet, cámara/webcam, micrófono, audio, programas necesarios, actualizaciones, navegador, plataforma online, accesos y funcionamiento general para clases en línea.",
        frequency: "Cada 15 días",
        daysToAdd: 15,
      },
    ];
  }

  if (category === "Computadora" && isClassroomAsset(asset)) {
    return [
      {
        title: "Revisión preventiva de computadora de salón",
        description:
          "Revisión de encendido, monitor, teclado, mouse, audio, internet, programas necesarios, actualizaciones, material de clase, cableado y funcionamiento general para impartir clases.",
        frequency: "Cada mes",
        daysToAdd: 30,
      },
    ];
  }

  if (category === "Impresora" && isHighUsePrinter(asset)) {
    return [
      {
        title: "Mantenimiento preventivo de impresora de uso alto",
        description:
          "Limpieza general, revisión de rodillos, tóner o tinta, calidad de impresión, bandejas, conexión, pruebas de impresión, contador de uso y revisión de insumos.",
        frequency: "Cada 15 días",
        daysToAdd: 15,
      },
    ];
  }

  return DEFAULT_MAINTENANCE_PLANS[category] || DEFAULT_MAINTENANCE_PLANS.Otro;
}

function getDateAfterDays(daysToAdd) {
  const date = new Date();

  date.setDate(date.getDate() + daysToAdd);

  return date.toISOString().slice(0, 10);
}

export async function createDefaultMaintenancesForAsset(
  asset,
  currentUserProfile
) {
  if (!asset?.id) {
    throw new Error("Falta el ID del equipo para programar mantenimientos.");
  }

  const plans = getDefaultMaintenancePlansForAsset(asset);

  const createdMaintenances = [];

  for (const plan of plans) {
    const createdMaintenance = await createTechnicalMaintenance(
      asset,
      {
        title: plan.title,
        description: plan.description,
        frequency: plan.frequency,
        nextDate: getDateAfterDays(plan.daysToAdd),
        assignedTo: "Soporte Técnico",
        status: "Programado",
        checklistTemplate:
          normalizeChecklist(
            asset.maintenanceChecklistTemplate || asset.checklistTemplate || asset.checklistBase
          ).length > 0
            ? normalizeChecklist(
                asset.maintenanceChecklistTemplate || asset.checklistTemplate || asset.checklistBase
              )
            : getDefaultMaintenanceChecklistForAsset(asset, plan.title),
      },
      currentUserProfile
    );

    createdMaintenances.push(createdMaintenance);
  }

  return createdMaintenances;
}
