import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

export const PUBLIC_CERTIFICATE_PEOPLE_COLLECTION = "publicCertificatePeople";

export function normalizePublicCertificatePerson(person) {
  const type = ["Requester", "Principal", "Teacher"].includes(person?.type)
    ? person.type
    : "Requester";

  return {
    id: String(person?.sourceId || person?.id || ""),
    projectionId: String(person?.id || ""),
    name: String(person?.name || person?.displayName || person?.fullName || person?.nombre || "").trim(),
    type,
    active: person?.active === true,
  };
}

export async function loadPublicCertificatePeople() {
  const peopleQuery = query(
    collection(db, PUBLIC_CERTIFICATE_PEOPLE_COLLECTION),
    where("active", "==", true)
  );
  const snapshot = await getDocs(peopleQuery);

  return snapshot.docs
    .map((personDoc) => normalizePublicCertificatePerson({ id: personDoc.id, ...personDoc.data() }))
    .filter((person) => person.active && person.id && person.name);
}

export function findPublicCertificatePerson(people, type, id, name = "") {
  const cleanName = String(name || "").trim().toLocaleLowerCase("es-MX");
  return people.find((person) => person.type === type && person.id === id) ||
    people.find((person) => person.type === type && person.name.toLocaleLowerCase("es-MX") === cleanName) ||
    null;
}
