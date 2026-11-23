import type { MindMapDocument, TopicNode } from '../model';

function stripInlineFormatting(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2');
}

function normalizeSubpathSegment(raw: string): string {
  return stripInlineFormatting(raw).trim().replace(/\s+/g, ' ').toLowerCase();
}

function safeDecodeSubpath(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function computeDepth(doc: MindMapDocument, node: TopicNode): number {
  let depth = 0;
  let current: TopicNode | undefined = node;
  const visited = new Set<string>();
  while (current && current.parentId !== null && !visited.has(current.id)) {
    visited.add(current.id);
    depth += 1;
    current = doc.nodes.get(current.parentId);
  }
  return depth;
}

function nodeMatchesHeadingSegment(node: TopicNode, normalizedSegment: string): boolean {
  if (normalizedSegment.length === 0) return false;
  return (
    normalizeSubpathSegment(node.displayTitle) === normalizedSegment ||
    normalizeSubpathSegment(node.titleRaw) === normalizedSegment
  );
}

function matchesAncestorChain(
  doc: MindMapDocument,
  node: TopicNode,
  segments: readonly string[],
): boolean {
  const leafSegment = segments[segments.length - 1];
  if (leafSegment === undefined || !nodeMatchesHeadingSegment(node, leafSegment)) {
    return false;
  }
  if (segments.length === 1) {
    return true;
  }

  // Match preceding heading path segments in order while walking up ancestors.
  let targetIdx = segments.length - 2;
  let cursorId = node.parentId;
  const visited = new Set<string>([node.id]);
  while (cursorId !== null && targetIdx >= 0 && !visited.has(cursorId)) {
    visited.add(cursorId);
    const ancestor = doc.nodes.get(cursorId);
    if (!ancestor) break;
    const expected = segments[targetIdx];
    if (expected !== undefined && nodeMatchesHeadingSegment(ancestor, expected)) {
      targetIdx -= 1;
    }
    cursorId = ancestor.parentId;
  }
  return targetIdx < 0;
}

/**
 * Resolves the most specific topic owning a 0-based Markdown source line
 * (used for "Reveal cursor in mind map" and returning to the exact topic via history Back).
 * Runs in O(N) without Obsidian dependencies.
 */
export function resolveTopicAtLine(doc: MindMapDocument, line: number): string {
  if (!Number.isFinite(line) || line < 0 || doc.nodes.size === 0) {
    return doc.rootId;
  }

  let bestNode: TopicNode | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  let bestDepth = -1;

  for (const node of doc.nodes.values()) {
    if (node.kind === 'central-virtual') {
      continue;
    }
    if (node.headerLine === line) {
      return node.id;
    }
    const { startLine, endLine } = node.subtreeRange;
    if (line >= startLine && line < endLine) {
      const span = endLine - startLine;
      const depth = computeDepth(doc, node);
      if (
        bestNode === null ||
        span < bestSpan ||
        (span === bestSpan && depth > bestDepth) ||
        (span === bestSpan && depth === bestDepth && node.headerLine > bestNode.headerLine)
      ) {
        bestNode = node;
        bestSpan = span;
        bestDepth = depth;
      }
    }
  }

  return bestNode?.id ?? doc.rootId;
}

/**
 * Resolves an Obsidian link subpath (`#Heading`, `#Parent#Child`, or `#^block-id`)
 * to a `TopicNode.id` inside `doc`. Returns `null` when no matching topic exists.
 */
export function resolveTopicBySubpath(doc: MindMapDocument, rawSubpath: string): string | null {
  const decoded = safeDecodeSubpath(rawSubpath).trim();
  const stripped = decoded.startsWith('#') ? decoded.slice(1).trim() : decoded;
  if (stripped.length === 0) {
    return null;
  }

  // Block ID target (`^block-id`)
  if (stripped.startsWith('^')) {
    const targetLower = stripped.toLowerCase();
    let caseInsensitiveMatch: string | null = null;
    for (const node of doc.nodes.values()) {
      if (node.preservedBlockId === null) continue;
      if (node.preservedBlockId === stripped) {
        return node.id;
      }
      if (caseInsensitiveMatch === null && node.preservedBlockId.toLowerCase() === targetLower) {
        caseInsensitiveMatch = node.id;
      }
    }
    return caseInsensitiveMatch;
  }

  // Heading / nested heading target (`Section` or `Parent#Child`)
  const segments = stripped
    .split('#')
    .map(normalizeSubpathSegment)
    .filter((seg) => seg.length > 0);
  if (segments.length === 0) {
    return null;
  }

  let fallbackListMatch: string | null = null;
  for (const node of doc.nodes.values()) {
    if (node.kind === 'central-virtual') continue;
    if (!matchesAncestorChain(doc, node, segments)) continue;
    if (node.kind === 'heading') {
      return node.id;
    }
    if (fallbackListMatch === null) {
      fallbackListMatch = node.id;
    }
  }
  return fallbackListMatch;
}

/**
 * Splits a raw Obsidian link target (`Note#Heading`, `#^blk-1`, `folder/note.md#Sub`)
 * into its note path portion and optional subpath (without leading `#`).
 */
export function splitLinkTargetSubpath(rawTarget: string): {
  readonly pathPart: string;
  readonly subpath: string | undefined;
} {
  const hashIndex = rawTarget.indexOf('#');
  if (hashIndex < 0) {
    return { pathPart: safeDecodeSubpath(rawTarget).trim(), subpath: undefined };
  }
  const pathPart = safeDecodeSubpath(rawTarget.slice(0, hashIndex)).trim();
  const rawSub = rawTarget.slice(hashIndex + 1).trim();
  return {
    pathPart,
    subpath: rawSub.length > 0 ? rawSub : undefined,
  };
}

/**
 * Returns all ancestor node IDs of `nodeId` (excluding `nodeId` itself) so callers can
 * auto-expand any collapsed ancestor before revealing a target topic.
 */
export function collectAncestorIds(doc: MindMapDocument, nodeId: string): readonly string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>([nodeId]);
  let cursor = doc.nodes.get(nodeId)?.parentId ?? null;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    ancestors.push(cursor);
    cursor = doc.nodes.get(cursor)?.parentId ?? null;
  }
  return ancestors;
}
