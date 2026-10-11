import type { SourcePosition, SourceRange, ThoughtMap, ThoughtNode } from "./domain.js";
import { parseThoughtMapMarkdown } from "./parser.js";
import { createMarkdownPatches, type TextPatch } from "./patch.js";
import { sha256Text, type ProposalFile, type ProposalItem, type ProposalTarget } from "./proposal-format.js";
import type { SemanticCommand } from "./semantic-commands.js";

export type CreatedProposalNode = Readonly<{
  path: readonly string[];
  title: string;
  index: number;
  /** Internal session locator; never part of the proposal JSON format. */
  indices?: readonly number[];
}>;
export type ProposalApplyContext = Readonly<{
  /** Hashes produced by this same proposal in the current editor session only. */
  acceptedHashes?: readonly string[];
  appliedItemIds?: readonly string[];
  createdNodes?: Readonly<Record<string, CreatedProposalNode>>;
}>;
/** IDs name original nodes or the new-node IDs declared by earlier commands. */
export type ProposalApplyRequest = Readonly<{ baseVersion: string; commands: readonly SemanticCommand[] }>;
export type ProposalApplyFailure = Readonly<{ ok: false; reason: string; itemId?: string }>;
export type ProposalApplySuccess = Readonly<{
  ok: true;
  text: string;
  patches: readonly TextPatch[];
  beforeHash: string;
  afterHash: string;
}>;
export type ProposalItemsApplyResult = ProposalApplyFailure | (ProposalApplySuccess & Readonly<{
  appliedItemIds: readonly string[];
  createdNodes: Record<string, CreatedProposalNode>;
}>);

/** All commands are evaluated in memory; a caller writes the returned patches once. */
export async function applyProposalCommands(
  markdown: string,
  request: ProposalApplyRequest
): Promise<ProposalApplySuccess | ProposalApplyFailure> {
  const beforeHash = await sha256Text(markdown);
  if (beforeHash !== request.baseVersion) return failure("マップの版が一致しません。整理案を作り直してください。");
  if (request.commands.length === 0) return failure("反映するコマンドがありません。");
  try {
    const editor = new BatchText(markdown);
    const initialMap = parseThoughtMapMarkdown(markdown);
    const aliases = new Map(Object.keys(initialMap.nodesById).map((id) => [id, indicesOf(initialMap, id)]));
    for (const command of request.commands) {
      const map = parseThoughtMapMarkdown(editor.text);
      const resolved = resolveCommandAliases(map, command, aliases);
      const insertion = insertionLocation(map, resolved);
      const insertedId = command.type === "node.insertChild" || command.type === "node.insertSibling" ? command.nodeId :
        command.type === "node.renameAndInsertChild" || command.type === "node.renameAndInsertSibling" ? command.nextNodeId : undefined;
      if (insertedId && aliases.has(insertedId)) throw new Error("追加ノードのIDが既存のコマンド対象と重複しています。");
      const move = movementLocation(map, resolved);
      const deleted = resolved.type === "node.delete" ? indicesOf(map, resolved.nodeId) : undefined;
      editor.apply(resolved);
      for (const [id, location] of aliases) {
        if (deleted && startsWith(location, deleted)) { aliases.delete(id); continue; }
        aliases.set(id, insertion ? afterInsert(location, insertion) :
          move ? afterMove(location, move.from, move.parent, move.index) :
          deleted ? afterDelete(location, deleted) : location);
      }
      if (insertion && insertedId) aliases.set(insertedId, [...insertion]);
    }
    return await editor.result(beforeHash);
  } catch (error) {
    return failure(errorMessage(error));
  }
}

