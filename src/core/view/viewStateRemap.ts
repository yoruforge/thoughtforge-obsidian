import type { FocusMode, MindMapDocument, TopicNode } from '../model';

export interface DocumentRemapIndex {
  readonly beforeDoc: MindMapDocument;
  readonly afterDoc: MindMapDocument;
  /** General remap for view states (collapsed branches, fixed focus anchor). */
  remapNodeId(oldNodeId: string): string | null;
  /**
   * Strict fail-closed remap for the active selection (targeted by destructive commands like Delete).
   * Never guesses by ordinal index across ambiguous identical siblings or changed duplicate counts,
   * and only falls back across different parents when (titleRaw, ownRangeHash) is unique across
   * BOTH the entire `beforeDoc` and the entire `afterDoc`.
   */
  remapSelectedNodeId(oldNodeId: string): string | null;
  remapNodeIdSet(ids: ReadonlySet<string>): ReadonlySet<string>;
  remapFocusMode(focusMode: FocusMode): FocusMode;
}

interface IndexedDocument {
  readonly keyById: ReadonlyMap<string, string>;
  readonly groups: ReadonlyMap<string, readonly TopicNode[]>;
  readonly ordinalById: ReadonlyMap<string, number>;
  readonly byKeyAndHash: ReadonlyMap<string, readonly TopicNode[]>;
  readonly byTitleAndHash: ReadonlyMap<string, readonly TopicNode[]>;
}

function indexDocument(doc: MindMapDocument): IndexedDocument {
  const keyById = new Map<string, string>();
  const visiting = new Set<string>();

  // Memoized top-down path key construction: O(N) total across the entire document.
  const computeKey = (node: TopicNode): string => {
    const cached = keyById.get(node.id);
    if (cached !== undefined) return cached;
    if (node.parentId === null || visiting.has(node.id)) {
      keyById.set(node.id, node.titleRaw);
      return node.titleRaw;
    }
    visiting.add(node.id);
    const parent = doc.nodes.get(node.parentId);
    const key = parent ? `${computeKey(parent)}\0${node.titleRaw}` : node.titleRaw;
    visiting.delete(node.id);
    keyById.set(node.id, key);
    return key;
  };

  const groups = new Map<string, TopicNode[]>();
  const ordinalById = new Map<string, number>();
  const byKeyAndHash = new Map<string, TopicNode[]>();
  const byTitleAndHash = new Map<string, TopicNode[]>();

  for (const node of doc.nodes.values()) {
    const key = computeKey(node);
    const bucket = groups.get(key);
    if (bucket) {
      ordinalById.set(node.id, bucket.length);
      bucket.push(node);
    } else {
      ordinalById.set(node.id, 0);
      groups.set(key, [node]);
    }

    const khKey = `${key}\0${node.ownRangeHash}`;
    const khBucket = byKeyAndHash.get(khKey);
    if (khBucket) {
      khBucket.push(node);
    } else {
      byKeyAndHash.set(khKey, [node]);
    }

    const thKey = `${node.titleRaw}\0${node.ownRangeHash}`;
    const thBucket = byTitleAndHash.get(thKey);
    if (thBucket) {
      thBucket.push(node);
    } else {
      byTitleAndHash.set(thKey, [node]);
    }
  }

  return {
    keyById,
    groups,
    ordinalById,
    byKeyAndHash,
    byTitleAndHash,
  };
}

/**
 * Builds an O(N) lookup index once per `(beforeDoc, afterDoc)` transition so every lookup in
 * `remapNodeId`, `remapSelectedNodeId`, `remapNodeIdSet`, and `remapFocusMode` is O(1) worst-case
 * (O(N + K) total even when thousands of siblings under the same parent share identical titles).
 */
