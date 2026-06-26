import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../services/firebase";

function sanitizeValidationCodeId(value) {
  return String(value || "credencial")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140) || "credencial";
}

function formatValidationDate(value) {
  if (!value) return "Sin fecha registrada";

  const date = new Date(String(value).includes("T") ? value : `${value}T00:00:00`);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
  }).format(date);
}

function getCredentialStatusConfig(status) {
  if (status === "Cancelado") {
    return {
      tone: "danger",
      icon: "!",
      title: "Credencial cancelada",
      description: "Esta credencial fue emitida por Active English School, pero actualmente aparece como cancelada.",
    };
  }

  return {
    tone: "success",
    icon: "OK",
    title: "Credencial valida",
    description: "Esta credencial fue emitida por Active English School y aparece registrada en el sistema.",
  };
}

function getValidationCodeFromLocation() {
  if (typeof window === "undefined") return "";

  const path = window.location.pathname || "";
  const marker = "/validar-credencial/";
  const markerIndex = path.indexOf(marker);

  if (markerIndex < 0) return "";

  return decodeURIComponent(path.slice(markerIndex + marker.length).replace(/\/+$/, ""));
}

export default function CredentialValidation({ validationCode: validationCodeProp }) {
  const validationCode = useMemo(
    () => String(validationCodeProp || getValidationCodeFromLocation() || "").trim(),
    [validationCodeProp]
  );
  const [loading, setLoading] = useState(true);
  const [credential, setCredential] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadCredential() {
      if (!validationCode) {
        setLoading(false);
        setError("No se recibio un codigo de validacion.");
        return;
      }

      try {
        setLoading(true);
        setError("");

        const validationId = sanitizeValidationCodeId(validationCode);
        const validationRef = doc(db, "publicCredentialValidations", validationId);
        const validationSnap = await getDoc(validationRef);

        if (cancelled) return;

        if (!validationSnap.exists()) {
          setCredential(null);
          setError("");
        } else {
          setCredential({
            id: validationSnap.id,
            ...validationSnap.data(),
          });
        }
      } catch (loadError) {
        console.error("No se pudo validar la credencial:", loadError);

        if (!cancelled) {
          setCredential(null);
          setError("No se pudo consultar la validacion. Intentalo de nuevo mas tarde.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCredential();

    return () => {
      cancelled = true;
    };
  }, [validationCode]);

  const statusConfig = getCredentialStatusConfig(credential?.status);

  return (
    <main className="certificate-validation-page">
      <section className="certificate-validation-card">
        <div className="certificate-validation-brand">
          <div className="certificate-validation-logo">AES</div>
          <div>
            <span>Active English School</span>
            <strong>Validacion de credencial</strong>
          </div>
        </div>

        {loading ? (
          <div className="certificate-validation-state loading">
            <div className="certificate-validation-spinner" />
            <h1>Validando credencial...</h1>
            <p>Estamos consultando el codigo escaneado.</p>
          </div>
        ) : error ? (
          <div className="certificate-validation-state danger">
            <div className="certificate-validation-icon">!</div>
            <h1>No se pudo validar</h1>
            <p>{error}</p>
            <small>Codigo consultado: {validationCode || "Sin codigo"}</small>
          </div>
        ) : !credential ? (
          <div className="certificate-validation-state danger">
            <div className="certificate-validation-icon">?</div>
            <h1>Credencial no encontrada</h1>
            <p>El codigo escaneado no corresponde a una credencial registrada.</p>
            <small>Codigo consultado: {validationCode}</small>
          </div>
        ) : (
          <>
            <div className={`certificate-validation-state ${statusConfig.tone}`}>
              <div className="certificate-validation-icon">{statusConfig.icon}</div>
              <h1>{statusConfig.title}</h1>
              <p>{statusConfig.description}</p>
            </div>

            <div className="certificate-validation-details">
              <div>
                <span>Persona</span>
                <strong>{credential.fullName || "Sin nombre registrado"}</strong>
              </div>

              <div>
                <span>Departamento</span>
                <strong>{credential.department || "Sin departamento"}</strong>
              </div>

              <div>
                <span>Puesto</span>
                <strong>{credential.position || "Sin puesto"}</strong>
              </div>

              <div>
                <span>ID colaborador</span>
                <strong>{credential.employeeId || "No registrado"}</strong>
              </div>

              <div>
                <span>Emision</span>
                <strong>{formatValidationDate(credential.issueDate)}</strong>
              </div>

              <div>
                <span>Vigencia</span>
                <strong>{formatValidationDate(credential.expiryDate)}</strong>
              </div>

              <div>
                <span>Folio</span>
                <strong>{credential.folio || "Sin folio"}</strong>
              </div>

              <div>
                <span>Estado</span>
                <strong>{credential.status || "Generado"}</strong>
              </div>
            </div>

            <div className="certificate-validation-footer">
              <span>Codigo de validacion</span>
              <strong>{credential.validationCode || validationCode}</strong>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
