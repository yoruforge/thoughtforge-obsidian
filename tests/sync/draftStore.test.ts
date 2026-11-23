import { describe, expect, it } from 'vitest';
import type { DraftEntry } from '../../src/core/model';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  buildAncestorPath,
  DraftStore,
  hasIdenticalStructuralSibling,
  resolveDraftNodeId,
  resolveDraftTarget,
} from '../../src/sync/DraftStore';

describe('DraftStore (M2-c field:title|note persistence & fail-closed resolution)', () => {
  it('saves, upserts, finds, deletes, and renames drafts while persisting snapshots', async () => {
    const persistedSnapshots: Array<readonly DraftEntry[]> = [];
    const store = new DraftStore(
      [],
      async (drafts) => {
        persistedSnapshots.push([...drafts]);
      },
      'dev-test',
    );

    // Save a note draft
    const d1 = await store.saveDraft({
      filePath: 'notes/a.md',
      field: 'note',
      targetTitleRaw: 'Topic A',
      targetHeaderLine: 2,
      targetAncestorPath: ['Root'],
      baseContentHash: 'hash1',
      text: 'Unsaved paragraph 1',
    });
    expect(d1.field).toBe('note');
    expect(d1.deviceId).toBe('dev-test');
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(1);

    // Upsert same (filePath, field, targetTitleRaw, ancestorPath, headerLine) updates text
    const d1Updated = await store.saveDraft({
      filePath: 'notes/a.md',
      field: 'note',
      targetTitleRaw: 'Topic A',
      targetHeaderLine: 2,
      targetAncestorPath: ['Root'],
      baseContentHash: 'hash2',
      text: 'Unsaved paragraph 2',
    });
    expect(d1Updated.draftId).toBe(d1.draftId);
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(1);
    expect(store.findDraft('notes/a.md', 'note', 'Topic A', 2, ['Root'])?.text).toBe(
      'Unsaved paragraph 2',
    );

    // Separate field:'title' draft on same topic coexists cleanly
    const dTitle = await store.saveDraft({
      filePath: 'notes/a.md',
      field: 'title',
      targetTitleRaw: 'Topic A',
      targetHeaderLine: 2,
      targetAncestorPath: ['Root'],
      baseContentHash: 'hash2',
      text: 'Rescued Title',
    });
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(2);
    expect(store.findDraft('notes/a.md', 'title', 'Topic A', 2, ['Root'])?.text).toBe(
      'Rescued Title',
    );

    // Rename file updates draft paths
    await store.renameFilePath('notes/a.md', 'notes/renamed.md');
    expect(store.listDraftsForFile('notes/a.md')).toHaveLength(0);
    expect(store.listDraftsForFile('notes/renamed.md')).toHaveLength(2);

    // Delete matching note draft leaves title draft intact
    await store.deleteMatchingDraft('notes/renamed.md', 'note', 'Topic A', 2, ['Root']);
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

  it('never mis-binds B draft to A when blank lines shift A onto B original line (PR #6 P1-1 regression)', async () => {
    const initialMd = [
      '# Root',
      '## A',
      '- メモ',
      '  A body',
      '## B',
      '- メモ',
      '  B body',
      '',
    ].join('\n');
    const parsedInitial = parseMarkdownToMap(initialMd, 'Root');
    if (parsedInitial.status !== 'ok') throw new Error('parse failed');
    const initialDoc = parsedInitial.document;

    const initialMemos = [...initialDoc.nodes.values()].filter((n) => n.titleRaw === 'メモ');
    expect(initialMemos).toHaveLength(2);
    const [memoA0, memoB0] = initialMemos;
    if (!memoA0 || !memoB0) throw new Error('missing memos');
    expect(memoA0.headerLine).toBe(2);
    expect(memoB0.headerLine).toBe(5);

    const store = new DraftStore([], async () => undefined, 'dev-p1');
    const draftB = await store.saveDraft({
      filePath: 'notes/p1.md',
      field: 'note',
      targetTitleRaw: memoB0.titleRaw,
      targetHeaderLine: memoB0.headerLine,
      targetOwnRangeHash: memoB0.ownRangeHash,
      targetAncestorPath: buildAncestorPath(initialDoc, memoB0),
      baseContentHash: initialDoc.contentHash,
      text: 'B draft text',
    });

    // Insert 3 blank lines before ## A so A's メモ moves to line 5 (where B's メモ used to live!)
    const shiftedMd = [
      '# Root',
      '',
      '',
      '',
      '## A',
      '- メモ',
      '  A body',
      '## B',
      '- メモ',
      '  B body',
      '',
    ].join('\n');
    const parsedShifted = parseMarkdownToMap(shiftedMd, 'Root');
    if (parsedShifted.status !== 'ok') throw new Error('shifted parse failed');
    const shiftedDoc = parsedShifted.document;
    const shiftedMemos = [...shiftedDoc.nodes.values()].filter((n) => n.titleRaw === 'メモ');
    const [memoA1, memoB1] = shiftedMemos;
    if (!memoA1 || !memoB1) throw new Error('missing shifted memos');
    expect(memoA1.headerLine).toBe(5);
    expect(memoB1.headerLine).toBe(8);

    // Draft for B must still bind ONLY to B's メモ, never to A's メモ now sitting on line 5
    expect(resolveDraftTarget(shiftedDoc, draftB)).toEqual({
      status: 'matched',
      nodeId: memoB1.id,
    });
    expect(resolveDraftNodeId(shiftedDoc, draftB)).toBe(memoB1.id);

    // Saving A's メモ on line 5 must NOT delete B's draft
    await store.deleteMatchingDraft(
      'notes/p1.md',
      'note',
      'メモ',
      memoA1.headerLine,
      buildAncestorPath(shiftedDoc, memoA1),
    );
    expect(store.listDraftsForFile('notes/p1.md')).toHaveLength(1);
    expect(store.listDraftsForFile('notes/p1.md')[0]?.draftId).toBe(draftB.draftId);
  });

  it('fails closed as ambiguous when identical siblings under the same parent shift lines or legacy drafts lack structural identity', () => {
    // 1. Two identical empty "- メモ" under the same parent ## A, shifted by blank lines
    const beforeMd = '# Root\n## A\n- メモ\n- メモ\n';
    const afterMd = '# Root\n\n\n## A\n- メモ\n- メモ\n';
    const parsedBefore = parseMarkdownToMap(beforeMd, 'Root');
    const parsedAfter = parseMarkdownToMap(afterMd, 'Root');
    if (parsedBefore.status !== 'ok' || parsedAfter.status !== 'ok') {
      throw new Error('parse failed');
    }
    const secondBefore = [...parsedBefore.document.nodes.values()].filter(
      (n) => n.titleRaw === 'メモ',
    )[1];
    if (!secondBefore) throw new Error('missing second memo');

    const identicalSibDraft: DraftEntry = {
      draftId: 'd-same-parent',
      deviceId: 'dev',
      filePath: 'notes/dup.md',
      field: 'note',
      targetTitleRaw: 'メモ',
      targetHeaderLine: secondBefore.headerLine,
      targetOwnRangeHash: secondBefore.ownRangeHash,
      targetAncestorPath: buildAncestorPath(parsedBefore.document, secondBefore),
      baseContentHash: parsedBefore.document.contentHash,
      text: 'needs confirmation',
      savedAt: 1,
    };

    // Unchanged document matches by exact contentHash + headerLine
    expect(resolveDraftTarget(parsedBefore.document, identicalSibDraft)).toEqual({
      status: 'matched',
      nodeId: secondBefore.id,
    });

    // After blank lines shift positions, both siblings share ancestorPath & ownRangeHash -> MUST fail closed as ambiguous!
    const shiftedRes = resolveDraftTarget(parsedAfter.document, identicalSibDraft);
    expect(shiftedRes.status).toBe('ambiguous');
    if (shiftedRes.status === 'ambiguous') {
      expect(shiftedRes.candidateNodeIds).toHaveLength(2);
    }
    expect(resolveDraftNodeId(parsedAfter.document, identicalSibDraft)).toBeNull();

    // 2. Deleted topic with IDENTICAL empty raw text (same ownRangeHash!) under branch A
    //    must NOT auto-attach to surviving empty メモ under branch B (single or multi candidate)
    const onlyEmptyBMd = '# Root\n## B\n- メモ\n';
    const parsedOnlyEmptyB = parseMarkdownToMap(onlyEmptyBMd, 'Root');
    if (parsedOnlyEmptyB.status !== 'ok') throw new Error('parse failed');
    const survivingEmptyB = [...parsedOnlyEmptyB.document.nodes.values()].find(
      (n) => n.titleRaw === 'メモ',
    );
    if (!survivingEmptyB) throw new Error('missing surviving empty B');
    const draftForDeletedEmptyA: DraftEntry = {
      draftId: 'd-deleted-empty-a',
      deviceId: 'dev',
      filePath: 'notes/dup.md',
      field: 'note',
      targetTitleRaw: 'メモ',
      targetHeaderLine: 2,
      targetOwnRangeHash: survivingEmptyB.ownRangeHash, // Identical ownRangeHash!
      targetAncestorPath: ['Root', 'A'],
      baseContentHash: 'old-hash',
      text: 'A draft',
      savedAt: 1,
    };
    expect(resolveDraftTarget(parsedOnlyEmptyB.document, draftForDeletedEmptyA).status).toBe(
      'ambiguous',
    );
    expect(resolveDraftNodeId(parsedOnlyEmptyB.document, draftForDeletedEmptyA)).toBeNull();

    // Multi-candidate variant: A deleted, B (empty, same ownRangeHash) and C (non-empty) survive
    const survivingBCMd = '# Root\n## B\n- メモ\n## C\n- メモ\n  C body\n';
    const parsedBC = parseMarkdownToMap(survivingBCMd, 'Root');
    if (parsedBC.status !== 'ok') throw new Error('parse failed');
    expect(resolveDraftTarget(parsedBC.document, draftForDeletedEmptyA).status).toBe('ambiguous');
    expect(resolveDraftNodeId(parsedBC.document, draftForDeletedEmptyA)).toBeNull();

    // 3. Legacy draft without ancestorPath/ownRangeHash on duplicate titles -> ambiguous
    const legacy: DraftEntry = {
      draftId: 'd-legacy',
      deviceId: 'dev',
      filePath: 'notes/dup.md',
      field: 'title',
      targetTitleRaw: 'メモ',
      targetHeaderLine: 3,
      baseContentHash: 'stale-hash',
      text: 'x',
      savedAt: 1,
    };
    expect(resolveDraftTarget(parsedAfter.document, legacy).status).toBe('ambiguous');
    expect(resolveDraftNodeId(parsedAfter.document, legacy)).toBeNull();
  });

  it('fails closed when a same-parent duplicate sibling is renamed/deleted or target body changes externally', async () => {
    // 1. Codex P1 repro: two "メモ" under the same parent with distinct bodies; 2nd is renamed to "別名"
    const beforeMd = [
      '# Root',
      '## Parent',
      '- メモ',
      '  Body 1',
      '- メモ',
      '  Body 2',
      '',
    ].join('\n');
    const parsedBefore = parseMarkdownToMap(beforeMd, 'Root');
    if (parsedBefore.status !== 'ok') throw new Error('parse failed');
    const beforeMemos = [...parsedBefore.document.nodes.values()].filter(
      (n) => n.titleRaw === 'メモ',
    );
    expect(beforeMemos).toHaveLength(2);
    const [memo1Before, memo2Before] = beforeMemos;
    if (!memo1Before || !memo2Before) throw new Error('missing memos');
    expect(hasIdenticalStructuralSibling(parsedBefore.document, memo2Before)).toBe(false);

    const store = new DraftStore([], async () => undefined, 'dev-same-parent');
    const draft2 = await store.saveDraft({
      filePath: 'notes/same-parent.md',
      field: 'note',
      targetTitleRaw: memo2Before.titleRaw,
      targetHeaderLine: memo2Before.headerLine,
      targetOwnRangeHash: memo2Before.ownRangeHash,
      targetAncestorPath: buildAncestorPath(parsedBefore.document, memo2Before),
      targetHadIdenticalSibling: hasIdenticalStructuralSibling(parsedBefore.document, memo2Before),
      baseContentHash: parsedBefore.document.contentHash,
      text: 'Draft for 2nd memo',
    });

    // Positive check: inserting blank lines above Parent (without touching either メモ) still uniquely matches 2nd メモ
    const blankShiftedMd = [
      '# Root',
      '',
      '',
      '## Parent',
      '- メモ',
      '  Body 1',
      '- メモ',
      '  Body 2',
      '',
    ].join('\n');
    const parsedBlankShifted = parseMarkdownToMap(blankShiftedMd, 'Root');
    if (parsedBlankShifted.status !== 'ok') throw new Error('parse failed');
    const shiftedMemo2 = [...parsedBlankShifted.document.nodes.values()].filter(
      (n) => n.titleRaw === 'メモ',
    )[1];
    if (!shiftedMemo2) throw new Error('missing shifted memo2');
    expect(resolveDraftTarget(parsedBlankShifted.document, draft2)).toEqual({
      status: 'matched',
      nodeId: shiftedMemo2.id,
    });

    // Rename 2nd メモ -> 別名 AND add blank lines so 1st メモ even shifts onto 2nd メモ's original headerLine (4)
    const renamedMd = [
      '# Root',
      '',
      '',
      '## Parent',
      '- メモ',
      '  Body 1',
      '- 別名',
      '  Body 2',
      '',
    ].join('\n');
    const parsedRenamed = parseMarkdownToMap(renamedMd, 'Root');
    if (parsedRenamed.status !== 'ok') throw new Error('parse failed');
    const survivingMemo1 = [...parsedRenamed.document.nodes.values()].find(
      (n) => n.titleRaw === 'メモ',
    );
    if (!survivingMemo1) throw new Error('missing surviving memo1');
    expect(survivingMemo1.headerLine).toBe(memo2Before.headerLine); // Same line 4!

    // MUST fail closed as ambiguous (never auto-fill into surviving 1st メモ!)
    expect(resolveDraftTarget(parsedRenamed.document, draft2)).toEqual({
      status: 'ambiguous',
      candidateNodeIds: [survivingMemo1.id],
    });
    expect(resolveDraftNodeId(parsedRenamed.document, draft2)).toBeNull();

    // Saving 1st メモ (even on the exact shifted line 4!) MUST NOT delete 2nd メモ's draft
    await store.deleteMatchingDraft(
      'notes/same-parent.md',
      'note',
      survivingMemo1.titleRaw,
      survivingMemo1.headerLine,
      buildAncestorPath(parsedRenamed.document, survivingMemo1),
      survivingMemo1.ownRangeHash,
      parsedRenamed.document.contentHash,
    );
    expect(store.listDraftsForFile('notes/same-parent.md')).toHaveLength(1);
    expect(store.listDraftsForFile('notes/same-parent.md')[0]?.draftId).toBe(draft2.draftId);

    // 2. Multi-branch variant: another branch B also has a メモ, while A's 2nd メモ is renamed
    const multiBranchRenamedMd = [
      '# Root',
      '## Parent',
      '- メモ',
      '  Body 1',
      '- 別名',
      '  Body 2',
      '## Other',
      '- メモ',
      '  Other body',
      '',
    ].join('\n');
    const parsedMultiRenamed = parseMarkdownToMap(multiBranchRenamedMd, 'Root');
    if (parsedMultiRenamed.status !== 'ok') throw new Error('parse failed');
    const parentMemo1 = [...parsedMultiRenamed.document.nodes.values()].find(
      (n) =>
        n.titleRaw === 'メモ' &&
        buildAncestorPath(parsedMultiRenamed.document, n).join('/') === 'Root/Parent',
    );
    if (!parentMemo1) throw new Error('missing parentMemo1');
    expect(resolveDraftTarget(parsedMultiRenamed.document, draft2)).toEqual({
      status: 'ambiguous',
      candidateNodeIds: [parentMemo1.id],
    });

    // 3. Identical EMPTY siblings under same parent (same ownRangeHash!): 2nd renamed -> still ambiguous!
    const emptyTwinBefore = '# Root\n## Parent\n- メモ\n- メモ\n';
    const parsedEmptyBefore = parseMarkdownToMap(emptyTwinBefore, 'Root');
    if (parsedEmptyBefore.status !== 'ok') throw new Error('parse failed');
    const emptySecond = [...parsedEmptyBefore.document.nodes.values()].filter(
      (n) => n.titleRaw === 'メモ',
    )[1];
    if (!emptySecond) throw new Error('missing emptySecond');
    expect(hasIdenticalStructuralSibling(parsedEmptyBefore.document, emptySecond)).toBe(true);

    const emptyDraft = await store.saveDraft({
      filePath: 'notes/empty-twins.md',
      field: 'note',
      targetTitleRaw: emptySecond.titleRaw,
      targetHeaderLine: emptySecond.headerLine,
      targetOwnRangeHash: emptySecond.ownRangeHash,
      targetAncestorPath: buildAncestorPath(parsedEmptyBefore.document, emptySecond),
      targetHadIdenticalSibling: hasIdenticalStructuralSibling(
        parsedEmptyBefore.document,
        emptySecond,
      ),
      baseContentHash: parsedEmptyBefore.document.contentHash,
      text: 'Empty 2nd memo draft',
    });

    const emptyTwinAfter = '# Root\n\n## Parent\n- メモ\n- 別名\n';
    const parsedEmptyAfter = parseMarkdownToMap(emptyTwinAfter, 'Root');
    if (parsedEmptyAfter.status !== 'ok') throw new Error('parse failed');
    const emptySurviving = [...parsedEmptyAfter.document.nodes.values()].find(
      (n) => n.titleRaw === 'メモ',
    );
    if (!emptySurviving) throw new Error('missing emptySurviving');
    expect(emptySurviving.headerLine).toBe(emptySecond.headerLine); // Shifted onto line 3!
    expect(resolveDraftTarget(parsedEmptyAfter.document, emptyDraft)).toEqual({
      status: 'ambiguous',
      candidateNodeIds: [emptySurviving.id],
    });
    // Saving surviving empty メモ on shifted line 3 must NOT delete empty 2nd メモ's draft
    await store.deleteMatchingDraft(
      'notes/empty-twins.md',
      'note',
      emptySurviving.titleRaw,
      emptySurviving.headerLine,
      buildAncestorPath(parsedEmptyAfter.document, emptySurviving),
      emptySurviving.ownRangeHash,
      parsedEmptyAfter.document.contentHash,
    );
    expect(store.listDraftsForFile('notes/empty-twins.md')).toHaveLength(1);

    // 4. Target topic's own body externally modified -> fail closed to ambiguous (don't clobber external edit)
    const editedBefore = '# Root\n## Unique\nOriginal body\n';
    const editedAfter = '# Root\n## Unique\nExternally edited on mobile\n';
    const pEditBefore = parseMarkdownToMap(editedBefore, 'Root');
    const pEditAfter = parseMarkdownToMap(editedAfter, 'Root');
    if (pEditBefore.status !== 'ok' || pEditAfter.status !== 'ok') throw new Error('parse failed');
    const uniqueBefore = [...pEditBefore.document.nodes.values()].find(
      (n) => n.titleRaw === 'Unique',
    );
    const uniqueAfter = [...pEditAfter.document.nodes.values()].find(
      (n) => n.titleRaw === 'Unique',
    );
    if (!uniqueBefore || !uniqueAfter) throw new Error('missing unique');
    const uniqueDraft: DraftEntry = {
      draftId: 'd-unique-external',
      deviceId: 'dev',
      filePath: 'notes/u.md',
      field: 'note',
      targetTitleRaw: 'Unique',
      targetHeaderLine: uniqueBefore.headerLine,
      targetOwnRangeHash: uniqueBefore.ownRangeHash,
      targetAncestorPath: buildAncestorPath(pEditBefore.document, uniqueBefore),
      targetHadIdenticalSibling: false,
      baseContentHash: pEditBefore.document.contentHash,
      text: 'Stale draft',
      savedAt: 1,
    };
    expect(resolveDraftTarget(pEditAfter.document, uniqueDraft)).toEqual({
      status: 'ambiguous',
      candidateNodeIds: [uniqueAfter.id],
    });
  });
});
