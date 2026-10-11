// Obsidian C7: container v2, existing seven record fields, notification-only pending child.
export const NOTE_DRAFT_LIMITS = Object.freeze({
  maxDraftsPerVaultDevice: 50, maxDraftTextBytes: 65_536, autoPresentDays: 30,
  maxFutureSavedAtMs: 300_000, maxParentChainLength: 5_001,
});
export type ParentProof =
  | Readonly<{ kind: "node"; nodeId: string; titleSource: string; ownRangeHash: string }>
  | Readonly<{ kind: "center"; centerKind: "h1" | "filename" | "map-md"; titleSource: string; anchorHash?: string }>;
export type ExistingDraftTarget =
  | Readonly<{ kind: "node"; nodeId: string; field: "title" | "note";
      baseHash: string; titleSource: string; ownRangeHash: string }>
  | Readonly<{ kind: "center"; field: "title" | "note"; baseHash: string; titleSource: string;
      centerKind: "h1" | "filename" | "map-md"; anchorHash?: string }>;
export type DraftTarget = ExistingDraftTarget | Readonly<{ kind: "pending-child";
  parentChain: readonly ParentProof[]; position: "last-child"; baseHash: string; field: "title" }>;
export type DraftRecord = Readonly<{ draftId: string; revision: number; deviceId: string; path: string;
  target: DraftTarget; text: string; savedAt: string }>;
export type DraftTombstone = Readonly<{ draftId: string; revision: number; clearedAt: string }>;
export type PluginDataV1 = Readonly<{ version: 1; styles: Readonly<Record<string, string>>;
  drafts: readonly (Omit<DraftRecord, 'target'> & { target: ExistingDraftTarget })[]; draftTombstones: readonly DraftTombstone[] }>;
export type PluginDataV2 = Readonly<{ version: 2; styles: Readonly<Record<string, string>>;
  drafts: readonly DraftRecord[]; draftTombstones: readonly DraftTombstone[] }>;
export type DraftDataFailure = "plugin-data-unknown-version" | "plugin-data-invalid" | "plugin-data-load-failed";
export type DraftDataResult = Readonly<{ ok: true; data: PluginDataV2 }> | Readonly<{ ok: false; reason: DraftDataFailure }>;

const record = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const keys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Reflect.ownKeys(value).every((key) => typeof key === "string" && [...required, ...optional].includes(key));
export const isDraftRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !value.includes("\0");
const hash = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const isDraftPath = (value: unknown): value is string => id(value) && !/[\\\r\n]/.test(value) &&
  !value.startsWith("/") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
export const isDraftTimestamp = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
// Bound new save input only; persisted/Sync timestamps are validated by format.
export const isDraftSavedAt = (value: unknown, now = Date.now()): value is string =>
  isDraftTimestamp(value) && Number.isFinite(now) && Date.parse(value) - now <= NOTE_DRAFT_LIMITS.maxFutureSavedAtMs;
const dense = (value: unknown, valid: (item: unknown) => boolean): value is unknown[] => Array.isArray(value) &&
  Reflect.ownKeys(value).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => i)
    .every((i) => Object.hasOwn(value, i) && valid(value[i]));
const centerKind = (value: unknown) => value === "h1" || value === "filename" || value === "map-md";
const proof = (value: unknown): value is ParentProof => record(value) && typeof value.titleSource === "string" &&
  (value.kind === "node" ? keys(value, ["kind", "nodeId", "titleSource", "ownRangeHash"]) && id(value.nodeId) && hash(value.ownRangeHash) :
    value.kind === "center" && keys(value, ["kind", "centerKind", "titleSource"], ["anchorHash"]) && centerKind(value.centerKind) &&
      (!Object.hasOwn(value, "anchorHash") || hash(value.anchorHash)));
export function isDraftTarget(value: unknown): value is DraftTarget {
  if (!record(value) || !hash(value.baseHash)) return false;
  if (value.kind === "pending-child") return keys(value, ["kind", "parentChain", "position", "baseHash", "field"]) &&
    value.field === "title" && value.position === "last-child" && Array.isArray(value.parentChain) &&
    value.parentChain.length > 0 && value.parentChain.length <= NOTE_DRAFT_LIMITS.maxParentChainLength && dense(value.parentChain, proof) &&
    value.parentChain.every((p, i) => (p as ParentProof).kind === (i === 0 ? "center" : "node"));
  if (typeof value.titleSource !== "string" || (value.field !== "title" && value.field !== "note")) return false;
  if (value.kind === "node") return keys(value, ["kind", "nodeId", "field", "baseHash", "titleSource", "ownRangeHash"]) &&
    id(value.nodeId) && hash(value.ownRangeHash);
  return value.kind === "center" && keys(value, ["kind", "field", "baseHash", "titleSource", "centerKind"], ["anchorHash"]) &&
    centerKind(value.centerKind) && (!Object.hasOwn(value, "anchorHash") || hash(value.anchorHash)) &&
    (value.centerKind !== "filename" || value.field === "title");
}
export function isDraftRecord(value: unknown): value is DraftRecord {
  return record(value) && keys(value, ["draftId", "revision", "deviceId", "path", "target", "text", "savedAt"]) &&
    id(value.draftId) && isDraftRevision(value.revision) && id(value.deviceId) && isDraftPath(value.path) &&
    isDraftTarget(value.target) && typeof value.text === "string" && isDraftTimestamp(value.savedAt);
}
export function isDraftTombstone(value: unknown): value is DraftTombstone {
  return record(value) && keys(value, ["draftId", "revision", "clearedAt"]) && id(value.draftId) &&
    isDraftRevision(value.revision) && isDraftTimestamp(value.clearedAt);
}
export const cloneDraftTarget = (target: DraftTarget): DraftTarget => target.kind === "pending-child"
  ? { ...target, parentChain: target.parentChain.map(p => ({ ...p })) } : { ...target };
