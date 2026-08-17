const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  messages: <><path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.4-4.2A8.5 8.5 0 1 1 21 12Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></>,
  alert: <><path d="M12 3 2.6 20h18.8L12 3Z"/><path d="M12 9v5M12 17.5h.01"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"/></>,
  projects: <><path d="M3 6h7l2 2h9v11H3V6Z"/><path d="M3 10h18"/></>,
  ideas: <><path d="M9 18h6M10 22h4"/><path d="M8.2 14.8A7 7 0 1 1 15.8 15c-.9.6-1.3 1.2-1.3 2h-5c0-.8-.4-1.5-1.3-2.2Z"/></>,
  purchase: <><path d="M3 4h2l2 12h11l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></>,
  print: <><path d="M7 8V3h10v5M7 17H4V9h16v8h-3"/><rect x="7" y="14" width="10" height="7"/><path d="M17 11h.01"/></>,
  inventory: <><path d="m4 7 8-4 8 4-8 4-8-4Z"/><path d="m4 7 8 4 8-4v10l-8 4-8-4V7ZM12 11v10"/></>,
  support: <><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L20 16.4 16.4 20l-7.7-7.7a4 4 0 0 0-5 5L6 15l2.4 2.4-2.3 2.3a4 4 0 0 0 5-5Z"/></>,
  maintenance: <><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 9.6 6 7.3 3.7a4 4 0 0 0 5 5L20 16.4 16.4 20l-7.7-7.7"/></>,
  equipment: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M8 9l8 4M16 9l-8 4"/></>,
  certificate: <><path d="M6 3h12v14H6z"/><path d="M9 7h6M9 11h6M10 17l-1 4 3-2 3 2-1-4"/></>,
  books: <><path d="M4 5a3 3 0 0 1 3-3h5v18H7a3 3 0 0 0-3 2V5Z"/><path d="M20 5a3 3 0 0 0-3-3h-5v18h5a3 3 0 0 1 3 2V5Z"/></>,
  modules: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  activity: <><path d="M3 12h4l2-7 4 14 2-7h6"/></>,
  chartBar: <><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20"/></>,
  chartLine: <><path d="m3 17 5-6 4 3 7-9M3 21h18"/></>,
  donut: <><path d="M12 3a9 9 0 1 0 9 9h-9V3Z"/><path d="M16 3.9A9 9 0 0 1 20.1 8H16V3.9Z"/></>,
  sparkline: <path d="m3 16 4-5 4 3 4-8 6 5"/>,
  refresh: <><path d="M20 7v5h-5"/><path d="M4 17a8 8 0 0 0 13.7 1M20 7A8 8 0 0 0 6.3 6"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  drag: <><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="m9 18 6-6-6-6"/>,
};

export function DashboardIcon({ name, size = 20 }) {
  return (
    <svg className="ed-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {PATHS[name] || PATHS.dashboard}
    </svg>
  );
}

export function Sparkline({ values = [], color = "#2563eb", height = 28 }) {
  const safeValues = values.length ? values.map((value) => Number(value || 0)) : [0, 0];
  const max = Math.max(...safeValues, 1);
  const min = Math.min(...safeValues, 0);
  const range = Math.max(1, max - min);
  const points = safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? 50 : (index / (safeValues.length - 1)) * 100;
    const y = height - 3 - ((value - min) / range) * (height - 6);
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg className="ed-sparkline" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function BarChart({ items = [], series = [], maxItems = 7 }) {
  const visible = items.slice(0, maxItems);
  const max = Math.max(1, ...visible.flatMap((item) => series.map((entry) => Number(item[entry.key] || 0))));
  return (
    <div className="ed-bar-chart" role="img" aria-label="Gráfica comparativa de barras">
      <div className="ed-chart-grid" />
      {visible.map((item) => (
        <div className="ed-bar-group" key={item.id || item.label}>
          <div className="ed-bars">
            {series.map((entry) => {
              const value = Number(item[entry.key] || 0);
              return (
                <span key={entry.key} className="ed-bar" style={{ height: `${Math.max(value > 0 ? 5 : 0, (value / max) * 100)}%`, background: entry.color }} title={`${entry.label}: ${value}`}>
                  <b>{value}</b>
                </span>
              );
            })}
          </div>
          <small title={item.label}>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ series = [], labels = [] }) {
  const values = series.flatMap((entry) => entry.values || []).map(Number);
  const max = Math.max(1, ...values);
  const width = 600;
  const height = 170;
  const x = (index) => labels.length <= 1 ? width / 2 : 12 + (index / (labels.length - 1)) * (width - 24);
  const y = (value) => height - 18 - (Number(value || 0) / max) * (height - 36);

  return (
    <div className="ed-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Gráfica de evolución">
        {[0.25, 0.5, 0.75, 1].map((ratio) => <line key={ratio} x1="0" x2={width} y1={height - ratio * (height - 20)} y2={height - ratio * (height - 20)} className="ed-chart-guide" />)}
        {series.map((entry) => {
          const points = (entry.values || []).map((value, index) => `${x(index)},${y(value)}`).join(" ");
          return <polyline key={entry.label} points={points} fill="none" stroke={entry.color} strokeWidth="3" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="ed-line-labels">{labels.map((label) => <small key={label}>{label}</small>)}</div>
    </div>
  );
}

export function DonutChart({ items = [], centerValue = 0, centerLabel = "Total" }) {
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;
  const segments = items.reduce((result, item) => {
    const start = result.current;
    const end = start + Number(item.value || 0) / total * 100;
    return { current: end, values: [...result.values, `${item.color} ${start}% ${end}%`] };
  }, { current: 0, values: [] }).values;
  return (
    <div className="ed-donut-wrap">
      <div className="ed-donut" style={{ background: `conic-gradient(${segments.join(",")})` }}>
        <span><strong>{centerValue}</strong><small>{centerLabel}</small></span>
      </div>
      <div className="ed-donut-legend">{items.map((item) => <div key={item.label}><i style={{ background: item.color }} /><span>{item.label}</span><b>{item.value}</b></div>)}</div>
    </div>
  );
}
