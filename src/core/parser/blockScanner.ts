import type { LineRange, UnmappedKind } from '../model';

export interface ScannedHeading {
  readonly kind: 'heading';
  readonly line: number;
  readonly level: number;
  readonly contentStartColumn: number;
  readonly insideListIndent: boolean;
}

export interface ScannedListItem {
  readonly kind: 'list-item';
  readonly line: number;
  readonly indentRaw: string;
  readonly indentColumns: number;
  readonly marker: string;
  readonly contentStartColumn: number;
  /** CommonMark content column (in tab-expanded columns); deeper lines at or beyond it nest. */
  readonly contentColumns: number;
}

export interface ScannedUnmappedBlock {
  readonly kind: 'unmapped';
  readonly unmappedKind: UnmappedKind;
  readonly range: LineRange;
  readonly indentColumns: number;
  readonly indentSensitive: boolean;
}

export interface ScannedParagraphLine {
  readonly kind: 'paragraph-line';
  readonly line: number;
  readonly indentColumns: number;
}

export interface ScannedBlankLine {
  readonly kind: 'blank';
  readonly line: number;
}

export type ScannedItem =
  | ScannedHeading
  | ScannedListItem
  | ScannedUnmappedBlock
  | ScannedParagraphLine
  | ScannedBlankLine;

export interface BlockScanResult {
  readonly items: readonly ScannedItem[];
  readonly unclosedFrontmatter: boolean;
  readonly malformedFrontmatter: boolean;
}

const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const ATX_HEADING_RE = /^([ \t]*)(#{1,6})(?:([ \t]+)(.*)|[ \t]*)$/;
const LIST_ITEM_RE = /^([ \t]*)([-*+]|(?:\d{1,9}[.)]))(?:([ \t]+)(.*)|[ \t]*)$/;
const THEMATIC_BREAK_RE = /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const CALLOUT_START_RE = /^[ \t]*>[ \t]*\[![^\]]+\]/;
const BLOCKQUOTE_RE = /^[ \t]*>/;
const FOOTNOTE_DEF_RE = /^[ \t]{0,3}\[\^[^\]]+\]:/;
const LINK_REF_DEF_RE = /^[ \t]{0,3}\[[^[\]^][^\]]*\]:[ \t]*\S+/;
const HTML_BLOCK_START_RE =
  /^[ \t]{0,3}<(?:!--|!DOCTYPE|\?|\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|style|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|>|\/|$))/i;
