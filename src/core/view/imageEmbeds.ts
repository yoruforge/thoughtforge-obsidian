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

// Matches inline code spans (skipped) or image embeds: ![[target|meta]] or ![alt](target "title")
const CODE_OR_IMAGE_EMBED_RE =
  /`[^`]+`|!\[\[([^[\]|#]+)(?:#[^[\]|]*)?(?:\|([^[\]]+))?\]\]|!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

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

function defaultAltFromPath(targetPath: string): string {
  const base = targetPath.split(/[\\/]/).pop() ?? targetPath;
  return base.length > 0 ? base : 'image';
}

/**
 * Extracts safe deduplicated vault image embeds (`![[img.png]]`, `![[img.png|200]]`,
 * `![alt](img.png)`) from Markdown text while ignoring inline code spans.
 */
export function extractImageEmbeds(text: string): readonly ImageEmbedRef[] {
  if (text.length === 0) return [];
  const results: ImageEmbedRef[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(CODE_OR_IMAGE_EMBED_RE)) {
    const wikiTarget = match[1];
    const wikiPipe = match[2];
    const mdAlt = match[3];
    const mdTarget = match[4];

    if (wikiTarget !== undefined) {
      const raw = wikiTarget.trim();
      if (!isSafeVaultImagePath(raw)) continue;
      const target = safeDecode(raw).trim();
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      let alt = defaultAltFromPath(target);
      let requestedWidth: number | undefined;
      if (wikiPipe !== undefined) {
        const pipeParts = wikiPipe
          .split('|')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        for (const part of pipeParts) {
          const dimMatch = NUMERIC_DIMENSION_RE.exec(part);
          if (dimMatch && dimMatch[1] !== undefined) {
            const parsed = Number.parseInt(dimMatch[1], 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              requestedWidth = parsed;
            }
          } else {
            alt = part;
          }
        }
      }
      results.push({
        target,
        alt,
        ...(requestedWidth !== undefined ? { requestedWidth } : {}),
      });
      continue;
    }

    if (mdTarget !== undefined) {
      const raw = mdTarget.trim().replace(/^<|>$/g, '');
      if (!isSafeVaultImagePath(raw)) continue;
      const target = safeDecode(raw).trim();
      const key = target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const altText = (mdAlt ?? '').trim();
      results.push({
        target,
        alt: altText.length > 0 ? altText : defaultAltFromPath(target),
      });
    }
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
