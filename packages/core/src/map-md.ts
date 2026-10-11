import type { SourceRange, ThoughtMap } from './domain.js';
import type { InsertSubtreeNode, WrapInNewParentCommand } from './semantic-commands.js';
import { applyTextPatches, type TextPatch } from './patch.js';
import { sha256 } from './note-mode/hash.js';
import { MapMdSource, MapMdRejection, refuse, keys, record, label, rawSpan, utf8Length,
  wrapEdits, type MapMdRejectReason, type RawSpan } from './map-md-source.js';

export type { MapMdRejectReason, RawSpan } from './map-md-source.js';
export type MapMdFailure = Readonly<{ ok: false; reason: MapMdRejectReason }>;
/** Hashes are lowercase SHA-256 hex over exact UTF-8 raw (no `sha256:` prefix).
 * These core guards do not replace host permission, provenance or CAS gates. */
export type MapMdGuard = Readonly<{ baseHash: string; targets: readonly Readonly<{
  kind: 'node'; nodeId: string; titleSource: string; parentRawHash?: string
}>[] }>;
/** Host-selected finite bounds, not product defaults. Depth counts root as 1;
 * paste also checks absolute destination depth. Byte bounds are UTF-8. */
export type MapMdSubtreeLimits = Readonly<{
  maxNodes: number; maxDepth: number; maxPayloadBytes: number;
  maxSourceBytes: number; maxInsertionBytes: number;
}>;
export type MapMdSubtreeProof = Readonly<{
  baseHash: string; sourceNodeId: string; titleSource: string;
  sourceRawSpan: RawSpan; sourceRawHash: string; payload: InsertSubtreeNode;
  payloadHash: string; nodeCount: number; depth: number; payloadBytes: number;
}>;
export type MapMdPasteCommand = Readonly<{
  type: 'node.pasteSubtreeAsLastChild'; parentId: string; expectedChildCount: number;
  payloadHash: string; proof: MapMdSubtreeProof;
}>;
export type MapMdPatchSuccess = Readonly<{
  ok: true; patches: readonly TextPatch[]; beforeRawText: string; nextRawText: string; nextLfText: string;
  beforeHash: string; afterHash: string; resultNodeId: string;
  idMap: Readonly<Record<string, string>>; inverseIdMap: Readonly<Record<string, string>>;
  /** Request-local new node IDs; unrelated to semantic requestId consumption. */
  requestNodeIdMap: Readonly<Record<string, string>>; createdNodeIds: readonly string[];
  insertedRawSpan?: RawSpan; insertedSubtreeRange?: SourceRange;
}>;
export type MapMdPatchResult = MapMdPatchSuccess | MapMdFailure;

function boundary<T>(run: () => T): T | MapMdFailure {
  try { return run(); }
  catch (error) {
    if (error instanceof MapMdRejection) return { ok: false, reason: error.reason };
    throw error;
  }
}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
function checkedLimits(limits: MapMdSubtreeLimits): void {
  if (!record(limits) || !keys(limits, 'maxDepth,maxInsertionBytes,maxNodes,maxPayloadBytes,maxSourceBytes') ||
    Object.values(limits).some(n => !Number.isSafeInteger(n) || n <= 0)) refuse('payload-limit');
}
type Normalized = { payload: InsertSubtreeNode; canonical: string; count: number; depth: number; bytes: number };
/** Iterative clone and serialization avoid cycle/shared references and recursion
 * failure; caller metadata is rejected, never silently dropped. */
function normalizePayload(value: unknown, limits: MapMdSubtreeLimits): Normalized {
  checkedLimits(limits);
  type Mutable = { text: string; children: Mutable[] };
  let root: Mutable | undefined, count = 0, depth = 0;
  const seen = new Set<object>(), all: Mutable[] = [];
  const stack: { value: unknown; depth: number; parent?: Mutable; index?: number }[] = [{ value, depth: 1 }];
  while (stack.length) {
    const item = stack.pop()!, v = item.value;
    if (!record(v) || !keys(v, 'children,text')) refuse('invalid-payload');
    const text = v.text;
    if (!label(text) || !Array.isArray(v.children) || seen.has(v)) refuse('invalid-payload');
    if (++count > limits.maxNodes || item.depth > limits.maxDepth || v.children.length > limits.maxNodes - count) refuse('payload-limit');
    if (Object.keys(v.children).length !== v.children.length) refuse('invalid-payload');
    seen.add(v); depth = Math.max(depth, item.depth);
    const clone: Mutable = { text, children: [] }; all.push(clone);
    if (item.parent) item.parent.children[item.index!] = clone; else root = clone;
    for (let i = v.children.length - 1; i >= 0; i--) stack.push({ value: v.children[i], depth: item.depth + 1, parent: clone, index: i });
  }
  const tokens: string[] = [], pending: (Mutable | string)[] = [root!];
  let bytes = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (typeof next === 'string') {
      bytes += utf8Length(next); if (bytes > limits.maxPayloadBytes) refuse('payload-limit');
      tokens.push(next);
    } else {
      // Cheap label bound before JSON escaping/allocating its canonical form.
      if (utf8Length(next.text) > limits.maxPayloadBytes) refuse('payload-limit');
      pending.push(']}');
      for (let i = next.children.length - 1; i >= 0; i--) { pending.push(next.children[i]); if (i > 0) pending.push(','); }
      pending.push('{"text":' + JSON.stringify(next.text) + ',"children":[');
    }
  }
  for (const node of all.reverse()) { Object.freeze(node.children); Object.freeze(node); }
  return { payload: root!, canonical: tokens.join(''), count, depth, bytes };
}

