import type { FocusMode, MindMapDocument } from '../model';

export interface VisibilityOptions {
  readonly baseCollapsedIds: ReadonlySet<string>;
  readonly focusMode: FocusMode;
  readonly selectedId: string | null;
  readonly filterQuery: string;
  readonly userOpenedDuringFilterIds: ReadonlySet<string>;
}

export interface VisibilityResult {
  readonly visibleNodeIds: ReadonlySet<string>;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly matchedNodeIds: ReadonlySet<string>;
  readonly effectiveCollapsedIds: ReadonlySet<string>;
  readonly filterActive: boolean;
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
 * Evaluates effective visibility, collapse state, and dimming for Focus + Quick Filter.
 *
 * Rules:
 * - Basic collapse state is preserved separately from temporary Quick Filter expansion.
 * - Quick Filter matches expand ancestors temporarily and temporarily collapse unrelated branches
 *   when at least one match exists (unless manually opened during the same filter session).
 * - Focus dims non-focused branches (fixed anchor or following current selection).
 * - When both Focus and Quick Filter are active, only nodes satisfying both remain full opacity.
 */
export function computeVisibilityAndEmphasis(
  doc: MindMapDocument,
  options: VisibilityOptions,
): VisibilityResult {
  const trimmedQuery = options.filterQuery.trim().toLowerCase();
  const filterActive = trimmedQuery.length > 0;

  const matchedNodeIds = new Set<string>();
  const filterAncestors = new Set<string>();
  const filterMatchSubtrees = new Set<string>();

  if (filterActive) {
    for (const node of doc.nodes.values()) {
      const titleHit =
        node.displayTitle.toLowerCase().includes(trimmedQuery) ||
        node.titleRaw.toLowerCase().includes(trimmedQuery);
      const noteHit =
        node.noteText !== null && node.noteText.toLowerCase().includes(trimmedQuery);
      if (titleHit || noteHit) {
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
        // Temporarily expand ancestors of any match (takes precedence over base collapse / depth)
        isCollapsed = false;
      } else if (
        !filterMatchSubtrees.has(nodeId) &&
        !options.userOpenedDuringFilterIds.has(nodeId)
      ) {
        // Temporarily collapse non-matching branches outside match subtrees
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

  // Determine focus highlight set
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
