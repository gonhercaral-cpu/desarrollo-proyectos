import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
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

const CERTIFICATE_LEVEL_OPTIONS = [
  { value: "A1 Journey", level: "A1", programName: "Journey", audience: "Adultos", productName: "Certificado A1 Journey" },
  { value: "A2 Explore", level: "A2", programName: "Explore", audience: "Adultos", productName: "Certificado A2 Explore" },
  { value: "B1 Discovery", level: "B1", programName: "Discovery", audience: "Adultos", productName: "Certificado B1 Discovery" },
  { value: "B2", level: "B2", programName: "B2", audience: "Adultos", productName: "Certificado B2" },
  { value: "C1 New Horizons", level: "C1", programName: "New Horizons", audience: "Adultos", productName: "Certificado C1 New Horizons" },
  { value: "Smile 1", level: "Smile 1", programName: "Smile 1", audience: "Kids", productName: "Certificado Smile 1" },
  { value: "Smile 2", level: "Smile 2", programName: "Smile 2", audience: "Kids", productName: "Certificado Smile 2" },
  { value: "Smile 3", level: "Smile 3", programName: "Smile 3", audience: "Kids", productName: "Certificado Smile 3" },
  { value: "Smile 4", level: "Smile 4", programName: "Smile 4", audience: "Kids", productName: "Certificado Smile 4" },
  { value: "Smile 5", level: "Smile 5", programName: "Smile 5", audience: "Kids", productName: "Certificado Smile 5" },
  { value: "Mega Flash", level: "Mega Flash", programName: "Mega Flash", audience: "Kids", productName: "Certificado Mega Flash" }
];

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

