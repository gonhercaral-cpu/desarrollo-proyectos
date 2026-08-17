import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { getExecutiveDashboardData } from "./projectsService";
import { getSupplyStockPercentage, getSupplyStockStatus } from "../utils/supplyStock";
import { getDefaultDashboardLayout, normalizeDashboardLayout } from "../components/executive-dashboard/dashboardCatalog";

const db = getFirestore();
const PREFERENCE_COLLECTION = "userDashboardPreferences";

const COLLECTIONS = {
  purchaseRequests: "purchaseRequests",
  scheduleRequests: "scheduleRequests",
  scheduleAdjustments: "scheduleAdjustments",
  workSchedules: "workSchedules",
  printRequests: "printRequests",
  productionBatches: "printProductionBatches",
  supplies: "printSupplyItems",
  finishedInventory: "printFinishedInventory",
  products: "printProducts",
  certificates: "generatedCertificates",
  technicalAssets: "technicalAssets",
  maintenances: "technicalMaintenances",
  ideas: "ideas",
  printshopLogs: "printshopLogs",
};

export async function loadExecutiveDashboard(uid) {
  const errors = [];
  const [projects, modules, directMessages, departmentMessages] = await Promise.all([
    getExecutiveDashboardData(),
    loadCollections(errors),
    uid ? loadQuerySafe(query(collection(db, "internalMessages"), where("toUserId", "==", uid)), "mensajes", errors) : [],
    loadCollectionSafe("departmentMessages", "mensajes departamentales", errors),
  ]);

  return buildExecutiveDashboardModel({ projects, modules, directMessages, departmentMessages, uid, errors });
}

export async function loadDashboardPreference(uid) {
  if (!uid) return getDefaultDashboardLayout();
  const snapshot = await getDoc(doc(db, PREFERENCE_COLLECTION, uid));
  return snapshot.exists() ? normalizeDashboardLayout(snapshot.data()?.layout) : getDefaultDashboardLayout();
}

