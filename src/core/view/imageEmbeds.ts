import type { TopicNode } from '../model';

export interface ImageEmbedRef {
  /** Decoded safe relative vault path (e.g. "assets/diagram.png"). */
  readonly target: string;
  /** Accessible alt label derived from alias or filename. */
  readonly alt: string;
  /** Optional numeric width hint from `![[img.png|200]]` or `![[img.png|200x120]]`. */
  readonly requestedWidth?: number;
}

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'svg',
]);

const NUMERIC_DIMENSION_RE = /^(\d+)(?:x\d+)?$/i;

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Validates that a vault image embed target is a safe relative vault path with an
 * allowlisted image extension (blocking path traversal `..`, percent-encoded `..`,
 * absolute paths, external schemes such as `http:`/`javascript:`/`data:`, and non-images).
 */
export function isSafeVaultImagePath(rawPath: string): boolean {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return false;
  const decoded = safeDecode(trimmed);
  for (const candidate of [trimmed, decoded]) {
    if (/^[\\/]/.test(candidate)) return false;
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate)) return false;
    const withoutFragment = candidate.split('#')[0] ?? '';
    const segments = withoutFragment.split(/[\\/]/);
    if (segments.includes('..')) return false;
  }
  const cleanPath = (decoded.split('#')[0] ?? '').split('?')[0] ?? '';
  const dotIdx = cleanPath.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === cleanPath.length - 1) {
    return false;
  }
  const ext = cleanPath.slice(dotIdx + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

export function defaultImageAltFromPath(targetPath: string): string {
  const base = targetPath.split(/[\\/]/).pop() ?? targetPath;
  return base.length > 0 ? base : 'image';
}

export function isNumericImageDimension(label: string): boolean {
  return NUMERIC_DIMENSION_RE.test(label.trim());
}

/**
 * Finds the end index (exclusive) of a CommonMark inline code span starting at `start`
 * (where `text[start] === '`'`). Matches the exact closing run of `tickCount` backticks
 * per CommonMark §6.1 so double/triple backtick spans containing single backticks
 * (e.g. `` ``code ` ![[img.png]]`` ``) are skipped accurately.
 */
function findCodeSpanEnd(text: string, start: number): number | null {
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
 * Parses a CommonMark Markdown image `![alt](dest "optional title")` starting at `start`
 * (where `text.startsWith('![', start)`). Supports both angle-bracketed destinations
 * (`<pic one.png>`) and balanced parentheses inside bare destinations (`pic(1).png`).
 */
function parseMarkdownImageAt(
  text: string,
  start: number,
): { readonly end: number; readonly alt: string; readonly rawTarget: string } | null {
  // Scan alt text `[...]` (respecting backslash escapes and single nesting)
  let i = start + 2;
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
  const alt = text.slice(start + 2, i - 1);
  i += 1; // skip '('

  // Skip optional leading whitespace
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
    i += 1;
  }
  if (i >= text.length) return null;

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
    // CommonMark bare destination: allows balanced parentheses e.g. pic(1).png
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
  return { end: i + 1, alt, rawTarget };
}

/**
 * Extracts safe deduplicated vault image embeds (`![[img.png]]`, `![[img.png|200]]`,
 * `![alt](pic(1).png)`, `![alt](<pic one.png>)`) from Markdown text while strictly
 * skipping CommonMark inline code spans of any backtick length.
 */
export function extractImageEmbeds(text: string): readonly ImageEmbedRef[] {
  if (text.length === 0) return [];
  const results: ImageEmbedRef[] = [];
  const seen = new Set<string>();

  const pushUnique = (rawTarget: string, alt: string, requestedWidth?: number): void => {
    const trimmed = rawTarget.trim();
    if (!isSafeVaultImagePath(trimmed)) return;
    const target = safeDecode(trimmed).trim();
    const key = target.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      target,
      alt: alt.length > 0 ? alt : defaultImageAltFromPath(target),
      ...(requestedWidth !== undefined ? { requestedWidth } : {}),
    });
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    // Backslash escape outside code spans
    if (ch === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }

    // CommonMark code span of arbitrary backtick length (`...`, ``...`...``, ```...```)
    if (ch === '`') {
      const codeEnd = findCodeSpanEnd(text, i);
      if (codeEnd !== null) {
        i = codeEnd;
        continue;
      }
      // Unclosed backtick run: consume the entire run as literal text
      while (i < text.length && text[i] === '`') {
        i += 1;
      }
      continue;
    }

    // Obsidian wiki embed: ![[target|meta]]
    if (ch === '!' && text[i + 1] === '[' && text[i + 2] === '[') {
      const closeIdx = text.indexOf(']]', i + 3);
      if (closeIdx > i + 3 && !text.slice(i + 3, closeIdx).includes('\n')) {
        const inner = text.slice(i + 3, closeIdx);
        const parts = inner.split('|');
        const rawTargetWithHash = (parts[0] ?? '').trim();
        const hashIdx = rawTargetWithHash.indexOf('#');
        const rawTarget =
          hashIdx >= 0 ? rawTargetWithHash.slice(0, hashIdx).trim() : rawTargetWithHash;

        let alt = '';
        let requestedWidth: number | undefined;
        for (let p = 1; p < parts.length; p += 1) {
          const seg = (parts[p] ?? '').trim();
          if (seg.length === 0) continue;
          const dimMatch = NUMERIC_DIMENSION_RE.exec(seg);
          if (dimMatch && dimMatch[1] !== undefined) {
            const parsed = Number.parseInt(dimMatch[1], 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              requestedWidth = parsed;
            }
          } else {
            alt = seg;
          }
        }
        pushUnique(rawTarget, alt, requestedWidth);
        i = closeIdx + 2;
        continue;
      }
    }

    // CommonMark Markdown image: ![alt](pic(1).png) or ![alt](<pic one.png>)
    if (ch === '!' && text[i + 1] === '[' && text[i + 2] !== '[') {
      const parsed = parseMarkdownImageAt(text, i);
      if (parsed !== null) {
        pushUnique(parsed.rawTarget, parsed.alt.trim());
        i = parsed.end;
        continue;
      }
    }

    i += 1;
  }

  return results;
}

/**
 * Collects safe vault image embeds referenced in a topic's title and/or topic note
 * (deduplicated, preserving title-first order).
 */
export function extractNodeImageEmbeds(node: TopicNode): readonly ImageEmbedRef[] {
  const fromTitle = node.kind === 'central-virtual' ? [] : extractImageEmbeds(node.titleRaw);
  const fromNote = node.noteText !== null ? extractImageEmbeds(node.noteText) : [];
  if (fromNote.length === 0) return fromTitle;
  if (fromTitle.length === 0) return fromNote;

  const merged: ImageEmbedRef[] = [...fromTitle];
  const seen = new Set(fromTitle.map((e) => e.target.toLowerCase()));
  for (const embed of fromNote) {
    const key = embed.target.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(embed);
    }
  }
  return merged;
}