const TABLE_SEP_RE = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;
const TABLE_SINGLE_COL_SEP_RE = /^[ \t]*\|[ \t]*:?-{3,}:?[ \t]*\|[ \t]*$/;
const YAML_KEY_LINE_RE = /^[ \t]*[^:#\s][^:]*:[ \t]*(?:.*)?$/;
const YAML_LIST_LINE_RE = /^[ \t]*-[ \t]/;

export function countIndentColumns(indentRaw: string): number {
  let cols = 0;
  for (let i = 0; i < indentRaw.length; i += 1) {
    if (indentRaw[i] === '\t') {
      cols += 4 - (cols % 4);
    } else {
      cols += 1;
    }
  }
  return cols;
}

/**
 * Returns the CommonMark content column of a list item line in tab-expanded columns:
 * indent + marker width + the spaces after the marker (1 when the gap is empty or wider than 4).
 */
export function computeListContentColumns(indentRaw: string, marker: string, gapRaw: string): number {
  const markerEnd = countIndentColumns(indentRaw) + marker.length;
  let cols = markerEnd;
  for (const ch of gapRaw) {
    cols += ch === '\t' ? 4 - (cols % 4) : 1;
  }
  const gapCols = cols - markerEnd;
  return markerEnd + (gapCols === 0 || gapCols > 4 ? 1 : gapCols);
}

/** Returns the content column of a list item line, or null when the line is not a list item. */
export function listItemContentColumnsOfLine(line: string): number | null {
  const match = LIST_ITEM_RE.exec(line);
  if (!match || match[1] === undefined || match[2] === undefined) return null;
  return computeListContentColumns(match[1], match[2], match[3] ?? '');
}

function isBlank(line: string): boolean {
  return /^[ \t]*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return TABLE_SEP_RE.test(line) || TABLE_SINGLE_COL_SEP_RE.test(line);
}

function validateFrontmatterBody(bodyLines: readonly string[]): boolean {
  let inMultilineScalar = false;
  for (const line of bodyLines) {
    if (isBlank(line) || /^[ \t]*#/.test(line)) {
      continue;
    }
    if (line.startsWith('\t')) {
      return false;
    }
    if (inMultilineScalar) {
      if (line.startsWith(' ')) {
        continue;
      }
      inMultilineScalar = false;
    }
    if (YAML_KEY_LINE_RE.test(line)) {
      if (/[|>][-+]?[ \t]*$/.test(line)) {
        inMultilineScalar = true;
      }
      continue;
    }
    if (YAML_LIST_LINE_RE.test(line) || /^[ \t]+/.test(line)) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Classifies Markdown lines into block-level tokens while respecting CommonMark
 * fences/quotes/tables and Obsidian extensions (frontmatter, callouts, comments, math).
 */
export function scanBlocks(lines: readonly string[]): BlockScanResult {
  const items: ScannedItem[] = [];
  let i = 0;
  let malformedFrontmatter = false;

  // 1. Leading YAML frontmatter
  const firstLine = lines[0];
  if (firstLine !== undefined && /^---[ \t]*$/.test(firstLine)) {
    let closeIndex = -1;
    for (let j = 1; j < lines.length; j += 1) {
      const candidate = lines[j];
      if (candidate !== undefined && /^(?:---|\.\.\.)[ \t]*$/.test(candidate)) {
        closeIndex = j;
        break;
      }
    }
    if (closeIndex === -1) {
      return {
        items: [],
        unclosedFrontmatter: true,
        malformedFrontmatter: false,
      };
    }
    const bodyLines = lines.slice(1, closeIndex);
    if (!validateFrontmatterBody(bodyLines)) {
      malformedFrontmatter = true;
    }
    items.push({
      kind: 'unmapped',
      unmappedKind: 'frontmatter',
      range: { startLine: 0, endLine: closeIndex + 1 },
      indentColumns: 0,
      indentSensitive: true,
    });
    i = closeIndex + 1;
  }

  let insideListContext = false;
  let prevWasBlank = false;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;

    // 2. Blank line
    if (isBlank(line)) {
      items.push({ kind: 'blank', line: i });
      prevWasBlank = true;
      i += 1;
      continue;
    }

    const lineIndentCols = countIndentColumns(/^([ \t]*)/.exec(line)?.[1] ?? '');

    // 3. Fenced code block (``` or ~~~)
    const fenceMatch = FENCE_OPEN_RE.exec(line);
    if (fenceMatch && fenceMatch[2] !== undefined) {
      const fenceChars = fenceMatch[2];
      const fenceChar = fenceChars[0] ?? '`';
      const fenceLen = fenceChars.length;
      const infoString = fenceMatch[3] ?? '';
      // Backtick info strings cannot contain backticks per CommonMark.
      const validFence = fenceChar === '~' || !infoString.includes('`');
      if (validFence) {
        if (prevWasBlank && lineIndentCols === 0) {
          insideListContext = false;
        }
        const startLine = i;
        i += 1;
        const closeRe = new RegExp(`^[ \\t]*${fenceChar}{${fenceLen},}[ \\t]*$`);
        while (i < lines.length) {
          const nextLine = lines[i];
          i += 1;
          if (nextLine !== undefined && closeRe.test(nextLine)) {
            break;
          }
        }
        items.push({
          kind: 'unmapped',
          unmappedKind: 'fenced-code',
          range: { startLine, endLine: i },
          indentColumns: lineIndentCols,
          indentSensitive: true,
        });
        prevWasBlank = false;
        continue;
      }
    }

    // 4. Math block ($$)
    if (/^[ \t]*\$\$/.test(line)) {
      if (prevWasBlank && lineIndentCols === 0) {
        insideListContext = false;
      }
      const startLine = i;
      const trimmed = line.trim();
      if (trimmed.length >= 4 && trimmed.endsWith('$$')) {
        i += 1;
      } else {
        i += 1;
        while (i < lines.length) {
          const nextLine = lines[i];
          i += 1;
          if (nextLine !== undefined && /^[ \t]*\$\$[ \t]*$/.test(nextLine)) {
            break;
          }
        }
      }
      items.push({
        kind: 'unmapped',
        unmappedKind: 'math-block',
        range: { startLine, endLine: i },
        indentColumns: lineIndentCols,
        indentSensitive: true,
      });
      prevWasBlank = false;
      continue;
    }

    // 5. Obsidian comment block (%%)
    if (/^[ \t]*%%/.test(line)) {
      if (prevWasBlank && lineIndentCols === 0) {
        insideListContext = false;
      }
      const startLine = i;
      const trimmed = line.trim();
      if (trimmed.length >= 4 && trimmed.endsWith('%%')) {
        i += 1;
      } else {
        i += 1;
        while (i < lines.length) {
          const nextLine = lines[i];
          i += 1;
          if (nextLine !== undefined && nextLine.includes('%%')) {
            break;
          }
        }
      }
      items.push({
        kind: 'unmapped',
        unmappedKind: 'comment',
        range: { startLine, endLine: i },
        indentColumns: lineIndentCols,
        indentSensitive: false,
      });
      prevWasBlank = false;
      continue;
    }

    // 6. Blockquote / Callout
    if (BLOCKQUOTE_RE.test(line)) {
      if (prevWasBlank && lineIndentCols === 0) {
        insideListContext = false;
      }
      const startLine = i;
      const isCallout = CALLOUT_START_RE.test(line);
      i += 1;
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine === undefined || isBlank(nextLine) || !BLOCKQUOTE_RE.test(nextLine)) {
          break;
        }
        i += 1;
      }
      items.push({
        kind: 'unmapped',
        unmappedKind: isCallout ? 'callout' : 'blockquote',
        range: { startLine, endLine: i },
        indentColumns: lineIndentCols,
        indentSensitive: true,
      });
      prevWasBlank = false;
      continue;
    }

    // 7. GFM Table (header row + separator row)
    const nextCandidate = lines[i + 1];
    if (
      line.includes('|') &&
      nextCandidate !== undefined &&
      isTableSeparator(nextCandidate)
    ) {
      if (prevWasBlank && lineIndentCols === 0) {
        insideListContext = false;
      }
      const startLine = i;
      i += 2;
      while (i < lines.length) {
        const row = lines[i];
        if (row === undefined || isBlank(row) || !row.includes('|')) {
          break;
        }
        i += 1;
      }
      items.push({
        kind: 'unmapped',
        unmappedKind: 'table',
        range: { startLine, endLine: i },
        indentColumns: lineIndentCols,
        indentSensitive: true,
      });
      prevWasBlank = false;
      continue;
    }

    // 8. Thematic break (must be checked before list item for "- - -" or "***")
    if (THEMATIC_BREAK_RE.test(line)) {
      items.push({
        kind: 'unmapped',
        unmappedKind: 'thematic-break',
        range: { startLine: i, endLine: i + 1 },
        indentColumns: lineIndentCols,
        indentSensitive: false,
      });
      insideListContext = false;
      prevWasBlank = false;
      i += 1;
      continue;
    }

    // 9. Footnote definition / Link reference definition
    if (FOOTNOTE_DEF_RE.test(line)) {
      const startLine = i;
      i += 1;
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine === undefined || isBlank(nextLine) || !/^(?: {2,}|\t)/.test(nextLine)) {
          break;
        }
        i += 1;
      }
      items.push({
        kind: 'unmapped',
        unmappedKind: 'footnote-def',
        range: { startLine, endLine: i },
        indentColumns: lineIndentCols,
        indentSensitive: true,
      });
      insideListContext = false;
      prevWasBlank = false;
      continue;
    }

    if (LINK_REF_DEF_RE.test(line)) {
      items.push({
        kind: 'unmapped',
        unmappedKind: 'link-ref-def',
        range: { startLine: i, endLine: i + 1 },
        indentColumns: lineIndentCols,
        indentSensitive: false,
      });
      insideListContext = false;
      prevWasBlank = false;
      i += 1;
      continue;
    }

    // 10. HTML block
    if (HTML_BLOCK_START_RE.test(line)) {
      if (prevWasBlank && lineIndentCols === 0) {
        insideListContext = false;
      }
      const startLine = i;
      i += 1;
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine === undefined || isBlank(nextLine)) {
          break;
        }
        i += 1;
      }
      items.push({
        kind: 'unmapped',
        unmappedKind: 'html-block',
        range: { startLine, endLine: i },
        indentColumns: lineIndentCols,
        indentSensitive: true,
      });
      prevWasBlank = false;
      continue;
    }

    // 11. ATX Heading
    const headingMatch = ATX_HEADING_RE.exec(line);
    if (headingMatch && headingMatch[1] !== undefined && headingMatch[2] !== undefined) {
      const indentCols = countIndentColumns(headingMatch[1]);
      const insideList = insideListContext && indentCols >= 2;
      if (indentCols <= 3 && !insideList) {
        const prefixLen = headingMatch[1].length + headingMatch[2].length + (headingMatch[3]?.length ?? 0);
        items.push({
          kind: 'heading',
          line: i,
          level: headingMatch[2].length,
          contentStartColumn: prefixLen,
          insideListIndent: false,
        });
        insideListContext = false;
        prevWasBlank = false;
        i += 1;
        continue;
      }
      if (insideList) {
        items.push({
          kind: 'heading',
          line: i,
          level: headingMatch[2].length,
          contentStartColumn:
            headingMatch[1].length + headingMatch[2].length + (headingMatch[3]?.length ?? 0),
          insideListIndent: true,
        });
        prevWasBlank = false;
        i += 1;
        continue;
      }
    }

    // 12. List item (-, *, +, 1., 1))
    const listMatch = LIST_ITEM_RE.exec(line);
    if (listMatch && listMatch[1] !== undefined && listMatch[2] !== undefined) {
      const indentRaw = listMatch[1];
      const indentColumns = countIndentColumns(indentRaw);
      // Outside a list context, 4+ leading columns start an indented code block per CommonMark.
      if (!insideListContext && indentColumns >= 4) {
        const startLine = i;
        i += 1;
        while (i < lines.length) {
          const nextLine = lines[i];
          if (nextLine === undefined || isBlank(nextLine) || countIndentColumns(/^([ \t]*)/.exec(nextLine)?.[1] ?? '') < 4) {
            break;
          }
          i += 1;
        }
        items.push({
          kind: 'unmapped',
          unmappedKind: 'indented-code',
          range: { startLine, endLine: i },
          indentColumns,
          indentSensitive: true,
        });
        prevWasBlank = false;
        continue;
      }
      const marker = listMatch[2];
      const contentStartColumn = indentRaw.length + marker.length + (listMatch[3]?.length ?? 0);
      items.push({
        kind: 'list-item',
        line: i,
        indentRaw,
        indentColumns,
        marker,
        contentStartColumn,
        contentColumns: computeListContentColumns(indentRaw, marker, listMatch[3] ?? ''),
      });
      insideListContext = true;
      prevWasBlank = false;
      i += 1;
      continue;
    }

    // 13. Indented code block outside list context
    if (!insideListContext && lineIndentCols >= 4) {
      const startLine = i;
      i += 1;
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine === undefined || isBlank(nextLine)) {
          break;
        }
        const nextWs = /^([ \t]*)/.exec(nextLine)?.[1] ?? '';
        if (countIndentColumns(nextWs) < 4) {
          break;
        }
        i += 1;
      }
      items.push({
        kind: 'unmapped',
        unmappedKind: 'indented-code',
        range: { startLine, endLine: i },
        indentColumns: lineIndentCols,
        indentSensitive: true,
      });
      prevWasBlank = false;
      continue;
    }

    // 14. Plain paragraph line (classified as topic-note or trailing-paragraph in treeBuilder)
    if (prevWasBlank && lineIndentCols === 0) {
      insideListContext = false;
    }
    items.push({
      kind: 'paragraph-line',
      line: i,
      indentColumns: lineIndentCols,
    });
    prevWasBlank = false;
    i += 1;
  }

  return {
    items,
    unclosedFrontmatter: false,
    malformedFrontmatter,
  };
}
