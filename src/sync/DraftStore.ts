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
  readonly baseContentHash: string;
  readonly text: string;
}

export interface DraftIdentityKey {
  readonly filePath: string;
  readonly field: 'title' | 'note';
  readonly targetTitleRaw: string;
  readonly targetHeaderLine?: number;
  readonly targetAncestorPath?: readonly string[];
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
  return entry.targetHeaderLine === key.targetHeaderLine;
}

/**
 * Resolves which topic a draft belongs to in the current document using strictly fail-closed
 * structural identity checks (never guessing by nearest line number):
 * - Single candidate: matched only when ancestor path agrees (or is absent on legacy drafts);
 *   if ancestor path differs (e.g. original branch deleted or renamed), marked 'ambiguous' so a
 *   deleted branch's draft is never auto-filled into a surviving identically-titled topic even
 *   when both topics had identical empty raw text (`ownRangeHash`).
 * - Multiple same-titled candidates:
 *   1. Exact unchanged document hash + exact saved headerLine -> matched
 *   2. Exact ancestorPath filter:
 *      - 0 matches -> 'ambiguous' immediately (never fall back to ownRangeHash across branches)
 *      - 1 match -> 'matched'
 *      - >1 matches (same-parent siblings) -> narrow by exact ownRangeHash within pathMatches only
 *   3. Otherwise -> 'ambiguous' (user explicitly confirms restore target; never auto-filled).
 */
export function resolveDraftTarget(doc: MindMapDocument, draft: DraftEntry): DraftResolution {
  const candidates = [...doc.nodes.values()].filter(
    (node) => node.titleRaw === draft.targetTitleRaw,
  );

  if (candidates.length === 0) {
    return { status: 'unmatched' };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    if (!only) return { status: 'unmatched' };
    if (draft.targetAncestorPath !== undefined) {
      const actualPath = buildAncestorPath(doc, only);
      if (sameStringArray(actualPath, draft.targetAncestorPath)) {
        return { status: 'matched', nodeId: only.id };
      }
      // Surviving topic lives under a different branch than where the draft was created:
      // fail closed and require explicit user confirmation instead of auto-filling.
      return { status: 'ambiguous', candidateNodeIds: [only.id] };
    }
    return { status: 'matched', nodeId: only.id };
  }

  // Multiple topics share targetTitleRaw:
  // 1. Byte-identical document since draft save + exact header line -> unambiguous
  if (doc.contentHash === draft.baseContentHash && draft.targetHeaderLine !== undefined) {
    const exactLineMatches = candidates.filter((n) => n.headerLine === draft.targetHeaderLine);
    if (exactLineMatches.length === 1 && exactLineMatches[0]) {
      return { status: 'matched', nodeId: exactLineMatches[0].id };
    }
  }

  // 2. Narrow strictly by ancestor path (immune to blank-line / line-number shifts above)
  if (draft.targetAncestorPath !== undefined) {
    const pathMatches = candidates.filter((n) =>
      sameStringArray(buildAncestorPath(doc, n), draft.targetAncestorPath),
    );
    if (pathMatches.length === 1 && pathMatches[0]) {
      return { status: 'matched', nodeId: pathMatches[0].id };
    }
    if (pathMatches.length === 0) {
      // Original branch no longer matches any candidate (deleted/renamed):
      // fail closed rather than matching a different branch by ownRangeHash.
      return {
        status: 'ambiguous',
        candidateNodeIds: candidates.map((n) => n.id),
      };
    }
    // 3. Multiple same-titled siblings under the SAME parent:
    // narrow by exact ownRangeHash within `pathMatches` only.
    if (draft.targetOwnRangeHash !== undefined) {
      const hashMatches = pathMatches.filter((n) => n.ownRangeHash === draft.targetOwnRangeHash);
      if (hashMatches.length === 1 && hashMatches[0]) {
        return { status: 'matched', nodeId: hashMatches[0].id };
      }
    }
    return {
      status: 'ambiguous',
      candidateNodeIds: pathMatches.map((n) => n.id),
    };
  }

  // 4. Legacy draft without ancestorPath on duplicate titles -> fail closed
  return {
    status: 'ambiguous',
    candidateNodeIds: candidates.map((n) => n.id),
  };
}

/**
 * Convenience helper returning the nodeId only when `resolveDraftTarget` is unambiguously matched.
 */
export function resolveDraftNodeId(doc: MindMapDocument, draft: DraftEntry): string | null {
  const res = resolveDraftTarget(doc, draft);
  return res.status === 'matched' ? res.nodeId : null;
}

export type DraftPersistHandler = (drafts: readonly DraftEntry[]) => Promise<void>;

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

  getAllDrafts(): readonly DraftEntry[] {
    return this.drafts;
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
  ): DraftEntry | undefined {
    return this.drafts.find((entry) =>
      isSameDraftTarget(entry, {
        filePath,
        field,
        targetTitleRaw,
        targetHeaderLine,
        targetAncestorPath,
      }),
    );
  }

  async saveDraft(input: SaveDraftInput): Promise<DraftEntry> {
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
        targetAncestorPath: input.targetAncestorPath,
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
      nextList.length = MAX_DRAFTS;
    }

    this.drafts = nextList;
    this.emitChange();
    await this.persist(this.drafts);
    return nextEntry;
  }

  async deleteDraft(draftId: string): Promise<void> {
    const nextList = this.drafts.filter((entry) => entry.draftId !== draftId);
    if (nextList.length === this.drafts.length) return;
    this.drafts = nextList;
    this.emitChange();
    await this.persist(this.drafts);
  }

  async deleteMatchingDraft(
    filePath: string,
    field: 'title' | 'note',
    targetTitleRaw: string,
    targetHeaderLine?: number,
    targetAncestorPath?: readonly string[],
  ): Promise<void> {
    const existing = this.findDraft(
      filePath,
      field,
      targetTitleRaw,
      targetHeaderLine,
      targetAncestorPath,
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
    this.emitChange();
    await this.persist(this.drafts);
  }
}
