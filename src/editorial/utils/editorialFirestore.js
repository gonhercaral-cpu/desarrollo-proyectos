// Estabilización — saneamiento de datos antes de escribir en Firestore.
// Firestore rechaza `undefined` ("Unsupported field value: undefined"). Esta
// utilidad elimina recursivamente propiedades/elementos `undefined` SIN mutar el
// original y SIN aplanar tipos especiales de Firebase (Timestamp, FieldValue,
// DocumentReference, GeoPoint, Bytes) ni Date/Blob/File.

// Detecta valores que NO deben recorrerse como objetos planos.
function isSpecialValue(value) {
  if (value === null) return true;
  const type = typeof value;
  if (type !== "object") return true; // primitivos (incluye undefined, manejado aparte)

  // Date / Blob / File / ArrayBuffer.
  if (value instanceof Date) return true;
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  if (typeof File !== "undefined" && value instanceof File) return true;
  if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return true;

  // Objetos especiales de Firebase: no son literales `{}`. Cualquier objeto cuyo
  // prototipo no sea Object.prototype ni null se trata como opaco (Timestamp,
  // FieldValue/serverTimestamp/arrayUnion, DocumentReference, GeoPoint, Bytes…).
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return true;

  return false;
}

// Devuelve una copia saneada. Conserva null/false/0/"" y tipos especiales.
export function sanitizeFirestoreData(value) {
  if (value === undefined) return undefined; // el llamador decide omitir la clave
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeFirestoreData(item));
  }
  if (isSpecialValue(value)) return value;

  // Objeto plano: reconstruir sin claves undefined.
  const result = {};
  for (const key of Object.keys(value)) {
    const cleaned = sanitizeFirestoreData(value[key]);
    if (cleaned !== undefined) result[key] = cleaned;
  }
  return result;
}