function checkGuard(source: MapMdSource, nodeId: string, guard: unknown, requireRaw: boolean): void {
  if (!record(guard) || !keys(guard, 'baseHash,targets') || !hash(guard.baseHash) ||
    !Array.isArray(guard.targets) || guard.targets.length !== 1) refuse('bad-guard');
  const target = guard.targets[0];
  if (!record(target) || !(keys(target, 'kind,nodeId,titleSource') && !requireRaw || keys(target, 'kind,nodeId,parentRawHash,titleSource')) ||
    target.kind !== 'node' || target.nodeId !== nodeId || typeof target.titleSource !== 'string' ||
    ('parentRawHash' in target && !hash(target.parentRawHash))) refuse('bad-guard');
  const node = source.node(nodeId);
  if (guard.baseHash !== sha256(source.raw) || target.titleSource !== node.text) refuse('stale');
  if ('parentRawHash' in target) {
    const span = source.span(nodeId);
    if (target.parentRawHash !== sha256(source.raw.slice(span.startUtf16, span.endUtf16))) refuse('stale');
  }
}

export function createMapMdGuard(raw: string, nodeId: string): Readonly<{ ok: true; guard: MapMdGuard }> | MapMdFailure {
  return boundary(() => {
    const source = new MapMdSource(raw), node = source.node(nodeId), span = source.span(nodeId);
    return { ok: true as const, guard: { baseHash: sha256(raw), targets: [{ kind: 'node' as const, nodeId,
      titleSource: node.text, parentRawHash: sha256(raw.slice(span.startUtf16, span.endUtf16)) }] } };
  });
}

function proofFor(source: MapMdSource, sourceNodeId: string, normalized: Normalized, limits: MapMdSubtreeLimits): MapMdSubtreeProof {
  const node = source.node(sourceNodeId), envelope = source.envelope(sourceNodeId);
  if (envelope.ownedLines.some(line => !source.atLine.has(line))) refuse('unrepresentable-source');
  const pending = [{ id: sourceNodeId, payload: normalized.payload }];
  let count = 0;
  while (pending.length) {
    const next = pending.pop()!, current = source.node(next.id); count++;
    if (current.note !== undefined || current.text !== next.payload.text || current.children.length !== next.payload.children.length) refuse('payload-mismatch');
    for (let i = current.children.length - 1; i >= 0; i--) pending.push({ id: current.children[i], payload: next.payload.children[i] });
  }
  if (count !== normalized.count) refuse('payload-mismatch');
  const span = source.span(sourceNodeId);
  if (span.endByte - span.startByte > limits.maxSourceBytes) refuse('payload-limit');
  return Object.freeze({ baseHash: sha256(source.raw), sourceNodeId, titleSource: node.text,
    sourceRawSpan: Object.freeze(span), sourceRawHash: sha256(source.raw.slice(span.startUtf16, span.endUtf16)),
    payload: normalized.payload, payloadHash: sha256(normalized.canonical), nodeCount: normalized.count,
    depth: normalized.depth, payloadBytes: normalized.bytes });
}

/** Content proof only. The host retains provenance, ACK and clipboard ownership. */
export function createMapMdSubtreeProof(raw: string, sourceNodeId: string, payload: unknown,
  limits: MapMdSubtreeLimits): Readonly<{ ok: true; proof: MapMdSubtreeProof }> | MapMdFailure {
  return boundary(() => {
    const normalized = normalizePayload(payload, limits);
    return { ok: true as const, proof: proofFor(new MapMdSource(raw), sourceNodeId, normalized, limits) };
  });
}

function contentSignature(source: MapMdSource, id: string): string {
  return JSON.stringify((source.content.get(id) ?? []).map(c => [c.kind, c.raw]));
}
function nodeAt(source: MapMdSource, offset: number, text: string): string {
  const p = source.position(offset), node = source.atLine.get(p.line);
  if (!node || source.offset(node.source!.range.start) !== offset || node.text !== text) refuse('structure-changed');
  return node.id;
}
/** Prove every surviving identity via its exact unchanged bullet and shifted
 * source start; equal labels or parser ordinal IDs are never identity evidence. */