/** Resolve each item after its dependencies, never carrying parser node IDs across edits. */
export async function applyProposalItems(
  markdown: string,
  proposal: ProposalFile,
  itemIds: readonly string[],
  context: ProposalApplyContext = {}
): Promise<ProposalItemsApplyResult> {
  const beforeHash = await sha256Text(markdown);
  if (beforeHash !== proposal.baseVersion && !context.acceptedHashes?.includes(beforeHash)) {
    return failure("マップの版が一致しません。整理案を作り直してください。");
  }
  const applied = new Set(context.appliedItemIds ?? []);
  const created: Record<string, CreatedProposalNode> = Object.assign(Object.create(null), context.createdNodes);
  let currentItemId: string | undefined;
  try {
    const ordered = orderSelection(proposal, itemIds, applied);
    const editor = new BatchText(markdown);
    for (const item of ordered) {
      currentItemId = item.id;
      const map = parseThoughtMapMarkdown(editor.text);
      const command = itemCommand(map, item, created);
      const oldLocations = new Map<string, readonly number[]>();
      for (const [id, location] of Object.entries(created)) {
        const node = resolveCreated(map, location);
        if (node) oldLocations.set(id, indicesOf(map, node.id));
        else delete created[id];
      }
      const insertion = insertionLocation(map, command);
      const move = command.type === "node.move" ? {
        from: indicesOf(map, command.nodeId),
        parent: command.nextParentId === null ? [] : indicesOf(map, command.nextParentId),
        index: command.nextIndex
      } : undefined;
      editor.apply(command);
      const nextMap = parseThoughtMapMarkdown(editor.text);
      for (const [id, oldLocation] of oldLocations) {
        const nextLocation = insertion ? afterInsert(oldLocation, insertion) :
          move ? afterMove(oldLocation, move.from, move.parent, move.index) : oldLocation;
        const node = nodeAt(nextMap, nextLocation);
        if (!node) throw new Error("作成したノードの位置を安全に照合できません。");
        created[id] = recordLocation(nextMap, node.id);
      }
      if (insertion) {
        const node = nodeAt(nextMap, insertion);
        if (!node || !("text" in item.payload) || node.text !== item.payload.text) {
          throw new Error("作成したノードを照合できません。");
        }
        created[item.id] = recordLocation(nextMap, node.id);
      }
      applied.add(item.id);
    }
    return { ...await editor.result(beforeHash), appliedItemIds: [...applied], createdNodes: created };
  } catch (error) {
    return { ...failure(errorMessage(error)), ...(currentItemId ? { itemId: currentItemId } : {}) };
  }
}

function orderSelection(proposal: ProposalFile, ids: readonly string[], applied: ReadonlySet<string>): ProposalItem[] {
  if (ids.length === 0) throw new Error("承認する項目を選んでください。");
  const selected = new Set(ids);
  if (selected.size !== ids.length) throw new Error("同じ項目が複数回選択されています。");
  const all = new Map(proposal.items.map((item) => [item.id, item]));
  if (all.size !== proposal.items.length) throw new Error("項目IDが重複しています。");
  for (const id of selected) {
    const item = all.get(id);
    if (!item) throw new Error("選択した項目がありません。");
    if (applied.has(id)) throw new Error("承認済みの項目を二重に反映できません。");
    if (item.op === "setStatus") throw new Error("状態の提案は表示のみです。M1では承認できません。");
    for (const dependency of item.dependsOn ?? []) {
      if (!all.has(dependency)) throw new Error("依存する項目がありません。");
      if (!applied.has(dependency) && !selected.has(dependency)) throw new Error("依存する項目も選択してください。");
    }
    for (const target of [item.target, ...(item.op === "move" ? [item.payload.parent] : [])]) {
      if (!("item" in target)) continue;
      const dependency = all.get(target.item);
      if (!item.dependsOn?.includes(target.item) ||
          !dependency || (dependency.op !== "insertChild" && dependency.op !== "insertSibling")) {
        throw new Error("作成項目の参照には、追加操作への明示的な依存が必要です。");
      }
    }
  }
  const pending = proposal.items.filter((item) => selected.has(item.id));
  const done = new Set(applied);
  const ordered: ProposalItem[] = [];
  while (pending.length) {
    const index = pending.findIndex((item) => (item.dependsOn ?? []).every((id) => done.has(id)));
    if (index < 0) throw new Error("項目の依存関係が循環しています。");
    const [item] = pending.splice(index, 1);
    ordered.push(item);
    done.add(item.id);
  }
  return ordered;
}

