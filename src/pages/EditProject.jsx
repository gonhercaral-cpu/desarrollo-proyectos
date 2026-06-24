import { useEffect, useMemo, useState } from "react";
import {
  arrayUnion,
  doc,
  getDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { getActiveUsers } from "../services/usersService";
import { uploadEvidenceFile } from "../services/storageService";
import { useAuth } from "../context/AuthContext";

const AREAS = [
  "Administración",
  "Académica",
  "Imprenta",
  "Mercadotecnia",
  "Producción audiovisual",
  "Recursos Humanos",
  "Sistemas",
  "Soporte técnico",
  "Ingeniería",
];

const PRIORITIES = ["Alta", "Media", "Baja"];

const STATUSES = [
  "Por iniciar",
  "En planeación",
  "En proceso",
  "En espera de información",
  "Listo para revisión",
  "Correcciones solicitadas",
  "Aprobado para entrega",
  "Finalizado",
  "Cancelado",
  "Pausado",
];

export default function EditProject({ projectId, onBack, onSaved }) {
  const { profile, firebaseUser, currentUser } = useAuth();

  const [project, setProject] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [message, setMessage] = useState("");
  const [files, setFiles] = useState([]);

  const [form, setForm] = useState({
    title: "",
    responsibleArea: "",
    requesterName: "",
    requesterEmail: "",
    priority: "",
    deadline: "",
    description: "",
    assignedToId: "",
    assignedToUid: "",
    assignedToName: "",
    assignedToEmail: "",
    status: "",
    progress: 0,
  });

  const [collaboratorIds, setCollaboratorIds] = useState([]);

  function getAuthUserUid() {
    return currentUser?.uid || firebaseUser?.uid || profile?.uid || profile?.id || "";
  }

  function getUserUid(user) {
    return user?.uid || user?.authUid || user?.userUid || user?.id || "";
  }

  function findUserByUid(uid) {
    return users.find((user) => getUserUid(user) === uid || user.id === uid);
  }

  async function loadData() {
    if (!projectId) return;

    setLoading(true);
    setMessage("");

    try {
      const [usersData, projectSnapshot] = await Promise.all([
        getActiveUsers(),
        getDoc(doc(db, "projects", projectId)),
      ]);

      setUsers(usersData);

      if (!projectSnapshot.exists()) {
        setMessage("No se encontró el proyecto.");
        setProject(null);
        return;
      }

      const projectData = {
        id: projectSnapshot.id,
        ...projectSnapshot.data(),
      };

      const assignedUid =
        projectData.assignedToUid || projectData.assignedToId || "";

      const projectCollaboratorIds = [
        ...normalizeArray(projectData.collaboratorIds),
        ...normalizeArray(projectData.collaboratorUids),
      ];

      setProject(projectData);

      setForm({
        title: projectData.title || "",
        responsibleArea: projectData.responsibleArea || "",
        requesterName: projectData.requesterName || "",
        requesterEmail: projectData.requesterEmail || "",
        priority: projectData.priority || "",
        deadline: projectData.deadline || "",
        description: projectData.description || "",
        assignedToId: assignedUid,
        assignedToUid: assignedUid,
        assignedToName: projectData.assignedToName || "",
        assignedToEmail: projectData.assignedToEmail || "",
        status: projectData.status || "En planeación",
        progress: Number(projectData.progress || 0),
      });

      setCollaboratorIds(removeDuplicatedValues(projectCollaboratorIds));
    } catch (error) {
      console.error(error);
      setMessage("No se pudo cargar la información del proyecto.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [projectId]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleRequesterChange(userId) {
    const selectedUser = users.find((user) => user.id === userId);

    setForm((current) => ({
      ...current,
      requesterName: selectedUser?.name || "",
      requesterEmail: selectedUser?.email || "",
    }));
  }

  function handleAssignedChange(userUid) {
    const selectedUser = findUserByUid(userUid);
    const selectedUserUid = getUserUid(selectedUser);

    setForm((current) => ({
      ...current,
      assignedToId: selectedUserUid,
      assignedToUid: selectedUserUid,
      assignedToName: selectedUser?.name || "",
      assignedToEmail: selectedUser?.email || "",
    }));
  }

  function toggleCollaborator(userUid) {
    if (!userUid) return;

    setCollaboratorIds((current) => {
      if (current.includes(userUid)) {
        return current.filter((id) => id !== userUid);
      }

      return [...current, userUid];
    });
  }

  function handleFiles(event) {
    setFiles(Array.from(event.target.files || []));
  }

  function removeSelectedFile(fileName) {
    setFiles((current) => current.filter((file) => file.name !== fileName));
  }

  const selectedCollaborators = useMemo(() => {
    return users.filter((user) => collaboratorIds.includes(getUserUid(user)));
  }, [users, collaboratorIds]);

  const evidenceFiles = useMemo(() => {
    return [
      ...normalizeArray(project?.evidenceFiles),
      ...normalizeArray(project?.evidences),
      ...normalizeArray(project?.evidence),
      ...normalizeArray(project?.files),
      ...normalizeArray(project?.attachments),
      ...normalizeArray(project?.attachedFiles),
      ...normalizeArray(project?.projectFiles),
      ...normalizeArray(project?.documents),
      ...normalizeArray(project?.uploadedFiles),
    ].map(normalizeFileItem);
  }, [project]);

  const requiredFields = [
    {
      label: "Título del proyecto",
      complete: Boolean(form.title.trim()),
    },
    {
      label: "Área responsable",
      complete: Boolean(form.responsibleArea),
    },
    {
      label: "Solicitante",
      complete: Boolean(form.requesterName),
    },
    {
      label: "Prioridad",
      complete: Boolean(form.priority),
    },
    {
      label: "Fecha límite",
      complete: Boolean(form.deadline),
    },
    {
      label: "Descripción del proyecto",
      complete: Boolean(form.description.trim()),
    },
    {
      label: "Responsable del proyecto",
      complete: Boolean(form.assignedToUid || form.assignedToId),
    },
    {
      label: "Estado del proyecto",
      complete: Boolean(form.status),
    },
    {
      label: "Porcentaje de avance",
      complete: form.progress !== "" && form.progress !== null,
    },
    {
      label: "Archivos adjuntos",
      complete: evidenceFiles.length > 0 || files.length > 0,
      optional: true,
    },
  ];

  const canSubmit = requiredFields
    .filter((field) => !field.optional)
    .every((field) => field.complete);

  const completionPercent = Math.round(
    (requiredFields.filter((field) => field.complete).length / requiredFields.length) * 100
  );

  async function handleSubmit(event) {
    event.preventDefault();

    if (!canSubmit) {
      setMessage("Completa todos los campos requeridos antes de guardar.");
      return;
    }

    const authUid = getAuthUserUid();

    if (!authUid) {
      setMessage("No se encontró el UID del usuario actual.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const now = Timestamp.now();

      const collaboratorUsers = users.filter((user) =>
        collaboratorIds.includes(getUserUid(user))
      );

      const uploadedItems = [];

      for (const file of files) {
        const uploadedFile = await uploadEvidenceFile(
          projectId,
          file,
          firebaseUser || currentUser,
          profile
        );

        uploadedItems.push({
          ...uploadedFile,
          fileName: uploadedFile.fileName || file.name,
          uploadedAt: now,
          uploadedByUid: authUid,
          uploadedByName:
            profile?.name ||
            firebaseUser?.email ||
            currentUser?.email ||
            "Usuario",
          uploadedByEmail: firebaseUser?.email || currentUser?.email || "",
        });
      }

      const historyItem = {
        type: "Edición",
        title: "Proyecto actualizado",
        description:
          uploadedItems.length > 0
            ? `Actualizó la información del proyecto y agregó ${uploadedItems.length} archivo(s).`
            : "Actualizó la información del proyecto.",
        createdAt: now,
        createdByName:
          profile?.name || firebaseUser?.email || currentUser?.email || "Usuario",
        createdByEmail: firebaseUser?.email || currentUser?.email || "",
      };

      const assignedUid = form.assignedToUid || form.assignedToId || "";

      const updateData = {
        title: form.title.trim(),
        responsibleArea: form.responsibleArea,
        requesterName: form.requesterName,
        requesterEmail: form.requesterEmail,
        priority: form.priority,
        deadline: form.deadline,
        description: form.description.trim(),

        assignedToUid: assignedUid,
        assignedToId: assignedUid,
        assignedToName: form.assignedToName,
        assignedToEmail: form.assignedToEmail,

        status: form.status,
        progress: Number(form.progress || 0),

        collaboratorIds,
        collaboratorUids: collaboratorIds,
        collaboratorNames: collaboratorUsers.map((user) => user.name || ""),
        collaboratorEmails: collaboratorUsers.map((user) => user.email || ""),

        updatedAt: now,
        updatedBy: authUid,
        updatedByEmail: firebaseUser?.email || currentUser?.email || "",
        updatedByName:
          profile?.name || firebaseUser?.email || currentUser?.email || "Usuario",
        history: arrayUnion(historyItem),
      };

      if (uploadedItems.length > 0) {
        updateData.evidenceFiles = arrayUnion(...uploadedItems);
      }

      const projectRef = doc(db, "projects", projectId);

      await updateDoc(projectRef, updateData);

      setMessage("Proyecto actualizado correctamente.");

      if (onSaved) {
        onSaved();
      }
    } catch (error) {
      console.error(error);
      setMessage(
        error.message ||
          "No se pudo guardar el proyecto. Revisa permisos de Firestore y Storage."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="visual-page">
        <div className="dashboard-loading-card">Cargando edición...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="visual-page">
        <div className="visual-card">
          <h2>No se encontró el proyecto</h2>
          <p>No se pudo cargar la información para editar.</p>

          <button className="visual-primary-button" onClick={onBack}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="visual-page edit-project-page edit-project-redesign-page project-screen-page">
      <form onSubmit={handleSubmit}>
        <section className="printshop-topbar project-screen-topbar edit-project-module-topbar">
          <div className="printshop-topbar-main">
            <span className="printshop-topbar-module-icon project-screen-module-icon">
              <SvgIcon name="edit" />
            </span>

            <div className="printshop-topbar-copy">
              <p className="section-kicker">Gestión de proyectos</p>
              <h1>Editar proyecto</h1>
              <p>
                Actualiza la información, responsables y seguimiento del proyecto.
              </p>
              <span className="project-screen-breadcrumb">
                Inicio / Proyectos / {getProjectCode(project)} / Edición
              </span>
            </div>
          </div>

          <div className="printshop-hero-actions compact-actions project-screen-actions">
            <button
              type="submit"
              className="visual-primary-button"
              disabled={saving}
            >
              <SvgIcon name="save" />
              {saving ? "Guardando..." : "Guardar cambios"}
            </button>

            <button
              type="button"
              className="visual-outline-button"
              onClick={onBack}
              disabled={saving}
            >
              <SvgIcon name="close" />
              Cancelar
            </button>

            <button
              type="button"
              className="visual-outline-button"
              onClick={onBack}
              disabled={saving}
            >
              <SvgIcon name="preview" />
              Vista previa
            </button>
          </div>
        </section>

        {message && <div className="message-box">{message}</div>}

        <section className="edit-summary-strip edit-summary-redesign">
          <div className="edit-summary-icon"><SvgIcon name="project" /></div>

          <div>
            <span>Código del proyecto</span>
            <strong>{getProjectCode(project)}</strong>
          </div>

          <div>
            <span>Estado</span>
            <Badge color="blue">En edición</Badge>
          </div>

          <div>
            <span>Título del proyecto</span>
            <strong>{form.title || "Sin título"}</strong>
          </div>

          <div>
            <span>Área</span>
            <strong>{form.responsibleArea || "Sin área"}</strong>
          </div>

          <div>
            <span>Responsable</span>
            <strong>{form.assignedToName || "Sin responsable"}</strong>
          </div>

          <div>
            <span>Prioridad actual</span>
            <Badge color={form.priority === "Alta" ? "red" : "gold"}>
              {form.priority || "Sin prioridad"}
            </Badge>
          </div>

          <div>
            <span>Fecha límite</span>
            <strong>{formatPlainDate(form.deadline)}</strong>
          </div>
        </section>

        <div className="edit-project-layout edit-project-redesign-layout">
          <main className="edit-project-main">
            <section className="visual-card form-section-card edit-project-section-card">
              <FormSectionHeader
                number="1"
                title="Información general"
                subtitle="Completa los datos básicos del proyecto."
              />

              <div className="edit-form-grid edit-form-grid-redesign">
                <Field label="Título del proyecto" required>
                  <input
                    id="edit-project-title"
                    name="title"
                    value={form.title}
                    onChange={(event) => updateField("title", event.target.value)}
                    placeholder="Ej. Rediseño de material académico"
                  />
                </Field>

                <Field label="Área responsable" required>
                  <select
                    id="edit-project-responsible-area"
                    name="responsibleArea"
                    value={form.responsibleArea}
                    onChange={(event) =>
                      updateField("responsibleArea", event.target.value)
                    }
                  >
                    <option value="">Selecciona un área</option>
                    {AREAS.map((area) => (
                      <option value={area} key={area}>
                        {area}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Solicitante" required>
                  <select
                    id="edit-project-requester"
                    name="requester"
                    value={
                      users.find((user) => user.email === form.requesterEmail)?.id || ""
                    }
                    onChange={(event) => handleRequesterChange(event.target.value)}
                  >
                    <option value="">Selecciona el solicitante</option>
                    {users.map((user) => (
                      <option value={user.id} key={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Prioridad" required>
                  <select
                    id="edit-project-priority"
                    name="priority"
                    value={form.priority}
                    onChange={(event) => updateField("priority", event.target.value)}
                  >
                    <option value="">Selecciona prioridad</option>
                    {PRIORITIES.map((priority) => (
                      <option value={priority} key={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Fecha límite" required>
                  <input
                    id="edit-project-deadline"
                    name="deadline"
                    type="date"
                    value={form.deadline}
                    onChange={(event) => updateField("deadline", event.target.value)}
                  />
                </Field>

                <Field label="Descripción del proyecto" required full>
                  <textarea
                    id="edit-project-description"
                    name="description"
                    maxLength={500}
                    value={form.description}
                    onChange={(event) => updateField("description", event.target.value)}
                    placeholder="Describe el objetivo, alcance y entregables principales del proyecto..."
                  />
                  <small className="field-counter">{form.description.length}/500</small>
                </Field>
              </div>
            </section>

            <section className="visual-card form-section-card edit-project-section-card">
              <FormSectionHeader
                number="2"
                title="Asignación y seguimiento"
                subtitle="Define quién hará seguimiento y cómo avanza el proyecto."
              />

              <div className="edit-form-grid edit-form-grid-redesign">
                <Field label="Responsable del proyecto" required>
                  <select
                    id="edit-project-assigned-to"
                    name="assignedTo"
                    value={form.assignedToUid || form.assignedToId}
                    onChange={(event) => handleAssignedChange(event.target.value)}
                  >
                    <option value="">Selecciona al responsable</option>
                    {users.map((user) => {
                      const userUid = getUserUid(user);
                      return (
                        <option value={userUid} key={user.id}>
                          {user.name}
                        </option>
                      );
                    })}
                  </select>
                </Field>

                <Field label="Colaboradores">
                  <select
                    id="edit-project-collaborators"
                    name="collaborators"
                    value=""
                    onChange={(event) => toggleCollaborator(event.target.value)}
                  >
                    <option value="">Selecciona colaboradores</option>
                    {users.map((user) => {
                      const userUid = getUserUid(user);
                      return (
                        <option value={userUid} key={user.id}>
                          {user.name}
                        </option>
                      );
                    })}
                  </select>

                  <div className="selected-chips">
                    {selectedCollaborators.map((user) => {
                      const userUid = getUserUid(user);
                      return (
                        <button
                          type="button"
                          key={userUid}
                          onClick={() => toggleCollaborator(userUid)}
                        >
                          <span>{getInitials(user.name)}</span>
                          {user.name}
                          <b>×</b>
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Estado del proyecto" required>
                  <select
                    id="edit-project-status"
                    name="status"
                    value={form.status}
                    onChange={(event) => updateField("status", event.target.value)}
                  >
                    <option value="">Selecciona estado</option>
                    {STATUSES.map((status) => (
                      <option value={status} key={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Porcentaje de avance (%)" required full>
                  <div className="edit-progress-redesign">
                    <input
                      id="edit-project-progress-range"
                      name="progressRange"
                      type="range"
                      min="0"
                      max="100"
                      value={form.progress}
                      onChange={(event) => updateField("progress", event.target.value)}
                    />

                    <div className="edit-progress-scale">
                      <span>0%</span>
                      <span>50%</span>
                      <span>100%</span>
                    </div>

                    <div className="edit-progress-box">
                      <input
                        id="edit-project-progress-number"
                        name="progress"
                        type="number"
                        min="0"
                        max="100"
                        value={form.progress}
                        onChange={(event) => updateField("progress", event.target.value)}
                      />
                      <strong>%</strong>
                    </div>
                  </div>
                </Field>
              </div>
            </section>

            <section className="visual-card form-section-card edit-project-section-card">
              <FormSectionHeader
                number="3"
                title="Adjuntos y evidencias"
                subtitle="Agrega archivos o referencias que respalden el proyecto."
              />

              <div className="attachments-grid edit-attachments-grid">
                <label className="dropzone edit-dropzone">
                  <input
                    id="edit-project-files"
                    name="files"
                    type="file"
                    multiple
                    onChange={handleFiles}
                  />
                  <span><SvgIcon name="upload" /></span>
                  <strong>Arrastra y suelta archivos aquí</strong>
                  <p>o haz clic para seleccionar</p>
                  <small>
                    Formatos permitidos: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG y PNG.
                  </small>
                </label>

                <div className="attached-files">
                  <div className="mini-section-header">
                    <div>
                      <span><SvgIcon name="attachment" /></span>
                      <h3>Archivos adjuntos ({evidenceFiles.length + files.length})</h3>
                    </div>
                  </div>

                  {evidenceFiles.length === 0 && files.length === 0 ? (
                    <EmptyState text="Aún no hay archivos adjuntos." small />
                  ) : (
                    <>
                      {evidenceFiles.map((file, index) => (
                        <AttachedFile
                          key={`${getFileName(file)}-${index}`}
                          name={getFileName(file)}
                          detail={formatDate(
                            file.uploadedAt ||
                              file.createdAt ||
                              file.date ||
                              file.uploadDate
                          )}
                        />
                      ))}

                      {files.map((file) => (
                        <AttachedFile
                          key={file.name}
                          name={file.name}
                          detail={`${Math.round(file.size / 1024)} KB`}
                          onRemove={() => removeSelectedFile(file.name)}
                        />
                      ))}
                    </>
                  )}
                </div>
              </div>
            </section>
          </main>

          <aside className="edit-project-side edit-project-side-redesign">
            <section className="visual-card edit-side-card">
              <SectionHeader title="Resumen del proyecto" icon={<SvgIcon name="preview" />} />

              <div className="project-preview-card edit-preview-card">
                <span className="preview-label">VISTA PREVIA</span>
                <h3>{form.title || "Título del proyecto"}</h3>
                <p>
                  {form.description ||
                    "Descripción breve del proyecto aparecerá aquí..."}
                </p>

                <div className="preview-badges">
                  <Badge color="blue">{form.responsibleArea || "Área"}</Badge>
                  <Badge color={form.priority === "Alta" ? "red" : "gold"}>
                    {form.priority || "Prioridad"}
                  </Badge>
                  <Badge color="green">{form.status || "Estado"}</Badge>
                </div>

                <div className="preview-details">
                  <PreviewItem label="Responsable" value={form.assignedToName} />
                  <PreviewItem label="Fecha límite" value={formatPlainDate(form.deadline)} />
                  <PreviewItem label="Solicitante" value={form.requesterName} />
                </div>

                <div className="area-progress">
                  <strong>{Number(form.progress || 0)}%</strong>
                  <div className="area-progress-track">
                    <div
                      className="area-progress-fill"
                      style={{ width: `${Number(form.progress || 0)}%` }}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="visual-card edit-side-card">
              <SectionHeader title="Campos requeridos" icon={<SvgIcon name="checklist" />} />

              <div className="required-list edit-required-list">
                {requiredFields.map((field) => (
                  <div key={field.label} className={field.complete ? "complete" : ""}>
                    <span>{field.complete ? "✓" : "○"}</span>
                    {field.label}
                  </div>
                ))}
              </div>
            </section>

            <section className="visual-card edit-side-card edit-tip-card">
              <div className="edit-tip-header">
                <span><SvgIcon name="tip" /></span>
                <div>
                  <h3>Tip</h3>
                  <p>Mantén la información actualizada para mejorar el seguimiento y cumplimiento de metas.</p>
                </div>
              </div>
            </section>

          </aside>
        </div>
      </form>
    </div>
  );
}

function SvgIcon({ name }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": "true",
  };

  const stroke = {
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  };

  const icons = {
    edit: (
      <svg {...commonProps}>
        <path {...stroke} d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
        <path {...stroke} d="M13.5 7.5l3 3" />
      </svg>
    ),
    save: (
      <svg {...commonProps}>
        <path {...stroke} d="M5 12l4 4L19 6" />
      </svg>
    ),
    close: (
      <svg {...commonProps}>
        <path {...stroke} d="M6 6l12 12M18 6L6 18" />
      </svg>
    ),
    preview: (
      <svg {...commonProps}>
        <path {...stroke} d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
        <circle {...stroke} cx="12" cy="12" r="3" />
      </svg>
    ),
    project: (
      <svg {...commonProps}>
        <path {...stroke} d="M7 4h7l3 3v13H7z" />
        <path {...stroke} d="M14 4v4h4" />
        <path {...stroke} d="M9 12h6M9 16h6" />
      </svg>
    ),
    upload: (
      <svg {...commonProps}>
        <path {...stroke} d="M12 16V4" />
        <path {...stroke} d="M7 9l5-5 5 5" />
        <path {...stroke} d="M5 20h14" />
      </svg>
    ),
    attachment: (
      <svg {...commonProps}>
        <path {...stroke} d="M8 12.5l5.8-5.8a3 3 0 1 1 4.2 4.2l-7 7a5 5 0 0 1-7.1-7.1l7.4-7.4" />
      </svg>
    ),
    checklist: (
      <svg {...commonProps}>
        <path {...stroke} d="M9 6h11M9 12h11M9 18h11" />
        <path {...stroke} d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
      </svg>
    ),
    tip: (
      <svg {...commonProps}>
        <path {...stroke} d="M9 18h6M10 22h4" />
        <path {...stroke} d="M8 14a6 6 0 1 1 8 0c-1 1-1.5 2-1.5 3h-5c0-1-.5-2-1.5-3z" />
      </svg>
    ),
  };

  return <span className="project-svg-icon">{icons[name] || icons.project}</span>;
}

function Field({ label, required, full, children }) {
  return (
    <label className={`visual-field ${full ? "full" : ""}`}>
      <span>
        {label} {required && <b>*</b>}
      </span>
      {children}
    </label>
  );
}

function FormSectionHeader({ number, title, subtitle }) {
  return (
    <div className="form-section-header">
      <span>{number}</span>
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  );
}

function SectionHeader({ title, icon }) {
  return (
    <div className="mini-section-header">
      <div>
        {icon && <span>{icon}</span>}
        <h3>{title}</h3>
      </div>
    </div>
  );
}

function PreviewItem({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "—"}</strong>
    </div>
  );
}

function AttachedFile({ name, detail, onRemove }) {
  return (
    <div className="attached-file-item">
      <span>{getFileIcon(name)}</span>

      <div>
        <strong>{name || "Archivo"}</strong>
        <small>{detail || "Archivo adjunto"}</small>
      </div>

      {onRemove && (
        <button type="button" className="remove-file-button" onClick={onRemove}>
          ×
        </button>
      )}
    </div>
  );
}

function EmptyState({ text, small }) {
  return (
    <div className={`empty-state ${small ? "small" : ""}`}>
      <div>▯</div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && !value.toDate) {
    return Object.values(value);
  }
  return [];
}

function removeDuplicatedValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeFileItem(file) {
  if (!file) return {};
  if (typeof file === "string") {
    return {
      fileName: getNameFromUrl(file),
      downloadUrl: file,
      url: file,
    };
  }
  return {
    ...file,
    fileName:
      file.fileName ||
      file.name ||
      file.originalName ||
      file.filename ||
      file.title ||
      "Archivo",
    downloadUrl:
      file.downloadUrl ||
      file.downloadURL ||
      file.url ||
      file.fileUrl ||
      file.fileURL ||
      file.link ||
      "",
    uploadedAt:
      file.uploadedAt || file.createdAt || file.date || file.uploadDate || null,
    uploadedByName:
      file.uploadedByName ||
      file.authorName ||
      file.createdByName ||
      file.userName ||
      "",
  };
}

function getFileName(file) {
  return (
    file?.fileName ||
    file?.name ||
    file?.originalName ||
    file?.filename ||
    file?.title ||
    getNameFromUrl(getFileUrl(file)) ||
    "Archivo"
  );
}

function getFileUrl(file) {
  return (
    file?.downloadUrl ||
    file?.downloadURL ||
    file?.url ||
    file?.fileUrl ||
    file?.fileURL ||
    file?.link ||
    ""
  );
}

function getNameFromUrl(url = "") {
  if (!url) return "Archivo";
  try {
    const decoded = decodeURIComponent(url);
    const cleanUrl = decoded.split("?")[0];
    const parts = cleanUrl.split("/");
    const lastPart = parts[parts.length - 1];
    return lastPart || "Archivo";
  } catch {
    return "Archivo";
  }
}

function getInitials(name = "") {
  return String(name)
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getProjectCode(project) {
  return (
    project.projectCode ||
    project.code ||
    `PRY-${project.id.slice(0, 6).toUpperCase()}`
  );
}

function getFileIcon(fileName = "") {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".pdf")) return "PDF";
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) return "XLS";
  if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "DOC";
  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) return "PPT";
  if (
    lowerName.endsWith(".jpg") ||
    lowerName.endsWith(".jpeg") ||
    lowerName.endsWith(".png") ||
    lowerName.endsWith(".webp")
  ) {
    return "IMG";
  }
  return "FILE";
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = value?.toDate?.() || new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPlainDate(value) {
  if (!value) return "Sin fecha";
  const date =
    typeof value === "string"
      ? new Date(`${value}T00:00:00`)
      : value?.toDate?.() || new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
