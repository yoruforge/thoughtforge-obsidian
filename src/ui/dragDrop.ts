import type { LayoutResult, MindMapDocument } from '../core/model';

export type DropPlacement = 'before' | 'inside' | 'after';

export interface DropTarget {
  readonly hoverNodeId: string;
  readonly placement: DropPlacement;
  readonly targetParentId: string;
  readonly index: number;
}

function collectForbiddenDropIds(doc: MindMapDocument, draggedId: string): ReadonlySet<string> {
  const forbidden = new Set<string>();
  const stack: string[] = [draggedId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || forbidden.has(id)) continue;
    forbidden.add(id);
    const node = doc.nodes.get(id);
    if (!node) continue;
    for (const childId of node.childIds) {
      stack.push(childId);
    }
  }
  return forbidden;
}

/**
 * Pure world-coordinate hit tester for mind-map drag-and-drop reparenting/reordering.
 * Rejects self/descendant cycles and same-position no-op drops.
 */
export function resolveDropTarget(
  doc: MindMapDocument,
  layout: LayoutResult,
  draggedId: string,
  worldX: number,
  worldY: number,
): DropTarget | null {
  const draggedNode = doc.nodes.get(draggedId);
  if (!draggedNode || draggedId === doc.rootId || draggedNode.parentId === null) {
    return null;
  }

  const forbidden = collectForbiddenDropIds(doc, draggedId);
  const padX = 10;
  const padY = 6;

  for (const ln of layout.nodes.values()) {
    if (forbidden.has(ln.id)) continue;
    if (
      worldX < ln.x - padX ||
      worldX > ln.x + ln.width + padX ||
      worldY < ln.y - padY ||
      worldY > ln.y + ln.height + padY
    ) {
      continue;
    }

    const hitTopic = doc.nodes.get(ln.id);
    if (!hitTopic) continue;

    // Dropping on the root always appends as a child branch
    if (hitTopic.id === doc.rootId || hitTopic.parentId === null) {
      const rootNode = doc.nodes.get(doc.rootId);
      if (!rootNode) return null;
      return {
        hoverNodeId: hitTopic.id,
        placement: 'inside',
        targetParentId: hitTopic.id,
        index: rootNode.childIds.length,
      };
    }

    const relY = (worldY - ln.y) / Math.max(1, ln.height);
    const hitParent = doc.nodes.get(hitTopic.parentId);
    const sibIndex = hitParent ? hitParent.childIds.indexOf(hitTopic.id) : -1;

    let placement: DropPlacement;
    let targetParentId: string;
    let index: number;

    if (relY < 0.26 && hitParent && sibIndex !== -1) {
      placement = 'before';
      targetParentId = hitParent.id;
      index = sibIndex;
    } else if (relY > 0.74 && hitParent && sibIndex !== -1) {
      placement = 'after';
      targetParentId = hitParent.id;
      index = sibIndex + 1;
    } else {
      placement = 'inside';
      targetParentId = hitTopic.id;
      index = hitTopic.childIds.length;
    }

    // Suppress no-op drop indicators when targeting the node's own current slot
    if (draggedNode.parentId === targetParentId) {
      const parent = doc.nodes.get(targetParentId);
      const curIdx = parent ? parent.childIds.indexOf(draggedId) : -1;
      if (curIdx !== -1 && (index === curIdx || index === curIdx + 1)) {
        return null;
      }
    }

    return {
      hoverNodeId: hitTopic.id,
      placement,
      targetParentId,
      index,
    };
  }

  return null;
}
