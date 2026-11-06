const seekIntervalKey = "active-classroom-seek-interval";
const validInterval = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 300;

export function seekIntervalSeconds(): number {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(seekIntervalKey) || "null");
    if (validInterval(value)) return value;
  } catch { /* Local preferences are optional; keep the default available. */ }
  return 5;
}

export function saveSeekInterval(seconds: number): void {
  if (!validInterval(seconds)) throw new Error("Escribe segundos enteros entre 1 y 300.");
  localStorage.setItem(seekIntervalKey, JSON.stringify(seconds));
}
