import type { MindMapDocument, TopicNode } from '../model';
import type { MapHistoryAnchor } from './navigationHistory';

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

interface SubpathResolverIndex {
  readonly blockIdExact: ReadonlyMap<string, string>;
  readonly blockIdLower: ReadonlyMap<string, string>;
  readonly headingsByLeaf: ReadonlyMap<string, readonly TopicNode[]>;
  readonly listItemsByLeaf: ReadonlyMap<string, readonly TopicNode[]>;
  readonly keysByNodeId: ReadonlyMap<string, readonly string[]>;
  readonly resolvedCache: Map<string, string | null>;
}

const MAX_RESOLVED_SUBPATH_CACHE = 4096;
const subpathIndexCache = new WeakMap<MindMapDocument, SubpathResolverIndex>();

function getSubpathResolverIndex(doc: MindMapDocument): SubpathResolverIndex {
  const existing = subpathIndexCache.get(doc);
  if (existing !== undefined) {
    return existing;
  }

  const blockIdExact = new Map<string, string>();
  const blockIdLower = new Map<string, string>();
  const headingsByLeaf = new Map<string, TopicNode[]>();
  const listItemsByLeaf = new Map<string, TopicNode[]>();
  const keysByNodeId = new Map<string, readonly string[]>();

  for (const node of doc.nodes.values()) {
    if (node.preservedBlockId !== null) {
      if (!blockIdExact.has(node.preservedBlockId)) {
        blockIdExact.set(node.preservedBlockId, node.id);
      }
      const lower = node.preservedBlockId.toLowerCase();
      if (!blockIdLower.has(lower)) {
        blockIdLower.set(lower, node.id);
      }
    }

    const normDisplay = normalizeSubpathSegment(node.displayTitle);
    const normRaw = normalizeSubpathSegment(node.titleRaw);
    const keys: string[] = [];
    if (normDisplay.length > 0) keys.push(normDisplay);
    if (normRaw.length > 0 && normRaw !== normDisplay) keys.push(normRaw);
    keysByNodeId.set(node.id, keys);

    if (node.kind === 'central-virtual') {
      continue;
    }

    const targetMap = node.kind === 'heading' ? headingsByLeaf : listItemsByLeaf;
    for (const key of keys) {
      let bucket = targetMap.get(key);
      if (!bucket) {
        bucket = [];
        targetMap.set(key, bucket);
      }
      bucket.push(node);
    }
  }

  const index: SubpathResolverIndex = {
    blockIdExact,
    blockIdLower,
    headingsByLeaf,
    listItemsByLeaf,
    keysByNodeId,
    resolvedCache: new Map<string, string | null>(),
  };
  subpathIndexCache.set(doc, index);
  return index;
}

