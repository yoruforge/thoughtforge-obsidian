import { describe, expect, it } from 'vitest';
import { computeLayout } from '../../src/core/layout/treeLayout';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  collectDocumentTags,
  computeDocumentTextStats,
  computeSubtreeBounds,
  computeTopicNumbering,
  extractTopicTags,
} from '../../src/core/view/topicPresentation';

describe('topicPresentation (M2-ui helpers)', () => {
  const md = [
    '# Central Map',
    '## Branch One #project/alpha #重要',
    'Note body text',
    '- Child A #123 not-a-tag',
    '- Child B #beta',
    '## Branch Two',
    '- Leaf',
  ].join('\n');

  it('computes non-destructive decimal and alphabetical topic numbering labels', () => {
    const parsed = parseMarkdownToMap(md, 'Test');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;

    const findId = (needle: string): string => {
      const found = [...doc.nodes.values()].find((n) => n.titleRaw.includes(needle));
      if (!found) throw new Error(`Missing ${needle}`);
      return found.id;
    };

    expect(computeTopicNumbering(doc, 'off').size).toBe(0);

    const decimal = computeTopicNumbering(doc, 'decimal');
    expect(decimal.has(doc.rootId)).toBe(false);
    expect(decimal.get(findId('Branch One'))).toBe('1');
    expect(decimal.get(findId('Child A'))).toBe('1.1');
    expect(decimal.get(findId('Child B'))).toBe('1.2');
    expect(decimal.get(findId('Branch Two'))).toBe('2');
    expect(decimal.get(findId('Leaf'))).toBe('2.1');

    const alpha = computeTopicNumbering(doc, 'alpha');
    expect(alpha.get(findId('Branch One'))).toBe('A');
    expect(alpha.get(findId('Child A'))).toBe('A.a');
    expect(alpha.get(findId('Child B'))).toBe('A.b');
    expect(alpha.get(findId('Branch Two'))).toBe('B');
    expect(alpha.get(findId('Leaf'))).toBe('B.a');
  });

  it('extracts inline Obsidian tags (including nested and Japanese) while ignoring pure numeric hashes', () => {
    expect(extractTopicTags('Branch One #project/alpha #重要')).toEqual(['#project/alpha', '#重要']);
    expect(extractTopicTags('Issue #123 fixed #beta')).toEqual(['#beta']);

    const parsed = parseMarkdownToMap(md, 'Test');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(collectDocumentTags(parsed.document)).toEqual(['#beta', '#project/alpha', '#重要']);
  });

  it('computes document word/char stats and subtree bounds for Fit Selection', () => {
    const parsed = parseMarkdownToMap(md, 'Test');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;

    const stats = computeDocumentTextStats(doc);
    expect(stats.wordCount).toBeGreaterThan(10);
    expect(stats.charCount).toBeGreaterThan(40);

    const layout = computeLayout(doc, new Set(doc.nodes.keys()));
    const b1 = [...doc.nodes.values()].find((n) => n.titleRaw.includes('Branch One'));
    expect(b1).toBeDefined();
    if (!b1) return;

    const subBounds = computeSubtreeBounds(doc, layout, b1.id);
    expect(subBounds).not.toBeNull();
    if (!subBounds) return;
    expect(subBounds.maxX).toBeGreaterThan(subBounds.minX);
    expect(subBounds.maxY).toBeGreaterThan(subBounds.minY);
    expect(subBounds.maxX - subBounds.minX).toBeLessThanOrEqual(layout.bounds.maxX - layout.bounds.minX);
  });
});