function itemCommand(map: ThoughtMap, item: ProposalItem, created: Readonly<Record<string, CreatedProposalNode>>): SemanticCommand {
  const target = resolveTarget(map, item.target, created);
  switch (item.op) {
    case "insertChild": {
      const siblings = target === null ? map.roots : target.children;
      return { type: "node.insertChild", parentId: target?.id ?? null,
        index: checkedIndex(item.payload.index, siblings.length), nodeId: `proposal-${item.id}`, text: item.payload.text };
    }
    case "insertSibling":
      return { type: "node.insertSibling", siblingId: requireNode(target).id, where: item.payload.where,
        nodeId: `proposal-${item.id}`, text: item.payload.text };
    case "rename":
      return { type: "node.rename", nodeId: requireNode(target).id, nextText: item.payload.text };
    case "move": {
      const node = requireNode(target);
      const parent = resolveTarget(map, item.payload.parent, created);
      const siblings = (parent === null ? map.roots : parent.children).filter((id) => id !== node.id);
      return { type: "node.move", nodeId: node.id, nextParentId: parent?.id ?? null,
        nextIndex: checkedIndex(item.payload.index, siblings.length) };
    }
    case "updateNote": {
      const node = requireNode(target);
      const note = item.payload.mode === "append" && node.note ? `${node.note}\n\n${item.payload.note}` : item.payload.note;
      return { type: "node.updateNote", nodeId: node.id, note };
    }
    case "setStatus": throw new Error("状態の提案は表示のみです。");
  }
}

function resolveTarget(map: ThoughtMap, target: ProposalTarget, created: Readonly<Record<string, CreatedProposalNode>>): ThoughtNode | null {
  if ("root" in target) return null;
  if ("item" in target) {
    const location = created[target.item];
    const node = location && resolveCreated(map, location);
    if (!node) throw new Error("作成項目の対象が見つからないか、特定できません。");
    return node;
  }
  const candidates = nodesByPath(map, [...target.path, target.title]);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) throw new Error("対象ノードが見つかりません。");
  const exact = target.sourceRange ? candidates.filter((node) => sameRange(node.source?.range, target.sourceRange)) : [];
  if (exact.length !== 1) throw new Error("対象ノードを特定できません。同名ノードの行範囲を確認してください。");
  return exact[0];
}

