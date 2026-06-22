import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, getFirestore } from "firebase/firestore";
import { getExecutiveDashboardData } from "../services/projectsService";
import {
  calculateAutomaticProgress,
  getProgressLabel,
} from "../utils/progressUtils";

const db = getFirestore();

const EMPTY_MODULE_DATA = {
  purchaseRequests: [],
  scheduleRequests: [],
  scheduleAdjustments: [],
  workSchedules: [],
  printRequests: [],
  printProductionBatches: [],
  printSupplyItems: [],
  printFinishedInventory: [],
  printProducts: [],
  technicalAssets: [],
  technicalMaintenances: [],
  technicalInstallations: [],
  technicalLocations: [],
  ideas: [],
};

const EMPTY_DASHBOARD_DATA = {
  metrics: {
    active: 0,
    overdue: 0,
    review: 0,
    finishedThisMonth: 0,
    deleted: 0,
    historical: 0,
  },
  projects: {
    active: [],
    overdue: [],
    review: [],
    recentlyClosed: [],
  },
  workloadByResponsible: [],
  workloadByArea: [],
  recentLogs: [],
  alerts: [],
  modules: EMPTY_MODULE_DATA,
};

const MODULE_COLLECTIONS = {
  purchaseRequests: "purchaseRequests",
  scheduleRequests: "scheduleRequests",
  scheduleAdjustments: "scheduleAdjustments",
  workSchedules: "workSchedules",
  printRequests: "printRequests",
  printProductionBatches: "printProductionBatches",
  printSupplyItems: "printSupplyItems",
  printFinishedInventory: "printFinishedInventory",
  printProducts: "printProducts",
  technicalAssets: "technicalAssets",
  technicalMaintenances: "technicalMaintenances",
  technicalInstallations: "technicalInstallations",
  technicalLocations: "technicalLocations",
  ideas: "ideas",
};

const FINAL_PURCHASE_STATUSES = new Set([
  "rejected",
  "cancelled",
  "delivered",
]);

const FINAL_PRINT_REQUEST_STATUSES = new Set([
  "Entregado",
  "Cancelado",
  "Rechazado",
  "delivered",
  "cancelled",
  "rejected",
]);

const FINAL_PRINT_BATCH_STATUSES = new Set([
  "Ingresado a inventario",
  "Cancelado",
  "Terminado",
  "Cerrado",
  "cancelled",
  "finished",
  "closed",
]);

const FINAL_TECHNICAL_MAINTENANCE_STATUSES = new Set([
  "realizado",
  "Realizado",
  "cancelado",
  "Cancelado",
  "completed",
  "cancelled",
]);

const FINAL_TECHNICAL_INSTALLATION_STATUSES = new Set([
  "Completada",
  "Cancelada",
  "completed",
  "cancelled",
]);

