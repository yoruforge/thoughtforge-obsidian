import { sha256 } from "./hash.js";

type Entry = { source: Source; key: string; digest: string };
type Source = { text?: string; ranges: Map<string, Entry> };
type Identity = Readonly<{ text: string }>;

// Private digest-only memo: never retain a parsed model, supplied hash, or a
// successful validation. These bounds do not change parser input limits.
const maxSourceUnits = 2 * 1024 * 1024;
const sources = new Map<string, Source>();
const entries = new Map<Entry, true>();
// These values cannot extend the lifetime of a Source object or its input.
// The globally retained records contain only owned keys and trusted digests.
const bindings = new WeakMap<Identity, { input: string; source: Source }>();

// A short sliced string can retain an arbitrarily large parent allocation.
// Build the retained key from code units so no original backing text is kept.
function ownedText(text: string): string {
  const units = new Uint16Array(Math.min(text.length, 8192)), parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += units.length) {
    const length = Math.min(units.length, text.length - offset);
    for (let i = 0; i < length; i++) units[i] = text.charCodeAt(offset + i);
    parts.push(String.fromCharCode(...units.subarray(0, length)));
  }
  return parts.join("");
}

/** Hash the actual slice after validating UTF-16 bounds, including on hits. */
export function hashOwnRange(text: string, start: number, end: number, identity?: Identity): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > text.length) {
    throw new RangeError("Invalid own range");
  }
  if (text.length > maxSourceUnits) {
    if (identity) bindings.delete(identity);
    return sha256(text.slice(start, end));
  }
  const binding = identity && bindings.get(identity);
  let source = binding && binding.input === text && identity!.text === text && binding.source.text !== undefined
    ? binding.source : sources.get(text);
  if (!source) {
    const retained = ownedText(text);
    source = sources.get(text);
    if (!source) {
      if (sources.size === 2) {
        const [oldText, old] = sources.entries().next().value!;
        sources.delete(oldText);
        for (const entry of old.ranges.values()) entries.delete(entry);
        old.ranges.clear();
        old.text = undefined;
      }
      source = { text: retained, ranges: new Map() };
    }
  }
  const retained = source.text!;
  sources.delete(retained); sources.set(retained, source);
  if (identity && identity.text === text) bindings.set(identity, { input: text, source });
  const key = `${start}:${end}`, cached = source.ranges.get(key);
  if (cached) {
    entries.delete(cached); entries.set(cached, true);
    return cached.digest;
  }
  const digest = sha256(text.slice(start, end));
  // A replaced encoder can reenter hashing. Never revive an evicted source or
  // add a second global entry for a range completed by that nested call.
  if (source.text === undefined || sources.get(source.text) !== source || source.ranges.has(key)) return digest;
  if (entries.size === 5000) {
    const oldest = entries.keys().next().value!;
    entries.delete(oldest); oldest.source.ranges.delete(oldest.key);
  }
  const entry = { source, key, digest };
  source.ranges.set(key, entry); entries.set(entry, true);
  return digest;
}
