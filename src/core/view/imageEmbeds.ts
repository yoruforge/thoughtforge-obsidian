import type { TopicNode } from '../model';
import { findCodeSpanEnd, parseMarkdownLinkOrImageAt } from '../parser/inlineMarkdown';

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
 * Extracts safe deduplicated vault image embeds (`![[img.png]]`, `![[img.png|200]]`,
 * `![alt](pic(1).png)`, `![alt](<pic one.png>)`) from Markdown text while strictly
 * skipping CommonMark inline code spans of any backtick length.
 */
export function extractImageEmbeds(text: string): readonly ImageEmbedRef[] {
  if (text.length === 0) return [];
  const results: ImageEmbedRef[] = [];
  const seen = new Set<string>();

  const pushUnique = (
    rawTarget: string,
    alt: string,
    decodeTarget: boolean,
    requestedWidth?: number,
  ): void => {
    const trimmed = rawTarget.trim();
    if (!isSafeVaultImagePath(trimmed)) return;
    const target = (decodeTarget ? safeDecode(trimmed) : trimmed).trim();
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
        pushUnique(rawTarget, alt, false, requestedWidth);
        i = closeIdx + 2;
        continue;
      }
    }

    // CommonMark Markdown image: ![alt](pic(1).png) or ![alt](<pic one.png>)
    if (ch === '!' && text[i + 1] === '[' && text[i + 2] !== '[') {
      const parsed = parseMarkdownLinkOrImageAt(text, i);
      if (parsed !== null && parsed.isImage) {
        pushUnique(parsed.rawTarget, parsed.label.trim(), true);
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
