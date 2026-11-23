import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  createDocumentRemapIndex,
  remapFocusMode,
  remapNodeIdAcrossDocuments,
  remapNodeIdSet,
} from '../../src/core/view/viewStateRemap';

function parseOk(md: string) {
  const res = parseMarkdownToMap(md, 'Root');
  if (res.status !== 'ok') throw new Error(`parse failed: ${res.detail}`);
  return res.document;
}

describe('viewStateRemap (O(N) index, view state, and strict selection remap)', () => {
  it('remaps collapsed branch IDs and fixed focus anchor when preceding insertions shift n-* IDs', () => {
    const beforeDoc = parseOk('# Root\n## A\n## B\n- B child\n');
    const afterDoc = parseOk('# Root\n## A\n- New child\n## B\n- B child\n');

    const beforeB = [...beforeDoc.nodes.values()].find((n) => n.titleRaw === 'B');
    const afterB = [...afterDoc.nodes.values()].find((n) => n.titleRaw === 'B');
    expect(beforeB).toBeDefined();
    expect(afterB).toBeDefined();
    if (!beforeB || !afterB) return;
    expect(beforeB.id).not.toBe(afterB.id);

    const remappedCollapsed = remapNodeIdSet(beforeDoc, afterDoc, new Set([beforeB.id]));
    expect([...remappedCollapsed]).toEqual([afterB.id]);

    const remappedFocus = remapFocusMode(beforeDoc, afterDoc, {
      kind: 'fixed',
      anchorId: beforeB.id,
    });
    expect(remappedFocus).toEqual({ kind: 'fixed', anchorId: afterB.id });
  });

  it('remaps active selection to the true topic and fails closed (null) when unresolved', () => {
    // 1. Codex P1 repro: A, B (B selected) -> external insert Z before A -> B stays selected (NOT A!)
    const beforeDoc = parseOk('# Root\n- A\n- B\n');
    const afterInsertDoc = parseOk('# Root\n- Z\n- A\n- B\n');
    const beforeB = [...beforeDoc.nodes.values()].find((n) => n.titleRaw === 'B');
    const afterB = [...afterInsertDoc.nodes.values()].find((n) => n.titleRaw === 'B');
    expect(beforeB).toBeDefined();
    expect(afterB).toBeDefined();
    if (!beforeB || !afterB) return;
    expect(beforeB.id).not.toBe(afterB.id);

    const idxInsert = createDocumentRemapIndex(beforeDoc, afterInsertDoc);
    expect(idxInsert.remapSelectedNodeId(beforeB.id)).toBe(afterB.id);

    // 2. Selected topic renamed/deleted externally -> returns null so Delete is blocked!
    const afterRenameDoc = parseOk('# Root\n- A\n- B renamed\n');
    const idxRename = createDocumentRemapIndex(beforeDoc, afterRenameDoc);
    expect(idxRename.remapSelectedNodeId(beforeB.id)).toBeNull();

    // 3. Same-parent duplicate siblings: 2nd selected, then renamed -> MUST NOT map to surviving 1st!
    const dupBefore = parseOk('# Root\n## P\n- メモ\n  Body 1\n- メモ\n  Body 2\n');
    const dupAfter = parseOk('# Root\n## P\n- メモ\n  Body 1\n- 別名\n  Body 2\n');
    const secondBefore = [...dupBefore.nodes.values()].filter((n) => n.titleRaw === 'メモ')[1];
    expect(secondBefore).toBeDefined();
    if (!secondBefore) return;
    expect(createDocumentRemapIndex(dupBefore, dupAfter).remapSelectedNodeId(secondBefore.id)).toBeNull();

    // 4. Identical empty twins under same parent: 2nd selected, then renamed -> MUST NOT map to 1st!
    const twinBefore = parseOk('# Root\n## P\n- メモ\n- メモ\n');
    const twinAfter = parseOk('# Root\n## P\n- メモ\n- 別名\n');
    const twinSecond = [...twinBefore.nodes.values()].filter((n) => n.titleRaw === 'メモ')[1];
    expect(twinSecond).toBeDefined();
    if (!twinSecond) return;
    expect(createDocumentRemapIndex(twinBefore, twinAfter).remapSelectedNodeId(twinSecond.id)).toBeNull();

    // 5. Codex PR #12 P1-1 repro: A and B each have an identical "- メモ"; A's is selected then deleted ->
    //    MUST NOT jump selection (or collapse state) onto B's surviving identical "- メモ"!
    const crossBefore = parseOk('# Root\n## A\n- メモ\n## B\n- メモ\n');
    const crossAfter = parseOk('# Root\n## A\n## B\n- メモ\n');
    const memoABefore = [...crossBefore.nodes.values()].filter((n) => n.titleRaw === 'メモ')[0];
    expect(memoABefore).toBeDefined();
    if (!memoABefore) return;
    const crossIndex = createDocumentRemapIndex(crossBefore, crossAfter);
    expect(crossIndex.remapSelectedNodeId(memoABefore.id)).toBeNull();
    expect(crossIndex.remapNodeId(memoABefore.id)).toBeNull();
  });

  it('clears fixed focus and drops collapsed entry cleanly when the anchored node is deleted', () => {
    const beforeDoc = parseOk('# Root\n## A\n## B\n- B child\n');
    const afterDoc = parseOk('# Root\n## A\n');

    const beforeB = [...beforeDoc.nodes.values()].find((n) => n.titleRaw === 'B');
    expect(beforeB).toBeDefined();
    if (!beforeB) return;

    expect(remapNodeIdAcrossDocuments(beforeDoc, afterDoc, beforeB.id)).toBeNull();
    expect(remapNodeIdSet(beforeDoc, afterDoc, new Set([beforeB.id])).size).toBe(0);
    expect(remapFocusMode(beforeDoc, afterDoc, { kind: 'fixed', anchorId: beforeB.id })).toEqual({
      kind: 'off',
    });
  });

  it('preserves collapsed state when a branch is reparented under another parent with identical ownRangeHash', () => {
    const beforeDoc = parseOk('# Root\n## A\n## B\n- Sub\n  - Leaf\n');
    const afterDoc = parseOk('# Root\n## A\n- Sub\n  - Leaf\n## B\n');

    const beforeSub = [...beforeDoc.nodes.values()].find((n) => n.titleRaw === 'Sub');
    const afterSub = [...afterDoc.nodes.values()].find((n) => n.titleRaw === 'Sub');
    expect(beforeSub).toBeDefined();
    expect(afterSub).toBeDefined();
    if (!beforeSub || !afterSub) return;

    expect(remapNodeIdAcrossDocuments(beforeDoc, afterDoc, beforeSub.id)).toBe(afterSub.id);
  });

  it('remaps 1,000 collapsed branches across a 2,001-topic document in linear time (<100ms)', () => {
    const linesBefore = ['# Root'];
    const linesAfter = ['# Root', '## Inserted First'];
    for (let i = 0; i < 1000; i += 1) {
      linesBefore.push(`## Branch ${i}`, `- Child ${i}`);
      linesAfter.push(`## Branch ${i}`, `- Child ${i}`);
    }
    const beforeDoc = parseOk(linesBefore.join('\n') + '\n');
    const afterDoc = parseOk(linesAfter.join('\n') + '\n');
    expect(beforeDoc.nodes.size).toBe(2001);

    const collapsedBefore = new Set<string>();
    for (const node of beforeDoc.nodes.values()) {
      if (node.titleRaw.startsWith('Branch ')) {
        collapsedBefore.add(node.id);
      }
    }
    expect(collapsedBefore.size).toBe(1000);

    const t0 = performance.now();
    const index = createDocumentRemapIndex(beforeDoc, afterDoc);
    const collapsedAfter = index.remapNodeIdSet(collapsedBefore);
    const elapsedMs = performance.now() - t0;

    expect(collapsedAfter.size).toBe(1000);
    // Spot-check that Branch 0 and Branch 999 shifted cleanly onto their new IDs
    const afterB0 = [...afterDoc.nodes.values()].find((n) => n.titleRaw === 'Branch 0');
    const afterB999 = [...afterDoc.nodes.values()].find((n) => n.titleRaw === 'Branch 999');
    expect(afterB0 && collapsedAfter.has(afterB0.id)).toBe(true);
    expect(afterB999 && collapsedAfter.has(afterB999.id)).toBe(true);
    expect(elapsedMs).toBeLessThan(100);
  });

  it('stays linear O(N + K) even when 1,000 siblings under the same parent share the exact same title', () => {
    const linesBefore = ['# Root', '## SameParent'];
    const linesAfter = ['# Root', '## Inserted', '## SameParent'];
    for (let i = 0; i < 1000; i += 1) {
      linesBefore.push('- SameTitle', `  - Leaf ${i}`);
      linesAfter.push('- SameTitle', `  - Leaf ${i}`);
    }
    const beforeDoc = parseOk(linesBefore.join('\n') + '\n');
    const afterDoc = parseOk(linesAfter.join('\n') + '\n');
    const collapsedBefore = new Set<string>();
    for (const node of beforeDoc.nodes.values()) {
      if (node.titleRaw === 'SameTitle') {
        collapsedBefore.add(node.id);
      }
    }
    expect(collapsedBefore.size).toBe(1000);

    const t0 = performance.now();
    const index = createDocumentRemapIndex(beforeDoc, afterDoc);
    const collapsedAfter = index.remapNodeIdSet(collapsedBefore);
    const elapsedMs = performance.now() - t0;

    expect(collapsedAfter.size).toBe(1000);
    expect(elapsedMs).toBeLessThan(100);
  });
});
