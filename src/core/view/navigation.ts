import type { LayoutResult, MindMapDocument } from '../model';

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Resolves spatial arrow navigation across center/left/right branches.
 */
export function resolveArrowNavigation(
  doc: MindMapDocument,
  layout: LayoutResult,
  currentId: string | null,
  direction: ArrowDirection,
): string | null {
  if (currentId === null || !layout.nodes.has(currentId)) {
    return doc.rootId;
  }

  const currentNode = doc.nodes.get(currentId);
  const currentLayout = layout.nodes.get(currentId);
  if (!currentNode || !currentLayout) return doc.rootId;

  const visibleChildren = currentNode.childIds.filter((id) => layout.nodes.has(id));

  // Center node navigation
  if (currentLayout.side === 'center') {
    if (direction === 'right') {
      return visibleChildren.find((id) => layout.nodes.get(id)?.side === 'right') ?? currentId;
    }
    if (direction === 'left') {
      return visibleChildren.find((id) => layout.nodes.get(id)?.side === 'left') ?? currentId;
    }
    return currentId;
  }

  // Horizontal navigation: outward -> first child, inward -> parent
  const outwardDir: ArrowDirection = currentLayout.side === 'right' ? 'right' : 'left';
  const inwardDir: ArrowDirection = currentLayout.side === 'right' ? 'left' : 'right';

  if (direction === outwardDir) {
    return visibleChildren[0] ?? currentId;
  }
  if (direction === inwardDir) {
    return currentNode.parentId ?? currentId;
  }

  // Vertical navigation (up / down): prefer visible sibling, fallback to spatially nearest node on same side & depth
  const parent = currentNode.parentId !== null ? doc.nodes.get(currentNode.parentId) : undefined;
  if (parent) {
    const sameSideSiblings = parent.childIds.filter((id) => {
      const sibLayout = layout.nodes.get(id);
      return sibLayout !== undefined && sibLayout.side === currentLayout.side;
    });
    const idx = sameSideSiblings.indexOf(currentId);
    if (direction === 'up' && idx > 0) {
      return sameSideSiblings[idx - 1] ?? currentId;
    }
    if (direction === 'down' && idx >= 0 && idx < sameSideSiblings.length - 1) {
      return sameSideSiblings[idx + 1] ?? currentId;
    }
  }

  // Cross-branch fallback at the same side and depth sorted by Y
  const sameDepthCandidates = [...layout.nodes.values()]
    .filter((ln) => ln.side === currentLayout.side && ln.depth === currentLayout.depth)
    .sort((a, b) => a.y - b.y);
  const depthIdx = sameDepthCandidates.findIndex((ln) => ln.id === currentId);
  if (direction === 'up' && depthIdx > 0) {
    return sameDepthCandidates[depthIdx - 1]?.id ?? currentId;
  }
  if (direction === 'down' && depthIdx >= 0 && depthIdx < sameDepthCandidates.length - 1) {
    return sameDepthCandidates[depthIdx + 1]?.id ?? currentId;
  }

  return currentId;
}
