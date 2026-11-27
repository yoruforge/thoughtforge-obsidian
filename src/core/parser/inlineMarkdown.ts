export interface ParsedMarkdownInlineLink {
  readonly end: number;
  readonly isImage: boolean;
  readonly label: string;
  readonly rawTarget: string;
}

export type InlineMarkdownToken =
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'code'; readonly raw: string }
  | { readonly kind: 'wikiembed'; readonly raw: string }
  | { readonly kind: 'mdimage'; readonly raw: string }
  | { readonly kind: 'wikilink'; readonly raw: string; readonly target: string; readonly label: string }
  | { readonly kind: 'mdlink'; readonly raw: string; readonly rawTarget: string; readonly label: string }
  | { readonly kind: 'url'; readonly raw: string };

export interface CommentMaskLineResult {
  readonly masked: string;
  readonly inComment: boolean;
}

interface CodeSpanScanState {
  lastRunByLen: Map<number, number> | null;
}

function buildLastBacktickRunByLen(text: string): Map<number, number> {
  const map = new Map<number, number>();
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      let end = i + 1;
      while (end < text.length && text[end] === '`') {
        end += 1;
      }
      map.set(end - i, i);
      i = end;
      continue;
    }
    i += 1;
  }
  return map;
}

function findCodeSpanEndCached(
  text: string,
  start: number,
  state?: CodeSpanScanState,
): number | null {
  let tickEnd = start;
  while (tickEnd < text.length && text[tickEnd] === '`') {
    tickEnd += 1;
  }
  const tickCount = tickEnd - start;
  if (state !== undefined && state.lastRunByLen !== null) {
    const lastStart = state.lastRunByLen.get(tickCount);
    if (lastStart === undefined || lastStart <= start) {
      return null;
    }
  }
  let i = tickEnd;
  while (i < text.length) {
    if (text[i] === '`') {
      let runEnd = i;
      while (runEnd < text.length && text[runEnd] === '`') {
        runEnd += 1;
      }
      if (runEnd - i === tickCount) {
        return runEnd;
      }
      i = runEnd;
      continue;
    }
    i += 1;
  }
  if (state !== undefined && state.lastRunByLen === null) {
    state.lastRunByLen = buildLastBacktickRunByLen(text);
  }
  return null;
}

/**
 * Masks Obsidian comments (`%% ... %%`, including spans that continue across multiple lines)
 * outside code spans with equal-length spaces while preserving exact UTF-16 column offsets.
 */
export function maskObsidianCommentsInLine(
  line: string,
  inComment: boolean,
): CommentMaskLineResult {
  if (!inComment && !line.includes('%%')) {
    return { masked: line, inComment: false };
  }
  const codeSpanState: CodeSpanScanState = { lastRunByLen: null };
  let out = '';
  let i = 0;
  let open = inComment;
  while (i < line.length) {
    if (open) {
      const closeIdx = line.indexOf('%%', i);
      if (closeIdx < 0) {
        out += ' '.repeat(line.length - i);
        i = line.length;
      } else {
        const commentEnd = closeIdx + 2;
        out += ' '.repeat(commentEnd - i);
        i = commentEnd;
        open = false;
      }
      continue;
    }
    const ch = line[i] ?? '';
    if (ch === '\\' && i + 1 < line.length) {
      out += line.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = findCodeSpanEndCached(line, i, codeSpanState);
      if (end !== null) {
        out += line.slice(i, end);
        i = end;
      } else {
        while (i < line.length && line[i] === '`') {
          out += '`';
          i += 1;
        }
      }
      continue;
    }
    if (ch === '%' && line[i + 1] === '%') {
      const closeIdx = line.indexOf('%%', i + 2);
      if (closeIdx >= 0) {
        const commentEnd = closeIdx + 2;
        out += ' '.repeat(commentEnd - i);
        i = commentEnd;
      } else {
        out += ' '.repeat(line.length - i);
        i = line.length;
        open = true;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return { masked: out, inComment: open };
}

/**
 * Masks Obsidian inline comments (`%% ... %%`, or unclosed `%%` to EOL) outside code spans
 * with equal-length spaces so downstream inline tokenizers ignore commented-out links while
 * preserving exact UTF-16 column offsets.
 */
export function maskObsidianInlineComments(line: string): string {
  return maskObsidianCommentsInLine(line, false).masked;
}

/**
 * Finds the end index (exclusive) of a CommonMark inline code span starting at `start`
 * (where `text[start] === '`'`). Matches the exact closing run of `tickCount` backticks
 * per CommonMark §6.1 so multi-backtick spans containing shorter backtick runs
 * (e.g. `` ``code ` with ![[pic.png]]`` ``) are scanned accurately.
 */
export function findCodeSpanEnd(text: string, start: number): number | null {
  return findCodeSpanEndCached(text, start);
}

function skipOptionalLinkWhitespace(text: string, start: number): number {
  let i = start;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    i += 1;
  }
  if (text[i] === '\r' && text[i + 1] === '\n') {
    i += 2;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
      i += 1;
    }
  } else if (text[i] === '\n') {
    i += 1;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
      i += 1;
    }
  }
  return i;
}

