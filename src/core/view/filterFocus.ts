import type {
  FocusMode,
  MindMapDocument,
  StructuredFilterCriteria,
  TopicNode,
} from '../model';
import { extractTopicTags } from './topicPresentation';

export interface VisibilityOptions {
  readonly baseCollapsedIds: ReadonlySet<string>;
  readonly focusMode: FocusMode;
  readonly selectedId: string | null;
  readonly filterQuery: string;
  readonly structuredFilter?: StructuredFilterCriteria;
  readonly userOpenedDuringFilterIds: ReadonlySet<string>;
}

export interface VisibilityResult {
  readonly visibleNodeIds: ReadonlySet<string>;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly matchedNodeIds: ReadonlySet<string>;
  readonly effectiveCollapsedIds: ReadonlySet<string>;
  readonly filterActive: boolean;
}

const OPEN_TASK_RE = /^\[ \][ \t]+$/;
const COMPLETED_TASK_RE = /^\[[xX]\][ \t]+$/;

export function hasActiveStructuredFilter(
  criteria: StructuredFilterCriteria | undefined,
): boolean {
  if (!criteria) return false;
  return (
    criteria.hasNote === true ||
    criteria.hasOpenTask === true ||
    criteria.hasCompletedTask === true ||
    criteria.hasLink === true ||
    criteria.hasUnmapped === true ||
    (criteria.tag !== undefined && criteria.tag.trim().length > 0)
  );
}

function matchesStructuredFilter(
  node: TopicNode,
  criteria: StructuredFilterCriteria | undefined,
): boolean {
  if (!criteria) return true;
  if (criteria.hasNote === true && node.noteRange === null) return false;

  const wantOpen = criteria.hasOpenTask === true;
  const wantCompleted = criteria.hasCompletedTask === true;
  if (wantOpen && wantCompleted) {
    if (!OPEN_TASK_RE.test(node.preservedPrefix) && !COMPLETED_TASK_RE.test(node.preservedPrefix)) {
      return false;
    }
  } else if (wantOpen) {
    if (!OPEN_TASK_RE.test(node.preservedPrefix)) return false;
  } else if (wantCompleted) {
    if (!COMPLETED_TASK_RE.test(node.preservedPrefix)) return false;
  }

  if (criteria.hasLink === true && node.links.length === 0) return false;
  if (criteria.hasUnmapped === true && node.unmappedBlocks.length === 0) return false;

  const rawTag = criteria.tag?.trim();
  if (rawTag && rawTag.length > 0) {
    if (node.kind === 'central-virtual') return false;
    const normalizedFilterTag = (rawTag.startsWith('#') ? rawTag : `#${rawTag}`).toLowerCase();
    const nodeTags = extractTopicTags(node.titleRaw).map((t) => t.toLowerCase());
    const tagHit = nodeTags.some(
      (t) => t === normalizedFilterTag || t.startsWith(`${normalizedFilterTag}/`),
    );
    if (!tagHit) return false;
  }
  return true;
}

function collectSubtreeIds(doc: MindMapDocument, startId: string, out: Set<string>): void {
  const stack: string[] = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || out.has(id)) continue;
    out.add(id);
    const node = doc.nodes.get(id);
    if (!node) continue;
    for (const childId of node.childIds) {
      stack.push(childId);
    }
  }
}

function collectAncestorIds(doc: MindMapDocument, startId: string, out: Set<string>): void {
  let cursor = doc.nodes.get(startId)?.parentId ?? null;
  while (cursor !== null) {
    if (out.has(cursor)) break;
    out.add(cursor);
    cursor = doc.nodes.get(cursor)?.parentId ?? null;
  }
}

/**
 * Computes new baseCollapsedIds for depth commands (0..9)
 * relative to the selected anchor node (0 = expand all descendants).
 */
