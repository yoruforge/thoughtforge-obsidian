import type { DraftEntry, MindMapDocument, TopicNode } from '../core/model';

const MAX_DRAFTS = 50;
const MAX_DRAFT_TEXT_CHARS = 64 * 1024;

export interface SaveDraftInput {
  readonly filePath: string;
  readonly field: 'title' | 'note';
  readonly targetTitleRaw: string;
  readonly targetHeaderLine?: number;
  readonly targetOwnRangeHash?: string;
  readonly targetAncestorPath?: readonly string[];
  readonly targetHadIdenticalSibling?: boolean;
  readonly baseContentHash: string;
  readonly text: string;
}

export interface DraftIdentityKey {
  readonly filePath: string;
  readonly field: 'title' | 'note';
  readonly targetTitleRaw: string;
  readonly targetHeaderLine?: number;
  readonly targetOwnRangeHash?: string;
  readonly targetAncestorPath?: readonly string[];
  readonly targetHadIdenticalSibling?: boolean;
  readonly baseContentHash?: string;
}

export type DraftResolution =
  | { readonly status: 'matched'; readonly nodeId: string }
  | { readonly status: 'ambiguous'; readonly candidateNodeIds: readonly string[] }
  | { readonly status: 'unmatched' };

function sameStringArray(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Returns the ordered title path from root down to `node`'s direct parent (excluding `node`).
 * Used to distinguish identically-titled topics under different branches even after line shifts.
 */
export function buildAncestorPath(doc: MindMapDocument, node: TopicNode): readonly string[] {
  const path: string[] = [];
  let cursor = node.parentId;
  const visited = new Set<string>([node.id]);
  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = doc.nodes.get(cursor);
    if (!parent) break;
    path.push(parent.titleRaw);
    cursor = parent.parentId;
  }
  path.reverse();
  return path;
}

/**
 * Returns true if another node in `doc` shares identical (titleRaw, ancestorPath, ownRangeHash)
 * with `node` (for example, two empty "- メモ" siblings under the same parent).
 */
