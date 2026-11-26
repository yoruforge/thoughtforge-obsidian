import type {
  LayoutBounds,
  LayoutResult,
  MindMapDocument,
  TopicNumberingMode,
} from '../model';
import { tokenizeInlineMarkdown } from '../parser/inlineMarkdown';

// Matches Obsidian inline tags (#tag, #nested/tag, Unicode/Japanese tags) preceded by
// start-of-string or a valid delimiter (whitespace / opening bracket / punctuation) and
// excludes purely numeric hashes like #123.
const PLAIN_TEXT_TAG_RE =
  /(^|[\s([「（【、,;])(#(?![0-9]+(?:$|[\s)\]}.,;:!?」）】、]))[\p{L}\p{N}_/-]+)/gu;

export interface TitleSegment {
  readonly kind: 'text' | 'tag';
  readonly text: string;
}

function appendTextSegment(segments: TitleSegment[], text: string): void {
  if (text.length === 0) return;
  const last = segments[segments.length - 1];
  if (last && last.kind === 'text') {
    segments[segments.length - 1] = { kind: 'text', text: last.text + text };
  } else {
    segments.push({ kind: 'text', text });
  }
}

function tokenizePlainTextChunk(
  chunk: string,
  allowStartBoundary: boolean,
  segments: TitleSegment[],
): void {
  if (chunk.length === 0) return;
  let cursor = 0;
  for (const match of chunk.matchAll(PLAIN_TEXT_TAG_RE)) {
    const matchIndex = match.index;
    const prefix = match[1] ?? '';
    const tag = match[2];
    if (matchIndex === undefined || !tag) continue;

    // A tag at index 0 with empty prefix is only valid if the chunk starts at a valid boundary
    // (start of title, or immediately after whitespace/delimiter — never glued to a link/code word).
    if (matchIndex === 0 && prefix.length === 0 && !allowStartBoundary) {
      continue;
    }

    const tagStart = matchIndex + prefix.length;
    if (tagStart > cursor) {
      appendTextSegment(segments, chunk.slice(cursor, tagStart));
    }
    segments.push({ kind: 'tag', text: tag });
    cursor = tagStart + tag.length;
  }
  if (cursor < chunk.length) {
    appendTextSegment(segments, chunk.slice(cursor));
  }
}

/**
 * Single-source-of-truth Markdown-aware tokenizer for topic titles.
 * Produces display segments (converting wikilinks/markdown links to their visible labels)
 * while ensuring `#Heading` inside `[[Note#Heading]]`, `(#anchor)` inside `[label](#anchor)`,
 * `#fragment` inside bare URLs, and `#code` inside backticks are NEVER treated as Obsidian tags.
 */
export function tokenizeTopicTitle(titleRaw: string): readonly TitleSegment[] {
  const trimmed = titleRaw.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const segments: TitleSegment[] = [];
  let allowStartBoundary = true;

  for (const token of tokenizeInlineMarkdown(trimmed)) {
    if (token.kind === 'plain') {
      tokenizePlainTextChunk(token.text, allowStartBoundary, segments);
      continue;
    }
    if (token.kind === 'wikilink' || token.kind === 'mdlink') {
      appendTextSegment(segments, token.label);
    } else {
      // Inline code span, embed/image, or bare URL: preserve literal text, never scan for tags
      appendTextSegment(segments, token.raw);
    }
    allowStartBoundary = false;
  }

  return segments;
}

function indexToAlpha(index: number, uppercase: boolean): string {
  let n = index;
  let out = '';
  const base = uppercase ? 65 : 97;
  do {
    out = String.fromCharCode(base + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Computes non-destructive visual numbering labels (e.g. "1.2.1" or "A.b")
 * without touching the underlying Markdown text.
 */
export function computeTopicNumbering(
  doc: MindMapDocument,
  mode: TopicNumberingMode,
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  if (mode === 'off') {
    return labels;
  }

  const visit = (nodeId: string, prefix: string, depth: number): void => {
    const node = doc.nodes.get(nodeId);
    if (!node) return;
    for (let i = 0; i < node.childIds.length; i += 1) {
      const childId = node.childIds[i];
      if (childId === undefined) continue;
      const segment =
        mode === 'decimal' ? String(i + 1) : indexToAlpha(i, depth === 0);
      const label = prefix.length > 0 ? `${prefix}.${segment}` : segment;
      labels.set(childId, label);
      visit(childId, label, depth + 1);
    }
  };

  visit(doc.rootId, '', 0);
  return labels;
}

/**
 * Counts total rendered inline tag pills in a topic title (preserving duplicates)
 * so layout width/wrapping calculations reserve padding for every rendered pill.
 */
export function countRenderedTopicTags(titleRaw: string): number {
  let count = 0;
  for (const segment of tokenizeTopicTitle(titleRaw)) {
    if (segment.kind === 'tag') {
      count += 1;
    }
  }
  return count;
}

/**
 * Extracts unique Obsidian-style inline tags (#tag) from a topic title using the exact same
 * Markdown-aware tokenizer used for node badge/pill rendering.
 */
export function extractTopicTags(titleRaw: string): readonly string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const segment of tokenizeTopicTitle(titleRaw)) {
    if (segment.kind !== 'tag') continue;
    const normalized = segment.text.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      tags.push(segment.text);
    }
  }
  return tags;
}

/**
 * Collects unique sorted inline tags across all topics in the document for filter chips.
 */
export function collectDocumentTags(doc: MindMapDocument): readonly string[] {
  const map = new Map<string, string>();
  for (const node of doc.nodes.values()) {
    if (node.kind === 'central-virtual') continue;
    for (const tag of extractTopicTags(node.titleRaw)) {
      const key = tag.toLowerCase();
      if (!map.has(key)) {
        map.set(key, tag);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.localeCompare(b));
}

export interface DocumentTextStats {
  readonly wordCount: number;
  readonly charCount: number;
}

/**
 * Counts words (whitespace-delimited Latin tokens + CJK ideographs/kana) and characters
 * across topic titles and notes for the status bar.
 */
export function computeDocumentTextStats(doc: MindMapDocument): DocumentTextStats {
  let wordCount = 0;
  let charCount = 0;

  const countText = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    charCount += trimmed.replace(/\s+/g, '').length;
    const cjkMatches = trimmed.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const withoutCjk = trimmed.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, ' ').trim();
    const latinWords = withoutCjk.length > 0 ? withoutCjk.split(/\s+/).length : 0;
    wordCount += cjkCount + latinWords;
  };

  for (const node of doc.nodes.values()) {
    if (node.kind !== 'central-virtual') {
      countText(node.displayTitle);
    }
    if (node.noteText !== null) {
      countText(node.noteText);
    }
  }

  return { wordCount, charCount };
}

/**
 * Computes the bounding box of a node and all of its currently visible descendants
 * for Cmd/Ctrl+Shift+0 "Fit Selection".
 */
export function computeSubtreeBounds(
  doc: MindMapDocument,
  layout: LayoutResult,
  anchorId: string,
): LayoutBounds | null {
  const stack: string[] = [anchorId];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let foundAny = false;

  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    const ln = layout.nodes.get(id);
    if (ln) {
      foundAny = true;
      if (ln.x < minX) minX = ln.x;
      if (ln.y < minY) minY = ln.y;
      if (ln.x + ln.width > maxX) maxX = ln.x + ln.width;
      if (ln.y + ln.height > maxY) maxY = ln.y + ln.height;
    }
    const node = doc.nodes.get(id);
    if (!node) continue;
    for (const childId of node.childIds) {
      if (layout.nodes.has(childId)) {
        stack.push(childId);
      }
    }
  }

  return foundAny ? { minX, minY, maxX, maxY } : null;
}
