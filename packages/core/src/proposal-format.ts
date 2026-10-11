import type { SourceRange } from "./domain.js";
import { privacyFailure } from "./proposal-privacy.js";

export type ProposalTarget = Readonly<{ path: readonly string[]; title: string; sourceRange?: SourceRange }>
  | Readonly<{ root: true }> | Readonly<{ item: string }>;
export type ProposalStatus = Readonly<{
  conversation?: "current" | "mentioned" | "history-unavailable" | "not-applicable";
  review?: "not-reviewed" | "reviewing" | "reviewed";
  conclusion?: "open" | "decided" | "deferred";
}>;
export type ProposalSource = Readonly<{
  label?: string;
  excerpt?: string;
}> & (Readonly<{ kind: "message" | "commit" | "file" | "test"; ref: string }>
  | Readonly<{ kind: "pr" | "issue"; ref: number }>);
type ItemCommon = Readonly<{
  id: string;
  target: ProposalTarget;
  dependsOn?: readonly string[];
  status?: ProposalStatus;
  provenance: "conversation" | "artifact" | "user" | "ai-suggestion";
  sources?: readonly ProposalSource[];
  rationale?: string;
}>;
export type ProposalItem = ItemCommon & (
  | Readonly<{ op: "insertChild"; payload: Readonly<{ text: string; index?: number }> }>
  | Readonly<{ op: "insertSibling"; payload: Readonly<{ text: string; where: "before" | "after" }> }>
  | Readonly<{ op: "rename"; payload: Readonly<{ text: string }> }>
  | Readonly<{ op: "move"; payload: Readonly<{ parent: ProposalTarget; index?: number }> }>
  | Readonly<{ op: "updateNote"; payload: Readonly<{ note: string; mode: "append" | "replace" }> }>
  | Readonly<{ op: "setStatus"; payload: Readonly<Record<string, never>> }>
);
export type ProposalFile = Readonly<{
  schema: "thoughtforge.proposal/v0";
  mapPath: string;
  baseVersion: string;
  task: Readonly<{ host: "codex" | "claude"; threadId: string; branch?: string; issue?: number }>;
  observedThrough: Readonly<{
    host: "codex" | "claude";
    threadId: string;
    lastEventId?: string;
    observedAt: string;
    gitHead?: string;
  }>;
  createdAt: string;
  items: readonly ProposalItem[];
}>;
export type ProposalValidationResult = Readonly<{ ok: true; proposal: ProposalFile }>
  | Readonly<{ ok: false; reason: string; redaction?: "omitted_unknown_sensitive_value" }>;
export type ParsedProposalResult = Readonly<{ ok: true; proposal: ProposalFile; id: string }>
  | Exclude<ProposalValidationResult, { ok: true }>;

