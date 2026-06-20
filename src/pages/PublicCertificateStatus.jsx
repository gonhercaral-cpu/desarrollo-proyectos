import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useParams } from "react-router-dom";
import { db } from "../services/firebase";
import { suggestNameCorrection } from "../utils/nameCorrectionUtils";

const CAMPUS_OPTIONS = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Online"
];

const STUDENT_DELIVERY_TYPES = ["Impreso", "Digital"];

const STATUS_STEPS = [
  { key: "Solicitud recibida", label: "Solicitud recibida", icon: "✓" },
  { key: "En revisión", label: "En revisión", icon: "⌕" },
  { key: "En producción", label: "En producción", icon: "▣" },
  { key: "Lista para entrega", label: "Listos para entregar", icon: "□" },
  { key: "Entregada", label: "Entregados", icon: "↗" }
];

const STATUS_INDEX = {
  "Solicitud recibida": 0,
  "Datos incompletos": 0,
  "En revisión": 1,
  "Aprobada": 1,
  "En producción": 2,
  "En revisión de calidad": 2,
  "Lista para entrega": 3,
  "Entregada": 4,
  "Cancelada": 0
};

const PUBLIC_EDITABLE_STATUSES = [
  "Solicitud recibida",
  "Datos incompletos",
  "En revisión",
  "Aprobada"
];

