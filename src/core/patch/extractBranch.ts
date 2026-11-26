import type { MindMapDocument, TopicNode } from '../model';
import { parseMarkdownToMap } from '../parser';
import { countIndentColumns, listItemContentColumnsOfLine } from '../parser/blockScanner';

export interface ReferenceEdit {
  readonly line: number;
  readonly column: number;
  readonly original: string;
  readonly replacement: string;
}

const invalidName = /[\\:*?"<>|^#[\]\u0000-\u001f]/u; // eslint-disable-line no-control-regex
const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizeNoteFileStem(title: string): string {
  const stem = Array.from(title, (ch) => (ch === '/' || invalidName.test(ch) ? '-' : ch))
    .join('')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '');
  return !stem || reservedName.test(stem) ? 'Extracted Branch' : stem;
}

export function validateVaultNotePath(
  path: string,
  source: string,
  configDir = '.obsidian',
): string {
  const parts = path.trim().split('/');
  if (
    parts.some(
      (part) =>
        !part ||
        part === '..' ||
        part.startsWith('.') ||
        invalidName.test(part) ||
        reservedName.test(part) ||
        /[. ]$/.test(part),
    )
  ) {
    throw new Error('invalid-target-path');
  }
  const full = parts.join('/');
  const target = /\.md$/i.test(full) ? full : full + '.md';
  if (target.toLowerCase() === source.toLowerCase()) throw new Error('target-same-as-source');
  if (target.toLowerCase().startsWith(configDir.toLowerCase() + '/'))
    throw new Error('invalid-target-path');
  return target;
}

export function editableMap(raw: string, basename: string): MindMapDocument {
  const parsed = parseMarkdownToMap(raw, basename);
  if (parsed.status !== 'ok' || parsed.document.readOnlyReasons.length)
    throw new Error('read-only-document');
  return parsed.document;
}

function unindent(line: string, columns: number): string {
  if (!line.trim()) return line;
  const whitespace = line.match(/^[ \t]*/)?.[0] ?? '';
  const width = countIndentColumns(whitespace);
  // Lazy continuation paragraphs may start before the normal content column.
  return ' '.repeat(Math.max(0, width - columns)) + line.slice(whitespace.length);
}

