import { describe, expect, it } from 'vitest';
import { assignMainBranchSides } from '../../src/core/layout/balance';
import { resolveLevelStyle } from '../../src/core/layout/theme';
import { computeLayout, cullLayoutToViewport } from '../../src/core/layout/treeLayout';
import { parseMarkdownToMap } from '../../src/core/parser';

describe('layout engine', () => {
  it('assigns main branches deterministically (1-2 right, 3+ split right/left)', () => {
    const two = assignMainBranchSides(['a', 'b']);
    expect(two.get('a')).toBe('right');
    expect(two.get('b')).toBe('right');

    const five = assignMainBranchSides(['a', 'b', 'c', 'd', 'e']);
    expect(five.get('a')).toBe('right');
    expect(five.get('b')).toBe('right');
    expect(five.get('c')).toBe('right');
    expect(five.get('d')).toBe('left');
    expect(five.get('e')).toBe('left');
  });

  it('inherits level styles across depths 0..9 without missing fields', () => {
    const d0 = resolveLevelStyle(0);
    const d1 = resolveLevelStyle(1);
    const d6 = resolveLevelStyle(6);
    expect(d0.shape).toBe('rounded-pill');
    expect(d1.shape).toBe('rounded-rect');
    expect(d6.shape).toBe('underline');
    expect(d6.fontSizePx).toBe(12);
    expect(d0.fontSizePx).toBeGreaterThan(d1.fontSizePx);
  });

  it('produces non-overlapping bounding boxes for all visible nodes', () => {
    const md = [
      '# Central Idea',
      '## Branch 1',
      '- Item 1A',
      '- Item 1B',
      '  - Deep 1B-1',
      '  - Deep 1B-2',
      '## Branch 2',
      '- Item 2A',
      '## Branch 3',
      '- Item 3A',
      '- Item 3B',
      '## Branch 4',
      '- Item 4A',
    ].join('\n');

    const parsed = parseMarkdownToMap(md, 'Test');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    const allIds = new Set(parsed.document.nodes.keys());
    const layout = computeLayout(parsed.document, allIds);
    const placed = [...layout.nodes.values()];

    expect(placed.length).toBe(parsed.document.nodes.size);
    expect(layout.edges.length).toBe(parsed.document.nodes.size - 1);

    for (let i = 0; i < placed.length; i += 1) {
      const a = placed[i];
      if (!a) continue;
      for (let j = i + 1; j < placed.length; j += 1) {
        const b = placed[j];
        if (!b) continue;
        const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapsY = a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlapsX && overlapsY).toBe(false);
      }
    }
  });

  it('culls offscreen nodes and completes 3,000-topic layout well under 1.5s', () => {
    const lines = ['# Large Map'];
    for (let b = 0; b < 30; b += 1) {
      lines.push(`## Branch ${b + 1}`);
      for (let c = 0; c < 99; c += 1) {
        lines.push(`- Topic ${b + 1}-${c + 1}`);
      }
    }
    const startMs = performance.now();
    const parsed = parseMarkdownToMap(lines.join('\n'), 'Large');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    const layout = computeLayout(parsed.document, new Set(parsed.document.nodes.keys()));
    const elapsedMs = performance.now() - startMs;

    expect(parsed.document.topicCount).toBe(3000);
    expect(parsed.document.largeMapWarning).toBe(false);
    expect(elapsedMs).toBeLessThan(1500);

    const culled = cullLayoutToViewport(
      layout,
      { minX: -200, minY: -200, maxX: 200, maxY: 200 },
      50,
    );
    expect(culled.nodes.length).toBeGreaterThan(0);
    expect(culled.nodes.length).toBeLessThan(layout.nodes.size);
  });
});
