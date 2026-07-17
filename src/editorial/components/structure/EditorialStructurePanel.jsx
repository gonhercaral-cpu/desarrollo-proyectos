import { useState } from "react";
import EditorialIcon from "../EditorialIcon";
import EditorialPageActionsMenu from "./EditorialPageActionsMenu";
import EditorialStructureTree from "./EditorialStructureTree";
import EditorialThumbnailList from "./EditorialThumbnailList";
import EditorialDesignLibraryPanel from "../design/EditorialDesignLibraryPanel";
import EditorialMasterList from "../design/EditorialMasterList";
import EditorialAcademicLibraryPanel from "../academic/EditorialAcademicLibraryPanel";
import EditorialProductionPanel from "../production/EditorialProductionPanel";

export default function EditorialStructurePanel({
  projectId,
  project,
  activeRail,
  railItems,
  navigation,
  ordering,
  activeElements,
  onSelectPage,
  onCreatePage,
  onCreateSection,
  onEditSection,
  onDeleteSection,
  onPageAction,
  design,
  editor,
  editorMode,
  onDesignAction,
  canManageInstitutional,
  academicMetadata,
  relatedProjects,
  onAcademicAction,
  production,
  indexState,
  onIndexAction,
  onNavigateIssue,
  onExport,
  onDownloadExport,
}) {
  const [menuPage, setMenuPage] = useState(null);
  if (["templates", "components", "styles"].includes(activeRail)) {
    return <EditorialDesignLibraryPanel activeRail={activeRail} design={design} editor={editor} canManageInstitutional={canManageInstitutional} onAction={onDesignAction} />;
  }
  if (activeRail === "material") {
    return <EditorialAcademicLibraryPanel project={project} metadata={academicMetadata} design={design} relatedProjects={relatedProjects} editorMode={editorMode} onAction={onAcademicAction} />;
  }
  if (["reviews", "approvals"].includes(activeRail)) {
    return <EditorialProductionPanel key={activeRail} activeRail={activeRail} navigation={navigation} editor={editor} production={production} indexState={indexState} onIndexAction={onIndexAction} onNavigateIssue={onNavigateIssue} onExport={onExport} onDownloadExport={onDownloadExport} />;
  }
  if (activeRail !== "books") {
    const label = railItems.find(([name]) => name === activeRail)?.[1] || "Panel";
    return <aside className="editorial-structure-panel"><header><strong>{label}</strong></header><div className="editorial-panel-empty"><EditorialIcon name={activeRail} size={28} /><p>Sin contenido en este proyecto.</p></div></aside>;
  }

  function request(action, page, value) {
    setMenuPage(null);
    onPageAction(action, page, value);
  }

  return (
    <aside className="editorial-structure-panel">
      <EditorialMasterList masters={design.masters} activeId={editorMode.kind === "master" ? editorMode.id : ""} onAction={onDesignAction} />
      <EditorialStructureTree
        document={navigation.document}
        pages={navigation.pages}
        sections={navigation.sections}
        selectedPageId={navigation.selectedPageId}
        numbering={navigation.numbering}
        ordering={ordering}
        onSelectPage={onSelectPage}
        onPageActions={setMenuPage}
        onCreateSection={onCreateSection}
        onCreatePage={onCreatePage}
        onEditSection={onEditSection}
        onDeleteSection={onDeleteSection}
        onToggleSection={(section) => navigation.updateSection(section.id, { collapsed: !section.collapsed }).catch(() => {})}
      />
      <section className="editorial-pages-side-section">
        <header><strong>Páginas</strong><span>{navigation.pages.length}</span></header>
        <EditorialThumbnailList pages={navigation.pages} numbering={navigation.numbering} selectedPageId={navigation.selectedPageId} projectId={projectId} documentId={navigation.documentId} activeElements={activeElements} ordering={ordering} onSelect={onSelectPage} onActions={setMenuPage} />
      </section>
      {menuPage && <EditorialPageActionsMenu page={menuPage} sections={navigation.sections} onClose={() => setMenuPage(null)} actions={{
        insert: (placement) => request("insert", menuPage, placement),
        duplicate: () => request("duplicate", menuPage),
        rename: () => request("rename", menuPage),
        toggleBlank: () => request("blank", menuPage),
        toggleNumbering: () => request("numbering", menuPage),
        move: (sectionId) => request("move", menuPage, sectionId),
        remove: () => request("delete", menuPage),
      }} />}
    </aside>
  );
}
