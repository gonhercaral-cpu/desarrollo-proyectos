import { formatDate } from "./labels.js";
import { millis } from "./model.js";

const STATE = { idle: "En espera", processing: "Procesando", stopped: "Detenida" };
const REASONS = { offline: "Equipo sin conexión", "media-empty": "Sin papel", "media-needed": "Se requiere papel",
  "media-jam": "Atasco de papel", "toner-low": "Tóner bajo", "toner-empty": "Sin tóner",
  "marker-supply-low": "Nivel bajo de consumibles", "marker-supply-empty": "Consumible agotado",
  "cups-missing-filter": "Falta un filtro de CUPS" };

function reasonLabel(raw) {
  return REASONS[raw.replace(/-(report|warning|error)$/, "")] || raw;
}

function Readings({ title, items }) {
  return (
    <div>
      <h4>{title}</h4>
      {items?.length ? <ul className="pp-telemetry-levels">{items.map((item, index) => {
        const comparable = item.level != null && item.capacity > 0 && item.level <= item.capacity;
        const percent = comparable ? Math.round(item.level * 100 / item.capacity) : null;
        return (
          <li key={`${item.name}-${index}`}>
            <strong>{item.name}</strong>
            <span>{percent != null ? `${percent}%` : item.level == null ? "Nivel sin datos" : `${item.level} ${item.unit || ""}`}</span>
            {comparable && <meter aria-label={item.name} min={0} max={100} value={percent}>{percent}%</meter>}
          </li>
        );
      })}</ul> : <p>La cola no reportó niveles.</p>}
    </div>
  );
}

export default function PrinterTelemetry({ printer, clock }) {
  const data = printer.telemetry || {};
  const stale = !printer.online || clock - millis(printer.lastSeenAt) > 120000;
  const reasons = (printer.statusReasons || []).filter((name) => name !== "none");
  return (
    <section aria-label="Lecturas de la cola CUPS">
      <dl className="pp-facts">
        <dt>Cola local</dt><dd>{printer.queue}</dd>
        <dt>Modelo</dt><dd>{printer.settings?.makeModel || data.makeModel || "Sin datos"}</dd>
        <dt>Ubicación</dt><dd>{printer.settings?.location || data.location || "Sin datos"}</dd>
        <dt>Estado de la cola</dt><dd>{STATE[data.state] || "Sin datos"}{stale ? " · Última lectura" : ""}</dd>
        <dt>Acepta trabajos</dt><dd>{data.accepting == null ? "Sin datos" : data.accepting ? "Sí" : "No"}</dd>
        <dt>Trabajos en cola</dt><dd>{data.queuedJobs ?? "Sin datos"}</dd>
        <dt>Velocidad de CUPS</dt><dd>{data.speed > 0 ? `${data.speed} pág/min` : "Sin datos"}{data.colorSpeed > 0 && ` · ${data.colorSpeed} pág/min a color`}</dd>
        {printer.settings?.pagesPerMinute && <><dt>Velocidad configurada</dt><dd>{printer.settings.pagesPerMinute} pág/min</dd></>}
        <dt>Papel admitido</dt><dd>{printer.paperSizes?.join(", ") || "Sin datos"}</dd>
        <dt>Tipos de papel</dt><dd>{printer.capabilities?.mediaTypes?.join(", ") || "Sin datos"}</dd>
        <dt>Última lectura</dt><dd>{printer.lastSeenAt ? formatDate(printer.lastSeenAt) : "Sin datos"}</dd>
      </dl>
      {reasons.length > 0 && <ul className="pp-telemetry-alerts">{reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}</ul>}
      <div className="pp-routing-columns">
        <Readings title="Tinta, tóner y otros insumos" items={data.supplies} />
        <Readings title="Bandejas de papel" items={data.trays} />
      </div>
      {stale && <p role="status">La impresora figura fuera de línea o el agente dejó de reportar. Las lecturas corresponden al último contacto.</p>}
    </section>
  );
}