export async function saveDashboardPreference(uid, layout) {
  if (!uid) return;
  await setDoc(doc(db, PREFERENCE_COLLECTION, uid), {
    ownerUid: uid,
    version: 1,
    layout: normalizeDashboardLayout(layout),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

async function loadCollections(errors) {
  const entries = await Promise.all(Object.entries(COLLECTIONS).map(async ([key, name]) => [
    key,
    await loadCollectionSafe(name, key, errors),
  ]));
  return Object.fromEntries(entries);
}

async function loadCollectionSafe(collectionName, label, errors) {
  return loadQuerySafe(collection(db, collectionName), label, errors);
}

async function loadQuerySafe(reference, label, errors) {
  try {
    const snapshot = await getDocs(reference);
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  } catch (error) {
    if (error?.code !== "permission-denied") console.warn(`No se pudo cargar ${label}:`, error);
    errors.push(label);
    return [];
  }
}

function buildExecutiveDashboardModel({ projects, modules, directMessages, departmentMessages, uid, errors }) {
  const now = new Date();
  const visible = (items = []) => items.filter((item) => item && item.deleted !== true && item.active !== false);
  const projectMetrics = projects?.metrics || {};
  const activeProjects = visible(projects?.projects?.active || []);
  const purchases = visible(modules.purchaseRequests);
  const ideas = visible(modules.ideas);
  const assets = visible(modules.technicalAssets);
  const maintenances = visible(modules.maintenances);
  const supplies = visible(modules.supplies).map((item) => {
    const status = getSupplyStockStatus(item);
    return {
      ...item,
      label: item.name || "Insumo sin nombre",
      unit: item.stockUnit || item.unit || "Pieza",
      current: status.currentStock,
      minimum: status.minStock,
      ideal: status.idealStock,
      percentage: Math.round(getSupplyStockPercentage(item) ?? 0),
      stockStatus: status,
    };
  });
  const productsById = new Map(visible(modules.products).map((item) => [item.id, item]));
  const inventory = visible(modules.finishedInventory).map((item) => {
    const product = productsById.get(item.productId) || {};
    return {
      ...item,
      label: item.productName || product.name || "Producto sin nombre",
      category: item.category || product.category || "Producto terminado",
      unit: item.unit || product.unit || "Pieza",
      current: number(item.currentStock ?? item.stock ?? item.quantity),
      minimum: number(item.minStock ?? product.minStock),
      ideal: number(item.idealStock ?? product.idealStock),
    };
  });
  const stockItems = [...supplies, ...inventory];
  const pendingPurchases = purchases.filter((item) => matches(item.status, ["pending_review", "reviewing", "pending", "pendiente", "en revisión"]));
  const urgentPurchases = pendingPurchases.filter((item) => matches(item.priority, ["urgent", "high", "urgente", "alta"]));
  const pendingIdeas = ideas.filter((item) => !item.status || matches(item.status, ["new", "nueva", "pending", "pendiente", "review", "en revisión"]));
  const inoperativeAssets = assets.filter((item) => matches(item.status, ["en reparación", "en mantenimiento", "inoperativo", "fuera de servicio", "no funciona"]));
  const overdueMaintenances = maintenances.filter((item) => {
    if (matches(item.status, ["realizado", "completed", "cancelado", "cancelled"])) return false;
    const date = toDate(item.nextDate || item.scheduledDate || item.dueDate || item.date);
    return date && date < startOfDay(now);
  });
  const todayAgenda = countTodayAgenda(modules, now);
  const unreadDirect = directMessages.filter((item) => item.fromUserId !== uid && item.read !== true);
  const unreadDepartment = departmentMessages.filter((item) => item.fromUserId !== uid && Array.isArray(item.memberIds) && item.memberIds.includes(uid) && !item.readBy?.[uid]);
  const unreadMessages = [...unreadDirect, ...unreadDepartment];
  const deliveredCertificates = visible(modules.certificates).filter(isDeliveredCertificate);
  const certificateTrend = buildDailySeries(deliveredCertificates, 7, (item) => getCertificateDate(item));
  const certificatePrevious = deliveredCertificates.filter((item) => inPreviousDays(getCertificateDate(item), 7, now)).length;
  const certificateCurrent = certificateTrend.reduce((sum, item) => sum + item.value, 0);
  const production = buildProductionModel(visible(modules.productionBatches), now);
  const inventoryCategories = ["all", ...new Set(stockItems.map((item) => item.category || "Sin categoría"))];

  const kpis = [
    createKpi("messages", "Mensajes nuevos", unreadMessages.length, "#1769ff", "internal-messages", recentCounts(unreadMessages, getRecordDate)),
    createKpi("alert", "Alertas urgentes", Number(projectMetrics.overdue || 0) + urgentPurchases.length + overdueMaintenances.length, "#ff3547", "notifications-center", [1, 2, 1, 3, 2, 4, 3]),
    createKpi("calendar", "Agenda de hoy", todayAgenda, "#236cff", "team-agenda", [1, 2, 1, 1, 3, 2, todayAgenda]),
    createKpi("projects", "Proyectos activos", Number(projectMetrics.active || activeProjects.length), "#19a769", "all-projects", recentCounts(activeProjects, getRecordDate)),
    createKpi("purchase", "Por aprobar", pendingPurchases.length, "#ff9418", "purchase-requests", recentCounts(pendingPurchases, getRecordDate)),
    createKpi("equipment", "Equipos inoperativos", inoperativeAssets.length, "#8b43f6", "technical-support", recentCounts(inoperativeAssets, getRecordDate)),
  ];

  const priorities = [
    priority("Pendientes críticos", Number(projectMetrics.overdue || 0), "Urgente", "red", "alert", "all-projects"),
    priority("En revisión", Number(projectMetrics.review || projects?.projects?.review?.length || 0), "Revisión", "orange", "projects", "all-projects"),
    priority("Compras por aprobar", pendingPurchases.length, "Aprobación", "gold", "purchase", "purchase-requests"),
    priority("Ideas nuevas", pendingIdeas.length, "Nuevas", "green", "ideas", "ideas-incubator"),
    priority("Alertas de mantenimiento", overdueMaintenances.length, "Atención", "blue", "maintenance", "technical-support"),
  ];

  const attention = [
    attentionItem("Equipos inoperativos", inoperativeAssets.length, "Requieren revisión inmediata", "red", "equipment", "technical-support"),
    attentionItem("Mantenimientos vencidos", overdueMaintenances.length, "Equipo requiere servicio", "orange", "maintenance", "technical-support"),
    attentionItem("Compras por aprobar", pendingPurchases.length, "Solicitudes pendientes", "gold", "purchase", "purchase-requests"),
    attentionItem("Ideas nuevas", pendingIdeas.length, "Pendientes por revisar", "green", "ideas", "ideas-incubator"),
    attentionItem("Mensajes nuevos", unreadMessages.length, "Sin revisar", "blue", "messages", "internal-messages"),
  ];

  const moduleCards = [
    moduleCard("Mensajes", unreadMessages.length, "Sin revisar", "messages", "#1769ff", "internal-messages", recentCounts(unreadMessages, getRecordDate)),
    moduleCard("Agenda equipo", todayAgenda, "Eventos hoy", "calendar", "#12aa76", "team-agenda", [1, 3, 2, 4, 2, 3, todayAgenda]),
    moduleCard("Ideas", pendingIdeas.length, "Nuevas", "ideas", "#a448f4", "ideas-incubator", recentCounts(ideas, getRecordDate)),
    moduleCard("Compras", pendingPurchases.length, "Pendientes", "purchase", "#ff9418", "purchase-requests", recentCounts(purchases, getRecordDate)),
    moduleCard("Imprenta", supplies.length, "Materiales", "print", "#3854ac", "print-shop", recentCounts(modules.productionBatches, getRecordDate)),
    moduleCard("Soporte", inoperativeAssets.length + overdueMaintenances.length, "Alertas", "support", "#1769ff", "technical-support", recentCounts(maintenances, getRecordDate)),
    moduleCard("Inventario", stockItems.filter((item) => item.stockStatus?.requiresAttention || (item.minimum > 0 && item.current <= item.minimum)).length, "Alertas", "inventory", "#f0644a", "print-shop", stockItems.slice(0, 7).map((item) => item.current)),
    moduleCard("Certificados", certificateCurrent, "Entregados", "certificate", "#10a57a", "print-shop", certificateTrend.map((item) => item.value)),
  ];

  const recentActivity = buildRecentActivity({ projects, modules, ideas, purchases, unreadMessages, maintenances });

  return {
    generatedAt: now,
    partial: errors.length > 0,
    unavailableSources: [...new Set(errors)],
    kpis,
    priorities,
    attention,
    moduleCards,
    supplies: supplies.sort(stockUrgencySort),
    stockItems,
    inventoryCategories,
    certificates: {
      total: certificateCurrent,
      previous: certificatePrevious,
      variation: percentChange(certificateCurrent, certificatePrevious),
      trend: certificateTrend,
    },
    production,
    recentActivity,
    projectDistribution: buildProjectDistribution(activeProjects),
  };
}

function buildProductionModel(batches, now) {
  const periods = [
    { key: "week", label: "Semana pasada", daysFrom: 7, daysTo: 14 },
    { key: "month", label: "Mes pasado", monthsAgo: 1 },
    { key: "twoMonths", label: "Hace 2 meses", monthsAgo: 2 },
  ].map((period) => {
    const matching = batches.filter((batch) => dateInPeriod(getRecordDate(batch), period, now));
    const total = matching.reduce((sum, item) => sum + number(item.approvedQuantity || item.producedQuantity), 0);
    return { ...period, total, values: buildWeekdayProduction(matching) };
  });
  return {
    periods: periods.map((period, index) => ({ ...period, variation: percentChange(period.total, periods[index + 1]?.total || 0) })),
    labels: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
  };
}

function buildWeekdayProduction(items) {
  const values = Array(7).fill(0);
  items.forEach((item) => {
    const date = getRecordDate(item);
    if (!date) return;
    const day = (date.getDay() + 6) % 7;
    values[day] += number(item.approvedQuantity || item.producedQuantity);
  });
  return values;
}

function dateInPeriod(date, period, now) {
  if (!date) return false;
  if (period.monthsAgo) {
    const target = new Date(now.getFullYear(), now.getMonth() - period.monthsAgo, 1);
    return date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth();
  }
  const age = (startOfDay(now) - startOfDay(date)) / 86400000;
  return age >= period.daysFrom && age < period.daysTo;
}

function buildDailySeries(items, days, dateGetter) {
  const result = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    result.push({
      label: new Intl.DateTimeFormat("es-MX", { weekday: "short" }).format(date).replace(".", ""),
      value: items.filter((item) => {
        const itemDate = dateGetter(item);
        return itemDate && itemDate >= date && itemDate <= end;
      }).length,
    });
  }
  return result;
}

function buildRecentActivity({ projects, modules, ideas, purchases, unreadMessages, maintenances }) {
  const projectLogs = (projects?.recentLogs || []).map((item) => activity(item.id, item.title || "Actividad de proyecto", item.description || "Proyecto actualizado", getRecordDate(item), "Proyectos", "projects", "all-projects", "blue"));
  const printLogs = (modules.printshopLogs || []).map((item) => activity(item.id, item.title || "Actividad de imprenta", item.description || item.detail || "Movimiento registrado", getRecordDate(item), "Imprenta", "print", "print-shop", "blue"));
  const ideaLogs = ideas.map((item) => activity(item.id, `Nueva idea: ${item.title || item.name || "Sin título"}`, item.description || "Idea registrada", getRecordDate(item), "Ideas", "ideas", "ideas-incubator", "purple"));
  const purchaseLogs = purchases.map((item) => activity(item.id, item.title || item.itemName || "Solicitud de compra", `Estado: ${item.status || "Pendiente"}`, getRecordDate(item), "Compras", "purchase", "purchase-requests", "orange"));
  const messages = unreadMessages.map((item) => activity(item.id, `Mensaje de ${item.fromUserName || "usuario"}`, item.message || item.text || "Mensaje nuevo", getRecordDate(item), "Mensajes", "messages", "internal-messages", "blue"));
  const maintenanceLogs = maintenances.map((item) => activity(item.id, item.title || "Mantenimiento programado", item.assetName || item.description || "Soporte técnico", getRecordDate(item, item.nextDate), "Soporte", "maintenance", "technical-support", "red"));
  return [...projectLogs, ...printLogs, ...ideaLogs, ...purchaseLogs, ...messages, ...maintenanceLogs]
    .filter((item) => item.date)
    .sort((a, b) => b.date - a.date)
    .slice(0, 20);
}

function buildProjectDistribution(projects) {
  const groups = [
    { label: "Activos", value: 0, color: "#1769ff" },
    { label: "En revisión", value: 0, color: "#ff9418" },
    { label: "Bloqueados", value: 0, color: "#ff3547" },
    { label: "Otros", value: 0, color: "#13a976" },
  ];
  projects.forEach((item) => {
    if (matches(item.status, ["en revisión", "listo para revisión", "por revisar"])) groups[1].value += 1;
    else if (matches(item.status, ["bloqueado", "atrasado"])) groups[2].value += 1;
    else if (matches(item.status, ["activo", "en progreso", "en desarrollo"])) groups[0].value += 1;
    else groups[3].value += 1;
  });
  return groups;
}

function countTodayAgenda(modules, now) {
  const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][now.getDay()];
  const dayEs = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][now.getDay()];
  const schedules = (modules.workSchedules || []).filter((item) => item.isActive !== false && !item.isRestDay && matches(item.dayOfWeek, [day, dayEs, String(now.getDay())])).length;
  const adjustments = (modules.scheduleAdjustments || []).filter((item) => {
    const start = toDate(item.startDate);
    const end = toDate(item.endDate || item.startDate);
    return start && end && startOfDay(now) >= startOfDay(start) && startOfDay(now) <= startOfDay(end);
  }).length;
  return schedules + adjustments;
}

