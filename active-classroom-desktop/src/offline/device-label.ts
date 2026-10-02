export interface DeviceLabel { deviceId: string; displayName: string; deviceName?: string | null }
export function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string" || !/^[\p{L}\p{M}\p{N} .,'’()/_:#&+-]*$/u.test(value)) throw new Error("Nombre visible inválido.");
  const normalized = value.normalize("NFC").trim();
  if ([...normalized].length > 100) throw new Error("Nombre visible demasiado largo.");
  return normalized;
}
const key = (deviceId: string) => {
  if (!/^[a-f0-9]{32}$/.test(deviceId)) throw new Error("Equipo inválido.");
  return `active-classroom:device-label:v1:${deviceId}`;
};
// Public UI metadata only. Credentials remain in Secret Service, ID tokens in memory.
export function readDeviceLabel(storage: Pick<Storage, "getItem">, deviceId: string): string | undefined {
  try {
    const text = storage.getItem(key(deviceId));
    if (text === null) return undefined;
    const value = JSON.parse(text);
    return value.deviceId === deviceId ? normalizeDisplayName(value.displayName) : undefined;
  } catch { return undefined; }
}
export function saveDeviceLabel(storage: Pick<Storage, "setItem">, label: DeviceLabel): void {
  storage.setItem(key(label.deviceId), JSON.stringify({ deviceId: label.deviceId, displayName: normalizeDisplayName(label.displayName) }));
}
export function visibleDeviceName(identity?: { displayName?: string; name: string }): string {
  return identity?.displayName || identity?.name || "Equipo del salón";
}