export function planBranchExtraction(
  raw: string,
  doc: MindMapDocument,
  target: TopicNode,
  link: string,
  edits: readonly ReferenceEdit[] = [],
) {
  if (doc.readOnlyReasons.length || target.id === doc.rootId || !target.titleRange)
    throw new Error('cannot-extract');
  if (!link || /[\r\n]/.test(link)) throw new Error('invalid-link');
  const { startLine, endLine } = target.subtreeRange;
  const eol = doc.lineEnding;
  const original = raw.split(eol);
  const lines = original.slice(startLine, endLine);
  const originalBranch = lines.join(eol);
  const descendants = [...doc.nodes.values()].filter(
    (node) => node.headerLine >= startLine && node.headerLine < endLine && node.id !== doc.rootId,
  );
  const protectedLines = new Set<number>();
  for (const node of descendants) {
    for (const block of node.unmappedBlocks) {
      if (target.kind === 'list-item' && block.indentSensitive)
        throw new Error('indent-sensitive-unmapped-block');
      for (let i = block.range.startLine; i < block.range.endLine; i++) protectedLines.add(i);
    }
  }
  // Edits come from resolved Vault references. Apply from right to left within each line.
  let nextLine = endLine;
  let nextColumn = 0;
  for (const edit of [...edits].sort((a, b) => b.line - a.line || b.column - a.column)) {
    const i = edit.line - startLine;
    const line = lines[i];
    if (
      line === undefined ||
      edit.line < startLine ||
      protectedLines.has(edit.line) ||
      !edit.original ||
      edit.column < 0 ||
      /[\r\n]/.test(edit.replacement) ||
      (edit.line === nextLine && edit.column + edit.original.length > nextColumn) ||
      !line.startsWith(edit.original, edit.column)
    )
      throw new Error('unsafe-reference');
    lines[i] =
      line.slice(0, edit.column) +
      edit.replacement +
      line.slice(edit.column + edit.original.length);
    nextLine = edit.line;
    nextColumn = edit.column;
  }
  const prefixLength = original.slice(0, startLine).reduce((len, line) => len + line.length + 1, 0);
  const column = target.titleRange.start - prefixLength;
  const header = original[startLine]!;
  const suffix = header.slice(column + target.titleRaw.length);
  const editedHeader = lines[0]!;
  const editedTitle = editedHeader.slice(column, editedHeader.length - suffix.length);
  lines[0] = '# ' + editedTitle;
  if (target.kind === 'list-item') {
    const columns = listItemContentColumnsOfLine(header);
    if (columns === null) throw new Error('invalid-list');
    for (let i = 1; i < lines.length; i++) {
      if (!protectedLines.has(startLine + i)) lines[i] = unindent(lines[i]!, columns);
    }
  } else {
    for (const child of descendants) {
      if (child.id === target.id || child.headingLevel === null) continue;
      const level = child.headingLevel - target.headingLevel! + 1;
      if (level < 2 || level > 6) throw new Error('invalid-heading');
      const i = child.headerLine - startLine;
      lines[i] = lines[i]!.replace(/^( {0,3})#+/, '$1' + '#'.repeat(level));
    }
  }
  const output = lines.join(eol) + (endLine < original.length ? eol : '');
  const extracted = editableMap(output, editedTitle);
  const byLine = new Map([...extracted.nodes.values()].map((node) => [node.headerLine, node]));
  if (
    extracted.topicCount !== descendants.length - 1 ||
    extracted.nodes.get(extracted.rootId)?.titleRaw !== editedTitle
  ) {
    throw new Error('invalid-extracted-structure');
  }
  for (const node of descendants) {
    const copy = byLine.get(node.headerLine - startLine);
    const parent = node.parentId ? doc.nodes.get(node.parentId) : undefined;
    if (
      !copy ||
      (node.id !== target.id &&
        (!parent ||
          copy.parentId !== byLine.get(parent.headerLine - startLine)?.id ||
          copy.kind !== node.kind ||
          copy.preservedBlockId !== node.preservedBlockId ||
          copy.preservedPrefix !== node.preservedPrefix))
    )
      throw new Error('invalid-extracted-structure');
  }
  for (let i = 1; i < lines.length; i++) {
    if (doc.lineKinds[startLine + i] !== extracted.lineKinds[i])
      throw new Error('invalid-extracted-structure');
  }
  const replacement = header.slice(0, column) + link + suffix;
  const after = [...original.slice(0, startLine), replacement, ...original.slice(endLine)].join(
    eol,
  );
  const remaining = editableMap(after, doc.nodes.get(doc.rootId)!.titleRaw);
  const focused = [...remaining.nodes.values()].find(
    (node) => node.headerLine === startLine && node.id !== remaining.rootId,
  );
  if (
    !focused ||
    focused.titleRaw !== link ||
    focused.kind !== target.kind ||
    focused.childIds.length ||
    focused.noteRange ||
    focused.preservedPrefix !== target.preservedPrefix ||
    focused.preservedBlockId !== target.preservedBlockId ||
    remaining.topicCount !== doc.topicCount - descendants.length + 1
  )
    throw new Error('invalid-replacement');
  // A minimum text edit can still change paragraph ownership or nesting on an adjacent line.
  const removedLines = endLine - startLine - 1;
  const newLine = (line: number) => (line < endLine ? line : line - removedLines);
  const remainingByLine = new Map(
    [...remaining.nodes.values()]
      .filter((n) => n.id !== remaining.rootId)
      .map((n) => [n.headerLine, n]),
  );
  for (const node of doc.nodes.values()) {
    if (node.id !== doc.rootId && node.headerLine >= startLine && node.headerLine < endLine)
      continue;
    const other =
      node.id === doc.rootId
        ? remaining.nodes.get(remaining.rootId)
        : remainingByLine.get(newLine(node.headerLine));
    if (
      !other ||
      other.kind !== node.kind ||
      other.titleRaw !== node.titleRaw ||
      other.noteText !== node.noteText ||
      other.unmappedBlocks.length !== node.unmappedBlocks.length
    )
      throw new Error('invalid-replacement');
    const parent = node.parentId ? doc.nodes.get(node.parentId) : null;
    if (parent) {
      const expected =
        parent.id === doc.rootId
          ? remaining.rootId
          : remainingByLine.get(newLine(parent.headerLine))?.id;
      if (other.parentId !== expected) throw new Error('invalid-replacement');
    }
    for (const [i, block] of node.unmappedBlocks.entries()) {
      const preserved = other.unmappedBlocks[i];
      if (
        !preserved ||
        preserved.kind !== block.kind ||
        preserved.range.startLine !== newLine(block.range.startLine) ||
        preserved.range.endLine - preserved.range.startLine !==
          block.range.endLine - block.range.startLine
      )
        throw new Error('invalid-replacement');
    }
  }
  return {
    originalBranch,
    output,
    after,
    focusNodeId: focused.id,
    nextDocument: remaining,
    descendantCount: descendants.length - 1,
    protectedBlockCount: descendants.reduce((count, node) => count + node.unmappedBlocks.length, 0),
  };
}
