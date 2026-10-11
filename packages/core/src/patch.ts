import type { SourcePosition, SourceRange, ThoughtMap, ThoughtNode, ThoughtNodeId } from "./domain.js";
import { classifyMarkdownLine, spacesPerDepth } from "./markdown-grammar.js";
import type { InsertSubtreeNode, SemanticCommand, WrapInNewParentCommand } from "./semantic-commands.js";
import type { DeleteKeepChildrenCommand } from "./note-mode/patch-commands.js";
import { mapMdWrapEdits } from "./map-md-source.js";

export type TextPatch = Readonly<{
  range: SourceRange;
  text: string;
}>;

type LineIndex = Readonly<{
  lines: readonly string[];
  lineStarts: readonly number[];
}>;

export function createMarkdownPatches(
  markdown: string,
  map: ThoughtMap,
  command: SemanticCommand | DeleteKeepChildrenCommand | WrapInNewParentCommand
): readonly TextPatch[] {
  // Source ranges and generated patch text stay in the existing LF model.
  markdown = normalizePatchSource(markdown).lfText;
  const lineIndex = createLineIndex(markdown);

  switch (command.type) {
    case "node.wrapInNewParent":
      return mapMdWrapEdits(markdown, map, command);
    case "map.rename":
      return renameMapPatches(map, command.nextTitle);
    case "node.rename":
      return [renamePatch(map, command.nodeId, command.nextText)];
    case "node.renameAndInsertSibling":
      return [
        ...renamePatches(map, command.nodeId, command.nextText),
        insertSiblingPatch(
          markdown,
          map,
          lineIndex,
          command.nodeId,
          command.where,
          command.text
        )
      ];
    case "node.renameAndInsertChild":
      return [
        ...renamePatches(map, command.nodeId, command.nextText),
        insertPatch(
          markdown,
          map,
          lineIndex,
          command.nodeId,
          command.index,
          command.text
        )
      ];
    case "node.insertChild":
      return [
        insertPatch(
          markdown,
          map,
          lineIndex,
          command.parentId,
          command.index,
          command.text
        )
      ];
    case "node.insertSubtree":
      return [insertSubtreePatch(markdown, map, lineIndex, command.parentId, command.index, command.subtree)];
    case "node.insertSibling":
      return [
        insertSiblingPatch(
          markdown,
          map,
          lineIndex,
          command.siblingId,
          command.where,
          command.text
        )
      ];
    case "node.delete":
      return [deletePatch(map, lineIndex, command.nodeId)];
    case "node.deleteKeepChildren":
      return deleteKeepChildrenPatches(map, lineIndex, command.nodeId);
    case "node.move":
      return movePatches(markdown, map, lineIndex, command.nodeId, command.nextParentId, command.nextIndex, true);
    case "node.indent":
      return indentPatches(markdown, map, lineIndex, command.nodeId);
    case "node.outdent":
      return outdentPatches(markdown, map, lineIndex, command.nodeId);
    case "node.updateNote":
      return updateNotePatches(markdown, map, lineIndex, command.nodeId, command.note);
    case "node.clearNote":
      return clearNotePatches(map, lineIndex, command.nodeId);
  }
}

export function applyTextPatches(markdown: string, patches: readonly TextPatch[]): string {
  const { lfText, newline } = normalizePatchSource(markdown);
  let result = lfText;
  for (const patch of sortPatchesDescending(lfText, patches)) {
    result = applyTextPatch(result, newline === "\r\n"
      ? { ...patch, text: patch.text.replace(/\r\n/g, "\n") }
      : patch);
  }

  return newline === "\r\n" ? result.replace(/\n/g, newline) : result;
}

function normalizePatchSource(markdown: string): { lfText: string; newline: "\n" | "\r\n" } {
  if (!markdown.includes("\r")) return { lfText: markdown, newline: "\n" };
  // Only uniform CRLF gets the F52 normalization/restore path. Preserve the
  // legacy raw processing for mixed EOL/lone CR; host guards own any refusal.
  if (/[\r\n]/.test(markdown.replace(/\r\n/g, ""))) {
    return { lfText: markdown, newline: "\n" };
  }
  return { lfText: markdown.replace(/\r\n/g, "\n"), newline: "\r\n" };
}

