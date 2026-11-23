import type { MindMapDocument, OffsetRange, TopicNode, UnmappedKind } from '../model';
import { countIndentColumns, listItemContentColumnsOfLine } from '../parser/blockScanner';
import type {
  PatchFocusHint,
  PatchGuard,
  PatchRejectReason,
  SemanticCommand,
  TextEdit,
} from './commands';

export interface PlanFailure {
  readonly ok: false;
  readonly reason: PatchRejectReason;
  readonly detail: string;
}

export type PlanResult =
  | {
      readonly ok: true;
      readonly edits: readonly TextEdit[];
      readonly focusHint: PatchFocusHint;
    }
  | PlanFailure;

interface LineIndex {
  readonly lines: readonly string[];
  readonly lineStartOffsets: readonly number[];
  readonly hasTrailingNewline: boolean;
}

const ORDERED_MARKER_RE = /^(\d+)([.)])$/;
const TASK_TOGGLE_PREFIX_RE = /^\[([ xX])\][ \t]+$/;
const ATX_HEADING_PREFIX_RE = /^([ \t]*)(#{1,6})(?=[ \t]|$)/;
const BLOCK_ABSORBING_UNMAPPED_KINDS: ReadonlySet<UnmappedKind> = new Set([
  'html-block',
  'table',
  'blockquote',
  'callout',
  'footnote-def',
]);

function indexLfLines(lfText: string): LineIndex {
  if (lfText.length === 0) {
    return {
      lines: [],
      lineStartOffsets: [],
      hasTrailingNewline: false,
    };
  }
  const hasTrailingNewline = lfText.endsWith('\n');
  const lines = lfText.split('\n');
  if (hasTrailingNewline && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const lineStartOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStartOffsets.push(offset);
    offset += line.length + 1;
  }
  return { lines, lineStartOffsets, hasTrailingNewline };
}

function reject(reason: PatchRejectReason, detail: string): PlanFailure {
  return { ok: false, reason, detail };
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function validateTitleInput(
  rawTitle: string,
): { readonly ok: true; readonly title: string } | PlanFailure {
  if (rawTitle.includes('\n') || rawTitle.includes('\r')) {
    return reject('newline-in-title', 'Topic title must be a single line.');
  }
  const trimmed = rawTitle.trim();
  if (trimmed.length === 0) {
    return reject('empty-title', 'Topic title cannot be empty.');
  }
  return { ok: true, title: trimmed };
}

// Line starts that CommonMark would read as a nested block inside a list item
// (heading, list item, quote, fence, thematic break, HTML block), changing the map structure.
const LIST_TITLE_BLOCK_SYNTAX_RE =
  /^(?:#{1,6}(?:[ \t]|$)|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|>|`{3,}|~{3,}|(?:[-*_][ \t]*){3,}$|<[A-Za-z!/?])/;

function rejectListTitleBlockSyntax(title: string): PlanFailure | null {
  if (LIST_TITLE_BLOCK_SYNTAX_RE.test(title)) {
    return reject(
      'block-syntax-in-title',
      'A list topic title cannot start with Markdown block syntax (heading, list marker, quote, fence, rule, or HTML).',
    );
  }
  return null;
}

function verifyGuard(
  doc: MindMapDocument,
  guard: PatchGuard,
): { readonly ok: true; readonly target: TopicNode } | PlanFailure {
  if (doc.readOnlyReasons.length > 0) {
    return reject(
      'read-only-document',
      `Document is read-only (${doc.readOnlyReasons.join(', ')}).`,
    );
  }
  if (doc.contentHash !== guard.expectedContentHash) {
    return reject('stale-target', 'Document content has changed since the command was created.');
  }
  const target = doc.nodes.get(guard.targetNodeId);
  if (!target) {
    return reject('stale-target', `Target node "${guard.targetNodeId}" no longer exists.`);
  }
  if (
    target.titleRaw !== guard.expectedTitleRaw ||
    target.ownRangeHash !== guard.expectedOwnRangeHash
  ) {
    return reject('stale-target', 'Target node range or title no longer matches.');
  }
  return { ok: true, target };
}

function getLeadingWhitespace(line: string): string {
  return /^([ \t]*)/.exec(line)?.[1] ?? '';
}

function nextOrderedMarker(marker: string): string {
  const match = ORDERED_MARKER_RE.exec(marker);
  if (!match || match[1] === undefined || match[2] === undefined) {
    return marker;
  }
  const nextNum = Number.parseInt(match[1], 10) + 1;
  return `${nextNum}${match[2]}`;
}

function firstChildListMarker(parentMarker: string | null): string {
  if (parentMarker === null) return '-';
  const match = ORDERED_MARKER_RE.exec(parentMarker);
  if (match && match[2] !== undefined) {
    return `1${match[2]}`;
  }
  return parentMarker;
}

/**
 * Returns the UTF-16 offset range [start, end) covering lines [startLine, endLine)
 * excluding the trailing newline after endLine - 1.
 */
function lineSpanContentOffsets(
  lfText: string,
  lineIndex: LineIndex,
  startLine: number,
  endLine: number,
): OffsetRange {
  const start = lineIndex.lineStartOffsets[startLine] ?? lfText.length;
  if (endLine <= startLine) {
    return { start, end: start };
  }
  const lastLineIdx = endLine - 1;
  const lastStart = lineIndex.lineStartOffsets[lastLineIdx] ?? lfText.length;
  const lastLineLen = lineIndex.lines[lastLineIdx]?.length ?? 0;
  return { start, end: lastStart + lastLineLen };
}

/**
 * Returns the UTF-16 offset range [start, end) to completely delete lines [startLine, endLine)
 * without leaving an orphan newline at EOF when hasTrailingNewline is false.
 */
function lineSpanDeleteOffsets(
  lfText: string,
  lineIndex: LineIndex,
  startLine: number,
  endLine: number,
): OffsetRange {
  const { lines, lineStartOffsets, hasTrailingNewline } = lineIndex;
  if (startLine >= endLine || lines.length === 0) {
    const pos = lineStartOffsets[startLine] ?? lfText.length;
    return { start: pos, end: pos };
  }
  if (endLine < lines.length) {
    return {
      start: lineStartOffsets[startLine] ?? 0,
      end: lineStartOffsets[endLine] ?? lfText.length,
    };
  }
  // Deleting through the end of the file
  if (startLine === 0) {
    return { start: 0, end: lfText.length };
  }
  if (hasTrailingNewline) {
    return { start: lineStartOffsets[startLine] ?? lfText.length, end: lfText.length };
  }
  // No trailing newline: consume the newline right before startLine so no dangling blank line remains
  const startOffset = lineStartOffsets[startLine] ?? lfText.length;
  return { start: Math.max(0, startOffset - 1), end: lfText.length };
}

function collectSubtreeNodes(doc: MindMapDocument, root: TopicNode): readonly TopicNode[] {
  const result: TopicNode[] = [];
  const stack: TopicNode[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    result.push(current);
    for (let i = current.childIds.length - 1; i >= 0; i -= 1) {
      const childId = current.childIds[i];
      const child = childId !== undefined ? doc.nodes.get(childId) : undefined;
      if (child) {
        stack.push(child);
      }
    }
  }
  return result;
}

function subtreeHasAnyUnmapped(doc: MindMapDocument, root: TopicNode): boolean {
  return collectSubtreeNodes(doc, root).some((node) => node.unmappedBlocks.length > 0);
}

function subtreeHasIndentSensitiveUnmapped(doc: MindMapDocument, root: TopicNode): boolean {
  return collectSubtreeNodes(doc, root).some((node) =>
    node.unmappedBlocks.some((block) => block.indentSensitive),
  );
}

/**
 * Builds the leading whitespace for the first child of a list item so the child reaches the
 * parent's CommonMark content column (e.g. 3 columns under "1. a"). Tab-indented lists keep
 * tabs when one tab reaches the content column.
 */
function buildFirstChildIndent(
  doc: MindMapDocument,
  lineIndex: LineIndex,
  parent: TopicNode,
): string | null {
  const parentLine = lineIndex.lines[parent.headerLine] ?? '';
  const parentIndent = getLeadingWhitespace(parentLine);
  const contentColumns = listItemContentColumnsOfLine(parentLine);
  if (contentColumns === null) return null;
  const parentIndentColumns = countIndentColumns(parentIndent);

  if (listUsesTabs(doc, lineIndex, parent)) {
    const withTab = `${parentIndent}\t`;
    return countIndentColumns(withTab) >= contentColumns ? withTab : null;
  }
  return `${parentIndent}${' '.repeat(Math.max(1, contentColumns - parentIndentColumns))}`;
}

function listUsesTabs(doc: MindMapDocument, lineIndex: LineIndex, parent: TopicNode): boolean {
  let cursor: TopicNode | undefined = parent;
  while (cursor && cursor.kind === 'list-item') {
    const rawIndent = getLeadingWhitespace(lineIndex.lines[cursor.headerLine] ?? '');
    if (rawIndent.includes('\t')) return true;
    if (rawIndent.includes(' ')) return false;
    cursor = cursor.parentId !== null ? doc.nodes.get(cursor.parentId) : undefined;
  }

  const grandParent = parent.parentId !== null ? doc.nodes.get(parent.parentId) : undefined;
  if (grandParent) {
    for (const sibId of grandParent.childIds) {
      const sib = doc.nodes.get(sibId);
      if (!sib || sib.kind !== 'list-item') continue;
      const rawIndent = getLeadingWhitespace(lineIndex.lines[sib.headerLine] ?? '');
      if (rawIndent.includes('\t')) return true;
      if (rawIndent.includes(' ')) return false;
    }
  }
  return false;
}

function needsBlankLineBeforeInsert(doc: MindMapDocument, insertLineIndex: number): boolean {
  if (insertLineIndex <= 0) return false;
  for (const node of doc.nodes.values()) {
    for (const block of node.unmappedBlocks) {
      if (
        block.range.endLine === insertLineIndex &&
        BLOCK_ABSORBING_UNMAPPED_KINDS.has(block.kind)
      ) {
        return true;
      }
    }
  }
  return false;
}

function buildInsertLineEdit(
  lfText: string,
  lineIndex: LineIndex,
  insertLineIndex: number,
  newLine: string,
  prependBlankLine: boolean,
): { readonly edit: TextEdit; readonly targetHeaderLine: number } {
  const { lines, lineStartOffsets, hasTrailingNewline } = lineIndex;

  if (lines.length === 0) {
    return {
      edit: { range: { start: 0, end: 0 }, replacement: `${newLine}\n` },
      targetHeaderLine: 0,
    };
  }

  const blankPrefix = prependBlankLine ? '\n' : '';
  const blankOffset = prependBlankLine ? 1 : 0;

  if (insertLineIndex < lines.length) {
    const offset = lineStartOffsets[insertLineIndex] ?? 0;
    return {
      edit: {
        range: { start: offset, end: offset },
        replacement: `${blankPrefix}${newLine}\n`,
      },
      targetHeaderLine: insertLineIndex + blankOffset,
    };
  }

  const offset = lfText.length;
  const replacement = hasTrailingNewline
    ? `${blankPrefix}${newLine}\n`
    : `\n${blankPrefix}${newLine}`;
  return {
    edit: { range: { start: offset, end: offset }, replacement },
    targetHeaderLine: lines.length + blankOffset,
  };
}

function shiftHeadingLines(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  doc: MindMapDocument,
  delta: number,
  minAllowedLevel: number,
): { readonly ok: true; readonly nextLines: readonly string[] } | PlanFailure {
  const headingLineSet = new Set<number>();
  for (const node of doc.nodes.values()) {
    if (
      node.kind === 'heading' &&
      node.headerLine >= startLine &&
      node.headerLine < endLine
    ) {
      const level = node.headingLevel ?? 0;
      const nextLevel = level + delta;
      if (nextLevel < minAllowedLevel || nextLevel > 6) {
        return reject(
          'heading-level-out-of-range',
          `Shifting heading level from ${level} by ${delta} exceeds allowed range [${minAllowedLevel}, 6].`,
        );
      }
      headingLineSet.add(node.headerLine);
    }
  }

  const nextLines: string[] = [];
  for (let ln = startLine; ln < endLine; ln += 1) {
    const raw = lines[ln] ?? '';
    if (!headingLineSet.has(ln)) {
      nextLines.push(raw);
      continue;
    }
    const match = ATX_HEADING_PREFIX_RE.exec(raw);
    if (!match || match[1] === undefined || match[2] === undefined) {
      return reject('invariant-check-failed', `Heading line ${ln + 1} could not be rewritten.`);
    }
    const nextLevel = match[2].length + delta;
    const rest = raw.slice(match[1].length + match[2].length);
    nextLines.push(`${match[1]}${'#'.repeat(nextLevel)}${rest}`);
  }
  return { ok: true, nextLines };
}

function reindentListLines(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  fromPrefix: string,
  toPrefix: string,
): { readonly ok: true; readonly nextLines: readonly string[] } | PlanFailure {
  const nextLines: string[] = [];
  for (let ln = startLine; ln < endLine; ln += 1) {
    const raw = lines[ln] ?? '';
    if (isBlankLine(raw)) {
      nextLines.push(raw);
      continue;
    }
    if (!raw.startsWith(fromPrefix)) {
      return reject(
        'invariant-check-failed',
        `Line ${ln + 1} does not share expected list indentation prefix.`,
      );
    }
    nextLines.push(`${toPrefix}${raw.slice(fromPrefix.length)}`);
  }
  return { ok: true, nextLines };
}

function planRename(
  lfText: string,
  lineIndex: LineIndex,
  target: TopicNode,
  rawNewTitle: string,
): PlanResult {
  const validated = validateTitleInput(rawNewTitle);
  if (!validated.ok) return validated;
  const newTitle = validated.title;

  if (target.kind === 'central-virtual') {
    const frontmatterBlock = target.unmappedBlocks.find((block) => block.kind === 'frontmatter');
    const insertLine = frontmatterBlock ? frontmatterBlock.range.endLine : 0;
    const { edit, targetHeaderLine } = buildInsertLineEdit(
      lfText,
      lineIndex,
      insertLine,
      `# ${newTitle}`,
      false,
    );
    return {
      ok: true,
      edits: [edit],
      focusHint: { targetHeaderLine, expectedTitleRaw: newTitle },
    };
  }

  if (target.titleRange === null) {
    return reject('invariant-check-failed', 'Editable topic is missing a titleRange.');
  }
  if (target.kind === 'list-item') {
    const syntaxFailure = rejectListTitleBlockSyntax(newTitle);
    if (syntaxFailure) return syntaxFailure;
  }

  const lineStart = lineIndex.lineStartOffsets[target.headerLine] ?? 0;
  const prevChar =
    target.titleRange.start > lineStart ? lfText[target.titleRange.start - 1] : undefined;
  const needsLeadingSpace =
    prevChar !== undefined && prevChar !== ' ' && prevChar !== '\t';

  return {
    ok: true,
    edits: [
      {
        range: target.titleRange,
        replacement: needsLeadingSpace ? ` ${newTitle}` : newTitle,
      },
    ],
    focusHint: {
      targetHeaderLine: target.headerLine,
      expectedTitleRaw: newTitle,
    },
  };
}

function planInsertChild(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  parent: TopicNode,
  rawTitle: string,
  position: 'end' | number | undefined,
): PlanResult {
  const validated = validateTitleInput(rawTitle);
  if (!validated.ok) return validated;
  const title = validated.title;

  const existingChildren = parent.childIds
    .map((id) => doc.nodes.get(id))
    .filter((node): node is TopicNode => node !== undefined);

  let insertLineIndex: number;
  let referenceChild: TopicNode | undefined;

  if (existingChildren.length === 0) {
    insertLineIndex =
      parent.kind === 'central-virtual' ? lineIndex.lines.length : parent.subtreeRange.endLine;
  } else if (typeof position === 'number' && position >= 0 && position < existingChildren.length) {
    const childAtPos = existingChildren[position];
    insertLineIndex = childAtPos ? childAtPos.headerLine : parent.subtreeRange.endLine;
    referenceChild = childAtPos;
  } else {
    const lastChild = existingChildren[existingChildren.length - 1];
    insertLineIndex = lastChild ? lastChild.subtreeRange.endLine : parent.subtreeRange.endLine;
    referenceChild = lastChild;
  }

  let newLine: string;
  if (parent.kind === 'list-item') {
    if (referenceChild && referenceChild.kind === 'list-item') {
      const childIndent = getLeadingWhitespace(lineIndex.lines[referenceChild.headerLine] ?? '');
      const marker =
        typeof position === 'number' && position < existingChildren.length
          ? (referenceChild.listMarker ?? '-')
          : nextOrderedMarker(referenceChild.listMarker ?? '-');
      newLine = `${childIndent}${marker} ${title}`;
    } else {
      const childIndent = buildFirstChildIndent(doc, lineIndex, parent);
      if (childIndent === null) {
        return reject(
          'invariant-check-failed',
          'Could not compute a child indent that reaches the parent list content column.',
        );
      }
      const marker = firstChildListMarker(parent.listMarker);
      newLine = `${childIndent}${marker} ${title}`;
    }
  } else if (referenceChild) {
    if (referenceChild.kind === 'list-item') {
      const childIndent = getLeadingWhitespace(lineIndex.lines[referenceChild.headerLine] ?? '');
      const marker =
        typeof position === 'number' && position < existingChildren.length
          ? (referenceChild.listMarker ?? '-')
          : nextOrderedMarker(referenceChild.listMarker ?? '-');
      newLine = `${childIndent}${marker} ${title}`;
    } else {
      const level = referenceChild.headingLevel ?? 2;
      if (level < 1 || level > 6) {
        return reject('heading-level-out-of-range', `Unsupported heading level ${level}.`);
      }
      newLine = `${'#'.repeat(level)} ${title}`;
    }
  } else if (parent.kind === 'central-virtual' || parent.headingLevel === 1) {
    newLine = `## ${title}`;
  } else {
    newLine = `- ${title}`;
  }

  if (!newLine.trimStart().startsWith('#')) {
    const syntaxFailure = rejectListTitleBlockSyntax(title);
    if (syntaxFailure) return syntaxFailure;
  }

  const prependBlankLine = needsBlankLineBeforeInsert(doc, insertLineIndex);
  const { edit, targetHeaderLine } = buildInsertLineEdit(
    lfText,
    lineIndex,
    insertLineIndex,
    newLine,
    prependBlankLine,
  );

  return {
    ok: true,
    edits: [edit],
    focusHint: { targetHeaderLine, expectedTitleRaw: title },
  };
}

function buildSiblingLine(
  lineIndex: LineIndex,
  target: TopicNode,
  title: string,
  placement: 'after' | 'before',
): { readonly ok: true; readonly newLine: string } | PlanFailure {
  if (target.kind === 'heading') {
    const level = target.headingLevel ?? 2;
    if (level < 1 || level > 6) {
      return reject('heading-level-out-of-range', `Unsupported heading level ${level}.`);
    }
    return { ok: true, newLine: `${'#'.repeat(level)} ${title}` };
  }
  const syntaxFailure = rejectListTitleBlockSyntax(title);
  if (syntaxFailure) return syntaxFailure;

  const indentRaw = getLeadingWhitespace(lineIndex.lines[target.headerLine] ?? '');
  const baseMarker = target.listMarker ?? '-';
  const marker = placement === 'after' ? nextOrderedMarker(baseMarker) : baseMarker;
  return { ok: true, newLine: `${indentRaw}${marker} ${title}` };
}

function planInsertSibling(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
  rawTitle: string,
  placement: 'after' | 'before',
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-insert-sibling-for-root', 'Cannot insert a sibling for the central topic.');
  }

  const validated = validateTitleInput(rawTitle);
  if (!validated.ok) return validated;
  const title = validated.title;

  const built = buildSiblingLine(lineIndex, target, title, placement);
  if (!built.ok) return built;

  const insertLineIndex =
    placement === 'before' ? target.headerLine : target.subtreeRange.endLine;
  const prependBlankLine =
    placement === 'after' && needsBlankLineBeforeInsert(doc, insertLineIndex);

  const { edit, targetHeaderLine } = buildInsertLineEdit(
    lfText,
    lineIndex,
    insertLineIndex,
    built.newLine,
    prependBlankLine,
  );

  return {
    ok: true,
    edits: [edit],
    focusHint: { targetHeaderLine, expectedTitleRaw: title },
  };
}

function planSplitSibling(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
  rawLeftTitle: string,
  rawRightTitle: string,
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-insert-sibling-for-root', 'Cannot split the central topic into a sibling.');
  }
  if (target.titleRange === null) {
    return reject('invariant-check-failed', 'Editable topic is missing a titleRange.');
  }

  const leftVal = validateTitleInput(rawLeftTitle);
  if (!leftVal.ok) return leftVal;
  const rightVal = validateTitleInput(rawRightTitle);
  if (!rightVal.ok) return rightVal;

  if (target.kind === 'list-item') {
    const leftSyntax = rejectListTitleBlockSyntax(leftVal.title);
    if (leftSyntax) return leftSyntax;
  }

  const builtSibling = buildSiblingLine(lineIndex, target, rightVal.title, 'after');
  if (!builtSibling.ok) return builtSibling;

  const lineStart = lineIndex.lineStartOffsets[target.headerLine] ?? 0;
  const prevChar =
    target.titleRange.start > lineStart ? lfText[target.titleRange.start - 1] : undefined;
  const needsLeadingSpace = prevChar !== undefined && prevChar !== ' ' && prevChar !== '\t';

  const renameEdit: TextEdit = {
    range: target.titleRange,
    replacement: needsLeadingSpace ? ` ${leftVal.title}` : leftVal.title,
  };

  const insertLineIndex = target.subtreeRange.endLine;
  const prependBlankLine = needsBlankLineBeforeInsert(doc, insertLineIndex);
  const { edit: insertEdit, targetHeaderLine } = buildInsertLineEdit(
    lfText,
    lineIndex,
    insertLineIndex,
    builtSibling.newLine,
    prependBlankLine,
  );

  return {
    ok: true,
    edits: [renameEdit, insertEdit],
    focusHint: { targetHeaderLine, expectedTitleRaw: rightVal.title },
  };
}

function planToggleTask(
  lfText: string,
  target: TopicNode,
): PlanResult {
  if (target.kind !== 'list-item' || target.titleRange === null) {
    return reject('not-a-task', 'Only Markdown task list items can be toggled.');
  }
  const match = TASK_TOGGLE_PREFIX_RE.exec(target.preservedPrefix);
  if (!match || match[1] === undefined) {
    return reject('not-a-task', 'This topic does not have a standard [ ] / [x] task checkbox.');
  }

  const prefixStart = target.titleRange.start - target.preservedPrefix.length;
  const statusOffset = prefixStart + 1;
  const currentChar = lfText[statusOffset];
  if (prefixStart < 0 || lfText[prefixStart] !== '[' || currentChar !== match[1]) {
    return reject('invariant-check-failed', 'Task checkbox offset mismatch.');
  }

  const nextChar = currentChar === ' ' ? 'x' : ' ';
  return {
    ok: true,
    edits: [
      {
        range: { start: statusOffset, end: statusOffset + 1 },
        replacement: nextChar,
      },
    ],
    focusHint: {
      targetHeaderLine: target.headerLine,
      expectedTitleRaw: target.titleRaw,
    },
  };
}

function planInsertParent(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
  rawParentTitle: string,
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-modify-root', 'Cannot insert a parent above the central topic.');
  }

  const validated = validateTitleInput(rawParentTitle);
  if (!validated.ok) return validated;
  const parentTitle = validated.title;

  const { startLine, endLine } = target.subtreeRange;
  const spanRange = lineSpanContentOffsets(lfText, lineIndex, startLine, endLine);

  if (target.kind === 'heading') {
    const level = target.headingLevel ?? 2;
    if (level < 1 || level >= 6) {
      return reject('heading-level-out-of-range', 'Cannot wrap a level-6 heading with a new parent.');
    }
    const shifted = shiftHeadingLines(lineIndex.lines, startLine, endLine, doc, 1, 2);
    if (!shifted.ok) return shifted;

    const parentLine = `${'#'.repeat(level)} ${parentTitle}`;
    return {
      ok: true,
      edits: [{ range: spanRange, replacement: [parentLine, ...shifted.nextLines].join('\n') }],
      focusHint: { targetHeaderLine: startLine, expectedTitleRaw: parentTitle },
    };
  }

  // List item: check indent-sensitive unmapped blocks before shifting indentation
  const syntaxFailure = rejectListTitleBlockSyntax(parentTitle);
  if (syntaxFailure) return syntaxFailure;

  if (subtreeHasIndentSensitiveUnmapped(doc, target)) {
    return reject(
      'indent-sensitive-unmapped-block',
      'Cannot indent a subtree containing an indent-sensitive preserved block.',
    );
  }

  const targetLine = lineIndex.lines[startLine] ?? '';
  const targetIndent = getLeadingWhitespace(targetLine);
  const targetMarker = target.listMarker ?? '-';
  const parentLine = `${targetIndent}${targetMarker} ${parentTitle}`;

  // Compute child indent needed to nest under the newly created parent per CommonMark
  const parentContentCols = listItemContentColumnsOfLine(parentLine);
  if (parentContentCols === null) {
    return reject('invariant-check-failed', 'Failed to compute content column for new parent.');
  }
  const targetIndentCols = countIndentColumns(targetIndent);
  let childIndent: string;
  if (listUsesTabs(doc, lineIndex, target)) {
    const withTab = `${targetIndent}\t`;
    if (countIndentColumns(withTab) < parentContentCols) {
      return reject(
        'invariant-check-failed',
        'A single tab does not reach the parent list content column.',
      );
    }
    childIndent = withTab;
  } else {
    childIndent = `${targetIndent}${' '.repeat(Math.max(1, parentContentCols - targetIndentCols))}`;
  }

  const reindented = reindentListLines(lineIndex.lines, startLine, endLine, targetIndent, childIndent);
  if (!reindented.ok) return reindented;

  return {
    ok: true,
    edits: [{ range: spanRange, replacement: [parentLine, ...reindented.nextLines].join('\n') }],
    focusHint: { targetHeaderLine: startLine, expectedTitleRaw: parentTitle },
  };
}

