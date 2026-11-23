import { hashText, utf8ByteLength } from '../hash';
import type {
  LineEnding,
  LineKind,
  LineRange,
  MindMapDocument,
  OffsetRange,
  ParseResult,
  ReadOnlyReason,
  TopicKind,
  TopicLink,
  TopicNode,
  UnmappedBlock,
} from '../model';
import { scanBlocks } from './blockScanner';
import { parseTitleParts } from './titleRange';

export interface ParseLimits {
  readonly maxBytes: number;
  readonly maxTopics: number;
  readonly largeMapWarningThreshold: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = {
  maxBytes: 2 * 1024 * 1024,
  maxTopics: 5_000,
  largeMapWarningThreshold: 3_000,
};

interface MutableNode {
  id: string;
  kind: TopicKind;
  parentId: string | null;
  childIds: string[];
  headingLevel: number | null;
  listMarker: string | null;
  indentColumns: number;
  /** CommonMark content column for list items (0 for other topics). */
  contentColumns: number;
  headerLine: number;
  titleRange: OffsetRange | null;
  titleRaw: string;
  displayTitle: string;
  links: readonly TopicLink[];
  noteLines: number[];
  noteClosed: boolean;
  unmappedBlocks: UnmappedBlock[];
  preservedPrefix: string;
  preservedBlockId: string | null;
  lastOwnedLine: number;
}

function detectLineEndings(rawText: string): {
  readonly lineEnding: LineEnding;
  readonly lfText: string;
  readonly mixed: boolean;
  readonly bareCr: boolean;
} {
  let crlfCount = 0;
  let lfCount = 0;
  let crCount = 0;

  for (let i = 0; i < rawText.length; i += 1) {
    const ch = rawText[i];
    if (ch === '\r') {
      if (rawText[i + 1] === '\n') {
        crlfCount += 1;
        i += 1;
      } else {
        crCount += 1;
      }
    } else if (ch === '\n') {
      lfCount += 1;
    }
  }

  const mixed = crlfCount > 0 && lfCount > 0;
  const bareCr = crCount > 0;
  const lineEnding: LineEnding = crlfCount > 0 && lfCount === 0 ? '\r\n' : '\n';
  const lfText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return { lineEnding, lfText, mixed, bareCr };
}

function splitLinesWithOffsets(lfText: string): {
  readonly lines: readonly string[];
  readonly lineStartOffsets: readonly number[];
} {
  if (lfText.length === 0) {
    return { lines: [], lineStartOffsets: [] };
  }
  const rawLines = lfText.split('\n');
  // Do not count trailing empty slot after a final newline.
  if (lfText.endsWith('\n') && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  const lineStartOffsets: number[] = [];
  let offset = 0;
  for (const line of rawLines) {
    lineStartOffsets.push(offset);
    offset += line.length + 1;
  }
  return { lines: rawLines, lineStartOffsets };
}

function addUniqueReason(reasons: ReadOnlyReason[], reason: ReadOnlyReason): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason);
  }
}