function matchesIndexedAncestorChain(
  doc: MindMapDocument,
  keysByNodeId: ReadonlyMap<string, readonly string[]>,
  node: TopicNode,
  segments: readonly string[],
): boolean {
  if (segments.length <= 1) {
    return true;
  }
  let targetIdx = segments.length - 2;
  let cursorId = node.parentId;
  const visited = new Set<string>([node.id]);
  while (cursorId !== null && targetIdx >= 0 && !visited.has(cursorId)) {
    visited.add(cursorId);
    const ancestor = doc.nodes.get(cursorId);
    if (!ancestor) break;
    const expected = segments[targetIdx];
    const ancestorKeys = keysByNodeId.get(cursorId);
    if (expected !== undefined && ancestorKeys !== undefined && ancestorKeys.includes(expected)) {
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
 *
 * Uses a per-document WeakMap index (`SubpathResolverIndex`) so repeated Backlinks lookups
 * across large notes (e.g. 2,000+ headings x 100+ linking notes) run in O(1) amortized time
 * while preserving exact nested-heading and heading-over-list precedence.
 */
export function resolveTopicBySubpath(doc: MindMapDocument, rawSubpath: string): string | null {
  const decoded = safeDecodeSubpath(rawSubpath).trim();
  const stripped = decoded.startsWith('#') ? decoded.slice(1).trim() : decoded;
  if (stripped.length === 0) {
    return null;
  }

  const index = getSubpathResolverIndex(doc);
  if (index.resolvedCache.has(stripped)) {
    return index.resolvedCache.get(stripped) ?? null;
  }

  let resolved: string | null = null;

  // Block ID target (`^block-id`)
  if (stripped.startsWith('^')) {
    resolved =
      index.blockIdExact.get(stripped) ?? index.blockIdLower.get(stripped.toLowerCase()) ?? null;
  } else {
    // Heading / nested heading target (`Section` or `Parent#Child`)
    const segments = stripped
      .split('#')
      .map(normalizeSubpathSegment)
      .filter((seg) => seg.length > 0);
    const leafSegment = segments[segments.length - 1];
    if (leafSegment !== undefined) {
      const headingCandidates = index.headingsByLeaf.get(leafSegment);
      if (headingCandidates) {
        for (const node of headingCandidates) {
          if (matchesIndexedAncestorChain(doc, index.keysByNodeId, node, segments)) {
            resolved = node.id;
            break;
          }
        }
      }
      if (resolved === null) {
        const listCandidates = index.listItemsByLeaf.get(leafSegment);
        if (listCandidates) {
          for (const node of listCandidates) {
            if (matchesIndexedAncestorChain(doc, index.keysByNodeId, node, segments)) {
              resolved = node.id;
              break;
            }
          }
        }
      }
    }
  }

  if (index.resolvedCache.size < MAX_RESOLVED_SUBPATH_CACHE) {
    index.resolvedCache.set(stripped, resolved);
  }
  return resolved;
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

function buildAncestorTitlePath(doc: MindMapDocument, node: TopicNode): readonly string[] {
  const segments: string[] = [];
  const visited = new Set<string>([node.id]);
  let cursor = node.parentId;
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = doc.nodes.get(cursor);
    if (!parent) break;
    segments.push(parent.titleRaw);
    cursor = parent.parentId;
  }
  segments.reverse();
  return segments;
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Captures a fail-closed structural anchor snapshot for `node` inside `doc` (used when
 * recording history Back/Forward return points). Checks document-wide uniqueness of both
 * `preservedBlockId` (case-insensitive) and structural identity `(ancestorPath, titleRaw,
 * ownRangeHash)` in a single pass.
 */
export function createHistoryAnchor(doc: MindMapDocument, node: TopicNode): MapHistoryAnchor {
  const targetAncestorPath = buildAncestorTitlePath(doc, node);
  const targetBlockLower = node.preservedBlockId?.toLowerCase() ?? null;

  let hadDuplicateBlockId = false;
  let hadIdenticalSibling = false;

  for (const other of doc.nodes.values()) {
    if (other.id === node.id) continue;
    if (
      targetBlockLower !== null &&
      other.preservedBlockId !== null &&
      other.preservedBlockId.toLowerCase() === targetBlockLower
    ) {
      hadDuplicateBlockId = true;
    }
    if (
      !hadIdenticalSibling &&
      other.titleRaw === node.titleRaw &&
      other.ownRangeHash === node.ownRangeHash &&
      sameStringList(buildAncestorTitlePath(doc, other), targetAncestorPath)
    ) {
      hadIdenticalSibling = true;
    }
    if (hadDuplicateBlockId && hadIdenticalSibling) {
      break;
    }
  }

  return {
    baseContentHash: doc.contentHash,
    headerLine: node.headerLine,
    titleRaw: node.titleRaw,
    ancestorPath: targetAncestorPath,
    ownRangeHash: node.ownRangeHash,
    preservedBlockId: node.preservedBlockId,
    hadDuplicateBlockId,
    hadIdenticalSibling,
  };
}

/**
 * Strictly fail-closed structural resolver for history Back/Forward return anchors.
 * - Unchanged document (`contentHash === baseContentHash`): exact `headerLine` + `titleRaw` match.
 * - Modified document:
 *   1. If an explicit Obsidian block ID was captured (`preservedBlockId !== null`), matches ONLY
 *      when that exact block ID is unique in `doc` AND still matches the original topic's
 *      `titleRaw` (preventing line-shift mis-selection onto a different sibling like `Prior`).
 *   2. Otherwise (no block ID), requires `!hadIdenticalSibling` and a unique topic matching exact
 *      `ancestorPath`, `titleRaw`, `ownRangeHash`, and `preservedBlockId === null`.
 * - Returns `null` whenever the original topic cannot be uniquely proven so selection stays empty
 *   and destructive commands like `Delete` cannot touch another branch.
 */
export function resolveHistoryAnchor(
  doc: MindMapDocument,
  anchor: MapHistoryAnchor,
): string | null {
  if (doc.contentHash === anchor.baseContentHash) {
    for (const node of doc.nodes.values()) {
      if (node.kind === 'central-virtual') continue;
      if (node.headerLine === anchor.headerLine && node.titleRaw === anchor.titleRaw) {
        return node.id;
      }
    }
    if (anchor.headerLine === 0) {
      const root = doc.nodes.get(doc.rootId);
      if (root && root.titleRaw === anchor.titleRaw) {
        return root.id;
      }
    }
    return null;
  }

  // Document changed while user was away: never fall back to raw line number!
  if (anchor.preservedBlockId !== null) {
    // Fail closed if this block ID was already duplicated anywhere in the document when history
    // was recorded (e.g. two branches under different parents sharing `^copied`): deleting the
    // original branch must NEVER transfer selection onto the surviving duplicate!
    if (anchor.hadDuplicateBlockId) {
      return null;
    }
    const targetLower = anchor.preservedBlockId.toLowerCase();
    const blockMatches: TopicNode[] = [];
    for (const node of doc.nodes.values()) {
      if (
        node.preservedBlockId !== null &&
        node.preservedBlockId.toLowerCase() === targetLower
      ) {
        blockMatches.push(node);
      }
    }
    if (
      blockMatches.length === 1 &&
      blockMatches[0] &&
      blockMatches[0].preservedBlockId === anchor.preservedBlockId &&
      blockMatches[0].titleRaw === anchor.titleRaw
    ) {
      return blockMatches[0].id;
    }
    return null;
  }

  if (anchor.hadIdenticalSibling) {
    return null;
  }

  const structuralMatches: TopicNode[] = [];
  for (const node of doc.nodes.values()) {
    if (node.kind === 'central-virtual') continue;
    if (
      node.titleRaw === anchor.titleRaw &&
      node.ownRangeHash === anchor.ownRangeHash &&
      node.preservedBlockId === null &&
      sameStringList(buildAncestorTitlePath(doc, node), anchor.ancestorPath)
    ) {
      structuralMatches.push(node);
    }
  }
  return structuralMatches.length === 1 && structuralMatches[0] ? structuralMatches[0].id : null;
}
