import { describe, expect, it } from 'vitest';
import type { DraftEntry } from '../../src/core/model';
import { DraftStore } from '../../src/sync/DraftStore';

describe('DraftStore (M2-c field:title|note persistence & recovery)', () => {
  it('saves, upserts, finds, deletes, and renames drafts while persisting snapshots', async () => {
    const persistedSnapshots: Array<readonly DraftEntry[]> = [];
    const store = new DraftStore([], async (drafts) => {
      persistedSnapshots.push([...drafts]);
    }, 'dev-test');

    // Save a note draft
    const d1 = await store.saveDraft({
      filePath: 'notes/a.md',
      field: 'note',
      targetTitleRaw: 'Topic A',
      baseContentHash: 'hash1',
      text: 'Unsaved paragraph 1',
    });
    expect(d1.field).toBe('note');
    expect(d1.deviceId).toBe('dev-test');
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(1);

    // Upsert same (filePath, field, targetTitleRaw) preserves draftId and updates text
    const d1Updated = await store.saveDraft({
      filePath: 'notes/a.md',
      field: 'note',
      targetTitleRaw: 'Topic A',
      baseContentHash: 'hash2',
      text: 'Unsaved paragraph 2',
    });
    expect(d1Updated.draftId).toBe(d1.draftId);
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(1);
    expect(store.findDraft('notes/a.md', 'note', 'Topic A')?.text).toBe('Unsaved paragraph 2');

    // Separate field:'title' draft on same topic coexists cleanly
    const dTitle = await store.saveDraft({
      filePath: 'notes/a.md',
      field: 'title',
      targetTitleRaw: 'Topic A',
      baseContentHash: 'hash2',
      text: 'Rescued Title',
    });
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(2);
    expect(store.findDraft('notes/a.md', 'title', 'Topic A')?.text).toBe('Rescued Title');

    // Rename file updates draft paths
    await store.renameFilePath('notes/a.md', 'notes/renamed.md');
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(0);
    expect(store.listDraftsForFile('notes/renamed.md')).toHaveLength(2);

    // Delete matching note draft leaves title draft intact
    await store.deleteMatchingDraft('notes/renamed.md', 'note', 'Topic A');
    expect(store.listDraftsForFile('notes/renamed.md')).toHaveLength(1);

    // Delete by draftId clears remaining draft
    await store.deleteDraft(dTitle.draftId);
    expect(store.listDraftsForFile('notes/renamed.md')).toHaveLength(0);
    expect(persistedSnapshots.length).toBeGreaterThanOrEqual(5);
  });

  it('caps stored drafts at 50 entries and truncates oversized text at 64 KB', async () => {
    const store = new DraftStore([], async () => undefined, 'dev-cap');
    for (let i = 0; i < 55; i += 1) {
      await store.saveDraft({
        filePath: 'notes/many.md',
        field: 'note',
        targetTitleRaw: `Topic ${i}`,
        baseContentHash: 'h',
        text: `Draft ${i}`,
      });
    }
    expect(store.getAllDrafts().length).toBe(50);

    const huge = 'x'.repeat(70 * 1024);
    const saved = await store.saveDraft({
      filePath: 'notes/huge.md',
      field: 'note',
      targetTitleRaw: 'Big',
      baseContentHash: 'h',
      text: huge,
    });
    expect(saved.text.length).toBe(64 * 1024);
  });
});