export function buildMindMapDocument(
  rawText: string,
  fallbackTitle: string,
  customLimits?: Partial<ParseLimits>,
): ParseResult {
  const limits: ParseLimits = { ...DEFAULT_PARSE_LIMITS, ...customLimits };

  // 1. Pre-parse file byte size guard (fail closed before scanning)
  const byteSize = utf8ByteLength(rawText);
  if (byteSize > limits.maxBytes) {
    return {
      status: 'blocked',
      reason: 'file-too-large',
      detail: `File size ${byteSize} bytes exceeds limit ${limits.maxBytes} bytes.`,
    };
  }

  const { lineEnding, lfText, mixed, bareCr } = detectLineEndings(rawText);
  const readOnlyReasons: ReadOnlyReason[] = [];
  if (mixed) addUniqueReason(readOnlyReasons, 'mixed-line-endings');
  if (bareCr) addUniqueReason(readOnlyReasons, 'bare-cr-line-endings');

  const { lines, lineStartOffsets } = splitLinesWithOffsets(lfText);
  const scan = scanBlocks(lines);

  if (scan.unclosedFrontmatter) {
    return {
      status: 'blocked',
      reason: 'unclosed-frontmatter',
      detail: 'Leading YAML frontmatter is missing a closing "---" delimiter.',
    };
  }
  if (scan.malformedFrontmatter) {
    addUniqueReason(readOnlyReasons, 'malformed-frontmatter');
  }

  const lineKinds: Array<LineKind | null> = new Array<LineKind | null>(lines.length).fill(null);

  // Determine whether the first H1 can cleanly serve as the central root.
  let firstH1ItemIndex = -1;
  let hasTopicBeforeFirstH1 = false;
  for (let idx = 0; idx < scan.items.length; idx += 1) {
    const item = scan.items[idx];
    if (!item) continue;
    if (item.kind === 'heading' && !item.insideListIndent && item.level === 1) {
      firstH1ItemIndex = idx;
      break;
    }
    if (item.kind === 'heading' || item.kind === 'list-item') {
      hasTopicBeforeFirstH1 = true;
    }
  }

  const useFirstH1AsRoot = firstH1ItemIndex !== -1 && !hasTopicBeforeFirstH1;
  const nodesMap = new Map<string, MutableNode>();
  let nextNodeSeq = 0;
  let topicCount = 0;

  const createNodeId = (): string => {
    const id = `n-${nextNodeSeq}`;
    nextNodeSeq += 1;
    return id;
  };

  let rootNode: MutableNode;
  if (useFirstH1AsRoot) {
    const h1Item = scan.items[firstH1ItemIndex];
    if (!h1Item || h1Item.kind !== 'heading') {
      throw new Error('Unexpected invariant violation: expected H1 item');
    }
    const lineText = lines[h1Item.line] ?? '';
    const lineOffset = lineStartOffsets[h1Item.line] ?? 0;
    const parts = parseTitleParts(lineText, lineOffset, h1Item.contentStartColumn, true);
    rootNode = {
      id: createNodeId(),
      kind: 'heading',
      parentId: null,
      childIds: [],
      headingLevel: 1,
      listMarker: null,
      indentColumns: 0,
      contentColumns: 0,
      headerLine: h1Item.line,
      titleRange: parts.titleRange,
      titleRaw: parts.titleRaw,
      displayTitle: parts.displayTitle.length > 0 ? parts.displayTitle : fallbackTitle,
      links: parts.links,
      noteLines: [],
      noteClosed: false,
      unmappedBlocks: [],
      preservedPrefix: parts.preservedPrefix,
      preservedBlockId: parts.preservedBlockId,
      lastOwnedLine: h1Item.line,
    };
    lineKinds[h1Item.line] = 'heading';
  } else {
    rootNode = {
      id: createNodeId(),
      kind: 'central-virtual',
      parentId: null,
      childIds: [],
      headingLevel: null,
      listMarker: null,
      indentColumns: 0,
      contentColumns: 0,
      headerLine: 0,
      titleRange: null,
      titleRaw: fallbackTitle,
      displayTitle: fallbackTitle,
      links: [],
      noteLines: [],
      noteClosed: false,
      unmappedBlocks: [],
      preservedPrefix: '',
      preservedBlockId: null,
      lastOwnedLine: 0,
    };
  }
  nodesMap.set(rootNode.id, rootNode);

  // Active hierarchy stacks
  const headingStack: MutableNode[] = [rootNode];
  const listStack: MutableNode[] = [];

  // Track indent characters inside the current contiguous list group
  let listGroupSawTabs = false;
  let listGroupSawSpaces = false;

  const resetListGroup = (): void => {
    listStack.length = 0;
    listGroupSawTabs = false;
    listGroupSawSpaces = false;
  };

  const currentOwner = (): MutableNode => {
    const topList = listStack[listStack.length - 1];
    if (topList) return topList;
    const topHeading = headingStack[headingStack.length - 1];
    return topHeading ?? rootNode;
  };

  const propagateLastOwnedLine = (node: MutableNode, lineEndInclusive: number): void => {
    let cursor: MutableNode | undefined = node;
    while (cursor) {
      if (lineEndInclusive > cursor.lastOwnedLine) {
        cursor.lastOwnedLine = lineEndInclusive;
      }
      cursor = cursor.parentId !== null ? nodesMap.get(cursor.parentId) : undefined;
    }
  };

  const pushUnmappedToOwner = (owner: MutableNode, block: UnmappedBlock): void => {
    if (block.kind !== 'frontmatter') {
      owner.noteClosed = true;
    }
    owner.unmappedBlocks.push(block);
    const kind: LineKind = block.kind === 'frontmatter' ? 'frontmatter' : 'unmapped';
    for (let ln = block.range.startLine; ln < block.range.endLine; ln += 1) {
      lineKinds[ln] = kind;
    }
    if (block.range.endLine > block.range.startLine) {
      propagateLastOwnedLine(owner, block.range.endLine - 1);
    }
  };

  let pendingTrailingParagraphStart: number | null = null;
  let pendingTrailingParagraphEnd = -1;
  let pendingTrailingOwner: MutableNode | null = null;

  const flushTrailingParagraph = (): void => {
    if (pendingTrailingParagraphStart !== null && pendingTrailingOwner !== null) {
      pushUnmappedToOwner(pendingTrailingOwner, {
        kind: 'trailing-paragraph',
        range: {
          startLine: pendingTrailingParagraphStart,
          endLine: pendingTrailingParagraphEnd,
        },
        indentSensitive: false,
      });
    }
    pendingTrailingParagraphStart = null;
    pendingTrailingParagraphEnd = -1;
    pendingTrailingOwner = null;
  };

  for (let idx = 0; idx < scan.items.length; idx += 1) {
    const item = scan.items[idx];
    if (!item) continue;

    if (useFirstH1AsRoot && idx === firstH1ItemIndex) {
      flushTrailingParagraph();
      // Reset noteClosed so paragraphs directly following the central H1 become its topic note.
      rootNode.noteClosed = false;
      continue;
    }

    if (item.kind === 'blank') {
      flushTrailingParagraph();
      lineKinds[item.line] = 'blank';
      continue;
    }

    if (item.kind === 'unmapped') {
      flushTrailingParagraph();
      if (item.unmappedKind !== 'frontmatter' && listStack.length > 0 && item.indentColumns === 0) {
        const prevLineKind = item.range.startLine > 0 ? lineKinds[item.range.startLine - 1] : null;
        if (prevLineKind === 'blank') {
          resetListGroup();
        }
      }
      const owner = item.unmappedKind === 'frontmatter' ? rootNode : currentOwner();
      pushUnmappedToOwner(owner, {
        kind: item.unmappedKind,
        range: item.range,
        indentSensitive: item.indentSensitive,
      });
      continue;
    }

    if (item.kind === 'heading') {
      flushTrailingParagraph();
      if (item.insideListIndent) {
        addUniqueReason(readOnlyReasons, 'heading-inside-list');
        const owner = currentOwner();
        pushUnmappedToOwner(owner, {
          kind: 'heading-in-list',
          range: { startLine: item.line, endLine: item.line + 1 },
          indentSensitive: true,
        });
        continue;
      }

      topicCount += 1;
      if (topicCount > limits.maxTopics) {
        return {
          status: 'blocked',
          reason: 'too-many-topics',
          detail: `Topic count exceeded the limit of ${limits.maxTopics}.`,
        };
      }

      resetListGroup();

      // Pop headings that are at the same or deeper level.
      // A second H1 attaches directly under rootNode as a main branch.
      while (headingStack.length > 1) {
        const top = headingStack[headingStack.length - 1];
        if (!top || top.headingLevel === null) break;
        if (item.level === 1 || top.headingLevel >= item.level) {
          headingStack.pop();
        } else {
          break;
        }
      }

      const parent = headingStack[headingStack.length - 1] ?? rootNode;
      parent.noteClosed = true;

      const lineText = lines[item.line] ?? '';
      const lineOffset = lineStartOffsets[item.line] ?? 0;
      const parts = parseTitleParts(lineText, lineOffset, item.contentStartColumn, true);

      const node: MutableNode = {
        id: createNodeId(),
        kind: 'heading',
        parentId: parent.id,
        childIds: [],
        headingLevel: item.level,
        listMarker: null,
        indentColumns: 0,
        contentColumns: 0,
        headerLine: item.line,
        titleRange: parts.titleRange,
        titleRaw: parts.titleRaw,
        displayTitle: parts.displayTitle,
        links: parts.links,
        noteLines: [],
        noteClosed: false,
        unmappedBlocks: [],
        preservedPrefix: parts.preservedPrefix,
        preservedBlockId: parts.preservedBlockId,
        lastOwnedLine: item.line,
      };
      parent.childIds.push(node.id);
      nodesMap.set(node.id, node);
      headingStack.push(node);
      lineKinds[item.line] = 'heading';
      propagateLastOwnedLine(node, item.line);
      continue;
    }

    if (item.kind === 'list-item') {
      flushTrailingParagraph();

      topicCount += 1;
      if (topicCount > limits.maxTopics) {
        return {
          status: 'blocked',
          reason: 'too-many-topics',
          detail: `Topic count exceeded the limit of ${limits.maxTopics}.`,
        };
      }

      if (item.indentRaw.includes('\t')) listGroupSawTabs = true;
      if (item.indentRaw.includes(' ')) listGroupSawSpaces = true;
      if (listGroupSawTabs && listGroupSawSpaces) {
        addUniqueReason(readOnlyReasons, 'mixed-list-indent');
      }

      while (listStack.length > 0) {
        const top = listStack[listStack.length - 1];
        if (!top) break;
        // CommonMark: a list item nests only when indented to the parent's content column.
        if (item.indentColumns < top.contentColumns) {
          listStack.pop();
        } else {
          break;
        }
      }

      const parent =
        listStack[listStack.length - 1] ??
        headingStack[headingStack.length - 1] ??
        rootNode;
      parent.noteClosed = true;

      const lineText = lines[item.line] ?? '';
      const lineOffset = lineStartOffsets[item.line] ?? 0;
      const parts = parseTitleParts(lineText, lineOffset, item.contentStartColumn, false);

      const node: MutableNode = {
        id: createNodeId(),
        kind: 'list-item',
        parentId: parent.id,
        childIds: [],
        headingLevel: null,
        listMarker: item.marker,
        indentColumns: item.indentColumns,
        contentColumns: item.contentColumns,
        headerLine: item.line,
        titleRange: parts.titleRange,
        titleRaw: parts.titleRaw,
        displayTitle: parts.displayTitle,
        links: parts.links,
        noteLines: [],
        noteClosed: false,
        unmappedBlocks: [],
        preservedPrefix: parts.preservedPrefix,
        preservedBlockId: parts.preservedBlockId,
        lastOwnedLine: item.line,
      };
      parent.childIds.push(node.id);
      nodesMap.set(node.id, node);
      listStack.push(node);
      lineKinds[item.line] = 'list-item';
      propagateLastOwnedLine(node, item.line);
      continue;
    }

    // Paragraph line: decide whether it belongs to the active topic's note or is trailing unmapped content.
    if (listStack.length > 0) {
      const prevLineKind = item.line > 0 ? lineKinds[item.line - 1] : null;
      if (prevLineKind === 'blank') {
        if (item.indentColumns === 0) {
          // Unindented paragraph after a blank line closes the active list.
          resetListGroup();
        } else {
          // Unwind list items whose content column is deeper than the paragraph's indentation
          // so a dedented paragraph attaches to its outer list item instead of a nested child.
          while (listStack.length > 0) {
            const top = listStack[listStack.length - 1];
            if (!top) break;
            if (item.indentColumns < top.contentColumns) {
              listStack.pop();
            } else {
              break;
            }
          }
          if (listStack.length === 0) {
            listGroupSawTabs = false;
            listGroupSawSpaces = false;
          }
        }
      }
    }

    const owner = currentOwner();
    if (!owner.noteClosed && !(useFirstH1AsRoot && idx < firstH1ItemIndex)) {
      flushTrailingParagraph();
      owner.noteLines.push(item.line);
      lineKinds[item.line] = 'topic-note';
      propagateLastOwnedLine(owner, item.line);
    } else {
      const trailingOwner = useFirstH1AsRoot && idx < firstH1ItemIndex ? rootNode : owner;
      if (
        pendingTrailingParagraphStart !== null &&
        pendingTrailingOwner === trailingOwner &&
        pendingTrailingParagraphEnd === item.line
      ) {
        pendingTrailingParagraphEnd = item.line + 1;
      } else {
        flushTrailingParagraph();
        pendingTrailingParagraphStart = item.line;
        pendingTrailingParagraphEnd = item.line + 1;
        pendingTrailingOwner = trailingOwner;
      }
    }
  }

  flushTrailingParagraph();

  // Verify total line classification invariant (every line classified, no gaps)
  const finalizedLineKinds: LineKind[] = [];
  for (let ln = 0; ln < lineKinds.length; ln += 1) {
    const kind = lineKinds[ln];
    if (kind === null || kind === undefined) {
      addUniqueReason(readOnlyReasons, 'unclassified-lines');
      finalizedLineKinds.push('unmapped');
    } else {
      finalizedLineKinds.push(kind);
    }
  }

  // Finalize immutable TopicNode map
  const finalizedNodes = new Map<string, TopicNode>();
  for (const [id, mutable] of nodesMap) {
    const noteRange: LineRange | null =
      mutable.noteLines.length > 0
        ? {
            startLine: mutable.noteLines[0] ?? 0,
            endLine: (mutable.noteLines[mutable.noteLines.length - 1] ?? 0) + 1,
          }
        : null;

    const noteText =
      noteRange !== null
        ? lines
            .slice(noteRange.startLine, noteRange.endLine)
            .map((line) =>
              mutable.kind === 'list-item' ? line.replace(/^[ \t]+/, '') : line,
            )
            .join('\n')
        : null;

    const subtreeRange: LineRange =
      id === rootNode.id
        ? { startLine: 0, endLine: lines.length }
        : {
            startLine: mutable.headerLine,
            endLine: Math.max(mutable.headerLine + 1, mutable.lastOwnedLine + 1),
          };

    const ownSlice = lines.slice(subtreeRange.startLine, subtreeRange.endLine).join('\n');

    finalizedNodes.set(id, {
      id: mutable.id,
      kind: mutable.kind,
      parentId: mutable.parentId,
      childIds: [...mutable.childIds],
      headingLevel: mutable.headingLevel,
      listMarker: mutable.listMarker,
      indentColumns: mutable.indentColumns,
      headerLine: mutable.headerLine,
      titleRange: mutable.titleRange,
      titleRaw: mutable.titleRaw,
      displayTitle: mutable.displayTitle,
      links: mutable.links,
      noteRange,
      noteText,
      subtreeRange,
      ownRangeHash: hashText(ownSlice),
      unmappedBlocks: [...mutable.unmappedBlocks],
      preservedPrefix: mutable.preservedPrefix,
      preservedBlockId: mutable.preservedBlockId,
    });
  }

  // Verify non-overlapping sibling ranges invariant
  for (const node of finalizedNodes.values()) {
    let prevEnd = -1;
    for (const childId of node.childIds) {
      const child = finalizedNodes.get(childId);
      if (!child) continue;
      if (child.subtreeRange.startLine < prevEnd) {
        addUniqueReason(readOnlyReasons, 'overlapping-ranges');
        break;
      }
      prevEnd = child.subtreeRange.endLine;
    }
  }

  const document: MindMapDocument = {
    contentHash: hashText(lfText),
    lineEnding,
    lineCount: lines.length,
    lineKinds: finalizedLineKinds,
    rootId: rootNode.id,
    nodes: finalizedNodes,
    topicCount,
    readOnlyReasons,
    largeMapWarning: topicCount > limits.largeMapWarningThreshold,
  };

  return {
    status: 'ok',
    document,
  };
}
