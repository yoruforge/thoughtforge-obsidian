import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  doesLinkTargetTopicNode,
  formatSourceTitleFromPath,
  sortBacklinks,
} from '../../src/core/view/backlinks';

function parseOk(md: string) {
  const res = parseMarkdownToMap(md, 'Target');
  if (res.status !== 'ok') throw new Error(`parse failed: ${res.detail}`);
  return res.document;
}

describe('backlinks (M4-b exact topic resolution & deterministic sorting)', () => {
  it('matches nested subheadings strictly so [[Target#One#Summary]] never falsely marks Two > Summary (Codex PR #17 P2)', () => {
    const doc = parseOk(
      [
        '# Target',
        '## One',
        '### Summary',
        '## Two',
        '### Summary',
        '## **Section** Alpha ^blk-alpha',
        '## 設計方針',
        '',
      ].join('\n'),
    );

    const summaries = [...doc.nodes.values()].filter((n) => n.titleRaw === 'Summary');
    const oneSummary = summaries.find((n) => doc.nodes.get(n.parentId ?? '')?.titleRaw === 'One');
    const twoSummary = summaries.find((n) => doc.nodes.get(n.parentId ?? '')?.titleRaw === 'Two');
    const alphaNode = [...doc.nodes.values()].find((n) => n.preservedBlockId === '^blk-alpha');
    const jpNode = [...doc.nodes.values()].find((n) => n.titleRaw === '設計方針');
    expect(oneSummary && twoSummary && alphaNode && jpNode).toBeTruthy();
    if (!oneSummary || !twoSummary || !alphaNode || !jpNode) return;

    // Qualified nested heading link matches ONLY One > Summary, NEVER Two > Summary!
    expect(doesLinkTargetTopicNode(doc, 'Target#One#Summary', oneSummary.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#One#Summary', twoSummary.id)).toBe(false);
    expect(doesLinkTargetTopicNode(doc, 'Target#Two#Summary', twoSummary.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#Two#Summary', oneSummary.id)).toBe(false);

    // Block ID, formatted heading, URL-encoded Japanese heading, and plain note link
    expect(doesLinkTargetTopicNode(doc, 'Target#^BLK-ALPHA', alphaNode.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#Section Alpha', alphaNode.id)).toBe(true);
    expect(
      doesLinkTargetTopicNode(doc, 'Target#%E8%A8%AD%E8%A8%88%E6%96%B9%E9%87%9D', jpNode.id),
    ).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target', oneSummary.id)).toBe(false);
  });

  it('sorts direct anchor backlinks ahead of note-level backlinks and formats titles cleanly', () => {
    expect(formatSourceTitleFromPath('folder/sub/My Note.md')).toBe('My Note');

    const sorted = sortBacklinks([
      { sourcePath: 'a-general.md', sourceTitle: 'A General', targetsSpecificAnchor: false },
      { sourcePath: 'z-direct.md', sourceTitle: 'Z Direct', targetsSpecificAnchor: true },
      { sourcePath: 'b-direct.md', sourceTitle: 'B Direct', targetsSpecificAnchor: true },
      { sourcePath: 'c-general.md', sourceTitle: 'C General', targetsSpecificAnchor: false },
    ]);

    expect(sorted.map((s) => s.sourcePath)).toEqual([
      'b-direct.md',
      'z-direct.md',
      'a-general.md',
      'c-general.md',
    ]);
  });
});