function resolveCreated(map: ThoughtMap, record: CreatedProposalNode): ThoughtNode | undefined {
  if (record.indices) {
    const node = nodeAt(map, record.indices);
    if (!node || node.text !== record.title || record.indices.length !== record.path.length + 1 ||
        record.indices[record.indices.length - 1] !== record.index) return undefined;
    return record.path.every((title, index) => nodeAt(map, record.indices!.slice(0, index + 1))?.text === title) ? node : undefined;
  }
  const parents: (ThoughtNode | null)[] = record.path.length ? nodesByPath(map, record.path) : [null];
  const candidates = parents.map((parent) => map.nodesById[(parent === null ? map.roots : parent.children)[record.index]])
    .filter((node) => node && node.text === record.title);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function nodesByPath(map: ThoughtMap, path: readonly string[]): ThoughtNode[] {
  let candidates = map.roots.map((id) => map.nodesById[id]);
  for (let index = 0; index < path.length; index++) {
    const matches = candidates.filter((node) => node.text === path[index]);
    if (index === path.length - 1) return matches;
    candidates = matches.flatMap((node) => node.children.map((id) => map.nodesById[id]));
  }
  return [];
}

function recordLocation(map: ThoughtMap, id: string): CreatedProposalNode {
  const indices = indicesOf(map, id);
  const path = indices.slice(0, -1).map((_, index) => nodeAt(map, indices.slice(0, index + 1))!.text);
  return { path, title: map.nodesById[id].text, index: indices[indices.length - 1], indices };
}

function indicesOf(map: ThoughtMap, id: string): number[] {
  const visit = (siblings: readonly string[], prefix: number[]): number[] | undefined => {
    for (let index = 0; index < siblings.length; index++) {
      const location = [...prefix, index];
      if (siblings[index] === id) return location;
      const found = visit(map.nodesById[siblings[index]].children, location);
      if (found) return found;
    }
    return undefined;
  };
  const result = visit(map.roots, []);
  if (!result) throw new Error("対象ノードが見つかりません。");
  return result;
}

function nodeAt(map: ThoughtMap, indices: readonly number[]): ThoughtNode | undefined {
  let siblings = map.roots;
  let node: ThoughtNode | undefined;
  for (const index of indices) {
    node = map.nodesById[siblings[index]];
    if (!node) return undefined;
    siblings = node.children;
  }
  return node;
}

function insertionLocation(map: ThoughtMap, command: SemanticCommand): readonly number[] | undefined {
  if (command.type === "node.insertChild" || command.type === "node.renameAndInsertChild") {
    const parentId = command.type === "node.insertChild" ? command.parentId : command.nodeId;
    checkedIndex(command.index, parentId === null ? map.roots.length : map.nodesById[parentId].children.length);
    return [...(parentId === null ? [] : indicesOf(map, parentId)), command.index];
  }
  if (command.type === "node.insertSibling" || command.type === "node.renameAndInsertSibling") {
    const sibling = indicesOf(map, command.type === "node.insertSibling" ? command.siblingId : command.nodeId);
    return [...sibling.slice(0, -1), sibling[sibling.length - 1] + (command.where === "after" ? 1 : 0)];
  }
  return undefined;
}

function resolveCommandAliases(map: ThoughtMap, command: SemanticCommand, aliases: ReadonlyMap<string, readonly number[]>): SemanticCommand {
  const resolve = (id: string): string => {
    const location = aliases.get(id);
    const node = location && nodeAt(map, location);
    if (!node) throw new Error("コマンドの対象ノードが見つかりません。");
    return node.id;
  };
  switch (command.type) {
    case "map.rename": return command;
    // The PoC's paste command is outside the M1 proposal command set. Reject it
    // before alias resolution; a subtree has no declared new-node alias IDs.
    case "node.insertSubtree": throw new Error("子枝の貼り付けは整理案の一括反映に対応していません。");
    case "node.insertChild": return { ...command, parentId: command.parentId === null ? null : resolve(command.parentId) };
    case "node.insertSibling": return { ...command, siblingId: resolve(command.siblingId) };
    case "node.move": return { ...command, nodeId: resolve(command.nodeId), nextParentId: command.nextParentId === null ? null : resolve(command.nextParentId) };
    default: return { ...command, nodeId: resolve(command.nodeId) };
  }
}

function movementLocation(map: ThoughtMap, command: SemanticCommand): { from: number[]; parent: number[]; index: number } | undefined {
  if (command.type === "node.move") {
    const siblings = command.nextParentId === null ? map.roots : map.nodesById[command.nextParentId].children;
    checkedIndex(command.nextIndex, siblings.filter((id) => id !== command.nodeId).length);
    return { from: indicesOf(map, command.nodeId), parent: command.nextParentId === null ? [] : indicesOf(map, command.nextParentId), index: command.nextIndex };
  }
  if (command.type === "node.indent") {
    const from = indicesOf(map, command.nodeId);
    const parent = [...from.slice(0, -1), from[from.length - 1] - 1];
    const node = nodeAt(map, parent);
    if (!node) throw new Error("最初の兄弟ノードはインデントできません。");
    return { from, parent, index: node.children.length };
  }
  if (command.type === "node.outdent") {
    const from = indicesOf(map, command.nodeId);
    if (from.length < 2) throw new Error("トップレベルのノードはアウトデントできません。");
    return { from, parent: from.slice(0, -2), index: from[from.length - 2] + 1 };
  }
  return undefined;
}

function startsWith(path: readonly number[], prefix: readonly number[]): boolean {
  return path.length >= prefix.length && prefix.every((index, position) => path[position] === index);
}
function afterInsert(path: readonly number[], inserted: readonly number[]): number[] {
  const level = inserted.length - 1;
  const next = [...path];
  if (path.length > level && startsWith(path, inserted.slice(0, -1)) && path[level] >= inserted[level]) next[level]++;
  return next;
}
function afterDelete(path: readonly number[], deleted: readonly number[]): number[] {
  const level = deleted.length - 1;
  const next = [...path];
  if (path.length > level && startsWith(path, deleted.slice(0, -1)) && path[level] > deleted[level]) next[level]--;
  return next;
}
function afterMove(path: readonly number[], from: readonly number[], parent: readonly number[], index: number): number[] {
  const to = [...afterDelete(parent, from), index];
  if (startsWith(path, from)) return [...to, ...path.slice(from.length)];
  return afterInsert(afterDelete(path, from), to);
}

function checkedIndex(index: number | undefined, length: number): number {
  const value = index ?? length;
  if (!Number.isInteger(value) || value < 0 || value > length) throw new Error("挿入位置がノードの範囲外です。");
  return value;
}
function requireNode(node: ThoughtNode | null): ThoughtNode {
  if (!node) throw new Error("この操作はマップのトップレベルを対象にできません。");
  return node;
}
function sameRange(a: SourceRange | undefined, b: SourceRange | undefined): boolean {
  return !!a && !!b && a.start.line === b.start.line && a.start.column === b.start.column &&
    a.end.line === b.end.line && a.end.column === b.end.column;
}

type Piece = { originalStart: number; originalEnd: number } | { text: string };
type OffsetPatch = { start: number; end: number; text: string };

/** Original runs remain intact, so batch composition never replaces the whole document. */
class BatchText {
  text: string;
  private readonly original: string;
  private pieces: Piece[];
  constructor(original: string) {
    this.original = original;
    this.text = original;
    this.pieces = [{ originalStart: 0, originalEnd: original.length }];
  }

  apply(command: SemanticCommand): void {
    const normalized = this.text.replace(/\r\n|\r/g, "\n");
    const map = parseThoughtMapMarkdown(normalized);
    const eol = this.text.match(/\r\n|\n|\r/)?.[0] ?? "\n";
    const patches = createMarkdownPatches(normalized, map, command).map((patch) => {
      const start = offsetAt(this.text, patch.range.start);
      const end = offsetAt(this.text, patch.range.end);
      let text = patch.text.replace(/\r\n|\r/g, "\n").replace(/\n/g, eol);
      // A moved final line may have no terminator. It needs a separator when
      // inserted before another line; only the inserted block is adjusted.
      if ((command.type === "node.move" || command.type === "node.indent" || command.type === "node.outdent") &&
          start === end && text && !/[\r\n]$/.test(text) && start < this.text.length) text += eol;
      return { start, end, text };
    }).sort((a, b) => b.start - a.start || b.end - a.end);
    for (let index = 0; index < patches.length; index++) {
      const patch = patches[index];
      if (patch.end < patch.start || (index && patch.end > patches[index - 1].start)) {
        throw new Error("反映する変更範囲が重なっています。");
      }
    }
    let next = this.text;
    for (const patch of patches) next = next.slice(0, patch.start) + patch.text + next.slice(patch.end);
    const nextMap = parseThoughtMapMarkdown(next);
    assertCommandResult(map, nextMap, command);
    for (const patch of patches) this.replacePieces(patch);
    this.text = next;
  }

  async result(beforeHash: string): Promise<ProposalApplySuccess> {
    const patches: TextPatch[] = [];
    let cursor = 0;
    let pending = "";
    const flush = (end: number) => {
      if (this.original.slice(cursor, end) !== pending) {
        patches.push({ range: { start: positionAt(this.original, cursor), end: positionAt(this.original, end) }, text: pending });
      }
      cursor = end;
      pending = "";
    };
    for (const piece of this.pieces) {
      if ("text" in piece) { pending += piece.text; continue; }
      flush(piece.originalStart);
      cursor = piece.originalEnd;
    }
    flush(this.original.length);
    return { ok: true, text: this.text, patches, beforeHash, afterHash: await sha256Text(this.text) };
  }

  private replacePieces(patch: OffsetPatch): void {
    const before = slicePieces(this.pieces, 0, patch.start);
    const after = slicePieces(this.pieces, patch.end, Infinity);
    this.pieces = [...before, ...(patch.text ? [{ text: patch.text }] : []), ...after];
  }
}

function slicePieces(pieces: readonly Piece[], start: number, end: number): Piece[] {
  const result: Piece[] = [];
  let offset = 0;
  for (const piece of pieces) {
    const length = "text" in piece ? piece.text.length : piece.originalEnd - piece.originalStart;
    const from = Math.max(0, start - offset), to = Math.min(length, end - offset);
    if (to > from) result.push("text" in piece ? { text: piece.text.slice(from, to) } : {
      originalStart: piece.originalStart + from, originalEnd: piece.originalStart + to
    });
    offset += length;
  }
  return result;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  const pattern = /\r\n|\n|\r/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) starts.push(match.index + match[0].length);
  return starts;
}
function offsetAt(text: string, position: SourcePosition): number {
  const starts = lineStarts(text);
  // The existing patch engine uses the line after EOF as an insertion sentinel.
  if (position.line === starts.length + 1 && position.column === 1) return text.length;
  const start = starts[position.line - 1];
  if (start === undefined || position.column < 1) throw new Error("反映する行範囲が不正です。");
  const end = position.line < starts.length ? starts[position.line] : text.length;
  const offset = start + position.column - 1;
  if (offset > end) throw new Error("反映する列範囲が不正です。");
  return offset;
}
function positionAt(text: string, offset: number): SourcePosition {
  const starts = lineStarts(text);
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1] <= offset) line++;
  return { line: line + 1, column: offset - starts[line] + 1 };
}

