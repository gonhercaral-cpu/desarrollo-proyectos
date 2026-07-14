import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, query, serverTimestamp, where } from "firebase/firestore";
import { db } from "../services/firebase";
import {
  findPublicCertificatePerson,
  loadPublicCertificatePeople,
} from "../services/publicCertificatePeopleService";
import {
  acceptStudentSuggestion,
  keepStudentOriginal,
  prepareStudentNameReview
} from "../utils/nameCorrectionUtils";
import { findStrictMatchingCertificateTemplates } from "../utils/certificateTemplateMatching";

const CAMPUS_OPTIONS = [
  "Plaza Estrella",
  "Plaza Bugambilias",
  "Plaza Aranjuez",
  "Online"
];

const CERTIFICATE_TYPE = "Certificado";
const PUBLIC_REQUESTER_AREA = "Dirección Académica";
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

function createFolio() {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `CERT-${year}-${random}`;
}

function createStudentId() {
  return `student-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getTodayInputDate() {
  return new Date().toISOString().slice(0, 10);
}

function calculatePublicRequestPriority(requestDate, dueDate) {
  if (!dueDate) return "Normal";

  const startDate = requestDate ? new Date(`${requestDate}T00:00:00`) : new Date();
  const endDate = new Date(`${dueDate}T00:00:00`);

  if (Number.isNaN(endDate.getTime())) return "Normal";

  const safeStartDate = Number.isNaN(startDate.getTime()) ? new Date() : startDate;
  const dayMs = 24 * 60 * 60 * 1000;
  const daysToDeliver = Math.ceil((endDate.getTime() - safeStartDate.getTime()) / dayMs);

  if (daysToDeliver <= 3) return "Urgente";
  if (daysToDeliver <= 7) return "Alta";
  return "Normal";
}

function getCertificateLevelOption(value = "") {
  const cleanValue = String(value || "").trim();

  return CERTIFICATE_LEVEL_OPTIONS.find(
    (option) => option.value.toLowerCase() === cleanValue.toLowerCase()
  ) || null;
}

function normalizePublicCertificateTemplate(template) {
  return {
    id: template?.id || "",
    name: String(template?.name || "").trim(),
    level: String(template?.level || "No aplica"),
    programName: String(template?.programName || "").trim(),
    audience: template?.audience === "Kids" || template?.audience === "Otro" ? template.audience : "Adultos",
    certificateType: template?.certificateType === "Diploma" ? "Diploma" : "Certificado",
    active: template?.active !== false,
  };
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

  if (!cleanValue) return CERTIFICATE_TYPE;

  if (/certificado|diploma/i.test(cleanValue)) {
    return cleanValue;
  }

  return `${CERTIFICATE_TYPE} ${cleanValue}`;
}

function parseBulkNames(value = "", deliveryType = "Impreso") {
  return value
    .split(/\n|,|;/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({
      fullName: name,
      deliveryType,
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

export default function PublicCertificateRequest() {
  const [campus, setCampus] = useState("");
  const [requesterId, setRequesterId] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [principalSignerId, setPrincipalSignerId] = useState("");
  const [certificateDirectorName, setCertificateDirectorName] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [courseLevel, setCourseLevel] = useState("");
  const [teacherSignerId, setTeacherSignerId] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [notes, setNotes] = useState("");
  const [certificatePeople, setCertificatePeople] = useState([]);
  const [loadingCertificatePeople, setLoadingCertificatePeople] = useState(true);
  const [certificatePeopleError, setCertificatePeopleError] = useState("");
  const [certificateTemplates, setCertificateTemplates] = useState([]);

  const [defaultStudentDeliveryType, setDefaultStudentDeliveryType] = useState("Impreso");
  const [bulkNames, setBulkNames] = useState("");
  const [students, setStudents] = useState([
    { fullName: "", deliveryType: "Impreso", notes: "" }
  ]);
  const [reviewStudents, setReviewStudents] = useState([]);

  const [trackingId, setTrackingId] = useState("");
  const [trackingFolio, setTrackingFolio] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const trackingUrl = useMemo(() => {
    if (!trackingId) return "";
    return `${window.location.origin}/certificados/seguimiento/${trackingId}`;
  }, [trackingId]);

  useEffect(() => {
    let active = true;

    async function loadPeople() {
      try {
        const nextPeople = await loadPublicCertificatePeople();

        if (active) {
          setCertificatePeople(nextPeople);
          setCertificatePeopleError("");
        }
      } catch (err) {
        console.warn("No se pudieron cargar las personas públicas de certificados:", err);
        if (active) {
          setCertificatePeople([]);
          setCertificatePeopleError("No se pudieron cargar solicitantes, directores y maestros.");
        }
      } finally {
        if (active) setLoadingCertificatePeople(false);
      }
    }

    loadPeople();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadCertificateTemplates() {
      try {
        const templatesQuery = query(collection(db, "certificateTemplates"), where("active", "==", true));
        const snapshot = await getDocs(templatesQuery);
        const nextTemplates = snapshot.docs.map((templateDoc) =>
          normalizePublicCertificateTemplate({ id: templateDoc.id, ...templateDoc.data() })
        );

        if (active) {
          setCertificateTemplates(nextTemplates);
        }
      } catch (err) {
        console.warn("No se pudieron cargar las plantillas de certificado:", err);
        if (active) {
          setCertificateTemplates([]);
        }
      }
    }

    loadCertificateTemplates();

    return () => {
      active = false;
    };
  }, []);

  const activeRequesters = useMemo(
    () => certificatePeople.filter((person) => person.type === "Principal"),
    [certificatePeople]
  );

  const activePrincipalSigners = useMemo(
    () => certificatePeople.filter((person) => person.type === "Principal"),
    [certificatePeople]
  );

  const activeTeacherSigners = useMemo(
    () => certificatePeople.filter((person) => person.type === "Teacher"),
    [certificatePeople]
  );

  const currentDeliverySummary = useMemo(() => {
    return getDeliverySummary(students.filter((student) => student.fullName.trim()));
  }, [students]);

  function selectCertificatePerson(type, id) {
    const signerType = type === "Requester" ? "Principal" : type;
    const person = certificatePeople.find((item) => item.type === signerType && item.id === id) || null;

    if (type === "Requester") {
      setRequesterId(id);
      setRequesterName(person?.name || "");
    } else if (type === "Principal") {
      setPrincipalSignerId(id);
      setCertificateDirectorName(person?.name || "");
    } else {
      setTeacherSignerId(id);
      setTeacherName(person?.name || "");
    }
  }

  function updateStudent(index, field, value) {
    setStudents((current) =>
      current.map((student, currentIndex) =>
        currentIndex === index
          ? { ...student, [field]: value }
          : student
      )
    );

    setReviewStudents([]);
  }

  function addStudent() {
    setStudents((current) => [
      ...current,
      { fullName: "", deliveryType: defaultStudentDeliveryType, notes: "" }
    ]);

    setReviewStudents([]);
  }

  function removeStudent(index) {
    setStudents((current) => {
      if (current.length === 1) return current;
      return current.filter((_, currentIndex) => currentIndex !== index);
    });

    setReviewStudents([]);
  }

  function applyDeliveryTypeToAll() {
    setStudents((current) =>
      current.map((student) => ({
        ...student,
        deliveryType: defaultStudentDeliveryType
      }))
    );

    setReviewStudents([]);
  }

  function loadBulkNames() {
    setError("");

    const parsedNames = parseBulkNames(bulkNames, defaultStudentDeliveryType);

    if (parsedNames.length === 0) {
      setError("Pega al menos un nombre para cargar la lista.");
      return;
    }

    setStudents((current) => {
      const existingStudents = current.filter((student) => student.fullName.trim());

      if (existingStudents.length === 0) {
        return parsedNames;
      }

      return [...existingStudents, ...parsedNames];
    });

    setBulkNames("");
    setReviewStudents([]);
  }

  function clearStudents() {
    setStudents([{ fullName: "", deliveryType: defaultStudentDeliveryType, notes: "" }]);
    setReviewStudents([]);
  }

  function reviewNames() {
    setError("");

    const validStudents = students
      .map((student) => ({
        fullName: student.fullName.trim(),
        deliveryType: STUDENT_DELIVERY_TYPES.includes(student.deliveryType)
          ? student.deliveryType
          : "Impreso",
        notes: student.notes?.trim() || ""
      }))
      .filter((student) => student.fullName);

    if (!campus || !requesterName || !certificateDirectorName || !courseLevel || !teacherName || !schedule) {
      setError(
        "Completa plantel, solicitante, director, nivel, maestro y horario."
      );
      return;
    }

    if (validStudents.length === 0) {
      setError("Agrega al menos un alumno.");
      return;
    }

    setReviewStudents(prepareStudentNameReview(validStudents));
  }

  function acceptCorrection(index) {
    setReviewStudents((current) =>
      current.map((student, currentIndex) =>
        currentIndex === index ? acceptStudentSuggestion(student) : student
      )
    );
  }

  function keepOriginal(index) {
    setReviewStudents((current) =>
      current.map((student, currentIndex) =>
        currentIndex === index ? keepStudentOriginal(student) : student
      )
    );
  }

  async function submitRequest() {
    setError("");

    if (reviewStudents.length === 0) {
      setError("Primero revisa los nombres antes de enviar la solicitud.");
      return;
    }

    try {
      setSaving(true);

      const folio = createFolio();
      const preparedStudents = reviewStudents.map((student) => ({
        id: createStudentId(),
        name: student.finalName,
        originalName: student.originalName,
        suggestedName: student.hasSuggestion ? student.suggestedName : "",
        correctionAccepted: student.correctionAccepted,
        deliveryType: STUDENT_DELIVERY_TYPES.includes(student.deliveryType)
          ? student.deliveryType
          : "Impreso",
        status: "Pendiente",
        certificateFolio: "",
        validationCode: "",
        validationUrl: "",
        qrDataUrl: "",
        qrGenerated: false,
        notes: student.notes || ""
      }));

      const requestedQuantity = preparedStudents.length;
      const { printedQuantity, digitalQuantity, deliveryType } =
        getDeliverySummary(preparedStudents);
      const cleanCourseLevel = courseLevel.trim();
      const selectedCourseOption = getCertificateLevelOption(cleanCourseLevel);
      const level = inferLevelFromCourse(cleanCourseLevel);
      const publicProductName = buildCertificateProductName(cleanCourseLevel);
      const requestDate = getTodayInputDate();
      const cleanRequesterName = requesterName.trim();
      const cleanCertificateDirectorName = certificateDirectorName.trim();
      const cleanTeacherName = teacherName.trim();
      const cleanSchedule = schedule.trim();
      const matchedRequester = findPublicCertificatePerson(
        certificatePeople,
        "Principal",
        requesterId,
        cleanRequesterName
      );
      const matchedPrincipalSigner = findPublicCertificatePerson(
        certificatePeople,
        "Principal",
        principalSignerId,
        cleanCertificateDirectorName
      );
      const matchedTeacherSigner = findPublicCertificatePerson(
        certificatePeople,
        "Teacher",
        teacherSignerId,
        cleanTeacherName
      );
      const certificateIssueDate = requestedDeliveryDate || requestDate;

      const templateMatchCandidates = findStrictMatchingCertificateTemplates(
        certificateTemplates,
        {
          level,
          certificateTemplateProgramName: selectedCourseOption?.programName || cleanCourseLevel,
          certificateTemplateAudience: selectedCourseOption?.audience || "Adultos",
          requestType: CERTIFICATE_TYPE
        },
        null
      );
      const matchedTemplate = templateMatchCandidates.length === 1 ? templateMatchCandidates[0] : null;

      const docRef = await addDoc(collection(db, "printRequests"), {
        folio,
        productId: "",
        productName: publicProductName,
        requestType: CERTIFICATE_TYPE,

        requesterName: cleanRequesterName,
        requesterId: matchedRequester?.id || "",
        requesterArea: PUBLIC_REQUESTER_AREA,
        campus,

        responsibleUid: "",
        responsibleName: "Tony Campos",
        responsibleEmail: "",
        defaultResponsibleName: "Tony Campos",
        responsibleAutoAssigned: true,

        priority: calculatePublicRequestPriority(requestDate, requestedDeliveryDate),
        requestedQuantity,
        deliveredQuantity: 0,
        deliveryType,
        status: "Solicitud recibida",

        requestDate,
        dueDate: requestedDeliveryDate || "",
        requestedDeliveryDate: requestedDeliveryDate || "",

        certificateIssueDate,
        certificateTemplateId: matchedTemplate?.id || "",
        certificateTemplateName: matchedTemplate?.name || "",
        certificateTemplateLevel: matchedTemplate?.level || level,
        certificateTemplateProgramName: matchedTemplate?.programName || selectedCourseOption?.programName || cleanCourseLevel,
        certificateTemplateAudience: matchedTemplate?.audience || selectedCourseOption?.audience || "Adultos",
        certificateTemplateBodyText: "",
        certificateTemplateBodySegments: [],
        certificateTemplateCustomTexts: [],
        certificateTemplateCustomImages: [],
        certificateTemplateImageUrl: "",
        certificateTemplateImageDataUrl: "",
        certificateTemplateStoragePath: "",
        certificateTemplatePositions: {},

        notes: notes.trim(),
        level,
        group: cleanCourseLevel,
        courseProgramName: selectedCourseOption?.programName || cleanCourseLevel,
        courseAudience: selectedCourseOption?.audience || "Adultos",
        teacherName: cleanTeacherName,
        schedule: cleanSchedule,
        printedQuantity,
        digitalQuantity,

        principalSignerId: matchedPrincipalSigner?.id || "",
        principalSignerName: matchedPrincipalSigner?.name || cleanCertificateDirectorName,
        principalSignerRole: matchedPrincipalSigner?.role || "Director",
        principalSignatureUrl: "",
        principalSignatureDataUrl: "",
        teacherSignerId: matchedTeacherSigner?.id || "",
        teacherSignerName: matchedTeacherSigner?.name || cleanTeacherName,
        teacherSignerRole: matchedTeacherSigner?.role || "Teacher",
        teacherSignatureUrl: "",
        teacherSignatureDataUrl: "",

        students: preparedStudents,

        publicTrackingEnabled: true,
        publicRequestSource: "certificate-public-form",
        academicDirector: cleanCertificateDirectorName,
        certificateDirectorName: cleanCertificateDirectorName,
        courseLevel: cleanCourseLevel,
        statusLabel: "Solicitud recibida",

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: "public-certificate-form",
        createdByUid: "public-form",
        createdByName: cleanRequesterName,
        createdByEmail: "",
        updatedByUid: "public-form",
        updatedByName: cleanRequesterName,
        updatedByEmail: ""
      });

      setTrackingId(docRef.id);
      setTrackingFolio(folio);
    } catch (err) {
      console.error("No se pudo enviar la solicitud de certificados:", err);
      setError(
        "No se pudo enviar la solicitud. Revisa las reglas de Firestore o intenta de nuevo."
      );
    } finally {
      setSaving(false);
    }
  }

  const completedGeneralFields = Boolean(
    campus && requesterName && certificateDirectorName && courseLevel && teacherName && schedule
  );
  const hasStudentNames = students.some((student) => student.fullName.trim());
  const requestProgressIndex =
    reviewStudents.length > 0
      ? 3
      : hasStudentNames
        ? 2
        : completedGeneralFields
          ? 1
          : 0;

  const requestProgressSteps = [
    { label: "Datos generales", icon: "▤" },
    { label: "Tipo de entrega", icon: "◈" },
    { label: "Alumnos", icon: "☷" },
    { label: "Revisión", icon: "✓" }
  ];

  if (trackingId) {
    return (
      <main className="certificate-public-page request-page">
        <header className="tracking-topbar">
          <div className="tracking-brand">
            <img
              src="/active-logo.png"
              alt="Active for Life"
              className="tracking-brand-logo"
            />
          </div>
        </header>

        <section className="tracking-hero request-hero">
          <div>
            <p className="tracking-eyebrow">Solicitud registrada</p>
            <h1>Solicitud enviada correctamente</h1>
            <p>
              La solicitud de certificados ya fue enviada a Imprenta. Guarda el
              enlace para consultar el avance o editarla mientras siga
              disponible.
            </p>
          </div>

          <div className="tracking-hero-art" aria-hidden="true">
            <span className="cap-line" />
            <span className="diploma-line" />
            <span className="building-line" />
          </div>
        </section>

        <section className="tracking-main-card success-request-card">
          <div className="success-box visual-success-box">
            <p>Folio</p>
            <strong>{trackingFolio}</strong>
          </div>

          <p>Enlace de seguimiento:</p>

          <div className="tracking-link-box visual-tracking-link">
            <a href={trackingUrl}>{trackingUrl}</a>
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(trackingUrl)}
            >
              Copiar enlace de seguimiento
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="certificate-public-page request-page">
      <header className="tracking-topbar">
        <div className="tracking-brand">
          <img
            src="/active-logo.png"
            alt="Active for Life"
            className="tracking-brand-logo"
          />
        </div>
      </header>

      <section className="tracking-hero request-hero">
        <div>
          <p className="tracking-eyebrow">Dirección Académica</p>
          <h1>Solicitud de certificados</h1>
          <p>
            Registra los certificados que se enviarán a Imprenta, define si
            serán impresos o digitales y revisa los nombres antes de enviar.
          </p>
        </div>

        <div className="tracking-hero-art" aria-hidden="true">
          <span className="cap-line" />
          <span className="diploma-line" />
          <span className="building-line" />
        </div>
      </section>

      <section className="tracking-main-card request-main-card">
        {error && <div className="form-error">{error}</div>}

        <div className="request-process-card">
          <div className="request-process-grid">
            {requestProgressSteps.map((step, index) => (
              <div
                key={step.label}
                className={`request-process-step ${
                  index < requestProgressIndex
                    ? "completed"
                    : index === requestProgressIndex
                      ? "current"
                      : "pending"
                }`}
              >
                <span>{step.icon}</span>
                <strong>{step.label}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="request-layout">
          <section className="request-form-panel">
            <div className="tracking-panel-title">
              <span>▤</span>
              <div>
                <h2>Datos de la solicitud</h2>
                <p>Información general para identificar el certificado.</p>
              </div>
            </div>

            {certificatePeopleError && <div className="message-box">{certificatePeopleError}</div>}

            <div className="form-grid">
              <label>
                Plantel
                <select value={campus} onChange={(e) => setCampus(e.target.value)}>
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
                  value={requesterId}
                  onChange={(e) => selectCertificatePerson("Requester", e.target.value)}
                  disabled={loadingCertificatePeople}
                >
                  <option value="">{loadingCertificatePeople ? "Cargando solicitantes..." : "Seleccionar solicitante"}</option>
                  {!loadingCertificatePeople && activeRequesters.length === 0 && (
                    <option value="" disabled>No hay solicitantes activos</option>
                  )}
                  {activeRequesters.map((person) => (
                    <option key={person.projectionId || person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Director que aparecerá en los certificados
                <select
                  value={principalSignerId}
                  onChange={(e) => selectCertificatePerson("Principal", e.target.value)}
                  disabled={loadingCertificatePeople}
                >
                  <option value="">{loadingCertificatePeople ? "Cargando directores..." : "Seleccionar director"}</option>
                  {!loadingCertificatePeople && activePrincipalSigners.length === 0 && (
                    <option value="" disabled>No hay directores activos</option>
                  )}
                  {activePrincipalSigners.map((signer) => (
                    <option key={signer.projectionId || signer.id} value={signer.id}>
                      {signer.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Fecha deseada de entrega
                <input
                  type="date"
                  value={requestedDeliveryDate}
                  onChange={(e) => setRequestedDeliveryDate(e.target.value)}
                />
              </label>

              <label>
                Tipo de documento
                <input value={CERTIFICATE_TYPE} readOnly />
              </label>

              <label>
                Nivel, curso o grupo
                <select
                  value={courseLevel}
                  onChange={(e) => setCourseLevel(e.target.value)}
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
                  value={teacherSignerId}
                  onChange={(e) => selectCertificatePerson("Teacher", e.target.value)}
                  disabled={loadingCertificatePeople}
                >
                  <option value="">{loadingCertificatePeople ? "Cargando maestros..." : "Seleccionar maestro"}</option>
                  {!loadingCertificatePeople && activeTeacherSigners.length === 0 && (
                    <option value="" disabled>No hay maestros activos</option>
                  )}
                  {activeTeacherSigners.map((signer) => (
                    <option key={signer.projectionId || signer.id} value={signer.id}>
                      {signer.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Horario
                <input
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="Ej. Lunes y miércoles 6:00 p.m."
                />
              </label>
            </div>

            <label className="full-field">
              Observaciones generales
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Indicaciones especiales para Imprenta"
                rows={3}
              />
            </label>
          </section>

          <aside className="request-side-panel">
            <div className="tracking-panel-title compact">
              <span>◈</span>
              <div>
                <h2>Resumen</h2>
                <p>Entrega solicitada</p>
              </div>
            </div>

            <div className="request-summary-box">
              <span>Impresos</span>
              <strong>{currentDeliverySummary.printedQuantity}</strong>
            </div>

            <div className="request-summary-box digital">
              <span>Digitales</span>
              <strong>{currentDeliverySummary.digitalQuantity}</strong>
            </div>

            <div className="request-summary-total">
              <span>Total de alumnos</span>
              <strong>
                {currentDeliverySummary.printedQuantity +
                  currentDeliverySummary.digitalQuantity}
              </strong>
            </div>

            <div className="request-summary-box request-summary-text">
              <span>Nivel seleccionado</span>
              <strong>{courseLevel || "Pendiente"}</strong>
            </div>

            <div className="request-summary-box request-summary-text">
              <span>Maestro / horario</span>
              <strong>{teacherName || "Maestro pendiente"}</strong>
              <small>{schedule || "Horario pendiente"}</small>
            </div>
          </aside>
        </div>

        <section className="request-form-panel">
          <div className="tracking-panel-title">
            <span>◈</span>
            <div>
              <h2>Tipo de entrega</h2>
              <p>
                Selecciona el tipo de entrega por defecto. Después puedes
                ajustar cada alumno de forma individual.
              </p>
            </div>
          </div>

          <div className="form-grid">
            <label>
              Tipo de entrega por defecto
              <select
                value={defaultStudentDeliveryType}
                onChange={(e) => setDefaultStudentDeliveryType(e.target.value)}
              >
                <option value="Impreso">Impreso</option>
                <option value="Digital">Digital</option>
              </select>
            </label>

            <div className="tracking-delivery-summary compact">
              <div>
                <span>Resumen actual</span>
                <strong>
                  {currentDeliverySummary.printedQuantity} impresos ·{" "}
                  {currentDeliverySummary.digitalQuantity} digitales
                </strong>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={applyDeliveryTypeToAll}>
              Aplicar a todos los alumnos
            </button>
          </div>
        </section>

        <section className="request-form-panel">
          <div className="section-title-row request-section-title">
            <div className="tracking-panel-title compact">
              <span>☷</span>
              <div>
                <h2>Alumnos</h2>
                <p>Agrega alumnos individualmente o pega una lista completa.</p>
              </div>
            </div>

            <button type="button" onClick={addStudent}>
              Agregar alumno individual
            </button>
          </div>

          <div className="request-bulk-box">
            <h3>Pegar varios nombres</h3>
            <p>
              Escribe un nombre por renglón. También se aceptan nombres
              separados por coma o punto y coma.
            </p>

            <label className="full-field">
              Lista de alumnos
              <textarea
                value={bulkNames}
                onChange={(e) => setBulkNames(e.target.value)}
                placeholder={`Ejemplo:
Jose Hernandez
Maria Gonzalez
Angel Lopez`}
                rows={7}
              />
            </label>

            <div className="form-actions">
              <button type="button" onClick={loadBulkNames}>
                Cargar nombres
              </button>
            </div>
          </div>

          <div className="students-list">
            {students.map((student, index) => (
              <div
                className="student-row public-student-row"
                key={`student-${index}`}
              >
                <label>
                  Nombre completo
                  <input
                    value={student.fullName}
                    onChange={(e) =>
                      updateStudent(index, "fullName", e.target.value)
                    }
                    placeholder="Ej. José Hernández"
                  />
                </label>

                <label>
                  Entrega
                  <select
                    value={student.deliveryType}
                    onChange={(e) =>
                      updateStudent(index, "deliveryType", e.target.value)
                    }
                  >
                    <option value="Impreso">Impreso</option>
                    <option value="Digital">Digital</option>
                  </select>
                </label>

                <label>
                  Observaciones
                  <input
                    value={student.notes}
                    onChange={(e) =>
                      updateStudent(index, "notes", e.target.value)
                    }
                    placeholder="Opcional"
                  />
                </label>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => removeStudent(index)}
                  disabled={students.length === 1}
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={clearStudents}
            >
              Limpiar alumnos
            </button>

            <button type="button" onClick={reviewNames}>
              Revisar nombres
            </button>
          </div>
        </section>

        {reviewStudents.length > 0 && (
          <section className="request-review-panel">
            <div className="tracking-panel-title">
              <span>✓</span>
              <div>
                <h2>Revisión de nombres</h2>
                <p>
                  El sistema no corrige automáticamente. Revisa las sugerencias
                  y decide cuáles aceptar.
                </p>
              </div>
            </div>

            <div className="review-list">
              {reviewStudents.map((student, index) => (
                <div
                  className={`review-item visual-review-item ${
                    student.hasSuggestion
                      ? student.correctionAccepted
                        ? "correction-accepted"
                        : "correction-pending"
                      : "correction-clean"
                  }`}
                  key={`review-${index}`}
                >
                  <div className="review-name-compare">
                    <div className="review-name-current">
                      <p className="review-label">Nombre capturado</p>
                      <strong>{student.originalName}</strong>
                    </div>

                    <span className="review-name-arrow">→</span>

                    <div className="review-name-final">
                      <p className="review-label">
                        {student.correctionAccepted ? "Corrección aceptada" : "Nombre final"}
                      </p>
                      <strong>{student.finalName}</strong>
                    </div>

                    <div className="review-name-status">
                      {student.hasSuggestion ? (
                        student.correctionAccepted ? (
                          <span className="review-status-pill accepted">Aceptada</span>
                        ) : (
                          <span className="review-status-pill pending">Revisar</span>
                        )
                      ) : (
                        <span className="review-status-pill clean">Correcto</span>
                      )}
                    </div>

                    <p className="muted-text review-delivery-note">
                      Entrega: <strong>{student.deliveryType}</strong>
                    </p>

                    {student.hasSuggestion && !student.correctionAccepted && (
                      <p className="suggestion-text review-suggestion-alert">
                        Sugerencia: <strong>{student.suggestedName}</strong>
                      </p>
                    )}
                  </div>

                  {student.hasSuggestion && (
                    <div className="review-actions">
                      <button
                        type="button"
                        onClick={() => acceptCorrection(index)}
                      >
                        Aceptar corrección
                      </button>

                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => keepOriginal(index)}
                      >
                        Dejar como está
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="form-actions">
              <button type="button" onClick={submitRequest} disabled={saving}>
                {saving ? "Enviando..." : "Enviar solicitud"}
              </button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
