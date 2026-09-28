/* global window, document */
import { initializeApp } from "firebase/app";
initializeApp({ projectId: "demo-ideas-ui", storageBucket: "demo-ideas-ui.appspot.com", apiKey: "demo" });
const original = await import("../../src/services/ideasService.js");
export const {
  IDEA_AREAS, IDEA_IMPACTS, IDEA_PRIORITIES, IDEA_STATUSES,
  getIdeaImpactConfig, getIdeaPriorityConfig, getIdeaStatusConfig,
} = original;
const role = new URLSearchParams(window.location.search).get("role") || "collaborator";
const identity = {
  firebaseUser: { uid: role, email: `${role}@test.local` },
  profile: { active: true, role, area: "General", name: `Prueba ${role}` },
};
let pending;
let onRows = () => {};
let calls = 0;
const storageKey = "ideas-incubator-ui-fixture";
let rows = JSON.parse(localStorage.getItem(storageKey) || "[]");
export function useAuth() { return identity; }
export default function UserAvatar() { return null; }
export function subscribeIdeas({ onChange }) {
  onRows = onChange;
  queueMicrotask(() => onRows(rows.filter((row) => role === "admin" || row.createdByUid === role)));
  return () => { onRows = () => {}; };
}
export function subscribeIdeaComments(_id, onChange) { queueMicrotask(() => onChange([])); return () => {}; }
export function createIdea(args) {
  calls++;
  document.getElementById("calls").textContent = String(calls);
  return new Promise((resolve, reject) => { pending = { resolve, reject, args }; });
}
export function completeSave() {
  if (!pending) return;
  const id = `fixture-${Date.now()}`;
  rows = [{ ...pending.args.form, id, status: "nueva", createdByUid: role, createdByName: identity.profile.name,
    createdAt: new Date().toISOString() }, ...rows];
  localStorage.setItem(storageKey, JSON.stringify(rows));
  onRows(rows.filter((row) => role === "admin" || row.createdByUid === role));
  pending.resolve(id);
  pending = null;
}
export function failSave(code) {
  pending?.reject(Object.assign(new Error("Simulated backend failure"), { code }));
  pending = null;
}
export async function addIdeaAdminComment() {}
export async function deleteIdea() {}
export async function updateIdeaStatus() {}
export async function uploadIdeaEvidence() {}
