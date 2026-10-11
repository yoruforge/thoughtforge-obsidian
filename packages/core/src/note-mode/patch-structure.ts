import { applyTextPatches, type TextPatch } from "../patch.js";
import { parseNoteMapMarkdown } from "./parser.js";
import { sha256 } from "./hash.js";
import type { NoteMapParseResult, UnmappedBlock } from "./types.js";
import { PatchRejection, reject, type NotePatchResult } from "./patch-commands.js";
import { PatchSource, validatePatches } from "./patch-source.js";

export type EditableNote = Extract<NoteMapParseResult, { status: "editable" }>;
export type OpaqueContent = { kind: UnmappedBlock["kind"]; hash: string; raw: string };
export type SemanticTopic = {
  origin?: string; kind: "heading" | "listItem"; level?: number; text: string;
  task?: string; blockId?: string; note?: string; unmapped: OpaqueContent[]; children: string[];
};
export type SemanticTree = {
  center: { kind: "h1" | "filename"; text: string; note?: string; unmapped: OpaqueContent[] };
  roots: string[]; nodes: Record<string, SemanticTopic>;
};

function opaque(source: PatchSource, blocks: readonly UnmappedBlock[]): OpaqueContent[] {
  return blocks.map(block => {
    const raw = source.slice(block.range);
    if (sha256(raw) !== block.contentHash) reject("structure-changed");
    return { kind: block.kind, hash: block.contentHash, raw };
  });
}
export function semanticTree(parsed: EditableNote): SemanticTree {
  const source = new PatchSource(parsed.lfText), nodes: Record<string, SemanticTopic> = Object.create(null);
  for (const [id, node] of Object.entries(parsed.map.nodesById)) {
    const info = parsed.index.nodes[id];
    if (!info || source.slice(info.titleRange) !== node.text || source.hashRange(info.ownRange) !== info.ownRangeHash) reject("structure-changed");
    nodes[id] = { origin: id, kind: info.kind, level: info.headingLevel, text: node.text,
      task: info.taskMarker, blockId: info.blockId, note: node.note,
      unmapped: opaque(source, info.unmapped), children: [...node.children] };
  }
  return { center: { kind: parsed.index.center.kind, text: parsed.map.title, note: parsed.index.center.note,
    unmapped: opaque(source, parsed.index.center.unmapped) }, roots: [...parsed.map.roots], nodes };
}
export function parseOptions(parsed: EditableNote) {
  const sourceId = parsed.map.source?.sourceId ?? Object.values(parsed.map.nodesById)[0]?.source?.sourceId;
  return { fallbackTitle: parsed.index.center.kind === "filename" ? parsed.index.center.fallbackTitle : parsed.map.title,
    ...(sourceId === undefined ? {} : { sourceId }) };
}
export function restoreNewlines(text: string, newline: "lf" | "crlf"): string {
  return newline === "crlf" ? text.replaceAll("\n", "\r\n") : text;
}

/** Verify the supplied editable snapshot against its own source, never Vault state. */
export function validateSnapshot(parsed: EditableNote): void {
  if (parsed.status !== "editable" || parsed.mode !== "note" || !["lf", "crlf"].includes(parsed.newline)) reject("structure-changed");
  new PatchSource(parsed.lfText);
  const raw = restoreNewlines(parsed.lfText, parsed.newline);
  if (sha256(raw) !== parsed.contentHash) reject("structure-changed");
  const canonical = parseNoteMapMarkdown(raw, parseOptions(parsed));
  if (canonical.status !== "editable" || JSON.stringify(canonical.map) !== JSON.stringify(parsed.map)
    || JSON.stringify(canonical.index) !== JSON.stringify(parsed.index)) reject("structure-changed");
}

export function children(tree: SemanticTree, parent: string | null): string[] {
  return parent === null ? tree.roots : tree.nodes[parent].children;
}
export function location(tree: SemanticTree, id: string): { parent: string | null; index: number } {
  const rootIndex = tree.roots.indexOf(id);
  if (rootIndex >= 0) return { parent: null, index: rootIndex };
  for (const [parent, node] of Object.entries(tree.nodes)) {
    const index = node.children.indexOf(id);
    if (index >= 0) return { parent, index };
  }
  return reject("structure-changed");
}
export function subtree(tree: SemanticTree, id: string): string[] {
  const ids: string[] = [], stack = [id], seen = new Set<string>();
  while (stack.length) {
    const next = stack.pop()!;
    if (seen.has(next) || !tree.nodes[next]) reject("structure-changed");
    seen.add(next); ids.push(next);
    stack.push(...[...tree.nodes[next].children].reverse());
  }
  return ids;
}
export function order(tree: SemanticTree): string[] {
  return tree.roots.flatMap(id => subtree(tree, id));
}

