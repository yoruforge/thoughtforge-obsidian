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

/**
 * Finds the end index (exclusive) of a CommonMark inline code span starting at `start`
 * (where `text[start] === '`'`). Matches the exact closing run of `tickCount` backticks
 * per CommonMark §6.1 so multi-backtick spans containing shorter backtick runs
 * (e.g. `` ``code ` with ![[pic.png]]`` ``) are scanned accurately.
 */
export function findCodeSpanEnd(text: string, start: number): number | null {
  let tickEnd = start;
  while (tickEnd < text.length && text[tickEnd] === '`') {
    tickEnd += 1;
  }
  const tickCount = tickEnd - start;
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
  return null;
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

  let i = bracketContentStart;
  let bracketDepth = 1;
  while (i < text.length && bracketDepth > 0) {
    const ch = text[i];
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
  const label = text.slice(bracketContentStart, i - 1);
  i += 1; // skip '('

  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    i += 1;
  }
  if (i >= text.length) {
    return null;
  }

  let rawTarget = '';
  if (text[i] === '<') {
    // CommonMark angle-bracketed destination: allows spaces & parentheses until unescaped '>'
    i += 1;
    const destStart = i;
    while (i < text.length && text[i] !== '>' && text[i] !== '\n') {
      if (text[i] === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      i += 1;
    }
    if (text[i] !== '>') return null;
    rawTarget = text.slice(destStart, i).replace(/\\([<>\\])/g, '$1');
    i += 1; // skip '>'
  } else {
    // CommonMark bare destination: allows balanced parentheses e.g. Plan(1).md, pic(1).png
    const destStart = i;
    let parenDepth = 0;
    while (i < text.length) {
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
        if (parenDepth === 0) break;
        parenDepth -= 1;
      }
      i += 1;
    }
    if (parenDepth !== 0) return null;
    rawTarget = text.slice(destStart, i).replace(/\\([()\\])/g, '$1');
  }

  if (rawTarget.trim().length === 0) {
    return null;
  }

  // Skip optional whitespace and optional quoted title before closing ')'
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    i += 1;
  }
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i];
    i += 1;
    while (i < text.length && text[i] !== quote && text[i] !== '\n') {
      if (text[i] === '\\' && i + 1 < text.length) {
        i += 2;
        continue;
      }
      i += 1;
    }
    if (text[i] !== quote) return null;
    i += 1;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
      i += 1;
    }
  }
  if (text[i] !== ')') {
    return null;
  }
  return { end: i + 1, isImage, label, rawTarget };
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
      const codeEnd = findCodeSpanEnd(text, i);
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
      const closeIdx = text.indexOf(']]', i + 3);
      if (closeIdx > i + 3 && !text.slice(i + 3, closeIdx).includes('\n')) {
        flushPlain();
        tokens.push({ kind: 'wikiembed', raw: text.slice(i, closeIdx + 2) });
        i = closeIdx + 2;
        continue;
      }
    }

    // CommonMark image ![alt](dest)
    if (ch === '!' && text[i + 1] === '[' && text[i + 2] !== '[') {
      const parsed = parseMarkdownLinkOrImageAt(text, i);
      if (parsed !== null && parsed.isImage) {
        flushPlain();
        tokens.push({ kind: 'mdimage', raw: text.slice(i, parsed.end) });
        i = parsed.end;
        continue;
      }
    }

    // Obsidian wikilink [[target]] or [[target|alias]] (never preceded by '!')
    if (ch === '[' && text[i + 1] === '[' && (i === 0 || text[i - 1] !== '!')) {
      const closeIdx = text.indexOf(']]', i + 2);
      if (closeIdx > i + 2) {
        const inner = text.slice(i + 2, closeIdx);
        if (!inner.includes('\n') && !inner.includes('[') && !inner.includes(']')) {
          const pipeIdx = inner.indexOf('|');
          const rawTarget = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
          const rawAlias = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : undefined;
          const target = rawTarget.trim();
          const hasSecondPipe = rawAlias !== undefined && rawAlias.includes('|');
          if (target.length > 0 && !hasSecondPipe) {
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
    if (ch === '[' && text[i + 1] !== '[' && (i === 0 || text[i - 1] !== '!')) {
      const parsed = parseMarkdownLinkOrImageAt(text, i);
      if (parsed !== null && !parsed.isImage) {
        flushPlain();
        tokens.push({
          kind: 'mdlink',
          raw: text.slice(i, parsed.end),
          rawTarget: parsed.rawTarget.trim(),
          label: parsed.label.trim(),
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
