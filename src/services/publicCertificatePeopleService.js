import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import {
  dedupeCertificatePeople,
  isActiveCertificatePerson,
  normalizeCertificatePersonText,
  normalizeCertificateSignerType,
} from "../utils/certificatePeople";

export const PUBLIC_CERTIFICATE_PEOPLE_COLLECTION = "publicCertificatePeople";

export function normalizePublicCertificatePerson(person) {
  const type = normalizeCertificateSignerType(
    person?.type,
    person?.category,
    person?.categoria,
    person?.signerType,
    person?.role,
    person?.rol,
    person?.cargo
  );

  return {
    id: String(person?.sourceId || person?.id || ""),
    projectionId: String(person?.id || ""),
    name: String(person?.name || person?.displayName || person?.fullName || person?.nombre || "").trim(),
    type,
    active: isActiveCertificatePerson(person),
  };
}

export async function loadPublicCertificatePeople() {
  const snapshots = await Promise.all(
    ["Principal", "Teacher"].map((type) => getDocs(query(
      collection(db, PUBLIC_CERTIFICATE_PEOPLE_COLLECTION),
      where("active", "==", true),
      where("type", "==", type)
    )))
  );

  return dedupeCertificatePeople(
    snapshots
      .flatMap((snapshot) => snapshot.docs)
      .map((personDoc) => normalizePublicCertificatePerson({ id: personDoc.id, ...personDoc.data() }))
      .filter((person) => person.active && person.id && person.name && person.type)
  ).sort((a, b) => a.name.localeCompare(b.name, "es-MX", { sensitivity: "base" }));
}

export function findPublicCertificatePerson(people, type, id, name = "") {
  const normalizedType = normalizeCertificateSignerType(type);
  const cleanName = normalizeCertificatePersonText(name);
  return people.find((person) => person.type === normalizedType && person.id === id) ||
    people.find((person) => person.type === normalizedType && normalizeCertificatePersonText(person.name) === cleanName) ||
    null;
}
