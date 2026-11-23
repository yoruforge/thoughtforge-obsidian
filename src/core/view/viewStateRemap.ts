import type { FocusMode, MindMapDocument, TopicNode } from '../model';

export interface DocumentRemapIndex {
  readonly beforeDoc: MindMapDocument;
  readonly afterDoc: MindMapDocument;
  /** General remap for view states (collapsed branches, fixed focus anchor). */
  remapNodeId(oldNodeId: string): string | null;
  /**
   * Strict fail-closed remap for the active selection (targeted by destructive commands like Delete).
   * Never guesses by ordinal index across ambiguous identical siblings or changed duplicate counts.
   */
  remapSelectedNodeId(oldNodeId: string): string | null;
  remapNodeIdSet(ids: ReadonlySet<string>): ReadonlySet<string>;
  remapFocusMode(focusMode: FocusMode): FocusMode;
}

interface IndexedDocument {
  readonly keyById: ReadonlyMap<string, string>;
  readonly groups: ReadonlyMap<string, readonly TopicNode[]>;
  readonly ordinalById: ReadonlyMap<string, number>;
  readonly byTitleAndHash: ReadonlyMap<string, readonly TopicNode[]>;
  readonly sameKeyHashCountById: ReadonlyMap<string, number>;
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

    const thKey = `${node.titleRaw}\0${node.ownRangeHash}`;
    const thBucket = byTitleAndHash.get(thKey);
    if (thBucket) {
      thBucket.push(node);
    } else {
      byTitleAndHash.set(thKey, [node]);
    }
  }

  // Precompute how many nodes in the same structural bucket share the exact ownRangeHash.
  const sameKeyHashCountById = new Map<string, number>();
  for (const bucket of groups.values()) {
    if (bucket.length === 1 && bucket[0]) {
      sameKeyHashCountById.set(bucket[0].id, 1);
      continue;
    }
    const counts = new Map<string, number>();
    for (const node of bucket) {
      counts.set(node.ownRangeHash, (counts.get(node.ownRangeHash) ?? 0) + 1);
    }
    for (const node of bucket) {
      sameKeyHashCountById.set(node.id, counts.get(node.ownRangeHash) ?? 1);
    }
  }

  return {
    keyById,
    groups,
    ordinalById,
    byTitleAndHash,
    sameKeyHashCountById,
  };
}

/**
 * Builds an O(N) lookup index once per `(beforeDoc, afterDoc)` transition so remapping
 * collapsed sets (even 1,000+ collapsed branches), fixed focus, and selection runs in O(N + K)
 * instead of O(K * N).
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

  const remapNodeId = (oldNodeId: string): string | null => {
    if (oldNodeId === beforeDoc.rootId) {
      return afterDoc.rootId;
    }
    const beforeNode = beforeDoc.nodes.get(oldNodeId);
    if (!beforeNode) return null;

    const key = beforeIdx.keyById.get(oldNodeId);
    const afterBucket = key !== undefined ? afterIdx.groups.get(key) : undefined;

    if (!afterBucket || afterBucket.length === 0) {
      // Fallback when a topic moved under another parent or an ancestor was renamed:
      // match iff a single node in afterDoc shares both titleRaw and exact ownRangeHash.
      const hashMatches = afterIdx.byTitleAndHash.get(
        `${beforeNode.titleRaw}\0${beforeNode.ownRangeHash}`,
      );
      if (hashMatches && hashMatches.length === 1 && hashMatches[0]) {
        return hashMatches[0].id;
      }
      return null;
    }

    if (afterBucket.length === 1 && afterBucket[0]) {
      return afterBucket[0].id;
    }

    let hashMatch: TopicNode | null = null;
    let hashMatchCount = 0;
    for (const candidate of afterBucket) {
      if (candidate.ownRangeHash === beforeNode.ownRangeHash) {
        hashMatch = candidate;
        hashMatchCount += 1;
      }
    }
    if (hashMatchCount === 1 && hashMatch !== null) {
      return hashMatch.id;
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
    const beforeSameHashCount = beforeIdx.sameKeyHashCountById.get(oldNodeId) ?? 1;

    if (!afterBucket || afterBucket.length === 0) {
      // Only follow across parent rename / move if the topic had no identical-hash sibling before
      // AND uniquely matches (titleRaw, ownRangeHash) in afterDoc.
      if (beforeSameHashCount !== 1) return null;
      const hashMatches = afterIdx.byTitleAndHash.get(
        `${beforeNode.titleRaw}\0${beforeNode.ownRangeHash}`,
      );
      if (hashMatches && hashMatches.length === 1 && hashMatches[0]) {
        return hashMatches[0].id;
      }
      return null;
    }

    if (afterBucket.length === 1 && afterBucket[0]) {
      if (beforeBucket.length === 1) {
        // Unique topic at (ancestorPath, titleRaw) before AND after -> unambiguously the same topic.
        return afterBucket[0].id;
      }
      // Multiple same-titled siblings existed before; only accept the lone survivor if the
      // original topic had a distinct hash and that exact hash survived.
      if (beforeSameHashCount === 1 && afterBucket[0].ownRangeHash === beforeNode.ownRangeHash) {
        return afterBucket[0].id;
      }
      return null;
    }

    // Multiple same-titled siblings in afterDoc: require unique ownRangeHash proof (never ordinal guess).
    if (beforeSameHashCount !== 1) return null;
    let hashMatch: TopicNode | null = null;
    let hashMatchCount = 0;
    for (const candidate of afterBucket) {
      if (candidate.ownRangeHash === beforeNode.ownRangeHash) {
        hashMatch = candidate;
        hashMatchCount += 1;
      }
    }
    return hashMatchCount === 1 && hashMatch !== null ? hashMatch.id : null;
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