export function hasIdenticalStructuralSibling(doc: MindMapDocument, node: TopicNode): boolean {
  const targetPath = buildAncestorPath(doc, node);
  for (const other of doc.nodes.values()) {
    if (other.id === node.id) continue;
    if (
      other.titleRaw === node.titleRaw &&
      other.ownRangeHash === node.ownRangeHash &&
      sameStringArray(buildAncestorPath(doc, other), targetPath)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true only when `entry` carries complete structural identity proof captured at save time
 * (ancestorPath + ownRangeHash + explicitly proven `targetHadIdenticalSibling === false`).
 * Legacy drafts (e.g. from PR #6 without `targetHadIdenticalSibling`) return false and fail closed
 * whenever the document has changed since `baseContentHash`.
 */
function hasFullCrossEditStructuralProof(entry: DraftEntry): boolean {
  return (
    entry.targetAncestorPath !== undefined &&
    entry.targetOwnRangeHash !== undefined &&
    entry.targetHadIdenticalSibling === false
  );
}

function isSameDraftTarget(entry: DraftEntry, key: DraftIdentityKey): boolean {
  if (
    entry.filePath !== key.filePath ||
    entry.field !== key.field ||
    entry.targetTitleRaw !== key.targetTitleRaw
  ) {
    return false;
  }
  if (entry.targetAncestorPath !== undefined || key.targetAncestorPath !== undefined) {
    if (!sameStringArray(entry.targetAncestorPath, key.targetAncestorPath)) {
      return false;
    }
  }
  if (entry.targetOwnRangeHash !== undefined && key.targetOwnRangeHash !== undefined) {
    if (entry.targetOwnRangeHash !== key.targetOwnRangeHash) {
      return false;
    }
  }
  if (
    (!hasFullCrossEditStructuralProof(entry) || key.targetHadIdenticalSibling === true) &&
    key.baseContentHash !== undefined &&
    entry.baseContentHash !== key.baseContentHash
  ) {
    return false;
  }
  return entry.targetHeaderLine === key.targetHeaderLine;
}

/**
 * Resolves which topic a draft belongs to in the current document using strictly fail-closed
 * structural identity checks (never guessing by nearest line number):
 * 1. Byte-identical document (`doc.contentHash === draft.baseContentHash`):
 *    - Exact `targetHeaderLine` uniquely identifies any topic (even identical empty siblings
 *      and legacy PR #6 drafts).
 *    - Legacy drafts without `targetHeaderLine` match iff the title is unique.
 * 2. Modified document (`doc.contentHash !== draft.baseContentHash`):
 *    - Requires FULL structural proof (`hasFullCrossEditStructuralProof`): exact
 *      `targetAncestorPath` AND exact `targetOwnRangeHash` matching a single topic, AND
 *      explicitly proven `targetHadIdenticalSibling === false` (legacy drafts missing this field
 *      are treated as unknown and fail closed).
 *    - Otherwise fails closed as `'ambiguous'` so a renamed/deleted sibling's draft, a legacy
 *      draft on a modified document, or a draft on an externally edited topic is NEVER auto-filled
 *      into the wrong topic or over edits; the user explicitly confirms via "Restore here".
 */
export function resolveDraftTarget(doc: MindMapDocument, draft: DraftEntry): DraftResolution {
  const candidates = [...doc.nodes.values()].filter(
    (node) => node.titleRaw === draft.targetTitleRaw,
  );

  if (candidates.length === 0) {
    return { status: 'unmatched' };
  }

  // 1. Byte-identical document since draft save
  if (doc.contentHash === draft.baseContentHash) {
    if (draft.targetHeaderLine !== undefined) {
      const exactLine = candidates.find((n) => n.headerLine === draft.targetHeaderLine);
      if (exactLine) {
        return { status: 'matched', nodeId: exactLine.id };
      }
      return {
        status: 'ambiguous',
        candidateNodeIds: candidates.map((n) => n.id),
      };
    }
    if (candidates.length === 1 && candidates[0]) {
      return { status: 'matched', nodeId: candidates[0].id };
    }
    return {
      status: 'ambiguous',
      candidateNodeIds: candidates.map((n) => n.id),
    };
  }

  // 2. Document changed since draft save: require full structural proof (fails closed on legacy drafts)
  if (!hasFullCrossEditStructuralProof(draft)) {
    const hintCandidates =
      draft.targetAncestorPath !== undefined
        ? candidates.filter((n) =>
            sameStringArray(buildAncestorPath(doc, n), draft.targetAncestorPath),
          )
        : candidates;
    return {
      status: 'ambiguous',
      candidateNodeIds: (hintCandidates.length > 0 ? hintCandidates : candidates).map((n) => n.id),
    };
  }

  const pathMatches = candidates.filter((n) =>
    sameStringArray(buildAncestorPath(doc, n), draft.targetAncestorPath),
  );
  if (pathMatches.length === 0) {
    // Original branch deleted or renamed: fail closed (never match another branch by ownRangeHash).
    return {
      status: 'ambiguous',
      candidateNodeIds: candidates.map((n) => n.id),
    };
  }

  const exactStructuralMatches = pathMatches.filter(
    (n) => n.ownRangeHash === draft.targetOwnRangeHash,
  );
  if (exactStructuralMatches.length === 1 && exactStructuralMatches[0]) {
    return { status: 'matched', nodeId: exactStructuralMatches[0].id };
  }

  // Either 0 hash matches (same-parent sibling renamed/deleted or target body externally edited)
  // or >1 hash matches (multiple identical siblings under the same parent): fail closed.
  return {
    status: 'ambiguous',
    candidateNodeIds: pathMatches.map((n) => n.id),
  };
}

/**
 * Convenience helper returning the nodeId only when `resolveDraftTarget` is unambiguously matched.
 */
export function resolveDraftNodeId(doc: MindMapDocument, draft: DraftEntry): string | null {
  const res = resolveDraftTarget(doc, draft);
  return res.status === 'matched' ? res.nodeId : null;
}

export type DraftPersistHandler = (drafts: readonly DraftEntry[]) => Promise<boolean>;

export interface SaveDraftResult {
  readonly entry: DraftEntry;
  readonly persisted: boolean;
}

function generateId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

/**
 * Persistent store for unsaved title/note drafts (`field: 'title' | 'note'`) backed by
 * `data.json` (`PluginDataV1.drafts`), ensuring user input is never silently lost when
 * a write is rejected due to dirty-editor conflict, CAS mismatch, or syntax validation.
 */
export class DraftStore {
  private drafts: DraftEntry[];
  private readonly deviceId: string;
  private readonly listeners = new Set<() => void>();
  /** Monotonic local mutation counter used so older successful writes never clear newer dirty drafts. */
  private revision = 0;
  private readonly dirtyRevisionByDraftId = new Map<string, number>();
  /** Serializes persist() calls in FIFO order so older snapshots cannot overwrite newer ones on disk. */
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    initialDrafts: readonly DraftEntry[],
    private readonly persist: DraftPersistHandler,
    deviceId?: string,
  ) {
    this.drafts = [...initialDrafts];
    this.deviceId = deviceId ?? generateId('dev');
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private enqueuePersist(snapshot: readonly DraftEntry[], snapshotRev: number): Promise<boolean> {
    const run = async (): Promise<boolean> => {
      let persisted = false;
      try {
        persisted = await this.persist(snapshot);
      } catch {
        persisted = false;
      }
      if (persisted) {
        for (const [draftId, dirtyRev] of this.dirtyRevisionByDraftId) {
          if (dirtyRev <= snapshotRev) {
            this.dirtyRevisionByDraftId.delete(draftId);
          }
        }
      }
      this.emitChange();
      return persisted;
    };

    const resultPromise = this.persistChain.then(run, run);
    this.persistChain = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    return resultPromise;
  }

  getAllDrafts(): readonly DraftEntry[] {
    return this.drafts;
  }

  getUnpersistedDraftIds(): ReadonlySet<string> {
    return new Set(this.dirtyRevisionByDraftId.keys());
  }

  isDraftPersisted(draftId: string): boolean {
    return !this.dirtyRevisionByDraftId.has(draftId);
  }

  listDraftsForFile(filePath: string): readonly DraftEntry[] {
    return this.drafts
      .filter((entry) => entry.filePath === filePath)
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  findDraft(
    filePath: string,
    field: 'title' | 'note',
    targetTitleRaw: string,
    targetHeaderLine?: number,
    targetAncestorPath?: readonly string[],
    targetOwnRangeHash?: string,
    baseContentHash?: string,
    targetHadIdenticalSibling?: boolean,
  ): DraftEntry | undefined {
    return this.drafts.find((entry) =>
      isSameDraftTarget(entry, {
        filePath,
        field,
        targetTitleRaw,
        targetHeaderLine,
        targetOwnRangeHash,
        targetAncestorPath,
        targetHadIdenticalSibling,
        baseContentHash,
      }),
    );
  }

  async saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
    const clampedText =
      input.text.length > MAX_DRAFT_TEXT_CHARS
        ? input.text.slice(0, MAX_DRAFT_TEXT_CHARS)
        : input.text;

    const existingIndex = this.drafts.findIndex((entry) =>
      isSameDraftTarget(entry, {
        filePath: input.filePath,
        field: input.field,
        targetTitleRaw: input.targetTitleRaw,
        targetHeaderLine: input.targetHeaderLine,
        targetOwnRangeHash: input.targetOwnRangeHash,
        targetAncestorPath: input.targetAncestorPath,
        targetHadIdenticalSibling: input.targetHadIdenticalSibling,
        baseContentHash: input.baseContentHash,
      }),
    );

    const nextEntry: DraftEntry = {
      draftId:
        existingIndex >= 0
          ? (this.drafts[existingIndex]?.draftId ?? generateId('draft'))
          : generateId('draft'),
      deviceId: this.deviceId,
      filePath: input.filePath,
      field: input.field,
      targetTitleRaw: input.targetTitleRaw,
      ...(input.targetHeaderLine !== undefined ? { targetHeaderLine: input.targetHeaderLine } : {}),
      ...(input.targetOwnRangeHash !== undefined
        ? { targetOwnRangeHash: input.targetOwnRangeHash }
        : {}),
      ...(input.targetAncestorPath !== undefined
        ? { targetAncestorPath: [...input.targetAncestorPath] }
        : {}),
      ...(input.targetHadIdenticalSibling !== undefined
        ? { targetHadIdenticalSibling: input.targetHadIdenticalSibling }
        : {}),
      baseContentHash: input.baseContentHash,
      text: clampedText,
      savedAt: Date.now(),
    };

    const nextList = [...this.drafts];
    if (existingIndex >= 0) {
      nextList[existingIndex] = nextEntry;
    } else {
      nextList.push(nextEntry);
    }

    // Evict oldest entries if cap exceeded
    if (nextList.length > MAX_DRAFTS) {
      nextList.sort((a, b) => b.savedAt - a.savedAt);
      const evicted = nextList.slice(MAX_DRAFTS);
      nextList.length = MAX_DRAFTS;
      for (const dropped of evicted) {
        this.dirtyRevisionByDraftId.delete(dropped.draftId);
      }
    }

    this.drafts = nextList;
    this.revision += 1;
    const snapshotRev = this.revision;
    this.dirtyRevisionByDraftId.set(nextEntry.draftId, snapshotRev);
    this.emitChange();

    const persisted = await this.enqueuePersist([...this.drafts], snapshotRev);
    return { entry: nextEntry, persisted };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const nextList = this.drafts.filter((entry) => entry.draftId !== draftId);
    if (nextList.length === this.drafts.length) return;
    this.drafts = nextList;
    this.dirtyRevisionByDraftId.delete(draftId);
    this.revision += 1;
    const snapshotRev = this.revision;
    this.emitChange();
    await this.enqueuePersist([...this.drafts], snapshotRev);
  }

  async deleteMatchingDraft(
    filePath: string,
    field: 'title' | 'note',
    targetTitleRaw: string,
    targetHeaderLine?: number,
    targetAncestorPath?: readonly string[],
    targetOwnRangeHash?: string,
    baseContentHash?: string,
    targetHadIdenticalSibling?: boolean,
  ): Promise<void> {
    const existing = this.findDraft(
      filePath,
      field,
      targetTitleRaw,
      targetHeaderLine,
      targetAncestorPath,
      targetOwnRangeHash,
      baseContentHash,
      targetHadIdenticalSibling,
    );
    if (!existing) return;
    await this.deleteDraft(existing.draftId);
  }

  async renameFilePath(oldPath: string, newPath: string): Promise<void> {
    if (oldPath === newPath) return;
    let changed = false;
    const nextList = this.drafts.map((entry) => {
      if (entry.filePath !== oldPath) return entry;
      changed = true;
      return { ...entry, filePath: newPath };
    });
    if (!changed) return;
    this.drafts = nextList;
    this.revision += 1;
    const snapshotRev = this.revision;
    for (const entry of nextList) {
      if (entry.filePath === newPath) {
        this.dirtyRevisionByDraftId.set(entry.draftId, snapshotRev);
      }
    }
    this.emitChange();
    await this.enqueuePersist([...this.drafts], snapshotRev);
  }
}
