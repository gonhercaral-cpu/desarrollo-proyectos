import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const request = httpsCallable(functions, "projectSupervision", { timeout: 120000 });
export async function supervisionRequest(op, payload = {}) {
  const result = await request({ ...payload, op });
  return result.data;
}
