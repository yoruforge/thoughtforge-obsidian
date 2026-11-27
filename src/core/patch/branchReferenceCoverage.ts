import type { MindMapDocument, TopicNode, UnmappedBlock, UnmappedKind } from '../model';
import {
  findCodeSpanEnd,
  maskObsidianCommentsInLine,
  maskObsidianInlineComments,
  parseMarkdownLinkOrImageAt,
  tokenizeInlineMarkdown,
} from '../parser/inlineMarkdown';

export interface CachedRefPosition {
  readonly startLine: number;
  readonly startCol: number;
  readonly endLine: number;
  readonly endCol: number;
}

export interface CachedReferenceItem {
  readonly original: string;
  readonly position: CachedRefPosition;
}

export interface CachedReferenceSnapshot {
  readonly links: readonly CachedReferenceItem[];
  readonly embeds: readonly CachedReferenceItem[];
  readonly footnotes: readonly CachedRefPosition[];
  readonly footnoteRefs: readonly CachedRefPosition[];
  readonly referenceLinks: readonly CachedRefPosition[];
}

export type BranchReferenceCoverageResult =
  | {
      readonly status: 'ok';
      readonly visibleLines: ReadonlyMap<number, string>;
    }
  | {
      readonly status: 'rejected';
      readonly code: 'metadata-updating' | 'unsafe-reference';
      readonly line: number;
      readonly detail: string;
    };

const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const FOOTNOTE_DEF_RE = /^[ \t]{0,3}\[\^[^\]]+\]:/;
const LINK_REF_DEF_RE = /^[ \t]{0,3}\[([^[\]^][^\]]*)\]:[ \t]*\S+/;
const CALLOUT_PREFIX_RE = /^[ \t]*\[![^\][\s]+\][+-]?(?=[ \t]|$)/;
const LIST_ITEM_PREFIX_RE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[^\]]\][ \t]+)?/;
const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_HTML_ATTR_SCHEME_RE = /^(?:https?|mailto|tel|data|blob|about):/i;

const INACTIVE_UNMAPPED_KINDS: ReadonlySet<UnmappedKind> = new Set([
  'frontmatter',
  'fenced-code',
  'indented-code',
  'math-block',
  'thematic-break',
]);

function normalizeRefLabel(raw: string): string {
  return raw.trim().replace(/[ \t\r\n]+/g, ' ').toLowerCase();
}

function isInternalTarget(rawTarget: string): boolean {
  const trimmed = rawTarget.trim();
  return trimmed.length > 0 && !EXTERNAL_SCHEME_RE.test(trimmed);
}

function isInternalMdImage(raw: string): boolean {
  const parsed = parseMarkdownLinkOrImageAt(raw, 0);
  if (!parsed || !parsed.isImage) return true;
  return isInternalTarget(parsed.rawTarget);
}

function advanceColumns(text: string, start: number, end: number, startCol: number): number {
  let cols = startCol;
  for (let i = start; i < end; i += 1) {
    if (text[i] === '\t') {
      cols += 4 - (cols % 4);
    } else {
      cols += 1;
    }
  }
  return cols;
}

interface ParsedBlockquoteLine {
  readonly prefixLen: number;
  readonly quoteDepth: number;
  readonly inner: string;
  readonly innerLeadingCols: number;
}

function parseBlockquotePrefix(
  text: string,
  maxMarkers = Number.POSITIVE_INFINITY,
): ParsedBlockquoteLine {
  let pos = 0;
  let col = 0;
  let quoteDepth = 0;
  let virtualSpaces = 0;

  while (quoteDepth < maxMarkers && pos < text.length) {
    let wsEnd = pos;
    let wsCol = col;
    while (wsEnd < text.length && (text[wsEnd] === ' ' || text[wsEnd] === '\t')) {
      wsCol += text[wsEnd] === '\t' ? 4 - (wsCol % 4) : 1;
      wsEnd += 1;
    }
    const indentFromPrev = virtualSpaces + (wsCol - col);
    if (indentFromPrev > 3 || text[wsEnd] !== '>') {
      break;
    }
    pos = wsEnd + 1;
    col = wsCol + 1;
    quoteDepth += 1;
    virtualSpaces = 0;

    if (pos < text.length) {
      if (text[pos] === ' ') {
        pos += 1;
        col += 1;
      } else if (text[pos] === '\t') {
        const tabWidth = 4 - (col % 4);
        pos += 1;
        col += tabWidth;
        virtualSpaces = tabWidth - 1;
      }
    }
  }

  const inner = text.slice(pos);
  let innerWsEnd = 0;
  while (innerWsEnd < inner.length && (inner[innerWsEnd] === ' ' || inner[innerWsEnd] === '\t')) {
    innerWsEnd += 1;
  }
  const innerLeadingCols = virtualSpaces + (advanceColumns(inner, 0, innerWsEnd, col) - col);

  return {
    prefixLen: pos,
    quoteDepth,
    inner,
    innerLeadingCols,
  };
}

function isFenceClose(
  inner: string,
  innerLeadingCols: number,
  fenceChar: string,
  fenceLen: number,
): boolean {
  if (innerLeadingCols > 3) return false;
  const trimmed = inner.trim();
  if (trimmed.length < fenceLen) return false;
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] !== fenceChar) return false;
  }
  return true;
}

function collectDefinedRefLabels(
  doc: MindMapDocument,
  lines: readonly string[],
): ReadonlySet<string> {
  const labels = new Set<string>();
  for (const node of doc.nodes.values()) {
    for (const block of node.unmappedBlocks) {
      if (block.kind !== 'link-ref-def') continue;
      for (let ln = block.range.startLine; ln < block.range.endLine; ln += 1) {
        const match = LINK_REF_DEF_RE.exec(lines[ln] ?? '');
        if (match && match[1] !== undefined) {
          labels.add(normalizeRefLabel(match[1]));
        }
      }
    }
  }
  return labels;
}

