import EditorialIcon from "../EditorialIcon";
import EditorialElementInspector from "./EditorialElementInspector";
import EditorialLayersPanel from "./EditorialLayersPanel";

const TABS = ["Propiedades", "Capas", "Estilos"];

export default function EditorialInspectorPanel({ activeTab, onChangeTab, editor }) {
  return (
    <aside className="editorial-inspector-panel">
      <div className="editorial-inspector-tabs" role="tablist" aria-label="Inspector">
        {TABS.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} onClick={() => onChangeTab(tab)} key={tab}>{tab}</button>)}
      </div>
      {activeTab === "Propiedades" && <EditorialElementInspector element={editor.selectedElement} actions={editor.actions} />}
      {activeTab === "Capas" && <EditorialLayersPanel elements={editor.elements} selectedId={editor.selectedId} actions={editor.actions} onSelect={editor.select} />}
      {activeTab === "Estilos" && <div className="editorial-inspector-empty"><span className="editorial-panel-empty-icon"><EditorialIcon name="styles" size={27} /></span><strong>Estilos</strong><p>Estilos globales pertenecen a Fase 4.</p></div>}
    </aside>
  );
}
