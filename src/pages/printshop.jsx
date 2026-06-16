const metrics = [
  {
    label: "Solicitudes pendientes",
    value: "18",
    helper: "Trabajos por atender",
    icon: "▤",
    tone: "blue",
  },
  {
    label: "Lotes activos",
    value: "7",
    helper: "Producción en curso",
    icon: "▧",
    tone: "teal",
  },
  {
    label: "Libros con stock bajo",
    value: "3",
    helper: "Requieren reposición",
    icon: "▣",
    tone: "orange",
  },
  {
    label: "Listos para entrega",
    value: "12",
    helper: "Pendientes de salida",
    icon: "✓",
    tone: "green",
  },
  {
    label: "Insumos críticos",
    value: "4",
    helper: "Debajo del mínimo",
    icon: "!",
    tone: "red",
  },
  {
    label: "Merma del mes",
    value: "2.4%",
    helper: "Producción registrada",
    icon: "↗",
    tone: "purple",
  },
];

const requests = [
  {
    folio: "IMP-2026-0012",
    product: "Certificados A2",
    requester: "Dirección Académica",
    status: "En revisión",
    statusTone: "blue",
    delivery: "Hoy 5:00 pm",
  },
  {
    folio: "IMP-2026-0013",
    product: "Volantes",
    requester: "Recepción",
    status: "En producción",
    statusTone: "orange",
    delivery: "Mañana",
  },
  {
    folio: "IMP-2026-0014",
    product: "Vinil",
    requester: "Administración",
    status: "Lista para entrega",
    statusTone: "green",
    delivery: "Viernes",
  },
];

const batches = [
  {
    folio: "LOTE-JOURNEY-2026-001",
    product: "Journey A1",
    progress: 75,
    status: "En encuadernado",
    statusTone: "blue",
    quantity: "1,200 / 1,600",
  },
  {
    folio: "LOTE-EXPLORE-2026-002",
    product: "Explore A2",
    progress: 45,
    status: "En revisión de calidad",
    statusTone: "orange",
    quantity: "800 / 1,800",
  },
  {
    folio: "LOTE-DISCOVER-2026-003",
    product: "Discover B1",
    progress: 100,
    status: "Ingresado a inventario",
    statusTone: "green",
    quantity: "1,500 / 1,500",
  },
];

const finishedInventory = [
  {
    product: "Journey A1",
    stock: 8,
    minimum: 10,
    status: "Bajo",
    tone: "red",
  },
  {
    product: "Explore A2",
    stock: 12,
    minimum: 10,
    status: "OK",
    tone: "green",
  },
  {
    product: "Discover B1",
    stock: 5,
    minimum: 10,
    status: "Bajo",
    tone: "red",
  },
];

const criticalSupplies = [
  {
    icon: "▤",
    name: "Papel bond carta",
    spec: "75 g/m²",
    available: "3 resmas",
    minimum: "10 resmas",
    status: "Crítico",
    tone: "red",
  },
  {
    icon: "▥",
    name: "Opalina",
    spec: "225 g/m²",
    available: "2 paquetes",
    minimum: "5 paquetes",
    status: "Crítico",
    tone: "red",
  },
  {
    icon: "●",
    name: "Tinta Epson 544",
    spec: "Negra",
    available: "1 unidad",
    minimum: "4 unidades",
    status: "Crítico",
    tone: "red",
  },
  {
    icon: "▨",
    name: "Cartucho Canon PFI-120",
    spec: "Cyan",
    available: "2 unidades",
    minimum: "4 unidades",
    status: "Bajo",
    tone: "orange",
  },
];

const certificateStudents = [
  {
    name: "Ana López Martínez",
    delivery: "Impreso",
  },
  {
    name: "Carlos Ramírez Gómez",
    delivery: "Digital",
  },
  {
    name: "Mariana Torres Ruiz",
    delivery: "Ambos",
  },
];

