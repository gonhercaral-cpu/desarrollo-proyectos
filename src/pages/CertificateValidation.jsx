import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../services/firebase";

function sanitizeValidationCodeId(value) {
  return String(value || "certificado")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "certificado";
}

function formatValidationDate(value) {
  if (!value) return "Sin fecha registrada";

  const date = new Date(`${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) {
    const fallbackDate = new Date(value);

    if (Number.isNaN(fallbackDate.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "long",
    }).format(fallbackDate);
  }

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
  }).format(date);
}

function getValidationStatusConfig(status) {
  if (status === "Cancelado") {
    return {
      tone: "danger",
      icon: "alert",
      title: "Certificado cancelado",
      description:
        "Este certificado fue emitido por Active English School, pero actualmente aparece como cancelado en el sistema.",
    };
  }

  if (status === "Entregado") {
    return {
      tone: "success",
      icon: "check",
      title: "Certificado válido",
      description:
        "Este certificado fue emitido por Active English School y aparece como entregado.",
    };
  }

  return {
    tone: "info",
    icon: "check",
    title: "Certificado válido",
    description:
      "Este certificado fue emitido por Active English School y aparece registrado en el sistema.",
  };
}

function getValidationCodeFromLocation() {
  if (typeof window === "undefined") return "";

  const path = window.location.pathname || "";
  const marker = "/validar-certificado/";
  const markerIndex = path.indexOf(marker);

  if (markerIndex < 0) return "";

  return decodeURIComponent(path.slice(markerIndex + marker.length).replace(/\/+$/, ""));
}

function ValidationIcon({ name = "check" }) {
  if (name === "alert") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.6 1.8 20.2h20.4L12 2.6Zm0 5.9c.62 0 1.1.48 1.1 1.1v4.8a1.1 1.1 0 1 1-2.2 0V9.6c0-.62.48-1.1 1.1-1.1Zm0 9.8a1.28 1.28 0 1 1 0-2.56 1.28 1.28 0 0 1 0 2.56Z" />
      </svg>
    );
  }

  if (name === "question") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm0 14.55a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Zm.12-11.5c2.3 0 4.02 1.34 4.02 3.34 0 1.38-.66 2.16-1.72 2.92-.92.66-1.32 1.04-1.32 1.9v.26h-2.17v-.36c0-1.34.62-2.08 1.67-2.84.88-.64 1.3-1.06 1.3-1.78 0-.82-.72-1.38-1.78-1.38-1.08 0-1.86.58-2.34 1.52L7.9 8.05c.78-1.52 2.26-2.5 4.22-2.5Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm4.7 7.15-5.48 5.48a1 1 0 0 1-1.42 0l-2.5-2.5a1 1 0 1 1 1.42-1.42l1.79 1.79 4.77-4.77a1 1 0 0 1 1.42 1.42Z" />
    </svg>
  );
}

export default function CertificateValidation({ validationCode: validationCodeProp }) {
  const validationCode = useMemo(
    () => String(validationCodeProp || getValidationCodeFromLocation() || "").trim(),
    [validationCodeProp]
  );
  const [loading, setLoading] = useState(true);
  const [certificate, setCertificate] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCertificate() {
      if (!validationCode) {
        setLoading(false);
        setError("No se recibió un código de validación.");
        return;
      }

      try {
        setLoading(true);
        setError("");

        const validationId = sanitizeValidationCodeId(validationCode);
        const validationRef = doc(db, "publicCertificateValidations", validationId);
        const validationSnap = await getDoc(validationRef);

        if (cancelled) return;

        if (!validationSnap.exists()) {
          setCertificate(null);
          setError("");
        } else {
          setCertificate({
            id: validationSnap.id,
            ...validationSnap.data(),
          });
        }
      } catch (loadError) {
        console.error("No se pudo validar el certificado:", loadError);

        if (!cancelled) {
          setCertificate(null);
          setError("No se pudo consultar la validación. Inténtalo de nuevo más tarde.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCertificate();

    return () => {
      cancelled = true;
    };
  }, [validationCode]);

  const statusConfig = getValidationStatusConfig(certificate?.status);

  return (
    <main className="certificate-validation-page">
      <section className="certificate-validation-shell">
        <div className="certificate-validation-brand">
          <img src="/active-logo.png" alt="Active for Life" className="certificate-validation-brand-logo" />
          <div>
            <span>Active English School</span>
            <strong>Validación de certificado</strong>
          </div>
        </div>

        {loading ? (
          <div className="certificate-validation-state loading">
            <div className="certificate-validation-spinner" />
            <h1>Validando certificado...</h1>
            <p>Estamos consultando el código escaneado.</p>
          </div>
        ) : error ? (
          <div className="certificate-validation-state danger">
            <div className="certificate-validation-icon"><ValidationIcon name="alert" /></div>
            <h1>No se pudo validar</h1>
            <p>{error}</p>
            <small>Código consultado: {validationCode || "Sin código"}</small>
          </div>
        ) : !certificate ? (
          <div className="certificate-validation-state danger">
            <div className="certificate-validation-icon"><ValidationIcon name="question" /></div>
            <h1>Certificado no encontrado</h1>
            <p>El código escaneado no corresponde a un certificado registrado.</p>
            <small>Código consultado: {validationCode}</small>
          </div>
        ) : (
          <section className="certificate-validation-card certificate-validation-content-card">
            <div className={`certificate-validation-state ${statusConfig.tone}`}>
              <div className="certificate-validation-icon"><ValidationIcon name={statusConfig.icon} /></div>
              <span className="certificate-validation-pill">{certificate.status || "Generado"}</span>
              <h1>{statusConfig.title}</h1>
              <p>{statusConfig.description}</p>
            </div>

            <div className="certificate-validation-details">
              <div>
                <span>Alumno</span>
                <strong>{certificate.studentName || "Sin alumno registrado"}</strong>
              </div>

              <div>
                <span>Nivel</span>
                <strong>{certificate.level || "No aplica"}</strong>
              </div>

              <div>
                <span>Programa</span>
                <strong>{certificate.programName || certificate.productName || "Sin programa"}</strong>
              </div>

              <div>
                <span>Fecha de emisión</span>
                <strong>{formatValidationDate(certificate.issueDate)}</strong>
              </div>

              <div>
                <span>Folio</span>
                <strong>{certificate.folio || "Sin folio"}</strong>
              </div>

              <div>
                <span>Estado</span>
                <strong>{certificate.status || "Generado"}</strong>
              </div>

              <div>
                <span>Institución</span>
                <strong>{certificate.institution || "Active English School"}</strong>
              </div>

              <div>
                <span>Plantel</span>
                <strong>{certificate.campus || "Sin plantel"}</strong>
              </div>
            </div>

            <div className="certificate-validation-footer">
              <span>Código de validación</span>
              <strong>{certificate.validationCode || validationCode}</strong>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