/** The filename exception is calculated from OLD blocks and the first branch boundary. */
export function renameFilenameCenter(parsed: EditableNote, tree: SemanticTree, title: string): void {
  const source = new PatchSource(parsed.lfText);
  const firstRoot = parsed.map.roots.length ? Math.min(...parsed.map.roots.map(id => parsed.index.nodes[id].ownRange.start.line)) : Infinity;
  let blocked = false;
  const noteBlocks: UnmappedBlock[] = [], remaining: OpaqueContent[] = [];
  for (const block of parsed.index.center.unmapped) {
    if (block.kind === "frontmatter") { remaining.push(...opaque(source, [block])); continue; }
    if (!blocked && block.kind === "paragraph" && block.range.start.line < firstRoot) noteBlocks.push(block);
    else { blocked = true; remaining.push(...opaque(source, [block])); }
  }
  const note = noteBlocks.length ? source.slice({ start: noteBlocks[0].range.start, end: noteBlocks.at(-1)!.range.end }) : undefined;
  tree.center = { kind: "h1", text: title, note, unmapped: remaining };
}

function topicSignature(node: SemanticTopic): string {
  return JSON.stringify([node.kind, node.level, node.text, node.task, node.blockId, node.note, node.unmapped.map(block => block.hash)]);
}
function centerSignature(tree: SemanticTree): string {
  return JSON.stringify([tree.center.kind, tree.center.text, tree.center.note, tree.center.unmapped.map(block => block.hash)]);
}
function ledger(tree: SemanticTree): string[] {
  return [tree.center, ...Object.values(tree.nodes)].flatMap(owner => owner.unmapped.map(block =>
    JSON.stringify([block.hash, block.raw]))).sort();
}

/** Internal validation boundary, also usable by fault-injection tests without public hooks. */
export function validateCandidate(parsed: EditableNote, expected: SemanticTree, patches: readonly TextPatch[], selected?: string): NotePatchResult {
  try {
    const source = new PatchSource(parsed.lfText);
    validatePatches(source, patches);
    const nextLfText = applyTextPatches(parsed.lfText, patches);
    // Parsing raw CRLF here is necessary for the UTF-8 byte capacity guard.
    const next = parseNoteMapMarkdown(restoreNewlines(nextLfText, parsed.newline), parseOptions(parsed));
    if (next.status !== "editable") return { ok: false, reason: "result-not-editable",
      ...(next.status === "readOnly" ? { detail: { readOnlyReasons: next.reasons } } : {}) };
    const actual = semanticTree(next);
    if (centerSignature(expected) !== centerSignature(actual) || expected.roots.length !== actual.roots.length
      || JSON.stringify(ledger(expected)) !== JSON.stringify(ledger(actual))) reject("structure-changed");
    const idMap: Record<string, string> = {}, inverseIdMap: Record<string, string> = {};
    const matched: Record<string, string> = Object.create(null);
    const stack = expected.roots.map((id, index) => [id, actual.roots[index]] as const);
    let count = 0;
    while (stack.length) {
      const [oldId, nextId] = stack.pop()!, oldNode = expected.nodes[oldId], nextNode = actual.nodes[nextId];
      if (!oldNode || !nextNode || matched[oldId] || topicSignature(oldNode) !== topicSignature(nextNode)
        || oldNode.children.length !== nextNode.children.length) reject("structure-changed");
      count++; matched[oldId] = nextId;
      if (oldNode.origin !== undefined) { idMap[oldNode.origin] = nextId; inverseIdMap[nextId] = oldNode.origin; }
      for (let i = 0; i < oldNode.children.length; i++) stack.push([oldNode.children[i], nextNode.children[i]]);
    }
    if (count !== Object.keys(expected.nodes).length || count !== Object.keys(actual.nodes).length) reject("structure-changed");
    const resultNodeId = selected === "center" ? "center" : selected === undefined ? undefined : matched[selected];
    if (selected !== undefined && resultNodeId === undefined) reject("structure-changed");
    return { ok: true, patches, nextLfText, idMap, inverseIdMap, ...(resultNodeId === undefined ? {} : { resultNodeId }) };
  } catch (error) {
    if (error instanceof PatchRejection) return { ok: false, reason: error.reason, ...(error.detail ? { detail: error.detail } : {}) };
    if (error instanceof RangeError && /call stack/i.test(error.message)) return { ok: false, reason: "result-not-editable" };
    throw error;
  }
}
