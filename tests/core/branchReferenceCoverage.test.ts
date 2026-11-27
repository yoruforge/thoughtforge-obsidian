import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  maskObsidianCommentsInLine,
  tokenizeInlineMarkdown,
} from '../../src/core/parser/inlineMarkdown';
import {
  verifyBranchReferenceCoverage,
  type CachedReferenceItem,
  type CachedReferenceSnapshot,
} from '../../src/core/patch/branchReferenceCoverage';
import { editableMap } from '../../src/core/patch/extractBranch';

const EMPTY_SNAPSHOT: CachedReferenceSnapshot = {
  links: [],
  embeds: [],
  footnotes: [],
  footnoteRefs: [],
  referenceLinks: [],
};

function makeSnapshot(overrides: Partial<CachedReferenceSnapshot> = {}): CachedReferenceSnapshot {
  return {
    links: overrides.links ?? [],
    embeds: overrides.embeds ?? [],
    footnotes: overrides.footnotes ?? [],
    footnoteRefs: overrides.footnoteRefs ?? [],
    referenceLinks: overrides.referenceLinks ?? [],
  };
}

function parseBranch(raw: string, title = 'Branch') {
  const doc = editableMap(raw, 'Map');
  const lines = raw.split(doc.lineEnding);
  const target = [...doc.nodes.values()].find((n) => n.titleRaw === title && n.id !== doc.rootId);
  if (!target) {
    throw new Error(`Target branch not found: ${title}`);
  }
  return { doc, target, lines };
}

function singleRef(
  lines: readonly string[],
  line: number,
  original: string,
  fromCol = 0,
): CachedReferenceItem {
  const text = lines[line] ?? '';
  const startCol = text.indexOf(original, fromCol);
  if (startCol < 0) {
    throw new Error(`Reference ${original} not found on line ${line}: ${text}`);
  }
  return {
    original,
    position: {
      startLine: line,
      startCol,
      endLine: line,
      endCol: startCol + original.length,
    },
  };
}

function multilineRef(
  lines: readonly string[],
  startLine: number,
  startAnchor: string,
  endLine: number,
  endSuffix: string,
): CachedReferenceItem {
  const firstLine = lines[startLine] ?? '';
  const startCol = firstLine.indexOf(startAnchor);
  if (startCol < 0) {
    throw new Error(`Start anchor ${startAnchor} not found on line ${startLine}: ${firstLine}`);
  }
  const lastLine = lines[endLine] ?? '';
  const endIdx = lastLine.indexOf(endSuffix);
  if (endIdx < 0) {
    throw new Error(`End suffix ${endSuffix} not found on line ${endLine}: ${lastLine}`);
  }
  const endCol = endIdx + endSuffix.length;
  const parts: string[] = [];
  for (let ln = startLine; ln <= endLine; ln += 1) {
    const lineText = lines[ln] ?? '';
    const sliceStart = ln === startLine ? startCol : 0;
    const sliceEnd = ln === endLine ? endCol : lineText.length;
    parts.push(lineText.slice(sliceStart, sliceEnd));
  }
  return {
    original: parts.join('\n'),
    position: {
      startLine,
      startCol,
      endLine,
      endCol,
    },
  };
}

