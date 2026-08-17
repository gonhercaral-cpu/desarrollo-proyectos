import { BarChart, DashboardIcon, DonutChart, LineChart, Sparkline } from "./DashboardVisuals";

export function DashboardWidget({ widget, data, onOpenModule, onUpdateWidget }) {
  const props = { widget, data, onOpenModule, onUpdateWidget };
  switch (widget.type) {
    case "kpi": return <KpiWidget {...props} />;
    case "alertas": return <PrioritiesWidget {...props} />;
    case "atencion": return <AttentionWidget {...props} />;
    case "imprenta": return <QuickPrintshopWidget {...props} />;
    case "inventario":
    case "stock":
    case "barras": return <InventoryWidget {...props} />;
    case "certificados": return <CertificatesWidget {...props} />;
    case "libros":
    case "lineas": return <BooksWidget {...props} />;
    case "modulos": return <ModulesWidget {...props} />;
    case "actividad": return <ActivityWidget {...props} />;
    case "donut": return <ProjectsDonutWidget {...props} />;
    case "sparkline": return <SingleSparklineWidget {...props} />;
    default: return <ModuleMetricWidget {...props} />;
  }
}

function KpiWidget({ data, onOpenModule }) {
  return (
    <section className="ed-kpi-grid">
      {data.kpis.map((item) => (
        <button type="button" className="ed-kpi-card" key={item.label} onClick={() => onOpenModule?.(item.route)}>
          <span className="ed-kpi-icon" style={{ "--accent": item.color }}><DashboardIcon name={item.icon} size={25} /></span>
          <span className="ed-kpi-main"><small>{item.label}</small><strong>{formatNumber(item.value)}</strong><em className={item.variation < 0 ? "is-down" : "is-up"}>{item.variation > 0 ? "↑" : item.variation < 0 ? "↓" : "="} {Math.abs(item.variation)}% <i>vs ayer</i></em></span>
          <Sparkline values={item.trend} color={item.color} />
        </button>
      ))}
    </section>
  );
}

function PrioritiesWidget({ widget, data, onOpenModule }) {
  return (
    <Panel className="ed-priorities" title={widget.title || "Prioridades del día"} icon="bell" dark>
      <div className="ed-priority-grid">
        {data.priorities.map((item) => (
          <button type="button" key={item.label} className={`ed-priority-card tone-${item.tone}`} onClick={() => onOpenModule?.(item.route)}>
            <span><DashboardIcon name={item.icon} /></span><small>{item.label}</small><strong>{item.value}</strong><b>{item.badge}</b>
          </button>
        ))}
      </div>
    </Panel>
  );
}

