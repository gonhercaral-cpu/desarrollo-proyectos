export const DRIVE_IMPORT_CALLABLE_TIMEOUT_MS = 540000;

export async function runDriveImportBatch({ files, data, importFile, onProgress }) {
  const selectedFiles = Array.isArray(files) ? files.filter((file) => file?.id) : [];

  if (selectedFiles.length === 0) {
    throw new Error("Selecciona uno o varios archivos de Nube AES.");
  }

  if (typeof importFile !== "function") {
    throw new Error("No se configuró el importador de Nube AES.");
  }

  const imported = [];
  const failed = [];

  for (let index = 0; index < selectedFiles.length; index += 1) {
    const file = selectedFiles[index];
    onProgress?.({ completed: index, total: selectedFiles.length, file });

    try {
      const asset = await importFile(file, {
        ...data,
        title: selectedFiles.length === 1 ? data?.title : "",
      });
      imported.push(asset);
    } catch (error) {
      failed.push({
        file,
        code: String(error?.code || "").replace(/^functions\//, ""),
        message: error?.message || "No se pudo importar el archivo.",
        error,
      });
    }

    onProgress?.({ completed: index + 1, total: selectedFiles.length, file });
  }

  return { imported, failed };
}
