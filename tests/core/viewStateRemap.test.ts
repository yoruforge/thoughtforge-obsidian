import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  remapFocusMode,
  remapNodeIdAcrossDocuments,
  remapNodeIdSet,
} from '../../src/core/view/viewStateRemap';

function parseOk(md: string) {
  const res = parseMarkdownToMap(md, 'Root');
  if (res.status !== 'ok') throw new Error(`parse failed: ${res.detail}`);
  return res.document;
}

describe('viewStateRemap (PR #2 P2 regression)', () => {
  it('remaps collapsed branch IDs and fixed focus anchor when preceding insertions shift n-* IDs', () => {
    const beforeDoc = parseOk('# Root\n## A\n## B\n- B child\n');
    const afterDoc = parseOk('# Root\n## A\n- New child\n## B\n- B child\n');

    const beforeB = [...beforeDoc.nodes.values()].find((n) => n.titleRaw === 'B');
    const afterB = [...afterDoc.nodes.values()].find((n) => n.titleRaw === 'B');
    expect(beforeB).toBeDefined();
    expect(afterB).toBeDefined();
    if (!beforeB || !afterB) return;
    expect(beforeB.id).not.toBe(afterB.id); // IDs shifted!

    const remappedCollapsed = remapNodeIdSet(beforeDoc, afterDoc, new Set([beforeB.id]));
    expect([...remappedCollapsed]).toEqual([afterB.id]);

    const remappedFocus = remapFocusMode(beforeDoc, afterDoc, {
      kind: 'fixed',
      anchorId: beforeB.id,
    });
    expect(remappedFocus).toEqual({ kind: 'fixed', anchorId: afterB.id });
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
});