const FAIL_BARE_DEST = 1;
const FAIL_ANGLE_DEST = 2;
const FAIL_DOUBLE_QUOTE = 4;
const FAIL_SINGLE_QUOTE = 8;

interface LinkScanMemo {
  failedFlags: Uint8Array | null;
  readonly scratchPos: number[];
  readonly scratchDepth: number[];
}

function createLinkScanMemo(): LinkScanMemo {
  return {
    failedFlags: null,
    scratchPos: [],
    scratchDepth: [],
  };
}

function ensureFailedFlags(memo: LinkScanMemo, length: number): Uint8Array {
  if (memo.failedFlags === null) {
    memo.failedFlags = new Uint8Array(length);
  }
  return memo.failedFlags;
}

function recordUnescapedFlag(
  text: string,
  start: number,
  end: number,
  memo: LinkScanMemo,
  flag: number,
): void {
  if (end <= start) return;
  const flags = ensureFailedFlags(memo, text.length);
  let k = start;
  while (k < end) {
    flags[k] = (flags[k] ?? 0) | flag;
    if (text[k] === '\\' && k + 1 < end) {
      k += 2;
      continue;
    }
    k += 1;
  }
}

function recordFailedBareDestPositions(
  text: string,
  destStart: number,
  stopIdx: number,
  endDepth: number,
  requireStrictlyLessThanEndDepth: boolean,
  memo: LinkScanMemo,
): void {
  if (stopIdx <= destStart) return;
  const flags = ensureFailedFlags(memo, text.length);
  const positions = memo.scratchPos;
  const depths = memo.scratchDepth;
  positions.length = 0;
  depths.length = 0;
  let depth = 0;
  let k = destStart;
  while (k < stopIdx) {
    positions.push(k);
    depths.push(depth);
    const ch = text[k];
    if (ch === '\\' && k + 1 < stopIdx) {
      k += 2;
      continue;
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
    }
    k += 1;
  }
  let suffixMin = endDepth;
  for (let idx = positions.length - 1; idx >= 0; idx -= 1) {
    const d = depths[idx] ?? 0;
    if (d < suffixMin) suffixMin = d;
    if (d <= suffixMin && (requireStrictlyLessThanEndDepth ? d < endDepth : d <= endDepth)) {
      const pos = positions[idx];
      if (pos !== undefined) flags[pos] = (flags[pos] ?? 0) | FAIL_BARE_DEST;
    }
  }
}

function finishAfterDestination(
  text: string,
  afterDestIdx: number,
  memo?: LinkScanMemo,
): number | null {
  // Skip optional whitespace (including at most one newline) and optional quoted title before closing ')'
  let i = skipOptionalLinkWhitespace(text, afterDestIdx);
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i];
    const quoteFlag = quote === '"' ? FAIL_DOUBLE_QUOTE : FAIL_SINGLE_QUOTE;
    const failedFlags = memo?.failedFlags ?? null;
    if (failedFlags !== null && ((failedFlags[i] ?? 0) & quoteFlag) !== 0) {
      return null;
    }
    const titleStart = i;
    i += 1;
    while (i < text.length && text[i] !== quote && text[i] !== '\n' && text[i] !== '\r') {
      if (failedFlags !== null && ((failedFlags[i] ?? 0) & quoteFlag) !== 0) {
        if (memo !== undefined) {
          recordUnescapedFlag(text, titleStart, i, memo, quoteFlag);
        }
        return null;
      }
      if (text[i] === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      i += 1;
    }
    if (text[i] !== quote) {
      if (memo !== undefined) {
        recordUnescapedFlag(text, titleStart, i, memo, quoteFlag);
      }
      return null;
    }
    i += 1;
    i = skipOptionalLinkWhitespace(text, i);
  }
  if (text[i] !== ')') {
    return null;
  }
  return i + 1;
}

