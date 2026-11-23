import type { MindMapDocument, TopicNode, UnmappedKind } from '../model';
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

  // Also inspect siblings of the parent to keep list group indentation consistent.
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

  // Determine insertion slot and reference child
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

  let newLine: string;
  if (target.kind === 'heading') {
    const level = target.headingLevel ?? 2;
    if (level < 1 || level > 6) {
      return reject('heading-level-out-of-range', `Unsupported heading level ${level}.`);
    }
    newLine = `${'#'.repeat(level)} ${title}`;
  } else {
    const indentRaw = getLeadingWhitespace(lineIndex.lines[target.headerLine] ?? '');
    const baseMarker = target.listMarker ?? '-';
    const marker = placement === 'after' ? nextOrderedMarker(baseMarker) : baseMarker;
    newLine = `${indentRaw}${marker} ${title}`;
  }

  if (target.kind === 'list-item') {
    const syntaxFailure = rejectListTitleBlockSyntax(title);
    if (syntaxFailure) return syntaxFailure;
  }

  const insertLineIndex =
    placement === 'before' ? target.headerLine : target.subtreeRange.endLine;
  const prependBlankLine =
    placement === 'after' && needsBlankLineBeforeInsert(doc, insertLineIndex);

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
    case 'updateNote':
    case 'renameAndInsertChild':
    case 'insertParent':
    case 'moveSibling':
    case 'indent':
    case 'outdent':
    case 'reparent':
    case 'deleteBranch':
    case 'deleteNodeKeepChildren':
    case 'pasteBranch':
      return reject(
        'unsupported-command',
        `Command "${command.type}" is not enabled yet (scheduled for M2-b/M2-c).`,
      );
  }
}