function assertCommandResult(before: ThoughtMap, after: ThoughtMap, command: SemanticCommand): void {
  const count = Object.keys(before.nodesById).length;
  const nextCount = Object.keys(after.nodesById).length;
  const inserts = ["node.insertChild", "node.insertSibling", "node.renameAndInsertChild", "node.renameAndInsertSibling"].includes(command.type);
  const expected = command.type === "node.delete" ? count - subtreeSize(before, command.nodeId) : count + (inserts ? 1 : 0);
  if (nextCount !== expected || (command.type !== "map.rename" && before.title !== after.title)) {
    throw new Error("既存のMarkdownコマンドで安全に反映できません。内容と改行を確認してください。");
  }
  if (command.type === "node.rename" || command.type === "node.updateNote" || command.type === "node.clearNote") {
    const node = nodeAt(after, indicesOf(before, command.nodeId));
    if (!node || (command.type === "node.rename" && node.text !== command.nextText)) {
      throw new Error("変更後のノードを照合できません。");
    }
  }
}
function subtreeSize(map: ThoughtMap, id: string): number {
  return 1 + map.nodesById[id].children.reduce((sum, child) => sum + subtreeSize(map, child), 0);
}
function failure(reason: string): ProposalApplyFailure { return { ok: false, reason }; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "整理案を反映できません。"; }
