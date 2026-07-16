import { VISUAL_TEMPLATE_CATEGORIES } from "../../../utils/digitalSignage";

export default function VisualAdTemplatesPanel({
  visualTemplates,
  saving,
  onSaveTemplate,
  onApplyTemplate,
  onEditTemplate,
  onToggleTemplate,
  onDeleteTemplate,
  VisualAdPreview,
}) {
  const visualTemplatesList = Array.isArray(visualTemplates) ? visualTemplates : [];

  return (
    <section className="signage-visual-editor-section">
      <div className="signage-section-title-row">
        <h4>Plantillas guardadas</h4>
        <button type="button" className="visual-outline-button" onClick={onSaveTemplate} disabled={saving}>
          Guardar actual
        </button>
      </div>
      <p className="signage-helper-note">
        Usa una plantilla como punto de partida. Cambiar el anuncio no modifica la plantilla original.
      </p>
      <div className="signage-visual-template-list">
        {visualTemplatesList.length === 0 && <p className="digital-empty">Sin plantillas guardadas.</p>}
        {visualTemplatesList.map((template) => (
          <article className={`signage-visual-template-card ${template.active === false ? "inactive" : ""}`} key={template.id}>
            <VisualAdPreview visualAdData={template.visualAdData} mini />
            <div>
              <strong>{template.name || "Plantilla sin nombre"}</strong>
              <span>{getVisualTemplateCategoryLabel(template.category)} - {template.active === false ? "Inactiva" : "Activa"}</span>
              {template.description && <small>{template.description}</small>}
            </div>
            <div className="signage-visual-template-actions">
              <button type="button" className="visual-primary-button" onClick={() => onApplyTemplate(template)} disabled={saving || template.active === false}>
                Usar
              </button>
              <button type="button" className="visual-outline-button" onClick={() => onEditTemplate(template)} disabled={saving}>
                Editar
              </button>
              <button type="button" className="visual-outline-button" onClick={() => onToggleTemplate(template)} disabled={saving}>
                {template.active === false ? "Activar" : "Desactivar"}
              </button>
              <button type="button" className="danger-table-button" onClick={() => onDeleteTemplate(template)} disabled={saving}>
                Eliminar
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function getVisualTemplateCategoryLabel(value = "") {
  return VISUAL_TEMPLATE_CATEGORIES.find((category) => category.value === value)?.label || "Otro";
}