function getDateValueMs(value) {
  if (!value) return 0;
  if (value?.toDate) return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getEffectivePublicRequestStatus(request) {
  if (!request) return "Solicitud recibida";

  const status = request.status || "Solicitud recibida";
  const readyAtMs = getDateValueMs(request.readyForDeliveryAt);

  if (status === "En producción" && readyAtMs > 0 && readyAtMs <= Date.now()) {
    return "Lista para entrega";
  }

  return status;
}

function getStudentName(student) {
  return student?.name || student?.fullName || "Alumno sin nombre";
}

function getCertificateLevelOption(value = "") {
  const cleanValue = String(value || "").trim();

  return CERTIFICATE_LEVEL_OPTIONS.find(
    (option) => option.value.toLowerCase() === cleanValue.toLowerCase()
  ) || null;
}

function normalizePublicComparable(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function normalizePublicSigner(signer) {
  return {
    id: signer?.id || "",
    name: String(signer?.name || "").trim(),
    role: String(signer?.role || "").trim(),
    type: signer?.type === "Principal" ? "Principal" : "Teacher",
    active: signer?.active !== false,
    deleted: signer?.deleted === true,
    signatureUrl: String(signer?.signatureUrl || ""),
    signatureDataUrl: String(signer?.signatureDataUrl || "")
  };
}

function getUniqueSignerNames(signers = []) {
  const seen = new Set();

  return signers
    .map((signer) => signer.name)
    .filter(Boolean)
    .filter((name) => {
      const key = normalizePublicComparable(name);

      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function findPublicSignerByName(signers = [], name = "") {
  const normalizedName = normalizePublicComparable(name);

  if (!normalizedName) return null;

  return (signers || []).find((signer) => normalizePublicComparable(signer.name) === normalizedName) || null;
}


function inferLevelFromCourse(value = "") {
  const selectedOption = getCertificateLevelOption(value);

  if (selectedOption?.level) return selectedOption.level;

  const match = String(value).toUpperCase().match(/\b(A1|A2|B1|B2|C1)\b/);
  return match?.[1] || String(value || "").trim() || "No aplica";
}

function buildCertificateProductName(value = "") {
  const selectedOption = getCertificateLevelOption(value);

  if (selectedOption?.productName) return selectedOption.productName;

  const cleanValue = String(value || "").trim();
  return cleanValue ? `Certificado ${cleanValue}` : "Certificado";
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
  const [editTeacherName, setEditTeacherName] = useState("");
  const [editSchedule, setEditSchedule] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStudents, setEditStudents] = useState([]);
  const [editBulkNames, setEditBulkNames] = useState("");
  const [editDefaultDeliveryType, setEditDefaultDeliveryType] = useState("Impreso");
  const [certificateSigners, setCertificateSigners] = useState([]);

  useEffect(() => {
    let active = true;

    async function loadCertificateSigners() {
      try {
        const snapshot = await getDocs(collection(db, "certificateSigners"));
        const nextSigners = snapshot.docs
          .map((signerDoc) => normalizePublicSigner({ id: signerDoc.id, ...signerDoc.data() }))
          .filter((signer) => signer.active && !signer.deleted && signer.name);

        if (active) {
          setCertificateSigners(nextSigners);
        }
      } catch (err) {
        console.warn("No se pudieron cargar las firmas públicas:", err);
        if (active) {
          setCertificateSigners([]);
        }
      }
    }

    loadCertificateSigners();

    return () => {
      active = false;
    };
  }, []);

  const activePrincipalSigners = useMemo(
    () => certificateSigners.filter((signer) => signer.type === "Principal"),
    [certificateSigners]
  );

  const activeTeacherSigners = useMemo(
    () => certificateSigners.filter((signer) => signer.type === "Teacher"),
    [certificateSigners]
  );

  const effectiveRequestStatus = useMemo(
    () => getEffectivePublicRequestStatus(request),
    [request]
  );

  const currentStepIndex = useMemo(() => {
    return STATUS_INDEX[effectiveRequestStatus] ?? 0;
  }, [effectiveRequestStatus]);

  const canPublicEdit = useMemo(() => {
    return (
      request?.publicTrackingEnabled === true &&
      request?.publicRequestSource === "certificate-public-form" &&
      PUBLIC_EDITABLE_STATUSES.includes(effectiveRequestStatus)
    );
  }, [request, effectiveRequestStatus]);

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
    setEditTeacherName(request.teacherName || request.teacherSignerName || "");
    setEditSchedule(request.schedule || "");
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

    const cleanTeacherName = editTeacherName.trim();
    const cleanSchedule = editSchedule.trim();
    const selectedCourseOption = getCertificateLevelOption(cleanCourseLevel);
    const matchedPrincipalSigner = findPublicSignerByName(activePrincipalSigners, cleanCertificateDirectorName);
    const matchedTeacherSigner = findPublicSignerByName(activeTeacherSigners, cleanTeacherName);

    if (!editCampus || !cleanRequesterName || !cleanCertificateDirectorName || !cleanCourseLevel || !cleanTeacherName || !cleanSchedule) {
      setEditMessage(
        "Completa plantel, solicitante, director, nivel, maestro y horario."
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

        productName: buildCertificateProductName(cleanCourseLevel),
        requestedQuantity,
        printedQuantity,
        digitalQuantity,
        deliveryType,
        students: preparedStudents,

        level: inferLevelFromCourse(cleanCourseLevel),
        group: cleanCourseLevel,
        courseLevel: cleanCourseLevel,
        courseProgramName: selectedCourseOption?.programName || cleanCourseLevel,
        courseAudience: selectedCourseOption?.audience || "Adultos",
        certificateTemplateLevel: inferLevelFromCourse(cleanCourseLevel),
        certificateTemplateProgramName: selectedCourseOption?.programName || cleanCourseLevel,
        certificateTemplateAudience: selectedCourseOption?.audience || "Adultos",
        teacherName: cleanTeacherName,
        schedule: cleanSchedule,
        teacherSignerId: matchedTeacherSigner?.id || "",
        teacherSignerName: matchedTeacherSigner?.name || cleanTeacherName,
        teacherSignerRole: matchedTeacherSigner?.role || "Teacher",
        teacherSignatureUrl: matchedTeacherSigner?.signatureUrl || "",
        teacherSignatureDataUrl: matchedTeacherSigner?.signatureDataUrl || "",

        academicDirector: cleanCertificateDirectorName,
        certificateDirectorName: cleanCertificateDirectorName,
        principalSignerId: matchedPrincipalSigner?.id || "",
        principalSignerName: matchedPrincipalSigner?.name || cleanCertificateDirectorName,
        principalSignerRole: matchedPrincipalSigner?.role || "Director",
        principalSignatureUrl: matchedPrincipalSigner?.signatureUrl || "",
        principalSignatureDataUrl: matchedPrincipalSigner?.signatureDataUrl || "",

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
            <h1>Cargando seguimiento...</h1>
            <p>Estamos consultando la información de la solicitud.</p>
          </div>
        </section>
      </main>
    );
  }

  if (error) {
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
            <h1>Seguimiento no disponible</h1>
            <p>{error}</p>
          </div>
        </section>
        <section className="tracking-main-card">
          <div className="tracking-warning-card">{error}</div>
        </section>
      </main>
    );
  }

  const isCancelled = effectiveRequestStatus === "Cancelada";
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
                    <span>Maestro</span>
                    <strong>{request.teacherName || request.teacherSignerName || "No especificado"}</strong>
                  </div>

                  <div className="tracking-info-card">
                    <span>Horario</span>
                    <strong>{request.schedule || "No especificado"}</strong>
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

            <datalist id="status-principal-signer-options">
              {activePrincipalSigners.map((signer) => (
                <option key={signer.id || signer.name} value={signer.name} />
              ))}
            </datalist>

            <datalist id="status-teacher-signer-options">
              {activeTeacherSigners.map((signer) => (
                <option key={signer.id || signer.name} value={signer.name} />
              ))}
            </datalist>

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
                <select
                  value={editRequesterName}
                  onChange={(e) => setEditRequesterName(e.target.value)}
                >
                  <option value="">Seleccionar solicitante</option>
                  {activePrincipalSigners.map((signer) => (
                    <option key={signer.id || signer.name} value={signer.name}>
                      {signer.name} {signer.role ? `- ${signer.role}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Director que aparecerá en los certificados
                <select
                  value={editCertificateDirectorName}
                  onChange={(e) => setEditCertificateDirectorName(e.target.value)}
                >
                  <option value="">Seleccionar director</option>
                  {activePrincipalSigners.map((signer) => (
                    <option key={signer.id || signer.name} value={signer.name}>
                      {signer.name} {signer.role ? `- ${signer.role}` : ""}
                    </option>
                  ))}
                </select>
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
                <select
                  value={editCourseLevel}
                  onChange={(e) => setEditCourseLevel(e.target.value)}
                >
                  <option value="">Seleccionar nivel</option>
                  {CERTIFICATE_LEVEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.value}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Nombre del maestro
                <select
                  value={editTeacherName}
                  onChange={(e) => setEditTeacherName(e.target.value)}
                >
                  <option value="">Seleccionar maestro</option>
                  {activeTeacherSigners.map((signer) => (
                    <option key={signer.id || signer.name} value={signer.name}>
                      {signer.name} {signer.role ? `- ${signer.role}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Horario
                <input
                  value={editSchedule}
                  onChange={(e) => setEditSchedule(e.target.value)}
                  placeholder="Ej. Lunes y miércoles 6:00 p.m."
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
