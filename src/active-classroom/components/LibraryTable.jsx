import {
  formatFileSize,
  formatResourceDate,
  getResourceIcon,
  getResourceKindLabel,
} from "../utils/resourceTypes";
import ActiveClassroomIcon from "./ActiveClassroomIcon";

export default function LibraryTable({
  folders,
  resources,
  selectedResourceId,
  viewMode,
  onOpenFolder,
  onSelectResource,
  onRenameFolder,
  onDeleteFolder,
}) {
  const isEmpty = folders.length + resources.length === 0;

  if (isEmpty) {
    return (
      <div className="ac-empty-state">
        <span className="ac-empty-folder" aria-hidden="true">
          <ActiveClassroomIcon name="folder" size={54} />
        </span>
        <strong>Carpeta vacía</strong>
        <small>Aún no hay recursos en esta carpeta.</small>
        <small>Abre otra carpeta o agrega contenido desde administración.</small>
      </div>
    );
  }

  return (
    <div className={`ac-resource-table-wrap ${viewMode === "grid" ? "is-grid" : ""}`}>
      <table className="ac-resource-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Tipo</th>
            <th>Tamaño</th>
            <th>Modificado</th>
            <th>Estado</th>
            <th><span className="ac-sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <tr
              key={folder.id}
              className="ac-folder-row"
              tabIndex={0}
              onClick={() => onOpenFolder(folder.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onOpenFolder(folder.id);
              }}
            >
              <td>
                <span className="ac-resource-name">
                  <i className="ac-file-icon ac-folder-icon" aria-hidden="true">
                    <ActiveClassroomIcon name="folder" />
                  </i>
                  <strong>{folder.name}</strong>
                </span>
              </td>
              <td>{folder.kind === "level" ? "Nivel" : "Unit"}</td>
              <td>—</td>
              <td>{formatResourceDate(folder.updatedAt)}</td>
              <td><span className="ac-status-pill is-active">Activa</span></td>
              <td>
                {folder.kind === "unit" ? (
                  <span className="ac-row-actions">
                    <button
                      type="button"
                      aria-label={`Renombrar ${folder.name}`}
                      title="Renombrar Unit"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRenameFolder(folder);
                      }}
                    >
                      <ActiveClassroomIcon name="edit" size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Eliminar ${folder.name}`}
                      title="Eliminar Unit vacía"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteFolder(folder);
                      }}
                    >
                      <ActiveClassroomIcon name="trash" size={16} />
                    </button>
                  </span>
                ) : (
                  <span aria-hidden="true">›</span>
                )}
              </td>
            </tr>
          ))}

          {resources.map((resource) => (
            <tr
              key={resource.id}
              className={`ac-resource-row ${selectedResourceId === resource.id ? "is-selected" : ""}`}
              tabIndex={0}
              aria-selected={selectedResourceId === resource.id}
              onClick={() => onSelectResource(resource.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectResource(resource.id);
              }}
            >
              <td>
                <span className="ac-resource-name">
                  <i className={`ac-file-icon is-${resource.kind}`} aria-hidden="true">
                    {getResourceIcon(resource.kind, resource.name)}
                  </i>
                  <strong>{resource.name}</strong>
                </span>
              </td>
              <td>{getResourceKindLabel(resource.kind, resource.name)}</td>
              <td>{formatFileSize(resource.sizeBytes)}</td>
              <td>{formatResourceDate(resource.updatedAt)}</td>
              <td>
                <span className={`ac-status-pill ${resource.published ? "is-active" : "is-draft"}`}>
                  {resource.published ? "Publicado" : "Borrador"}
                </span>
              </td>
              <td><span aria-hidden="true">•••</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
