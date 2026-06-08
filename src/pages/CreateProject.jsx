import { useEffect, useMemo, useState } from "react";
import { createProject } from "../services/projectsService";
import { getActiveUsers } from "../services/usersService";
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
];

const PRIORITIES = ["Alta", "Media", "Baja"];

const STATUSES = [
  "Por iniciar",
  "En planeación",
  "En proceso",
  "En espera de información",
];

export default function CreateProject() {
  const { profile, currentUser, firebaseUser } = useAuth();

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
    status: "Por iniciar",
    progress: 0,
    notes: "",
  });

  const [collaboratorIds, setCollaboratorIds] = useState([]);
  const [files, setFiles] = useState([]);

  async function loadUsers() {
    setLoadingUsers(true);
    setMessage("");

    try {
      const data = await getActiveUsers();
      setUsers(data);
    } catch (error) {
      console.error(error);
      setMessage("No se pudieron cargar los usuarios activos.");
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function getCreatorUid() {
    return currentUser?.uid || firebaseUser?.uid || profile?.uid || profile?.id || "";
  }

  function getCreatorEmail() {
    return currentUser?.email || firebaseUser?.email || profile?.email || "";
  }

  function getCreatorName() {
    return profile?.name || currentUser?.displayName || firebaseUser?.displayName || "";
  }

  function getUserUid(user) {
    return user?.uid || user?.authUid || user?.userUid || user?.id || "";
  }

  function findUserByUid(uid) {
    return users.find((user) => getUserUid(user) === uid || user.id === uid);
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleRequesterChange(value) {
    const selectedUser = findUserByUid(value) || users.find((user) => user.id === value);

    setForm((current) => ({
      ...current,
      requesterName: selectedUser?.name || "",
      requesterEmail: selectedUser?.email || "",
    }));
  }

  function handleAssignedChange(value) {
    const selectedUser = findUserByUid(value);
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
    const selectedFiles = Array.from(event.target.files || []);
    setFiles(selectedFiles);
  }

  function resetForm() {
    setForm({
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
      status: "Por iniciar",
      progress: 0,
      notes: "",
    });

    setCollaboratorIds([]);
    setFiles([]);
    setMessage("");
  }

  const selectedCollaborators = useMemo(() => {
    return users.filter((user) => collaboratorIds.includes(getUserUid(user)));
  }, [users, collaboratorIds]);

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
      label: "Estado inicial",
      complete: Boolean(form.status),
    },
    {
      label: "Porcentaje de avance inicial",
      complete: form.progress !== "" && form.progress !== null,
    },
  ];

  const canSubmit = requiredFields.every((field) => field.complete);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    if (!canSubmit) {
      setMessage("Completa todos los campos requeridos antes de crear el proyecto.");
      return;
    }

    const creatorUid = getCreatorUid();

    if (!creatorUid) {
      setMessage("No se pudo identificar tu usuario. Cierra sesión e inicia sesión nuevamente.");
      return;
    }

    setSaving(true);

    try {
      const collaboratorUsers = users.filter((user) =>
        collaboratorIds.includes(getUserUid(user))
      );

      const creatorUser = {
        uid: creatorUid,
        id: creatorUid,
        email: getCreatorEmail(),
        name: getCreatorName(),
        role: profile?.role || "",
        active: profile?.active !== false,
      };

      const payload = {
        ...form,

        progress: Number(form.progress || 0),

        assignedToUid: form.assignedToUid || form.assignedToId,
        assignedToId: form.assignedToId || form.assignedToUid,
        assignedToName: form.assignedToName,
        assignedToEmail: form.assignedToEmail,

        collaboratorIds,
        collaboratorUids: collaboratorIds,
        collaboratorNames: collaboratorUsers.map((user) => user.name || ""),
        collaboratorEmails: collaboratorUsers.map((user) => user.email || ""),

        createdByUid: creatorUid,
        createdBy: creatorUid,
        createdByEmail: creatorUser.email,
        createdByName: creatorUser.name,

        attachedFileNames: files.map((file) => file.name),
      };

      await createProject(payload, creatorUser);

      setMessage("Proyecto creado correctamente.");
      resetForm();
    } catch (error) {
      console.error(error);
      setMessage(error.message || "No se pudo crear el proyecto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="visual-page">
      <form onSubmit={handleSubmit}>
        <div className="visual-page-header">
          <div>
            <h2>Alta de proyecto</h2>
            <p>
              Registra una nueva solicitud o proyecto interno de forma clara y
              ordenada.
            </p>
          </div>

          <div className="visual-page-actions">
            <button
              type="button"
              className="visual-outline-button"
              onClick={resetForm}
              disabled={saving}
            >
              × Cancelar
            </button>

            <button
              type="submit"
              className="visual-primary-button"
              disabled={saving}
            >
              ＋ {saving ? "Creando..." : "Crear proyecto"}
            </button>
          </div>
        </div>

        {message && <div className="message-box">{message}</div>}

        <div className="create-project-layout">
          <main className="create-project-main">
            <section className="visual-card form-section-card">
              <FormSectionHeader
                number="1"
                title="Información general"
                subtitle="Completa los datos básicos del proyecto."
              />

              <div className="visual-form-grid">
                <Field label="Título del proyecto" required>
                  <input
                    id="create-project-title"
                    name="title"
                    value={form.title}
                    onChange={(event) => updateField("title", event.target.value)}
                    placeholder="Ej. Implementación de nuevo CRM"
                  />
                </Field>

                <Field label="Área responsable" required>
                  <select
                    id="create-project-responsible-area"
                    name="responsibleArea"
                    value={form.responsibleArea}
                    onChange={(event) =>
                      updateField("responsibleArea", event.target.value)
                    }
                  >
                    <option value="">Selecciona un área</option>
                    {AREAS.map((area) => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Solicitante" required>
                  <select
                    id="create-project-requester"
                    name="requester"
                    value={
                      users.find((user) => user.email === form.requesterEmail)
                        ? getUserUid(
                            users.find((user) => user.email === form.requesterEmail)
                          )
                        : ""
                    }
                    onChange={(event) => handleRequesterChange(event.target.value)}
                    disabled={loadingUsers}
                  >
                    <option value="">Selecciona el solicitante</option>
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

                <Field label="Prioridad" required>
                  <select
                    id="create-project-priority"
                    name="priority"
                    value={form.priority}
                    onChange={(event) =>
                      updateField("priority", event.target.value)
                    }
                  >
                    <option value="">Selecciona la prioridad</option>
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Fecha límite" required>
                  <input
                    id="create-project-deadline"
                    name="deadline"
                    type="date"
                    value={form.deadline}
                    onChange={(event) =>
                      updateField("deadline", event.target.value)
                    }
                  />
                </Field>

                <Field label="Descripción del proyecto" required full>
                  <textarea
                    id="create-project-description"
                    name="description"
                    maxLength={500}
                    value={form.description}
                    onChange={(event) =>
                      updateField("description", event.target.value)
                    }
                    placeholder="Describe el objetivo, alcance y principales entregables del proyecto..."
                  />

                  <small className="field-counter">
                    {form.description.length}/500
                  </small>
                </Field>
              </div>
            </section>

            <section className="visual-card form-section-card">
              <FormSectionHeader
                number="2"
                title="Asignación y seguimiento"
                subtitle="Define quién hará seguimiento y cómo inicia el proyecto."
              />

              <div className="visual-form-grid">
                <Field label="Responsable del proyecto" required>
                  <select
                    id="create-project-assigned-to"
                    name="assignedTo"
                    value={form.assignedToUid || form.assignedToId}
                    onChange={(event) => handleAssignedChange(event.target.value)}
                    disabled={loadingUsers}
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
                    id="create-project-collaborators"
                    name="collaborators"
                    value=""
                    onChange={(event) => toggleCollaborator(event.target.value)}
                    disabled={loadingUsers}
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

                <Field label="Estado inicial" required>
                  <select
                    id="create-project-status"
                    name="status"
                    value={form.status}
                    onChange={(event) => updateField("status", event.target.value)}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Porcentaje de avance inicial" required>
                  <div className="progress-stepper">
                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          "progress",
                          Math.max(0, Number(form.progress || 0) - 5)
                        )
                      }
                    >
                      −
                    </button>

                    <input
                      id="create-project-progress"
                      name="progress"
                      type="number"
                      min="0"
                      max="100"
                      value={form.progress}
                      onChange={(event) =>
                        updateField("progress", event.target.value)
                      }
                    />

                    <button
                      type="button"
                      onClick={() =>
                        updateField(
                          "progress",
                          Math.min(100, Number(form.progress || 0) + 5)
                        )
                      }
                    >
                      ＋
                    </button>
                  </div>
                </Field>

                <Field label="Notas internas" full>
                  <textarea
                    id="create-project-notes"
                    name="notes"
                    maxLength={300}
                    value={form.notes}
                    onChange={(event) => updateField("notes", event.target.value)}
                    placeholder="Información adicional relevante para el equipo o seguimiento del proyecto..."
                  />

                  <small className="field-counter">{form.notes.length}/300</small>
                </Field>
              </div>
            </section>

            <section className="visual-card form-section-card">
              <FormSectionHeader
                number="3"
                title="Adjuntos y referencias"
                subtitle="Agrega archivos o enlaces que respalden el proyecto."
              />

              <div className="attachments-grid">
                <label className="dropzone">
                  <input
                    id="create-project-files"
                    name="files"
                    type="file"
                    multiple
                    onChange={handleFiles}
                  />
                  <span>☁</span>
                  <strong>Arrastra y suelta archivos aquí</strong>
                  <p>o haz clic para seleccionar</p>
                  <small>
                    Formatos permitidos: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX,
                    JPG, PNG.
                  </small>
                </label>

                <div className="attached-files">
                  <div className="mini-section-header">
                    <div>
                      <h3>Archivos agregados ({files.length})</h3>
                    </div>
                  </div>

                  {files.length === 0 ? (
                    <EmptyState text="Aún no has agregado archivos." />
                  ) : (
                    files.map((file) => (
                      <div className="attached-file-item" key={file.name}>
                        <span>{getFileIcon(file.name)}</span>

                        <div>
                          <strong>{file.name}</strong>
                          <small>{Math.round(file.size / 1024)} KB</small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>
          </main>

          <aside className="create-project-side">
            <section className="visual-card">
              <SectionHeader title="Resumen del proyecto" icon="◉" />

              <div className="project-preview-card">
                <span className="preview-label">VISTA PREVIA</span>

                <h3>{form.title || "Título del proyecto"}</h3>

                <p>
                  {form.description ||
                    "Descripción breve del proyecto aparecerá aquí..."}
                </p>

                <div className="preview-badges">
                  <Badge color="blue">
                    {form.responsibleArea || "Área responsable"}
                  </Badge>

                  <Badge color="orange">{form.priority || "Prioridad"}</Badge>

                  <Badge color="blue">{form.status || "Por iniciar"}</Badge>
                </div>

                <div className="preview-details">
                  <PreviewItem label="Responsable" value={form.assignedToName} />
                  <PreviewItem label="Solicitante" value={form.requesterName} />
                  <PreviewItem label="Fecha límite" value={form.deadline} />

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

                <small>
                  La información se actualizará al guardar el proyecto.
                </small>
              </div>
            </section>

            <section className="visual-card">
              <SectionHeader title="Campos requeridos" icon="◷" />

              <div className="required-list">
                {requiredFields.map((field) => (
                  <div
                    key={field.label}
                    className={field.complete ? "complete" : ""}
                  >
                    <span>{field.complete ? "✓" : "○"}</span>
                    {field.label}
                  </div>
                ))}
              </div>
            </section>

            <section className="visual-card">
              <SectionHeader title="Buenas prácticas" icon="☼" />

              <div className="tips-list">
                <Tip
                  color="green"
                  title="Define un título claro y específico"
                  text="Facilita la identificación y búsqueda del proyecto."
                />

                <Tip
                  color="blue"
                  title="Establece un responsable"
                  text="Asegura el seguimiento y cumplimiento de objetivos."
                />

                <Tip
                  color="orange"
                  title="Adjunta documentos relevantes"
                  text="Proporciona contexto y soporte al equipo de trabajo."
                />
              </div>
            </section>
          </aside>
        </div>
      </form>
    </div>
  );
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

function Tip({ color, title, text }) {
  return (
    <div className="tip-item">
      <span className={`tip-icon tip-${color}`}>✓</span>

      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state small">
      <div>▯</div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
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

function getFileIcon(fileName = "") {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".pdf")) return "PDF";
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) return "XLS";
  if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "DOC";
  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) return "PPT";

  return "FILE";
}