function sortPatchesDescending(markdown: string, patches: readonly TextPatch[]): TextPatch[] {
  const lineIndex = createLineIndex(markdown);

  return [...patches].sort(
    (left, right) => positionToOffset(lineIndex, right.range.start) - positionToOffset(lineIndex, left.range.start)
  );
}

function applyTextPatch(markdown: string, patch: TextPatch): string {
  const lineIndex = createLineIndex(markdown);
  const start = positionToOffset(lineIndex, patch.range.start);
  const end = positionToOffset(lineIndex, patch.range.end);

  return `${markdown.slice(0, start)}${patch.text}${markdown.slice(end)}`;
}

function renameMapPatches(map: ThoughtMap, nextTitle: string): readonly TextPatch[] {
  if (map.title === nextTitle) {
    return [];
  }
  if (!map.source) {
    throw new Error("Map has no source range.");
  }

  return [
    {
      range: map.source.range,
      text: nextTitle
    }
  ];
}

function renamePatch(map: ThoughtMap, nodeId: ThoughtNodeId, nextText: string): TextPatch {
  const node = getNode(map, nodeId);
  const range = nodeSourceRange(node);
  const textStartColumn = range.start.column + 2;

  return {
    range: {
      start: { line: range.start.line, column: textStartColumn },
      end: { line: range.start.line, column: textStartColumn + node.text.length }
    },
    text: nextText
  };
}

function renamePatches(map: ThoughtMap, nodeId: ThoughtNodeId, nextText: string): readonly TextPatch[] {
  return getNode(map, nodeId).text === nextText ? [] : [renamePatch(map, nodeId, nextText)];
}

function insertPatch(
  markdown: string,
  map: ThoughtMap,
  lineIndex: LineIndex,
  parentId: ThoughtNodeId | null,
  index: number,
  text: string
): TextPatch {
  const siblings = childrenForParent(map, parentId);
  const targetDepth = parentId === null ? 0 : nodeDepth(getNode(map, parentId)) + 1;
  const referenceId = siblings[index];
  const position = referenceId
    ? lineStartPosition(getNode(map, referenceId))
    : insertionEndPosition(map, lineIndex, parentId, siblings);

  return emptyPatch(position, insertionText(markdown, lineIndex, position, targetDepth, text));
}

function insertSubtreePatch(
  markdown: string, map: ThoughtMap, lineIndex: LineIndex,
  parentId: ThoughtNodeId, index: number, subtree: InsertSubtreeNode
): TextPatch {
  if (typeof parentId !== "string" || !parentId) throw new Error("Subtree requires a parent node.");
  const parent = getNode(map, parentId);
  if (!Number.isInteger(index) || index < 0 || index > parent.children.length) {
    throw new Error("Subtree child index is out of range.");
  }
  const lines: string[] = [], seen = new Set<object>();
  const stack: { node: InsertSubtreeNode; depth: number }[] = [{ node: subtree, depth: nodeDepth(parent) + 1 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== "object" || Array.isArray(node) || seen.has(node) ||
        typeof node.text !== "string" || /[\r\n\u2028\u2029]/u.test(node.text) || !Array.isArray(node.children)) {
      throw new Error("Invalid copied subtree.");
    }
    seen.add(node);
    lines.push(`${" ".repeat(depth * spacesPerDepth)}- ${node.text}\n`);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], depth: depth + 1 });
  }
  const reference = parent.children[index];
  // Keep the parent's own note/anchor lines with it, including after its children.
  const position = reference ? lineStartPosition(getNode(map, reference)) : afterNodePosition(lineIndex, parent);
  return emptyPatch(position, insertionTextForBlock(markdown, lineIndex, position, lines.join(""), true));
}

function insertSiblingPatch(
  markdown: string,
  map: ThoughtMap,
  lineIndex: LineIndex,
  siblingId: ThoughtNodeId,
  where: "before" | "after",
  text: string
): TextPatch {
  const sibling = getNode(map, siblingId);
  const position = where === "before"
    ? lineStartPosition(sibling)
    : afterNodePosition(lineIndex, sibling);

  return emptyPatch(position, insertionText(markdown, lineIndex, position, nodeDepth(sibling), text));
}

