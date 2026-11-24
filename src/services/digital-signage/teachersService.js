import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { buildSignageTeachers } from "../../utils/digitalSignage/teachers.js";

// Lectura administrativa del mismo catálogo utilizado por Imprenta → Firmas.
// Ninguna escritura ni ampliación de permisos del catálogo.
export function subscribeSignageTeachers(onNext, onError) {
  return onSnapshot(collection(db, "certificateSigners"), snapshot => {
    onNext(buildSignageTeachers(snapshot.docs.map(record => ({ ...record.data(), id: record.id }))));
  }, onError);
}
