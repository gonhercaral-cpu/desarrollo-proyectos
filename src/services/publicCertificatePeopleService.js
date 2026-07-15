import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import {
  buildActiveCertificatePeople,
  normalizeCertificatePersonRecord,
  normalizeCertificatePersonText,
  normalizeCertificateSignerType,
} from "../utils/certificatePeople";
import { normalizeId } from "../utils/normalizeId";

export function normalizePublicCertificatePerson(person) {
  return normalizeCertificatePersonRecord(person);
}

export async function loadPublicCertificatePeople() {
  const listPeople = httpsCallable(functions, "listPublicCertificatePeople");
  const result = await listPeople();

  return buildActiveCertificatePeople(
    Array.isArray(result.data?.people) ? result.data.people : []
  );
}

export function findPublicCertificatePerson(people, type, id, name = "", options = {}) {
  const normalizedType = normalizeCertificateSignerType(type);
  const normalizedId = normalizeId(id);
  const cleanName = normalizeCertificatePersonText(name);
  if (normalizedId) {
    const idMatch = people.find(
      (person) => person.type === normalizedType && normalizeId(person.id) === normalizedId
    ) || null;
    if (idMatch || options.strictId === true) return idMatch;
  }
  return people.find(
    (person) => person.type === normalizedType && normalizeCertificatePersonText(person.name) === cleanName
  ) || null;
}