export default function PrintShop() {
  return (
    <div className="printshop-page">
      <section className="printshop-topbar">
        <div>
          <p className="section-kicker printshop-kicker">Módulo operativo</p>
          <h1>Módulo de Imprenta</h1>
          <p>
            Control de producción, solicitudes, inventario de libros, insumos y
            generación de certificados con folio y QR de validación.
          </p>
        </div>

        <label className="printshop-search">
          <span>⌕</span>
          <input type="search" placeholder="Buscar folio, producto o insumo" />
        </label>
      </section>

      <section className="printshop-metrics-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </section>

      <section className="printshop-action-grid">
        <ActionCard
          icon="＋"
          title="Nueva solicitud"
          description="Registrar certificados, diplomas, volantes, viniles o materiales internos."
        />
        <ActionCard
          icon="▧"
          title="Nuevo lote"
          description="Crear producción interna de libros para inventario terminado."
        />
        <ActionCard
          icon="▣"
          title="Generar certificados"
          description="Generar documentos con folio, firma y QR de validación."
        />
      </section>

      <section className="printshop-main-grid">
        <div className="printshop-main-column">
          <Panel
            title="Solicitudes recientes"
            icon="▤"
            actionLabel="Ver todas"
          >
            <div className="printshop-table-wrap">
              <table className="printshop-table">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Producto / Servicio</th>
                    <th>Solicitante</th>
                    <th>Estado</th>
                    <th>Entrega estimada</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.folio}>
                      <td>
                        <strong>{request.folio}</strong>
                      </td>
                      <td>{request.product}</td>
                      <td>{request.requester}</td>
                      <td>
                        <StatusBadge tone={request.statusTone}>
                          {request.status}
                        </StatusBadge>
                      </td>
                      <td>{request.delivery}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel
            title="Lotes de producción"
            icon="▧"
            actionLabel="Ver todos"
          >
            <div className="printshop-table-wrap">
              <table className="printshop-table printshop-batches-table">
                <thead>
                  <tr>
                    <th>Folio del lote</th>
                    <th>Producto</th>
                    <th>Progreso</th>
                    <th>Estado</th>
                    <th>Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.folio}>
                      <td>
                        <strong>{batch.folio}</strong>
                      </td>
                      <td>{batch.product}</td>
                      <td>
                        <ProgressBar value={batch.progress} tone={batch.statusTone} />
                      </td>
                      <td>
                        <StatusBadge tone={batch.statusTone}>
                          {batch.status}
                        </StatusBadge>
                      </td>
                      <td>{batch.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>

        <aside className="printshop-side-column">
          <Panel
            title="Inventario de productos terminados"
            icon="▣"
            actionLabel="Ver inventario"
          >
            <div className="finished-inventory-list">
              {finishedInventory.map((item) => (
                <div className="finished-inventory-row" key={item.product}>
                  <div>
                    <strong>{item.product}</strong>
                    <span>Stock {item.stock} · mínimo {item.minimum}</span>
                  </div>
                  <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Insumos críticos" icon="!" actionLabel="Ver todos">
            <div className="critical-supplies-list">
              {criticalSupplies.map((supply) => (
                <div className="critical-supply-row" key={`${supply.name}-${supply.spec}`}>
                  <div className={`critical-supply-icon ${supply.tone}`}>
                    {supply.icon}
                  </div>
                  <div className="critical-supply-info">
                    <strong>{supply.name}</strong>
                    <span>{supply.spec}</span>
                  </div>
                  <div className="critical-supply-stock">
                    <strong>{supply.available}</strong>
                    <span>Mín. {supply.minimum}</span>
                  </div>
                  <StatusBadge tone={supply.tone}>{supply.status}</StatusBadge>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </section>

      <section className="printshop-bottom-grid">
        <Panel
          title="Certificados y diplomas"
          icon="◎"
          actionLabel="Configurar plantillas"
        >
          <div className="certificate-workflow-layout">
            <div className="certificate-form-preview">
              <label>
                <span>Tipo de documento</span>
                <select defaultValue="Certificado">
                  <option>Certificado</option>
                  <option>Diploma</option>
                </select>
              </label>

              <label>
                <span>Nivel</span>
                <select defaultValue="A2">
                  <option>A1</option>
                  <option>A2</option>
                  <option>B1</option>
                  <option>B2</option>
                  <option>C1</option>
                </select>
              </label>

              <label>
                <span>Grupo</span>
                <select defaultValue="Teacher Samantha · Lun/Mié 6:00 pm">
                  <option>Teacher Samantha · Lun/Mié 6:00 pm</option>
                  <option>Teacher David · Mar/Jue 7:00 pm</option>
                  <option>Teacher Evelyn · Sábado 9:00 am</option>
                </select>
              </label>

              <label>
                <span>Maestro / firma</span>
                <select defaultValue="Samantha Rodríguez">
                  <option>Samantha Rodríguez</option>
                  <option>David Hernández</option>
                  <option>Evelyn Martínez</option>
                </select>
              </label>

              <div className="certificate-counts">
                <div>
                  <span>Impresos</span>
                  <strong>12</strong>
                </div>
                <div>
                  <span>Digitales</span>
                  <strong>6</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>18</strong>
                </div>
              </div>

              <button type="button" className="visual-primary-button certificate-button">
                Generar certificados
              </button>
            </div>

            <div className="certificate-card-preview">
              <div className="certificate-border">
                <div className="certificate-logo">AES</div>
                <small>Active English School</small>
                <h3>CERTIFICADO</h3>
                <p>Otorgado a</p>
                <strong>Juan Pérez García</strong>
                <span>
                  Por haber concluido satisfactoriamente el nivel A2 del
                  programa académico correspondiente.
                </span>
                <div className="certificate-signature">Samantha Rodríguez</div>
                <div className="certificate-footer">
                  <div>
                    <small>Folio</small>
                    <b>CERT-2026-000123</b>
                  </div>
                  <div>
                    <small>QR de validación</small>
                    <div className="qr-placeholder">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="certificate-students-card">
              <div className="mini-section-header no-margin">
                <div>
                  <span>☑</span>
                  <h3>Lista de alumnos</h3>
                </div>
              </div>

              <div className="certificate-students-list">
                {certificateStudents.map((student) => (
                  <div className="certificate-student-row" key={student.name}>
                    <strong>{student.name}</strong>
                    <StatusBadge
                      tone={
                        student.delivery === "Digital"
                          ? "blue"
                          : student.delivery === "Ambos"
                            ? "purple"
                            : "green"
                      }
                    >
                      {student.delivery}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Ruta de desarrollo" icon="▥" actionLabel="Ver plan">
          <div className="printshop-roadmap-list">
            <RoadmapItem
              number="1"
              title="Interfaz principal"
              description="Dejar el módulo visible y navegable con datos de ejemplo."
              active
            />
            <RoadmapItem
              number="2"
              title="Solicitudes y lotes"
              description="Separar trabajos solicitados de producción para inventario."
            />
            <RoadmapItem
              number="3"
              title="Certificados automáticos"
              description="Folio, firma precargada, QR de validación y versión digital."
            />
            <RoadmapItem
              number="4"
              title="Inventario, merma y reportes"
              description="Conectar insumos, costos, desperdicio y estadísticas."
            />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function MetricCard({ metric }) {
  return (
    <article className={`printshop-metric-card ${metric.tone}`}>
      <div className="printshop-metric-icon">{metric.icon}</div>
      <div>
        <span>{metric.label}</span>
        <strong>{metric.value}</strong>
        <p>{metric.helper}</p>
      </div>
    </article>
  );
}

function ActionCard({ icon, title, description }) {
  return (
    <button type="button" className="printshop-action-card">
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <b>›</b>
    </button>
  );
}

function Panel({ title, icon, actionLabel, children }) {
  return (
    <section className="printshop-panel">
      <div className="printshop-panel-header">
        <div>
          <span>{icon}</span>
          <h2>{title}</h2>
        </div>

        {actionLabel && <button type="button">{actionLabel}</button>}
      </div>

      {children}
    </section>
  );
}

function StatusBadge({ tone = "blue", children }) {
  return <span className={`printshop-status-badge ${tone}`}>{children}</span>;
}

function ProgressBar({ value, tone = "blue" }) {
  return (
    <div className="printshop-progress-cell">
      <div className="printshop-progress-track">
        <div
          className={`printshop-progress-fill ${tone}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <strong>{value}%</strong>
    </div>
  );
}

function RoadmapItem({ number, title, description, active = false }) {
  return (
    <div className={`printshop-roadmap-item ${active ? "active" : ""}`}>
      <span>{number}</span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}
