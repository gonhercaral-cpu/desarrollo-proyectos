import { useState } from "react";
import { getJobTypeMeta } from "./labels.js";
import { errorText } from "./model.js";
import { saveSettings } from "./service.js";

const TYPES = ["document", "book", "certificate", "credential", "personalized", "flyer", "brochure", "trifold", "worksheet", "teaching", "advertising", "form", "other"];
const PERSONALIZED = ["certificate", "credential", "personalized"];
const CLASSES = {
  direct: "Entrega directa",
  inventory: "Inventario terminado",
  noninventory: "No inventariable",
  administrative: "Administrativo",
  internal: "Uso interno",
};

const emptyRule = () => ({
  id: `regla-${crypto.randomUUID().slice(0, 8)}`,
  productId: "",
  type: "book",
  classification: "direct",
  automatic: false,
  warehouse: "",
  sku: "",
});

function problemWith(rules) {
  const scopes = new Set();
  for (const rule of rules) {
    if (PERSONALIZED.includes(rule.type) && rule.classification === "inventory" && !rule.productId) {
      return "Los certificados y credenciales solo se ingresan con una regla que indique el producto.";
    }
    const scope = `${rule.productId}|${rule.type}`;
    if (scopes.has(scope)) return "Hay dos reglas para el mismo producto y tipo.";
    scopes.add(scope);
  }
  return "";
}

export default function InventoryRules({ settings = {}, products = [], isAdmin }) {
  const saved = Array.isArray(settings.inventoryRules) ? settings.inventoryRules : [];
  const [editedRules, setEditedRules] = useState(null);
  const rules = editedRules ?? saved;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const change = (id, patch) => {
    setNotice("");
    setEditedRules((list) => (list ?? saved).map((rule) => {
      if (rule.id !== id) return rule;
      const next = { ...rule, ...patch };
      // Solo la clasificación «Inventario terminado» admite ingreso automático.
      if (next.classification !== "inventory") next.automatic = false;
      return next;
    }));
  };

  async function submit(event) {
    event.preventDefault();
    const problem = problemWith(rules);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      await saveSettings({ requestId: crypto.randomUUID(), inventoryRules: rules });
      setEditedRules(null);
      setNotice("Reglas de inventario guardadas.");
    } catch (ex) {
      setError(errorText(ex));
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !isAdmin;
  return (
    <section className="pp-card">
      <div className="pp-divider">
        <h3>Reglas de inventario</h3>
        {isAdmin && <button type="button" className="pp-btn" onClick={() => setEditedRules([...rules, emptyRule()])}>Agregar regla</button>}
      </div>
      <p>
        Por omisión todo se entrega de forma directa. Un trabajo solo ingresa al inventario al aprobar calidad
        si una regla activa lo indica. El destino es una etiqueta operativa: el stock sigue siendo global por producto.
      </p>
      {!rules.length && <p>No hay reglas: ningún trabajo ingresa automáticamente al inventario.</p>}
      <form onSubmit={submit}>
        {rules.map((rule) => {
          const personalized = PERSONALIZED.includes(rule.type);
          return (
            <fieldset key={rule.id} className="pp-printer" disabled={readOnly || busy}>
              <legend>{rule.productId ? "Regla por producto" : "Regla por tipo de material"}</legend>
              <label>Producto vinculado
                <select value={rule.productId} onChange={(e) => change(rule.id, { productId: e.target.value })}>
                  <option value="">Todos los productos de este tipo</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name || product.id}</option>)}
                </select>
              </label>
              <label>Tipo de material
                <select value={rule.type} onChange={(e) => change(rule.id, { type: e.target.value })}>
                  {TYPES.map((type) => <option key={type} value={type}>{getJobTypeMeta(type).label}</option>)}
                </select>
              </label>
              <label>Clasificación
                <select value={rule.classification} onChange={(e) => change(rule.id, { classification: e.target.value })}>
                  {Object.entries(CLASSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <input type="checkbox" checked={rule.automatic} disabled={rule.classification !== "inventory"}
                  onChange={(e) => change(rule.id, { automatic: e.target.checked })} />
                {" "}Ingresar automáticamente al aprobar calidad
              </label>
              <label>Destino operativo (etiqueta)
                <input value={rule.warehouse} maxLength={80} placeholder="Ej. Mostrador"
                  onChange={(e) => change(rule.id, { warehouse: e.target.value })} />
              </label>
              <label>SKU
                <input value={rule.sku} maxLength={60} onChange={(e) => change(rule.id, { sku: e.target.value })} />
              </label>
              {personalized && rule.classification === "inventory" && !rule.productId && (
                <small role="alert">Este tipo personalizado requiere elegir un producto.</small>
              )}
              {isAdmin && <button type="button" className="pp-btn" onClick={() => setEditedRules(rules.filter((item) => item.id !== rule.id))}>Quitar</button>}
            </fieldset>
          );
        })}
        {error && <p role="alert" className="pp-error">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {isAdmin && <button className="pp-btn pp-primary" disabled={busy}>{busy ? "Guardando…" : "Guardar reglas"}</button>}
      </form>
      {readOnly && <small>Solo un administrador puede cambiar estas reglas.</small>}
    </section>
  );
}
