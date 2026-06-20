import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  IDEA_AREAS,
  IDEA_IMPACTS,
  IDEA_PRIORITIES,
  IDEA_STATUSES,
  addIdeaAdminComment,
  createIdea,
  deleteIdea,
  getIdeaImpactConfig,
  getIdeaPriorityConfig,
  getIdeaStatusConfig,
  subscribeIdeaComments,
  subscribeIdeas,
  updateIdeaStatus,
  uploadIdeaEvidence,
} from "../services/ideasService";

const INITIAL_FORM = {
  title: "",
  area: "General",
  currentProblem: "",
  proposedIdea: "",
  implementationSuggestion: "",
  expectedBenefit: "",
  priority: "media",
  impact: "medio",
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getInitials(nameOrEmail) {
  const clean = String(nameOrEmail || "Usuario").trim();
  if (!clean) return "U";

  const parts = clean
    .replace(/@.*/, "")
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatFileSize(size = 0) {
  const numericSize = Number(size || 0);

  if (!Number.isFinite(numericSize) || numericSize <= 0) {
    return "Tamaño no disponible";
  }

  if (numericSize < 1024 * 1024) {
    return `${Math.round(numericSize / 1024)} KB`;
  }

  return `${(numericSize / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileTypeLabel(fileName = "") {
  const extension = String(fileName).split(".").pop()?.toUpperCase() || "FILE";
  return extension.slice(0, 4);
}

function getProfileArea(profile) {
  return profile?.area || profile?.departmentName || "General";
}

export default function IdeasIncubator() {
  const { firebaseUser, profile } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [ideas, setIdeas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => ({
    ...INITIAL_FORM,
    area: getProfileArea(profile),
  }));
  const [formFiles, setFormFiles] = useState([]);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [impactFilter, setImpactFilter] = useState("all");

  const [selectedIdeaId, setSelectedIdeaId] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [adminStatus, setAdminStatus] = useState("nueva");
  const [adminComment, setAdminComment] = useState("");
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [extraEvidenceFiles, setExtraEvidenceFiles] = useState([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [deletingIdeaId, setDeletingIdeaId] = useState(null);

  useEffect(() => {
    if (!firebaseUser?.uid || !profile) return undefined;

    setLoading(true);
    setError("");

    return subscribeIdeas({
      firebaseUser,
      profile,
      isAdmin,
      onChange: (rows) => {
        setIdeas(rows);
        setLoading(false);
      },
      onError: (snapshotError) => {
        console.error("No se pudieron cargar las ideas:", snapshotError);
        setError("No se pudieron cargar las ideas. Revisa permisos o conexión.");
        setLoading(false);
      },
    });
  }, [firebaseUser, isAdmin, profile]);

  const selectedIdea = useMemo(() => {
    return ideas.find((idea) => idea.id === selectedIdeaId) || ideas[0] || null;
  }, [ideas, selectedIdeaId]);

  useEffect(() => {
    if (!selectedIdea?.id) {
      setComments([]);
      setAdminStatus("nueva");
      setAdminComment("");
      return undefined;
    }

    setAdminStatus(selectedIdea.status || "nueva");
    setAdminComment("");
    setCommentsLoading(true);

    return subscribeIdeaComments(
      selectedIdea.id,
      (rows) => {
        setComments(rows);
        setCommentsLoading(false);
      },
      (commentsError) => {
        console.error("No se pudieron cargar los comentarios de la idea:", commentsError);
        setComments([]);
        setCommentsLoading(false);
      }
    );
  }, [selectedIdea?.id, selectedIdea?.status]);

  const visibleAreas = useMemo(() => {
    const existingAreas = ideas.map((idea) => idea.area).filter(Boolean);
    return Array.from(new Set([...IDEA_AREAS, ...existingAreas])).sort((a, b) =>
      a.localeCompare(b, "es")
    );
  }, [ideas]);

  const metrics = useMemo(() => {
    const total = ideas.length;
    const newIdeas = ideas.filter((idea) => idea.status === "nueva").length;
    const reviewing = ideas.filter((idea) =>
      ["en_revision", "necesita_mas_informacion"].includes(idea.status)
    ).length;
    const approved = ideas.filter((idea) => idea.status === "aprobada").length;
    const highImpact = ideas.filter((idea) => ["alto", "muy_alto"].includes(idea.impact)).length;

    return { total, newIdeas, reviewing, approved, highImpact };
  }, [ideas]);

  const filteredIdeas = useMemo(() => {
    const normalizedSearch = normalizeText(searchTerm);

    return ideas.filter((idea) => {
      const matchesStatus = statusFilter === "all" || idea.status === statusFilter;
      const matchesArea = areaFilter === "all" || idea.area === areaFilter;
      const matchesPriority = priorityFilter === "all" || idea.priority === priorityFilter;
      const matchesImpact = impactFilter === "all" || idea.impact === impactFilter;
      const searchableText = normalizeText(
        [
          idea.title,
          idea.area,
          idea.currentProblem,
          idea.proposedIdea,
          idea.expectedBenefit,
          idea.createdByName,
          idea.createdByEmail,
        ].join(" ")
      );
      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);

      return matchesStatus && matchesArea && matchesPriority && matchesImpact && matchesSearch;
    });
  }, [areaFilter, ideas, impactFilter, priorityFilter, searchTerm, statusFilter]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setForm({
      ...INITIAL_FORM,
      area: getProfileArea(profile),
    });
    setFormFiles([]);
  }

  function handleFormFilesChange(event) {
    setFormFiles(Array.from(event.target.files || []));
  }

  function removeFormFile(indexToRemove) {
    setFormFiles((current) => current.filter((_, index) => index !== indexToRemove));
  }

  async function handleCreateIdea(event) {
    event.preventDefault();
    setMessage("");
    setError("");

    setSaving(true);

    try {
      const ideaId = await createIdea({
        form,
        files: formFiles,
        firebaseUser,
        profile,
      });

      resetForm();
      setShowForm(false);
      setSelectedIdeaId(ideaId);
      setMessage("Idea registrada correctamente en la incubadora.");
    } catch (createError) {
      console.error("No se pudo registrar la idea:", createError);
      const detail = createError?.code ? ` (${createError.code})` : "";
      setError(createError?.message || `No se pudo registrar la idea${detail}.`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAdminUpdate() {
    if (!selectedIdea?.id || !isAdmin) return;

    setUpdatingStatus(true);
    setMessage("");
    setError("");

    try {
      const statusChanged = selectedIdea.status !== adminStatus;
      const hasComment = adminComment.trim().length > 0;

      if (statusChanged) {
        await updateIdeaStatus({
          ideaId: selectedIdea.id,
          status: adminStatus,
          firebaseUser,
          profile,
        });
      }

      if (hasComment) {
        await addIdeaAdminComment({
          ideaId: selectedIdea.id,
          comment: adminComment,
          firebaseUser,
          profile,
        });
      }

      if (!statusChanged && !hasComment) {
        setMessage("No había cambios por guardar.");
      } else {
        setMessage("Idea actualizada correctamente.");
      }

      setAdminComment("");
    } catch (updateError) {
      console.error("No se pudo actualizar la idea:", updateError);
      const detail = updateError?.code ? ` (${updateError.code})` : "";
      setError(`No se pudo actualizar la idea${detail}. Revisa permisos o conexión.`);
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleUploadExtraEvidence() {
    if (!selectedIdea?.id || extraEvidenceFiles.length === 0) return;

    setUploadingEvidence(true);
    setMessage("");
    setError("");

    try {
      await uploadIdeaEvidence({
        ideaId: selectedIdea.id,
        files: extraEvidenceFiles,
        firebaseUser,
        profile,
      });

      setExtraEvidenceFiles([]);
      setMessage("Evidencia agregada correctamente.");
    } catch (uploadError) {
      console.error("No se pudo subir la evidencia:", uploadError);
      const detail = uploadError?.code ? ` (${uploadError.code})` : "";
      setError(`No se pudo subir la evidencia${detail}. Revisa permisos o conexión.`);
    } finally {
      setUploadingEvidence(false);
    }
  }

  async function handleDeleteIdea(idea) {
    if (!idea?.id || !isAdmin) return;

    const confirmed = window.confirm(
      `¿Eliminar definitivamente la idea “${idea.title || "sin título"}”?`
    );

    if (!confirmed) return;

    setDeletingIdeaId(idea.id);
    setMessage("");
    setError("");

    try {
      await deleteIdea(idea.id);
      setSelectedIdeaId((currentId) => (currentId === idea.id ? null : currentId));
      setMessage("Idea eliminada correctamente.");
    } catch (deleteError) {
      console.error("No se pudo eliminar la idea:", deleteError);
      const detail = deleteError?.code ? ` (${deleteError.code})` : "";
      setError(`No se pudo eliminar la idea${detail}. Revisa permisos o conexión.`);
    } finally {
      setDeletingIdeaId(null);
    }
  }

  function clearFilters() {
    setSearchTerm("");
    setStatusFilter("all");
    setAreaFilter("all");
    setPriorityFilter("all");
    setImpactFilter("all");
  }

  const canAddEvidence =
    selectedIdea?.createdByUid === firebaseUser?.uid &&
    !["convertida_en_proyecto", "descartada"].includes(selectedIdea?.status);

  return (
    <section className="ideas-incubator-page visual-page">
      <div className="visual-page-header ideas-page-header">
        <div>
          <span className="breadcrumb-line">Desarrollo de Proyectos / Incubadora</span>
          <h2>Incubadora de ideas</h2>
          <p>
            Registra propuestas de mejora, documenta problemas actuales y da seguimiento
            antes de convertir una idea en proyecto formal.
          </p>
        </div>

        <div className="visual-page-actions">
          <button
            type="button"
            className="visual-primary-button"
            onClick={() => {
              setShowForm((current) => !current);
              setMessage("");
              setError("");
            }}
          >
            {showForm ? "Cerrar formulario" : "+ Nueva idea"}
          </button>
        </div>
      </div>

      {message && <div className="message-box">{message}</div>}
      {error && <div className="error-box">{error}</div>}

      <div className="ideas-metrics-grid">
        <div className="simple-metric simple-blue">
          <div className="simple-metric-icon">✦</div>
          <div>
            <strong>{metrics.total}</strong>
            <h4>{isAdmin ? "Todas las ideas" : "Mis ideas"}</h4>
            <p>Propuestas visibles para tu usuario.</p>
          </div>
        </div>

        <div className="simple-metric simple-gold">
          <div className="simple-metric-icon">!</div>
          <div>
            <strong>{metrics.newIdeas}</strong>
            <h4>Nuevas</h4>
            <p>Pendientes de primera revisión.</p>
          </div>
        </div>

        <div className="simple-metric simple-purple">
          <div className="simple-metric-icon">↻</div>
          <div>
            <strong>{metrics.reviewing}</strong>
            <h4>En revisión</h4>
            <p>En análisis o esperando más información.</p>
          </div>
        </div>

        <div className="simple-metric simple-green">
          <div className="simple-metric-icon">✓</div>
          <div>
            <strong>{metrics.approved}</strong>
            <h4>Aprobadas</h4>
            <p>Listas para trabajarse más adelante.</p>
          </div>
        </div>

        <div className="simple-metric simple-red">
          <div className="simple-metric-icon">↑</div>
          <div>
            <strong>{metrics.highImpact}</strong>
            <h4>Alto impacto</h4>
            <p>Ideas con mayor potencial de mejora.</p>
          </div>
        </div>
      </div>

      {showForm && (
        <div className="card ideas-form-card">
          <div className="section-title-row">
            <span className="section-title-icon section-title-blue">+</span>
            <div>
              <h3>Nueva idea</h3>
              <p>
                No tiene que estar perfecta. Explica qué problema viste, qué propones
                y cómo crees que mejoraría el proceso.
              </p>
            </div>
          </div>

          <form className="ideas-form" onSubmit={handleCreateIdea}>
            <label className="visual-field full">
              <span>Título de la idea <b>*</b></span>
              <input
                type="text"
                value={form.title}
                onChange={(event) => updateForm("title", event.target.value)}
                placeholder="Ej. Recordatorios automáticos para mantenimientos"
                maxLength={140}
              />
            </label>

            <label className="visual-field">
              <span>Área relacionada</span>
              <select
                value={form.area}
                onChange={(event) => updateForm("area", event.target.value)}
              >
                {visibleAreas.map((area) => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </label>

            <label className="visual-field">
              <span>Prioridad sugerida</span>
              <select
                value={form.priority}
                onChange={(event) => updateForm("priority", event.target.value)}
              >
                {IDEA_PRIORITIES.map((priority) => (
                  <option key={priority.value} value={priority.value}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="visual-field">
              <span>Impacto estimado</span>
              <select
                value={form.impact}
                onChange={(event) => updateForm("impact", event.target.value)}
              >
                {IDEA_IMPACTS.map((impact) => (
                  <option key={impact.value} value={impact.value}>
                    {impact.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="visual-field full">
              <span>Problema actual <b>*</b></span>
              <textarea
                value={form.currentProblem}
                onChange={(event) => updateForm("currentProblem", event.target.value)}
                placeholder="Describe qué no está funcionando bien, qué se pierde, qué se repite o qué genera errores."
                maxLength={900}
              />
            </label>

            <label className="visual-field full">
              <span>Idea o propuesta <b>*</b></span>
              <textarea
                value={form.proposedIdea}
                onChange={(event) => updateForm("proposedIdea", event.target.value)}
                placeholder="Explica qué propones hacer para resolver o mejorar la situación."
                maxLength={900}
              />
            </label>

            <label className="visual-field full">
              <span>Cómo crees que podría implementarse</span>
              <textarea
                value={form.implementationSuggestion}
                onChange={(event) =>
                  updateForm("implementationSuggestion", event.target.value)
                }
                placeholder="No tiene que ser técnico. Puede ser un paso, una pantalla, un botón, una regla o una forma de trabajo."
                maxLength={900}
              />
            </label>

            <label className="visual-field full">
              <span>Beneficio esperado <b>*</b></span>
              <textarea
                value={form.expectedBenefit}
                onChange={(event) => updateForm("expectedBenefit", event.target.value)}
                placeholder="Explica qué mejoraría: menos errores, ahorro de tiempo, mejor control, menos papel, mejor atención, etc."
                maxLength={700}
              />
            </label>

            <label className="ideas-dropzone full">
              <input type="file" multiple onChange={handleFormFilesChange} />
              <span>↥</span>
              <strong>Agregar evidencia o ejemplo</strong>
              <p>Capturas, fotos, documentos o archivos que ayuden a entender la idea.</p>
              <small>Máximo recomendado: 25 MB por archivo.</small>
            </label>

            {formFiles.length > 0 && (
              <div className="ideas-selected-files full">
                {formFiles.map((file, index) => (
                  <button
                    type="button"
                    key={`${file.name}-${index}`}
                    onClick={() => removeFormFile(index)}
                  >
                    <span>{getFileTypeLabel(file.name)}</span>
                    {file.name}
                    <b>×</b>
                  </button>
                ))}
              </div>
            )}

            <div className="ideas-form-actions full">
              <button
                type="button"
                className="visual-outline-button"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                disabled={saving}
              >
                Cancelar
              </button>

              <button type="submit" className="visual-primary-button" disabled={saving}>
                {saving ? "Guardando..." : "Registrar idea"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="ideas-layout">
        <section className="card ideas-list-card">
          <div className="ideas-toolbar">
            <div>
              <h3>{isAdmin ? "Todas las ideas" : "Mis ideas"}</h3>
              <p>
                {isAdmin
                  ? "Revisa, filtra y da seguimiento a las propuestas del equipo."
                  : "Consulta el estado de tus propuestas y los comentarios administrativos."}
              </p>
            </div>

            <button type="button" className="clear-filter-button" onClick={clearFilters}>
              Limpiar filtros
            </button>
          </div>

          <div className="ideas-filters-grid">
            <div className="visual-search ideas-search">
              <span>⌕</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar por título, problema, propuesta o persona..."
              />
            </div>

            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Todos los estados</option>
              {IDEA_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>

            <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
              <option value="all">Todas las áreas</option>
              {visibleAreas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>

            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
            >
              <option value="all">Todas las prioridades</option>
              {IDEA_PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.label}
                </option>
              ))}
            </select>

            <select value={impactFilter} onChange={(event) => setImpactFilter(event.target.value)}>
              <option value="all">Todos los impactos</option>
              {IDEA_IMPACTS.map((impact) => (
                <option key={impact.value} value={impact.value}>
                  {impact.label}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="empty-state">
              <p>Cargando ideas...</p>
            </div>
          ) : filteredIdeas.length === 0 ? (
            <div className="empty-state">
              <div>✦</div>
              <h3>No hay ideas para mostrar</h3>
              <p>Registra una nueva idea o ajusta los filtros.</p>
            </div>
          ) : (
            <div className="ideas-card-list">
              {filteredIdeas.map((idea) => (
                <IdeaCard
                  key={idea.id}
                  idea={idea}
                  selected={selectedIdea?.id === idea.id}
                  isAdmin={isAdmin}
                  deleting={deletingIdeaId === idea.id}
                  onSelect={() => setSelectedIdeaId(idea.id)}
                  onDelete={() => handleDeleteIdea(idea)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="ideas-detail-side">
          {!selectedIdea ? (
            <div className="card ideas-detail-card">
              <div className="empty-state small">
                <p>Selecciona una idea para ver el detalle.</p>
              </div>
            </div>
          ) : (
            <div className="card ideas-detail-card">
              <div className="ideas-detail-header">
                <div>
                  <span className={`visual-badge badge-${getIdeaStatusConfig(selectedIdea.status).tone}`}>
                    {getIdeaStatusConfig(selectedIdea.status).label}
                  </span>
                  <h3>{selectedIdea.title}</h3>
                  <p>
                    Propuesta por <strong>{selectedIdea.createdByName || "Usuario"}</strong> · {formatDate(selectedIdea.createdAt)}
                  </p>
                </div>
              </div>

              <div className="ideas-detail-meta-grid">
                <div>
                  <span>Área</span>
                  <strong>{selectedIdea.area || "General"}</strong>
                </div>
                <div>
                  <span>Prioridad</span>
                  <strong>{getIdeaPriorityConfig(selectedIdea.priority).label}</strong>
                </div>
                <div>
                  <span>Impacto</span>
                  <strong>{getIdeaImpactConfig(selectedIdea.impact).label}</strong>
                </div>
                <div>
                  <span>Evidencias</span>
                  <strong>{selectedIdea.evidenceCount || selectedIdea.evidenceFiles?.length || 0}</strong>
                </div>
              </div>

              <IdeaDetailSection title="Problema actual" text={selectedIdea.currentProblem} />
              <IdeaDetailSection title="Propuesta" text={selectedIdea.proposedIdea} />
              <IdeaDetailSection
                title="Implementación sugerida"
                text={selectedIdea.implementationSuggestion}
              />
              <IdeaDetailSection title="Beneficio esperado" text={selectedIdea.expectedBenefit} />

              <div className="ideas-evidence-section">
                <h4>Evidencia</h4>
                {selectedIdea.evidenceFiles?.length > 0 ? (
                  <div className="ideas-evidence-list">
                    {selectedIdea.evidenceFiles.map((file, index) => (
                      <a
                        key={`${file.path || file.url}-${index}`}
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ideas-evidence-item"
                      >
                        <span>{getFileTypeLabel(file.name)}</span>
                        <div>
                          <strong>{file.name || "Archivo"}</strong>
                          <small>
                            {formatFileSize(file.size)} · {formatDate(file.uploadedAt)}
                          </small>
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="ideas-muted-text">Esta idea aún no tiene evidencia adjunta.</p>
                )}

                {canAddEvidence && (
                  <div className="ideas-extra-evidence-box">
                    <label className="attach-evidence-chip">
                      <input
                        type="file"
                        multiple
                        onChange={(event) =>
                          setExtraEvidenceFiles(Array.from(event.target.files || []))
                        }
                      />
                      + Agregar evidencia
                    </label>

                    {extraEvidenceFiles.length > 0 && (
                      <div className="ideas-extra-evidence-actions">
                        <small>{extraEvidenceFiles.length} archivo(s) seleccionados</small>
                        <button
                          type="button"
                          className="visual-primary-button"
                          onClick={handleUploadExtraEvidence}
                          disabled={uploadingEvidence}
                        >
                          {uploadingEvidence ? "Subiendo..." : "Subir"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {isAdmin && (
                <div className="ideas-admin-box">
                  <h4>Evaluación administrativa</h4>

                  <label className="visual-field">
                    <span>Estado</span>
                    <select
                      value={adminStatus}
                      onChange={(event) => setAdminStatus(event.target.value)}
                    >
                      {IDEA_STATUSES.map((status) => (
                        <option key={status.value} value={status.value}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="visual-field">
                    <span>Comentario para el colaborador</span>
                    <textarea
                      value={adminComment}
                      onChange={(event) => setAdminComment(event.target.value)}
                      placeholder="Ej. Buena propuesta. Necesitamos más información sobre la frecuencia del problema."
                      maxLength={700}
                    />
                  </label>

                  <button
                    type="button"
                    className="visual-primary-button"
                    onClick={handleAdminUpdate}
                    disabled={updatingStatus}
                  >
                    {updatingStatus ? "Guardando..." : "Guardar evaluación"}
                  </button>
                </div>
              )}

              <div className="ideas-comments-section">
                <h4>Comentarios administrativos</h4>
                {commentsLoading ? (
                  <p className="ideas-muted-text">Cargando comentarios...</p>
                ) : comments.length === 0 ? (
                  <p className="ideas-muted-text">Aún no hay comentarios administrativos.</p>
                ) : (
                  <div className="ideas-comments-list">
                    {comments.map((comment) => (
                      <div key={comment.id} className="ideas-comment-item">
                        <div className="avatar-mini">{getInitials(comment.createdByName)}</div>
                        <div>
                          <strong>{comment.createdByName || "Administrador"}</strong>
                          <p>{comment.comment}</p>
                          <small>{formatDate(comment.createdAt)}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function IdeaCard({ idea, selected, isAdmin, deleting, onSelect, onDelete }) {
  const status = getIdeaStatusConfig(idea.status);
  const priority = getIdeaPriorityConfig(idea.priority);
  const impact = getIdeaImpactConfig(idea.impact);

  return (
    <article className={`idea-card ${selected ? "selected" : ""}`}>
      <button type="button" className="idea-card-main" onClick={onSelect}>
        <div className="idea-card-icon">✦</div>

        <div className="idea-card-content">
          <div className="idea-title-row">
            <h4>{idea.title}</h4>
            <span className={`visual-badge badge-${status.tone}`}>{status.label}</span>
          </div>

          <p>{idea.currentProblem || "Sin problema descrito."}</p>

          <div className="idea-card-meta">
            <span>{idea.area || "General"}</span>
            <span>Prioridad: {priority.label}</span>
            <span>Impacto: {impact.label}</span>
            <span>{idea.evidenceCount || idea.evidenceFiles?.length || 0} evidencia(s)</span>
          </div>

          <div className="idea-card-footer">
            <small>
              {isAdmin ? `Propuesta por ${idea.createdByName || "Usuario"}` : "Registrada"} · {formatDate(idea.createdAt)}
            </small>
          </div>
        </div>
      </button>

      {isAdmin && (
        <button
          type="button"
          className="idea-delete-button"
          onClick={onDelete}
          disabled={deleting}
          title="Eliminar idea"
        >
          {deleting ? "..." : "×"}
        </button>
      )}
    </article>
  );
}

function IdeaDetailSection({ title, text }) {
  if (!text) return null;

  return (
    <div className="ideas-detail-section">
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}
