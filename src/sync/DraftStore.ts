import type { DraftEntry } from '../core/model';

const MAX_DRAFTS = 50;
const MAX_DRAFT_TEXT_CHARS = 64 * 1024;

export interface SaveDraftInput {
  readonly filePath: string;
  readonly field: 'title' | 'note';
  readonly targetTitleRaw: string;
  readonly baseContentHash: string;
  readonly text: string;
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
  ): DraftEntry | undefined {
    return this.drafts.find(
      (entry) =>
        entry.filePath === filePath &&
        entry.field === field &&
        entry.targetTitleRaw === targetTitleRaw,
    );
  }

  async saveDraft(input: SaveDraftInput): Promise<DraftEntry> {
    const clampedText =
      input.text.length > MAX_DRAFT_TEXT_CHARS
        ? input.text.slice(0, MAX_DRAFT_TEXT_CHARS)
        : input.text;

    const existingIndex = this.drafts.findIndex(
      (entry) =>
        entry.filePath === input.filePath &&
        entry.field === input.field &&
        entry.targetTitleRaw === input.targetTitleRaw,
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
  ): Promise<void> {
    const existing = this.findDraft(filePath, field, targetTitleRaw);
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
