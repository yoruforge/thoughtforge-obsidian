import { describe, expect, it } from 'vitest';
import { TFile, type App, type CachedMetadata } from 'obsidian';
import { parseMarkdownToMap } from '../../src/core/parser';
import { ObsidianMetadataProvider } from '../../src/obsidian/ObsidianMetadataProvider';

function parseOk(md: string, fallbackTitle: string) {
  const res = parseMarkdownToMap(md, fallbackTitle);
  if (res.status !== 'ok') throw new Error(`parse failed: ${res.detail}`);
  return res.document;
}

interface MockVaultSpec {
  readonly files: ReadonlyMap<string, TFile>;
  readonly fileCaches: ReadonlyMap<string, CachedMetadata>;
  readonly resolvedLinks: Record<string, Record<string, number>>;
  readonly resourceSuffixByPath: Map<string, number>;
}

function createMockApp(spec: MockVaultSpec): App {
  const resolveLinkDest = (linkpath: string): TFile | null => {
    const clean = linkpath.trim();
    const direct = spec.files.get(clean) ?? spec.files.get(`${clean}.md`);
    if (direct) return direct;
    for (const file of spec.files.values()) {
      if (file.basename === clean || file.path.endsWith(`/${clean}`)) {
        return file;
      }
    }
    return null;
  };

  return {
    vault: {
      getAbstractFileByPath: (p: string) => spec.files.get(p) ?? null,
      getResourcePath: (file: TFile) => {
        const rev = spec.resourceSuffixByPath.get(file.path) ?? 1;
        return `app://local/vault/${encodeURIComponent(file.path)}?${rev}`;
      },
    },
    metadataCache: {
      resolvedLinks: spec.resolvedLinks,
      getFileCache: (file: TFile) => spec.fileCaches.get(file.path) ?? null,
      getFirstLinkpathDest: (linkpath: string, _sourcePath: string) => resolveLinkDest(linkpath),
    },
  } as unknown as App;
}

function makeFakeTFile(filePath: string): TFile {
  const ctor = TFile as unknown as new (p: string) => TFile;
  return new ctor(filePath);
}