describe('verifyBranchReferenceCoverage — protected block coverage (FR-1 / FR-3 / §11.1)', () => {
  it('detects uncached/stale links and embeds in blockquotes and accepts exact cache matches', () => {
    const raw = [
      '# Map',
      '## Branch',
      '> [[Picture.png]]',
      '> ![alt](Picture.png)',
      '> [doc](Note.md)',
      '> > [[Nested.png]]',
    ].join('\n');
    const { doc, target, lines } = parseBranch(raw);

    const wikiItem = singleRef(lines, 2, '[[Picture.png]]');
    const embedItem = singleRef(lines, 3, '![alt](Picture.png)');
    const mdItem = singleRef(lines, 4, '[doc](Note.md)');
    const nestedItem = singleRef(lines, 5, '[[Nested.png]]');

    // Empty cache rejects on first active blockquote line
    expect(verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT)).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
      line: 2,
    });

    // Dropping each entry one by one rejects at that exact line
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [mdItem, nestedItem], embeds: [embedItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [wikiItem, mdItem, nestedItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });

    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [wikiItem, nestedItem], embeds: [embedItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 4 });

    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [wikiItem, mdItem], embeds: [embedItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 5 });

    // Stale original or wrong startCol/endCol rejects
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({
          links: [{ ...wikiItem, original: '[[Old.png]]' }, mdItem, nestedItem],
          embeds: [embedItem],
        }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({
          links: [
            {
              original: wikiItem.original,
              position: { ...wikiItem.position, startCol: 3, endCol: 18 },
            },
            mdItem,
            nestedItem,
          ],
          embeds: [embedItem],
        }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    // Full exact snapshot succeeds and preserves visibleLines with prefix spaces
    const okResult = verifyBranchReferenceCoverage(
      doc,
      target,
      lines,
      makeSnapshot({
        links: [wikiItem, mdItem, nestedItem],
        embeds: [embedItem],
      }),
    );
    expect(okResult.status).toBe('ok');
    if (okResult.status === 'ok') {
      expect(okResult.visibleLines.get(2)).toBe('  [[Picture.png]]');
      expect(okResult.visibleLines.get(5)).toBe('    [[Nested.png]]');
    }
  });

  it('allows external URLs inside blockquotes with an empty cache', () => {
    const raw = ['# Map', '## Branch', '> [ext](https://example.com)', '> https://example.org'].join(
      '\n',
    );
    const { doc, target, lines } = parseBranch(raw);
    expect(verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT).status).toBe('ok');
  });

  it('verifies callout header, foldable header, and body links', () => {
    const raw = [
      '# Map',
      '## Branch',
      '> [!note] [[Title.png]]',
      '> [[Body.png]]',
      '',
      '> [!tip]- [[Tip.png]]',
    ].join('\n');
    const { doc, target, lines } = parseBranch(raw);

    const titleItem = singleRef(lines, 2, '[[Title.png]]');
    const bodyItem = singleRef(lines, 3, '[[Body.png]]');
    const tipItem = singleRef(lines, 5, '[[Tip.png]]');

    expect(titleItem.position).toEqual({ startLine: 2, startCol: 10, endLine: 2, endCol: 23 });
    expect(tipItem.position).toEqual({ startLine: 5, startCol: 10, endLine: 5, endCol: 21 });

    expect(verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT)).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
      line: 2,
    });
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [titleItem, tipItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [titleItem, bodyItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 5 });

    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [titleItem, bodyItem, tipItem] }),
      ).status,
    ).toBe('ok');
  });

  it('verifies GFM table header and data rows including escaped pipe aliases', () => {
    const raw = [
      '# Map',
      '## Branch',
      '| [[Header.png]] | Col |',
      '| --- | --- |',
      '| [[Picture.png\\|Alias]] | [doc](Note.md) |',
    ].join('\n');
    const { doc, target, lines } = parseBranch(raw);

    const headerItem = singleRef(lines, 2, '[[Header.png]]');
    const escapedPipeItem = singleRef(lines, 4, '[[Picture.png\\|Alias]]');
    const mdItem = singleRef(lines, 4, '[doc](Note.md)');

    expect(escapedPipeItem.position).toEqual({
      startLine: 4,
      startCol: 2,
      endLine: 4,
      endCol: 24,
    });

    expect(verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT)).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
      line: 2,
    });
    expect(
      verifyBranchReferenceCoverage(doc, target, lines, makeSnapshot({ links: [headerItem] })),
    ).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
      line: 4,
    });
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [headerItem, escapedPipeItem, mdItem] }),
      ).status,
    ).toBe('ok');

    const externalTable = parseBranch(
      ['# Map', '## Branch', '| [ext](https://example.com) | Col |', '| --- | --- |'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        externalTable.doc,
        externalTable.target,
        externalTable.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');
  });

  it('verifies trailing-paragraph links after unmapped blocks and child list items', () => {
    const afterQuoteRaw = ['# Map', '## Branch', '> quote', '', 'Trailing [[Picture.png]]'].join(
      '\n',
    );
    const afterQuote = parseBranch(afterQuoteRaw);
    expect(
      verifyBranchReferenceCoverage(
        afterQuote.doc,
        afterQuote.target,
        afterQuote.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 4 });
    expect(
      verifyBranchReferenceCoverage(
        afterQuote.doc,
        afterQuote.target,
        afterQuote.lines,
        makeSnapshot({ links: [singleRef(afterQuote.lines, 4, '[[Picture.png]]')] }),
      ).status,
    ).toBe('ok');

    const afterChildRaw = ['# Map', '## Branch', '- Child', '', 'Trailing [[Picture.png]]'].join(
      '\n',
    );
    const afterChild = parseBranch(afterChildRaw);
    expect(
      verifyBranchReferenceCoverage(
        afterChild.doc,
        afterChild.target,
        afterChild.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 4 });
    expect(
      verifyBranchReferenceCoverage(
        afterChild.doc,
        afterChild.target,
        afterChild.lines,
        makeSnapshot({ links: [singleRef(afterChild.lines, 4, '[[Picture.png]]')] }),
      ).status,
    ).toBe('ok');
  });

  it('verifies nested internal images and wikiembeds inside external Markdown link labels', () => {
    const mdImgRaw = ['# Map', '## Branch', '> [![alt](Picture.png)](https://example.com)'].join(
      '\n',
    );
    const mdImg = parseBranch(mdImgRaw);
    const nestedMdImg = singleRef(mdImg.lines, 2, '![alt](Picture.png)');
    expect(nestedMdImg.position).toEqual({ startLine: 2, startCol: 3, endLine: 2, endCol: 22 });

    expect(
      verifyBranchReferenceCoverage(mdImg.doc, mdImg.target, mdImg.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        mdImg.doc,
        mdImg.target,
        mdImg.lines,
        makeSnapshot({ embeds: [nestedMdImg] }),
      ).status,
    ).toBe('ok');

    const wikiEmbedRaw = [
      '# Map',
      '## Branch',
      '> [![[Picture.png]]](https://example.com)',
    ].join('\n');
    const wikiEmbed = parseBranch(wikiEmbedRaw);
    const nestedWiki = singleRef(wikiEmbed.lines, 2, '![[Picture.png]]');

    expect(
      verifyBranchReferenceCoverage(wikiEmbed.doc, wikiEmbed.target, wikiEmbed.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        wikiEmbed.doc,
        wikiEmbed.target,
        wikiEmbed.lines,
        makeSnapshot({ embeds: [nestedWiki] }),
      ).status,
    ).toBe('ok');
  });

  it('verifies nested internal images inside external link labels when not at start of blockquote', () => {
    const mdImgRaw = [
      '# Map',
      '## Branch',
      '> See [![alt](Picture.png)](https://example.com)',
    ].join('\n');
    const mdImg = parseBranch(mdImgRaw);
    const nestedMdImg = singleRef(mdImg.lines, 2, '![alt](Picture.png)');

    expect(
      verifyBranchReferenceCoverage(mdImg.doc, mdImg.target, mdImg.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        mdImg.doc,
        mdImg.target,
        mdImg.lines,
        makeSnapshot({ embeds: [nestedMdImg] }),
      ).status,
    ).toBe('ok');
  });

  it('treats leading blockquote links with [!label] followed by (dest) as links, not callouts', () => {
    const raw = ['# Map', '## Branch', '> [!alt](Picture.png)'].join('\n');
    const { doc, target, lines } = parseBranch(raw);
    const linkItem = singleRef(lines, 2, '[!alt](Picture.png)');
    expect(linkItem.position).toEqual({ startLine: 2, startCol: 2, endLine: 2, endCol: 21 });

    expect(verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT)).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
      line: 2,
    });
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [linkItem] }),
      ).status,
    ).toBe('ok');
  });

  it('isolates coverage verification and visibleLines strictly to the target branch range', () => {
    const raw = [
      '# Map',
      '## Branch',
      '> Clean quote',
      '## Sibling',
      '> [[UncachedInSibling.png]]',
      '[^sibling]: Sibling footnote',
    ].join('\n');
    const { doc, target, lines } = parseBranch(raw);

    const res = verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      const keys = [...res.visibleLines.keys()].sort((a, b) => a - b);
      expect(keys).toEqual([1, 2]);
      expect(res.visibleLines.has(4)).toBe(false);
    }
  });
});

