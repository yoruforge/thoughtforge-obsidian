export type DebugScope =
  | "input"
  | "ime"
  | "focus"
  | "node"
  | "command"
  | "patch"
  | "webview"
  | "parser"
  | "serializer"
  | "edge-layout"
  | "selection"
  | "undo-redo";

export type DebugSource = "webview" | "extension" | "core" | "test";
export type DebugTraceResult = "ok" | "ignored" | "failed";

export type DebugTraceRecord = {
  ts: string;
  scope: DebugScope;
  event: string;
  source?: DebugSource;
  nodeId?: string;
  edgeId?: string;
  command?: string;
  payload?: unknown;
  result?: DebugTraceResult;
  reason?: string;
};

export type DebugTraceSettingReader = () => boolean | undefined;
declare const process: { env: Record<string, string | undefined> };

export const THOUGHTFORGE_TRACE_PREFIX = "[thoughtforge.trace]";
const MAX_STRING_PREVIEW_LENGTH = 120;
export const THOUGHTFORGE_DEBUG_TRACE_MAX_JSONL_BYTES = 262_144;
export const THOUGHTFORGE_DEBUG_TRACE_MAX_PAYLOAD_JSON_LENGTH = 8_192;
let debugTraceSettingReader: DebugTraceSettingReader | undefined;

export function setDebugTraceSettingReader(reader: DebugTraceSettingReader | undefined): void {
  debugTraceSettingReader = reader;
}

export function isDebugTraceEnabled(): boolean {
  const settingEnabled = debugTraceSettingReader?.();
  if (settingEnabled !== undefined) {
    return settingEnabled;
  }

  return process.env.THOUGHTFORGE_DEBUG_TRACE === "1";
}

function isSensitiveKey(key: string): boolean {
  return /(?:secret|token|password|authorization|api[_-]?key|private[_-]?key|access[_-]?key|refresh[_-]?key)/i.test(
    key
  );
}

function shouldSummarizeContentKey(key: string): boolean {
  return /^(?:markdown|body|content|fallbackText|text|note|latestText|nextText|value|data)$/i.test(
    key
  );
}

function summarizeString(value: string): unknown {
  if (value.length <= MAX_STRING_PREVIEW_LENGTH) {
    return value;
  }
  return { length: value.length };
}

export function sanitizeDebugPayload(
  payload: unknown,
  options: { maxSerializedLength?: number } = {}
): unknown {
  const seen = new WeakSet<object>();

  function sanitize(value: unknown, key = ""): unknown {
    if (isSensitiveKey(key)) {
      return "[redacted]";
    }

    if (typeof value === "string") {
      if (shouldSummarizeContentKey(key)) {
        return { length: value.length };
      }
      return summarizeString(value);
    }

    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "undefined"
    ) {
      return value;
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    if (typeof value === "symbol" || typeof value === "function") {
      return `[${typeof value}]`;
    }

    if (typeof value !== "object") {
      return String(value);
    }

    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitize(entryValue, entryKey);
    }
    return sanitized;
  }

  const sanitized = sanitize(payload);
  const maxSerializedLength =
    options.maxSerializedLength ?? THOUGHTFORGE_DEBUG_TRACE_MAX_PAYLOAD_JSON_LENGTH;
  const serialized = JSON.stringify(sanitized);
  if (serialized === undefined) {
    return sanitized;
  }
  if (serialized.length <= maxSerializedLength) {
    return sanitized;
  }
  return {
    truncated: true,
    originalJsonLength: serialized.length,
    maxJsonLength: maxSerializedLength
  };
}

export function safeStringifyDebugTraceRecord(
  record: DebugTraceRecord,
  options: { maxPayloadSerializedLength?: number } = {}
): string {
  return JSON.stringify({
    ...record,
    payload: sanitizeDebugPayload(record.payload, {
      maxSerializedLength: options.maxPayloadSerializedLength
    })
  });
}

export function trimDebugTraceJsonlToMaxBytes(
  text: string,
  maxBytes = THOUGHTFORGE_DEBUG_TRACE_MAX_JSONL_BYTES
): string {
  if (maxBytes <= 0) {
    return "";
  }
  if (new TextEncoder().encode(text).byteLength <= maxBytes) {
    return text;
  }

  const lines = text.split("\n").filter((line) => line.length > 0);
  const kept: string[] = [];
  let byteLength = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = `${lines[index]}\n`;
    const candidateBytes = new TextEncoder().encode(candidate).byteLength;
    if (kept.length > 0 && byteLength + candidateBytes > maxBytes) {
      break;
    }
    kept.unshift(lines[index]);
    byteLength += candidateBytes;
    if (byteLength >= maxBytes) {
      break;
    }
  }

  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

export function traceDebugEvent(event: Omit<DebugTraceRecord, "ts">): void {
  if (!isDebugTraceEnabled()) {
    return;
  }

  const record: DebugTraceRecord = {
    ts: new Date().toISOString(),
    ...event
  };

  console.debug(THOUGHTFORGE_TRACE_PREFIX, safeStringifyDebugTraceRecord(record));
}
