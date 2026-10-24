// The name typed when acknowledging or sending, remembered in this browser only
// as a convenience. Storage can be unavailable (private windows): never required.
const KEY = "aegis.operatorName";

export function rememberedName(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    // not remembered; nothing else depends on it
  }
}
