import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { getDownloadURL, listAll, ref as storageRef } from "firebase/storage";
import { db, storage } from "./firebase";
import {
  getCertificateBatchId,
  getCertificatePdfReferences,
  getCertificateRequestId,
  getCertificateStableIds,
  getStorageObjectPath,
} from "../utils/certificateHistory";

const PDF_SUBCOLLECTIONS = ["certificates", "generatedCertificates", "certificateFiles", "files"];
const PDF_LOOKUP_FIELDS = ["certificateId", "validationCode", "folio"];
const LOOKUP_TIMEOUT_MS = 3500;
const RESOLUTION_TIMEOUT_MS = 15000;

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function sanitizeSegment(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function normalizeFileToken(value) {
  return sanitizeSegment(String(value || "").replace(/\.pdf(?:\?.*)?$/i, "")).toLowerCase();
}

function withTimeout(promise, timeoutMs, target) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(`Tiempo agotado al consultar ${target}.`);
      error.code = "certificate-pdf/timeout";
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function timestampYear(value) {
  if (!value) return "";
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : String(date.getFullYear());
}

function getFirebaseStoragePath(value) {
  return getStorageObjectPath(value);
}

function isDirectPublicUrl(value) {
  return /^(?:https?:|blob:|data:application\/pdf)/i.test(String(value || "")) &&
    !/(?:firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(String(value || ""));
}

function logLookupFailure(kind, target, error) {
  console.warn("[Certificados] No se pudo resolver PDF", {
    kind,
    target,
    code: error?.code || "",
    message: error?.message || String(error || "Error desconocido"),
  });
}

function getStrongFileTokens(certificate, student = null) {
  return unique([
    certificate?.id,
    certificate?.certificateId,
    certificate?.validationCode,
    certificate?.codigoValidacion,
    student?.certificateRecordId,
    student?.certificateId,
    student?.validationCode,
    student?.codigoValidacion,
  ].map(normalizeFileToken)).filter(Boolean);
}

function getFolioTokens(certificate, student = null) {
  return unique([
    certificate?.folio,
    certificate?.certificateFolio,
    student?.certificateFolio,
    student?.folio,
  ].map(normalizeFileToken)).filter(Boolean);
}

function getDocumentLookupIds(certificate, student = null) {
  return unique([
    certificate?.id,
    certificate?.certificateId,
    certificate?.validationCode,
    certificate?.folio,
    student?.certificateRecordId,
    student?.certificateId,
    student?.validationCode,
    student?.certificateFolio,
  ]);
}

async function readDocument(pathSegments) {
  try {
    const snapshot = await withTimeout(
      getDoc(doc(db, ...pathSegments)),
      LOOKUP_TIMEOUT_MS,
      pathSegments.join("/")
    );
    return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
  } catch (error) {
    logLookupFailure("documento", pathSegments.join("/"), error);
    return null;
  }
}

async function readSubcollection(pathSegments, stableIds) {
  try {
    const snapshot = await withTimeout(
      getDocs(collection(db, ...pathSegments)),
      LOOKUP_TIMEOUT_MS,
      pathSegments.join("/")
    );
    return snapshot.docs
      .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
      .filter((data) => stableIds.some((id) => getCertificateStableIds(data).includes(id)));
  } catch (error) {
    logLookupFailure("subcoleccion", pathSegments.join("/"), error);
    return [];
  }
}

async function readAlternateCertificates(certificate, stableIds) {
  const reads = PDF_LOOKUP_FIELDS.map(async (field) => {
    const value = String(certificate?.[field] || "").trim();
    if (!value) return [];

    try {
      const snapshot = await withTimeout(
        getDocs(query(collection(db, "generatedCertificates"), where(field, "==", value))),
        LOOKUP_TIMEOUT_MS,
        `generatedCertificates.${field}`
      );
      return snapshot.docs
        .map((snapshotDoc) => ({ id: snapshotDoc.id, ...snapshotDoc.data() }))
        .filter((data) => stableIds.some((id) => getCertificateStableIds(data).includes(id)));
    } catch (error) {
      logLookupFailure("consulta", `generatedCertificates.${field}=${value}`, error);
      return [];
    }
  });

  return (await Promise.all(reads)).flat();
}

export async function loadCertificatePdfMetadata(certificate, request = null, student = null) {
  const sources = [certificate, student, request].filter(Boolean);
  const requestId = request?.id || getCertificateRequestId(certificate);
  const batchIds = unique([getCertificateBatchId(certificate), requestId]);
  const stableIds = getCertificateStableIds(certificate, request, student);
  const lookupIds = getDocumentLookupIds(certificate, student);

  const batchDocuments = await Promise.all(
    batchIds.map((batchId) => readDocument(["certificateHistoryBatches", batchId]))
  );
  sources.push(...batchDocuments.filter(Boolean));

  const parentPaths = [
    ...(requestId ? [["printRequests", requestId]] : []),
    ...batchIds.map((batchId) => ["certificateHistoryBatches", batchId]),
  ];
  const directReads = parentPaths.flatMap((parentPath) =>
    PDF_SUBCOLLECTIONS.flatMap((subcollection) =>
      lookupIds.map((stableId) => readDocument([...parentPath, subcollection, stableId]))
    )
  );
  const collectionReads = parentPaths.flatMap((parentPath) =>
    PDF_SUBCOLLECTIONS.map((subcollection) =>
      readSubcollection([...parentPath, subcollection], stableIds)
    )
  );
  const [directDocuments, collectionDocuments, alternateDocuments] = await Promise.all([
    Promise.all(directReads),
    Promise.all(collectionReads),
    readAlternateCertificates(certificate, stableIds),
  ]);

  sources.push(
    ...directDocuments.filter(Boolean),
    ...collectionDocuments.flat(),
    ...alternateDocuments
  );
  return sources;
}

async function tryStoragePath(storagePath, attemptedPaths) {
  const cleanPath = String(storagePath || "").replace(/^\/+/, "");
  if (!cleanPath || attemptedPaths.has(cleanPath)) return null;
  attemptedPaths.add(cleanPath);

  try {
    const reference = storageRef(storage, cleanPath);
    const url = await withTimeout(
      getDownloadURL(reference),
      LOOKUP_TIMEOUT_MS,
      cleanPath
    );
    return { url, storagePath: reference.fullPath };
  } catch (error) {
    logLookupFailure("storagePath", cleanPath, error);
    return null;
  }
}

async function listMatchingPdf(rootPath, strongTokens, folioTokens, attemptedPaths, depth = 0) {
  try {
    const result = await withTimeout(
      listAll(storageRef(storage, rootPath)),
      LOOKUP_TIMEOUT_MS,
      rootPath
    );
    const pdfItems = result.items.filter((item) => item.name.toLowerCase().endsWith(".pdf"));
    const strongMatch = pdfItems.find((item) => {
      const itemToken = normalizeFileToken(item.name);
      return strongTokens.some((token) => itemToken === token || itemToken.includes(token));
    });

    if (strongMatch) return await tryStoragePath(strongMatch.fullPath, attemptedPaths);

    const folioMatches = pdfItems.filter((item) => {
      const itemToken = normalizeFileToken(item.name);
      return folioTokens.some((token) => itemToken === token || itemToken.startsWith(`${token}-`));
    });
    if (folioMatches.length === 1) {
      return await tryStoragePath(folioMatches[0].fullPath, attemptedPaths);
    }
    if (depth >= 2) return null;

    for (const prefix of result.prefixes) {
      const match = await listMatchingPdf(
        prefix.fullPath,
        strongTokens,
        folioTokens,
        attemptedPaths,
        depth + 1
      );
      if (match) return match;
    }
  } catch (error) {
    logLookupFailure("storageList", rootPath, error);
  }

  return null;
}

async function tryReferenceSources(sources, attemptedPaths) {
  const references = getCertificatePdfReferences(...sources);
  const referencePaths = unique([
    ...references.paths,
    ...references.urls.map(getFirebaseStoragePath),
  ]);

  for (const path of referencePaths) {
    const result = await tryStoragePath(path, attemptedPaths);
    if (result) return result;
  }
  for (const url of references.urls) {
    if (isDirectPublicUrl(url)) return { url, storagePath: "" };
  }
  return null;
}

async function locateStoredCertificatePdf(certificate, request = null, student = null) {
  const directSources = [certificate, student, request].filter(Boolean);
  const attemptedPaths = new Set();
  const directResult = await tryReferenceSources(directSources, attemptedPaths);
  if (directResult) return directResult;

  const requestId = request?.id || getCertificateRequestId(certificate);
  const batchId = getCertificateBatchId(certificate);
  const parentIds = unique([requestId, batchId]).map(sanitizeSegment).filter(Boolean);
  const years = unique([
    certificate?.issueYear,
    certificate?.generatedYear,
    String(certificate?.issueDate || "").slice(0, 4),
    timestampYear(certificate?.generatedAt),
    timestampYear(student?.certificateGeneratedAt),
    timestampYear(student?.generatedAt),
    timestampYear(request?.createdAt),
  ]).filter((year) => /^\d{4}$/.test(year));
  const strongTokens = getStrongFileTokens(certificate, student);
  const folioTokens = getFolioTokens(certificate, student);
  const exactFileNames = unique([
    ...strongTokens.map((token) => `${token}.pdf`),
    certificate?.pdfFileName,
  ]);
  const exactPaths = [];

  parentIds.forEach((parentId) => years.forEach((year) => exactFileNames.forEach((fileName) => {
    exactPaths.push(`printshop/generated-certificates/${parentId}/${year}/${fileName}`);
  })));
  years.forEach((year) => exactFileNames.forEach((fileName) => {
    exactPaths.push(`printshop/generated-certificates/${year}/${fileName}`);
  }));

  for (const path of exactPaths) {
    const result = await tryStoragePath(path, attemptedPaths);
    if (result) return result;
  }

  const roots = unique([
    ...parentIds.map((parentId) => `printshop/generated-certificates/${parentId}`),
    ...years.map((year) => `printshop/generated-certificates/${year}`),
  ]);
  for (const rootPath of roots) {
    const result = await listMatchingPdf(rootPath, strongTokens, folioTokens, attemptedPaths);
    if (result) return result;
  }

  const metadataSources = await loadCertificatePdfMetadata(certificate, request, student);
  const metadataResult = await tryReferenceSources(metadataSources, attemptedPaths);
  if (metadataResult) return metadataResult;

  throw new Error(
    "No existe un PDF almacenado para este certificado. Se revisaron sus IDs, solicitud, lote, metadatos y objetos de Storage."
  );
}

export async function resolveStoredCertificatePdf(certificate, request = null, student = null) {
  try {
    return await withTimeout(
      locateStoredCertificatePdf(certificate, request, student),
      RESOLUTION_TIMEOUT_MS,
      certificate?.folio || certificate?.id || "certificado"
    );
  } catch (error) {
    if (error?.code === "certificate-pdf/timeout") {
      throw new Error(
        "La búsqueda del PDF agotó el tiempo de espera. Revisa consola para ver la ruta que no respondió.",
        { cause: error }
      );
    }
    throw error;
  }
}