function AttentionWidget({ widget, data, onOpenModule }) {
  return (
    <Panel title={widget.title || "Atención inmediata"} icon="bell" accent="red" action="Ver todas" onAction={() => onOpenModule?.("notifications-center")}>
      <div className="ed-attention-list">
        {data.attention.map((item) => (
          <button type="button" key={item.label} className={`ed-attention-item tone-${item.tone}`} onClick={() => onOpenModule?.(item.route)}>
            <strong>{item.value}</strong><span><b>{item.label}</b><small>{item.detail}</small></span><DashboardIcon name={item.icon} size={17} /><DashboardIcon name="arrow" size={14} />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function QuickPrintshopWidget({ widget, data, onOpenModule }) {
  const limit = Number(widget.settings?.limit || 6);
  return (
    <Panel title={widget.title || "Imprenta rápida"} icon="print" action="Ver inventario completo" onAction={() => onOpenModule?.("print-shop")}>
      {data.supplies.length ? (
        <div className="ed-supply-grid">
          {data.supplies.slice(0, limit).map((item) => (
            <button type="button" key={item.id} className={`ed-supply-card stock-${item.stockStatus.key}`} onClick={() => onOpenModule?.("print-shop")}>
              <span><DashboardIcon name="inventory" size={19} /></span>
              <div><small>{item.label}</small><strong>{formatNumber(item.current)}</strong><em>{item.unit}</em></div>
              <b>{item.percentage}%</b>
              <i><u style={{ width: `${item.percentage}%` }} /></i>
            </button>
          ))}
        </div>
      ) : <EmptyState text="No hay insumos activos en imprenta." />}
    </Panel>
  );
}

function InventoryWidget({ widget, data, onOpenModule, onUpdateWidget }) {
  const category = widget.settings?.category || "all";
  const filtered = category === "all" ? data.stockItems : data.stockItems.filter((item) => (item.category || "Sin categoría") === category);
  const items = filtered.slice(0, Number(widget.settings?.limit || 7));
  return (
    <Panel title={widget.title || "Inventario actual"} subtitle="Comparativo: mínimo vs ideal vs stock actual" action="Ver inventario" onAction={() => onOpenModule?.("print-shop")}>
      <select className="ed-chart-filter" aria-label="Filtrar categoría de inventario" value={category} onChange={(event) => onUpdateWidget?.(widget.id, { settings: { category: event.target.value } })}>
        {data.inventoryCategories.map((item) => <option key={item} value={item}>{item === "all" ? "Todas las categorías" : item}</option>)}
      </select>
      {items.length ? <>
        <Legend items={[{ label: "Mínimo", color: "#ff9418" }, { label: "Ideal", color: "#13a976" }, { label: "Stock actual", color: "#1769ff" }]} />
        <BarChart items={items} series={[{ key: "minimum", label: "Mínimo", color: "#ff9418" }, { key: "ideal", label: "Ideal", color: "#13a976" }, { key: "current", label: "Stock actual", color: "#1769ff" }]} />
      </> : <EmptyState text="No hay inventario en esta categoría." />}
    </Panel>
  );
}

function CertificatesWidget({ widget, data, onOpenModule }) {
  const chartItems = data.certificates.trend.map((item, index) => ({ id: index, label: item.label, delivered: item.value }));
  return (
    <Panel title={widget.title || "Certificados entregados"} subtitle="Últimos 7 días" action="Ver reporte" onAction={() => onOpenModule?.("print-shop")}>
      <div className="ed-certificate-summary"><strong>{formatNumber(data.certificates.total)}</strong><span className={data.certificates.variation < 0 ? "is-down" : "is-up"}>{data.certificates.variation >= 0 ? "↑" : "↓"} {Math.abs(data.certificates.variation)}% <small>vs periodo anterior</small></span></div>
      <BarChart items={chartItems} series={[{ key: "delivered", label: "Entregados", color: "#5d8ff5" }]} maxItems={7} />
    </Panel>
  );
}

function BooksWidget({ widget, data, onOpenModule }) {
  const colors = ["#1769ff", "#13a976", "#ff9418"];
  return (
    <Panel title={widget.title || "Libros producidos"} action="Ver producción" onAction={() => onOpenModule?.("print-shop")}>
      <div className="ed-production-layout">
        <div className="ed-period-grid">
          {data.production.periods.map((period, index) => (
            <div className="ed-period-card" key={period.key}><small>{period.label}</small><strong>{formatNumber(period.total)}</strong><em className={period.variation < 0 ? "is-down" : "is-up"}>{period.variation >= 0 ? "↑" : "↓"} {Math.abs(period.variation)}%</em><Sparkline values={period.values} color={colors[index]} /></div>
          ))}
        </div>
        <div className="ed-production-chart"><h4>Evolución de producción</h4><Legend items={data.production.periods.map((period, index) => ({ label: period.label, color: colors[index] }))} /><LineChart labels={data.production.labels} series={data.production.periods.map((period, index) => ({ label: period.label, color: colors[index], values: period.values }))} /></div>
      </div>
    </Panel>
  );
}

function ModulesWidget({ widget, data, onOpenModule }) {
  return (
    <Panel title={widget.title || "Módulos clave"}>
      <div className="ed-modules-grid">
        {data.moduleCards.map((item) => (
          <button type="button" key={item.label} className="ed-module-card" onClick={() => onOpenModule?.(item.route)}>
            <span style={{ "--accent": item.color }}><DashboardIcon name={item.icon} size={17} /></span><small>{item.label}</small><strong>{formatNumber(item.value)}</strong><em>{item.detail}</em><Sparkline values={item.trend} color={item.color} height={19} />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function ActivityWidget({ widget, data, onOpenModule }) {
  const limit = Number(widget.settings?.limit || 6);
  return (
    <Panel title={widget.title || "Actividad reciente"} action="Ver toda la actividad" onAction={() => onOpenModule?.("notifications-center")}>
      {data.recentActivity.length ? <div className="ed-activity-list">{data.recentActivity.slice(0, limit).map((item) => (
        <button type="button" key={item.id} className={`ed-activity-item tone-${item.tone}`} onClick={() => onOpenModule?.(item.route)}>
          <time>{formatTime(item.date)}</time><span><DashboardIcon name={item.icon} size={16} /></span><p><b>{item.title}</b><small>{item.detail}</small></p><em>{item.category}</em>
        </button>
      ))}</div> : <EmptyState text="Todavía no hay actividad reciente." />}
    </Panel>
  );
}

function ProjectsDonutWidget({ widget, data, onOpenModule }) {
  const total = data.projectDistribution.reduce((sum, item) => sum + item.value, 0);
  return <Panel title={widget.title || "Proyectos por estado"} action="Ver proyectos" onAction={() => onOpenModule?.("all-projects")}><DonutChart items={data.projectDistribution} centerValue={total} centerLabel="Proyectos" /></Panel>;
}

function SingleSparklineWidget({ widget, data, onOpenModule }) {
  const metric = data.kpis.find((item) => item.label === widget.settings?.metric) || data.kpis[0];
  return <Panel title={widget.title || metric.label} action="Abrir" onAction={() => onOpenModule?.(metric.route)}><div className="ed-single-metric"><span style={{ "--accent": metric.color }}><DashboardIcon name={metric.icon} /></span><strong>{metric.value}</strong><em>{metric.variation >= 0 ? "+" : ""}{metric.variation}%</em><Sparkline values={metric.trend} color={metric.color} height={52} /></div></Panel>;
}

function ModuleMetricWidget({ widget, data, onOpenModule }) {
  const mapping = {
    mensajes: "Mensajes", agenda: "Agenda equipo", proyectos: "Proyectos", ideas: "Ideas", compras: "Compras", soporte: "Soporte", mantenimientos: "Soporte", equipos: "Soporte",
  };
  let metric = data.moduleCards.find((item) => item.label === mapping[widget.type]);
  if (widget.type === "proyectos") metric = data.kpis.find((item) => item.label === "Proyectos activos");
  if (!metric) metric = data.moduleCards[0];
  return <Panel title={widget.title || metric.label} action="Abrir" onAction={() => onOpenModule?.(metric.route)}><div className="ed-single-metric"><span style={{ "--accent": metric.color }}><DashboardIcon name={metric.icon} /></span><strong>{metric.value}</strong><em>{metric.detail || "Actual"}</em><Sparkline values={metric.trend} color={metric.color} height={52} /></div></Panel>;
}

function Panel({ title, subtitle, icon, accent, action, onAction, dark = false, className = "", children }) {
  return (
    <section className={`ed-panel ${dark ? "is-dark" : ""} ${className}`}>
      <header className="ed-panel-header">
        <div>{icon && <span className={accent ? `tone-${accent}` : ""}><DashboardIcon name={icon} size={18} /></span>}<div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div></div>
        {action && <button type="button" onClick={onAction}>{action}</button>}
      </header>
      {children}
    </section>
  );
}

function Legend({ items }) {
  return <div className="ed-chart-legend">{items.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}</div>;
}

function EmptyState({ text }) {
  return <div className="ed-empty"><DashboardIcon name="dashboard" /><p>{text}</p></div>;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function formatTime(date) {
  return new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" }).format(date);
}