function planMoveSibling(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
  direction: 'up' | 'down',
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-modify-root', 'Cannot reorder the central topic.');
  }
  const parent = doc.nodes.get(target.parentId);
  if (!parent) {
    return reject('invariant-check-failed', 'Parent topic not found.');
  }

  const idx = parent.childIds.indexOf(target.id);
  if (idx === -1) {
    return reject('invariant-check-failed', 'Target topic not found in parent children.');
  }
  const otherIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (otherIdx < 0 || otherIdx >= parent.childIds.length) {
    return reject('boundary-no-op', `Topic is already the ${direction === 'up' ? 'first' : 'last'} sibling.`);
  }

  const otherId = parent.childIds[otherIdx];
  const other = otherId !== undefined ? doc.nodes.get(otherId) : undefined;
  if (!other) {
    return reject('invariant-check-failed', 'Adjacent sibling topic not found.');
  }

  if (target.kind !== other.kind) {
    return reject(
      'mixed-heading-list-conversion',
      'Cannot reorder a heading across a list item sibling.',
    );
  }
  if (target.kind === 'heading' && target.headingLevel !== other.headingLevel) {
    return reject(
      'mixed-heading-list-conversion',
      'Cannot reorder headings of different levels directly.',
    );
  }

  const first = direction === 'up' ? other : target;
  const second = direction === 'up' ? target : other;

  const firstLines = lineIndex.lines.slice(first.subtreeRange.startLine, first.subtreeRange.endLine);
  const gapLines = lineIndex.lines.slice(first.subtreeRange.endLine, second.subtreeRange.startLine);
  const secondLines = lineIndex.lines.slice(second.subtreeRange.startLine, second.subtreeRange.endLine);

  const combinedRange = lineSpanContentOffsets(
    lfText,
    lineIndex,
    first.subtreeRange.startLine,
    second.subtreeRange.endLine,
  );
  const replacement = [...secondLines, ...gapLines, ...firstLines].join('\n');

  const nextTargetHeaderLine =
    direction === 'up'
      ? first.subtreeRange.startLine
      : first.subtreeRange.startLine + secondLines.length + gapLines.length;

  return {
    ok: true,
    edits: [{ range: combinedRange, replacement }],
    focusHint: {
      targetHeaderLine: nextTargetHeaderLine,
      expectedTitleRaw: target.titleRaw,
    },
  };
}