export function computeDepthCollapsedIds(
  doc: MindMapDocument,
  anchorId: string,
  depth: number,
  currentBaseCollapsed: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set<string>(currentBaseCollapsed);
  const anchor = doc.nodes.get(anchorId);
  if (!anchor) return next;

  const visit = (nodeId: string, relativeDepth: number): void => {
    const node = doc.nodes.get(nodeId);
    if (!node) return;
    if (depth === 0) {
      next.delete(nodeId);
    } else if (relativeDepth >= depth) {
      if (node.childIds.length > 0) {
        next.add(nodeId);
      }
    } else {
      next.delete(nodeId);
    }
    for (const childId of node.childIds) {
      visit(childId, relativeDepth + 1);
    }
  };

  visit(anchorId, 0);
  return next;
}

/**
 * Evaluates effective visibility, collapse state, and dimming for Focus + Quick Filter
 * + Markdown-derived Structured Filters.
 */
export function computeVisibilityAndEmphasis(
  doc: MindMapDocument,
  options: VisibilityOptions,
): VisibilityResult {
  const trimmedQuery = options.filterQuery.trim().toLowerCase();
  const textFilterActive = trimmedQuery.length > 0;
  const structuredActive = hasActiveStructuredFilter(options.structuredFilter);
  const filterActive = textFilterActive || structuredActive;

  const matchedNodeIds = new Set<string>();
  const filterAncestors = new Set<string>();
  const filterMatchSubtrees = new Set<string>();

  if (filterActive) {
    for (const node of doc.nodes.values()) {
      const textHit =
        !textFilterActive ||
        node.displayTitle.toLowerCase().includes(trimmedQuery) ||
        node.titleRaw.toLowerCase().includes(trimmedQuery) ||
        (node.noteText !== null && node.noteText.toLowerCase().includes(trimmedQuery));

      const attrHit = !structuredActive || matchesStructuredFilter(node, options.structuredFilter);

      if (textHit && attrHit) {
        matchedNodeIds.add(node.id);
        collectAncestorIds(doc, node.id, filterAncestors);
        collectSubtreeIds(doc, node.id, filterMatchSubtrees);
      }
    }
  }

  const effectiveCollapsedIds = new Set<string>();
  const visibleNodeIds = new Set<string>();

  const traverse = (nodeId: string): void => {
    const node = doc.nodes.get(nodeId);
    if (!node) return;
    visibleNodeIds.add(nodeId);

    if (node.childIds.length === 0) return;

    let isCollapsed = options.baseCollapsedIds.has(nodeId);
    if (filterActive && matchedNodeIds.size > 0) {
      if (filterAncestors.has(nodeId)) {
        isCollapsed = false;
      } else if (
        !filterMatchSubtrees.has(nodeId) &&
        !options.userOpenedDuringFilterIds.has(nodeId)
      ) {
        isCollapsed = true;
      }
    }

    if (isCollapsed) {
      effectiveCollapsedIds.add(nodeId);
      return;
    }

    for (const childId of node.childIds) {
      traverse(childId);
    }
  };

  traverse(doc.rootId);

  let focusAnchorId: string | null = null;
  if (options.focusMode.kind === 'fixed') {
    focusAnchorId = doc.nodes.has(options.focusMode.anchorId)
      ? options.focusMode.anchorId
      : null;
  } else if (options.focusMode.kind === 'follow') {
    focusAnchorId =
      options.selectedId !== null && doc.nodes.has(options.selectedId)
        ? options.selectedId
        : null;
  }

  const focusHighlighted = new Set<string>();
  const focusActive = focusAnchorId !== null && focusAnchorId !== doc.rootId;
  if (focusActive && focusAnchorId !== null) {
    collectSubtreeIds(doc, focusAnchorId, focusHighlighted);
  }

  const dimmedNodeIds = new Set<string>();
  for (const id of visibleNodeIds) {
    const passesFocus = !focusActive || focusHighlighted.has(id);
    const passesFilter =
      !filterActive || matchedNodeIds.has(id) || filterAncestors.has(id);
    if (!(passesFocus && passesFilter)) {
      dimmedNodeIds.add(id);
    }
  }

  return {
    visibleNodeIds,
    dimmedNodeIds,
    matchedNodeIds,
    effectiveCollapsedIds,
    filterActive,
  };
}