function parseMarkdownLinkOrImageInternal(
  text: string,
  start: number,
  knownCloseBracketIdx?: number,
  memo?: LinkScanMemo,
): ParsedMarkdownInlineLink | null {
  let isImage = false;
  let bracketContentStart: number;

  if (text[start] === '!' && text[start + 1] === '[') {
    if (text[start + 2] === '[') {
      return null;
    }
    isImage = true;
    bracketContentStart = start + 2;
  } else if (text[start] === '[') {
    if (text[start + 1] === '[' || (start > 0 && text[start - 1] === '!')) {
      return null;
    }
    bracketContentStart = start + 1;
  } else {
    return null;
  }

  let i: number;
  let label: string;
  if (knownCloseBracketIdx !== undefined) {
    if (
      knownCloseBracketIdx < bracketContentStart ||
      text[knownCloseBracketIdx] !== ']' ||
      text[knownCloseBracketIdx + 1] !== '('
    ) {
      return null;
    }
    label = text.slice(bracketContentStart, knownCloseBracketIdx);
    i = knownCloseBracketIdx + 2;
  } else {
    i = bracketContentStart;
    let bracketDepth = 1;
    while (i < text.length && bracketDepth > 0) {
      const ch = text[i];
      if (ch === '`') {
        const end = findCodeSpanEnd(text, i);
        if (end !== null) {
          i = end;
        } else {
          while (text[i] === '`') i += 1;
        }
        continue;
      }
      if (ch === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (ch === '[') bracketDepth += 1;
      else if (ch === ']') bracketDepth -= 1;
      i += 1;
    }
    if (bracketDepth !== 0 || text[i] !== '(') {
      return null;
    }
    label = text.slice(bracketContentStart, i - 1);
    i += 1; // skip '('
  }

  i = skipOptionalLinkWhitespace(text, i);
  if (i >= text.length) {
    return null;
  }

  let rawTarget = '';
  let stoppedOnCloseParen = false;
  let destStart = i;
  const failedFlags = memo?.failedFlags ?? null;
  if (text[i] === '<') {
    // CommonMark angle-bracketed destination: allows spaces & parentheses until unescaped '>'
    i += 1;
    destStart = i;
    if (failedFlags !== null && ((failedFlags[destStart] ?? 0) & FAIL_ANGLE_DEST) !== 0) {
      return null;
    }
    while (i < text.length && text[i] !== '>' && text[i] !== '\n' && text[i] !== '\r') {
      if (failedFlags !== null && ((failedFlags[i] ?? 0) & FAIL_ANGLE_DEST) !== 0) {
        if (memo !== undefined) {
          recordUnescapedFlag(text, destStart, i, memo, FAIL_ANGLE_DEST);
        }
        return null;
      }
      if (text[i] === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      i += 1;
    }
    if (text[i] !== '>') {
      if (memo !== undefined) {
        recordUnescapedFlag(text, destStart, i, memo, FAIL_ANGLE_DEST);
      }
      return null;
    }
    rawTarget = text.slice(destStart, i).replace(/\\([<>\\])/g, '$1');
    i += 1; // skip '>'
  } else {
    // CommonMark bare destination: allows balanced parentheses e.g. Plan(1).md, pic(1).png
    destStart = i;
    if (failedFlags !== null && ((failedFlags[destStart] ?? 0) & FAIL_BARE_DEST) !== 0) {
      return null;
    }
    let parenDepth = 0;
    let hitFailedMemo = false;
    while (i < text.length) {
      if (
        failedFlags !== null &&
        i > destStart &&
        ((failedFlags[i] ?? 0) & FAIL_BARE_DEST) !== 0
      ) {
        hitFailedMemo = true;
        break;
      }
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        break;
      }
      if (ch === '(') {
        parenDepth += 1;
      } else if (ch === ')') {
        if (parenDepth === 0) {
          stoppedOnCloseParen = true;
          break;
        }
        parenDepth -= 1;
      }
      i += 1;
    }
    if (hitFailedMemo) {
      if (memo !== undefined) {
        recordFailedBareDestPositions(text, destStart, i, parenDepth, false, memo);
      }
      return null;
    }
    if (parenDepth !== 0) {
      if (memo !== undefined) {
        recordFailedBareDestPositions(text, destStart, i, parenDepth, true, memo);
      }
      return null;
    }
    rawTarget = text.slice(destStart, i).replace(/\\([()\\])/g, '$1');
  }

  if (rawTarget.trim().length === 0) {
    return null;
  }

  const end = finishAfterDestination(text, i, memo);
  if (end === null) {
    if (memo !== undefined) {
      if (text[destStart - 1] === '<') {
        if (i - 1 > destStart) {
          recordUnescapedFlag(text, destStart, i - 1, memo, FAIL_ANGLE_DEST);
        }
      } else if (!stoppedOnCloseParen) {
        recordFailedBareDestPositions(text, destStart, i, 0, false, memo);
      }
    }
    return null;
  }
  return { end, isImage, label, rawTarget };
}

/**
 * Parses a CommonMark inline link `[label](dest "title")` or image `![alt](dest "title")`
 * starting at `start`. Supports both angle-bracketed destinations (`<Plan One.md>`) and
 * balanced parentheses inside bare destinations (`Plan(1).md`, `pic(1).png`), while
 * excluding wikilinks `[[...]]` and wiki embeds `![[...]]`.
 */
export function parseMarkdownLinkOrImageAt(
  text: string,
  start: number,
  knownCloseBracketIdx?: number,
): ParsedMarkdownInlineLink | null {
  return parseMarkdownLinkOrImageInternal(text, start, knownCloseBracketIdx);
}

/**
 * On-demand O(L) memoized bracket matcher for `[label](dest)` / `![alt](dest)`.
 * Scans forward from `openIdx + 1` and stops immediately once `openIdx` closes,
 * so backticks inside `(dest "title")` or subsequent tokens are never pre-scanned.
 * Any inner `[...]` closed along the way (or unclosed `[` on EOF) is memoized.
 */
function findMatchingCloseBracketMemo(
  text: string,
  openIdx: number,
  codeSpanState: CodeSpanScanState,
  bracketMemo: Map<number, number>,
): number {
  const cached = bracketMemo.get(openIdx);
  if (cached !== undefined) {
    return cached;
  }
  const stack: number[] = [openIdx];
  let j = openIdx + 1;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '`') {
      const codeEnd = findCodeSpanEndCached(text, j, codeSpanState);
      if (codeEnd !== null) {
        j = codeEnd;
      } else {
        while (j < text.length && text[j] === '`') j += 1;
      }
      continue;
    }
    if (ch === '\\' && j + 1 < text.length) {
      j += 2;
      continue;
    }
    if (ch === '[') {
      stack.push(j);
    } else if (ch === ']') {
      const popped = stack.pop();
      if (popped !== undefined) {
        bracketMemo.set(popped, j);
      }
      if (stack.length === 0) {
        return j;
      }
    }
    j += 1;
  }
  for (let s = 0; s < stack.length; s += 1) {
    const unclosedIdx = stack[s];
    if (unclosedIdx !== undefined) {
      bracketMemo.set(unclosedIdx, -1);
    }
  }
  return -1;
}

