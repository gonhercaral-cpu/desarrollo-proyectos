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

const STATUS_STEPS = [
  "nueva",
  "en_revision",
  "aprobada",
  "convertida_en_proyecto",
];

const STATUS_ICONS = {
  nueva: "💡",
  en_revision: "↻",
  necesita_mas_informacion: "?",
  aprobada: "✓",
  en_pausa: "Ⅱ",
  descartada: "×",
  convertida_en_proyecto: "↗",
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

function getDateFromValue(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatDate(value) {
  const date = getDateFromValue(value);

  if (!date) {
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

function formatShortDate(value) {
  const date = getDateFromValue(value);

  if (!date) return "Sin fecha";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatRelativeDate(value) {
  const date = getDateFromValue(value);
  if (!date) return "Sin fecha";

  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "Ahora";
  if (diff < hour) return `Hace ${Math.max(1, Math.round(diff / minute))} min`;
  if (diff < day) return `Hace ${Math.round(diff / hour)} h`;
  if (diff < day * 8) return `Hace ${Math.round(diff / day)} día(s)`;

  return formatShortDate(date);
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

function getIdeaStep(status) {
  if (status === "necesita_mas_informacion") return 1;
  if (status === "en_pausa") return 1;
  if (status === "descartada") return 0;
  const index = STATUS_STEPS.indexOf(status);
  return index >= 0 ? index : 0;
}

function getNextAction(idea) {
  const status = idea?.status || "nueva";

  const labels = {
    nueva: "Revisar prioridad, impacto y datos básicos de la propuesta.",
    en_revision: "Definir si la idea requiere más información o puede avanzar.",
    necesita_mas_informacion: "Solicitar datos adicionales antes de tomar una decisión.",
    aprobada: "Preparar alcance inicial y decidir si se convierte en proyecto.",
    en_pausa: "Retomar cuando existan condiciones o información suficiente.",
    descartada: "Sin acción pendiente. La idea quedó descartada.",
    convertida_en_proyecto: "Dar seguimiento desde el proyecto correspondiente.",
  };

  return labels[status] || labels.nueva;
}

function getIdeaIcon(idea) {
  return STATUS_ICONS[idea?.status] || "💡";
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
  const [showDetailsTracker, setShowDetailsTracker] = useState(false);

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

  const visibleAreas = useMemo(() => {
    const existingAreas = ideas.map((idea) => idea.area).filter(Boolean);
    return Array.from(new Set([...IDEA_AREAS, ...existingAreas])).sort((a, b) =>
      a.localeCompare(b, "es")
    );
  }, [ideas]);

  const metrics = useMemo(() => {
    const activeIdeas = ideas.filter(
      (idea) => !["descartada", "convertida_en_proyecto"].includes(idea.status)
    ).length;
    const reviewing = ideas.filter((idea) =>
      ["en_revision", "necesita_mas_informacion"].includes(idea.status)
    ).length;
    const approved = ideas.filter((idea) => idea.status === "aprobada").length;
    const highImpact = ideas.filter((idea) => ["alto", "muy_alto"].includes(idea.impact)).length;

    return { activeIdeas, reviewing, approved, highImpact };
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

  const selectedIdea = useMemo(() => {
    return ideas.find((idea) => idea.id === selectedIdeaId) || filteredIdeas[0] || ideas[0] || null;
  }, [filteredIdeas, ideas, selectedIdeaId]);

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
    <section className="ideas-incubator-page ideas-incubator-modern visual-page">
      <div className="ideas-modern-hero">
        <div className="ideas-modern-hero-main">
          <div className="ideas-modern-hero-icon">💡</div>
          <div>
            <span className="ideas-modern-eyebrow">Innovación y mejora</span>
            <h2>Incubadora de ideas</h2>
            <p>
              Captura, evalúa y da seguimiento a las ideas del equipo para impulsar
              mejoras y nuevos proyectos.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="ideas-modern-primary"
          onClick={() => {
            setShowForm(true);
            setMessage("");
            setError("");
          }}
        >
          + Nueva idea
        </button>
      </div>

      {message && <div className="message-box ideas-modern-message">{message}</div>}
      {error && <div className="error-box ideas-modern-message">{error}</div>}

      <div className="ideas-modern-metrics-grid">
        <IdeaMetricCard
          icon="💡"
          tone="blue"
          value={metrics.activeIdeas}
          title="Ideas activas"
          detail="Propuestas en curso"
        />
        <IdeaMetricCard
          icon="↻"
          tone="purple"
          value={metrics.reviewing}
          title="En revisión"
          detail="En análisis"
        />
        <IdeaMetricCard
          icon="✓"
          tone="green"
          value={metrics.approved}
          title="Aprobadas"
          detail="Listas para ejecutar"
        />
        <IdeaMetricCard
          icon="↑"
          tone="red"
          value={metrics.highImpact}
          title="Alto impacto"
          detail="Mayor potencial"
        />
      </div>

      <div className="ideas-modern-layout">
        <section className="ideas-modern-list-card">
          <div className="ideas-modern-card-header">
            <div>
              <h3>{isAdmin ? "Ideas del equipo" : "Mis ideas"}</h3>
              <p>
                {isAdmin
                  ? "Revisa, filtra y da seguimiento a las propuestas del equipo."
                  : "Consulta el estado de tus propuestas y los comentarios administrativos."}
              </p>
            </div>
          </div>

          <div className="ideas-modern-filters">
            <label className="ideas-modern-search">
              <span>⌕</span>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar ideas por título, problema o persona..."
              />
            </label>

            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Estado</option>
              {IDEA_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>

            <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
              <option value="all">Área</option>
              {visibleAreas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>

            <select value={impactFilter} onChange={(event) => setImpactFilter(event.target.value)}>
              <option value="all">Impacto</option>
              {IDEA_IMPACTS.map((impact) => (
                <option key={impact.value} value={impact.value}>
                  {impact.label}
                </option>
              ))}
            </select>

            <select
              value={priorityFilter}
              onChange={(event) => setPriorityFilter(event.target.value)}
            >
              <option value="all">Prioridad</option>
              {IDEA_PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.label}
                </option>
              ))}
            </select>

            <button type="button" className="ideas-modern-clear" onClick={clearFilters}>
              ↻ Limpiar
            </button>
          </div>

          {loading ? (
            <div className="ideas-modern-empty">
              <span>💡</span>
              <strong>Cargando ideas...</strong>
              <p>Estamos consultando las propuestas registradas.</p>
            </div>
          ) : filteredIdeas.length === 0 ? (
            <div className="ideas-modern-empty">
              <span>✦</span>
              <strong>No hay ideas para mostrar</strong>
              <p>Registra una nueva idea o ajusta los filtros.</p>
            </div>
          ) : (
            <div className="ideas-modern-list">
              {filteredIdeas.map((idea) => (
                <IdeaListCard
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

          {filteredIdeas.length > 0 && (
            <div className="ideas-modern-list-footer">
              <button type="button">Ver todas las ideas ⌄</button>
            </div>
          )}
        </section>

        <aside className="ideas-modern-detail-side">
          {!selectedIdea ? (
            <section className="ideas-modern-detail-card empty">
              <div className="ideas-modern-empty compact">
                <span>💡</span>
                <strong>Selecciona una idea</strong>
                <p>El detalle aparecerá en este espacio.</p>
              </div>
            </section>
          ) : (
            <IdeaDetailPanel
              idea={selectedIdea}
              comments={comments}
              commentsLoading={commentsLoading}
              adminStatus={adminStatus}
              adminComment={adminComment}
              extraEvidenceFiles={extraEvidenceFiles}
              canAddEvidence={canAddEvidence}
              isAdmin={isAdmin}
              updatingStatus={updatingStatus}
              uploadingEvidence={uploadingEvidence}
              deleting={deletingIdeaId === selectedIdea.id}
              showTracker={showDetailsTracker}
              onToggleTracker={() => setShowDetailsTracker((current) => !current)}
              onAdminStatusChange={setAdminStatus}
              onAdminCommentChange={setAdminComment}
              onAdminUpdate={handleAdminUpdate}
              onExtraEvidenceChange={setExtraEvidenceFiles}
              onUploadExtraEvidence={handleUploadExtraEvidence}
              onDelete={() => handleDeleteIdea(selectedIdea)}
            />
          )}
        </aside>
      </div>

      {showForm && (
        <FocusedIdeaForm
          form={form}
          files={formFiles}
          visibleAreas={visibleAreas}
          saving={saving}
          onChange={updateForm}
          onFileChange={handleFormFilesChange}
          onRemoveFile={removeFormFile}
          onSubmit={handleCreateIdea}
          onClose={() => {
            resetForm();
            setShowForm(false);
          }}
        />
      )}
    </section>
  );
}

function IdeaMetricCard({ icon, tone, value, title, detail }) {
  return (
    <article className={`ideas-modern-metric ${tone}`}>
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <h4>{title}</h4>
        <p>{detail}</p>
      </div>
      <b>›</b>
    </article>
  );
}

function IdeaListCard({ idea, selected, isAdmin, deleting, onSelect, onDelete }) {
  const status = getIdeaStatusConfig(idea.status);
  const priority = getIdeaPriorityConfig(idea.priority);
  const impact = getIdeaImpactConfig(idea.impact);
  const step = getIdeaStep(idea.status);

  return (
    <article className={`ideas-modern-item ${selected ? "selected" : ""}`}>
      <button type="button" className="ideas-modern-item-main" onClick={onSelect}>
        <span className={`ideas-modern-item-icon ${status.tone}`}>{getIdeaIcon(idea)}</span>

        <div className="ideas-modern-item-copy">
          <div className="ideas-modern-item-title">
            <h4>{idea.title || "Idea sin título"}</h4>
            <span className={`ideas-modern-pill ${status.tone}`}>{status.label}</span>
          </div>

          <p>
            <b>Problemática:</b> {idea.currentProblem || "Sin problema descrito."}
          </p>

          <div className="ideas-modern-author-row">
            <span className="ideas-mini-avatar">{getInitials(idea.createdByName || idea.createdByEmail)}</span>
            <small>{idea.createdByName || "Usuario"}</small>
            <i />
            <small>{idea.area || "General"}</small>
          </div>
        </div>

        <div className="ideas-modern-item-side">
          <div className="ideas-modern-item-badges">
            <span className={`ideas-modern-pill ${impact.tone}`}>↑ {impact.label}</span>
            <span className={`ideas-modern-pill ${priority.tone}`}>{priority.label}</span>
          </div>
          <small>Actualizada {formatRelativeDate(idea.updatedAt || idea.createdAt).toLowerCase()}</small>
          <div className={`ideas-status-dots step-${step}`} aria-label="Avance de seguimiento">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </button>

      {isAdmin && (
        <button
          type="button"
          className="ideas-modern-delete"
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

function IdeaDetailPanel({
  idea,
  comments,
  commentsLoading,
  adminStatus,
  adminComment,
  extraEvidenceFiles,
  canAddEvidence,
  isAdmin,
  updatingStatus,
  uploadingEvidence,
  deleting,
  showTracker,
  onToggleTracker,
  onAdminStatusChange,
  onAdminCommentChange,
  onAdminUpdate,
  onExtraEvidenceChange,
  onUploadExtraEvidence,
  onDelete,
}) {
  const status = getIdeaStatusConfig(idea.status);
  const impact = getIdeaImpactConfig(idea.impact);
  const priority = getIdeaPriorityConfig(idea.priority);
  const evidenceCount = idea.evidenceCount || idea.evidenceFiles?.length || 0;

  return (
    <section className="ideas-modern-detail-card">
      <div className="ideas-modern-detail-top">
        <div>
          <h3>{idea.title || "Idea sin título"}</h3>
          <div className="ideas-modern-detail-badges">
            <span className={`ideas-modern-pill ${status.tone}`}>{status.label}</span>
            <span className={`ideas-modern-pill ${impact.tone}`}>↑ {impact.label}</span>
            <span className={`ideas-modern-pill ${priority.tone}`}>{priority.label}</span>
          </div>
        </div>

        {isAdmin && (
          <button
            type="button"
            className="ideas-modern-dots-button"
            onClick={onDelete}
            disabled={deleting}
            title="Eliminar idea"
          >
            {deleting ? "..." : "⋮"}
          </button>
        )}
      </div>

      <div className="ideas-modern-detail-author">
        <span className="ideas-mini-avatar gold">
          {getInitials(idea.createdByName || idea.createdByEmail)}
        </span>
        <strong>{idea.createdByName || "Usuario"}</strong>
        <small>{idea.area || "General"}</small>
      </div>

      <IdeaDetailBlock title="Problema" text={idea.currentProblem} />
      <IdeaDetailBlock title="Solución propuesta" text={idea.proposedIdea} />
      <IdeaDetailBlock title="Implementación sugerida" text={idea.implementationSuggestion} />
      <IdeaDetailBlock title="Beneficio esperado" text={idea.expectedBenefit} />

      <div className="ideas-modern-timeline-block">
        <h4>Línea de tiempo</h4>
        <div className="ideas-modern-timeline">
          <TimelineRow
            active
            title="Idea registrada"
            detail={`${idea.createdByName || "Usuario"} · ${formatDate(idea.createdAt)}`}
          />
          {idea.reviewedAt && (
            <TimelineRow
              active
              title={status.label}
              detail={`${idea.reviewedByName || "Administración"} · ${formatDate(idea.reviewedAt)}`}
            />
          )}
          <TimelineRow
            title="Próxima evaluación"
            detail={getNextAction(idea)}
          />
        </div>
      </div>

      {showTracker && (
        <div className="ideas-modern-tracker-panel">
          <h4>Seguimiento completo</h4>
          <div className="ideas-modern-meta-grid compact">
            <div>
              <span>Área</span>
              <strong>{idea.area || "General"}</strong>
            </div>
            <div>
              <span>Evidencias</span>
              <strong>{evidenceCount}</strong>
            </div>
            <div>
              <span>Prioridad</span>
              <strong>{priority.label}</strong>
            </div>
            <div>
              <span>Impacto</span>
              <strong>{impact.label}</strong>
            </div>
          </div>

          <IdeaEvidenceSection
            idea={idea}
            canAddEvidence={canAddEvidence}
            extraEvidenceFiles={extraEvidenceFiles}
            uploadingEvidence={uploadingEvidence}
            onExtraEvidenceChange={onExtraEvidenceChange}
            onUploadExtraEvidence={onUploadExtraEvidence}
          />

          <IdeaCommentsSection comments={comments} commentsLoading={commentsLoading} />
        </div>
      )}

      {isAdmin && (
        <div className="ideas-modern-admin-panel">
          <h4>Cambiar estado</h4>
          <label>
            Estado
            <select value={adminStatus} onChange={(event) => onAdminStatusChange(event.target.value)}>
              {IDEA_STATUSES.map((statusOption) => (
                <option key={statusOption.value} value={statusOption.value}>
                  {statusOption.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Comentario para el colaborador
            <textarea
              value={adminComment}
              onChange={(event) => onAdminCommentChange(event.target.value)}
              placeholder="Agrega un comentario breve sobre la revisión."
              maxLength={700}
            />
          </label>
          <button type="button" onClick={onAdminUpdate} disabled={updatingStatus}>
            {updatingStatus ? "Guardando..." : "Guardar evaluación"}
          </button>
        </div>
      )}

      <div className="ideas-modern-next-action">
        <span>Siguiente acción</span>
        <p>{getNextAction(idea)}</p>
        <small>{formatShortDate(idea.updatedAt || idea.createdAt)}</small>
      </div>

      <div className="ideas-modern-detail-actions">
        <button type="button" className="ideas-modern-secondary" onClick={onToggleTracker}>
          {showTracker ? "Ocultar seguimiento" : "Ver seguimiento"}
        </button>
        {isAdmin && (
          <button type="button" className="ideas-modern-primary small" onClick={onAdminUpdate} disabled={updatingStatus}>
            Cambiar estado →
          </button>
        )}
      </div>
    </section>
  );
}

function IdeaDetailBlock({ title, text }) {
  if (!text) return null;

  return (
    <div className="ideas-modern-detail-block">
      <span>{title}</span>
      <p>{text}</p>
    </div>
  );
}

function TimelineRow({ title, detail, active = false }) {
  return (
    <div className={`ideas-modern-timeline-row ${active ? "active" : ""}`}>
      <i />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function IdeaEvidenceSection({
  idea,
  canAddEvidence,
  extraEvidenceFiles,
  uploadingEvidence,
  onExtraEvidenceChange,
  onUploadExtraEvidence,
}) {
  return (
    <div className="ideas-modern-evidence-section">
      <h4>Evidencia</h4>
      {idea.evidenceFiles?.length > 0 ? (
        <div className="ideas-modern-evidence-list">
          {idea.evidenceFiles.map((file, index) => (
            <a
              key={`${file.path || file.url}-${index}`}
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="ideas-modern-evidence-item"
            >
              <span>{getFileTypeLabel(file.name)}</span>
              <div>
                <strong>{file.name || "Archivo"}</strong>
                <small>{formatFileSize(file.size)} · {formatDate(file.uploadedAt)}</small>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="ideas-modern-muted">Esta idea aún no tiene evidencia adjunta.</p>
      )}

      {canAddEvidence && (
        <div className="ideas-modern-upload-box">
          <label>
            <input
              type="file"
              multiple
              onChange={(event) => onExtraEvidenceChange(Array.from(event.target.files || []))}
            />
            + Agregar evidencia
          </label>

          {extraEvidenceFiles.length > 0 && (
            <div>
              <small>{extraEvidenceFiles.length} archivo(s) seleccionado(s)</small>
              <button type="button" onClick={onUploadExtraEvidence} disabled={uploadingEvidence}>
                {uploadingEvidence ? "Subiendo..." : "Subir"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IdeaCommentsSection({ comments, commentsLoading }) {
  return (
    <div className="ideas-modern-comments-section">
      <h4>Comentarios administrativos</h4>
      {commentsLoading ? (
        <p className="ideas-modern-muted">Cargando comentarios...</p>
      ) : comments.length === 0 ? (
        <p className="ideas-modern-muted">Aún no hay comentarios administrativos.</p>
      ) : (
        <div className="ideas-modern-comments-list">
          {comments.map((comment) => (
            <div key={comment.id} className="ideas-modern-comment-item">
              <span className="ideas-mini-avatar">{getInitials(comment.createdByName)}</span>
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
  );
}

function FocusedIdeaForm({
  form,
  files,
  visibleAreas,
  saving,
  onChange,
  onFileChange,
  onRemoveFile,
  onSubmit,
  onClose,
}) {
  return (
    <div className="ideas-focused-overlay" role="dialog" aria-modal="true">
      <div className="ideas-focused-panel">
        <div className="ideas-focused-header">
          <div>
            <span>Incubadora de ideas</span>
            <h3>Nueva idea</h3>
            <p>
              No tiene que estar perfecta. Explica qué problema viste, qué propones
              y cómo crees que mejoraría el proceso.
            </p>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>

        <form className="ideas-focused-form" onSubmit={onSubmit}>
          <label className="full">
            Título de la idea <b>*</b>
            <input
              type="text"
              value={form.title}
              onChange={(event) => onChange("title", event.target.value)}
              placeholder="Ej. Recordatorios automáticos para mantenimientos"
              maxLength={140}
            />
          </label>

          <label>
            Área relacionada
            <select value={form.area} onChange={(event) => onChange("area", event.target.value)}>
              {visibleAreas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </label>

          <label>
            Prioridad sugerida
            <select
              value={form.priority}
              onChange={(event) => onChange("priority", event.target.value)}
            >
              {IDEA_PRIORITIES.map((priority) => (
                <option key={priority.value} value={priority.value}>
                  {priority.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Impacto estimado
            <select value={form.impact} onChange={(event) => onChange("impact", event.target.value)}>
              {IDEA_IMPACTS.map((impact) => (
                <option key={impact.value} value={impact.value}>
                  {impact.label}
                </option>
              ))}
            </select>
          </label>

          <label className="full">
            Problema actual <b>*</b>
            <textarea
              value={form.currentProblem}
              onChange={(event) => onChange("currentProblem", event.target.value)}
              placeholder="Describe qué no está funcionando bien, qué se pierde, qué se repite o qué genera errores."
              maxLength={900}
            />
          </label>

          <label className="full">
            Idea o propuesta <b>*</b>
            <textarea
              value={form.proposedIdea}
              onChange={(event) => onChange("proposedIdea", event.target.value)}
              placeholder="Explica qué propones hacer para resolver o mejorar la situación."
              maxLength={900}
            />
          </label>

          <label className="full">
            Cómo crees que podría implementarse
            <textarea
              value={form.implementationSuggestion}
              onChange={(event) => onChange("implementationSuggestion", event.target.value)}
              placeholder="Puede ser un paso, una pantalla, un botón, una regla o una forma de trabajo."
              maxLength={900}
            />
          </label>

          <label className="full">
            Beneficio esperado <b>*</b>
            <textarea
              value={form.expectedBenefit}
              onChange={(event) => onChange("expectedBenefit", event.target.value)}
              placeholder="Explica qué mejoraría: menos errores, ahorro de tiempo, mejor control, menos papel, mejor atención, etc."
              maxLength={700}
            />
          </label>

          <label className="ideas-focused-dropzone full">
            <input type="file" multiple onChange={onFileChange} />
            <span>↥</span>
            <strong>Agregar evidencia o ejemplo</strong>
            <p>Capturas, fotos, documentos o archivos que ayuden a entender la idea.</p>
          </label>

          {files.length > 0 && (
            <div className="ideas-focused-files full">
              {files.map((file, index) => (
                <button
                  type="button"
                  key={`${file.name}-${index}`}
                  onClick={() => onRemoveFile(index)}
                >
                  <span>{getFileTypeLabel(file.name)}</span>
                  {file.name}
                  <b>×</b>
                </button>
              ))}
            </div>
          )}

          <div className="ideas-focused-actions full">
            <button type="button" className="ideas-modern-secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="ideas-modern-primary" disabled={saving}>
              {saving ? "Guardando..." : "Registrar idea"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
