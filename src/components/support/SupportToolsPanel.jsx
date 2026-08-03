import { useEffect, useMemo, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { db } from "../../services/firebase";
import {
  completeSupportToolMaintenance,
  createSupportTool,
  loanSupportTool,
  recordSupportToolLabelPrint,
  retireSupportTool,
  returnSupportTool,
  startSupportToolMaintenance,
  subscribeSupportToolHistory,
  subscribeSupportToolMaintenance,
  subscribeSupportToolMovements,
  subscribeSupportTools,
  updateSupportTool,
  uploadSupportToolImage,
} from "../../services/supportToolsService";

const STATUSES = [
  "Disponible",
  "Asignada",
  "En uso",
  "Prestada",
  "En mantenimiento",
  "Dañada",
  "Extraviada",
  "Baja",
];

const EMPTY_TOOL = {
  name: "",
  category: "Herramienta manual",
  subcategory: "",
  brand: "",
  model: "",
  serialNumber: "",
  description: "",
  barcode: "",
  status: "Disponible",
  campus: "",
  area: "Soporte Técnico",
  warehouse: "",
  specificLocation: "",
  responsibleUid: "",
  responsibleName: "",
  purchaseDate: "",
  supplier: "",
  cost: 0,
  invoiceReference: "",
  warrantyExpiresAt: "",
  requiresMaintenance: false,
  lastMaintenanceAt: "",
  nextMaintenanceAt: "",
  maintenanceFrequency: "Cada 6 meses",
  maintenanceNotes: "",
  notes: "",
  imageUrl: "",
  imagePath: "",
};

const EMPTY_LOAN = {
  mode: "loan",
  recipientUid: "",
  recipientName: "",
  expectedReturnAt: "",
  campus: "",
  location: "",
  reason: "",
  physicalConditionOut: "Buen estado",
  notes: "",
};

const EMPTY_RETURN = {
  physicalConditionIn: "Buen estado",
  damaged: false,
  damages: "",
  notes: "",
  campus: "",
  location: "",
};

const EMPTY_MAINTENANCE = {
  reason: "",
  provider: "",
  responsibleName: "",
  sentAt: "",
  estimatedReturnAt: "",
  cost: 0,
};

const EMPTY_MAINTENANCE_COMPLETION = {
  result: "Reparada",
  repairDescription: "",
  returnedAt: "",
  nextMaintenanceAt: "",
  cost: 0,
};

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: value?.toDate ? "short" : undefined }).format(date);
}

function dateMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function statusClass(status) {
  return String(status || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function isMaintenanceSoon(tool) {
  if (!tool?.nextMaintenanceAt || tool.requiresMaintenance !== true) return false;
  const next = new Date(`${tool.nextMaintenanceAt}T12:00:00`).getTime();
  const days = (next - Date.now()) / 86400000;
  return days <= 30;
}

function getToolRoute(toolId) {
  return `${window.location.origin}/?page=technical-support&toolId=${encodeURIComponent(toolId)}`;
}

export default function SupportToolsPanel({ isAdmin = false, requestedToolId = "" }) {
  const [tools, setTools] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [campusFilter, setCampusFilter] = useState("Todos");
  const [responsibleFilter, setResponsibleFilter] = useState("Todos");
  const [maintenanceFilter, setMaintenanceFilter] = useState("todos");
  const [sort, setSort] = useState("createdAt");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_TOOL);
  const [editingTool, setEditingTool] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedTool, setSelectedTool] = useState(null);
  const [history, setHistory] = useState([]);
  const [movements, setMovements] = useState([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState([]);
  const [action, setAction] = useState("");
  const [loanForm, setLoanForm] = useState(EMPTY_LOAN);
  const [returnForm, setReturnForm] = useState(EMPTY_RETURN);
  const [maintenanceForm, setMaintenanceForm] = useState(EMPTY_MAINTENANCE);
  const [completionForm, setCompletionForm] = useState(EMPTY_MAINTENANCE_COMPLETION);
  const [selectedLabelTool, setSelectedLabelTool] = useState(null);
  const [selectedToolIds, setSelectedToolIds] = useState(new Set());
  const labelRef = useRef(null);
  const requestedToolOpenedRef = useRef(false);

  useEffect(() => subscribeSupportTools(
    (items) => {
      setTools(items);
      if (requestedToolId && !requestedToolOpenedRef.current) {
        const requested = items.find((tool) => tool.id === requestedToolId);
        if (requested) {
          requestedToolOpenedRef.current = true;
          setSelectedTool(requested);
        }
      }
      setLoading(false);
      setError("");
    },
    () => {
      setLoading(false);
      setError("No se pudo cargar inventario de herramientas.");
    }
  ), [requestedToolId]);

  useEffect(() => {
    getDocs(query(collection(db, "users"), where("active", "==", true))).then((snapshot) => {
      setUsers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((user) => user.active === true));
    }).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (!selectedTool?.id) return undefined;
    const unsubscribeHistory = subscribeSupportToolHistory(selectedTool.id, setHistory, () => setHistory([]));
    const unsubscribeMovements = subscribeSupportToolMovements(selectedTool.id, setMovements, () => setMovements([]));
    const unsubscribeMaintenance = subscribeSupportToolMaintenance(selectedTool.id, setMaintenanceRecords, () => setMaintenanceRecords([]));
    return () => {
      unsubscribeHistory();
      unsubscribeMovements();
      unsubscribeMaintenance();
    };
  }, [selectedTool?.id]);

  function closeSelectedTool() {
    setSelectedTool(null);
    setHistory([]);
    setMovements([]);
    setMaintenanceRecords([]);
  }

  const categories = useMemo(() => [...new Set(tools.map((tool) => tool.category).filter(Boolean))].sort(), [tools]);
  const campuses = useMemo(() => [...new Set(tools.map((tool) => tool.campus).filter(Boolean))].sort(), [tools]);
  const responsibles = useMemo(() => [...new Set(tools.map((tool) => tool.responsibleName).filter(Boolean))].sort(), [tools]);
  const filteredTools = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es-MX");
    return tools.filter((tool) => {
      const searchable = tool.searchText || [tool.folio, tool.name, tool.brand, tool.model, tool.serialNumber, tool.barcode, tool.category].join(" ").toLowerCase();
      if (term && !searchable.includes(term)) return false;
      if (statusFilter !== "Todos" && tool.status !== statusFilter) return false;
      if (categoryFilter !== "Todas" && tool.category !== categoryFilter) return false;
      if (campusFilter !== "Todos" && tool.campus !== campusFilter) return false;
      if (responsibleFilter !== "Todos" && tool.responsibleName !== responsibleFilter) return false;
      if (maintenanceFilter === "soon" && !isMaintenanceSoon(tool)) return false;
      if (maintenanceFilter === "damaged" && tool.status !== "Dañada") return false;
      if (maintenanceFilter === "lost" && tool.status !== "Extraviada") return false;
      return true;
    }).sort((first, second) => {
      if (sort === "name") return first.name.localeCompare(second.name, "es");
      if (sort === "status") return first.status.localeCompare(second.status, "es");
      if (sort === "campus") return String(first.campus).localeCompare(String(second.campus), "es");
      if (sort === "maintenance") return String(first.nextMaintenanceAt || "9999").localeCompare(String(second.nextMaintenanceAt || "9999"));
      return dateMillis(second.createdAt) - dateMillis(first.createdAt);
    });
  }, [tools, search, statusFilter, categoryFilter, campusFilter, responsibleFilter, maintenanceFilter, sort]);

  const metrics = useMemo(() => ({
    total: tools.length,
    available: tools.filter((tool) => tool.status === "Disponible").length,
    assigned: tools.filter((tool) => ["Asignada", "Prestada", "En uso"].includes(tool.status)).length,
    maintenance: tools.filter((tool) => tool.status === "En mantenimiento").length,
    damaged: tools.filter((tool) => tool.status === "Dañada").length,
    lost: tools.filter((tool) => tool.status === "Extraviada").length,
    maintenanceSoon: tools.filter(isMaintenanceSoon).length,
  }), [tools]);

  function openNewTool() {
    setEditingTool(null);
    setForm(EMPTY_TOOL);
    setImageFile(null);
    setFormOpen(true);
    setMessage("");
  }

  function openEditTool(tool) {
    setEditingTool(tool);
    setForm({ ...EMPTY_TOOL, ...tool });
    setImageFile(null);
    setFormOpen(true);
    setMessage("");
  }

  function changeForm(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  async function saveTool(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const result = editingTool
        ? await updateSupportTool(editingTool.id, form)
        : await createSupportTool(form);
      const toolId = editingTool?.id || result.id;
      if (imageFile) {
        const image = await uploadSupportToolImage(toolId, imageFile, editingTool?.imagePath || "");
        await updateSupportTool(toolId, { ...form, ...image });
      }
      setFormOpen(false);
      setEditingTool(null);
      setImageFile(null);
      setMessage(editingTool ? "Herramienta actualizada." : `Herramienta ${result.folio} registrada.`);
    } catch (saveError) {
      setMessage(saveError?.message || "No se pudo guardar herramienta.");
    } finally {
      setSaving(false);
    }
  }

  function chooseRecipient(uid) {
    const user = users.find((item) => item.id === uid || item.uid === uid);
    setLoanForm((current) => ({ ...current, recipientUid: uid, recipientName: user?.name || user?.email || "" }));
  }

  async function saveAction(event) {
    event.preventDefault();
    if (!selectedTool) return;
    setSaving(true);
    setMessage("");
    try {
      if (action === "loan") await loanSupportTool(selectedTool.id, loanForm);
      if (action === "return") await returnSupportTool(selectedTool.id, returnForm);
      if (action === "maintenance") await startSupportToolMaintenance(selectedTool.id, maintenanceForm);
      if (action === "complete-maintenance") await completeSupportToolMaintenance(selectedTool.id, completionForm);
      setAction("");
      setMessage("Movimiento guardado y agregado al historial.");
    } catch (actionError) {
      setMessage(actionError?.message || "No se pudo completar movimiento.");
    } finally {
      setSaving(false);
    }
  }

  async function retireTool(tool) {
    const reason = window.prompt(`Motivo de baja para ${tool.folio}:`);
    if (reason === null) return;
    try {
      await retireSupportTool(tool.id, reason);
      setMessage(`${tool.folio} dada de baja.`);
    } catch (retireError) {
      setMessage(retireError?.message || "No se pudo dar de baja.");
    }
  }

  function toggleToolSelection(toolId) {
    setSelectedToolIds((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }

  async function printLabels(toolIds) {
    const ids = toolIds.length ? toolIds : selectedLabelTool ? [selectedLabelTool.id] : [];
    if (!ids.length) return;
    await Promise.all(ids.map((id) => recordSupportToolLabelPrint(id).catch(() => undefined)));
    document.body.classList.add("support-tools-printing");
    window.setTimeout(() => {
      window.print();
      document.body.classList.remove("support-tools-printing");
    }, 100);
  }

  async function downloadLabelPdf() {
    if (!labelRef.current || !selectedLabelTool) return;
    const canvas = await html2canvas(labelRef.current, { scale: 3, backgroundColor: "#ffffff" });
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [50, 30] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, 50, 30);
    pdf.save(`${selectedLabelTool.folio || "herramienta"}-etiqueta.pdf`);
    await recordSupportToolLabelPrint(selectedLabelTool.id).catch(() => undefined);
  }

  const printableTools = selectedLabelTool
    ? [selectedLabelTool]
    : tools.filter((tool) => selectedToolIds.has(tool.id));

  return (
    <section className="support-tools-workspace">
      <header className="support-tools-hero">
        <div>
          <p className="section-kicker">Inventario operativo</p>
          <h2>Herramientas</h2>
          <p>Control de herramientas, préstamos, mantenimiento y etiquetas.</p>
        </div>
        <div className="support-tools-hero-actions">
          {selectedToolIds.size > 0 && <button type="button" className="visual-outline-button" onClick={() => printLabels([...selectedToolIds])}>Imprimir etiquetas ({selectedToolIds.size})</button>}
          <button type="button" className="visual-primary-button" onClick={openNewTool}>+ Nueva herramienta</button>
        </div>
      </header>

      {message && <div className="message-box">{message}</div>}
      {error && <div className="form-error">{error}</div>}

      <div className="support-tools-kpis">
        {[
          ["Total", metrics.total, "blue"], ["Disponibles", metrics.available, "green"],
          ["Asignadas", metrics.assigned, "purple"], ["Mantenimiento", metrics.maintenance, "orange"],
          ["Dañadas", metrics.damaged, "red"], ["Extraviadas", metrics.lost, "red"],
          ["Mantenimiento próximo", metrics.maintenanceSoon, "gold"],
        ].map(([label, value, tone]) => <article key={label} className={`tool-kpi ${tone}`}><span>{label}</span><strong>{value}</strong></article>)}
      </div>

      <div className="support-tools-filters">
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, folio, marca, modelo, serie o código" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option>Todos</option>{STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option>Todas</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
        <select value={campusFilter} onChange={(event) => setCampusFilter(event.target.value)}><option>Todos</option>{campuses.map((campus) => <option key={campus}>{campus}</option>)}</select>
        <select value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)}><option>Todos</option>{responsibles.map((responsible) => <option key={responsible}>{responsible}</option>)}</select>
        <select value={maintenanceFilter} onChange={(event) => setMaintenanceFilter(event.target.value)}><option value="todos">Todas</option><option value="soon">Mantenimiento próximo</option><option value="damaged">Dañadas</option><option value="lost">Extraviadas</option></select>
        <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="createdAt">Más recientes</option><option value="name">Nombre</option><option value="status">Estado</option><option value="campus">Plantel</option><option value="maintenance">Próximo mantenimiento</option></select>
      </div>

      {loading ? <div className="empty-state"><p>Cargando herramientas...</p></div> : filteredTools.length === 0 ? <div className="empty-state"><h3>Sin herramientas</h3><p>Registra primera herramienta o ajusta filtros.</p></div> : (
        <div className="support-tools-grid">
          {filteredTools.map((tool) => (
            <article className={`support-tool-card status-${statusClass(tool.status)}`} key={tool.id}>
              <div className="support-tool-image">{tool.imageUrl ? <img src={tool.imageUrl} alt={tool.name} loading="lazy" /> : <span>🛠</span>}<input type="checkbox" checked={selectedToolIds.has(tool.id)} onChange={() => toggleToolSelection(tool.id)} aria-label={`Seleccionar ${tool.folio}`} /></div>
              <div className="support-tool-card-copy">
                <div><strong>{tool.name}</strong><span>{tool.folio}</span></div>
                <span className={`support-tool-status status-${statusClass(tool.status)}`}>{tool.status || "Disponible"}</span>
                <p>{tool.category}{tool.brand ? ` · ${tool.brand}` : ""}{tool.model ? ` ${tool.model}` : ""}</p>
                <small>{tool.campus || "Sin plantel"} · {tool.specificLocation || tool.area || "Sin ubicación"}</small>
                <small>Responsable: {tool.responsibleName || "Disponible"}</small>
                <small>Próximo mantenimiento: {tool.nextMaintenanceAt || "Sin programar"}</small>
              </div>
              <div className="support-tool-actions">
                <button type="button" onClick={() => setSelectedTool(tool)}>Detalles</button>
                <button type="button" onClick={() => openEditTool(tool)}>Editar</button>
                {tool.status === "Disponible" && <button type="button" onClick={() => { setSelectedTool(tool); setLoanForm({ ...EMPTY_LOAN, campus: tool.campus || "", location: tool.specificLocation || "" }); setAction("loan"); }}>Prestar</button>}
                {["Asignada", "Prestada", "En uso"].includes(tool.status) && <button type="button" onClick={() => { setSelectedTool(tool); setReturnForm({ ...EMPTY_RETURN, campus: tool.campus || "", location: tool.specificLocation || "" }); setAction("return"); }}>Devolver</button>}
                {["Disponible", "Dañada"].includes(tool.status) && <button type="button" onClick={() => { setSelectedTool(tool); setAction("maintenance"); }}>Mantenimiento</button>}
                {tool.status === "En mantenimiento" && <button type="button" onClick={() => { setSelectedTool(tool); setAction("complete-maintenance"); }}>Completar</button>}
                <button type="button" onClick={() => setSelectedLabelTool(tool)}>Etiqueta</button>
                {isAdmin && tool.status !== "Baja" && <button type="button" className="danger-table-button" onClick={() => retireTool(tool)}>Dar de baja</button>}
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="technical-modal-backdrop"><form className="technical-modal support-tool-form-modal" onSubmit={saveTool}>
          <header><div><p className="section-kicker">{editingTool ? editingTool.folio : "Alta"}</p><h3>{editingTool ? "Editar herramienta" : "Nueva herramienta"}</h3></div><button type="button" onClick={() => setFormOpen(false)}>×</button></header>
          <div className="support-tool-form-grid">
            <label><span>Nombre *</span><input name="name" value={form.name} onChange={changeForm} required /></label>
            <label><span>Categoría *</span><input name="category" value={form.category} onChange={changeForm} list="tool-categories" required /><datalist id="tool-categories">{["Desarmador", "Pinzas", "Taladro", "Multímetro", "Probador de red", "Ponchadora", "Escalera", "Aspiradora", "Cautín", "Kit de mantenimiento", "Herramienta manual", "Herramienta eléctrica", ...categories].map((item) => <option key={item}>{item}</option>)}</datalist></label>
            <label><span>Subcategoría</span><input name="subcategory" value={form.subcategory} onChange={changeForm} /></label>
            <label><span>Marca</span><input name="brand" value={form.brand} onChange={changeForm} /></label>
            <label><span>Modelo</span><input name="model" value={form.model} onChange={changeForm} /></label>
            <label><span>Número de serie</span><input name="serialNumber" value={form.serialNumber} onChange={changeForm} /></label>
            <label><span>QR / código de barras</span><input name="barcode" value={form.barcode} onChange={changeForm} placeholder="Vacío usa folio" /></label>
            <label><span>Estado</span><select name="status" value={form.status} onChange={changeForm} disabled={!isAdmin}>{STATUSES.filter((status) => isAdmin || status !== "Baja").map((status) => <option key={status}>{status}</option>)}</select></label>
            <label><span>Plantel</span><input name="campus" value={form.campus} onChange={changeForm} /></label>
            <label><span>Área</span><input name="area" value={form.area} onChange={changeForm} /></label>
            <label><span>Almacén</span><input name="warehouse" value={form.warehouse} onChange={changeForm} /></label>
            <label><span>Ubicación específica</span><input name="specificLocation" value={form.specificLocation} onChange={changeForm} /></label>
            <label><span>Fecha de compra</span><input type="date" name="purchaseDate" value={form.purchaseDate} onChange={changeForm} /></label>
            <label><span>Proveedor</span><input name="supplier" value={form.supplier} onChange={changeForm} /></label>
            {isAdmin && <label><span>Costo</span><input type="number" min="0" step="0.01" name="cost" value={form.cost} onChange={changeForm} /></label>}
            <label><span>Factura / referencia</span><input name="invoiceReference" value={form.invoiceReference} onChange={changeForm} disabled={Boolean(editingTool) && !isAdmin} /></label>
            <label><span>Fin de garantía</span><input type="date" name="warrantyExpiresAt" value={form.warrantyExpiresAt} onChange={changeForm} /></label>
            <label><span>Fotografía</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] || null)} /></label>
            <label><span>Último mantenimiento</span><input type="date" name="lastMaintenanceAt" value={form.lastMaintenanceAt} onChange={changeForm} /></label>
            <label><span>Próximo mantenimiento</span><input type="date" name="nextMaintenanceAt" value={form.nextMaintenanceAt} onChange={changeForm} /></label>
            <label><span>Frecuencia</span><input name="maintenanceFrequency" value={form.maintenanceFrequency} onChange={changeForm} /></label>
            <label className="support-tool-check"><input type="checkbox" name="requiresMaintenance" checked={form.requiresMaintenance} onChange={changeForm} /><span>Requiere mantenimiento periódico</span></label>
            <label className="full"><span>Descripción</span><textarea name="description" value={form.description} onChange={changeForm} /></label>
            <label className="full"><span>Notas de mantenimiento</span><textarea name="maintenanceNotes" value={form.maintenanceNotes} onChange={changeForm} /></label>
            <label className="full"><span>Notas internas</span><textarea name="notes" value={form.notes} onChange={changeForm} /></label>
          </div>
          <footer><button type="button" className="visual-outline-button" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="visual-primary-button" disabled={saving}>{saving ? "Guardando..." : "Guardar herramienta"}</button></footer>
        </form></div>
      )}

      {selectedTool && !action && !selectedLabelTool && (
        <div className="technical-modal-backdrop"><section className="technical-modal support-tool-detail-modal">
          <header><div><p className="section-kicker">{selectedTool.folio}</p><h3>{selectedTool.name}</h3></div><button type="button" onClick={closeSelectedTool}>×</button></header>
          <div className="support-tool-detail-summary">{selectedTool.imageUrl && <img src={selectedTool.imageUrl} alt={selectedTool.name} />}<div><span className={`support-tool-status status-${statusClass(selectedTool.status)}`}>{selectedTool.status}</span><p>{selectedTool.description || "Sin descripción."}</p><small>{selectedTool.campus || "Sin plantel"} · {selectedTool.specificLocation || selectedTool.area || "Sin ubicación"}</small><small>Responsable: {selectedTool.responsibleName || "Sin asignar"}</small><small>Serie: {selectedTool.serialNumber || "No aplica"}</small></div></div>
          <div className="support-tool-detail-columns">
            <section><h4>Historial</h4>{history.length === 0 ? <p>Sin eventos.</p> : <ol className="support-tool-timeline">{history.map((item) => <li key={item.id}><strong>{item.description || item.type}</strong><span>{item.actorName || "Sistema"}</span><small>{formatDate(item.createdAt)}</small></li>)}</ol>}</section>
            <section><h4>Préstamos y asignaciones</h4>{movements.length === 0 ? <p>Sin movimientos.</p> : movements.map((item) => <article className="support-tool-record" key={item.id}><strong>{item.type === "loan" ? "Préstamo" : "Asignación"} · {item.recipientName}</strong><small>{formatDate(item.deliveredAt)} · {item.status === "returned" ? `Devuelta ${formatDate(item.returnedAt)}` : "Activa"}</small></article>)}<h4>Mantenimientos</h4>{maintenanceRecords.length === 0 ? <p>Sin mantenimientos.</p> : maintenanceRecords.map((item) => <article className="support-tool-record" key={item.id}><strong>{item.reason || "Mantenimiento"}</strong><small>{item.result || item.status} · {item.provider || item.responsibleName || "Interno"}</small></article>)}</section>
          </div>
          <footer><button type="button" onClick={() => setSelectedLabelTool(selectedTool)}>Generar etiqueta</button><button type="button" onClick={() => openEditTool(selectedTool)}>Editar</button><button type="button" className="visual-primary-button" onClick={closeSelectedTool}>Cerrar</button></footer>
        </section></div>
      )}

      {selectedTool && action && (
        <div className="technical-modal-backdrop"><form className="technical-modal support-tool-action-modal" onSubmit={saveAction}>
          <header><div><p className="section-kicker">{selectedTool.folio}</p><h3>{action === "loan" ? "Registrar préstamo o asignación" : action === "return" ? "Registrar devolución" : action === "maintenance" ? "Enviar a mantenimiento" : "Completar mantenimiento"}</h3></div><button type="button" onClick={() => setAction("")}>×</button></header>
          {action === "loan" && <div className="support-tool-form-grid"><label><span>Tipo</span><select value={loanForm.mode} onChange={(event) => setLoanForm((current) => ({ ...current, mode: event.target.value }))}><option value="loan">Préstamo</option><option value="assigned">Asignación</option></select></label><label><span>Receptor</span><select value={loanForm.recipientUid} onChange={(event) => chooseRecipient(event.target.value)} required><option value="">Seleccionar</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}</select></label><label><span>Devolución esperada</span><input type="date" value={loanForm.expectedReturnAt} onChange={(event) => setLoanForm((current) => ({ ...current, expectedReturnAt: event.target.value }))} /></label><label><span>Plantel</span><input value={loanForm.campus} onChange={(event) => setLoanForm((current) => ({ ...current, campus: event.target.value }))} /></label><label className="full"><span>Motivo o tarea</span><textarea value={loanForm.reason} onChange={(event) => setLoanForm((current) => ({ ...current, reason: event.target.value }))} /></label><label className="full"><span>Estado físico al entregar</span><textarea value={loanForm.physicalConditionOut} onChange={(event) => setLoanForm((current) => ({ ...current, physicalConditionOut: event.target.value }))} /></label></div>}
          {action === "return" && <div className="support-tool-form-grid"><label className="support-tool-check"><input type="checkbox" checked={returnForm.damaged} onChange={(event) => setReturnForm((current) => ({ ...current, damaged: event.target.checked }))} /><span>Se detectó daño</span></label><label><span>Nueva ubicación</span><input value={returnForm.location} onChange={(event) => setReturnForm((current) => ({ ...current, location: event.target.value }))} /></label><label className="full"><span>Estado al regresar</span><textarea value={returnForm.physicalConditionIn} onChange={(event) => setReturnForm((current) => ({ ...current, physicalConditionIn: event.target.value }))} /></label>{returnForm.damaged && <label className="full"><span>Daños detectados</span><textarea value={returnForm.damages} onChange={(event) => setReturnForm((current) => ({ ...current, damages: event.target.value }))} required /></label>}</div>}
          {action === "maintenance" && <div className="support-tool-form-grid"><label className="full"><span>Motivo</span><textarea value={maintenanceForm.reason} onChange={(event) => setMaintenanceForm((current) => ({ ...current, reason: event.target.value }))} required /></label><label><span>Proveedor</span><input value={maintenanceForm.provider} onChange={(event) => setMaintenanceForm((current) => ({ ...current, provider: event.target.value }))} /></label><label><span>Responsable interno</span><input value={maintenanceForm.responsibleName} onChange={(event) => setMaintenanceForm((current) => ({ ...current, responsibleName: event.target.value }))} /></label><label><span>Fecha de envío</span><input type="date" value={maintenanceForm.sentAt} onChange={(event) => setMaintenanceForm((current) => ({ ...current, sentAt: event.target.value }))} /></label>{isAdmin && <label><span>Costo estimado</span><input type="number" min="0" value={maintenanceForm.cost} onChange={(event) => setMaintenanceForm((current) => ({ ...current, cost: event.target.value }))} /></label>}</div>}
          {action === "complete-maintenance" && <div className="support-tool-form-grid"><label><span>Resultado</span><select value={completionForm.result} onChange={(event) => setCompletionForm((current) => ({ ...current, result: event.target.value }))}>{["Reparada", "Reparada parcialmente", "No reparable", "Requiere baja"].map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Fecha de regreso</span><input type="date" value={completionForm.returnedAt} onChange={(event) => setCompletionForm((current) => ({ ...current, returnedAt: event.target.value }))} /></label><label><span>Próximo mantenimiento</span><input type="date" value={completionForm.nextMaintenanceAt} onChange={(event) => setCompletionForm((current) => ({ ...current, nextMaintenanceAt: event.target.value }))} /></label><label className="full"><span>Reparación realizada</span><textarea value={completionForm.repairDescription} onChange={(event) => setCompletionForm((current) => ({ ...current, repairDescription: event.target.value }))} required /></label></div>}
          <footer><button type="button" className="visual-outline-button" onClick={() => setAction("")}>Cancelar</button><button type="submit" className="visual-primary-button" disabled={saving}>{saving ? "Guardando..." : "Guardar movimiento"}</button></footer>
        </form></div>
      )}

      {selectedLabelTool && (
        <div className="technical-modal-backdrop"><section className="technical-modal support-tool-label-modal">
          <header><div><p className="section-kicker">Etiqueta</p><h3>{selectedLabelTool.folio}</h3></div><button type="button" onClick={() => setSelectedLabelTool(null)}>×</button></header>
          <SupportToolLabel tool={selectedLabelTool} labelRef={labelRef} />
          <footer><button type="button" onClick={downloadLabelPdf}>Descargar PDF</button><button type="button" className="visual-primary-button" onClick={() => printLabels([selectedLabelTool.id])}>Imprimir</button></footer>
        </section></div>
      )}

      <div className="support-tool-print-area" aria-hidden="true">{printableTools.map((tool) => <SupportToolLabel tool={tool} key={tool.id} />)}</div>
    </section>
  );
}

function SupportToolLabel({ tool, labelRef = null }) {
  return (
    <article className="support-tool-label" ref={labelRef}>
      <header><img src="/active-logo.png" alt="Active English School" /><span>Propiedad de Active English School</span></header>
      <div className="support-tool-label-body"><div><strong>{tool.name}</strong><b>{tool.folio}</b><span>{tool.category}</span><small>{tool.campus || tool.specificLocation || "Soporte Técnico"}</small>{tool.serialNumber && <small>S/N: {tool.serialNumber}</small>}</div><QRCodeSVG value={getToolRoute(tool.id)} size={92} level="M" /></div>
    </article>
  );
}
