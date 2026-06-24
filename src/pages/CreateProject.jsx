import { useEffect, useMemo, useState } from "react";
import { createProject } from "../services/projectsService";
import { getActiveUsers } from "../services/usersService";
import { getActiveDepartments } from "../services/departmentsService";
import { useAuth } from "../context/AuthContext";

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
  const [departments, setDepartments] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({
    title: "",
    departmentId: "",
    departmentName: "",
    responsibleDepartmentId: "",
    responsibleDepartmentName: "",
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

  async function loadData() {
    setLoadingUsers(true);
    setMessage("");

    try {
      const [usersData, departmentsData] = await Promise.all([
        getActiveUsers(),
        getActiveDepartments(),
      ]);

      setUsers(usersData);
      setDepartments(departmentsData);
    } catch (error) {
      console.error(error);
      setMessage("No se pudieron cargar los usuarios activos o departamentos.");
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    loadData();
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

  function handleDepartmentChange(departmentId) {
    const selectedDepartment = departments.find(
      (department) => department.id === departmentId
    );

    setForm((current) => ({
      ...current,
      departmentId: selectedDepartment?.id || "",
      departmentName: selectedDepartment?.name || "",
      responsibleDepartmentId: selectedDepartment?.id || "",
      responsibleDepartmentName: selectedDepartment?.name || "",
      responsibleArea: selectedDepartment?.name || "",
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
      departmentId: "",
      departmentName: "",
      responsibleDepartmentId: "",
      responsibleDepartmentName: "",
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
      label: "Departamento responsable",
      complete: Boolean(form.departmentId && form.departmentName),
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

        departmentId: form.departmentId,
        departmentName: form.departmentName,
        responsibleDepartmentId: form.responsibleDepartmentId || form.departmentId,
        responsibleDepartmentName:
          form.responsibleDepartmentName || form.departmentName,
        responsibleArea: form.departmentName || form.responsibleArea,

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
    <div className="visual-page create-project-redesign">
      <form onSubmit={handleSubmit} className="create-project-form-shell">
        <section className="module-topbar create-project-module-topbar">
          <div className="module-topbar-main">
            <span className="module-topbar-module-icon">
              <SvgIcon name="projectPlus" />
            </span>

            <div className="module-topbar-copy">
              <p className="section-kicker module-topbar-kicker">Gestión de proyectos</p>
              <h1>Alta de proyecto</h1>
              <p>
                Registra una nueva solicitud o proyecto interno de forma clara,
                ordenada y lista para seguimiento.
              </p>
            </div>
          </div>

          <div className="create-project-topbar-actions">
            <button
              type="button"
              className="create-project-header-button secondary"
              onClick={resetForm}
              disabled={saving}
            >
              <SvgIcon name="x" />
              Cancelar
            </button>

            <button
              type="submit"
              className="create-project-header-button primary"
              disabled={saving}
            >
              <SvgIcon name="plus" />
              {saving ? "Creando..." : "Crear proyecto"}
            </button>
          </div>
        </section>

        {message && <div className="message-box">{message}</div>}

        <div className="create-project-layout">
          <main className="create-project-main">
            <section className="visual-card form-section-card">
              <FormSectionHeader
                number="1"
                icon="fileText"
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

                <Field label="Departamento responsable" required>
                  <select
                    id="create-project-department"
                    name="departmentId"
                    value={form.departmentId}
                    onChange={(event) =>
                      handleDepartmentChange(event.target.value)
                    }
                    disabled={loadingUsers}
                  >
                    <option value="">Selecciona un departamento</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
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
                icon="users"
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
                icon="upload"
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
                  <span className="create-project-dropzone-icon">
                    <SvgIcon name="uploadCloud" />
                  </span>
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
              <SectionHeader title="Resumen del proyecto" icon="layout" />

              <div className="project-preview-card">
                <span className="preview-label">VISTA PREVIA</span>

                <h3>{form.title || "Título del proyecto"}</h3>

                <p>
                  {form.description ||
                    "Descripción breve del proyecto aparecerá aquí..."}
                </p>

                <div className="preview-badges">
                  <Badge color="blue">
                    {form.departmentName || form.responsibleArea || "Departamento"}
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
              <SectionHeader title="Campos requeridos" icon="checklist" />

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
              <SectionHeader title="Buenas prácticas" icon="sparkle" />

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

function FormSectionHeader({ number, icon, title, subtitle }) {
  return (
    <div className="form-section-header create-project-section-header">
      <span className="create-project-section-icon">
        <SvgIcon name={icon || "check"} />
      </span>

      <div>
        <small>Paso {number}</small>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function SectionHeader({ title, icon }) {
  return (
    <div className="mini-section-header create-project-mini-header">
      <div>
        {icon && (
          <span className="create-project-mini-icon">
            <SvgIcon name={icon} />
          </span>
        )}
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
      <span className={`tip-icon tip-${color}`}>
        <SvgIcon name="check" />
      </span>

      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="empty-state small create-project-empty-state">
      <div>
        <SvgIcon name="fileText" />
      </div>
      <p>{text}</p>
    </div>
  );
}

function Badge({ color, children }) {
  return <span className={`visual-badge badge-${color}`}>{children}</span>;
}

function SvgIcon({ name }) {
  const commonProps = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  switch (name) {
    case "projectPlus":
      return (
        <svg {...commonProps}>
          <path d="M4.5 6.5h15" />
          <path d="M6.5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
          <path d="M9 12h6" />
          <path d="M12 9v6" />
        </svg>
      );
    case "plus":
      return (
        <svg {...commonProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "x":
      return (
        <svg {...commonProps}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "fileText":
      return (
        <svg {...commonProps}>
          <path d="M7 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20V3.5Z" />
          <path d="M13 3.5V8h4" />
          <path d="M9.5 12h5" />
          <path d="M9.5 15h5" />
        </svg>
      );
    case "users":
      return (
        <svg {...commonProps}>
          <path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20" />
          <circle cx="10" cy="8" r="3" />
          <path d="M20 20v-1.2a3 3 0 0 0-2.2-2.9" />
          <path d="M16.5 5.2a3 3 0 0 1 0 5.6" />
        </svg>
      );
    case "upload":
      return (
        <svg {...commonProps}>
          <path d="M12 16V5" />
          <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
          <path d="M5 18.5h14" />
        </svg>
      );
    case "uploadCloud":
      return (
        <svg {...commonProps}>
          <path d="M17.5 17.5H18a4 4 0 0 0 .7-7.9 6 6 0 0 0-11.2-2.1A4.8 4.8 0 0 0 6 17.5h.5" />
          <path d="M12 18V10" />
          <path d="m8.8 13.2 3.2-3.2 3.2 3.2" />
        </svg>
      );
    case "layout":
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 10h16" />
          <path d="M10 20V10" />
        </svg>
      );
    case "checklist":
      return (
        <svg {...commonProps}>
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="m3.8 6 1 1 2-2" />
          <path d="m3.8 12 1 1 2-2" />
          <path d="m3.8 18 1 1 2-2" />
        </svg>
      );
    case "sparkle":
      return (
        <svg {...commonProps}>
          <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5l-1.8-5.9-5.7-1.8L10.2 9 12 3.5Z" />
          <path d="M19 15.5v4" />
          <path d="M17 17.5h4" />
        </svg>
      );
    case "check":
      return (
        <svg {...commonProps}>
          <path d="m5 12.5 4.2 4.2L19 7" />
        </svg>
      );
    default:
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      );
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

function getFileIcon(fileName = "") {
  const lowerName = fileName.toLowerCase();

  if (lowerName.endsWith(".pdf")) return "PDF";
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) return "XLS";
  if (lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "DOC";
  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) return "PPT";

  return "FILE";
}