function findUnescapedFootnoteRefOffset(text: string): number | null {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      i += 1;
      continue;
    }
    if (ch === '[' && text[i + 1] === '^') {
      let j = i + 2;
      let valid = true;
      while (j < text.length && text[j] !== ']') {
        const innerCh = text[j] ?? '';
        if (
          innerCh === '[' ||
          innerCh === ' ' ||
          innerCh === '\t' ||
          innerCh === '\n' ||
          innerCh === '\r'
        ) {
          valid = false;
          break;
        }
        j += 1;
      }
      if (valid && j > i + 2 && text[j] === ']' && text[j + 1] !== ':') {
        return i;
      }
    }
  }
  return null;
}

function findDefinedReferenceBracketOffset(
  text: string,
  definedRefLabels: ReadonlySet<string>,
): number | null {
  if (definedRefLabels.size === 0) return null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      i += 1;
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      while (j < text.length) {
        const inner = text[j];
        if (inner === '\\' && j + 1 < text.length) {
          j += 2;
          continue;
        }
        if (inner === '[' || inner === ']') break;
        j += 1;
      }
      if (j > i + 1 && text[j] === ']') {
        const candidate = normalizeRefLabel(text.slice(i + 1, j));
        if (candidate.length > 0 && definedRefLabels.has(candidate)) {
          return i;
        }
        i = j;
      }
    }
  }
  return null;
}

function maskHtmlComments(blockLines: readonly string[]): readonly string[] {
  const result: string[] = [];
  let inHtmlComment = false;
  for (const line of blockLines) {
    let out = '';
    let i = 0;
    while (i < line.length) {
      if (inHtmlComment) {
        const closeIdx = line.indexOf('-->', i);
        if (closeIdx < 0) {
          out += ' '.repeat(line.length - i);
          i = line.length;
        } else {
          const end = closeIdx + 3;
          out += ' '.repeat(end - i);
          i = end;
          inHtmlComment = false;
        }
        continue;
      }
      if (line.startsWith('<!--', i)) {
        const closeIdx = line.indexOf('-->', i + 4);
        if (closeIdx >= 0) {
          const end = closeIdx + 3;
          out += ' '.repeat(end - i);
          i = end;
        } else {
          out += ' '.repeat(line.length - i);
          i = line.length;
          inHtmlComment = true;
        }
        continue;
      }
      out += line[i] ?? '';
      i += 1;
    }
    result.push(out);
  }
  return result;
}

interface HtmlTagScanResult {
  readonly closed: boolean;
  readonly tagEnd: number;
  readonly restartedAt: number;
  readonly unsafeAttrOffset: number | null;
}

function isHtmlSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isHtmlAttrStop(ch: string | undefined): boolean {
  return (
    ch === undefined ||
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '=' ||
    ch === '>' ||
    ch === '/' ||
    ch === '<' ||
    ch === '"' ||
    ch === "'"
  );
}

function scanHtmlTagAt(text: string, tagStart: number): HtmlTagScanResult {
  let j = tagStart + 2;
  while (j < text.length && /[a-zA-Z0-9:-]/.test(text[j] ?? '')) {
    j += 1;
  }
  const sep = text[j];
  if (sep === '>') {
    return { closed: true, tagEnd: j + 1, restartedAt: -1, unsafeAttrOffset: null };
  }
  if (sep === '/' && text[j + 1] === '>') {
    return { closed: true, tagEnd: j + 2, restartedAt: -1, unsafeAttrOffset: null };
  }
  if (sep !== undefined && sep !== '/' && !isHtmlSpace(sep)) {
    return { closed: false, tagEnd: j, restartedAt: -1, unsafeAttrOffset: null };
  }

  let unsafeAttrOffset: number | null = null;
  while (j < text.length) {
    while (j < text.length && isHtmlSpace(text[j])) {
      j += 1;
    }
    if (j >= text.length) break;
    const ch = text[j] ?? '';
    if (ch === '>') {
      return { closed: true, tagEnd: j + 1, restartedAt: -1, unsafeAttrOffset };
    }
    if (ch === '/') {
      if (text[j + 1] === '>') {
        return { closed: true, tagEnd: j + 2, restartedAt: -1, unsafeAttrOffset };
      }
      j += 1;
      continue;
    }
    if (ch === '<') {
      return { closed: false, tagEnd: -1, restartedAt: j, unsafeAttrOffset };
    }

    const attrNameStart = j;
    while (j < text.length && !isHtmlAttrStop(text[j])) {
      j += 1;
    }
    if (j === attrNameStart) {
      j += 1;
      continue;
    }
    const attrName = text.slice(attrNameStart, j).toLowerCase();
    while (j < text.length && isHtmlSpace(text[j])) {
      j += 1;
    }
    if (text[j] !== '=') {
      continue;
    }
    j += 1;
    while (j < text.length && isHtmlSpace(text[j])) {
      j += 1;
    }

    let rawVal = '';
    const valQuote = text[j];
    if (valQuote === '"' || valQuote === "'") {
      const valStart = j + 1;
      j += 1;
      while (j < text.length && text[j] !== valQuote) {
        j += 1;
      }
      rawVal = text.slice(valStart, j);
      const quoteClosed = j < text.length && text[j] === valQuote;
      if (quoteClosed) {
        j += 1;
      }
      if (attrName === 'href' || attrName === 'src') {
        const trimmed = rawVal.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('#') && !SAFE_HTML_ATTR_SCHEME_RE.test(trimmed)) {
          if (unsafeAttrOffset === null) unsafeAttrOffset = attrNameStart;
        }
      }
      if (!quoteClosed) {
        break;
      }
    } else {
      const valStart = j;
      while (j < text.length) {
        const c = text[j] ?? '';
        if (isHtmlSpace(c) || c === '>' || c === '<') {
          break;
        }
        j += 1;
      }
      rawVal = text.slice(valStart, j);
      if (attrName === 'href' || attrName === 'src') {
        const trimmed = rawVal.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('#') && !SAFE_HTML_ATTR_SCHEME_RE.test(trimmed)) {
          if (unsafeAttrOffset === null) unsafeAttrOffset = attrNameStart;
        }
      }
    }
  }

  return { closed: false, tagEnd: -1, restartedAt: -1, unsafeAttrOffset };
}