export default function ExecutiveDashboard({ onOpenProject, onOpenModule }) {
  const [dashboardData, setDashboardData] = useState(EMPTY_DASHBOARD_DATA);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  async function loadDashboard() {
    setLoading(true);
    setMessage("");

    try {
      const [projectData, moduleData] = await Promise.all([
        getExecutiveDashboardData(),
        getModuleDashboardData(),
      ]);

      setDashboardData(
        normalizeDashboardData({
          ...projectData,
          modules: moduleData,
        })
      );
      setLastUpdated(new Date());
    } catch (error) {
      console.warn("No se pudo cargar el dashboard ejecutivo:", error);
      setDashboardData(EMPTY_DASHBOARD_DATA);
      setMessage(
        "No se pudo cargar el dashboard ejecutivo. Revisa que tu usuario tenga rol de administrador y que las reglas de Firestore permitan leer proyectos, bitácora, avances y evidencias."
      );
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const metrics = dashboardData?.metrics || EMPTY_DASHBOARD_DATA.metrics;
  const projects = dashboardData?.projects || EMPTY_DASHBOARD_DATA.projects;
  const workloadByResponsible = dashboardData?.workloadByResponsible || [];
  const workloadByArea = dashboardData?.workloadByArea || [];
  const recentLogs = dashboardData?.recentLogs || [];
  const alerts = dashboardData?.alerts || [];
  const modules = dashboardData?.modules || EMPTY_MODULE_DATA;

  const averageProgress = useMemo(() => {
    const activeProjects = projects.active || [];

    if (activeProjects.length === 0) {
      return 0;
    }

    return getAverageAutomaticProgress(activeProjects);
  }, [projects.active]);

  const moduleSummary = useMemo(() => buildModuleSummary(modules), [modules]);

  const attentionItems = useMemo(
    () =>
      buildAttentionItems({
        metrics,
        projects,
        moduleSummary,
        alerts,
      }),
    [metrics, projects, moduleSummary, alerts]
  );

  const enhancedWorkloadByResponsible = useMemo(() => {
    return workloadByResponsible.map((item) => {
      const responsibleProjects = (projects.active || []).filter(
        (project) =>
          (project.assignedToName || "Sin responsable") === item.responsible
      );

      return {
        ...item,
        averageProgress:
          responsibleProjects.length > 0
            ? getAverageAutomaticProgress(responsibleProjects)
            : Number(item.averageProgress || 0),
      };
    });
  }, [workloadByResponsible, projects.active]);

  const enhancedWorkloadByArea = useMemo(() => {
    return workloadByArea.map((item) => {
      const areaProjects = (projects.active || []).filter(
        (project) => getProjectDepartmentName(project) === item.area
      );

      return {
        ...item,
        averageProgress:
          areaProjects.length > 0
            ? getAverageAutomaticProgress(areaProjects)
            : Number(item.averageProgress || 0),
      };
    });
  }, [workloadByArea, projects.active]);

  const dueSoonProjects = useMemo(() => {
    const activeProjects = projects.active || [];

    return activeProjects
      .filter((project) => {
        const days = getDaysDifference(project.deadline);
        return days !== null && days >= 0 && days <= 7;
      })
      .sort((a, b) => {
        const daysA = getDaysDifference(a.deadline);
        const daysB = getDaysDifference(b.deadline);

        return Number(daysA || 0) - Number(daysB || 0);
      })
      .slice(0, 6);
  }, [projects.active]);

  function formatLastUpdated(date) {
    if (!date) return "Sin actualizar";

    return date.toLocaleString("es-MX", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (loading) {
    return (
      <div className="executive-dashboard executive-dashboard-redesign">
        <div className="dashboard-loading-card">
          Cargando centro ejecutivo...
        </div>
      </div>
    );
  }

  return (
    <div className="executive-dashboard executive-dashboard-redesign">
      <div className="executive-command-center">
        <div className="executive-command-copy">
          <span>Centro de control</span>
          <h2>Dashboard Ejecutivo</h2>
          <p>
            Vista limpia de lo que requiere atención en proyectos, imprenta,
            soporte técnico, agenda del equipo, compras e ideas nuevas.
          </p>
        </div>

        <div className="executive-command-actions">
          <span className="last-updated">
            ◷ Última actualización: {formatLastUpdated(lastUpdated)}
          </span>

          <button className="dashboard-refresh-button" onClick={loadDashboard}>
            ↻ Actualizar
          </button>
        </div>
      </div>

      {message && <div className="message-box">{message}</div>}

      <section className="executive-overview-grid">
        <ExecutiveHeroCard
          title="Salud operativa"
          value={`${averageProgress}%`}
          detail={`${metrics.active || 0} proyectos activos · ${metrics.review || 0} por revisar`}
          progress={averageProgress}
          tone={getHealthTone({ overdue: metrics.overdue, averageProgress })}
        />

        <div className="executive-focus-stack">
          <MiniMetric
            label="Atrasados"
            value={metrics.overdue || 0}
            tone="red"
            detail="Proyectos vencidos"
          />
          <MiniMetric
            label="Compras"
            value={moduleSummary.purchases.pending}
            tone="gold"
            detail="Pendientes de revisión"
          />
          <MiniMetric
            label="Agenda"
            value={moduleSummary.agenda.pending}
            tone="blue"
            detail="Solicitudes pendientes"
          />
          <MiniMetric
            label="Soporte"
            value={moduleSummary.technical.dueSoon}
            tone="orange"
            detail="Mantenimientos próximos/vencidos"
          />
        </div>
      </section>

      <section className="executive-module-grid">
        <ModulePulseCard
          icon="projects"
          title="Proyectos"
          tone="blue"
          mainValue={metrics.active || 0}
          mainLabel="activos"
          details={[
            `${metrics.overdue || 0} atrasados`,
            `${metrics.review || 0} por revisar`,
          ]}
          onClick={() => onOpenModule?.("all-projects")}
        />

        <ModulePulseCard
          icon="calendar"
          title="Agenda del equipo"
          tone="green"
          mainValue={moduleSummary.agenda.activeToday}
          mainLabel="programados hoy"
          details={[
            `${moduleSummary.agenda.pending} pendientes`,
            `${moduleSummary.agenda.absencesToday} ausencias/permisos hoy`,
          ]}
          onClick={() => onOpenModule?.("team-agenda")}
        />

        <ModulePulseCard
          icon="purchase"
          title="Solicitudes de compra"
          tone="gold"
          mainValue={moduleSummary.purchases.pending}
          mainLabel="por revisar"
          details={[
            `${moduleSummary.purchases.urgent} urgentes`,
            `${moduleSummary.purchases.open} abiertas`,
          ]}
          onClick={() => onOpenModule?.("purchase-requests")}
        />

        <ModulePulseCard
          icon="print"
          title="Imprenta"
          tone="purple"
          mainValue={moduleSummary.printshop.activeRequests}
          mainLabel="solicitudes activas"
          details={[
            `${moduleSummary.printshop.activeBatches} lotes activos`,
            `${moduleSummary.printshop.lowStock} alertas de inventario`,
          ]}
          onClick={() => onOpenModule?.("print-shop")}
        />

        <ModulePulseCard
          icon="technical"
          title="Soporte técnico"
          tone="orange"
          mainValue={moduleSummary.technical.dueSoon}
          mainLabel="mantenimientos a cuidar"
          details={[
            `${moduleSummary.technical.assets} equipos`,
            `${moduleSummary.technical.activeInstallations} instalaciones activas`,
          ]}
          onClick={() => onOpenModule?.("technical-support")}
        />

        <ModulePulseCard
          icon="ideas"
          title="Ideas nuevas"
          tone="teal"
          mainValue={moduleSummary.ideas.pending}
          mainLabel="sin revisar"
          details={[
            `${moduleSummary.ideas.total} ideas registradas`,
            `${moduleSummary.ideas.recent} recientes`,
          ]}
          onClick={() => onOpenModule?.("ideas-incubator")}
        />
      </section>

      <div className="executive-control-layout executive-control-layout-compact">
        <div className="executive-left-stack">
        <section className="visual-card executive-attention-card">
          <SectionTitle
            color="red"
            icon="alert"
            title="Hoy requiere atención"
            count={attentionItems.length}
          />

          {attentionItems.length === 0 ? (
            <EmptyState text="No hay alertas críticas por atender en este momento." />
          ) : (
            <div className="executive-attention-list">
              {attentionItems.map((item) => (
                <AttentionItem
                  key={item.key}
                  item={item}
                  onOpenModule={onOpenModule}
                />
              ))}
            </div>
          )}
        </section>


          <div className="dashboard-grid executive-tables-grid executive-tables-grid-inline">
        <section className="visual-card">
          <SectionTitle color="blue" icon="collaborator" title="Carga por colaborador" />

          {enhancedWorkloadByResponsible.length === 0 ? (
            <EmptyState text="No hay proyectos activos asignados." />
          ) : (
            <div className="visual-table-wrap">
              <table className="visual-table compact-executive-table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Activos</th>
                    <th>Atrasados</th>
                    <th>Revisión</th>
                    <th>Avance</th>
                  </tr>
                </thead>

                <tbody>
                  {enhancedWorkloadByResponsible.slice(0, 8).map((item) => (
                    <tr key={item.responsible}>
                      <td>
                        <div className="collaborator-cell">
                          <span className="avatar-mini">
                            {getInitials(item.responsible)}
                          </span>

                          {item.responsible}
                        </div>
                      </td>

                      <td>
                        <Badge color="blue">{item.active}</Badge>
                      </td>

                      <td>
                        <Badge color={item.overdue > 0 ? "red" : "green"}>
                          {item.overdue}
                        </Badge>
                      </td>

                      <td>
                        <Badge color="gold">{item.review}</Badge>
                      </td>

                      <td>
                        <div className="area-progress">
                          <strong>{item.averageProgress}%</strong>

                          <div className="area-progress-track">
                            <div
                              className="area-progress-fill"
                              style={{
                                width: `${item.averageProgress}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="visual-card">
          <SectionTitle color="blue" icon="department" title="Carga por departamento" />

          {enhancedWorkloadByArea.length === 0 ? (
            <EmptyState text="No hay proyectos activos por departamento." />
          ) : (
            <div className="visual-table-wrap">
              <table className="visual-table compact-executive-table">
                <thead>
                  <tr>
                    <th>Departamento</th>
                    <th>Activos</th>
                    <th>Atrasados</th>
                    <th>Avance</th>
                  </tr>
                </thead>

                <tbody>
                  {enhancedWorkloadByArea.slice(0, 8).map((item) => (
                    <tr key={item.area}>
                      <td>{item.area}</td>

                      <td>
                        <Badge color="blue">{item.active}</Badge>
                      </td>

                      <td>
                        <Badge color={item.overdue > 0 ? "red" : "green"}>
                          {item.overdue}
                        </Badge>
                      </td>

                      <td>
                        <div className="area-progress">
                          <strong>{item.averageProgress}%</strong>

                          <div className="area-progress-track">
                            <div
                              className="area-progress-fill"
                              style={{
                                width: `${item.averageProgress}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        </div>

        <aside className="executive-side-stack executive-side-stack-compact">
          <section className="visual-card compact-executive-card executive-project-focus-card">
            <SectionTitle
              color="blue"
              icon="projects"
              title="Proyectos que cuidar"
              count={(projects.overdue?.length || 0) + (projects.review?.length || 0) + dueSoonProjects.length}
            />

            <div className="executive-project-groups">
              <ProjectGroupPreview
                title="Atrasados"
                tone="red"
                icon="clock"
                emptyText="No hay proyectos atrasados."
                items={(projects.overdue || []).slice(0, 3)}
                badgeColor="red"
                getBadge={renderDaysLabel}
                onOpenProject={onOpenProject}
              />

              <ProjectGroupPreview
                title="Por revisión"
                tone="gold"
                icon="review"
                emptyText="No hay proyectos listos para revisión."
                items={(projects.review || []).slice(0, 3)}
                badgeColor="gold"
                getBadge={() => "Por revisar"}
                onOpenProject={onOpenProject}
              />

              <ProjectGroupPreview
                title="Próximas entregas"
                tone="green"
                icon="delivery"
                emptyText="No hay entregas próximas en 7 días."
                items={dueSoonProjects.slice(0, 3)}
                badgeColor="green"
                getBadge={renderDaysLabel}
                onOpenProject={onOpenProject}
              />
            </div>
          </section>

        </aside>
      </div>

      <section className="visual-card compact-executive-card executive-recent-card executive-wide-recent-card">
            <SectionTitle color="orange" icon="activity" title="Actividad reciente" />

            {recentLogs.length === 0 ? (
              <EmptyState text="Todavía no hay actividad registrada en la bitácora." />
            ) : (
              <div className="recent-project-list formal-log-list executive-log-list">
                {recentLogs.slice(0, 5).map((log) => (
                  <div className="recent-project-item formal-log-row" key={log.id}>
                    <span className="recent-icon">
                      <ExecutiveIcon name={getLogIcon(log.type)} />
                    </span>

                    <div className="formal-log-content">
                      <b>{log.title || "Movimiento registrado"}</b>
                      <p>{log.description || "Sin descripción."}</p>

                      <div className="recent-project-meta">
                        <Badge color={getLogBadgeColor(log.type)}>
                          {formatLogType(log.type)}
                        </Badge>

                        <small>
                          {log.userName || "Usuario"} · {formatDate(log.createdAt)}
                        </small>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

      </div>
    </div>
  );
}

async function getModuleDashboardData() {
  const entries = await Promise.all(
    Object.entries(MODULE_COLLECTIONS).map(async ([key, collectionName]) => {
      const items = await loadCollectionSafe(collectionName);
      return [key, items];
    })
  );

  return {
    ...EMPTY_MODULE_DATA,
    ...Object.fromEntries(entries),
  };
}

async function loadCollectionSafe(collectionName) {
  try {
    const snapshot = await getDocs(collection(db, collectionName));

    return snapshot.docs.map((itemDoc) => ({
      id: itemDoc.id,
      ...itemDoc.data(),
    }));
  } catch (error) {
    console.warn(`No se pudo cargar ${collectionName}:`, error);
    return [];
  }
}

function normalizeDashboardData(data) {
  return {
    ...EMPTY_DASHBOARD_DATA,
    ...(data || {}),
    metrics: {
      ...EMPTY_DASHBOARD_DATA.metrics,
      ...(data?.metrics || {}),
    },
    projects: {
      ...EMPTY_DASHBOARD_DATA.projects,
      ...(data?.projects || {}),
    },
    workloadByResponsible: data?.workloadByResponsible || [],
    workloadByArea: data?.workloadByArea || [],
    recentLogs: data?.recentLogs || [],
    alerts: data?.alerts || [],
    modules: {
      ...EMPTY_MODULE_DATA,
      ...(data?.modules || {}),
    },
  };
}

function buildModuleSummary(modules) {
  const today = getTodayValue();
  const todayKey = getTodayDayKey();
  const soonDate = addDaysValue(today, 7);

  const purchaseRequests = modules.purchaseRequests || [];
  const purchaseOpen = purchaseRequests.filter(
    (request) => !FINAL_PURCHASE_STATUSES.has(request.status)
  );

  const scheduleRequests = modules.scheduleRequests || [];
  const scheduleAdjustments = modules.scheduleAdjustments || [];

  const printRequests = modules.printRequests || [];
  const printBatches = modules.printProductionBatches || [];
  const printSupplyItems = modules.printSupplyItems || [];
  const printInventoryItems = modules.printFinishedInventory || [];

  const technicalAssets = modules.technicalAssets || [];
  const technicalMaintenances = modules.technicalMaintenances || [];
  const technicalInstallations = modules.technicalInstallations || [];

  const ideas = modules.ideas || [];

  return {
    purchases: {
      total: purchaseRequests.length,
      open: purchaseOpen.length,
      pending: purchaseRequests.filter((request) =>
        ["pending_review", "reviewing"].includes(request.status)
      ).length,
      urgent: purchaseOpen.filter((request) =>
        ["urgent", "high", "Alta", "Urgente"].includes(request.priority)
      ).length,
    },
    agenda: {
      totalRequests: scheduleRequests.length,
      pending: scheduleRequests.filter((request) => request.status === "pending").length,
      activeToday: (modules.workSchedules || []).filter((schedule) =>
        schedule.dayOfWeek === todayKey && schedule.isActive !== false && !schedule.isRestDay
      ).length,
      absencesToday: scheduleAdjustments.filter((adjustment) => {
        const publicStatus = adjustment.publicStatus || adjustment.type;
        return (
          ["permission", "absence", "dayOff"].includes(publicStatus) &&
          isDateInRangeValue(today, adjustment.startDate, adjustment.endDate)
        );
      }).length,
    },
    printshop: {
      totalRequests: printRequests.length,
      activeRequests: printRequests.filter(
        (request) => !FINAL_PRINT_REQUEST_STATUSES.has(request.status)
      ).length,
      urgentRequests: printRequests.filter((request) =>
        ["Urgente", "urgent", "Alta", "high"].includes(request.priority)
      ).length,
      activeBatches: printBatches.filter(
        (batch) => !FINAL_PRINT_BATCH_STATUSES.has(batch.status)
      ).length,
      lowStock: [...printSupplyItems, ...printInventoryItems].filter((item) =>
        isLowStockItem(item)
      ).length,
    },
    technical: {
      assets: technicalAssets.filter((asset) =>
        !["Dado de baja", "dado-de-baja", "deleted"].includes(asset.status)
      ).length,
      dueSoon: technicalMaintenances.filter((maintenance) => {
        if (FINAL_TECHNICAL_MAINTENANCE_STATUSES.has(maintenance.status)) {
          return false;
        }

        const dateValue = getPossibleDateValue(
          maintenance.scheduledDate ||
            maintenance.nextDate ||
            maintenance.dueDate ||
            maintenance.date
        );

        return dateValue && dateValue <= soonDate;
      }).length,
      activeInstallations: technicalInstallations.filter(
        (installation) =>
          !FINAL_TECHNICAL_INSTALLATION_STATUSES.has(installation.status)
      ).length,
      locations: (modules.technicalLocations || []).length,
    },
    ideas: {
      total: ideas.length,
      pending: ideas.filter((idea) =>
        ["new", "Nueva", "pending", "Pendiente", "review", "En revisión"].includes(
          idea.status
        ) || !idea.status
      ).length,
      recent: ideas.filter((idea) => isRecentDate(idea.createdAt, 14)).length,
    },
  };
}

function buildAttentionItems({ metrics, projects, moduleSummary, alerts }) {
  const items = [];

  if ((metrics.overdue || 0) > 0) {
    items.push({
      key: "projects-overdue",
      icon: "clock",
      tone: "red",
      route: "all-projects",
      title: `${metrics.overdue} proyecto(s) atrasado(s)`,
      detail: "Conviene revisar fechas límite, responsables y bloqueos.",
    });
  }

  if ((projects.review || []).length > 0) {
    items.push({
      key: "projects-review",
      icon: "review",
      tone: "gold",
      route: "all-projects",
      title: `${projects.review.length} proyecto(s) listos para revisión`,
      detail: "Hay entregables esperando cierre o retroalimentación administrativa.",
    });
  }

  if (moduleSummary.purchases.pending > 0) {
    items.push({
      key: "purchase-pending",
      icon: "purchase",
      tone: "gold",
      route: "purchase-requests",
      title: `${moduleSummary.purchases.pending} solicitud(es) de compra pendientes`,
      detail: `${moduleSummary.purchases.urgent} marcada(s) como alta prioridad o urgente.`,
    });
  }

  if (moduleSummary.technical.dueSoon > 0) {
    items.push({
      key: "technical-due",
      icon: "technical",
      tone: "orange",
      route: "technical-support",
      title: `${moduleSummary.technical.dueSoon} mantenimiento(s) próximos o vencidos`,
      detail: "Soporte técnico requiere seguimiento para evitar acumulación.",
    });
  }

  if (moduleSummary.agenda.pending > 0) {
    items.push({
      key: "agenda-pending",
      icon: "calendar",
      tone: "blue",
      route: "team-agenda",
      title: `${moduleSummary.agenda.pending} solicitud(es) de agenda pendientes`,
      detail: "Cambios de horario, permisos o ausencias por revisar.",
    });
  }

  if (moduleSummary.printshop.lowStock > 0) {
    items.push({
      key: "print-low-stock",
      icon: "print",
      tone: "purple",
      route: "print-shop",
      title: `${moduleSummary.printshop.lowStock} alerta(s) de inventario en imprenta`,
      detail: "Revisa insumos o productos debajo del mínimo configurado.",
    });
  }

  if (moduleSummary.ideas.pending > 0) {
    items.push({
      key: "ideas-pending",
      icon: "ideas",
      tone: "teal",
      route: "ideas-incubator",
      title: `${moduleSummary.ideas.pending} idea(s) nuevas sin revisar`,
      detail: "Hay propuestas pendientes de valoración inicial.",
    });
  }

  alerts.slice(0, 2).forEach((alert, index) => {
    items.push({
      key: `project-alert-${index}`,
      icon: getAlertIcon(alert),
      tone: getAlertColor(alert),
      title: alert.title || "Alerta ejecutiva",
      detail: alert.detail || "Sin detalle registrado.",
    });
  });

  return items.slice(0, 8);
}

function getAverageAutomaticProgress(projects = []) {
  if (!Array.isArray(projects) || projects.length === 0) {
    return 0;
  }

  const total = projects.reduce(
    (sum, project) => sum + calculateAutomaticProgress(project),
    0
  );

  return Math.round(total / projects.length);
}

function ExecutiveIcon({ name }) {
  const iconName = name || "dashboard";

  return (
    <svg className="executive-svg-icon" viewBox="0 0 24 24" aria-hidden="true">
      {renderExecutiveIconPath(iconName)}
    </svg>
  );
}

function renderExecutiveIconPath(name) {
  switch (name) {
    case "dashboard":
      return (
        <>
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="14" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <rect x="14" y="14" width="7" height="7" rx="2" />
        </>
      );
    case "projects":
      return (
        <>
          <path d="M4 6.5h16" />
          <path d="M4 12h16" />
          <path d="M4 17.5h10" />
          <circle cx="5" cy="6.5" r="1" />
          <circle cx="5" cy="12" r="1" />
          <circle cx="5" cy="17.5" r="1" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M8 3v4" />
          <path d="M16 3v4" />
          <path d="M3 10h18" />
          <path d="M8 14h3" />
          <path d="M14 14h2" />
          <path d="M8 17h2" />
        </>
      );
    case "purchase":
      return (
        <>
          <path d="M4 5h2l2.1 9.2a2 2 0 0 0 2 1.6h6.9a2 2 0 0 0 1.9-1.4L21 8H7" />
          <circle cx="10" cy="20" r="1.4" />
          <circle cx="17" cy="20" r="1.4" />
        </>
      );
    case "print":
      return (
        <>
          <path d="M7 8V4h10v4" />
          <rect x="6" y="14" width="12" height="7" rx="1.5" />
          <rect x="4" y="8" width="16" height="9" rx="2" />
          <path d="M8 17h8" />
          <path d="M8 19h5" />
          <circle cx="17" cy="11.5" r="1" />
        </>
      );
    case "technical":
      return (
        <>
          <path d="M14.5 5.5l4 4" />
          <path d="M4 20l6.5-6.5" />
          <path d="M12.5 3.5l8 8-2.5 2.5-8-8z" />
          <path d="M8 16l-2 2" />
        </>
      );
    case "ideas":
      return (
        <>
          <path d="M9 18h6" />
          <path d="M10 21h4" />
          <path d="M8 14.5a6 6 0 1 1 8 0c-.9.8-1.3 1.6-1.3 2.5H9.3c0-.9-.4-1.7-1.3-2.5z" />
        </>
      );
    case "alert":
      return (
        <>
          <path d="M12 4l9 16H3z" />
          <path d="M12 9v5" />
          <path d="M12 17h.01" />
        </>
      );
    case "review":
      return (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="M16 16l4 4" />
          <path d="M8.5 11l1.8 1.8 3.4-3.6" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3.2 2" />
        </>
      );
    case "delivery":
      return (
        <>
          <rect x="3" y="6" width="12" height="10" rx="2" />
          <path d="M15 10h3l3 3v3h-6" />
          <circle cx="7" cy="18" r="2" />
          <circle cx="17" cy="18" r="2" />
        </>
      );
    case "activity":
      return (
        <>
          <path d="M4 13h4l2-6 4 10 2-4h4" />
          <path d="M4 20h16" />
        </>
      );
    case "collaborator":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M15.5 15.5a4.5 4.5 0 0 1 5 4.5" />
        </>
      );
    case "department":
      return (
        <>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </>
      );
    case "status":
      return (
        <>
          <path d="M5 12l4 4L19 6" />
          <circle cx="12" cy="12" r="9" />
        </>
      );
    case "progress":
      return (
        <>
          <path d="M4 19V5" />
          <path d="M4 19h16" />
          <rect x="7" y="12" width="3" height="4" rx="1" />
          <rect x="12" y="9" width="3" height="7" rx="1" />
          <rect x="17" y="6" width="3" height="10" rx="1" />
        </>
      );
    case "upload":
      return (
        <>
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M5 20h14" />
        </>
      );
    case "comment":
      return (
        <>
          <path d="M5 5h14v10H8l-3 3z" />
          <path d="M8 9h8" />
          <path d="M8 12h5" />
        </>
      );
    case "trash":
      return (
        <>
          <path d="M5 7h14" />
          <path d="M9 7V5h6v2" />
          <path d="M8 10v8" />
          <path d="M12 10v8" />
          <path d="M16 10v8" />
          <path d="M7 7l1 14h8l1-14" />
        </>
      );
    case "restore":
      return (
        <>
          <path d="M7 7h7a6 6 0 1 1-5.2 9" />
          <path d="M7 7V3" />
          <path d="M7 7H3" />
        </>
      );
    case "edit":
      return (
        <>
          <path d="M4 20h4l10.5-10.5-4-4L4 16z" />
          <path d="M13.5 6.5l4 4" />
        </>
      );
    case "plus":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8" />
          <path d="M8 12h8" />
        </>
      );
    case "note":
      return (
        <>
          <path d="M6 4h9l3 3v13H6z" />
          <path d="M15 4v4h4" />
          <path d="M9 12h6" />
          <path d="M9 16h5" />
        </>
      );
    default:
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </>
      );
  }
}

function ExecutiveHeroCard({ title, value, detail, progress, tone }) {
  return (
    <article className={`executive-hero-card ${tone}`}>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <p>{detail}</p>
      </div>

      <div className="executive-hero-progress">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <small>{getProgressLabel(progress)}</small>
      </div>
    </article>
  );
}

function MiniMetric({ label, value, detail, tone }) {
  return (
    <article className={`executive-mini-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function ModulePulseCard({ icon, title, tone, mainValue, mainLabel, details, onClick }) {
  return (
    <button
      type="button"
      className={`module-pulse-card ${tone}`}
      onClick={onClick}
    >
      <span className="module-pulse-icon">
        <ExecutiveIcon name={icon} />
      </span>
      <div>
        <h3>{title}</h3>
        <strong>{mainValue}</strong>
        <p>{mainLabel}</p>
        <div className="module-pulse-details">
          {details.map((detail) => (
            <small key={detail}>{detail}</small>
          ))}
        </div>
      </div>
    </button>
  );
}

function AttentionItem({ item, onOpenModule }) {
  const content = (
    <>
      <span>
        <ExecutiveIcon name={item.icon} />
      </span>
      <div>
        <strong>{item.title}</strong>
        <p>{item.detail}</p>
      </div>
    </>
  );

  if (item.route) {
    return (
      <button
        type="button"
        className={`executive-attention-item clickable ${item.tone}`}
        onClick={() => onOpenModule?.(item.route)}
      >
        {content}
      </button>
    );
  }

  return <article className={`executive-attention-item ${item.tone}`}>{content}</article>;
}

function SectionTitle({ color, icon, title, count }) {
  return (
    <div className="section-title-row executive-section-title">
      <div className={`section-title-icon section-title-${color}`}>
        <ExecutiveIcon name={icon} />
      </div>

      <h3>{title}</h3>

      {typeof count === "number" && (
        <span className={`section-count section-count-${color}`}>{count}</span>
      )}
    </div>
  );
}

function ProjectGroupPreview({
  title,
  tone,
  icon,
  emptyText,
  items,
  badgeColor,
  getBadge,
  onOpenProject,
}) {
  return (
    <div className={`executive-project-group ${tone}`}>
      <div className="executive-project-group-header">
        <span>
          <ExecutiveIcon name={icon} />
        </span>
        <strong>{title}</strong>
        <small>{items.length}</small>
      </div>

      {items.length === 0 ? (
        <p className="executive-project-empty">{emptyText}</p>
      ) : (
        <div className="executive-project-row-list">
          {items.map((project) => (
            <ProjectCompactRow
              key={project.id}
              project={project}
              badge={getBadge(project)}
              badgeColor={badgeColor}
              onClick={() => onOpenProject(project.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectCompactRow({ project, badge, badgeColor, onClick }) {
  const automaticProgress = calculateAutomaticProgress(project);

  return (
    <button type="button" className="executive-project-row" onClick={onClick}>
      <div>
        <strong>{project.title || "Proyecto sin título"}</strong>
        <span>
          {project.assignedToName || "Sin responsable"} · {getProjectDepartmentName(project)}
        </span>
      </div>

      <div className="executive-project-row-status">
        <small>{automaticProgress}%</small>
        <Badge color={badgeColor}>{badge}</Badge>
      </div>
    </button>
  );
}

function ProjectMiniCard({ project, icon, color, badge, badgeColor, onClick }) {
  const automaticProgress = calculateAutomaticProgress(project);
  const progressLabel = getProgressLabel(automaticProgress);

  return (
    <button className="project-mini-card" onClick={onClick}>
      <span className={`project-mini-icon project-mini-${color}`}>
        <ExecutiveIcon name={icon} />
      </span>

      <div className="project-mini-content">
        <strong>{project.title}</strong>

        <div className="project-mini-meta">
          <span>
            <small>Responsable</small>
            {project.assignedToName || "Sin responsable"}
          </span>

          <span>
            <small>Departamento</small>
            {getProjectDepartmentName(project)}
          </span>

          <span>
            <small>Estado</small>
            <em>{project.status || "Sin estado"}</em>
          </span>

          <span>
            <small>Fecha límite</small>
            {project.deadline || "Sin fecha"}
          </span>
        </div>

        <div className="area-progress project-mini-progress">
          <div className="project-mini-progress-top">
            <strong>{automaticProgress}%</strong>
            <small>{progressLabel}</small>
          </div>

          <div className="area-progress-track">
            <div
              className="area-progress-fill"
              style={{ width: `${automaticProgress}%` }}
            />
          </div>
        </div>
      </div>

      <span className={`project-mini-badge badge-${badgeColor}`}>{badge}</span>
    </button>
  );
}

function EmptyState({ icon = "▯", text }) {
  return (
    <div className="empty-state">
      <div>{icon}</div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function parseDate(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function getPossibleDateValue(value) {
  const date = parseDate(value);
  if (!date) return "";

  return getDateValue(date);
}

function getDaysDifference(deadline) {
  const date = parseDate(deadline);

  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  date.setHours(0, 0, 0, 0);

  const diff = date.getTime() - today.getTime();

  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function renderDaysLabel(project) {
  const days = getDaysDifference(project.deadline);

  if (days === null) {
    return "Sin fecha";
  }

  if (days < 0) {
    return `${Math.abs(days)} día(s) atrasado`;
  }

  if (days === 0) {
    return "Vence hoy";
  }

  return `Faltan ${days} día(s)`;
}

function formatDate(value) {
  const date = parseDate(value);

  if (!date) return "Sin fecha";

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTodayValue() {
  return getDateValue(new Date());
}

function getTodayDayKey() {
  const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return keys[new Date().getDay()];
}

function addDaysValue(dateValue, days) {
  const baseDate = parseDate(dateValue);
  if (!baseDate) return dateValue;

  baseDate.setDate(baseDate.getDate() + days);
  return getDateValue(baseDate);
}

function isDateInRangeValue(dateValue, startDate, endDate) {
  if (!dateValue || !startDate) return false;

  const start = startDate;
  const end = endDate || startDate;

  return dateValue >= start && dateValue <= end;
}

function isRecentDate(value, days = 14) {
  const date = parseDate(value);
  if (!date) return false;

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const diff = today.getTime() - date.getTime();
  return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
}

function isLowStockItem(item) {
  const currentStock = Number(
    item.currentStock ?? item.stock ?? item.availableStock ?? item.quantity ?? 0
  );
  const minStock = Number(
    item.minStock ?? item.minimumStock ?? item.reorderPoint ?? item.minimum ?? 0
  );

  return minStock > 0 && currentStock <= minStock;
}

function getInitials(name = "") {
  if (!name || name === "Sin responsable") {
    return "?";
  }

  return String(name)
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getAlertColor(alert) {
  if (alert.level === "danger") return "red";
  if (alert.level === "warning") return "gold";
  if (alert.level === "info") return "blue";

  return "green";
}

function getProjectDepartmentName(project) {
  return (
    project?.departmentName ||
    project?.responsibleDepartmentName ||
    project?.responsibleArea ||
    "Sin departamento"
  );
}

function getAlertIcon(alert) {
  if (alert.level === "danger") return "alert";
  if (alert.type === "review") return "review";
  if (alert.type === "highPriority") return "alert";
  if (alert.type === "stale") return "clock";
  if (alert.type === "noEvidence") return "note";

  return "status";
}

function getLogIcon(type) {
  if (type === "PROJECT_CREATED") return "plus";
  if (type === "PROJECT_UPDATED") return "edit";
  if (type === "STATUS_CHANGED") return "status";
  if (type === "PROGRESS_CHANGED") return "progress";
  if (type === "EVIDENCE_UPLOADED") return "upload";
  if (type === "COMMENT_ADDED") return "comment";
  if (type === "ADVANCE_ADDED") return "activity";
  if (type === "ADVANCE_COMMENT_ADDED") return "comment";
  if (type === "REVIEW_REQUESTED") return "review";
  if (type === "CORRECTIONS_REQUESTED") return "edit";
  if (type === "PROJECT_APPROVED") return "status";
  if (type === "PROJECT_FINISHED") return "status";
  if (type === "PROJECT_CANCELLED") return "alert";
  if (type === "PROJECT_DELETED") return "trash";
  if (type === "PROJECT_RESTORED") return "restore";
  if (type === "INTERNAL_NOTE_UPDATED") return "note";
  if (type === "INTERNAL_NOTE_ADDED") return "note";

  return "activity";
}

function getLogBadgeColor(type) {
  if (type === "PROJECT_DELETED") return "red";
  if (type === "PROJECT_CANCELLED") return "orange";
  if (type === "PROJECT_FINISHED") return "teal";
  if (type === "PROJECT_APPROVED") return "green";
  if (type === "REVIEW_REQUESTED") return "gold";
  if (type === "CORRECTIONS_REQUESTED") return "purple";
  if (type === "EVIDENCE_UPLOADED") return "blue";
  if (type === "ADVANCE_ADDED") return "blue";
  if (type === "ADVANCE_COMMENT_ADDED") return "purple";
  if (type === "PROJECT_RESTORED") return "green";
  if (type === "INTERNAL_NOTE_ADDED") return "gold";

  return "blue";
}

function formatLogType(type = "") {
  const labels = {
    PROJECT_CREATED: "Creación",
    PROJECT_UPDATED: "Edición",
    STATUS_CHANGED: "Estado",
    PROGRESS_CHANGED: "Avance",
    EVIDENCE_UPLOADED: "Evidencia",
    COMMENT_ADDED: "Comentario",
    ADVANCE_ADDED: "Avance",
    ADVANCE_COMMENT_ADDED: "Comentario",
    REVIEW_REQUESTED: "Revisión",
    CORRECTIONS_REQUESTED: "Correcciones",
    PROJECT_APPROVED: "Aprobado",
    PROJECT_FINISHED: "Finalizado",
    PROJECT_CANCELLED: "Cancelado",
    PROJECT_DELETED: "Eliminado",
    PROJECT_RESTORED: "Restaurado",
    INTERNAL_NOTE_UPDATED: "Nota interna",
    INTERNAL_NOTE_ADDED: "Nota interna",
  };

  return labels[type] || "Movimiento";
}

function getHealthTone({ overdue, averageProgress }) {
  if (Number(overdue || 0) > 0) return "danger";
  if (averageProgress < 45) return "warning";
  return "healthy";
}