function deletePatch(map: ThoughtMap, lineIndex: LineIndex, nodeId: ThoughtNodeId): TextPatch {
  const node = getNode(map, nodeId);

  return {
    range: wholeNodeLineRange(lineIndex, node),
    text: ""
  };
}

/** Keep retained bullets intact so source edits also prove their identities.
 * Parser subtree ranges omit unknown continuations and can end before a child's
 * late note; inspect through the next peer/ancestor, not just range.end. */
function deleteKeepChildrenPatches(map: ThoughtMap, lineIndex: LineIndex, nodeId: ThoughtNodeId): readonly TextPatch[] {
  const target = getNode(map, nodeId), range = nodeSourceRange(target);
  function fail(): never { throw new Error("Cannot safely delete keeping children: unproven content or indentation."); }
  const indent = (node: ThoughtNode): number => nodeSourceRange(node).start.column - 1;
  const targetIndent = indent(target), descendants = subtreeIds(map, nodeId);
  descendants.delete(nodeId);
  const atLine = new Map<number, ThoughtNode>();
  let boundary = lineIndex.lines.length + 1;
  for (const node of Object.values(map.nodesById)) {
    const line = nodeSourceRange(node).start.line;
    if (atLine.has(line)) fail();
    atLine.set(line, node);
    if (line > range.start.line && indent(node) <= targetIndent) boundary = Math.min(boundary, line);
  }
  const proveBullet = (node: ThoughtNode, line: number): void => {
    const spaces = indent(node);
    if (!Number.isInteger(spaces) || spaces < 0 || spaces % spacesPerDepth !== 0 ||
        lineIndex.lines[line - 1] !== " ".repeat(spaces) + "- " + node.text) fail();
  };
  proveBullet(target, range.start.line);
  const stack: ThoughtNode[] = [target];
  let parent = parentInfo(map, nodeId).parentId;
  while (parent !== null) {
    const node = getNode(map, parent);
    stack.unshift(node); parent = parentInfo(map, parent).parentId;
  }
  const patches: TextPatch[] = [];
  for (let line = range.start.line + 1; line < boundary; line++) {
    const text = lineIndex.lines[line - 1], classification = classifyMarkdownLine({ text });
    // Blank whitespace is user-authored, not an indentation unit to rewrite.
    if (classification.kind === "blank" || classification.kind === "heading" || classification.kind === "metadata-boundary") continue;
    const prefix = text.match(/^[ \t]*/)![0];
    // The legacy parser ignores tab-indented bullets. Check even a parser-leaf
    // before treating it as delete, rather than orphaning an unparsed child.
    if (prefix.includes("\t")) fail();
    let owner: ThoughtNode | undefined;
    if (classification.kind === "bullet") {
      const node = atLine.get(line);
      if (!node || !descendants.has(node.id)) fail();
      proveBullet(node, line);
      while (stack.length && indent(stack[stack.length - 1]) >= indent(node)) stack.pop();
      if (!stack.at(-1)?.children.includes(node.id) || indent(node) !== indent(stack.at(-1)!) + spacesPerDepth) fail();
      stack.push(node); owner = node;
    } else {
      const direct = classification.kind === "note-start" || classification.kind === "blockquote" || classification.kind === "id-anchor";
      // Direct note/anchor/quote lines must match their owner's content depth.
      // Unknown continuations may be deeper (e.g. indented text); use the
      // deepest surviving ancestor whose content prefix is actually present.
      owner = [...stack].reverse().find(node => direct
        ? indent(node) + spacesPerDepth === prefix.length
        : indent(node) + spacesPerDepth <= prefix.length);
      if (!owner && prefix.length > targetIndent) fail();
      if (owner?.id === nodeId && (target.children.length > 0 || !direct)) fail();
    }
    if (owner && descendants.has(owner.id)) {
      if (!text.startsWith(" ".repeat(spacesPerDepth))) fail();
      patches.push({ range: { start: { line, column: 1 }, end: { line, column: spacesPerDepth + 1 } }, text: "" });
    }
  }
  if (target.children.length === 0) return [deletePatch(map, lineIndex, nodeId)];
  return [{ range: { start: { line: range.start.line, column: 1 }, end: { line: range.start.line + 1, column: 1 } }, text: "" }, ...patches];
}

