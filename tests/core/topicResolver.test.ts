import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  collectAncestorIds,
  createHistoryAnchor,
  resolveHistoryAnchor,
  resolveTopicAtLine,
  resolveTopicBySubpath,
  splitLinkTargetSubpath,
} from '../../src/core/view/topicResolver';

function parseOk(md: string) {
  const res = parseMarkdownToMap(md, 'Sample');
  if (res.status !== 'ok') throw new Error(`parse failed: ${res.detail}`);
  return res.document;
}

describe('topicResolver (M4-a cursor-to-map & link subpath resolution)', () => {
  const sampleMd = [
    '---',
    'title: Sample',
    '---',
    '# Root Map',
    '## Architecture',
    '- Parser ^blk-parser',
    '  Line 1 of parser note.',
    '  Line 2 of parser note.',
    '  ```ts',
    '  const x = 1;',
    '  ```',
    '- **Sync** Engine',
    '## Roadmap',
    '### Phase 2',
    '- Backlinks ^blk-backlinks',
    '## Archive',
    '### Phase 2',
    '- Old item',
    '',
  ].join('\n');

  it('resolves deepest owning topic for header lines, notes, unmapped blocks, and falls back to root on frontmatter', () => {
    const doc = parseOk(sampleMd);
    const parserNode = [...doc.nodes.values()].find((n) => n.preservedBlockId === '^blk-parser');
    const archNode = [...doc.nodes.values()].find((n) => n.titleRaw === 'Architecture');
    const syncNode = [...doc.nodes.values()].find((n) => n.titleRaw === '**Sync** Engine');
    expect(parserNode).toBeDefined();
    expect(archNode).toBeDefined();
    expect(syncNode).toBeDefined();
    if (!parserNode || !archNode || !syncNode) return;

    // Frontmatter lines (0..2) fall back to root
    expect(resolveTopicAtLine(doc, 0)).toBe(doc.rootId);
    expect(resolveTopicAtLine(doc, 1)).toBe(doc.rootId);
    // Exact header lines
    expect(resolveTopicAtLine(doc, archNode.headerLine)).toBe(archNode.id);
    expect(resolveTopicAtLine(doc, parserNode.headerLine)).toBe(parserNode.id);
    // Note lines & fenced code block lines inside Parser resolve to Parser (not Architecture!)
    expect(resolveTopicAtLine(doc, parserNode.headerLine + 1)).toBe(parserNode.id);
    expect(resolveTopicAtLine(doc, parserNode.headerLine + 2)).toBe(parserNode.id);
    expect(resolveTopicAtLine(doc, parserNode.headerLine + 4)).toBe(parserNode.id);
    // Next sibling resolves to Sync Engine
    expect(resolveTopicAtLine(doc, syncNode.headerLine)).toBe(syncNode.id);
    // Out-of-range line falls back to root
    expect(resolveTopicAtLine(doc, -1)).toBe(doc.rootId);
    expect(resolveTopicAtLine(doc, 999)).toBe(doc.rootId);
  });

  it('resolves headings, nested parent#child headings, formatted titles, URL-encoded subpaths, and block IDs', () => {
    const doc = parseOk(sampleMd);
    const roadmapPhase2 = [...doc.nodes.values()].find(
      (n) =>
        n.titleRaw === 'Phase 2' &&
        doc.nodes.get(n.parentId ?? '')?.titleRaw === 'Roadmap',
    );
    const archivePhase2 = [...doc.nodes.values()].find(
      (n) =>
        n.titleRaw === 'Phase 2' &&
        doc.nodes.get(n.parentId ?? '')?.titleRaw === 'Archive',
    );
    const parserNode = [...doc.nodes.values()].find((n) => n.preservedBlockId === '^blk-parser');
    const syncNode = [...doc.nodes.values()].find((n) => n.titleRaw === '**Sync** Engine');
    expect(roadmapPhase2 && archivePhase2 && parserNode && syncNode).toBeTruthy();
    if (!roadmapPhase2 || !archivePhase2 || !parserNode || !syncNode) return;

    // Nested heading path disambiguates identical "Phase 2" headings
    expect(resolveTopicBySubpath(doc, 'Roadmap#Phase 2')).toBe(roadmapPhase2.id);
    expect(resolveTopicBySubpath(doc, '#Archive#Phase%202', { decodeSubpath: true })).toBe(
      archivePhase2.id,
    );

    // Block ID (exact and case-insensitive)
    expect(resolveTopicBySubpath(doc, '^blk-parser')).toBe(parserNode.id);
    expect(resolveTopicBySubpath(doc, '#^BLK-PARSER')).toBe(parserNode.id);

    // Formatted title resolves via displayTitle ("Sync Engine")
    expect(resolveTopicBySubpath(doc, 'Sync Engine')).toBe(syncNode.id);

    // Non-existent subpath returns null
    expect(resolveTopicBySubpath(doc, 'Does Not Exist')).toBeNull();
    expect(resolveTopicBySubpath(doc, '^missing-id')).toBeNull();
    expect(resolveTopicBySubpath(doc, '')).toBeNull();

    // Literal %20 in heading names matches exact literal heading unless decodeSubpath: true (Codex #8f4c3a4b)
    const percentHeadingDoc = parseOk('# Headings Root\n## Phase%20One\n## Phase One\n');
    const percentHeading = [...percentHeadingDoc.nodes.values()].find(
      (n) => n.titleRaw === 'Phase%20One',
    );
    const spaceHeading = [...percentHeadingDoc.nodes.values()].find(
      (n) => n.titleRaw === 'Phase One',
    );
    expect(percentHeading && spaceHeading).toBeTruthy();
    if (!percentHeading || !spaceHeading) return;
    expect(resolveTopicBySubpath(percentHeadingDoc, 'Phase%20One')).toBe(percentHeading.id);
    expect(resolveTopicBySubpath(percentHeadingDoc, 'Phase One')).toBe(spaceHeading.id);
    expect(resolveTopicBySubpath(percentHeadingDoc, 'Phase%20One', { decodeSubpath: true })).toBe(
      spaceHeading.id,
    );
  });

  it('preserves literal %20 in paths and subpaths by default and decodes Markdown URLs only with decodePath: true, and collects ancestors', () => {
    expect(splitLinkTargetSubpath('Source%20X.md#Heading%201')).toEqual({
      pathPart: 'Source%20X.md',
      subpath: 'Heading%201',
    });
    expect(splitLinkTargetSubpath('My%20Note.md#Heading%201', { decodePath: true })).toEqual({
      pathPart: 'My Note.md',
      subpath: 'Heading 1',
    });
    expect(splitLinkTargetSubpath('Headings.md#Phase%2520One', { decodePath: true })).toEqual({
      pathPart: 'Headings.md',
      subpath: 'Phase%20One',
    });
    expect(splitLinkTargetSubpath('Source%2520X.md', { decodePath: true })).toEqual({
      pathPart: 'Source%20X.md',
      subpath: undefined,
    });
    expect(splitLinkTargetSubpath('#^blk-1')).toEqual({
      pathPart: '',
      subpath: '^blk-1',
    });
    expect(splitLinkTargetSubpath('plain-note')).toEqual({
      pathPart: 'plain-note',
      subpath: undefined,
    });

    const doc = parseOk(sampleMd);
    const backlinksNode = [...doc.nodes.values()].find(
      (n) => n.preservedBlockId === '^blk-backlinks',
    );
    expect(backlinksNode).toBeDefined();
    if (!backlinksNode) return;
    const ancestorTitles = collectAncestorIds(doc, backlinksNode.id).map(
      (id) => doc.nodes.get(id)?.titleRaw,
    );
    expect(ancestorTitles).toEqual(['Phase 2', 'Roadmap', 'Root Map']);
  });

  it('resolves history Back anchors structurally after line shifts and fails closed when unidentifiable (Codex PR #16 P1)', () => {
    const beforeDoc = parseOk('# Root\n- Prior\n- Link [[Target]] ^selected-link\n');
    const linkBefore = [...beforeDoc.nodes.values()].find(
      (n) => n.preservedBlockId === '^selected-link',
    );
    expect(linkBefore).toBeDefined();
    if (!linkBefore) return;

    const anchor = createHistoryAnchor(beforeDoc, linkBefore);
    expect(anchor.hadDuplicateBlockId).toBe(false);

    // 1. Preceding insert shifts Prior onto Link's old line -> MUST resolve to shifted Link (NEVER Prior!)
    const shiftedDoc = parseOk('# Root\n- Inserted\n- Prior\n- Link [[Target]] ^selected-link\n');
    const linkShifted = [...shiftedDoc.nodes.values()].find(
      (n) => n.preservedBlockId === '^selected-link',
    );
    expect(linkShifted).toBeDefined();
    if (!linkShifted) return;
    expect(resolveHistoryAnchor(shiftedDoc, anchor)).toBe(linkShifted.id);

    // 2. Original Link branch deleted while away -> MUST return null (never select Prior!)
    const deletedDoc = parseOk('# Root\n- Inserted\n- Prior\n');
    expect(resolveHistoryAnchor(deletedDoc, anchor)).toBeNull();

    // 3. Without block ID, identical empty twins fail closed after document changes
    const twinBefore = parseOk('# Root\n- Same\n- Same\n');
    const secondTwin = [...twinBefore.nodes.values()].filter((n) => n.titleRaw === 'Same')[1];
    expect(secondTwin).toBeDefined();
    if (!secondTwin) return;
    const twinAnchor = createHistoryAnchor(twinBefore, secondTwin);
    expect(resolveHistoryAnchor(twinBefore, twinAnchor)).toBe(secondTwin.id);
    const twinModified = parseOk('# Root\n- Inserted\n- Same\n');
    expect(resolveHistoryAnchor(twinModified, twinAnchor)).toBeNull();
  });

  it('fails closed when a block ID was duplicated across different parents at capture time (Codex PR #17 P1)', () => {
    const beforeDoc = parseOk(
      [
        '# Root',
        '## Parent A',
        '- Link [[Target]] ^copied',
        '## Parent B',
        '- Link [[Target]] ^copied',
        '',
      ].join('\n'),
    );
    const copies = [...beforeDoc.nodes.values()].filter((n) => n.preservedBlockId === '^copied');
    expect(copies).toHaveLength(2);
    const firstCopy = copies[0];
    expect(firstCopy).toBeDefined();
    if (!firstCopy) return;

    const anchor = createHistoryAnchor(beforeDoc, firstCopy);
    expect(anchor.hadDuplicateBlockId).toBe(true);

    // Byte-identical document still resolves the exact original line
    expect(resolveHistoryAnchor(beforeDoc, anchor)).toBe(firstCopy.id);

    // Deleting the first branch leaves only Parent B's ^copied -> MUST return null (NEVER select Parent B's branch!)
    const afterDeleteFirst = parseOk(
      ['# Root', '## Parent A', '## Parent B', '- Link [[Target]] ^copied', ''].join('\n'),
    );
    expect(resolveHistoryAnchor(afterDeleteFirst, anchor)).toBeNull();

    // Case-insensitive duplicate (^copied vs ^COPIED) also fails closed when modified
    const caseDupDoc = parseOk(
      ['# Root', '## Parent A', '- Link [[Target]] ^copied', '## Parent B', '- Link [[Target]] ^COPIED', ''].join(
        '\n',
      ),
    );
    const caseFirst = [...caseDupDoc.nodes.values()].find((n) => n.preservedBlockId === '^copied');
    expect(caseFirst).toBeDefined();
    if (!caseFirst) return;
    const caseAnchor = createHistoryAnchor(caseDupDoc, caseFirst);
    expect(caseAnchor.hadDuplicateBlockId).toBe(true);
    const afterDeleteCaseFirst = parseOk(
      ['# Root', '## Parent A', '## Parent B', '- Link [[Target]] ^COPIED', ''].join('\n'),
    );
    expect(resolveHistoryAnchor(afterDeleteCaseFirst, caseAnchor)).toBeNull();
  });

  it('preserves intraword underscores in heading resolution regardless of heading order (Codex #5cb909c4)', () => {
    // Order 1: non-underscored heading comes first
    const doc1 = parseOk('# Root\n## buildapiv2\n## build_api_v2\n');
    const plain1 = [...doc1.nodes.values()].find((n) => n.titleRaw === 'buildapiv2');
    const under1 = [...doc1.nodes.values()].find((n) => n.titleRaw === 'build_api_v2');
    expect(plain1 && under1).toBeTruthy();
    if (!plain1 || !under1) return;
    expect(resolveTopicBySubpath(doc1, 'build_api_v2')).toBe(under1.id);
    expect(resolveTopicBySubpath(doc1, 'buildapiv2')).toBe(plain1.id);

    // Order 2: underscored heading comes first
    const doc2 = parseOk('# Root\n## build_api_v2\n## buildapiv2\n');
    const under2 = [...doc2.nodes.values()].find((n) => n.titleRaw === 'build_api_v2');
    const plain2 = [...doc2.nodes.values()].find((n) => n.titleRaw === 'buildapiv2');
    expect(under2 && plain2).toBeTruthy();
    if (!under2 || !plain2) return;
    expect(resolveTopicBySubpath(doc2, 'build_api_v2')).toBe(under2.id);
    expect(resolveTopicBySubpath(doc2, 'buildapiv2')).toBe(plain2.id);

    // Double intraword underscores also stay distinct
    const docDouble = parseOk('# Root\n## foobarbaz\n## foo__bar__baz\n');
    const doublePlain = [...docDouble.nodes.values()].find((n) => n.titleRaw === 'foobarbaz');
    const doubleUnder = [...docDouble.nodes.values()].find((n) => n.titleRaw === 'foo__bar__baz');
    expect(doublePlain && doubleUnder).toBeTruthy();
    if (!doublePlain || !doubleUnder) return;
    expect(resolveTopicBySubpath(docDouble, 'foo__bar__baz')).toBe(doubleUnder.id);
    expect(resolveTopicBySubpath(docDouble, 'foobarbaz')).toBe(doublePlain.id);

    // Genuine emphasis, code spans containing underscores, and spaced asterisks
    const fmtDoc = parseOk(
      [
        '# Root',
        '## __Bold__ and _Italic_',
        '## `_private_`',
        '## **Sync** Engine',
        '## a * b * c',
        '',
      ].join('\n'),
    );
    const boldItalic = [...fmtDoc.nodes.values()].find(
      (n) => n.titleRaw === '__Bold__ and _Italic_',
    );
    const codeUnder = [...fmtDoc.nodes.values()].find((n) => n.titleRaw === '`_private_`');
    const syncEngine = [...fmtDoc.nodes.values()].find((n) => n.titleRaw === '**Sync** Engine');
    const mathMul = [...fmtDoc.nodes.values()].find((n) => n.titleRaw === 'a * b * c');
    expect(boldItalic && codeUnder && syncEngine && mathMul).toBeTruthy();
    if (!boldItalic || !codeUnder || !syncEngine || !mathMul) return;
    expect(resolveTopicBySubpath(fmtDoc, 'Bold and Italic')).toBe(boldItalic.id);
    expect(resolveTopicBySubpath(fmtDoc, '_private_')).toBe(codeUnder.id);
    expect(resolveTopicBySubpath(fmtDoc, 'private')).toBeNull();
    expect(resolveTopicBySubpath(fmtDoc, 'Sync Engine')).toBe(syncEngine.id);
    expect(resolveTopicBySubpath(fmtDoc, 'a * b * c')).toBe(mathMul.id);
  });

  it('strips emphasis wrapping inline code spans while protecting code interiors (Codex #7822c46c)', () => {
    const doc = parseOk(
      [
        '# Headings',
        '## **Use `foo` now**',
        '## **`foo`**',
        '## _Use `foo` now_',
        '## **Use `_private_` now**',
        '',
      ].join('\n'),
    );
    const useFooBold = [...doc.nodes.values()].find((n) => n.titleRaw === '**Use `foo` now**');
    const fooOnlyBold = [...doc.nodes.values()].find((n) => n.titleRaw === '**`foo`**');
    const useFooItalic = [...doc.nodes.values()].find((n) => n.titleRaw === '_Use `foo` now_');
    const usePrivateBold = [...doc.nodes.values()].find(
      (n) => n.titleRaw === '**Use `_private_` now**',
    );
    expect(useFooBold && fooOnlyBold && useFooItalic && usePrivateBold).toBeTruthy();
    if (!useFooBold || !fooOnlyBold || !useFooItalic || !usePrivateBold) return;

    expect(resolveTopicBySubpath(doc, 'Use foo now')).toBe(useFooBold.id);
    expect(resolveTopicBySubpath(doc, 'foo')).toBe(fooOnlyBold.id);
    expect(resolveTopicBySubpath(doc, 'Use foo now')).toBe(useFooBold.id);
    expect(resolveTopicBySubpath(doc, 'Use _private_ now')).toBe(usePrivateBold.id);
    expect(resolveTopicBySubpath(doc, 'Use private now')).toBeNull();

    // First italic heading when checked independently also resolves cleanly
    const italicOnly = parseOk('# Root\n## _Use `foo` now_\n');
    const italicNode = [...italicOnly.nodes.values()].find(
      (n) => n.titleRaw === '_Use `foo` now_',
    );
    expect(italicNode).toBeDefined();
    if (!italicNode) return;
    expect(resolveTopicBySubpath(italicOnly, 'Use foo now')).toBe(italicNode.id);
  });
});
