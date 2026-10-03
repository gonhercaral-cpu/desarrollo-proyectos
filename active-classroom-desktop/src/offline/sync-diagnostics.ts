type SyncEvent = "REFRESH_START" | "REMOTE_PUBLICATION" | "LOCAL_PUBLICATION" | "UPDATE_AVAILABLE" | "REFRESH_COMPLETE" | "LIST_OK" | "MANIFEST_OK" | "MANIFEST_401" | "MANIFEST_403" | "MANIFEST_404" | "MANIFEST_5XX" | "MANIFEST_ERROR" | "DOWNLOAD_START" | `DOWNLOAD_HTTP_${number}` | "DOWNLOAD_ERROR" | "HASH_MISMATCH" | "CACHE_WRITE_ERROR" | "VERSION_ACTIVATED";
export function syncDiagnostic(event: SyncEvent, context: { unitId?: string; httpStatus?: number; bytes?: number; version?: number; localVersion?: number; operation?: string } = {}): void {
  // Allow safe Unit IDs; never include URLs, device identities, credentials or payloads.
  const details = Object.fromEntries(Object.entries(context).filter(([key, value]) =>
    ["httpStatus", "bytes", "version", "localVersion"].includes(key) ? Number.isSafeInteger(value) && Number(value) >= 0
      : key === "unitId" ? typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
      : key === "operation" && ["list", "has", "begin", "append", "finish", "commit", "open", "discard"].includes(String(value))));
  console.info("[Active Classroom Sync]", { event, ...details });
}