export const emptyDraftData = (): PluginDataV2 => ({ version: 2, styles: {}, drafts: [], draftTombstones: [] });
export function cloneDraftData(data: PluginDataV2): PluginDataV2 {
  return { version: 2, styles: Object.fromEntries(Object.entries(data.styles)),
    drafts: data.drafts.map(draft => ({ ...draft, target: cloneDraftTarget(draft.target) })),
    draftTombstones: data.draftTombstones.map(stone => ({ ...stone })) };
}
/** Value equality: object key order is irrelevant; ordered proof arrays are not. */
export function equalDraftValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equalDraftValue(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.hasOwn(b, k) && equalDraftValue(a[k], b[k]));
}
const sameDraft = (a: DraftRecord, b: DraftRecord, legacy: boolean) => a.deviceId === b.deviceId && a.path === b.path &&
  a.text === b.text && equalDraftValue(a.target, b.target) && (legacy || a.savedAt === b.savedAt);
// Deterministic even for equal instants with different ISO representations; retain the original string.
const later = (a: string, b: string) => Date.parse(a) > Date.parse(b) || Date.parse(a) === Date.parse(b) && a > b;
function merge(local: PluginDataV2, incoming: PluginDataV2, legacy = false): DraftDataResult {
  const stones = new Map<string, DraftTombstone>();
  for (const stone of [...local.draftTombstones, ...incoming.draftTombstones]) {
    const previous = stones.get(stone.draftId);
    if (!previous || stone.revision > previous.revision || stone.revision === previous.revision && later(stone.clearedAt, previous.clearedAt)) stones.set(stone.draftId, stone);
  }
  const groups = new Map<string, DraftRecord[]>();
  for (const draft of [...local.drafts, ...incoming.drafts]) {
    const group = groups.get(draft.draftId) ?? []; group.push(draft); groups.set(draft.draftId, group);
  }
  const drafts: DraftRecord[] = [];
  for (const [draftId, group] of groups) {
    const revision = group.reduce((max, item) => Math.max(max, item.revision), 0);
    if ((stones.get(draftId)?.revision ?? -1) >= revision) continue;
    const candidates = group.filter(item => item.revision === revision), first = candidates[0]!;
    if (!candidates.every(item => sameDraft(first, item, legacy))) return { ok: false, reason: "plugin-data-invalid" };
    drafts.push(candidates.reduce((latest, item) => later(item.savedAt, latest.savedAt) ? item : latest, first));
  }
  return { ok: true, data: cloneDraftData({ version: 2, styles: incoming.styles, drafts, draftTombstones: [...stones.values()] }) };
}
/** Clock-independent persisted-data validation precedes lossless v1 promotion. */
export function validateDraftData(value: unknown): DraftDataResult {
  try {
    if (!record(value) || !Object.hasOwn(value, "version")) return { ok: false, reason: "plugin-data-invalid" };
    if (value.version !== 1 && value.version !== 2) return { ok: false, reason: "plugin-data-unknown-version" };
    const styles = value.styles;
    if (!keys(value, ["version", "styles", "drafts", "draftTombstones"]) || !record(styles) ||
        !Reflect.ownKeys(styles).every(k => typeof k === "string" && isDraftPath(k) && typeof styles[k] === "string") ||
        !dense(value.drafts, item => isDraftRecord(item) && (value.version === 2 || item.target.kind !== "pending-child")) ||
        !dense(value.draftTombstones, isDraftTombstone)) return { ok: false, reason: "plugin-data-invalid" };
    return merge(emptyDraftData(), { ...value, version: 2 } as unknown as PluginDataV2, value.version === 1);
  } catch { return { ok: false, reason: "plugin-data-invalid" }; }
}
export const mergeDraftData = (local: PluginDataV2, incoming: PluginDataV2): DraftDataResult => merge(local, incoming);
export const draftTextBytes = (text: string): number => new TextEncoder().encode(text).byteLength;
// Automatic presentation only: unknown age (future capture) stays available in the manual list.
export const isDraftExpired = (savedAt: string, now: number): boolean =>
  Date.parse(savedAt) > now || now - Date.parse(savedAt) >= NOTE_DRAFT_LIMITS.autoPresentDays * 86_400_000;
export function serializeDraftData(value: unknown): string {
  const parsed = validateDraftData(value); if (!parsed.ok) throw new Error(parsed.reason);
  return JSON.stringify(parsed.data);
}

/** Queue normalization preserves the observed envelope until the store owns promotion. */
export function mergeDraftDataSources(previous: unknown, incoming: unknown): unknown {
  if (incoming === null) return null;
  const next = validateDraftData(incoming);
  if (!next.ok) return incoming;
  const prior = previous == null ? undefined : validateDraftData(previous);
  const incomingVersion = (incoming as { version: number }).version;
  if (!prior?.ok) return { ...next.data, version: incomingVersion };
  const previousVersion = (previous as { version: number }).version;
  // Do not mask a newer reader's observed regression with its old canonical data.
  if (previousVersion === 2 && incomingVersion === 1) return { ...next.data, version: 1 };
  if (previousVersion === 1 && incomingVersion === 1) {
    const legacy = validateDraftData({ version: 1, styles: next.data.styles,
      drafts: [...prior.data.drafts, ...next.data.drafts], draftTombstones: [...prior.data.draftTombstones, ...next.data.draftTombstones] });
    if (!legacy.ok) throw Error(legacy.reason);
    return { ...legacy.data, version: 1 };
  }
  const merged = mergeDraftData(prior.data, next.data);
  if (!merged.ok) throw Error(merged.reason);
  return merged.data;
}