function proveExisting(before: MapMdSource, after: MapMdSource, patches: readonly TextPatch[]) {
  const edits = patches.map(p => ({ at: before.offset(p.range.start), end: before.offset(p.range.end), text: p.text }));
  if (edits.some(e => e.at !== e.end)) refuse('structure-changed');
  const idMap: Record<string, string> = {}, inverseIdMap: Record<string, string> = {};
  for (const node of Object.values(before.map.nodesById)) {
    const at = before.offset(node.source!.range.start);
    const offset = at + edits.reduce((delta, edit) => delta + (edit.at <= at ? edit.text.length : 0), 0);
    const id = nodeAt(after, offset, node.text);
    if (Object.hasOwn(inverseIdMap, id) || node.note !== after.node(id).note || contentSignature(before, node.id) !== contentSignature(after, id)) refuse('structure-changed');
    idMap[node.id] = id; inverseIdMap[id] = node.id;
  }
  if (before.map.title !== after.map.title) refuse('structure-changed');
  return { idMap, inverseIdMap };
}
function equalIds(left: readonly string[], right: readonly string[]): void {
  if (left.length !== right.length || left.some((id, i) => id !== right[i])) refuse('structure-changed');
}
function proveTree(before: ThoughtMap, after: ThoughtMap, idMap: Record<string, string>, modify: (ids: readonly string[], owner: string | null) => readonly string[]): void {
  equalIds(after.roots, modify(before.roots.map(id => idMap[id]), null));
  for (const node of Object.values(before.nodesById)) equalIds(after.nodesById[idMap[node.id]].children,
    modify(node.children.map(id => idMap[id]), node.id));
}
function success(before: MapMdSource, after: MapMdSource, patches: readonly TextPatch[],
  maps: ReturnType<typeof proveExisting>, resultNodeId: string, createdNodeIds: string[], requestNodeIdMap: Record<string, string> = {}): MapMdPatchSuccess {
  if (Object.keys(after.map.nodesById).length !== Object.keys(before.map.nodesById).length + createdNodeIds.length ||
    new Set(createdNodeIds).size !== createdNodeIds.length || createdNodeIds.some(id => Object.hasOwn(maps.inverseIdMap, id))) refuse('structure-changed');
  return { ok: true, patches, beforeRawText: before.raw, nextRawText: after.raw, nextLfText: after.lf,
    beforeHash: sha256(before.raw), afterHash: sha256(after.raw), resultNodeId, ...maps, requestNodeIdMap, createdNodeIds };
}

export function createMapMdWrapPatches(raw: string, command: WrapInNewParentCommand, guard: unknown): MapMdPatchResult {
  return boundary(() => {
    if (!record(command) || !(keys(command, 'nextNodeId,nodeId,text,type') || keys(command, 'intentRange,nextNodeId,nodeId,text,type')) ||
      command.type !== 'node.wrapInNewParent' || typeof command.nodeId !== 'string') refuse('invalid-command');
    const before = new MapMdSource(raw);
    if (command.intentRange !== undefined) {
      const range = command.intentRange;
      if (!record(range) || !keys(range, 'end,start') || !record(range.start) || !record(range.end) ||
        !keys(range.start, 'column,line') || !keys(range.end, 'column,line')) refuse('invalid-command');
      if (before.offset(range.end) < before.offset(range.start)) refuse('invalid-command');
    }
    checkGuard(before, command.nodeId, guard, false);
    const patches = wrapEdits(before, command), after = new MapMdSource(applyTextPatches(raw, patches));
    if (Object.hasOwn(after.map.nodesById, command.nextNodeId)) refuse('identity-collision');
    const maps = proveExisting(before, after, patches), target = before.node(command.nodeId);
    const wrapper = nodeAt(after, before.starts[target.source!.range.start.line - 1] + before.indent(target), command.text);
    equalIds(after.node(wrapper).children, [maps.idMap[command.nodeId]]);
    if (after.node(wrapper).note !== undefined || after.content.has(wrapper)) refuse('structure-changed');
    proveTree(before.map, after.map, maps.idMap, ids => ids.map(id => id === maps.idMap[command.nodeId] ? wrapper : id));
    return success(before, after, patches, maps, wrapper, [wrapper], { [command.nextNodeId]: wrapper });
  });
}