describe('ObsidianMetadataProvider (M4-b)', () => {
  it('increments version via bumpVersion() and returns refreshed resource URLs after image overwrite', () => {
    const noteFile = makeFakeTFile('note.md');
    const imgFile = makeFakeTFile('assets/pic.png');
    const files = new Map<string, TFile>([
      [noteFile.path, noteFile],
      [imgFile.path, imgFile],
    ]);
    const fileCaches = new Map<string, CachedMetadata>([
      [
        noteFile.path,
        {
          embeds: [
            {
              link: 'assets/pic.png',
              original: '![[assets/pic.png]]',
              position: {
                start: { line: 1, col: 0, offset: 8 },
                end: { line: 1, col: 19, offset: 27 },
              },
            },
          ],
        },
      ],
    ]);
    const resourceSuffixByPath = new Map<string, number>([[imgFile.path, 100]]);
    const provider = new ObsidianMetadataProvider(
      createMockApp({ files, fileCaches, resolvedLinks: {}, resourceSuffixByPath }),
    );
    const doc = parseOk('# Root\n## Visual ![[assets/pic.png]]\n', 'note');
    const visualNode = [...doc.nodes.values()].find((n) => n.titleRaw.includes('Visual'));
    expect(visualNode).toBeDefined();
    if (!visualNode) return;

    expect(provider.getVersion()).toBe(0);
    const before = provider.getResolvedNodeImages('note.md', doc);
    expect(before.get(visualNode.id)?.[0]?.src).toBe('app://local/vault/assets%2Fpic.png?100');

    // Simulate Obsidian updating the attachment resource timestamp on overwrite
    resourceSuffixByPath.set(imgFile.path, 200);
    provider.bumpVersion();
    expect(provider.getVersion()).toBe(1);

    const after = provider.getResolvedNodeImages('note.md', doc);
    expect(after.get(visualNode.id)?.[0]?.src).toBe('app://local/vault/assets%2Fpic.png?200');
  });

  it('assigns leading body images on H1-less central-virtual notes to rootId without stealing line 0 list items', () => {
    const imgFile = makeFakeTFile('pic.png');
    const bodyNote = makeFakeTFile('h1less-body.md');
    const listNote = makeFakeTFile('h1less-list.md');

    const files = new Map<string, TFile>([
      [imgFile.path, imgFile],
      [bodyNote.path, bodyNote],
      [listNote.path, listNote],
    ]);
    const fileCaches = new Map<string, CachedMetadata>([
      [
        bodyNote.path,
        {
          embeds: [
            {
              link: 'pic.png',
              original: '![[pic.png]]',
              position: {
                start: { line: 0, col: 8, offset: 8 },
                end: { line: 0, col: 18, offset: 18 },
              },
            },
          ],
        },
      ],
      [
        listNote.path,
        {
          embeds: [
            {
              link: 'pic.png',
              original: '![[pic.png]]',
              position: {
                start: { line: 0, col: 7, offset: 7 },
                end: { line: 0, col: 17, offset: 17 },
              },
            },
          ],
        },
      ],
    ]);
    const provider = new ObsidianMetadataProvider(
      createMockApp({
        files,
        fileCaches,
        resolvedLinks: {},
        resourceSuffixByPath: new Map(),
      }),
    );

    const bodyDoc = parseOk('Diagram ![[pic.png]]\n\n- Child A\n', 'h1less-body');
    const bodyImages = provider.getResolvedNodeImages(bodyNote.path, bodyDoc);
    expect(bodyImages.get(bodyDoc.rootId)?.map((i) => i.target)).toEqual(['pic.png']);

    // When an H1-less note begins directly with a list item on line 0, only Item owns line 0
    const listDoc = parseOk('- Item ![[pic.png]]\n- Sibling\n', 'h1less-list');
    const itemNode = [...listDoc.nodes.values()].find((n) => n.titleRaw.includes('Item'));
    expect(itemNode).toBeDefined();
    if (!itemNode) return;
    const listImages = provider.getResolvedNodeImages(listNote.path, listDoc);
    expect(listImages.get(listDoc.rootId)).toBeUndefined();
    expect(listImages.get(itemNode.id)?.map((i) => i.target)).toEqual(['pic.png']);
  });

  it('preserves exact literal paths (Source%20X.md vs Source X.md) and resolves 2,000 headings x 100 notes under 200ms', () => {
    const targetFile = makeFakeTFile('Target.md');
    const percentSourceFile = makeFakeTFile('Source%20X.md');
    const spaceSourceFile = makeFakeTFile('Source X.md');

    const files = new Map<string, TFile>([
      [targetFile.path, targetFile],
      [percentSourceFile.path, percentSourceFile],
      [spaceSourceFile.path, spaceSourceFile],
    ]);

    const docLines = ['# Target'];
    for (let i = 1; i <= 2000; i += 1) {
      docLines.push(`## Section ${i}`);
    }
    const doc = parseOk(`${docLines.join('\n')}\n`, 'Target');
    const targetHeading = [...doc.nodes.values()].find((n) => n.titleRaw === 'Section 2000');
    expect(targetHeading).toBeDefined();
    if (!targetHeading) return;

    const trailingLinks = Array.from({ length: 10 }, (_, idx) => ({
      link: `Target#Section ${1991 + idx}`,
      original: `[[Target#Section ${1991 + idx}]]`,
      position: { start: { line: idx, col: 0, offset: 0 }, end: { line: idx, col: 10, offset: 10 } },
    }));

    const fileCaches = new Map<string, CachedMetadata>([
      [
        percentSourceFile.path,
        {
          links: [
            {
              link: 'Target#Section 2000',
              original: '[[Target#Section 2000]]',
              position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 10, offset: 10 } },
            },
          ],
        },
      ],
      [spaceSourceFile.path, { links: trailingLinks }],
    ]);

    const resolvedLinks: Record<string, Record<string, number>> = {
      [percentSourceFile.path]: { [targetFile.path]: 1 },
      [spaceSourceFile.path]: { [targetFile.path]: 10 },
    };

    for (let i = 0; i < 98; i += 1) {
      const f = makeFakeTFile(`notes/bulk-${i}.md`);
      files.set(f.path, f);
      fileCaches.set(f.path, { links: trailingLinks });
      resolvedLinks[f.path] = { [targetFile.path]: 10 };
    }

    const provider = new ObsidianMetadataProvider(
      createMockApp({
        files,
        fileCaches,
        resolvedLinks,
        resourceSuffixByPath: new Map(),
      }),
    );

    const startMs = performance.now();
    const backlinks = provider.getBacklinks(targetFile.path, {
      doc,
      nodeId: targetHeading.id,
    });
    const elapsedMs = performance.now() - startMs;

    expect(backlinks).toHaveLength(100);
    expect(backlinks.some((b) => b.sourcePath === 'Source%20X.md' && b.targetsSpecificAnchor)).toBe(
      true,
    );
    expect(backlinks.some((b) => b.sourcePath === 'Source X.md' && b.targetsSpecificAnchor)).toBe(
      true,
    );
    expect(elapsedMs).toBeLessThan(200);
  });
});
