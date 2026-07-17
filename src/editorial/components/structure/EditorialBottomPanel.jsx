import { formatInches, getPageSizePreset } from "../../models/editorialModels";
import EditorialThumbnailList from "./EditorialThumbnailList";

export default function EditorialBottomPanel({ project, navigation, ordering, activeElements, onSelectPage }) {
  const size = getPageSizePreset(project.size);
  const activeNumber = navigation.numbering.get(navigation.selectedPageId)?.label || "Sin número";
  return (
    <footer className="editorial-bottom-panel">
      <section className="editorial-bottom-pages">
        <header>Páginas · activa {activeNumber}</header>
        <EditorialThumbnailList pages={navigation.pages} numbering={navigation.numbering} selectedPageId={navigation.selectedPageId} projectId={project.id} documentId={navigation.documentId} activeElements={activeElements} compact ordering={ordering} onSelect={onSelectPage} />
      </section>
      <section className="editorial-print-data"><header>Datos de impresión</header><dl><div><dt>Tamaño</dt><dd>{size.label}</dd></div><div><dt>Sangrado</dt><dd>{formatInches(project.bleedIn)}</dd></div><div><dt>Márgenes</dt><dd>{formatInches(project.margins?.top)}</dd></div><div><dt>Páginas</dt><dd>{navigation.pages.length}</dd></div></dl></section>
      <section className="editorial-print-guides"><header>Guías de impresión</header><p><span className="bleed" /> Sangrado</p><p><span className="margin" /> Área segura y márgenes</p></section>
      <section className="editorial-quick-view"><header>Vista rápida</header><span className="editorial-quick-paper"><i /></span></section>
    </footer>
  );
}