const maxFileBytes = 1_000_000;
const itemIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const shaPattern = /^sha256:[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const hostValues = ["codex", "claude"];
const operationValues = ["insertChild", "insertSibling", "rename", "move", "updateNote", "setStatus"];
const provenanceValues = ["conversation", "artifact", "user", "ai-suggestion"];
const own = (value: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown, minimum = 0, maximum = Infinity): value is string =>
  typeof value === "string" && [...value].length >= minimum && [...value].length <= maximum;
const integer = (value: unknown, minimum: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
const oneOf = (value: unknown, choices: readonly string[]): boolean => typeof value === "string" && choices.includes(value);
const shape = (value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> =>
  object(value) && required.every((key) => own(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const optional = (value: Record<string, unknown>, key: string, valid: (field: unknown) => boolean): boolean => !own(value, key) || valid(value[key]);
const itemId = (value: unknown): value is string => typeof value === "string" && itemIdPattern.test(value);

function relativePath(value: unknown): value is string {
  return string(value, 1) && !/^[A-Za-z][A-Za-z\d+.-]*:/.test(value) && !/[\\\u0000-\u001f]/.test(value)
    && value.split("/").every((part) => part.length > 0 && part !== ".." && part !== ".");
}

function timestamp(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const monthLength = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const calendarValid = m >= 1 && m <= 12 && d >= 1 && d <= monthLength[m - 1]!
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 60
    && (!offsetHour || Number(offsetHour) <= 23) && (!offsetMinute || Number(offsetMinute) <= 59);
  if (!calendarValid || Number(second) !== 60) return calendarValid;
  // RFC 3339 permits a positive leap second at the end of a UTC month.
  // Normalize it only for comparison; keep the original timestamp in the proposal.
  const beforeLeap = new Date(Date.parse(value.replace(/:60(?=(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$)/, ":59")));
  const afterLeap = new Date(beforeLeap.getTime() + 1000);
  return beforeLeap.getUTCHours() === 23 && beforeLeap.getUTCMinutes() === 59 && afterLeap.getUTCDate() === 1;
}

/** RFC 3339 comparison value, including leap-second notation unsupported by Date.parse. */
export function proposalTimestampMillis(value: string): number {
  if (!timestamp(value)) return Number.NaN;
  const leap = /:60(?=(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$)/;
  return leap.test(value) ? Date.parse(value.replace(leap, ":59")) + 1000 : Date.parse(value);
}

function sourceRange(value: unknown): boolean {
  if (!shape(value, ["start", "end"])) return false;
  const position = (v: unknown): v is { line: number; column: number } => shape(v, ["line", "column"]) && integer(v.line, 1) && integer(v.column, 1);
  return position(value.start) && position(value.end)
    && (value.end.line > value.start.line || (value.end.line === value.start.line && value.end.column >= value.start.column));
}

function target(value: unknown, allowRoot: boolean): boolean {
  if (shape(value, ["root"])) return allowRoot && value.root === true;
  if (shape(value, ["item"])) return itemId(value.item);
  return shape(value, ["path", "title"], ["sourceRange"]) && Array.isArray(value.path)
    && Array.from(value.path).every((part) => string(part)) && string(value.title) && optional(value, "sourceRange", sourceRange);
}

function status(value: unknown): boolean {
  return shape(value, [], ["conversation", "review", "conclusion"])
    && optional(value, "conversation", (field) => oneOf(field, ["current", "mentioned", "history-unavailable", "not-applicable"]))
    && optional(value, "review", (field) => oneOf(field, ["not-reviewed", "reviewing", "reviewed"]))
    && optional(value, "conclusion", (field) => oneOf(field, ["open", "decided", "deferred"]));
}

function fileReference(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(.*?)(?:#L([1-9]\d*)(?:-L([1-9]\d*))?)?$/.exec(value);
  return !!match && relativePath(match[1]) && !match[1]!.includes("#")
    && (!match[3] || Number(match[3]) >= Number(match[2]));
}

function source(value: unknown): boolean {
  if (!shape(value, ["kind", "ref"], ["label", "excerpt"]) || !optional(value, "label", (field) => string(field, 0, 120))
    || !optional(value, "excerpt", (field) => string(field, 0, 500))) return false;
  switch (value.kind) {
    case "message": return string(value.ref, 1);
    case "commit": return typeof value.ref === "string" && commitPattern.test(value.ref);
    case "pr": case "issue": return integer(value.ref, 1);
    case "file": return fileReference(value.ref);
    case "test": return string(value.ref, 1, 200) && !/[\r\n]/.test(value.ref);
    default: return false;
  }
}

function payload(value: Record<string, unknown>): boolean {
  const p = value.payload;
  switch (value.op) {
    case "insertChild": return shape(p, ["text"], ["index"]) && string(p.text, 1, 200) && optional(p, "index", (field) => integer(field, 0));
    case "insertSibling": return shape(p, ["text", "where"]) && string(p.text, 1, 200) && oneOf(p.where, ["before", "after"]);
    case "rename": return shape(p, ["text"]) && string(p.text, 1, 200);
    case "move": return shape(p, ["parent"], ["index"]) && target(p.parent, true) && optional(p, "index", (field) => integer(field, 0));
    case "updateNote": return shape(p, ["note", "mode"]) && string(p.note, 1, 4000) && oneOf(p.mode, ["append", "replace"]);
    case "setStatus": return shape(p, []);
    default: return false;
  }
}

function item(value: unknown): boolean {
  if (!shape(value, ["id", "op", "target", "payload", "provenance"], ["dependsOn", "status", "sources", "rationale"])) return false;
  return itemId(value.id) && oneOf(value.op, operationValues) && target(value.target, value.op === "insertChild")
    && payload(value) && oneOf(value.provenance, provenanceValues)
    && optional(value, "dependsOn", (field) => Array.isArray(field) && Array.from(field).every(itemId))
    && optional(value, "status", status) && optional(value, "sources", (field) => Array.isArray(field) && field.length <= 20 && Array.from(field).every(source))
    && optional(value, "rationale", (field) => string(field, 0, 1000))
    && !(object(value.status) && value.status.conclusion === "decided" && (!Array.isArray(value.sources) || value.sources.length === 0));
}

/** Uses the same input boundary classifier for filenames and other external labels. */
export function isProposalTextSensitive(value: string): boolean {
  return privacyFailure(value);
}

export function validateProposal(value: unknown): ProposalValidationResult {
  const invalid = (reason: string): ProposalValidationResult => ({ ok: false, reason });
  if (privacyFailure(value)) return { ok: false, reason: "秘密情報または除外対象の記録を含むため、整理案を読み込めません。", redaction: "omitted_unknown_sensitive_value" };
  if (!shape(value, ["schema", "mapPath", "baseVersion", "task", "observedThrough", "createdAt", "items"])) return invalid("整理案のフィールドが不正です。");
  if (value.schema !== "thoughtforge.proposal/v0" || !relativePath(value.mapPath) || typeof value.baseVersion !== "string" || !shaPattern.test(value.baseVersion)) return invalid("整理案の形式、対象マップ、または版が不正です。");
  const t = value.task;
  if (!shape(t, ["host", "threadId"], ["branch", "issue"]) || !oneOf(t.host, hostValues) || !string(t.threadId, 1, 200)
    || !optional(t, "branch", (field) => string(field, 1, 200)) || !optional(t, "issue", (field) => integer(field, 1))) return invalid("タスクの形式が不正です。");
  const o = value.observedThrough;
  if (!shape(o, ["host", "threadId", "observedAt"], ["lastEventId", "gitHead"]) || !oneOf(o.host, hostValues) || !string(o.threadId, 1, 200)
    || !timestamp(o.observedAt) || !optional(o, "lastEventId", (field) => string(field, 1, 200))
    || !optional(o, "gitHead", (field) => typeof field === "string" && commitPattern.test(field))) return invalid("観測した範囲の形式が不正です。");
  if (t.host !== o.host || t.threadId !== o.threadId) return invalid("タスクと観測した範囲の識別子が一致しません。"); // FR-GR-7
  if (!timestamp(value.createdAt) || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 200 || !Array.from(value.items).every(item)) return invalid("整理案の日時または項目の形式が不正です。");
  const proposal = value as unknown as ProposalFile;
  const byId = new Map(proposal.items.map((entry, index) => [entry.id, { entry, index }]));
  if (byId.size !== proposal.items.length) return invalid("項目のIDが重複しています。");
  for (const [index, entry] of proposal.items.entries()) {
    if ((entry.dependsOn ?? []).some((id) => !byId.has(id))) return invalid("依存する項目が存在しません。");
    const refs = entry.op === "move" ? [entry.target, entry.payload.parent] : [entry.target];
    for (const ref of refs) {
      if (!("item" in ref)) continue;
      const dependency = byId.get(ref.item);
      if (!dependency || dependency.index >= index || !["insertChild", "insertSibling"].includes(dependency.entry.op) || !(entry.dependsOn ?? []).includes(ref.item)) return invalid("新しいノードの参照または直接の依存関係が不正です。");
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const acyclic = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    if (!(byId.get(id)!.entry.dependsOn ?? []).every(acyclic)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  if (!proposal.items.every((entry) => acyclic(entry.id))) return invalid("項目の依存関係が循環しています。");
  return { ok: true, proposal };
}

export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseProposalFile(raw: string): Promise<ParsedProposalResult> {
  if (new TextEncoder().encode(raw).byteLength > maxFileBytes) return { ok: false, reason: "整理案ファイルは1 MBまでです。" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, reason: "整理案は正しいJSONである必要があります。" }; }
  const result = validateProposal(value);
  return result.ok ? { ...result, id: await sha256Text(raw) } : result;
}