export function createMapMdPastePatches(raw: string, command: MapMdPasteCommand, guard: unknown, limits: MapMdSubtreeLimits): MapMdPatchResult {
  return boundary(() => {
    if (!record(command) || !keys(command, 'expectedChildCount,parentId,payloadHash,proof,type') || command.type !== 'node.pasteSubtreeAsLastChild' ||
      typeof command.parentId !== 'string' || !command.parentId || !Number.isSafeInteger(command.expectedChildCount) || command.expectedChildCount < 0) refuse('invalid-command');
    const proof = command.proof;
    if (!record(proof) || !keys(proof, 'baseHash,depth,nodeCount,payload,payloadBytes,payloadHash,sourceNodeId,sourceRawHash,sourceRawSpan,titleSource') ||
      typeof proof.sourceNodeId !== 'string' || !hash(proof.baseHash) || !hash(proof.payloadHash) || command.payloadHash !== proof.payloadHash) refuse('invalid-proof');
    const normalized = normalizePayload(proof.payload, limits);
    if (sha256(normalized.canonical) !== proof.payloadHash) refuse('invalid-proof');
    const before = new MapMdSource(raw);
    if (proof.baseHash !== sha256(raw)) refuse('stale-proof');
    const derived = proofFor(before, proof.sourceNodeId, normalized, limits);
    if (proof.titleSource !== derived.titleSource || proof.sourceRawHash !== derived.sourceRawHash || proof.payloadHash !== derived.payloadHash ||
      proof.nodeCount !== derived.nodeCount || proof.depth !== derived.depth || proof.payloadBytes !== derived.payloadBytes ||
      !record(proof.sourceRawSpan) || !keys(proof.sourceRawSpan, 'endByte,endUtf16,startByte,startUtf16') ||
      Object.entries(derived.sourceRawSpan).some(([key, value]) => proof.sourceRawSpan[key as keyof RawSpan] !== value)) refuse('invalid-proof');
    checkGuard(before, command.parentId, guard, true);
    const parent = before.node(command.parentId);
    if (parent.children.length !== command.expectedChildCount) refuse('stale');
    if (before.indent(parent) / 2 + 1 + normalized.depth > limits.maxDepth) refuse('payload-limit');
    const position = before.position(before.occupied(command.parentId).end), at = before.offset(position);
    const prefix = at === before.lf.length && !before.lf.endsWith('\n') ? '\n' : '';
    const nodes: { text: string; offset: number }[] = [];
    const pending = [{ node: normalized.payload, depth: before.indent(parent) / 2 + 1 }];
    const lines: string[] = []; let length = prefix.length, insertionBytes = utf8Length(prefix.replaceAll('\n', before.newline));
    while (pending.length) {
      const next = pending.pop()!;
      insertionBytes += next.depth * 2 + 2 + utf8Length(next.node.text) + before.newline.length;
      // EOF without newline omits only the final separator.
      if (insertionBytes - (prefix ? before.newline.length : 0) > limits.maxInsertionBytes) refuse('payload-limit');
      const line = ' '.repeat(next.depth * 2) + '- ' + next.node.text + '\n';
      nodes.push({ text: next.node.text, offset: length + next.depth * 2 });
      length += line.length; lines.push(line);
      for (let i = next.node.children.length - 1; i >= 0; i--) pending.push({ node: next.node.children[i], depth: next.depth + 1 });
    }
    const text = prefix + (prefix ? lines.join('').slice(0, -1) : lines.join(''));
    const patches: TextPatch[] = [{ range: { start: position, end: position }, text }];
    const after = new MapMdSource(applyTextPatches(raw, patches)), maps = proveExisting(before, after, patches);
    const created = nodes.map(node => nodeAt(after, at + node.offset, node.text)), root = created[0];
    const createdSet = new Set(created), stack = [{ payload: normalized.payload, id: root }]; let visited = 0;
    while (stack.length) {
      const next = stack.pop()!, node = after.node(next.id); visited++;
      if (node.text !== next.payload.text || node.note !== undefined || after.content.has(node.id) || node.children.length !== next.payload.children.length) refuse('structure-changed');
      if (!createdSet.has(node.id)) refuse('structure-changed');
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ payload: next.payload.children[i], id: node.children[i] });
    }
    if (visited !== created.length) refuse('structure-changed');
    proveTree(before.map, after.map, maps.idMap, (ids, owner) => owner === command.parentId ? [...ids, root] : ids);
    const rawAt = before.rawOffset(at), inserted = text.replaceAll('\n', before.newline);
    if (after.raw.slice(0, rawAt) !== raw.slice(0, rawAt) || after.raw.slice(rawAt + inserted.length) !== raw.slice(rawAt)) refuse('structure-changed');
    return { ...success(before, after, patches, maps, root, created), insertedRawSpan: rawSpan(after.raw, rawAt, rawAt + inserted.length),
      insertedSubtreeRange: after.node(root).source!.range };
  });
}
