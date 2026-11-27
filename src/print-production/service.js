import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query, startAfter, where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../services/firebase";

export { preparePrintDocument, getPrintDocumentBlob as previewDocument } from "../services/printDocuments";

function callable(name) {
  const invoke = httpsCallable(functions, name, { timeout: 120000 });
  return async (data) => (await invoke(data)).data;
}

export const saveJob = callable("printProductionSave");
export const jobAction = callable("printProductionAction");
export const saveSettings = callable("printProductionSettings");
const manageAgent = callable("printAgentAdmin");
const changeLibrary = callable("printProductionLibrary");
export const pairAgent = (name) => manageAgent({ action: "pair", name });
export const revokeAgent = (agentId) => manageAgent({ action: "revoke", agentId });
export const saveMaterial = (input) => changeLibrary({ requestId: crypto.randomUUID(), ...input, kind: "material" });
export const saveTemplate = (input) => changeLibrary({ requestId: crypto.randomUUID(), ...input, status: input.status || input.state || "draft", kind: "template" });
export const generateReport = callable("printProductionReport");

function records(snapshot) {
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

export async function loadHistory({ cursor, from, to, pageSize = 50 } = {}) {
  const filters = [];
  if (from) filters.push(where("createdAt", ">=", new Date(from)));
  if (to) filters.push(where("createdAt", "<", new Date(to)));
  const count = Math.min(250, Math.max(1, Number(pageSize) || 50));
  const snapshot = await getDocs(query(collection(db, "printJobs"), ...filters,
    orderBy("createdAt", "desc"), ...(cursor ? [startAfter(cursor)] : []), limit(count)));
  return { jobs: records(snapshot), cursor: snapshot.size === count ? snapshot.docs.at(-1) : null };
}

export async function getEvents(jobId) {
  return records(await getDocs(query(collection(db, "printJobs", jobId, "events"),
    orderBy("createdAt", "desc"), limit(100))));
}

export function subscribeProduction({ isAdmin, onData, onError }) {
  const sources = {
    jobs: query(collection(db, "printJobs"), orderBy("updatedAt", "desc"), limit(60)),
    printers: query(collection(db, "printPrinters"), limit(250)),
    materials: query(collection(db, "printMaterialLinks"), limit(500)),
    productionTemplates: query(collection(db, "printProductionTemplates"), limit(500)),
  };
  if (isAdmin) sources.agents = query(collection(db, "printAgents"), limit(250));
  const subscriptions = Object.entries(sources).map(([name, source]) =>
    onSnapshot(source, (snapshot) => onData(name, records(snapshot)), (err) => onError(name, err)));
  subscriptions.push(onSnapshot(doc(db, "printSettings", "production"),
    (snapshot) => onData("settings", snapshot.data() || {}), (err) => onError("settings", err)));
  return () => subscriptions.forEach((unsubscribe) => unsubscribe());
}