function planIndent(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-modify-root', 'Cannot indent the central topic.');
  }
  const parent = doc.nodes.get(target.parentId);
  if (!parent) {
    return reject('invariant-check-failed', 'Parent topic not found.');
  }
  const idx = parent.childIds.indexOf(target.id);
  if (idx <= 0) {
    return reject('boundary-no-op', 'Cannot indent the first sibling (no previous sibling to nest under).');
  }

  const prevSibId = parent.childIds[idx - 1];
  const prevSib = prevSibId !== undefined ? doc.nodes.get(prevSibId) : undefined;
  if (!prevSib) {
    return reject('invariant-check-failed', 'Previous sibling not found.');
  }

  if (target.kind !== prevSib.kind) {
    return reject(
      'mixed-heading-list-conversion',
      'Cannot indent across heading and list item boundaries.',
    );
  }

  const { startLine, endLine } = target.subtreeRange;
  const spanRange = lineSpanContentOffsets(lfText, lineIndex, startLine, endLine);

  if (target.kind === 'heading') {
    const prevLevel = prevSib.headingLevel ?? 2;
    const targetLevel = target.headingLevel ?? 2;
    const delta = prevLevel + 1 - targetLevel;
    if (delta < 1) {
      return reject('invariant-check-failed', 'Heading is already deeper than previous sibling.');
    }
    const shifted = shiftHeadingLines(lineIndex.lines, startLine, endLine, doc, delta, 2);
    if (!shifted.ok) return shifted;

    return {
      ok: true,
      edits: [{ range: spanRange, replacement: shifted.nextLines.join('\n') }],
      focusHint: { targetHeaderLine: startLine, expectedTitleRaw: target.titleRaw },
    };
  }

  // List item indent
  if (subtreeHasIndentSensitiveUnmapped(doc, target)) {
    return reject(
      'indent-sensitive-unmapped-block',
      'Cannot indent a subtree containing an indent-sensitive preserved block.',
    );
  }

  const currentIndent = getLeadingWhitespace(lineIndex.lines[startLine] ?? '');
  const existingChildOfPrev = prevSib.childIds
    .map((id) => doc.nodes.get(id))
    .find((node): node is TopicNode => node !== undefined && node.kind === 'list-item');

  const newIndent = existingChildOfPrev
    ? getLeadingWhitespace(lineIndex.lines[existingChildOfPrev.headerLine] ?? '')
    : buildFirstChildIndent(doc, lineIndex, prevSib);

  if (newIndent === null) {
    return reject(
      'invariant-check-failed',
      'Could not compute indentation to nest under the previous list item.',
    );
  }

  const reindented = reindentListLines(lineIndex.lines, startLine, endLine, currentIndent, newIndent);
  if (!reindented.ok) return reindented;

  return {
    ok: true,
    edits: [{ range: spanRange, replacement: reindented.nextLines.join('\n') }],
    focusHint: { targetHeaderLine: startLine, expectedTitleRaw: target.titleRaw },
  };
}