function recentCounts(items, dateGetter) {
  return buildDailySeries(items || [], 7, dateGetter).map((item) => item.value);
}

function isDeliveredCertificate(item) {
  return matches(item.status, ["entregado", "entregada", "delivered"]);
}

function getCertificateDate(item) {
  return toDate(item.deliveredAt || item.deliveryDate || item.generatedAt || item.pdfSavedAt || item.issueDate);
}

function getRecordDate(item, fallback) {
  return toDate(item?.updatedAt || item?.createdAt || item?.generatedAt || item?.completedAt || item?.productionDate || fallback);
}

function inPreviousDays(date, days, now) {
  if (!date) return false;
  const end = startOfDay(new Date(now));
  end.setDate(end.getDate() - days);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return date >= start && date < end;
}

function stockUrgencySort(a, b) {
  const priority = { critical: 0, low: 1, unconfigured: 2, optimal: 3 };
  return (priority[a.stockStatus?.key] ?? 4) - (priority[b.stockStatus?.key] ?? 4) || String(a.label).localeCompare(String(b.label), "es");
}

function createKpi(icon, label, value, color, route, trend) {
  return { icon, label, value, color, route, trend, variation: compareRecent(trend) };
}

function priority(label, value, badge, tone, icon, route) { return { label, value, badge, tone, icon, route }; }
function attentionItem(label, value, detail, tone, icon, route) { return { label, value, detail, tone, icon, route }; }
function moduleCard(label, value, detail, icon, color, route, trend) { return { label, value, detail, icon, color, route, trend }; }
function activity(id, title, detail, date, category, icon, route, tone) { return { id: `${category}-${id}`, title, detail, date, category, icon, route, tone }; }

function compareRecent(values = []) {
  const current = number(values[values.length - 1]);
  const previous = number(values[values.length - 2]);
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function percentChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function matches(value, candidates) {
  const normalized = normalize(value);
  return candidates.some((candidate) => normalized === normalize(candidate));
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.toMillis === "function") return new Date(value.toMillis());
  if (value instanceof Date) return value;
  if (typeof value === "object" && Number.isFinite(value.seconds)) return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
