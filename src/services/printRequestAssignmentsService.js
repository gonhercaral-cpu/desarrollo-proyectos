import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export async function repairMissingPrintRequestAssignments() {
  const repairAssignments = httpsCallable(functions, "repairPrintRequestAssignments");
  const result = await repairAssignments();
  return result.data || { scanned: 0, repaired: 0 };
}
