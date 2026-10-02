type SyncEvent = "LIST_OK" | "MANIFEST_OK" | "MANIFEST_401" | "MANIFEST_403" | "MANIFEST_404" | "MANIFEST_5XX" | "MANIFEST_ERROR" | "DOWNLOAD_START" | `DOWNLOAD_HTTP_${number}` | "DOWNLOAD_ERROR" | "HASH_MISMATCH" | "CACHE_WRITE_ERROR" | "VERSION_ACTIVATED";
export function syncDiagnostic(event: SyncEvent, context: { httpStatus?: number; bytes?: number; version?: number; operation?: string } = {}): void {
  // Never include URLs, resource names, identities, credentials or error payloads.
  const details = Object.fromEntries(Object.entries(context).filter(([key, value]) =>
    ["httpStatus", "bytes", "version"].includes(key) ? Number.isSafeInteger(value) && Number(value) >= 0
      : key === "operation" && ["list", "has", "begin", "append", "finish", "commit", "open", "discard"].includes(String(value))));
  console.info("[Active Classroom Sync]", { event, ...details });
}
