import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/core/layout/treeLayout';
import { parseMarkdownToMap } from '../../src/core/parser';
import { resolveDropTarget } from '../../src/ui/dragDrop';

describe('dragDrop hit testing (M2-c)', () => {
  const md = [
    '# Root',
    '## Branch A',
    '- Child A1',
    '## Branch B',
    '- Child B1',
    '## Branch C',
  ].join('\n');

  it('resolves before, inside, and after drop placements while blocking self/descendant cycles and no-op slots', () => {
    const parsed = parseMarkdownToMap(md, 'DnD');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;
    const layout = computeLayout(doc, new Set(doc.nodes.keys()), undefined, undefined, {
      layoutMode: 'right',
    });

    const findNode = (title: string) => {
      const node = [...doc.nodes.values()].find((n) => n.titleRaw === title);
      if (!node) throw new Error(`Missing ${title}`);
      return node;
    };

    const branchA = findNode('Branch A');
    const childA1 = findNode('Child A1');
    const branchB = findNode('Branch B');
    const branchC = findNode('Branch C');

    const lA = layout.nodes.get(branchA.id)!;
    const lA1 = layout.nodes.get(childA1.id)!;
    const lC = layout.nodes.get(branchC.id)!;
    const lRoot = layout.nodes.get(doc.rootId)!;

    // 1. Cycle protection: dragging Branch A onto itself or its own descendant Child A1 -> null
    expect(resolveDropTarget(doc, layout, branchA.id, lA.x + 10, lA.y + lA.height / 2)).toBeNull();
    expect(resolveDropTarget(doc, layout, branchA.id, lA1.x + 10, lA1.y + lA1.height / 2)).toBeNull();

    // 2. Dropping Branch A on top 25% of Branch C -> 'before' Branch C (index 2 under root)
    const beforeC = resolveDropTarget(doc, layout, branchA.id, lC.x + 10, lC.y + 2);
    expect(beforeC).toEqual({
      hoverNodeId: branchC.id,
      placement: 'before',
      targetParentId: doc.rootId,
      index: 2,
    });

    // 3. Dropping Branch A on middle 50% of Branch C -> 'inside' Branch C
    const insideC = resolveDropTarget(doc, layout, branchA.id, lC.x + 10, lC.y + lC.height / 2);
    expect(insideC).toEqual({
      hoverNodeId: branchC.id,
      placement: 'inside',
      targetParentId: branchC.id,
      index: 0,
    });

    // 4. Dropping Branch A on bottom 25% of Branch C -> 'after' Branch C (index 3 under root)
    const afterC = resolveDropTarget(doc, layout, branchA.id, lC.x + 10, lC.y + lC.height - 2);
    expect(afterC).toEqual({
      hoverNodeId: branchC.id,
      placement: 'after',
      targetParentId: doc.rootId,
      index: 3,
    });

    // 5. No-op suppression: dragging Branch A to 'before' Branch B (index 1, same slot after A!) -> null
    const lB = layout.nodes.get(branchB.id)!;
    expect(resolveDropTarget(doc, layout, branchA.id, lB.x + 10, lB.y + 2)).toBeNull();

    // 6. Dropping Child A1 onto root -> 'inside' root
    const ontoRoot = resolveDropTarget(doc, layout, childA1.id, lRoot.x + 10, lRoot.y + lRoot.height / 2);
    expect(ontoRoot).toEqual({
      hoverNodeId: doc.rootId,
      placement: 'inside',
      targetParentId: doc.rootId,
      index: 3,
    });
  });
});