function scanHtmlTagsForUnsafeAttr(text: string, requireClosedTag: boolean): number | null {
  if (!text.includes('<') || !/(?:href|src)\s*=/i.test(text)) return null;
  let nextHtmlCommentClose = -2;
  const findNextHtmlCommentClose = (minIdx: number): number => {
    if (nextHtmlCommentClose === -1) return -1;
    if (nextHtmlCommentClose < minIdx) {
      nextHtmlCommentClose = text.indexOf('-->', minIdx);
    }
    return nextHtmlCommentClose;
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const closeIdx = findNextHtmlCommentClose(i + 4);
      if (closeIdx >= 0) {
        i = closeIdx + 3;
        continue;
      }
      i += 1;
      continue;
    }
    if (text[i] === '<' && i + 1 < text.length && /[a-zA-Z]/.test(text[i + 1] ?? '')) {
      const scan = scanHtmlTagAt(text, i);
      if (scan.unsafeAttrOffset !== null && (!requireClosedTag || scan.closed)) {
        return scan.unsafeAttrOffset;
      }
      if (scan.tagEnd >= 0) {
        i = scan.tagEnd;
        continue;
      }
      if (scan.restartedAt >= 0) {
        i = scan.restartedAt;
        continue;
      }
      break;
    }
    i += 1;
  }
  return null;
}

function findUnsafeHtmlAttrOffset(text: string): number | null {
  return scanHtmlTagsForUnsafeAttr(text, false);
}

function findUnsafeInlineHtmlAttrOffset(text: string): number | null {
  return scanHtmlTagsForUnsafeAttr(text, true);
}

function findUnclosedHtmlTagStart(text: string): number | null {
  if (!text.includes('<')) return null;
  let nextHtmlCommentClose = -2;
  const findNextHtmlCommentClose = (minIdx: number): number => {
    if (nextHtmlCommentClose === -1) return -1;
    if (nextHtmlCommentClose < minIdx) {
      nextHtmlCommentClose = text.indexOf('-->', minIdx);
    }
    return nextHtmlCommentClose;
  };

  let i = 0;
  while (i < text.length) {
    if (text.startsWith('<!--', i)) {
      const closeIdx = findNextHtmlCommentClose(i + 4);
      if (closeIdx >= 0) {
        i = closeIdx + 3;
        continue;
      }
      i += 1;
      continue;
    }
    if (text[i] === '<' && i + 1 < text.length && /[a-zA-Z]/.test(text[i + 1] ?? '')) {
      const scan = scanHtmlTagAt(text, i);
      if (scan.tagEnd >= 0) {
        i = scan.tagEnd;
        continue;
      }
      if (scan.restartedAt >= 0) {
        i = scan.restartedAt;
        continue;
      }
      return i;
    }
    i += 1;
  }
  return null;
}

function lineOffsetAtIndex(text: string, index: number): number {
  let lineOffset = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') lineOffset += 1;
  }
  return lineOffset;
}

function findUnsafeHtmlBlockRefLineOffset(blockText: string): number | null {
  if (blockText.trim().length === 0) return null;
  let offset = 0;
  for (const token of tokenizeInlineMarkdown(blockText)) {
    const spelling = token.kind === 'plain' ? token.text : token.raw;
    if (
      token.kind === 'wikilink' ||
      token.kind === 'wikiembed' ||
      (token.kind === 'mdlink' && isInternalTarget(token.rawTarget)) ||
      (token.kind === 'mdimage' && isInternalMdImage(token.raw))
    ) {
      return lineOffsetAtIndex(blockText, offset);
    }
    if (token.kind === 'mdlink' && token.raw.startsWith('[')) {
      const parsedLink = parseMarkdownLinkOrImageAt(token.raw, 0);
      if (parsedLink && !parsedLink.isImage && parsedLink.label.length > 0) {
        let innerOffset = 0;
        for (const innerToken of tokenizeInlineMarkdown(parsedLink.label)) {
          const innerSpelling = innerToken.kind === 'plain' ? innerToken.text : innerToken.raw;
          if (
            innerToken.kind === 'wikiembed' ||
            (innerToken.kind === 'mdimage' && isInternalMdImage(innerToken.raw))
          ) {
            return lineOffsetAtIndex(blockText, offset + 1 + innerOffset);
          }
          innerOffset += innerSpelling.length;
        }
      }
    }
    offset += spelling.length;
  }
  const attrOffset = findUnsafeHtmlAttrOffset(blockText);
  if (attrOffset !== null) {
    return lineOffsetAtIndex(blockText, attrOffset);
  }
  return null;
}

interface BlockquoteStepLineResult {
  readonly line: number;
  readonly prefixLen: number;
  readonly quoteDepth: number;
  readonly maskedInner: string;
  readonly active: boolean;
  readonly wasInComment: boolean;
}

