import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

const reviewQualityCallable = httpsCallable(functions, "reviewProductionBatchQuality");
const enterInventoryCallable = httpsCallable(functions, "enterProductionBatchInventory");
const updateProgressCallable = httpsCallable(functions, "updateProductionBatchProgress");
const deleteBatchCallable = httpsCallable(functions, "deleteProductionBatch");
const outputInventoryCallable = httpsCallable(functions, "registerFinishedInventoryOutput");
const reactivateReplenishmentCallable = httpsCallable(functions, "reactivateProductReplenishment");
const repairAutomaticBatchesCallable = httpsCallable(functions, "repairAutomaticProductionBatches");
const saveAdminChangesCallable = httpsCallable(functions, "saveProductionBatchAdminChanges");

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

export async function deleteProductionBatch(batchId) {
  try {
    const response = await deleteBatchCallable({ batchId });
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudo eliminar el lote de producción.");
  }
}

export async function registerFinishedInventoryOutput(input) {
  try {
    const response = await outputInventoryCallable(input);
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudo registrar la salida de inventario.");
  }
}

export async function reactivateProductReplenishment(productId) {
  try {
    const response = await reactivateReplenishmentCallable({ productId });
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudo reactivar la reposición automática.");
  }
}

export async function repairAutomaticProductionBatches() {
  try {
    const response = await repairAutomaticBatchesCallable({});
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudieron completar los lotes automáticos existentes.");
  }
}

export async function saveProductionBatchAdminChanges(batchId, changes) {
  try {
    const response = await saveAdminChangesCallable({ batchId, changes });
    return response.data;
  } catch (error) {
    throw callableError(error, "No se pudieron guardar los cambios del lote.");
  }
}
