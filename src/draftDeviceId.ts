export type DraftDeviceStorage = Readonly<{
  loadLocalStorage(key: string): unknown | Promise<unknown>;
  saveLocalStorage(key: string, value: string): void | Promise<void>;
}>;
export type DraftDeviceResult = Readonly<{ ok: true; deviceId: string }> |
  Readonly<{ ok: false; reason: "device-id-unavailable" }>;
const valid = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !value.includes("\0");

/** The caller owns the local-storage namespace. Never fall back to a Vault file. */
export async function getDraftDeviceId(storage: DraftDeviceStorage, key: string,
  createId: () => string = () => crypto.randomUUID(), allowCreate = true): Promise<DraftDeviceResult> {
  try {
    const existing = await storage.loadLocalStorage(key);
    if (existing !== null) return valid(existing) ? { ok: true, deviceId: existing } : { ok: false, reason: "device-id-unavailable" };
    if (!allowCreate) return { ok: false, reason: "device-id-unavailable" };
    const deviceId = createId();
    if (!valid(deviceId)) return { ok: false, reason: "device-id-unavailable" };
    await storage.saveLocalStorage(key, deviceId);
    return await storage.loadLocalStorage(key) === deviceId ? { ok: true, deviceId } : { ok: false, reason: "device-id-unavailable" };
  } catch { return { ok: false, reason: "device-id-unavailable" }; }
}