function processBlockquoteOrCalloutBlock(
  lines: readonly string[],
  startLine: number,
  endLine: number,
  initialInComment: boolean,
  onLine?: (step: BlockquoteStepLineResult) => BranchReferenceCoverageResult | null,
): { readonly inComment: boolean; readonly failure: BranchReferenceCoverageResult | null } {
  let inComment = initialInComment;
  let innerFence: { readonly char: string; readonly len: number; readonly depth: number } | null =
    null;
  let innerMath: { readonly depth: number } | null = null;

  for (let ln = startLine; ln < endLine; ln += 1) {
    const text = lines[ln] ?? '';
    const parsed = parseBlockquotePrefix(text);

    if (innerFence !== null && parsed.quoteDepth < innerFence.depth) {
      innerFence = null;
    }
    if (innerMath !== null && parsed.quoteDepth < innerMath.depth) {
      innerMath = null;
    }

    if (innerFence !== null) {
      const fenceParsed =
        parsed.quoteDepth === innerFence.depth
          ? parsed
          : parseBlockquotePrefix(text, innerFence.depth);
      if (
        isFenceClose(
          fenceParsed.inner,
          fenceParsed.innerLeadingCols,
          innerFence.char,
          innerFence.len,
        )
      ) {
        innerFence = null;
      }
      if (onLine) {
        const failure = onLine({
          line: ln,
          prefixLen: parsed.prefixLen,
          quoteDepth: parsed.quoteDepth,
          maskedInner: ' '.repeat(parsed.inner.length),
          active: false,
          wasInComment: inComment,
        });
        if (failure) return { inComment, failure };
      }
      continue;
    }

    const wasInComment = inComment;
    const inner = parsed.inner;
    let out = '';
    let scanStart = 0;

    if (innerMath !== null) {
      if (parsed.quoteDepth === innerMath.depth) {
        const closeIdx = inner.indexOf('$$');
        if (closeIdx < 0) {
          out = ' '.repeat(inner.length);
          scanStart = inner.length;
        } else {
          const mathEnd = closeIdx + 2;
          out = ' '.repeat(mathEnd);
          scanStart = mathEnd;
          innerMath = null;
        }
      } else {
        out = ' '.repeat(inner.length);
        scanStart = inner.length;
      }
    } else if (!inComment && parsed.innerLeadingCols <= 3) {
      const fenceMatch = FENCE_OPEN_RE.exec(inner);
      if (fenceMatch && fenceMatch[2] !== undefined) {
        const fenceChars = fenceMatch[2];
        const fenceChar = fenceChars[0] ?? '`';
        const infoString = fenceMatch[3] ?? '';
        if (fenceChar === '~' || !infoString.includes('`')) {
          innerFence = { char: fenceChar, len: fenceChars.length, depth: parsed.quoteDepth };
          if (onLine) {
            const failure = onLine({
              line: ln,
              prefixLen: parsed.prefixLen,
              quoteDepth: parsed.quoteDepth,
              maskedInner: ' '.repeat(inner.length),
              active: false,
              wasInComment,
            });
            if (failure) return { inComment, failure };
          }
          continue;
        }
      }
    }

    let i = scanStart;
    while (i < inner.length) {
      if (inComment) {
        const closeIdx = inner.indexOf('%%', i);
        if (closeIdx < 0) {
          out += ' '.repeat(inner.length - i);
          i = inner.length;
        } else {
          const commentEnd = closeIdx + 2;
          out += ' '.repeat(commentEnd - i);
          i = commentEnd;
          inComment = false;
        }
        continue;
      }
      const ch = inner[i] ?? '';
      if (ch === '\\' && i + 1 < inner.length) {
        out += inner.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (ch === '`') {
        const codeEnd = findCodeSpanEnd(inner, i);
        if (codeEnd !== null) {
          out += inner.slice(i, codeEnd);
          i = codeEnd;
        } else {
          while (i < inner.length && inner[i] === '`') {
            out += '`';
            i += 1;
          }
        }
        continue;
      }
      if (ch === '%' && inner[i + 1] === '%') {
        const closeIdx = inner.indexOf('%%', i + 2);
        if (closeIdx >= 0) {
          const commentEnd = closeIdx + 2;
          out += ' '.repeat(commentEnd - i);
          i = commentEnd;
        } else {
          out += ' '.repeat(inner.length - i);
          i = inner.length;
          inComment = true;
        }
        continue;
      }
      if (ch === '$' && inner[i + 1] === '$') {
        const closeIdx = inner.indexOf('$$', i + 2);
        if (closeIdx >= 0) {
          const mathEnd = closeIdx + 2;
          out += ' '.repeat(mathEnd - i);
          i = mathEnd;
        } else if (scanStart === 0 && /^[ \t]*$/.test(out)) {
          innerMath = { depth: parsed.quoteDepth };
          out += ' '.repeat(inner.length - i);
          i = inner.length;
        } else {
          out += '$$';
          i += 2;
        }
        continue;
      }
      out += ch;
      i += 1;
    }

    if (onLine) {
      const failure = onLine({
        line: ln,
        prefixLen: parsed.prefixLen,
        quoteDepth: parsed.quoteDepth,
        maskedInner: out,
        active: out.trim().length > 0,
        wasInComment,
      });
      if (failure) return { inComment, failure };
    }
  }

  return { inComment, failure: null };
}

function computeInitialCommentState(
  doc: MindMapDocument,
  lines: readonly string[],
  beforeLine: number,
): boolean {
  const blockByLine = new Map<number, UnmappedBlock>();
  for (const node of doc.nodes.values()) {
    for (const block of node.unmappedBlocks) {
      if (block.range.startLine >= beforeLine) continue;
      for (let ln = block.range.startLine; ln < Math.min(block.range.endLine, beforeLine); ln += 1) {
        blockByLine.set(ln, block);
      }
    }
  }
  let inComment = false;
  let ln = 0;
  while (ln < beforeLine) {
    if (doc.lineKinds[ln] === 'frontmatter') {
      ln += 1;
      continue;
    }
    const block = blockByLine.get(ln);
    if (block) {
      const blockEnd = Math.min(block.range.endLine, beforeLine);
      if (INACTIVE_UNMAPPED_KINDS.has(block.kind)) {
        ln = blockEnd;
        continue;
      }
      if (block.kind === 'html-block') {
        const maskedHtml = maskHtmlComments(lines.slice(ln, blockEnd));
        for (const htmlLine of maskedHtml) {
          inComment = maskObsidianCommentsInLine(htmlLine, inComment).inComment;
        }
        ln = blockEnd;
        continue;
      }
      if (block.kind === 'blockquote' || block.kind === 'callout') {
        inComment = processBlockquoteOrCalloutBlock(lines, ln, blockEnd, inComment).inComment;
        ln = blockEnd;
        continue;
      }
    }
    inComment = maskObsidianCommentsInLine(lines[ln] ?? '', inComment).inComment;
    ln += 1;
  }
  return inComment;
}

interface ActiveRunSegment {
  readonly line: number;
  readonly baseCol: number;
  readonly text: string;
  readonly skipPrefixCols: number;
}

function sliceMultilineOriginal(
  lines: readonly string[],
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
): string {
  const parts: string[] = [];
  for (let ln = startLine; ln <= endLine; ln += 1) {
    const lineText = lines[ln] ?? '';
    const sliceStart = ln === startLine ? startCol : 0;
    const sliceEnd = ln === endLine ? endCol : lineText.length;
    parts.push(lineText.slice(sliceStart, sliceEnd));
  }
  return parts.join('\n');
}

function verifyReferenceAtSpan(
  lines: readonly string[],
  cachedPositions: ReadonlyMap<string, CachedReferenceItem>,
  startLine: number,
  startCol: number,
  endLine: number,
  endCol: number,
  spelling: string,
  detailPrefix: string,
): BranchReferenceCoverageResult | null {
  const cached = cachedPositions.get(startLine + ':' + startCol);
  if (startLine === endLine) {
    if (
      cached === undefined ||
      cached.position.endLine !== startLine ||
      cached.position.endCol !== endCol ||
      maskObsidianInlineComments(cached.original) !== spelling
    ) {
      return {
        status: 'rejected',
        code: 'metadata-updating',
        line: startLine,
        detail: `${detailPrefix} at ${startLine}:${startCol}.`,
      };
    }
    return null;
  }
  const actualRaw = sliceMultilineOriginal(lines, startLine, startCol, endLine, endCol);
  if (
    cached === undefined ||
    cached.position.endLine !== endLine ||
    cached.position.endCol !== endCol ||
    cached.original.replace(/\r\n/g, '\n') !== actualRaw
  ) {
    return {
      status: 'rejected',
      code: 'metadata-updating',
      line: startLine,
      detail: `${detailPrefix} at ${startLine}:${startCol}.`,
    };
  }
  return {
    status: 'rejected',
    code: 'unsafe-reference',
    line: startLine,
    detail: `Multiline internal reference spanning lines ${startLine}-${endLine} cannot be safely rewritten.`,
  };
}

function verifyActiveRun(
  segments: readonly ActiveRunSegment[],
  lines: readonly string[],
  cachedPositions: ReadonlyMap<string, CachedReferenceItem>,
  definedRefLabels: ReadonlySet<string>,
): BranchReferenceCoverageResult | null {
  if (segments.length === 0) return null;

  const segmentStarts: number[] = [];
  let joinedText: string;
  if (segments.length === 1) {
    joinedText = segments[0]!.text;
    segmentStarts.push(0);
  } else {
    const parts: string[] = [];
    let cursor = 0;
    for (let s = 0; s < segments.length; s += 1) {
      const seg = segments[s]!;
      segmentStarts.push(cursor);
      parts.push(seg.text);
      cursor += seg.text.length + 1;
    }
    joinedText = parts.join('\n');
  }

  let curSegIdx = 0;
  const locateStartFrom = (startHint: number, offset: number): { readonly segIdx: number; readonly line: number; readonly col: number } => {
    let idx = startHint;
    while (idx + 1 < segments.length && offset >= segmentStarts[idx + 1]!) {
      idx += 1;
    }
    const seg = segments[idx]!;
    return {
      segIdx: idx,
      line: seg.line,
      col: seg.baseCol + (offset - segmentStarts[idx]!),
    };
  };
  const locateEndFrom = (startHint: number, endOffset: number): { readonly line: number; readonly col: number } => {
    const target = Math.max(0, endOffset - 1);
    let idx = startHint;
    while (idx + 1 < segments.length && target >= segmentStarts[idx + 1]!) {
      idx += 1;
    }
    const seg = segments[idx]!;
    return {
      line: seg.line,
      col: seg.baseCol + (endOffset - segmentStarts[idx]!),
    };
  };

  const tokens = tokenizeInlineMarkdown(joinedText);
  const htmlMaskedParts: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'code') {
      htmlMaskedParts.push(token.raw.replace(/[^\n]/g, ' '));
    } else {
      htmlMaskedParts.push(token.kind === 'plain' ? token.text : token.raw);
    }
  }
  let htmlScanText = htmlMaskedParts.join('');
  if (segments.some((seg) => seg.skipPrefixCols > 0)) {
    const segMasked: string[] = [];
    for (let s = 0; s < segments.length; s += 1) {
      const seg = segments[s]!;
      const segStart = segmentStarts[s]!;
      const slice = htmlScanText.slice(segStart, segStart + seg.text.length);
      if (seg.skipPrefixCols > 0) {
        const skip = Math.min(seg.skipPrefixCols, slice.length);
        segMasked.push(' '.repeat(skip) + slice.slice(skip));
      } else {
        segMasked.push(slice);
      }
    }
    htmlScanText = segMasked.join('\n');
  }
  const inlineHtmlOffset = findUnsafeInlineHtmlAttrOffset(htmlScanText);
  if (inlineHtmlOffset !== null) {
    const htmlLine = locateStartFrom(0, inlineHtmlOffset).line;
    return {
      status: 'rejected',
      code: 'unsafe-reference',
      line: htmlLine,
      detail: `Inline HTML tag on line ${htmlLine} contains a relative resource reference.`,
    };
  }

  let offset = 0;
  for (const token of tokens) {
    const spelling = token.kind === 'plain' ? token.text : token.raw;
    const startLoc = locateStartFrom(curSegIdx, offset);
    curSegIdx = startLoc.segIdx;

    if (token.kind === 'plain') {
      const tokenEnd = offset + spelling.length;
      const checkPieces: { readonly line: number; readonly text: string }[] = [];
      let pSeg = curSegIdx;
      while (pSeg < segments.length && segmentStarts[pSeg]! < tokenEnd) {
        const seg = segments[pSeg]!;
        const segStart = segmentStarts[pSeg]!;
        const segEnd = segStart + seg.text.length;
        const ovStart = Math.max(offset, segStart);
        const ovEnd = Math.min(tokenEnd, segEnd);
        const adjStart = Math.max(ovStart, segStart + seg.skipPrefixCols);
        if (adjStart < ovEnd) {
          checkPieces.push({ line: seg.line, text: joinedText.slice(adjStart, ovEnd) });
        }
        pSeg += 1;
      }

      if (checkPieces.length > 0) {
        const checkText =
          checkPieces.length === 1
            ? checkPieces[0]!.text
            : checkPieces.map((p) => p.text).join('\n');
        const pieceLineAt = (checkOffset: number): number => {
          if (checkPieces.length === 1) return checkPieces[0]!.line;
          let acc = 0;
          for (const piece of checkPieces) {
            const nextAcc = acc + piece.text.length;
            if (checkOffset <= nextAcc) return piece.line;
            acc = nextAcc + 1;
          }
          return checkPieces[checkPieces.length - 1]!.line;
        };

        const footnoteOffset = findUnescapedFootnoteRefOffset(checkText);
        if (footnoteOffset !== null) {
          const fnLine = pieceLineAt(footnoteOffset);
          return {
            status: 'rejected',
            code: 'unsafe-reference',
            line: fnLine,
            detail: `Footnote reference found on line ${fnLine}.`,
          };
        }
        const refBracketOffset = findDefinedReferenceBracketOffset(checkText, definedRefLabels);
        if (refBracketOffset !== null) {
          const refLine = pieceLineAt(refBracketOffset);
          return {
            status: 'rejected',
            code: 'unsafe-reference',
            line: refLine,
            detail: `Reference-style link found on line ${refLine}.`,
          };
        }
      }

      offset += spelling.length;
      continue;
    }

    const endLoc = locateEndFrom(curSegIdx, offset + spelling.length);
    const internal =
      token.kind === 'wikilink' ||
      token.kind === 'wikiembed' ||
      (token.kind === 'mdlink' && isInternalTarget(token.rawTarget)) ||
      (token.kind === 'mdimage' && isInternalMdImage(token.raw));

    if (internal) {
      const failure = verifyReferenceAtSpan(
        lines,
        cachedPositions,
        startLoc.line,
        startLoc.col,
        endLoc.line,
        endLoc.col,
        spelling,
        'Missing or stale metadata cache entry',
      );
      if (failure) return failure;
    }

    // Verify nested internal embeds/images inside a Markdown link label (e.g. `[![alt](pic.png)](url)`).
    if (token.kind === 'mdlink' && token.raw.startsWith('[')) {
      const parsedLink = parseMarkdownLinkOrImageAt(token.raw, 0);
      if (parsedLink && !parsedLink.isImage && parsedLink.label.length > 0) {
        const labelBaseOffset = offset + 1;
        let innerOffset = 0;
        let innerSegHint = curSegIdx;
        for (const innerToken of tokenizeInlineMarkdown(parsedLink.label)) {
          const innerSpelling = innerToken.kind === 'plain' ? innerToken.text : innerToken.raw;
          const innerStart = locateStartFrom(innerSegHint, labelBaseOffset + innerOffset);
          innerSegHint = innerStart.segIdx;
          const innerInternal =
            innerToken.kind === 'wikiembed' ||
            (innerToken.kind === 'mdimage' && isInternalMdImage(innerToken.raw));
          if (innerInternal) {
            const innerEnd = locateEndFrom(
              innerSegHint,
              labelBaseOffset + innerOffset + innerSpelling.length,
            );
            const innerFailure = verifyReferenceAtSpan(
              lines,
              cachedPositions,
              innerStart.line,
              innerStart.col,
              innerEnd.line,
              innerEnd.col,
              innerSpelling,
              'Missing or stale nested image metadata cache entry',
            );
            if (innerFailure) return innerFailure;
          }
          innerOffset += innerSpelling.length;
        }
      }
    }

    offset += spelling.length;
  }

  return null;
}