export function createDocumentRemapIndex(
  beforeDoc: MindMapDocument,
  afterDoc: MindMapDocument,
): DocumentRemapIndex {
  if (beforeDoc === afterDoc) {
    const identity = (oldNodeId: string): string | null =>
      afterDoc.nodes.has(oldNodeId) ? oldNodeId : null;
    return {
      beforeDoc,
      afterDoc,
      remapNodeId: identity,
      remapSelectedNodeId: identity,
      remapNodeIdSet: (ids) => ids,
      remapFocusMode: (focusMode) => focusMode,
    };
  }

  const beforeIdx = indexDocument(beforeDoc);
  const afterIdx = indexDocument(afterDoc);

  const matchGloballyUniqueCrossParent = (beforeNode: TopicNode): string | null => {
    const thKey = `${beforeNode.titleRaw}\0${beforeNode.ownRangeHash}`;
    const beforeGlobal = beforeIdx.byTitleAndHash.get(thKey);
    if (!beforeGlobal || beforeGlobal.length !== 1) {
      return null;
    }
    const afterGlobal = afterIdx.byTitleAndHash.get(thKey);
    if (afterGlobal && afterGlobal.length === 1 && afterGlobal[0]) {
      return afterGlobal[0].id;
    }
    return null;
  };

  const remapNodeId = (oldNodeId: string): string | null => {
    if (oldNodeId === beforeDoc.rootId) {
      return afterDoc.rootId;
    }
    const beforeNode = beforeDoc.nodes.get(oldNodeId);
    if (!beforeNode) return null;

    const key = beforeIdx.keyById.get(oldNodeId);
    const afterBucket = key !== undefined ? afterIdx.groups.get(key) : undefined;

    if (!afterBucket || afterBucket.length === 0) {
      return matchGloballyUniqueCrossParent(beforeNode);
    }

    if (afterBucket.length === 1 && afterBucket[0]) {
      return afterBucket[0].id;
    }

    const khMatches =
      key !== undefined ? afterIdx.byKeyAndHash.get(`${key}\0${beforeNode.ownRangeHash}`) : undefined;
    if (khMatches && khMatches.length === 1 && khMatches[0]) {
      return khMatches[0].id;
    }

    const oldOrdinal = beforeIdx.ordinalById.get(oldNodeId);
    if (oldOrdinal !== undefined && oldOrdinal >= 0 && oldOrdinal < afterBucket.length) {
      return afterBucket[oldOrdinal]?.id ?? null;
    }
    return null;
  };

  const remapSelectedNodeId = (oldNodeId: string): string | null => {
    if (oldNodeId === beforeDoc.rootId) {
      return afterDoc.rootId;
    }
    const beforeNode = beforeDoc.nodes.get(oldNodeId);
    if (!beforeNode) return null;

    const key = beforeIdx.keyById.get(oldNodeId);
    const beforeBucket = key !== undefined ? (beforeIdx.groups.get(key) ?? []) : [];
    const afterBucket = key !== undefined ? afterIdx.groups.get(key) : undefined;
    const beforeSameKeyHashCount =
      key !== undefined ? (beforeIdx.byKeyAndHash.get(`${key}\0${beforeNode.ownRangeHash}`)?.length ?? 0) : 0;

    if (!afterBucket || afterBucket.length === 0) {
      // Cross-parent fallback requires document-wide uniqueness in BOTH beforeDoc and afterDoc
      // so deleting A's "メモ" can NEVER redirect selection onto B's surviving identical "メモ".
      return matchGloballyUniqueCrossParent(beforeNode);
    }

    if (afterBucket.length === 1 && afterBucket[0]) {
      if (beforeBucket.length === 1) {
        return afterBucket[0].id;
      }
      if (beforeSameKeyHashCount === 1 && afterBucket[0].ownRangeHash === beforeNode.ownRangeHash) {
        return afterBucket[0].id;
      }
      return null;
    }

    // Multiple same-titled siblings in afterDoc: O(1) lookup requiring unique ownRangeHash proof.
    if (beforeSameKeyHashCount !== 1 || key === undefined) return null;
    const khMatches = afterIdx.byKeyAndHash.get(`${key}\0${beforeNode.ownRangeHash}`);
    return khMatches && khMatches.length === 1 && khMatches[0] ? khMatches[0].id : null;
  };

  const remapNodeIdSet = (ids: ReadonlySet<string>): ReadonlySet<string> => {
    if (ids.size === 0) return ids;
    const next = new Set<string>();
    for (const id of ids) {
      const mapped = remapNodeId(id);
      if (mapped !== null) {
        next.add(mapped);
      }
    }
    return next;
  };

  const remapFocusMode = (focusMode: FocusMode): FocusMode => {
    if (focusMode.kind !== 'fixed') {
      return focusMode;
    }
    const mapped = remapNodeId(focusMode.anchorId);
    if (mapped === null) {
      return { kind: 'off' };
    }
    if (mapped === focusMode.anchorId) {
      return focusMode;
    }
    return { kind: 'fixed', anchorId: mapped };
  };

  return {
    beforeDoc,
    afterDoc,
    remapNodeId,
    remapSelectedNodeId,
    remapNodeIdSet,
    remapFocusMode,
  };
}

export function remapNodeIdAcrossDocuments(
  beforeDoc: MindMapDocument,
  afterDoc: MindMapDocument,
  oldNodeId: string,
): string | null {
  return createDocumentRemapIndex(beforeDoc, afterDoc).remapNodeId(oldNodeId);
}

export function remapNodeIdSet(
  beforeDoc: MindMapDocument,
  afterDoc: MindMapDocument,
  ids: ReadonlySet<string>,
): ReadonlySet<string> {
  if (ids.size === 0 || beforeDoc === afterDoc) return ids;
  return createDocumentRemapIndex(beforeDoc, afterDoc).remapNodeIdSet(ids);
}

export function remapFocusMode(
  beforeDoc: MindMapDocument,
  afterDoc: MindMapDocument,
  focusMode: FocusMode,
): FocusMode {
  if (focusMode.kind !== 'fixed' || beforeDoc === afterDoc) {
    return focusMode;
  }
  return createDocumentRemapIndex(beforeDoc, afterDoc).remapFocusMode(focusMode);
}