function movePatches(
  markdown: string,
  map: ThoughtMap,
  lineIndex: LineIndex,
  nodeId: ThoughtNodeId,
  nextParentId: ThoughtNodeId | null,
  nextIndex: number,
  preserveEof = false
): readonly TextPatch[] {
  if (nextParentId && subtreeIds(map, nodeId).has(nextParentId)) {
    throw new Error("Cannot move a node into its own subtree.");
  }

  const node = getNode(map, nodeId);
  const current = parentInfo(map, nodeId);
  const nextSiblings = childrenForParent(map, nextParentId).filter((id) => id !== nodeId);
  if (current.parentId === nextParentId && current.index === nextIndex) {
    return [];
  }

  const nextDepth = nextParentId === null ? 0 : nodeDepth(getNode(map, nextParentId)) + 1;
  const referenceId = nextSiblings[nextIndex];
  let insertionPosition = referenceId
    ? lineStartPosition(getNode(map, referenceId))
    : insertionEndPosition(map, lineIndex, nextParentId, nextSiblings);
  const blockText = reindentNodeBlock(markdown, lineIndex, node, nextDepth);
  const cut = deletePatch(map, lineIndex, nodeId);
  let insertion = insertionTextForBlock(markdown, lineIndex, insertionPosition, blockText, preserveEof);

  // Move the EOF separator with the block. Adding only an insertion LF would
  // leave a new trailing LF at the cut site. Keep indent/outdent's old path.
  if (preserveEof && !markdown.endsWith("\n") &&
      positionToOffset(lineIndex, cut.range.end) === markdown.length &&
      positionToOffset(lineIndex, insertionPosition) < positionToOffset(lineIndex, cut.range.start)) {
    let previousLine = cut.range.start.line - 1;
    // Empty lines exposed at EOF must also go to preserve the missing final LF.
    while (previousLine > 1 && lineIndex.lines[previousLine - 1] === "") previousLine -= 1;
    const start = { line: previousLine, column: lineIndex.lines[previousLine - 1].length + 1 };
    if (positionToOffset(lineIndex, insertionPosition) >= positionToOffset(lineIndex, start)) {
      // The destination lies in those empty separators: append at the retained
      // line's end rather than insert inside the deletion range.
      insertionPosition = start;
      insertion = `\n${blockText}`;
    } else {
      insertion = `${blockText}\n`;
    }
    return [{ range: { start, end: cut.range.end }, text: "" }, emptyPatch(insertionPosition, insertion)];
  }

  return [
    cut,
    emptyPatch(insertionPosition, insertion)
  ];
}

function indentPatches(
  markdown: string,
  map: ThoughtMap,
  lineIndex: LineIndex,
  nodeId: ThoughtNodeId
): readonly TextPatch[] {
  const current = parentInfo(map, nodeId);
  if (current.index === 0) {
    throw new Error("Cannot indent the first sibling.");
  }

  const siblings = childrenForParent(map, current.parentId);
  const previousSiblingId = siblings[current.index - 1];
  return movePatches(
    markdown,
    map,
    lineIndex,
    nodeId,
    previousSiblingId,
    childrenForParent(map, previousSiblingId).length
  );
}

function outdentPatches(
  markdown: string,
  map: ThoughtMap,
  lineIndex: LineIndex,
  nodeId: ThoughtNodeId
): readonly TextPatch[] {
  const current = parentInfo(map, nodeId);
  if (current.parentId === null) {
    throw new Error("Cannot outdent a root node.");
  }

  const parent = parentInfo(map, current.parentId);
  return movePatches(markdown, map, lineIndex, nodeId, parent.parentId, parent.index + 1);
}

function updateNotePatches(
  markdown: string,
  map: ThoughtMap,
  lineIndex: LineIndex,
  nodeId: ThoughtNodeId,
  note: string
): readonly TextPatch[] {
  if (note.trim().length === 0) {
    return clearNotePatches(map, lineIndex, nodeId);
  }

  const node = getNode(map, nodeId);
  const noteText = serializeNoteBlock(nodeDepth(node) + 1, note);
  const existingNoteRange = directNoteBlockRange(lineIndex, node);
  if (existingNoteRange) {
    const insertionPosition = { line: nodeSourceRange(node).start.line + 1, column: 1 };
    if (existingNoteRange.start.line === insertionPosition.line) {
      return [{ range: existingNoteRange, text: noteText }];
    }

    return [
      { range: existingNoteRange, text: "" },
      emptyPatch(insertionPosition, insertionTextForBlock(markdown, lineIndex, insertionPosition, noteText))
    ];
  }

  const position = { line: nodeSourceRange(node).start.line + 1, column: 1 };
  return [emptyPatch(position, insertionTextForBlock(markdown, lineIndex, position, noteText))];
}

