import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  collectAncestorIds,
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
    expect(resolveTopicBySubpath(doc, '#Archive#Phase%202')).toBe(archivePhase2.id);

    // Block ID (exact and case-insensitive)
    expect(resolveTopicBySubpath(doc, '^blk-parser')).toBe(parserNode.id);
    expect(resolveTopicBySubpath(doc, '#^BLK-PARSER')).toBe(parserNode.id);

    // Formatted title resolves via displayTitle ("Sync Engine")
    expect(resolveTopicBySubpath(doc, 'Sync Engine')).toBe(syncNode.id);

    // Non-existent subpath returns null
    expect(resolveTopicBySubpath(doc, 'Does Not Exist')).toBeNull();
    expect(resolveTopicBySubpath(doc, '^missing-id')).toBeNull();
    expect(resolveTopicBySubpath(doc, '')).toBeNull();
  });

  it('splits link targets with percent-decoded paths and optional subpaths, and collects ancestors', () => {
    expect(splitLinkTargetSubpath('My%20Note.md#Heading%201')).toEqual({
      pathPart: 'My Note.md',
      subpath: 'Heading%201',
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
});