function createStudentId() {
  return `student-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function formatDate(value) {
  if (!value) return "Sin fecha";

  if (value?.toDate) {
    return value.toDate().toLocaleString("es-MX", {
      dateStyle: "medium",
      timeStyle: "short"
    });
  }

  return value;
}

function getStudentName(student) {
  return student?.name || student?.fullName || "Alumno sin nombre";
}

function inferLevelFromCourse(value = "") {
  const match = String(value).toUpperCase().match(/\b(A1|A2|B1|B2|C1)\b/);
  return match?.[1] || "No aplica";
}

function parseBulkNames(value = "", deliveryType = "Impreso") {
  return value
    .split(/\n|,|;/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      id: createStudentId(),
      name,
      deliveryType,
      status: "Pendiente",
      certificateFolio: "",
      validationCode: "",
      validationUrl: "",
      qrDataUrl: "",
      qrGenerated: false,
      notes: ""
    }));
}

function getDeliverySummary(students = []) {
  const printedQuantity = students.filter(
    (student) => student.deliveryType === "Impreso"
  ).length;

  const digitalQuantity = students.filter(
    (student) => student.deliveryType === "Digital"
  ).length;

  let deliveryType = "Impresa";

  if (printedQuantity > 0 && digitalQuantity > 0) {
    deliveryType = "Ambas";
  } else if (digitalQuantity > 0) {
    deliveryType = "Digital";
  }

  return {
    printedQuantity,
    digitalQuantity,
    deliveryType
  };
}

function normalizeEditableStudents(students = []) {
  return students
    .map((student) => ({
      id: student?.id || createStudentId(),
      name: String(student?.name || student?.fullName || "").trim(),
      deliveryType: STUDENT_DELIVERY_TYPES.includes(student?.deliveryType)
        ? student.deliveryType
        : "Impreso",
      status: student?.status || "Pendiente",
      certificateFolio: student?.certificateFolio || "",
      validationCode: student?.validationCode || "",
      validationUrl: student?.validationUrl || "",
      qrDataUrl: student?.qrDataUrl || "",
      qrGenerated: student?.qrGenerated === true,
      notes: student?.notes || ""
    }))
    .filter((student) => student.name);
}

export default function PublicCertificateStatus() {
  const { requestId } = useParams();

  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState("");
  const [editMessage, setEditMessage] = useState("");
  const [editing, setEditing] = useState(false);

  const [editCampus, setEditCampus] = useState("");
  const [editRequesterName, setEditRequesterName] = useState("");
  const [editCertificateDirectorName, setEditCertificateDirectorName] = useState("");
  const [editRequestedDeliveryDate, setEditRequestedDeliveryDate] = useState("");
  const [editCourseLevel, setEditCourseLevel] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStudents, setEditStudents] = useState([]);
  const [editBulkNames, setEditBulkNames] = useState("");
  const [editDefaultDeliveryType, setEditDefaultDeliveryType] = useState("Impreso");

  const currentStepIndex = useMemo(() => {
    if (!request?.status) return 0;
    return STATUS_INDEX[request.status] ?? 0;
  }, [request]);

  const canPublicEdit = useMemo(() => {
    return (
      request?.publicTrackingEnabled === true &&
      request?.publicRequestSource === "certificate-public-form" &&
      PUBLIC_EDITABLE_STATUSES.includes(request?.status)
    );
  }, [request]);

  const editDeliverySummary = useMemo(() => {
    return getDeliverySummary(editStudents);
  }, [editStudents]);

  async function loadRequest() {
    try {
      setLoading(true);
      setError("");

      const ref = doc(db, "printRequests", requestId);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        setError("No encontramos una solicitud con este enlace.");
        setRequest(null);
        return;
      }

      const data = snap.data();

      if (data.publicTrackingEnabled !== true) {
        setError("Esta solicitud no tiene seguimiento público habilitado.");
        setRequest(null);
        return;
      }

      setRequest({ id: snap.id, ...data });
    } catch (err) {
      console.error("No se pudo cargar la solicitud:", err);
      setError(
        "No se pudo cargar el seguimiento. Revisa el enlace o intenta más tarde."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (requestId) {
      loadRequest();
    }
  }, [requestId]);

  function startEdit() {
    if (!request || !canPublicEdit) return;

    setEditMessage("");
    setEditCampus(request.campus || "");
    setEditRequesterName(request.requesterName || "");
    setEditCertificateDirectorName(
      request.certificateDirectorName ||
      request.academicDirector ||
      request.principalSignerName ||
      ""
    );
    setEditRequestedDeliveryDate(
      request.requestedDeliveryDate || request.dueDate || ""
    );
    setEditCourseLevel(request.courseLevel || request.group || request.level || "");
    setEditNotes(request.notes || "");
    setEditStudents(normalizeEditableStudents(request.students || []));
    setEditDefaultDeliveryType("Impreso");
    setEditBulkNames("");
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setEditMessage("");
  }

  function updateEditStudent(index, field, value) {
    setEditStudents((current) =>
      current.map((student, currentIndex) =>
        currentIndex === index ? { ...student, [field]: value } : student
      )
    );
  }

  function addEditStudent() {
    setEditStudents((current) => [
      ...current,
      {
        id: createStudentId(),
        name: "",
        deliveryType: editDefaultDeliveryType,
        status: "Pendiente",
        certificateFolio: "",
        validationCode: "",
        validationUrl: "",
        qrDataUrl: "",
        qrGenerated: false,
        notes: ""
      }
    ]);
  }

  function removeEditStudent(index) {
    setEditStudents((current) => {
      if (current.length === 1) return current;
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  function applyEditDeliveryTypeToAll() {
    setEditStudents((current) =>
      current.map((student) => ({
        ...student,
        deliveryType: editDefaultDeliveryType
      }))
    );
  }

  function loadEditBulkNames() {
    const parsedNames = parseBulkNames(editBulkNames, editDefaultDeliveryType);

    if (parsedNames.length === 0) {
      setEditMessage("Pega al menos un nombre para cargar la lista.");
      return;
    }

    setEditStudents((current) => [...current, ...parsedNames]);
    setEditBulkNames("");
    setEditMessage("");
  }

  function applyNameSuggestion(index) {
    const student = editStudents[index];
    const suggestion = suggestNameCorrection(student?.name || "");

    if (!suggestion.hasSuggestion) return;

    updateEditStudent(index, "name", suggestion.suggested);
  }

  async function savePublicEdit() {
    setEditMessage("");

    if (!request || !canPublicEdit) {
      setEditMessage("Esta solicitud ya no puede editarse porque Imprenta comenzó el proceso.");
      return;
    }

    const cleanRequesterName = editRequesterName.trim();
    const cleanCertificateDirectorName = editCertificateDirectorName.trim();
    const cleanCourseLevel = editCourseLevel.trim();

    const preparedStudents = normalizeEditableStudents(editStudents);

    if (!editCampus || !cleanRequesterName || !cleanCertificateDirectorName || !cleanCourseLevel) {
      setEditMessage(
        "Completa plantel, nombre del solicitante, director para certificados y nivel, curso o grupo."
      );
      return;
    }

    if (preparedStudents.length === 0) {
      setEditMessage("La solicitud debe tener al menos un alumno.");
      return;
    }

    try {
      setSavingEdit(true);

      const requestedQuantity = preparedStudents.length;
      const { printedQuantity, digitalQuantity, deliveryType } =
        getDeliverySummary(preparedStudents);

      const payload = {
        requesterName: cleanRequesterName,
        campus: editCampus,
        dueDate: editRequestedDeliveryDate || "",
        requestedDeliveryDate: editRequestedDeliveryDate || "",
        notes: editNotes.trim(),

        requestedQuantity,
        printedQuantity,
        digitalQuantity,
        deliveryType,
        students: preparedStudents,

        level: inferLevelFromCourse(cleanCourseLevel),
        group: cleanCourseLevel,
        courseLevel: cleanCourseLevel,

        academicDirector: cleanCertificateDirectorName,
        certificateDirectorName: cleanCertificateDirectorName,
        principalSignerName: cleanCertificateDirectorName,
        principalSignerRole: "Director",

        updatedAt: serverTimestamp(),
        updatedByUid: "public-form",
        updatedByName: cleanRequesterName,
        updatedByEmail: ""
      };

      await updateDoc(doc(db, "printRequests", request.id), payload);

      setEditing(false);
      setEditMessage("Solicitud actualizada correctamente.");
      await loadRequest();
    } catch (err) {
      console.error("No se pudo actualizar la solicitud:", err);
      setEditMessage(
        "No se pudo actualizar la solicitud. Es posible que Imprenta ya haya iniciado producción o que falten permisos en Firestore."
      );
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) {
    return (
      <main className="public-page">
        <section className="public-card">
          <h1>Cargando seguimiento...</h1>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="public-page">
        <section className="public-card">
          <h1>Seguimiento no disponible</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  const isCancelled = request.status === "Cancelada";
  const safeProgressIndex = isCancelled ? 0 : currentStepIndex;
  const progressWidth = `${(safeProgressIndex / (STATUS_STEPS.length - 1)) * 100}%`;

  function getStepState(index) {
    if (isCancelled) return index === 0 ? "cancelled" : "pending";
    if (index < currentStepIndex) return "completed";
    if (index === currentStepIndex) return "current";
    if (index === currentStepIndex + 1) return "next";
    return "pending";
  }

  return (
    <main className="certificate-public-page tracking-page">
      <header className="tracking-topbar">
        <div className="tracking-brand">
          <img
            src="/active-logo.png"
            alt="Active for Life"
            className="tracking-brand-logo"
          />
        </div>
      </header>

      <section className="tracking-hero">
        <div>
          <p className="tracking-eyebrow">Seguimiento público</p>
          <h1>Seguimiento de solicitud de certificados</h1>
          <p>
            Consulta el estatus, los detalles y la lista de alumnos incluidos en
            tu solicitud.
          </p>
        </div>

        <div className="tracking-hero-art" aria-hidden="true">
          <span className="cap-line" />
          <span className="diploma-line" />
          <span className="building-line" />
        </div>
      </section>

      <section className="tracking-main-card">
        {editMessage && <div className="form-error">{editMessage}</div>}

        <div className="tracking-progress-card">
          <div className="tracking-progress-line">
            <span style={{ width: progressWidth }} />
          </div>

          <div className="tracking-progress-grid">
            {STATUS_STEPS.map((step, index) => {
              const state = getStepState(index);
              const isCurrent = state === "current";

              return (
                <div
                  key={step.key}
                  className={`tracking-step tracking-step-${state}`}
                >
                  <div className="tracking-step-icon">
                    <span>{step.icon}</span>
                  </div>

                  <div className="tracking-step-copy">
                    <strong>{step.label}</strong>
                    <small>
                      {isCurrent
                        ? "Estatus actual"
                        : index < currentStepIndex && !isCancelled
                          ? "Completado"
                          : "Pendiente"}
                    </small>
                  </div>

                  {isCurrent && (
                    <span className="tracking-current-pill">
                      Estatus actual
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {isCancelled && (
          <div className="tracking-warning-card">
            Esta solicitud fue cancelada por Imprenta.
          </div>
        )}

        {!editing && (
          <>
            <div className="tracking-content-layout">
              <section className="tracking-info-panel">
                <div className="tracking-panel-title">
                  <span>▤</span>
                  <div>
                    <h2>Detalles de la solicitud</h2>
                    <p>{request.folio || "Solicitud de certificados"}</p>
                  </div>
                </div>

                <div className="tracking-info-grid">
                  <div className="tracking-info-card">
                    <span>Folio</span>
                    <strong>{request.folio || "No especificado"}</strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Plantel</span>
                    <strong>{request.campus || "No especificado"}</strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Solicitante</span>
                    <strong>{request.requesterName || "No especificado"}</strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Director en certificados</span>
                    <strong>
                      {request.certificateDirectorName ||
                        request.academicDirector ||
                        request.principalSignerName ||
                        "No especificado"}
                    </strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Tipo de documento</span>
                    <strong>{request.requestType || "Certificado"}</strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Nivel / grupo</span>
                    <strong>
                      {request.courseLevel ||
                        request.group ||
                        request.level ||
                        "No especificado"}
                    </strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Fecha deseada de entrega</span>
                    <strong>
                      {request.requestedDeliveryDate ||
                        request.dueDate ||
                        "No especificada"}
                    </strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Entrega</span>
                    <strong>
                      {request.printedQuantity || 0} impresos ·{" "}
                      {request.digitalQuantity || 0} digitales
                    </strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Fecha de solicitud</span>
                    <strong>{formatDate(request.createdAt)}</strong>
                  </div>
                </div>

                {request.notes && (
                  <div className="tracking-note-card">
                    <span>Observaciones</span>
                    <strong>{request.notes}</strong>
                  </div>
                )}
              </section>

              <aside className="tracking-students-panel">
                <div className="tracking-panel-title compact">
                  <span>☷</span>
                  <div>
                    <h2>Alumnos incluidos</h2>
                    <p>{(request.students || []).length} registros</p>
                  </div>
                </div>

                <div className="tracking-student-list">
                  {(request.students || []).map((student, index) => (
                    <div
                      className="tracking-student-item"
                      key={student.id || `student-${index}`}
                    >
                      <div>
                        <strong>{getStudentName(student)}</strong>
                        {student.notes && <p>{student.notes}</p>}
                      </div>

                      <span
                        className={`delivery-badge ${
                          student.deliveryType === "Digital"
                            ? "digital"
                            : "printed"
                        }`}
                      >
                        {student.deliveryType === "Digital" ? "Digital" : "Impreso"}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="tracking-students-footer">
                  <span>Total: {(request.students || []).length} alumnos</span>
                  <strong>
                    {request.printedQuantity || 0} impresos ·{" "}
                    {request.digitalQuantity || 0} digitales
                  </strong>
                </div>
              </aside>
            </div>

            <div className="tracking-bottom-banner">
              <div className="tracking-info-dot">i</div>
              <div>
                <strong>Importante</strong>
                <p>
                  Los tiempos mostrados son estimados. El estatus se actualizará
                  cuando Imprenta avance la solicitud.
                </p>
              </div>
            </div>

            <div className="form-actions tracking-actions">
              {canPublicEdit ? (
                <button type="button" onClick={startEdit}>
                  Editar solicitud
                </button>
              ) : (
                <button type="button" className="secondary-button" disabled>
                  Edición bloqueada por estatus
                </button>
              )}
            </div>
          </>
        )}

        {editing && (
          <section className="tracking-edit-panel">
            <div className="tracking-panel-title">
              <span>✎</span>
              <div>
                <h2>Editar solicitud</h2>
                <p>
                  Puedes editar esta solicitud mientras Imprenta no haya
                  iniciado la producción.
                </p>
              </div>
            </div>

            <div className="form-grid">
              <label>
                Plantel
                <select value={editCampus} onChange={(e) => setEditCampus(e.target.value)}>
                  <option value="">Seleccionar plantel</option>
                  {CAMPUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Nombre del solicitante
                <input
                  value={editRequesterName}
                  onChange={(e) => setEditRequesterName(e.target.value)}
                />
              </label>

              <label>
                Director que aparecerá en los certificados
                <input
                  value={editCertificateDirectorName}
                  onChange={(e) => setEditCertificateDirectorName(e.target.value)}
                />
              </label>

              <label>
                Fecha deseada de entrega
                <input
                  type="date"
                  value={editRequestedDeliveryDate}
                  onChange={(e) => setEditRequestedDeliveryDate(e.target.value)}
                />
              </label>

              <label>
                Nivel, curso o grupo
                <input
                  value={editCourseLevel}
                  onChange={(e) => setEditCourseLevel(e.target.value)}
                />
              </label>

              <label>
                Tipo de entrega por defecto
                <select
                  value={editDefaultDeliveryType}
                  onChange={(e) => setEditDefaultDeliveryType(e.target.value)}
                >
                  <option value="Impreso">Impreso</option>
                  <option value="Digital">Digital</option>
                </select>
              </label>
            </div>

            <label className="full-field">
              Observaciones generales
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
              />
            </label>

            <div className="tracking-delivery-summary">
              <div>
                <span>Resumen de entrega</span>
                <strong>
                  {editDeliverySummary.printedQuantity} impresos ·{" "}
                  {editDeliverySummary.digitalQuantity} digitales
                </strong>
              </div>

              <button type="button" onClick={applyEditDeliveryTypeToAll}>
                Aplicar entrega a todos
              </button>
            </div>

            <div className="tracking-subpanel">
              <h3>Agregar varios alumnos</h3>

              <label className="full-field">
                Lista de alumnos
                <textarea
                  value={editBulkNames}
                  onChange={(e) => setEditBulkNames(e.target.value)}
                  rows={5}
                  placeholder={`Ejemplo:
Jose Hernandez
Maria Gonzalez`}
                />
              </label>

              <div className="form-actions">
                <button type="button" onClick={loadEditBulkNames}>
                  Cargar nombres
                </button>
              </div>
            </div>

            <div className="section-title-row tracking-students-title">
              <h2>Alumnos</h2>
              <button type="button" onClick={addEditStudent}>
                Agregar alumno
              </button>
            </div>

            <div className="students-list">
              {editStudents.map((student, index) => {
                const suggestion = suggestNameCorrection(student.name || "");

                return (
                  <div
                    className="student-row public-student-row"
                    key={student.id || `edit-student-${index}`}
                  >
                    <label>
                      Nombre completo
                      <input
                        value={student.name}
                        onChange={(e) =>
                          updateEditStudent(index, "name", e.target.value)
                        }
                      />

                      {suggestion.hasSuggestion && (
                        <button
                          type="button"
                          className="inline-suggestion-button"
                          onClick={() => applyNameSuggestion(index)}
                        >
                          Sugerir: {suggestion.suggested}
                        </button>
                      )}
                    </label>

                    <label>
                      Entrega
                      <select
                        value={student.deliveryType}
                        onChange={(e) =>
                          updateEditStudent(index, "deliveryType", e.target.value)
                        }
                      >
                        <option value="Impreso">Impreso</option>
                        <option value="Digital">Digital</option>
                      </select>
                    </label>

                    <label>
                      Observaciones
                      <input
                        value={student.notes || ""}
                        onChange={(e) =>
                          updateEditStudent(index, "notes", e.target.value)
                        }
                        placeholder="Opcional"
                      />
                    </label>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => removeEditStudent(index)}
                      disabled={editStudents.length === 1}
                    >
                      Quitar
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={cancelEdit}
                disabled={savingEdit}
              >
                Cancelar edición
              </button>

              <button type="button" onClick={savePublicEdit} disabled={savingEdit}>
                {savingEdit ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