/**
 * Pure Core verifier that checks Obsidian metadata cache coverage for every active line
 * inside an extracted branch, including protected blocks (`blockquote`, `callout`, `table`,
 * `trailing-paragraph`), while safely ignoring inactive code/math/comment regions and
 * rejecting unmovable footnote/reference-link/HTML-relative references even when the cache is stale.
 */
export function verifyBranchReferenceCoverage(
  doc: MindMapDocument,
  target: TopicNode,
  lines: readonly string[],
  snapshot: CachedReferenceSnapshot,
): BranchReferenceCoverageResult {
  const startLine = target.headerLine;
  const endLine = target.subtreeRange.endLine;
  const inBranch = (line: number): boolean => line >= startLine && line < endLine;

  for (const pos of [...snapshot.footnoteRefs, ...snapshot.footnotes, ...snapshot.referenceLinks]) {
    if (inBranch(pos.startLine)) {
      return {
        status: 'rejected',
        code: 'unsafe-reference',
        line: pos.startLine,
        detail: `Cached footnote or reference link on line ${pos.startLine}.`,
      };
    }
  }

  const unmappedBlockByLine = new Map<number, UnmappedBlock>();
  for (const node of doc.nodes.values()) {
    if (node.id === doc.rootId || !inBranch(node.headerLine)) continue;
    for (const block of node.unmappedBlocks) {
      if (block.kind === 'footnote-def' || block.kind === 'link-ref-def') {
        return {
          status: 'rejected',
          code: 'unsafe-reference',
          line: block.range.startLine,
          detail: `Protected ${block.kind} block on line ${block.range.startLine}.`,
        };
      }
      for (let ln = block.range.startLine; ln < block.range.endLine; ln += 1) {
        unmappedBlockByLine.set(ln, block);
      }
    }
  }

  const cachedPositions = new Map<string, CachedReferenceItem>();
  for (const ref of [...snapshot.links, ...snapshot.embeds]) {
    cachedPositions.set(ref.position.startLine + ':' + ref.position.startCol, ref);
  }

  const definedRefLabels = collectDefinedRefLabels(doc, lines);
  const visibleLines = new Map<number, string>();
  let inComment = computeInitialCommentState(doc, lines, startLine);

  const topRun: ActiveRunSegment[] = [];
  const flushTopRun = (): BranchReferenceCoverageResult | null => {
    if (topRun.length === 0) return null;
    const failure = verifyActiveRun(topRun, lines, cachedPositions, definedRefLabels);
    topRun.length = 0;
    return failure;
  };

  let lineNum = startLine;
  while (lineNum < endLine) {
    const rawLine = lines[lineNum] ?? '';
    const lineKind = doc.lineKinds[lineNum];

    if (lineKind === 'blank') {
      const failure = flushTopRun();
      if (failure) return failure;
      visibleLines.set(lineNum, inComment ? ' '.repeat(rawLine.length) : rawLine);
      lineNum += 1;
      continue;
    }

    if (lineKind === 'heading') {
      const preFailure = flushTopRun();
      if (preFailure) return preFailure;
      const maskedRes = maskObsidianCommentsInLine(rawLine, inComment);
      inComment = maskedRes.inComment;
      visibleLines.set(lineNum, maskedRes.masked);
      const failure = verifyActiveRun(
        [{ line: lineNum, baseCol: 0, text: maskedRes.masked, skipPrefixCols: 0 }],
        lines,
        cachedPositions,
        definedRefLabels,
      );
      if (failure) return failure;
      lineNum += 1;
      continue;
    }

    if (lineKind === 'list-item' || lineKind === 'topic-note') {
      if (lineKind === 'list-item') {
        const preFailure = flushTopRun();
        if (preFailure) return preFailure;
      }
      const maskedRes = maskObsidianCommentsInLine(rawLine, inComment);
      inComment = maskedRes.inComment;
      visibleLines.set(lineNum, maskedRes.masked);
      if (maskedRes.masked.trim().length > 0) {
        let skipPrefixCols = 0;
        if (lineKind === 'list-item') {
          const listMatch = LIST_ITEM_PREFIX_RE.exec(maskedRes.masked);
          if (listMatch) skipPrefixCols = listMatch[0].length;
        }
        topRun.push({
          line: lineNum,
          baseCol: 0,
          text: maskedRes.masked,
          skipPrefixCols,
        });
      } else {
        const failure = flushTopRun();
        if (failure) return failure;
      }
      lineNum += 1;
      continue;
    }

    const block = unmappedBlockByLine.get(lineNum);
    if (!block) {
      const preFailure = flushTopRun();
      if (preFailure) return preFailure;
      return {
        status: 'rejected',
        code: 'unsafe-reference',
        line: lineNum,
        detail: `Unclassified unmapped line ${lineNum} inside branch.`,
      };
    }

    const blockEnd = Math.min(block.range.endLine, endLine);

    if (block.kind === 'frontmatter' || block.kind === 'heading-in-list') {
      const preFailure = flushTopRun();
      if (preFailure) return preFailure;
      return {
        status: 'rejected',
        code: 'unsafe-reference',
        line: lineNum,
        detail: `Unexpected ${block.kind} block on line ${lineNum}.`,
      };
    }

    if (INACTIVE_UNMAPPED_KINDS.has(block.kind)) {
      const preFailure = flushTopRun();
      if (preFailure) return preFailure;
      for (let ln = lineNum; ln < blockEnd; ln += 1) {
        visibleLines.set(ln, ' '.repeat((lines[ln] ?? '').length));
      }
      lineNum = blockEnd;
      continue;
    }

    if (block.kind === 'comment') {
      for (let ln = lineNum; ln < blockEnd; ln += 1) {
        const text = lines[ln] ?? '';
        const maskedRes = maskObsidianCommentsInLine(text, inComment);
        inComment = maskedRes.inComment;
        visibleLines.set(ln, maskedRes.masked);
        if (maskedRes.masked.trim().length > 0) {
          topRun.push({ line: ln, baseCol: 0, text: maskedRes.masked, skipPrefixCols: 0 });
        } else {
          const failure = flushTopRun();
          if (failure) return failure;
        }
      }
      lineNum = blockEnd;
      continue;
    }

    if (block.kind === 'html-block') {
      const preFailure = flushTopRun();
      if (preFailure) return preFailure;
      const slice = lines.slice(lineNum, blockEnd);
      const maskedHtmlLines = maskHtmlComments(slice);
      const maskedCombinedLines: string[] = [];
      for (let offset = 0; offset < slice.length; offset += 1) {
        const ln = lineNum + offset;
        const maskedHtml = maskedHtmlLines[offset] ?? '';
        const commentRes = maskObsidianCommentsInLine(maskedHtml, inComment);
        inComment = commentRes.inComment;
        visibleLines.set(ln, commentRes.masked);
        maskedCombinedLines.push(commentRes.masked);
      }
      const maskedBlockText = maskedCombinedLines.join('\n');
      const unsafeLineOffset = findUnsafeHtmlBlockRefLineOffset(maskedBlockText);
      if (unsafeLineOffset !== null) {
        const unsafeLine = lineNum + unsafeLineOffset;
        return {
          status: 'rejected',
          code: 'unsafe-reference',
          line: unsafeLine,
          detail: `HTML block on line ${unsafeLine} contains an internal link or relative resource reference.`,
        };
      }
      const unclosedTagOffset = findUnclosedHtmlTagStart(maskedBlockText);
      if (unclosedTagOffset !== null) {
        const startLocOffset = lineOffsetAtIndex(maskedBlockText, unclosedTagOffset);
        let lineStartInBlock = 0;
        for (let k = 0; k < startLocOffset; k += 1) {
          lineStartInBlock += (maskedCombinedLines[k] ?? '').length + 1;
        }
        const firstLineSkipCols = unclosedTagOffset - lineStartInBlock;
        for (let offset = startLocOffset; offset < maskedCombinedLines.length; offset += 1) {
          const segText = maskedCombinedLines[offset] ?? '';
          topRun.push({
            line: lineNum + offset,
            baseCol: 0,
            text: segText,
            skipPrefixCols: offset === startLocOffset ? firstLineSkipCols : 0,
          });
        }
      }
      lineNum = blockEnd;
      continue;
    }

    if (block.kind === 'trailing-paragraph') {
      for (let ln = lineNum; ln < blockEnd; ln += 1) {
        const text = lines[ln] ?? '';
        const maskedRes = maskObsidianCommentsInLine(text, inComment);
        inComment = maskedRes.inComment;
        visibleLines.set(ln, maskedRes.masked);
        if (maskedRes.masked.trim().length > 0) {
          topRun.push({ line: ln, baseCol: 0, text: maskedRes.masked, skipPrefixCols: 0 });
        } else {
          const failure = flushTopRun();
          if (failure) return failure;
        }
      }
      lineNum = blockEnd;
      continue;
    }

    if (block.kind === 'table') {
      const preFailure = flushTopRun();
      if (preFailure) return preFailure;
      for (let ln = lineNum; ln < blockEnd; ln += 1) {
        const text = lines[ln] ?? '';
        const maskedRes = maskObsidianCommentsInLine(text, inComment);
        inComment = maskedRes.inComment;
        visibleLines.set(ln, maskedRes.masked);
        const failure = verifyActiveRun(
          [{ line: ln, baseCol: 0, text: maskedRes.masked, skipPrefixCols: 0 }],
          lines,
          cachedPositions,
          definedRefLabels,
        );
        if (failure) return failure;
      }
      lineNum = blockEnd;
      continue;
    }

    if (block.kind === 'blockquote' || block.kind === 'callout') {
      const preFailure = flushTopRun();
      if (preFailure) return preFailure;

      const quoteRun: ActiveRunSegment[] = [];
      let runQuoteDepth = -1;
      const flushQuoteRun = (): BranchReferenceCoverageResult | null => {
        if (quoteRun.length === 0) return null;
        const failure = verifyActiveRun(quoteRun, lines, cachedPositions, definedRefLabels);
        quoteRun.length = 0;
        runQuoteDepth = -1;
        return failure;
      };

      const stepped = processBlockquoteOrCalloutBlock(lines, lineNum, blockEnd, inComment, (step) => {
        visibleLines.set(step.line, ' '.repeat(step.prefixLen) + step.maskedInner);
        if (!step.active) {
          return flushQuoteRun();
        }

        const isCalloutHeader = block.kind === 'callout' && step.line === block.range.startLine;
        const defCheckTarget = isCalloutHeader
          ? step.maskedInner.replace(CALLOUT_PREFIX_RE, '')
          : step.maskedInner;
        if (
          !step.wasInComment &&
          (FOOTNOTE_DEF_RE.test(defCheckTarget) || LINK_REF_DEF_RE.test(defCheckTarget))
        ) {
          return {
            status: 'rejected',
            code: 'unsafe-reference',
            line: step.line,
            detail: `Nested footnote or link reference definition on line ${step.line}.`,
          };
        }

        if (isCalloutHeader) {
          const preHeaderFailure = flushQuoteRun();
          if (preHeaderFailure) return preHeaderFailure;
          const calloutMatch = CALLOUT_PREFIX_RE.exec(step.maskedInner);
          const skipPrefixCols = calloutMatch ? calloutMatch[0].length : 0;
          const afterMarker = step.maskedInner.slice(skipPrefixCols);
          if (afterMarker.trim().length > 0) {
            runQuoteDepth = step.quoteDepth;
            quoteRun.push({
              line: step.line,
              baseCol: step.prefixLen,
              text: ' '.repeat(skipPrefixCols) + afterMarker,
              skipPrefixCols,
            });
          }
          return null;
        }

        const listMatch = LIST_ITEM_PREFIX_RE.exec(step.maskedInner);
        if (listMatch) {
          const preListFailure = flushQuoteRun();
          if (preListFailure) return preListFailure;
          runQuoteDepth = step.quoteDepth;
          quoteRun.push({
            line: step.line,
            baseCol: step.prefixLen,
            text: step.maskedInner,
            skipPrefixCols: listMatch[0].length,
          });
          return null;
        }

        if (quoteRun.length > 0 && step.quoteDepth !== runQuoteDepth) {
          const depthChangeFailure = flushQuoteRun();
          if (depthChangeFailure) return depthChangeFailure;
        }
        runQuoteDepth = step.quoteDepth;
        quoteRun.push({
          line: step.line,
          baseCol: step.prefixLen,
          text: step.maskedInner,
          skipPrefixCols: 0,
        });
        return null;
      });

      inComment = stepped.inComment;
      if (stepped.failure) return stepped.failure;
      const postQuoteFailure = flushQuoteRun();
      if (postQuoteFailure) return postQuoteFailure;

      lineNum = blockEnd;
      continue;
    }

    const preUnhandledFailure = flushTopRun();
    if (preUnhandledFailure) return preUnhandledFailure;
    // Defensive fail-closed catch-all for any future UnmappedKind.
    return {
      status: 'rejected',
      code: 'unsafe-reference',
      line: lineNum,
      detail: `Unhandled unmapped block kind on line ${lineNum}.`,
    };
  }

  const tailFailure = flushTopRun();
  if (tailFailure) return tailFailure;

  return { status: 'ok', visibleLines };
}
