import { describe, expect, it } from 'vitest';
import { assignMainBranchSides } from '../../src/core/layout/balance';
import {
  getBranchColor,
  getThemePalette,
  resolveLevelStyle,
  resolveNodeVisualColors,
} from '../../src/core/layout/theme';
import { computeLayout, cullLayoutToViewport } from '../../src/core/layout/treeLayout';
import { parseMarkdownToMap } from '../../src/core/parser';
import { computeTopicNumbering } from '../../src/core/view/topicPresentation';
import { resolveArrowNavigation } from '../../src/core/view/navigation';

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

  it('generates tapered fill ribbons for Level 1 edges and attaches depth-3+ edges to the underline baseline', () => {
    const md = ['# Central', '## Branch', '- Child', '  - Grandchild'].join('\n');
    const parsed = parseMarkdownToMap(md, 'Test');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    const allIds = new Set(parsed.document.nodes.keys());
    const tapered = computeLayout(parsed.document, allIds, undefined, undefined, {
      layoutMode: 'balanced',
      edgeStyle: 'tapered',
    });

    const branchNode = [...parsed.document.nodes.values()].find((n) => n.titleRaw === 'Branch');
    const grandchildNode = [...parsed.document.nodes.values()].find((n) => n.titleRaw === 'Grandchild');
    expect(branchNode).toBeDefined();
    expect(grandchildNode).toBeDefined();
    if (!branchNode || !grandchildNode) return;

    const l1Edge = tapered.edges.find((e) => e.toId === branchNode.id);
    expect(l1Edge?.renderMode).toBe('fill');
    expect(l1Edge?.pathD.endsWith('Z')).toBe(true);

    const l3Edge = tapered.edges.find((e) => e.toId === grandchildNode.id);
    const l3Layout = tapered.nodes.get(grandchildNode.id);
    expect(l3Edge?.renderMode).toBe('stroke');
    expect(l3Layout).toBeDefined();
    if (l3Edge && l3Layout) {
      const expectedBottomY = (l3Layout.y + l3Layout.height).toFixed(1);
      expect(l3Edge.pathD.endsWith(` ${expectedBottomY}`)).toBe(true);
    }

    // Curved and orthogonal edge styles render as strokes
    const curved = computeLayout(parsed.document, allIds, undefined, undefined, {
      layoutMode: 'balanced',
      edgeStyle: 'curved',
    });
    expect(curved.edges.every((e) => e.renderMode === 'stroke')).toBe(true);

    const ortho = computeLayout(parsed.document, allIds, undefined, undefined, {
      layoutMode: 'balanced',
      edgeStyle: 'orthogonal',
    });
    expect(ortho.edges.every((e) => e.renderMode === 'stroke' && e.pathD.includes(' L '))).toBe(
      true,
    );
  });

  it('supports right-only and non-overlapping org-chart layouts with org-chart arrow navigation', () => {
    const md = [
      '# Root',
      '## Branch 1',
      '- B1a',
      '  - B1a-i',
      '- B1b',
      '## Branch 2',
      '- B2a',
      '## Branch 3',
      '- B3a',
    ].join('\n');
    const parsed = parseMarkdownToMap(md, 'Test');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;
    const allIds = new Set(doc.nodes.keys());

    // Right-only layout puts every non-root node on the right side
    const rightLayout = computeLayout(doc, allIds, undefined, undefined, { layoutMode: 'right' });
    for (const ln of rightLayout.nodes.values()) {
      if (ln.id !== doc.rootId) expect(ln.side).toBe('right');
    }

    // Org-chart layout puts every non-root node on 'down' with zero overlaps
    const orgLayout = computeLayout(doc, allIds, undefined, undefined, {
      layoutMode: 'org-chart',
      edgeStyle: 'orthogonal',
    });
    const placed = [...orgLayout.nodes.values()];
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

    // Arrow navigation in org-chart: Root -> ArrowDown -> Branch 1 -> ArrowRight -> Branch 2
    const b1 = [...doc.nodes.values()].find((n) => n.titleRaw === 'Branch 1');
    const b2 = [...doc.nodes.values()].find((n) => n.titleRaw === 'Branch 2');
    const b1a = [...doc.nodes.values()].find((n) => n.titleRaw === 'B1a');
    expect(resolveArrowNavigation(doc, orgLayout, doc.rootId, 'down')).toBe(b1?.id);
    expect(resolveArrowNavigation(doc, orgLayout, b1?.id ?? null, 'right')).toBe(b2?.id);
    expect(resolveArrowNavigation(doc, orgLayout, b1?.id ?? null, 'down')).toBe(b1a?.id);
    expect(resolveArrowNavigation(doc, orgLayout, b1a?.id ?? null, 'left')).toBe(b1?.id);
  });

  it('resolves pastel-fill, wireframe, and monochrome colors across Light and Dark Solarized palettes', () => {
    const light = getThemePalette('light');
    const dark = getThemePalette('dark-solarized');

    const pastelColor = getBranchColor(light, 0, true, 'pastel-fill');
    const pastelNode = resolveNodeVisualColors(light, pastelColor, 'rounded-rect', 'pastel-fill', false);
    expect(pastelNode.backgroundColor.startsWith('rgba(')).toBe(true);
    expect(pastelNode.borderColor).toBe(pastelColor);

    const wireNode = resolveNodeVisualColors(light, pastelColor, 'rounded-rect', 'wireframe', false);
    expect(wireNode.backgroundColor).toBe(light.nodeBg);

    const monoBranch = getBranchColor(dark, 2, true, 'monochrome');
    expect(monoBranch).toBe(dark.monochromeAccent);
  });

  it('reserves width/height for numbering labels and repeated tag pills without sibling overlap', () => {
    const md = [
      '# ルート',
      '## 日本語の見出しです',
      '## 日本語の見出しです',
      '## #a #a #a #a #a #a',
      '## 次の見出し',
      '- 長い日本語の見出しと複数のタグを含むトピック #設計 #重要',
      '- 次の兄弟トピック',
    ].join('\n');
    const parsed = parseMarkdownToMap(md, 'JaNumbering');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;
    const allIds = new Set(doc.nodes.keys());
    const numberingLabels = computeTopicNumbering(doc, 'decimal');

    const unnumbered = computeLayout(doc, allIds, undefined, undefined, { layoutMode: 'right' });
    const numbered = computeLayout(doc, allIds, undefined, undefined, {
      layoutMode: 'right',
      numberingLabels,
    });

    const firstHeading = [...doc.nodes.values()].find((n) => n.titleRaw === '日本語の見出しです');
    const repeatedTagHeading = [...doc.nodes.values()].find(
      (n) => n.titleRaw === '#a #a #a #a #a #a',
    );
    expect(firstHeading).toBeDefined();
    expect(repeatedTagHeading).toBeDefined();
    if (!firstHeading || !repeatedTagHeading) return;

    const unnumberedNode = unnumbered.nodes.get(firstHeading.id);
    const numberedNode = numbered.nodes.get(firstHeading.id);
    const repeatedTagNode = numbered.nodes.get(repeatedTagHeading.id);
    expect(unnumberedNode).toBeDefined();
    expect(numberedNode).toBeDefined();
    expect(repeatedTagNode).toBeDefined();
    if (!unnumberedNode || !numberedNode || !repeatedTagNode) return;

    // Numbering adds reserved width so Japanese heading does not unexpectedly wrap & collide
    expect(numberedNode.width).toBeGreaterThan(unnumberedNode.width);
    // Six repeated #a pills reserve multi-line height when exceeding single-line capacity
    expect(repeatedTagNode.height).toBeGreaterThanOrEqual(54);

    // Verify zero pairwise overlap across all placed nodes
    const placed = [...numbered.nodes.values()];
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
});