function clearNotePatches(
  map: ThoughtMap,
  lineIndex: LineIndex,
  nodeId: ThoughtNodeId
): readonly TextPatch[] {
  const node = getNode(map, nodeId);
  const existingNoteRange = directNoteBlockRange(lineIndex, node);
  return existingNoteRange ? [{ range: existingNoteRange, text: "" }] : [];
}

function directNoteBlockRange(lineIndex: LineIndex, node: ThoughtNode): SourceRange | undefined {
  const nodeRange = nodeSourceRange(node);
  const noteIndent = " ".repeat((nodeDepth(node) + 1) * spacesPerDepth);

  let noteStartLine: number | undefined;
  for (let lineNumber = nodeRange.start.line + 1; lineNumber <= nodeRange.end.line; lineNumber += 1) {
    const text = lineIndex.lines[lineNumber - 1];
    if (text !== undefined && isDirectNoteStartLine(text, noteIndent)) {
      noteStartLine = lineNumber;
      break;
    }
  }

  if (noteStartLine === undefined) {
    return undefined;
  }

  let endLine = noteStartLine;
  for (let lineNumber = noteStartLine + 1; lineNumber <= nodeRange.end.line; lineNumber += 1) {
    const text = lineIndex.lines[lineNumber - 1];
    if (text === undefined || !text.startsWith(`${noteIndent}>`)) {
      break;
    }
    endLine = lineNumber;
  }

  return {
    start: { line: noteStartLine, column: 1 },
    end: endLine < lineIndex.lines.length
      ? { line: endLine + 1, column: 1 }
      : { line: endLine, column: lineIndex.lines[endLine - 1].length + 1 }
  };
}

function isDirectNoteStartLine(text: string, noteIndent: string): boolean {
  const classification = classifyMarkdownLine({ text });
  return classification.kind === "note-start" && classification.indent === noteIndent.length;
}

function serializeNoteBlock(depth: number, note: string): string {
  const indent = " ".repeat(depth * spacesPerDepth);
  return [
    `${indent}> [!note]`,
    ...note.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((line) =>
      line.length > 0 ? `${indent}> ${line}` : `${indent}> `
    )
  ].join("\n") + "\n";
}

function insertionEndPosition(
  map: ThoughtMap,
  lineIndex: LineIndex,
  parentId: ThoughtNodeId | null,
  siblings: readonly ThoughtNodeId[]
): SourcePosition {
  const previousSiblingId = siblings[siblings.length - 1];
  if (previousSiblingId) {
    return afterNodePosition(lineIndex, getNode(map, previousSiblingId));
  }

  if (parentId) {
    const parent = getNode(map, parentId);
    const range = nodeSourceRange(parent);
    return { line: range.start.line + 1, column: 1 };
  }

  const lastRootId = map.roots[map.roots.length - 1];
  return lastRootId
    ? afterNodePosition(lineIndex, getNode(map, lastRootId))
    : { line: lineIndex.lines.length + 1, column: 1 };
}

function wholeNodeLineRange(lineIndex: LineIndex, node: ThoughtNode): SourceRange {
  const range = nodeSourceRange(node);
  const endLine = range.end.line;

  return {
    start: { line: range.start.line, column: 1 },
    end: endLine < lineIndex.lines.length
      ? { line: endLine + 1, column: 1 }
      : { line: endLine, column: lineIndex.lines[endLine - 1].length + 1 }
  };
}

function afterNodePosition(lineIndex: LineIndex, node: ThoughtNode): SourcePosition {
  const range = nodeSourceRange(node);
  return range.end.line < lineIndex.lines.length
    ? { line: range.end.line + 1, column: 1 }
    : { line: range.end.line, column: lineIndex.lines[range.end.line - 1].length + 1 };
}

