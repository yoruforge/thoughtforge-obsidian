import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/core/layout/treeLayout';
import { parseMarkdownToMap } from '../../src/core/parser';
import { resolveArrowNavigation } from '../../src/core/view/navigation';

describe('resolveArrowNavigation', () => {
  const md = [
    '# Root',
    '## R1',
    '- R1a',
    '## R2',
    '## L1',
    '- L1a',
    '## L2',
  ].join('\n');

  it('navigates outward/inward and across siblings on both right and left sides', () => {
    const parsed = parseMarkdownToMap(md, 'Nav');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;
    const layout = computeLayout(doc, new Set(doc.nodes.keys()));

    const findId = (title: string): string => {
      const found = [...doc.nodes.values()].find((n) => n.titleRaw === title);
      if (!found) throw new Error(`Missing ${title}`);
      return found.id;
    };

    const r1 = findId('R1');
    const r1a = findId('R1a');
    const r2 = findId('R2');
    const l1 = findId('L1');
    const l1a = findId('L1a');
    const l2 = findId('L2');

    // From center
    expect(resolveArrowNavigation(doc, layout, doc.rootId, 'right')).toBe(r1);
    expect(resolveArrowNavigation(doc, layout, doc.rootId, 'left')).toBe(l1);

    // Right side outward/inward/down
    expect(resolveArrowNavigation(doc, layout, r1, 'right')).toBe(r1a);
    expect(resolveArrowNavigation(doc, layout, r1a, 'left')).toBe(r1);
    expect(resolveArrowNavigation(doc, layout, r1, 'down')).toBe(r2);
    expect(resolveArrowNavigation(doc, layout, r2, 'up')).toBe(r1);

    // Left side outward/inward/down
    expect(resolveArrowNavigation(doc, layout, l1, 'left')).toBe(l1a);
    expect(resolveArrowNavigation(doc, layout, l1a, 'right')).toBe(l1);
    expect(resolveArrowNavigation(doc, layout, l1, 'down')).toBe(l2);
    expect(resolveArrowNavigation(doc, layout, l2, 'up')).toBe(l1);
  });
});