function planOutdent(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-modify-root', 'Cannot outdent the central topic.');
  }
  const parent = doc.nodes.get(target.parentId);
  if (!parent || parent.id === doc.rootId || parent.parentId === null) {
    return reject('boundary-no-op', 'Topic is already a top-level branch under the central topic.');
  }
  const grandParent = doc.nodes.get(parent.parentId);
  if (!grandParent) {
    return reject('invariant-check-failed', 'Grandparent topic not found.');
  }

  if (target.kind !== parent.kind) {
    return reject(
      'mixed-heading-list-conversion',
      'Cannot outdent a list item into a heading level.',
    );
  }

  const { startLine, endLine } = target.subtreeRange;
  let transformedLines: readonly string[];

  if (target.kind === 'heading') {
    const parentLevel = parent.headingLevel ?? 2;
    const targetLevel = target.headingLevel ?? 3;
    const delta = parentLevel - targetLevel; // negative
    if (delta >= 0) {
      return reject('invariant-check-failed', 'Heading is not deeper than its parent.');
    }
    const minLevel =
      grandParent.kind === 'central-virtual'
        ? 2
        : grandParent.headingLevel !== null
          ? grandParent.headingLevel + 1
          : 1;
    const shifted = shiftHeadingLines(lineIndex.lines, startLine, endLine, doc, delta, minLevel);
    if (!shifted.ok) return shifted;
    transformedLines = shifted.nextLines;
  } else {
    if (subtreeHasIndentSensitiveUnmapped(doc, target)) {
      return reject(
        'indent-sensitive-unmapped-block',
        'Cannot outdent a subtree containing an indent-sensitive preserved block.',
      );
    }
    const currentIndent = getLeadingWhitespace(lineIndex.lines[startLine] ?? '');
    const parentIndent = getLeadingWhitespace(lineIndex.lines[parent.headerLine] ?? '');
    const reindented = reindentListLines(
      lineIndex.lines,
      startLine,
      endLine,
      currentIndent,
      parentIndent,
    );
    if (!reindented.ok) return reindented;
    transformedLines = reindented.nextLines;
  }

  const targetIdx = parent.childIds.indexOf(target.id);
  const isLastChild = targetIdx === parent.childIds.length - 1;

  if (isLastChild) {
    const spanRange = lineSpanContentOffsets(lfText, lineIndex, startLine, endLine);
    return {
      ok: true,
      edits: [{ range: spanRange, replacement: transformedLines.join('\n') }],
      focusHint: { targetHeaderLine: startLine, expectedTitleRaw: target.titleRaw },
    };
  }

  // Target has following siblings under parent: relocate target's transformed subtree immediately
  // after parent's remaining subtree so following siblings stay attached to parent.
  const parentEndLine = parent.subtreeRange.endLine;
  const tailLines = lineIndex.lines.slice(endLine, parentEndLine);
  const spanRange = lineSpanContentOffsets(lfText, lineIndex, startLine, parentEndLine);

  // Preserve separating blank line between remaining siblings and relocated target if present
  const needsSep =
    tailLines.length > 0 &&
    needsBlankLineBeforeInsert(doc, parentEndLine);
  const combinedLines = needsSep
    ? [...tailLines, '', ...transformedLines]
    : [...tailLines, ...transformedLines];
  const nextHeaderLine = startLine + tailLines.length + (needsSep ? 1 : 0);

  return {
    ok: true,
    edits: [{ range: spanRange, replacement: combinedLines.join('\n') }],
    focusHint: { targetHeaderLine: nextHeaderLine, expectedTitleRaw: target.titleRaw },
  };
}

