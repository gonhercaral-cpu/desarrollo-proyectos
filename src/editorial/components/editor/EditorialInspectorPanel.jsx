import EditorialElementInspector from "./EditorialElementInspector";
import EditorialLayersPanel from "./EditorialLayersPanel";
import EditorialDesignInspector from "../design/EditorialDesignInspector";
import EditorialAnswersPanel from "../academic/EditorialAnswersPanel";

const TABS = ["Propiedades", "Capas", "Estilos", "Respuestas"];

export default function EditorialInspectorPanel({ activeTab, onChangeTab, editor, displayEditor = editor, design, page, master, variant, academicWarnings = [], onDesignAction, onRegenerate }) {
  return (
    <aside className="editorial-inspector-panel">
      <div className="editorial-inspector-tabs" role="tablist" aria-label="Inspector">
        {TABS.map((tab) => <button type="button" role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} onClick={() => onChangeTab(tab)} key={tab}>{tab}</button>)}
      </div>
      {activeTab === "Propiedades" && <EditorialElementInspector element={displayEditor.selectedElement} actions={editor.actions} onRegenerate={onRegenerate} />}
      {activeTab === "Capas" && <EditorialLayersPanel elements={editor.elements} selectedId={editor.selectedId} actions={editor.actions} onSelect={editor.select} variant={variant} />}
      {activeTab === "Estilos" && <EditorialDesignInspector editor={editor} design={design} resolvedSelectedElement={displayEditor.selectedElement} page={page} master={master} onAction={onDesignAction} />}
      {activeTab === "Respuestas" && <EditorialAnswersPanel elements={editor.elements} warnings={academicWarnings} onSelect={editor.select} />}
    </aside>
  );
}
