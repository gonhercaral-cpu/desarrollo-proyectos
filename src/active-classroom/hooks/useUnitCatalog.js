import { useEffect, useState } from "react";
import { collection, doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../services/firebase";
import { canClassroom } from "../utils/permissions";
export default function useUnitCatalog(profile) {
  const [result, setResult] = useState({ documents: [], error: "" });
  const allowed = canClassroom(profile);
  useEffect(() => {
    if (!allowed) return undefined;
    let live = true; let epoch = 0;
    const unsubscribe = onSnapshot(collection(db, "activeClassroomUnits"), snapshot => {
      const current = ++epoch; const documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setResult({ documents, error: "" });
      void Promise.all(documents.map(async unit => {
        if (!unit.publishedVersion || unit.lastPublishedAt) return unit;
        try { const publication = (await getDoc(doc(db, "activeClassroomUnits", unit.id, "publications", String(unit.publishedVersion)))).data(); return { ...unit, lastPublishedAt: publication?.manifest?.publishedAt || publication?.publishedAt?.toDate?.().toISOString(), lastPublishedByUid: publication?.publishedByUid }; }
        catch { return unit; }
      })).then(items => { if (live && current === epoch) setResult({ documents: items, error: "" }); });
    }, () => { if (live) setResult({ documents: [], error: "No se pudo consultar versiones de Units." }); });
    return () => { live = false; unsubscribe(); };
  }, [allowed]);
  return allowed ? result : { documents: [], error: "" };
}