describe('verifyBranchReferenceCoverage — R1.1 + OQ-1 multiline Markdown links', () => {
  it('handles multiline Markdown links across topic-note, list-item+note, trailing-paragraph, blockquote, and callout header', () => {
    const fixtures: Array<{ name: string; raw: string; startLine: number; endLine: number }> = [
      {
        name: 'topic-note',
        raw: ['# Map', '## Branch', '[multi', 'line](Picture.png)'].join('\n'),
        startLine: 2,
        endLine: 3,
      },
      {
        name: 'list-item + topic-note',
        raw: ['# Map', '## Branch', '- Item [multi', '  line](Picture.png)'].join('\n'),
        startLine: 2,
        endLine: 3,
      },
      {
        name: 'trailing-paragraph',
        raw: ['# Map', '## Branch', '> quote', '', '[multi', 'line](Picture.png)'].join('\n'),
        startLine: 4,
        endLine: 5,
      },
      {
        name: 'blockquote',
        raw: ['# Map', '## Branch', '> [photo', '> caption](Picture.png)'].join('\n'),
        startLine: 2,
        endLine: 3,
      },
      {
        name: 'callout header',
        raw: ['# Map', '## Branch', '> [!note] [photo', '> caption](Picture.png)'].join('\n'),
        startLine: 2,
        endLine: 3,
      },
    ];

    for (const fx of fixtures) {
      const { doc, target, lines } = parseBranch(fx.raw);
      expect(
        verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT),
        `${fx.name} uncached`,
      ).toMatchObject({
        status: 'rejected',
        code: 'metadata-updating',
        line: fx.startLine,
      });

      const startAnchor = lines[fx.startLine]!.includes('[photo') ? '[photo' : '[multi';
      const endSuffix = lines[fx.endLine]!.includes('caption](Picture.png)')
        ? 'caption](Picture.png)'
        : 'line](Picture.png)';
      const exactCached = multilineRef(lines, fx.startLine, startAnchor, fx.endLine, endSuffix);

      expect(
        verifyBranchReferenceCoverage(doc, target, lines, makeSnapshot({ links: [exactCached] })),
        `${fx.name} exact cached`,
      ).toMatchObject({
        status: 'rejected',
        code: 'unsafe-reference',
        line: fx.startLine,
      });
    }

    // Multiline image and multiline destination paren `(\nPicture.png)`
    const mlImage = parseBranch(['# Map', '## Branch', '![alt', 'text](Picture.png)'].join('\n'));
    expect(
      verifyBranchReferenceCoverage(mlImage.doc, mlImage.target, mlImage.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        mlImage.doc,
        mlImage.target,
        mlImage.lines,
        makeSnapshot({ embeds: [multilineRef(mlImage.lines, 2, '![alt', 3, 'text](Picture.png)')] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });

    const mlDest = parseBranch(['# Map', '## Branch', '[label](', 'Picture.png)'].join('\n'));
    expect(
      verifyBranchReferenceCoverage(mlDest.doc, mlDest.target, mlDest.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        mlDest.doc,
        mlDest.target,
        mlDest.lines,
        makeSnapshot({ links: [multilineRef(mlDest.lines, 2, '[label](', 3, 'Picture.png)')] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });
  });

  it('rejects stale multiline metadata (wrong endCol or missing continuation quote prefix) as metadata-updating', () => {
    const raw = ['# Map', '## Branch', '> [!note] [photo', '> caption](Picture.png)'].join('\n');
    const { doc, target, lines } = parseBranch(raw);
    const exact = multilineRef(lines, 2, '[photo', 3, 'caption](Picture.png)');

    expect(exact.original).toBe('[photo\n> caption](Picture.png)');
    expect(exact.position).toEqual({ startLine: 2, startCol: 10, endLine: 3, endCol: 23 });

    // Missing `> ` on continuation line
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({
          links: [{ original: '[photo\ncaption](Picture.png)', position: exact.position }],
        }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    // Wrong endCol
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({
          links: [
            {
              original: exact.original,
              position: { ...exact.position, endCol: exact.position.endCol - 1 },
            },
          ],
        }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
  });

  it('allows multiline external URLs (OQ-1) and checks nested internal images inside them', () => {
    const extTop = parseBranch(['# Map', '## Branch', '[multi', 'line](https://example.com)'].join('\n'));
    expect(
      verifyBranchReferenceCoverage(extTop.doc, extTop.target, extTop.lines, EMPTY_SNAPSHOT).status,
    ).toBe('ok');

    const extCallout = parseBranch(
      ['# Map', '## Branch', '> [!note] [photo', '> caption](https://example.com)'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        extCallout.doc,
        extCallout.target,
        extCallout.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    // External multiline link with nested internal image on line 2 of quote
    const nestedRaw = [
      '# Map',
      '## Branch',
      '> [caption',
      '> ![alt](Picture.png)](https://example.com)',
    ].join('\n');
    const nested = parseBranch(nestedRaw);
    expect(
      verifyBranchReferenceCoverage(nested.doc, nested.target, nested.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
      line: 3,
    });
    expect(
      verifyBranchReferenceCoverage(
        nested.doc,
        nested.target,
        nested.lines,
        makeSnapshot({ embeds: [singleRef(nested.lines, 3, '![alt](Picture.png)')] }),
      ).status,
    ).toBe('ok');
  });

  it('does not join multiline links across empty quote lines or quoteDepth breaks', () => {
    const emptyQuoteBreak = parseBranch(
      ['# Map', '## Branch', '> [not', '>', '> link](Picture.png)'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        emptyQuoteBreak.doc,
        emptyQuoteBreak.target,
        emptyQuoteBreak.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    const depthBreak = parseBranch(
      ['# Map', '## Branch', '> > [not', '> link](Picture.png)'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        depthBreak.doc,
        depthBreak.target,
        depthBreak.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');
  });
});

describe('verifyBranchReferenceCoverage — R1.2 & R1.3 & inactive regions (FR-4 / FR-8)', () => {
  it('skips top-level inactive unmapped blocks and blanks visibleLines', () => {
    const raw = [
      '# Map',
      '## Branch',
      '```ts',
      '[[FenceBacktick.png]]',
      '```',
      '~~~',
      '[[FenceTilde.png]]',
      '~~~',
      '',
      '    [[IndentedCode.png]]',
      '',
      '$$[[InlineMathBlock.png]]$$',
      '',
      '$$',
      '[[MultilineMath.png]]',
      '$$',
      '',
      '%% [[SingleComment.png]] %%',
      '',
      '%%',
      '[[MultiComment.png]]',
      '%%',
      '',
      '---',
    ].join('\n');
    const { doc, target, lines } = parseBranch(raw);
    const res = verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      for (const ln of [2, 3, 4, 5, 6, 7, 9, 11, 13, 14, 15, 17, 19, 20, 21, 23]) {
        expect(res.visibleLines.get(ln)?.trim()).toBe('');
      }
    }
  });

  it('enforces R1.2 <= 3 column indent and tab-stop rules plus CommonMark depth-drop auto-close for quoted code fences', () => {
    // Valid ``` fence inside blockquote followed by active link
    const validBacktick = parseBranch(
      ['# Map', '## Branch', '> ```', '> [[Fake.png]]', '> ```', '> [[Real.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        validBacktick.doc,
        validBacktick.target,
        validBacktick.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 5 });
    expect(
      verifyBranchReferenceCoverage(
        validBacktick.doc,
        validBacktick.target,
        validBacktick.lines,
        makeSnapshot({ links: [singleRef(validBacktick.lines, 5, '[[Real.png]]')] }),
      ).status,
    ).toBe('ok');

    // <= 3 spaces ~~~ IS a fence
    const twoSpaceTilde = parseBranch(
      ['# Map', '## Branch', '>   ~~~', '> [[Fake.png]]', '>   ~~~'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        twoSpaceTilde.doc,
        twoSpaceTilde.target,
        twoSpaceTilde.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    // >= 4 spaces ~~~ inside blockquote is NOT a fence (with empty `>` and active `> [[Picture.png]]`)
    const fourSpaceTilde = parseBranch(
      ['# Map', '## Branch', '>     ~~~', '>', '> [[Picture.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        fourSpaceTilde.doc,
        fourSpaceTilde.target,
        fourSpaceTilde.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 4 });

    // 4-space ~~~ does NOT close 2-space ~~~
    const notClosedByFourSpace = parseBranch(
      [
        '# Map',
        '## Branch',
        '>   ~~~',
        '>     ~~~',
        '> [[StillFenced.png]]',
        '>   ~~~',
      ].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        notClosedByFourSpace.doc,
        notClosedByFourSpace.target,
        notClosedByFourSpace.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    // Tab-stop virtual space rules after `>`
    // Col 0: `>\t ~~~` -> `>` (col 1) + `\t` (width 3, virtualSpaces 2) + 1 space = 3 cols (IS a fence)
    const tabThreeCols = parseBranch(
      ['# Map', '## Branch', '>\t ~~~', '> [[Fake.png]]', '>\t ~~~'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        tabThreeCols.doc,
        tabThreeCols.target,
        tabThreeCols.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    // Col 0: `>\t  ~~~` -> virtualSpaces 2 + 2 spaces = 4 cols (NOT a fence)
    const tabFourCols = parseBranch(
      ['# Map', '## Branch', '>\t  ~~~', '> [[Active.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        tabFourCols.doc,
        tabFourCols.target,
        tabFourCols.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });

    // Indented quote `  >\t   ~~~`: 2 spaces + `>` (col 3) + `\t` (width 1, virtualSpaces 0) + 3 spaces = 3 cols (IS a fence)
    const indentedTabThreeCols = parseBranch(
      ['# Map', '## Branch', '  >\t   ~~~', '  > [[Fake.png]]', '  >\t   ~~~'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        indentedTabThreeCols.doc,
        indentedTabThreeCols.target,
        indentedTabThreeCols.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    // Indented quote `  >\t    ~~~`: virtualSpaces 0 + 4 spaces = 4 cols (NOT a fence)
    const indentedTabFourCols = parseBranch(
      ['# Map', '## Branch', '  >\t    ~~~', '  > [[Active.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        indentedTabFourCols.doc,
        indentedTabFourCols.target,
        indentedTabFourCols.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });

    // CommonMark depth-drop auto-close: `> > ``` ` followed by `> [[Real.png]]`
    const depthDropFence = parseBranch(
      ['# Map', '## Branch', '> > ```', '> [[Real.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        depthDropFence.doc,
        depthDropFence.target,
        depthDropFence.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });
  });

  it('handles R1.3 quote math $$ same-line close, mid-line spans, multiline blocks, and depth-drop auto-close', () => {
    // Exact R1.3 regression: `> $$x$$ and [[Picture.png]]` + `> [[Other.png]]` dropping each one-by-one
    const sameLinePlusNext = parseBranch(
      ['# Map', '## Branch', '> $$x$$ and [[Picture.png]]', '> [[Other.png]]'].join('\n'),
    );
    const picItem = singleRef(sameLinePlusNext.lines, 2, '[[Picture.png]]');
    const otherItem = singleRef(sameLinePlusNext.lines, 3, '[[Other.png]]');

    expect(
      verifyBranchReferenceCoverage(
        sameLinePlusNext.doc,
        sameLinePlusNext.target,
        sameLinePlusNext.lines,
        makeSnapshot({ links: [otherItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    expect(
      verifyBranchReferenceCoverage(
        sameLinePlusNext.doc,
        sameLinePlusNext.target,
        sameLinePlusNext.lines,
        makeSnapshot({ links: [picItem] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });

    expect(
      verifyBranchReferenceCoverage(
        sameLinePlusNext.doc,
        sameLinePlusNext.target,
        sameLinePlusNext.lines,
        makeSnapshot({ links: [picItem, otherItem] }),
      ).status,
    ).toBe('ok');

    // Mid-line $$...$$ span + multiple spans
    const midLineMath = parseBranch(
      [
        '# Map',
        '## Branch',
        '> text $$[[Fake1.png]]$$ and [[Real1.png]]',
        '> $$[[A.png]]$$ mid $$[[B.png]]$$ and [[Real2.png]]',
      ].join('\n'),
    );
    const real1 = singleRef(midLineMath.lines, 2, '[[Real1.png]]');
    const real2 = singleRef(midLineMath.lines, 3, '[[Real2.png]]');
    expect(
      verifyBranchReferenceCoverage(
        midLineMath.doc,
        midLineMath.target,
        midLineMath.lines,
        makeSnapshot({ links: [real2] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        midLineMath.doc,
        midLineMath.target,
        midLineMath.lines,
        makeSnapshot({ links: [real1] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });
    expect(
      verifyBranchReferenceCoverage(
        midLineMath.doc,
        midLineMath.target,
        midLineMath.lines,
        makeSnapshot({ links: [real1, real2] }),
      ).status,
    ).toBe('ok');

    // Multiline `> $$\n> [[Fake.png]]\n> $$ and [[Real.png]]`
    const multilineMath = parseBranch(
      ['# Map', '## Branch', '> $$', '> [[Fake.png]]', '> $$ and [[Real.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        multilineMath.doc,
        multilineMath.target,
        multilineMath.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 4 });
    expect(
      verifyBranchReferenceCoverage(
        multilineMath.doc,
        multilineMath.target,
        multilineMath.lines,
        makeSnapshot({ links: [singleRef(multilineMath.lines, 4, '[[Real.png]]')] }),
      ).status,
    ).toBe('ok');

    // Unclosed mid-line `$$` does NOT mask trailing link
    const unclosedMidMath = parseBranch(
      ['# Map', '## Branch', '> text $$ [[Real.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        unclosedMidMath.doc,
        unclosedMidMath.target,
        unclosedMidMath.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    // Depth-drop auto-close for `> > $$`
    const depthDropMath = parseBranch(
      ['# Map', '## Branch', '> > $$', '> [[Real.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        depthDropMath.doc,
        depthDropMath.target,
        depthDropMath.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 3 });
  });

  it('masks multiline Obsidian comments in visibleLines, checks same-line trailing links, and carries pre-branch state safely', () => {
    // Multiline comment with cached link inside
    const cachedInComment = parseBranch(
      ['# Map', '## Branch', '%%', '[[Ignored.png]]', '%%'].join('\n'),
    );
    const ignoredRef = singleRef(cachedInComment.lines, 3, '[[Ignored.png]]');
    const okComment = verifyBranchReferenceCoverage(
      cachedInComment.doc,
      cachedInComment.target,
      cachedInComment.lines,
      makeSnapshot({ links: [ignoredRef] }),
    );
    expect(okComment.status).toBe('ok');
    if (okComment.status === 'ok') {
      expect(
        okComment.visibleLines
          .get(3)
          ?.slice(ignoredRef.position.startCol, ignoredRef.position.endCol)
          .trim(),
      ).toBe('');
    }

    // Same-line close + trailing link at branch end and mid-line
    const sameLineEnd = parseBranch(
      ['# Map', '## Branch', '%% note %% [[Real.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        sameLineEnd.doc,
        sameLineEnd.target,
        sameLineEnd.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        sameLineEnd.doc,
        sameLineEnd.target,
        sameLineEnd.lines,
        makeSnapshot({ links: [singleRef(sameLineEnd.lines, 2, '[[Real.png]]')] }),
      ).status,
    ).toBe('ok');

    const sameLineMid = parseBranch(
      ['# Map', '## Branch', 'Text %% note %% [[Real.png]]', '## Sibling', 'Text'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        sameLineMid.doc,
        sameLineMid.target,
        sameLineMid.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        sameLineMid.doc,
        sameLineMid.target,
        sameLineMid.lines,
        makeSnapshot({ links: [singleRef(sameLineMid.lines, 2, '[[Real.png]]')] }),
      ).status,
    ).toBe('ok');

    // Pre-branch `%%` carry-over into ## Branch
    const carryOver = parseBranch(
      [
        '# Map',
        '## Before',
        'Intro %% open comment',
        '## Branch',
        '[[Ignored.png]] %%',
        '[[Real.png]]',
      ].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(carryOver.doc, carryOver.target, carryOver.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 5 });
    const carryOk = verifyBranchReferenceCoverage(
      carryOver.doc,
      carryOver.target,
      carryOver.lines,
      makeSnapshot({ links: [singleRef(carryOver.lines, 5, '[[Real.png]]')] }),
    );
    expect(carryOk.status).toBe('ok');
    if (carryOk.status === 'ok') {
      expect(carryOk.visibleLines.get(3)?.trim()).toBe('');
      expect(carryOk.visibleLines.get(4)?.trim()).toBe('');
    }

    // Pre-branch `%%` inside fenced-code does NOT leak inComment = true
    const codeBeforeBranch = parseBranch(
      ['# Map', '## Before', '```', '%% not open', '```', '## Branch', '[[Real.png]]'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        codeBeforeBranch.doc,
        codeBeforeBranch.target,
        codeBeforeBranch.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 6 });

    // Direct UTF-16 length & code span transition check on maskObsidianCommentsInLine
    const line = 'Use `%%` %% hidden';
    const maskedRes = maskObsidianCommentsInLine(line, false);
    expect(maskedRes.masked.length).toBe(line.length);
    expect(maskedRes.inComment).toBe(true);
    expect(maskedRes.masked).toBe('Use `%%`          ');
  });
});

describe('verifyBranchReferenceCoverage — footnotes, reference links, and HTML (FR-5 / FR-6 / R1.4 / OQ-2)', () => {
  it('rejects footnote-def, link-ref-def, inline footnotes, and snapshot footnote/ref entries', () => {
    const fnDef = parseBranch(['# Map', '## Branch', 'Text', '', '[^1]: Footnote'].join('\n'));
    expect(
      verifyBranchReferenceCoverage(fnDef.doc, fnDef.target, fnDef.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 4 });

    const refDef = parseBranch(['# Map', '## Branch', 'Text', '', '[ref]: Note.md'].join('\n'));
    expect(
      verifyBranchReferenceCoverage(refDef.doc, refDef.target, refDef.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 4 });

    // Nested inside blockquote and callout
    for (const nestedRaw of [
      ['# Map', '## Branch', '> [^1]: note'].join('\n'),
      ['# Map', '## Branch', '> [ref]: Note.md'].join('\n'),
      ['# Map', '## Branch', '> [!note] [ref]: Note.md'].join('\n'),
    ]) {
      const fx = parseBranch(nestedRaw);
      expect(verifyBranchReferenceCoverage(fx.doc, fx.target, fx.lines, EMPTY_SNAPSHOT)).toMatchObject(
        { status: 'rejected', code: 'unsafe-reference', line: 2 },
      );
    }

    // Commented footnote definition is allowed
    const commentedFn = parseBranch(['# Map', '## Branch', '> %% [^1]: note %%'].join('\n'));
    expect(
      verifyBranchReferenceCoverage(
        commentedFn.doc,
        commentedFn.target,
        commentedFn.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    // Inline [^1] in blockquote, table, trailing-paragraph, list-item
    for (const inlineRaw of [
      ['# Map', '## Branch', '> Quote[^1]'].join('\n'),
      ['# Map', '## Branch', '| Cell[^1] |', '| --- |'].join('\n'),
      ['# Map', '## Branch', '> quote', '', 'Trailing[^1]'].join('\n'),
      ['# Map', '## Branch', '- Item[^1]'].join('\n'),
    ]) {
      const fx = parseBranch(inlineRaw);
      expect(verifyBranchReferenceCoverage(fx.doc, fx.target, fx.lines, EMPTY_SNAPSHOT)).toMatchObject(
        { status: 'rejected', code: 'unsafe-reference' },
      );
    }

    // Escaped \[^1] and inline code `[^1]` are safe
    const safeFn = parseBranch(
      ['# Map', '## Branch', '> Escaped \\[^1] and `[^1]`'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(safeFn.doc, safeFn.target, safeFn.lines, EMPTY_SNAPSHOT).status,
    ).toBe('ok');

    // Snapshot footnote/referenceLinks inside vs outside branch
    const cleanBranch = parseBranch(
      ['# Map', '## Branch', 'Clean line', '## Sibling', 'Other line'].join('\n'),
    );
    const inBranchPos = { startLine: 2, startCol: 0, endLine: 2, endCol: 4 };
    const outBranchPos = { startLine: 4, startCol: 0, endLine: 4, endCol: 4 };
    expect(
      verifyBranchReferenceCoverage(
        cleanBranch.doc,
        cleanBranch.target,
        cleanBranch.lines,
        makeSnapshot({ footnotes: [inBranchPos] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        cleanBranch.doc,
        cleanBranch.target,
        cleanBranch.lines,
        makeSnapshot({ footnoteRefs: [inBranchPos] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        cleanBranch.doc,
        cleanBranch.target,
        cleanBranch.lines,
        makeSnapshot({ referenceLinks: [inBranchPos] }),
      ),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        cleanBranch.doc,
        cleanBranch.target,
        cleanBranch.lines,
        makeSnapshot({
          footnotes: [outBranchPos],
          footnoteRefs: [outBranchPos],
          referenceLinks: [outBranchPos],
        }),
      ).status,
    ).toBe('ok');
  });

  it('rejects defined reference-style links across the document while ignoring undefined brackets', () => {
    for (const useLine of ['> [see][ref]', '> [ref][]', '> [  REF  ]']) {
      const fx = parseBranch(
        ['# Map', '## Branch', useLine, '## Other', '[ref]: Note.md'].join('\n'),
      );
      expect(verifyBranchReferenceCoverage(fx.doc, fx.target, fx.lines, EMPTY_SNAPSHOT)).toMatchObject(
        { status: 'rejected', code: 'unsafe-reference', line: 2 },
      );
    }

    const undefinedBrackets = parseBranch(
      ['# Map', '## Branch', '> [TODO] check and [a][b]', '## Other', '[ref]: Note.md'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        undefinedBrackets.doc,
        undefinedBrackets.target,
        undefinedBrackets.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');
  });

  it('enforces R1.4 + OQ-2 on HTML blocks, inline HTML tags, split-tags, and safe HTML comments/attributes', () => {
    // Safe HTML comments & non-link / external HTML
    for (const safeHtmlRaw of [
      ['# Map', '## Branch', '<!-- [[Ignored.png]] -->'].join('\n'),
      ['# Map', '## Branch', '<!--', '[[Ignored.png]]', '-->'].join('\n'),
      ['# Map', '## Branch', '<!-- https://example.com -->'].join('\n'),
      ['# Map', '## Branch', '<div>text</div>'].join('\n'),
      ['# Map', '## Branch', '<div data-src="Picture.png">x</div>'].join('\n'),
      ['# Map', '## Branch', '<a href="https://example.com" title="example href=Note.md">x</a>'].join(
        '\n',
      ),
      ['# Map', '## Branch', '<img src="#local" alt="see src=Picture.png">'].join('\n'),
    ]) {
      const fx = parseBranch(safeHtmlRaw);
      expect(
        verifyBranchReferenceCoverage(fx.doc, fx.target, fx.lines, EMPTY_SNAPSHOT).status,
      ).toBe('ok');
    }

    // Unsafe HTML blocks
    for (const unsafeHtmlRaw of [
      ['# Map', '## Branch', '<div><img src="Picture.png"></div>'].join('\n'),
      ['# Map', '## Branch', '<div><a href="Note.md">x</a></div>'].join('\n'),
      ['# Map', '## Branch', '<div>[[Picture.png]]</div>'].join('\n'),
      ['# Map', '## Branch', '<div><a/href="Note.md">x</a></div>'].join('\n'),
      ['# Map', '## Branch', '<div>', '<img', 'src="Picture.png">', '</div>'].join('\n'),
      ['# Map', '## Branch', '<div>', 'https://example.com `code` [[Cached.png]]', '</div>'].join(
        '\n',
      ),
    ]) {
      const fx = parseBranch(unsafeHtmlRaw);
      expect(
        verifyBranchReferenceCoverage(fx.doc, fx.target, fx.lines, EMPTY_SNAPSHOT),
      ).toMatchObject({ status: 'rejected', code: 'unsafe-reference' });
    }

    // Inline HTML outside html-block
    for (const unsafeInlineRaw of [
      ['# Map', '## Branch', 'See <img src="Picture.png">'].join('\n'),
      ['# Map', '## Branch', 'See https://example.com `code` <img src="Picture.png">'].join('\n'),
      ['# Map', '## Branch', '> Quoted <a href="Note.md">link</a>'].join('\n'),
    ]) {
      const fx = parseBranch(unsafeInlineRaw);
      expect(
        verifyBranchReferenceCoverage(fx.doc, fx.target, fx.lines, EMPTY_SNAPSHOT),
      ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });
    }

    // Inline code and external inline HTML are safe
    const safeInlineHtml = parseBranch(
      [
        '# Map',
        '## Branch',
        'Code `<img src="Picture.png">` and <img src="https://example.com/a.png">',
      ].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        safeInlineHtml.doc,
        safeInlineHtml.target,
        safeInlineHtml.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');

    // Bug 3 split-tag: `<!-- ok --> <img src=\n"Picture.png">` (top-level & blockquote) and `href=\n"Note.md"`
    const splitTop = parseBranch(
      ['# Map', '## Branch', '<!-- ok --> <img src=', '"Picture.png">'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(splitTop.doc, splitTop.target, splitTop.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });

    const splitHref = parseBranch(
      ['# Map', '## Branch', '<!-- ok --> <a href=', '"Note.md">x</a>'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(splitHref.doc, splitHref.target, splitHref.lines, EMPTY_SNAPSHOT),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });

    const splitQuote = parseBranch(
      ['# Map', '## Branch', '> <!-- ok --> <img src=', '> "Picture.png">'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        splitQuote.doc,
        splitQuote.target,
        splitQuote.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 2 });

    // Blank line between unclosed tag start and continuation does NOT false-positive
    const splitBlank = parseBranch(
      ['# Map', '## Branch', '<!-- ok --> <img src=', '', '"Picture.png">'].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        splitBlank.doc,
        splitBlank.target,
        splitBlank.lines,
        EMPTY_SNAPSHOT,
      ).status,
    ).toBe('ok');
  });
});

describe('verifyBranchReferenceCoverage & inlineMarkdown — Challenger bugs, <...> edge cases, ReDoS O(L), and large-doc', () => {
  it('handles Challenger R1 Bug 5 (unclosed ![[ followed by [[Picture.png]])', () => {
    const raw = ['# Map', '## Branch', '![[unclosed [[Picture.png]]'].join('\n');
    const { doc, target, lines } = parseBranch(raw);

    expect(verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT)).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
      line: 2,
    });
    expect(
      verifyBranchReferenceCoverage(
        doc,
        target,
        lines,
        makeSnapshot({ links: [singleRef(lines, 2, '[[Picture.png]]')] }),
      ).status,
    ).toBe('ok');
  });

  it('handles Challenger R2 Bug 1 (backtick desync inside link destination/title)', () => {
    const titleBacktickTop = parseBranch(
      ['# Map', '## Branch', '[a](https://example.com "use `foo") [secret](Picture.png) `bar`'].join(
        '\n',
      ),
    );
    expect(
      verifyBranchReferenceCoverage(
        titleBacktickTop.doc,
        titleBacktickTop.target,
        titleBacktickTop.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });
    expect(
      verifyBranchReferenceCoverage(
        titleBacktickTop.doc,
        titleBacktickTop.target,
        titleBacktickTop.lines,
        makeSnapshot({
          links: [singleRef(titleBacktickTop.lines, 2, '[secret](Picture.png)')],
        }),
      ).status,
    ).toBe('ok');

    const titleBacktickQuote = parseBranch(
      [
        '# Map',
        '## Branch',
        '> [a](https://example.com "use `foo") [secret](Picture.png) `bar`',
      ].join('\n'),
    );
    expect(
      verifyBranchReferenceCoverage(
        titleBacktickQuote.doc,
        titleBacktickQuote.target,
        titleBacktickQuote.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    const bareDestBacktick = parseBranch(
      ['# Map', '## Branch', '[a](https://example.com/?q=`) ![secret](Picture.png) `bar`'].join(
        '\n',
      ),
    );
    expect(
      verifyBranchReferenceCoverage(
        bareDestBacktick.doc,
        bareDestBacktick.target,
        bareDestBacktick.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'metadata-updating', line: 2 });

    const htmlBlockBacktick = parseBranch(
      ['# Map', '## Branch', '<div>', '[a](https://example.com/?q=`) [secret](Note.md) `bar`', '</div>'].join(
        '\n',
      ),
    );
    expect(
      verifyBranchReferenceCoverage(
        htmlBlockBacktick.doc,
        htmlBlockBacktick.target,
        htmlBlockBacktick.lines,
        EMPTY_SNAPSHOT,
      ),
    ).toMatchObject({ status: 'rejected', code: 'unsafe-reference', line: 3 });
  });

  it('handles Reviewer R2 <...> empty/whitespace angle-bracket destination edge cases', () => {
    for (const input of ['[ ](<   > )', '[ "[ ](<   > )" ]', '[a](<   >)']) {
      const tokens = tokenizeInlineMarkdown(input);
      expect(tokens.some((t) => t.kind === 'mdlink')).toBe(false);
    }

    const nestedLabelTokens = tokenizeInlineMarkdown('[ [ ](<   > ) ](Note.md)');
    expect(nestedLabelTokens).toEqual([
      {
        kind: 'mdlink',
        raw: '[ [ ](<   > ) ](Note.md)',
        rawTarget: 'Note.md',
        label: '[ ](<   > )',
      },
    ]);
  });

  it('processes adversarial ReDoS inputs in linear time without backtracking blowup', () => {
    const tokenizerCases: ReadonlyArray<{ name: string; input: string }> = [
      { name: '50k unclosed [', input: '['.repeat(50_000) },
      { name: '50k [ + ](', input: '['.repeat(50_000) + '](' },
      { name: '25k nested [ + ]( + )', input: '[ '.repeat(25_000) + ']('.repeat(25_000) + ')' },
      {
        name: '25k bare-paren loop',
        input: '[ '.repeat(25_000) + '](a(b)'.repeat(25_000) + ' x )',
      },
      {
        name: '25k angle-dest > x )',
        input: '[ '.repeat(25_000) + '](<'.repeat(25_000) + '> x )',
      },
      {
        name: '25k angle-dest > "t" x )',
        input: '[ '.repeat(25_000) + '](<'.repeat(25_000) + '> "t" x )',
      },
      {
        name: '25k backtick + [a](x "`")',
        input: '[ '.repeat(12_500) + '[a](x "`") ' + '['.repeat(12_500) + ' ` ',
      },
      {
        name: 'increasing backtick runs',
        input:
          '[ '.repeat(1_000) +
          Array.from({ length: 800 }, (_, k) => '`'.repeat(k + 1)).join(' ') +
          ' ](x)',
      },
    ];

    for (const tc of tokenizerCases) {
      const t0 = performance.now();
      const tokens = tokenizeInlineMarkdown(tc.input);
      const elapsedMs = performance.now() - t0;
      expect(tokens.length, tc.name).toBeGreaterThan(0);
      expect(elapsedMs, `${tc.name} elapsedMs=${elapsedMs}`).toBeLessThan(1_000);
    }

    const coverageAdversarialCases: ReadonlyArray<{ name: string; bodyLines: readonly string[] }> = [
      { name: '50k [', bodyLines: ['['.repeat(50_000)] },
      { name: '50k [ + ](', bodyLines: ['['.repeat(50_000) + ']('] },
      { name: '25k paired [ + ]( + )', bodyLines: ['[ '.repeat(25_000) + ']('.repeat(25_000) + ')'] },
      { name: '50k unclosed backticks', bodyLines: ['`'.repeat(50_000) + ' text'] },
      { name: '20k %% markers', bodyLines: ['%% '.repeat(20_000) + 'text'] },
      { name: '5k nested >', bodyLines: ['> '.repeat(5_000) + 'clean text'] },
      { name: '20k unclosed <a in html-block', bodyLines: ['<div>', '<a '.repeat(20_000) + 'data-x="1"', '</div>'] },
    ];

    for (const tc of coverageAdversarialCases) {
      const fx = parseBranch(['# Map', '## Branch', ...tc.bodyLines].join('\n'));
      const t0 = performance.now();
      const res = verifyBranchReferenceCoverage(fx.doc, fx.target, fx.lines, EMPTY_SNAPSHOT);
      const elapsedMs = performance.now() - t0;
      expect(res.status, tc.name).toBe('ok');
      expect(elapsedMs, `${tc.name} elapsedMs=${elapsedMs}`).toBeLessThan(1_000);
    }
  });

  // 参考計測 (Reference measurement, Design Doc §11 Load Test):
  // Design Doc NFR-1 sets < 10ms as the warm-JIT target for 5,000-topic / ~1.8MB documents;
  // cold-JIT runs have been measured around ~29ms in O(L) time, so CI uses a non-flaky < 1,000ms guard.
  it('scales linearly on a 5,000-topic (~1.8MB) document with protected blocks (参考計測)', () => {
    const parts: string[] = ['# Large Map', '## Target'];
    const pad = 'x'.repeat(300);
    for (let i = 1; i <= 4_999; i += 1) {
      parts.push(`- Topic ${i}`);
      parts.push(`  > [ext-${i}](https://example.com/${i}) ${pad}`);
    }
    const raw = parts.join('\n');
    expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(1_600_000);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(2 * 1024 * 1024);

    const { doc, target, lines } = parseBranch(raw, 'Target');
    expect(doc.topicCount).toBe(5_000);

    const t0 = performance.now();
    const okRes = verifyBranchReferenceCoverage(doc, target, lines, EMPTY_SNAPSHOT);
    const elapsedMs = performance.now() - t0;
    expect(okRes.status).toBe('ok');
    expect(elapsedMs).toBeLessThan(1_000);

    // Also verify uncached protected-block link detection inside the 5,000-topic branch
    const rawWithUncached = raw.replace(
      `  > [ext-4999](https://example.com/4999) ${pad}`,
      `  > [[TargetMissing.png]] ${pad}`,
    );
    const missing = parseBranch(rawWithUncached, 'Target');
    const t1 = performance.now();
    const rejectedRes = verifyBranchReferenceCoverage(
      missing.doc,
      missing.target,
      missing.lines,
      EMPTY_SNAPSHOT,
    );
    const rejectedElapsedMs = performance.now() - t1;
    expect(rejectedRes).toMatchObject({
      status: 'rejected',
      code: 'metadata-updating',
    });
    expect(rejectedElapsedMs).toBeLessThan(1_000);
  });
});