function lineStartPosition(node: ThoughtNode): SourcePosition {
  const range = nodeSourceRange(node);
  return { line: range.start.line, column: 1 };
}

function insertionText(
  markdown: string,
  lineIndex: LineIndex,
  position: SourcePosition,
  depth: number,
  text: string
): string {
  return insertionTextForBlock(markdown, lineIndex, position, `${" ".repeat(depth * spacesPerDepth)}- ${text}\n`, true);
}

function insertionTextForBlock(
  markdown: string,
  lineIndex: LineIndex,
  position: SourcePosition,
  blockText: string,
  preserveEof = false
): string {
  const offset = positionToOffset(lineIndex, position);
  if (offset === markdown.length && markdown.length > 0 && !markdown.endsWith("\n")) {
    // Inserts and node.move inherit the document's EOF choice; indent/outdent
    // and notes keep their existing block boundaries. Remove only the final LF.
    return `\n${preserveEof ? blockText.replace(/\n$/, "") : blockText}`;
  }

  return blockText;
}

function reindentNodeBlock(
  markdown: string,
  lineIndex: LineIndex,
  node: ThoughtNode,
  nextDepth: number
): string {
  const range = wholeNodeLineRange(lineIndex, node);
  const block = markdown.slice(positionToOffset(lineIndex, range.start), positionToOffset(lineIndex, range.end));
  const currentDepth = nodeDepth(node);
  const depthDelta = nextDepth - currentDepth;

  return block
    .split("\n")
    .map((line, index, lines) => {
      if (index === lines.length - 1 && line === "") {
        return line;
      }

      const currentIndent = line.match(/^ */)?.[0].length ?? 0;
      const nextIndent = currentIndent + depthDelta * spacesPerDepth;
      if (nextIndent < 0) {
        throw new Error("Cannot move node above root depth.");
      }

      return `${" ".repeat(nextIndent)}${line.slice(currentIndent)}`;
    })
    .join("\n");
}

function childrenForParent(map: ThoughtMap, parentId: ThoughtNodeId | null): readonly ThoughtNodeId[] {
  return parentId === null ? map.roots : getNode(map, parentId).children;
}

function parentInfo(
  map: ThoughtMap,
  nodeId: ThoughtNodeId
): {
  parentId: ThoughtNodeId | null;
  index: number;
} {
  const rootIndex = map.roots.indexOf(nodeId);
  if (rootIndex >= 0) {
    return { parentId: null, index: rootIndex };
  }

  for (const node of Object.values(map.nodesById)) {
    const index = node.children.indexOf(nodeId);
    if (index >= 0) {
      return { parentId: node.id, index };
    }
  }

  throw new Error(`Unknown node parent: ${nodeId}`);
}

function subtreeIds(map: ThoughtMap, nodeId: ThoughtNodeId): Set<ThoughtNodeId> {
  const ids = new Set<ThoughtNodeId>([nodeId]);
  for (const childId of getNode(map, nodeId).children) {
    for (const id of subtreeIds(map, childId)) {
      ids.add(id);
    }
  }

  return ids;
}

function nodeDepth(node: ThoughtNode): number {
  const range = nodeSourceRange(node);
  return (range.start.column - 1) / spacesPerDepth;
}

function nodeSourceRange(node: ThoughtNode): SourceRange {
  if (!node.source) {
    throw new Error(`Node ${node.id} has no source range.`);
  }

  return node.source.range;
}

function getNode(map: ThoughtMap, nodeId: ThoughtNodeId): ThoughtNode {
  const node = map.nodesById[nodeId];
  if (!node) {
    throw new Error(`Unknown node: ${nodeId}`);
  }

  return node;
}

function emptyPatch(position: SourcePosition, text: string): TextPatch {
  return {
    range: { start: position, end: position },
    text
  };
}

function createLineIndex(markdown: string): LineIndex {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lineStarts: number[] = [];
  let offset = 0;

  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  return { lines, lineStarts };
}

function positionToOffset(lineIndex: LineIndex, position: SourcePosition): number {
  if (position.line < 1) {
    throw new Error(`Invalid line: ${position.line}`);
  }

  const lineStart = lineIndex.lineStarts[position.line - 1];
  if (lineStart === undefined) {
    return lineIndex.lines.join("\n").length;
  }

  return lineStart + position.column - 1;
}
