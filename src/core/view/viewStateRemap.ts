import type { FocusMode, MindMapDocument, TopicNode } from '../model';

function getStructuralNodeKey(doc: MindMapDocument, node: TopicNode): string {
  const segments: string[] = [];
  let cursor = node.parentId;
  const visited = new Set<string>([node.id]);
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = doc.nodes.get(cursor);
    if (!parent) break;
    segments.push(parent.titleRaw);
    cursor = parent.parentId;
  }
  segments.reverse();
  segments.push(node.titleRaw);
  return segments.join('\0');
}

function groupNodesByKey(doc: MindMapDocument): Map<string, TopicNode[]> {
  const groups = new Map<string, TopicNode[]>();
  for (const node of doc.nodes.values()) {
    const key = getStructuralNodeKey(doc, node);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(node);
    } else {
      groups.set(key, [node]);
    }
  }
  return groups;
}

/**
 * Remaps a sequential `n-*` node ID from `beforeDoc` to its corresponding node ID in `afterDoc`
 * so view states (collapsed branches, fixed focus anchor) stay attached to the intended topics
 * across structural insertions, deletions, moves, and external edits.
 */
export function remapNodeIdAcrossDocuments(
  beforeDoc: MindMapDocument,
  afterDoc: MindMapDocument,
  oldNodeId: string,
): string | null {
  if (beforeDoc === afterDoc) {
    return afterDoc.nodes.has(oldNodeId) ? oldNodeId : null;
  }
  if (oldNodeId === beforeDoc.rootId) {
    return afterDoc.rootId;
  }
  const beforeNode = beforeDoc.nodes.get(oldNodeId);
  if (!beforeNode) return null;

  const key = getStructuralNodeKey(beforeDoc, beforeNode);
  const beforeGroups = groupNodesByKey(beforeDoc);
  const afterGroups = groupNodesByKey(afterDoc);
  const afterBucket = afterGroups.get(key);

  if (!afterBucket || afterBucket.length === 0) {
    // Fallback when a topic moved under another parent or an ancestor was renamed:
    // match iff a single node in afterDoc shares both titleRaw and exact ownRangeHash.
    const hashMatches = [...afterDoc.nodes.values()].filter(
      (n) => n.titleRaw === beforeNode.titleRaw && n.ownRangeHash === beforeNode.ownRangeHash,
    );
    if (hashMatches.length === 1 && hashMatches[0]) {
      return hashMatches[0].id;
    }
    return null;
  }

  if (afterBucket.length === 1 && afterBucket[0]) {
    return afterBucket[0].id;
  }

  const hashMatches = afterBucket.filter((n) => n.ownRangeHash === beforeNode.ownRangeHash);
  if (hashMatches.length === 1 && hashMatches[0]) {
    return hashMatches[0].id;
  }

  const beforeBucket = beforeGroups.get(key) ?? [];
  const oldIndex = beforeBucket.findIndex((n) => n.id === oldNodeId);
  if (oldIndex >= 0 && oldIndex < afterBucket.length) {
    return afterBucket[oldIndex]?.id ?? null;
  }
  return null;
}

export function remapNodeIdSet(
  beforeDoc: MindMapDocument,
  afterDoc: MindMapDocument,
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  if (ids.size === 0 || beforeDoc === afterDoc) return ids;
  const next = new Set<string>();
  for (const id of ids) {
    const mapped = remapNodeIdAcrossDocuments(beforeDoc, afterDoc, id);
    if (mapped !== null) {
      next.add(mapped);
    }
  }
  return next;
}

export function remapFocusMode(
  beforeDoc: MindMapDocument,
  afterDoc: MindMapDocument,
  focusMode: FocusMode,
): FocusMode {
  if (focusMode.kind !== 'fixed' || beforeDoc === afterDoc) {
    return focusMode;
  }
  const mapped = remapNodeIdAcrossDocuments(beforeDoc, afterDoc, focusMode.anchorId);
  if (mapped === null) {
    return { kind: 'off' };
  }
  if (mapped === focusMode.anchorId) {
    return focusMode;
  }
  return { kind: 'fixed', anchorId: mapped };
}