function resolvePostDeleteFocus(
  doc: MindMapDocument,
  target: TopicNode,
  deletedLineCount: number,
): PatchFocusHint {
  const parent = target.parentId !== null ? doc.nodes.get(target.parentId) : undefined;
  if (!parent) {
    return { targetHeaderLine: -1, expectedTitleRaw: '' };
  }
  const idx = parent.childIds.indexOf(target.id);
  if (idx !== -1 && idx + 1 < parent.childIds.length) {
    const nextSibId = parent.childIds[idx + 1];
    const nextSib = nextSibId !== undefined ? doc.nodes.get(nextSibId) : undefined;
    if (nextSib) {
      return {
        targetHeaderLine: nextSib.headerLine - deletedLineCount,
        expectedTitleRaw: nextSib.titleRaw,
      };
    }
  }
  if (idx > 0) {
    const prevSibId = parent.childIds[idx - 1];
    const prevSib = prevSibId !== undefined ? doc.nodes.get(prevSibId) : undefined;
    if (prevSib) {
      return {
        targetHeaderLine: prevSib.headerLine,
        expectedTitleRaw: prevSib.titleRaw,
      };
    }
  }
  if (parent.kind === 'central-virtual') {
    return { targetHeaderLine: -1, expectedTitleRaw: parent.titleRaw };
  }
  return {
    targetHeaderLine: parent.headerLine,
    expectedTitleRaw: parent.titleRaw,
  };
}

