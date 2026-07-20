import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const reviewQualityCallable = httpsCallable(functions, "reviewProductionBatchQuality");
const enterInventoryCallable = httpsCallable(functions, "enterProductionBatchInventory");
const updateProgressCallable = httpsCallable(functions, "updateProductionBatchProgress");

function callableError(error, fallback) {
  const result = new Error(error?.message || fallback);
  result.code = String(error?.code || "unknown").replace(/^functions\//, "");
  return result;
}

export async function saveProductionBatchQualityReview(batchId, review) {
  try {
    const response = await reviewQualityCallable({ batchId, review });
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudo guardar la revisión de calidad.");
  }
}

export async function enterProductionBatchInventory(batchId) {
  try {
    const response = await enterInventoryCallable({ batchId });
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudo ingresar el lote al inventario.");
  }
}

export async function updateProductionBatchProgress(batchId, update) {
  try {
    const response = await updateProgressCallable({ batchId, update });
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudo actualizar el avance de producción.");
  }
}