/**
 * Tokenizes single-pass O(L) inline Markdown constructs inside a topic title so link
 * extraction, display-title formatting, and `#tag` tokenization stay 100% consistent and
 * share CommonMark code-span / parenthesis / angle-bracket destination parsing.
 */
export function tokenizeInlineMarkdown(text: string): readonly InlineMarkdownToken[] {
  if (text.length === 0) return [];
  const tokens: InlineMarkdownToken[] = [];
  let plainBuf = '';

  const flushPlain = (): void => {
    if (plainBuf.length > 0) {
      tokens.push({ kind: 'plain', text: plainBuf });
      plainBuf = '';
    }
  };

  const codeSpanState: CodeSpanScanState = { lastRunByLen: null };
  const hasPotentialMdLink = text.includes('](') && text.includes(')');
  const bracketMemo = hasPotentialMdLink ? new Map<number, number>() : null;
  const linkScanMemo = hasPotentialMdLink ? createLinkScanMemo() : undefined;

  let nextDoubleCloseIdx = -2; // -2: uninitialized, -1: none remaining
  const findNextDoubleClose = (minIdx: number): number => {
    if (nextDoubleCloseIdx === -1) return -1;
    if (nextDoubleCloseIdx < minIdx) {
      nextDoubleCloseIdx = text.indexOf(']]', minIdx);
    }
    return nextDoubleCloseIdx;
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';

    // Backslash escape outside code spans
    if (ch === '\\' && i + 1 < text.length) {
      plainBuf += text.slice(i, i + 2);
      i += 2;
      continue;
    }

    // Inline code span of arbitrary backtick length
    if (ch === '`') {
      const codeEnd = findCodeSpanEndCached(text, i, codeSpanState);
      if (codeEnd !== null) {
        flushPlain();
        tokens.push({ kind: 'code', raw: text.slice(i, codeEnd) });
        i = codeEnd;
        continue;
      }
      while (i < text.length && text[i] === '`') {
        plainBuf += '`';
        i += 1;
      }
      continue;
    }

    // Obsidian wiki embed ![[...]]
    if (ch === '!' && text[i + 1] === '[' && text[i + 2] === '[') {
      const closeIdx = findNextDoubleClose(i + 3);
      if (closeIdx > i + 3) {
        // Bound scan for `[`, `]`, `\n` up to closeIdx so unclosed `![[` cannot swallow `[[...]]`.
        let j = i + 3;
        let clean = true;
        while (j < closeIdx) {
          const innerCh = text[j];
          if (innerCh === '\n' || innerCh === '[' || innerCh === ']') {
            clean = false;
            break;
          }
          j += 1;
        }
        if (clean && text.slice(i + 3, closeIdx).trim().length > 0) {
          flushPlain();
          tokens.push({ kind: 'wikiembed', raw: text.slice(i, closeIdx + 2) });
          i = closeIdx + 2;
          continue;
        }
      }
    }

    // CommonMark image ![alt](dest)
    const imgCloseIdx =
      ch === '!' && text[i + 1] === '[' && text[i + 2] !== '[' && bracketMemo !== null
        ? findMatchingCloseBracketMemo(text, i + 1, codeSpanState, bracketMemo)
        : -1;
    if (imgCloseIdx >= 0 && text[imgCloseIdx + 1] === '(') {
      const parsed = parseMarkdownLinkOrImageInternal(text, i, imgCloseIdx, linkScanMemo);
      if (parsed !== null && parsed.isImage) {
        flushPlain();
        tokens.push({ kind: 'mdimage', raw: text.slice(i, parsed.end) });
        i = parsed.end;
        continue;
      }
    }

    // Obsidian wikilink [[target]] or [[target|alias]] (never preceded by '!')
    if (ch === '[' && text[i + 1] === '[' && (i === 0 || text[i - 1] !== '!')) {
      const closeIdx = findNextDoubleClose(i + 2);
      if (closeIdx > i + 2) {
        // Bound scan for `[`, `]`, `\n` up to closeIdx so unclosed `[[` sequences stay O(L).
        let j = i + 2;
        let clean = true;
        while (j < closeIdx) {
          const innerCh = text[j];
          if (innerCh === '\n' || innerCh === '[' || innerCh === ']') {
            clean = false;
            break;
          }
          j += 1;
        }
        if (clean) {
          const inner = text.slice(i + 2, closeIdx);
          const pipeIdx = inner.indexOf('|');
          const rawTarget = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
          const rawAlias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : undefined;
          const target = rawTarget.trim();
          if (target.length > 0) {
            const label = (rawAlias ?? target).trim();
            flushPlain();
            tokens.push({ kind: 'wikilink', raw: text.slice(i, closeIdx + 2), target, label });
            i = closeIdx + 2;
            continue;
          }
        }
      }
    }

    // CommonMark link [label](dest) (never preceded by '!')
    const linkCloseIdx =
      ch === '[' &&
      text[i + 1] !== '[' &&
      (i === 0 || text[i - 1] !== '!') &&
      bracketMemo !== null
        ? findMatchingCloseBracketMemo(text, i, codeSpanState, bracketMemo)
        : -1;
    if (linkCloseIdx >= 0 && text[linkCloseIdx + 1] === '(') {
      const parsed = parseMarkdownLinkOrImageInternal(text, i, linkCloseIdx, linkScanMemo);
      if (parsed !== null && !parsed.isImage) {
        flushPlain();
        tokens.push({
          kind: 'mdlink',
          raw: text.slice(i, parsed.end),
          rawTarget: parsed.rawTarget.trim(),
          label: parsed.label.trim() || parsed.rawTarget.trim(),
        });
        i = parsed.end;
        continue;
      }
    }

    // Bare http/https URL
    if (
      (ch === 'h' || ch === 'H') &&
      (text.slice(i, i + 7).toLowerCase() === 'http://' ||
        text.slice(i, i + 8).toLowerCase() === 'https://')
    ) {
      let end = i;
      while (end < text.length && !/[\s<>()]/.test(text[end] ?? '')) {
        end += 1;
      }
      const rawUrl = text.slice(i, end).replace(/[.,;:!?]+$/, '');
      if (rawUrl.length > 0) {
        flushPlain();
        tokens.push({ kind: 'url', raw: rawUrl });
        i += rawUrl.length;
        continue;
      }
    }

    plainBuf += ch;
    i += 1;
  }

  flushPlain();
  return tokens;
}