function planDeleteBranch(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
  confirmedUnmapped: boolean | undefined,
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-modify-root', 'Cannot delete the central topic.');
  }

  if (confirmedUnmapped !== true && subtreeHasAnyUnmapped(doc, target)) {
    return reject(
      'unmapped-delete-requires-confirmation',
      'This branch contains preserved non-map blocks and requires confirmation before deletion.',
    );
  }

  const { startLine, endLine } = target.subtreeRange;
  const deleteRange = lineSpanDeleteOffsets(lfText, lineIndex, startLine, endLine);
  const deletedLineCount = endLine - startLine;

  return {
    ok: true,
    edits: [{ range: deleteRange, replacement: '' }],
    focusHint: resolvePostDeleteFocus(doc, target, deletedLineCount),
  };
}

function planDeleteNodeKeepChildren(
  lfText: string,
  doc: MindMapDocument,
  lineIndex: LineIndex,
  target: TopicNode,
): PlanResult {
  if (target.id === doc.rootId || target.parentId === null || target.kind === 'central-virtual') {
    return reject('cannot-modify-root', 'Cannot delete the central topic.');
  }
  if (target.noteRange !== null || target.unmappedBlocks.length > 0) {
    return reject(
      'cannot-promote-with-note-or-unmapped',
      'Cannot delete only this topic while promoting children because it owns a topic note or preserved blocks.',
    );
  }

  const parent = doc.nodes.get(target.parentId);
  if (!parent) {
    return reject('invariant-check-failed', 'Parent topic not found.');
  }

  // Leaf node: deleting node while keeping 0 children is simply deleting its header line
  if (target.childIds.length === 0) {
    const deleteRange = lineSpanDeleteOffsets(
      lfText,
      lineIndex,
      target.headerLine,
      target.headerLine + 1,
    );
    return {
      ok: true,
      edits: [{ range: deleteRange, replacement: '' }],
      focusHint: resolvePostDeleteFocus(doc, target, 1),
    };
  }

  const children = target.childIds
    .map((id) => doc.nodes.get(id))
    .filter((node): node is TopicNode => node !== undefined);
  const firstChild = children[0];
  if (!firstChild) {
    return reject('invariant-check-failed', 'Child topics missing.');
  }

  const edits: TextEdit[] = [
    {
      range: lineSpanDeleteOffsets(lfText, lineIndex, target.headerLine, target.headerLine + 1),
      replacement: '',
    },
  ];

  if (target.kind === 'heading') {
    const minLevel =
      parent.kind === 'central-virtual'
        ? 2
        : parent.headingLevel !== null
          ? parent.headingLevel + 1
          : 1;

    for (const child of children) {
      if (child.kind === 'list-item') {
        // List items under a heading promote directly under the parent heading without indent change
        if (parent.kind === 'list-item') {
          return reject(
            'mixed-heading-list-conversion',
            'Cannot promote list items from a heading into a list parent.',
          );
        }
        continue;
      }
      const childLevel = child.headingLevel ?? 3;
      const targetLevel = target.headingLevel ?? 2;
      const delta = targetLevel - childLevel; // negative
      if (delta >= 0) {
        return reject('invariant-check-failed', 'Child heading level is not deeper than target.');
      }
      const { startLine, endLine } = child.subtreeRange;
      const shifted = shiftHeadingLines(lineIndex.lines, startLine, endLine, doc, delta, minLevel);
      if (!shifted.ok) return shifted;
      edits.push({
        range: lineSpanContentOffsets(lfText, lineIndex, startLine, endLine),
        replacement: shifted.nextLines.join('\n'),
      });
    }
  } else {
    // List item target: promote each list child subtree to target's exact leading whitespace
    const targetIndent = getLeadingWhitespace(lineIndex.lines[target.headerLine] ?? '');
    for (const child of children) {
      if (child.kind !== 'list-item') {
        return reject(
          'mixed-heading-list-conversion',
          'Cannot promote non-list child of a list item.',
        );
      }
      if (subtreeHasIndentSensitiveUnmapped(doc, child)) {
        return reject(
          'indent-sensitive-unmapped-block',
          'Cannot promote children containing an indent-sensitive preserved block.',
        );
      }
      const { startLine, endLine } = child.subtreeRange;
      const childIndent = getLeadingWhitespace(lineIndex.lines[startLine] ?? '');
      const reindented = reindentListLines(
        lineIndex.lines,
        startLine,
        endLine,
        childIndent,
        targetIndent,
      );
      if (!reindented.ok) return reindented;
      edits.push({
        range: lineSpanContentOffsets(lfText, lineIndex, startLine, endLine),
        replacement: reindented.nextLines.join('\n'),
      });
    }
  }

  return {
    ok: true,
    edits,
    focusHint: {
      targetHeaderLine: firstChild.headerLine - 1,
      expectedTitleRaw: firstChild.titleRaw,
    },
  };
}

