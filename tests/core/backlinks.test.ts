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
        '## Phase%20One',
        '## Phase One',
        '',
      ].join('\n'),
    );

    const summaries = [...doc.nodes.values()].filter((n) => n.titleRaw === 'Summary');
    const oneSummary = summaries.find((n) => doc.nodes.get(n.parentId ?? '')?.titleRaw === 'One');
    const twoSummary = summaries.find((n) => doc.nodes.get(n.parentId ?? '')?.titleRaw === 'Two');
    const alphaNode = [...doc.nodes.values()].find((n) => n.preservedBlockId === '^blk-alpha');
    const jpNode = [...doc.nodes.values()].find((n) => n.titleRaw === '設計方針');
    const percentHeading = [...doc.nodes.values()].find((n) => n.titleRaw === 'Phase%20One');
    const spaceHeading = [...doc.nodes.values()].find((n) => n.titleRaw === 'Phase One');
    expect(
      oneSummary && twoSummary && alphaNode && jpNode && percentHeading && spaceHeading,
    ).toBeTruthy();
    if (!oneSummary || !twoSummary || !alphaNode || !jpNode || !percentHeading || !spaceHeading) {
      return;
    }

    // Qualified nested heading link matches ONLY One > Summary, NEVER Two > Summary!
    expect(doesLinkTargetTopicNode(doc, 'Target#One#Summary', oneSummary.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#One#Summary', twoSummary.id)).toBe(false);
    expect(doesLinkTargetTopicNode(doc, 'Target#Two#Summary', twoSummary.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#Two#Summary', oneSummary.id)).toBe(false);

    // Block ID, formatted heading, literal & URL-encoded Japanese heading, literal %20 heading, and plain note link
    expect(doesLinkTargetTopicNode(doc, 'Target#^BLK-ALPHA', alphaNode.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#Section Alpha', alphaNode.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#設計方針', jpNode.id)).toBe(true);
    expect(
      doesLinkTargetTopicNode(doc, 'Target#%E8%A8%AD%E8%A8%88%E6%96%B9%E9%87%9D', jpNode.id, {
        decodeUrl: true,
      }),
    ).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#Phase%20One', percentHeading.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Target#Phase%20One', spaceHeading.id)).toBe(false);
    expect(
      doesLinkTargetTopicNode(doc, 'Target#Phase%20One', spaceHeading.id, { decodeUrl: true }),
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

  it('resolves repeated backlink checks across 2,000 headings x 100 notes x 10 trailing links without full-scan O(R*N) slowdown (Codex PR #17 P2)', () => {
    const lines = ['# Target'];
    for (let i = 1; i <= 2000; i += 1) {
      lines.push(`## Section ${i}`);
    }
    const doc = parseOk(`${lines.join('\n')}\n`);
    const lastHeading = [...doc.nodes.values()].find((n) => n.titleRaw === 'Section 2000');
    expect(lastHeading).toBeDefined();
    if (!lastHeading) return;

    const trailingLinks: string[] = [];
    for (let i = 1991; i <= 2000; i += 1) {
      trailingLinks.push(`Target#Section ${i}`);
    }

    const startMs = performance.now();
    let directHits = 0;
    for (let note = 0; note < 100; note += 1) {
      for (const link of trailingLinks) {
        if (doesLinkTargetTopicNode(doc, link, lastHeading.id)) {
          directHits += 1;
        }
      }
    }
    const elapsedMs = performance.now() - startMs;

    expect(directHits).toBe(100);
    // Indexed WeakMap lookup should stay well under 250ms even on slow CI runners (previously ~1,170ms)
    expect(elapsedMs).toBeLessThan(250);
  });

  it('distinguishes intraword underscore headings in direct backlinks regardless of heading order (Codex #5cb909c4)', () => {
    const doc1 = parseOk('# Target\n## buildapiv2\n## build_api_v2\n');
    const plain1 = [...doc1.nodes.values()].find((n) => n.titleRaw === 'buildapiv2');
    const under1 = [...doc1.nodes.values()].find((n) => n.titleRaw === 'build_api_v2');
    expect(plain1 && under1).toBeTruthy();
    if (!plain1 || !under1) return;
    expect(doesLinkTargetTopicNode(doc1, 'Target#build_api_v2', under1.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc1, 'Target#build_api_v2', plain1.id)).toBe(false);
    expect(doesLinkTargetTopicNode(doc1, 'Target#buildapiv2', plain1.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc1, 'Target#buildapiv2', under1.id)).toBe(false);

    const doc2 = parseOk('# Target\n## build_api_v2\n## buildapiv2\n');
    const under2 = [...doc2.nodes.values()].find((n) => n.titleRaw === 'build_api_v2');
    const plain2 = [...doc2.nodes.values()].find((n) => n.titleRaw === 'buildapiv2');
    expect(under2 && plain2).toBeTruthy();
    if (!under2 || !plain2) return;
    expect(doesLinkTargetTopicNode(doc2, 'Target#build_api_v2', under2.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc2, 'Target#build_api_v2', plain2.id)).toBe(false);
    expect(doesLinkTargetTopicNode(doc2, 'Target#buildapiv2', plain2.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc2, 'Target#buildapiv2', under2.id)).toBe(false);
  });

  it('marks direct backlinks for headings with emphasis wrapping inline code spans (Codex #7822c46c)', () => {
    const doc = parseOk('# Headings\n## Other\n## **Use `foo` now**\n');
    const otherNode = [...doc.nodes.values()].find((n) => n.titleRaw === 'Other');
    const useFooNode = [...doc.nodes.values()].find((n) => n.titleRaw === '**Use `foo` now**');
    expect(otherNode && useFooNode).toBeTruthy();
    if (!otherNode || !useFooNode) return;

    expect(doesLinkTargetTopicNode(doc, 'Headings#Use foo now', useFooNode.id)).toBe(true);
    expect(doesLinkTargetTopicNode(doc, 'Headings#Use foo now', otherNode.id)).toBe(false);
  });
});
