import type {
  LayoutBounds,
  LayoutResult,
  MindMapDocument,
  TopicNumberingMode,
} from '../model';

// Matches Obsidian inline tags (#tag, #nested/tag, Unicode/Japanese tags) not preceded by word chars
// and excludes purely numeric hashes like #123.
const INLINE_TAG_RE = /(?:^|[\s([「（])(#(?![0-9]+(?:$|[\s)\]}.,;:!?]))[\p{L}\p{N}_/-]+)/gu;

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
 * Extracts Obsidian-style inline tags (#tag) from a topic title.
 */
export function extractTopicTags(titleRaw: string): readonly string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const match of titleRaw.matchAll(INLINE_TAG_RE)) {
    const tag = match[1];
    if (!tag) continue;
    const normalized = tag.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      tags.push(tag);
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