/**
 * Generates minimal UTF-16 TextEdits for a SemanticCommand against LF-normalized text.
 */
export function planPatch(
  lfText: string,
  doc: MindMapDocument,
  command: SemanticCommand,
): PlanResult {
  const guardCheck = verifyGuard(doc, command.guard);
  if (!guardCheck.ok) {
    return guardCheck;
  }

  const lineIndex = indexLfLines(lfText);

  switch (command.type) {
    case 'rename':
      return planRename(lfText, lineIndex, guardCheck.target, command.newTitle);
    case 'insertChild':
      return planInsertChild(
        lfText,
        doc,
        lineIndex,
        guardCheck.target,
        command.title,
        command.position,
      );
    case 'insertSibling':
      return planInsertSibling(
        lfText,
        doc,
        lineIndex,
        guardCheck.target,
        command.title,
        command.placement,
      );
    case 'splitSibling':
      return planSplitSibling(
        lfText,
        doc,
        lineIndex,
        guardCheck.target,
        command.leftTitle,
        command.rightTitle,
      );
    case 'toggleTask':
      return planToggleTask(lfText, guardCheck.target);
    case 'insertParent':
      return planInsertParent(lfText, doc, lineIndex, guardCheck.target, command.parentTitle);
    case 'moveSibling':
      return planMoveSibling(lfText, doc, lineIndex, guardCheck.target, command.direction);
    case 'indent':
      return planIndent(lfText, doc, lineIndex, guardCheck.target);
    case 'outdent':
      return planOutdent(lfText, doc, lineIndex, guardCheck.target);
    case 'deleteBranch':
      return planDeleteBranch(
        lfText,
        doc,
        lineIndex,
        guardCheck.target,
        command.confirmedUnmapped,
      );
    case 'deleteNodeKeepChildren':
      return planDeleteNodeKeepChildren(lfText, doc, lineIndex, guardCheck.target);
    case 'updateNote':
    case 'renameAndInsertChild':
    case 'reparent':
    case 'pasteBranch':
      return reject(
        'unsupported-command',
        `Command "${command.type}" is not enabled yet (scheduled for M2-c / M3).`,
      );
  }
}
