import EditorialElementInspector from "./EditorialElementInspector";
import EditorialLayersPanel from "./EditorialLayersPanel";
import EditorialDesignInspector from "../design/EditorialDesignInspector";

const TABS = ["Propiedades", "Capas", "Estilos"];

export default function EditorialInspectorPanel({ activeTab, onChangeTab, editor, displayEditor = editor, design, page, master, onDesignAction }) {
  return (
    <aside className="editorial-inspector-panel">
      <div className="editorial-inspector-tabs" role="tablist" aria-label="Inspector">
        {TABS.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} onClick={() => onChangeTab(tab)} key={tab}>{tab}</button>)}
      </div>
      {activeTab === "Propiedades" && <EditorialElementInspector element={displayEditor.selectedElement} actions={editor.actions} />}
      {activeTab === "Capas" && <EditorialLayersPanel elements={editor.elements} selectedId={editor.selectedId} actions={editor.actions} onSelect={editor.select} />}
      {activeTab === "Estilos" && <EditorialDesignInspector editor={editor} design={design} resolvedSelectedElement={displayEditor.selectedElement} page={page} master={master} onAction={onDesignAction} />}
    </aside>
  );
}
