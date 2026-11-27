import { describe, expect, it } from 'vitest';
import {
  MarkdownView,
  TFile,
  TFolder,
  type App,
  type CachedMetadata,
  type EmbedCache,
  type LinkCache,
  type TAbstractFile,
} from 'obsidian';
import { editableMap } from '../../src/core/patch/extractBranch';
import { createHistoryAnchor } from '../../src/core/view/topicResolver';
import { ExtractionAdapter } from '../../src/obsidian/ExtractionAdapter';
import { FileCoordinator } from '../../src/sync/FileCoordinator';
import type { ExtractionRecord } from '../../src/sync/branchExtraction';

function makeFakeTFile(filePath: string): TFile {
  const ctor = TFile as unknown as new (p: string) => TFile;
  return new ctor(filePath);
}

function makeFakeTFolder(folderPath: string): TFolder {
  const ctor = TFolder as unknown as new (p: string) => TFolder;
  return new ctor(folderPath);
}

function makeFakeMarkdownView(file: TFile | null, data: string, viewData: string): MarkdownView {
  const ctor = MarkdownView as unknown as new (
    f: TFile | null,
    d: string,
    vd: string,
  ) => MarkdownView;
  return new ctor(file, data, viewData);
}

function computeOffset(lines: readonly string[], line: number, col: number): number {
  let offset = 0;
  for (let i = 0; i < line; i += 1) {
    offset += (lines[i] ?? '').length + 1;
  }
  return offset + col;
}

function cachedSpan(
  lines: readonly string[],
  line: number,
  needle: string,
  link: string,
): LinkCache {
  const lineText = lines[line] ?? '';
  const startCol = lineText.indexOf(needle);
  if (startCol < 0) {
    throw new Error(`Span ${needle} not found on line ${line}: ${lineText}`);
  }
  const endCol = startCol + needle.length;
  return {
    link,
    original: needle,
    position: {
      start: { line, col: startCol, offset: computeOffset(lines, line, startCol) },
      end: { line, col: endCol, offset: computeOffset(lines, line, endCol) },
    },
  };
}

function cachedEmbedSpan(
  lines: readonly string[],
  line: number,
  needle: string,
  link: string,
): EmbedCache {
  return cachedSpan(lines, line, needle, link);
}

function cachedMultilineSpan(
  lines: readonly string[],
  startLine: number,
  startAnchor: string,
  endLine: number,
  endSuffix: string,
  link: string,
): LinkCache {
  const startCol = (lines[startLine] ?? '').indexOf(startAnchor);
  if (startCol < 0) {
    throw new Error(`Start anchor ${startAnchor} not found on line ${startLine}`);
  }
  const endIdx = (lines[endLine] ?? '').indexOf(endSuffix);
  if (endIdx < 0) {
    throw new Error(`End suffix ${endSuffix} not found on line ${endLine}`);
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
    link,
    original: parts.join('\n'),
    position: {
      start: { line: startLine, col: startCol, offset: computeOffset(lines, startLine, startCol) },
      end: { line: endLine, col: endCol, offset: computeOffset(lines, endLine, endCol) },
    },
  };
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx >= 0 ? filePath.slice(0, idx) : '';
}

class MockObsidianHarness {
  readonly files = new Map<string, { file: TFile; content: string }>();
  readonly folders = new Map<string, TFolder>();
  readonly caches = new Map<string, CachedMetadata | null>();
  readonly leaves: Array<{ view: MarkdownView }> = [];
  readonly recordsList: ExtractionRecord[] = [];

  createCount = 0;
  processCount = 0;
  onAfterCreate?: (path: string) => void;
  onGenerateLink?: (dest: string) => void;

  adapter: ExtractionAdapter;
  coordinator: FileCoordinator;

  constructor() {
    this.folders.set('', makeFakeTFolder(''));
    const app = this.buildApp();
    this.adapter = new ExtractionAdapter(
      app,
      () => this.recordsList,
      async (record) => {
        const cloned = structuredClone(record);
        const idx = this.recordsList.findIndex((r) => r.id === cloned.id);
        if (idx >= 0) {
          this.recordsList[idx] = cloned;
        } else {
          this.recordsList.push(cloned);
        }
      },
      async (id) => {
        const idx = this.recordsList.findIndex((r) => r.id === id);
        if (idx >= 0) {
          this.recordsList.splice(idx, 1);
        }
      },
    );
    this.coordinator = new FileCoordinator(this.adapter, { extractionHost: this.adapter });
  }

  seedFile(filePath: string, content = '', cache: CachedMetadata | null = { links: [], embeds: [] }): TFile {
    const dir = dirname(filePath);
    if (dir) {
      let prefix = '';
      for (const part of dir.split('/')) {
        prefix = prefix ? `${prefix}/${part}` : part;
        if (!this.folders.has(prefix)) {
          this.folders.set(prefix, makeFakeTFolder(prefix));
        }
      }
    }
    const file = makeFakeTFile(filePath);
    this.files.set(filePath, { file, content });
    this.caches.set(filePath, cache);
    return file;
  }

  getContent(filePath: string): string | undefined {
    return this.files.get(filePath)?.content;
  }

  private resolveLinkDest(linkpath: string, sourcePath: string): TFile | null {
    const clean = linkpath.trim().replace(/^\/+/, '');
    if (!clean) return null;

    const exact = this.files.get(clean)?.file ?? this.files.get(`${clean}.md`)?.file;
    if (exact) return exact;

    const sourceDir = dirname(sourcePath);
    if (sourceDir) {
      const rel =
        this.files.get(`${sourceDir}/${clean}`)?.file ??
        this.files.get(`${sourceDir}/${clean}.md`)?.file;
      if (rel) return rel;
    }

    if (!clean.includes('/')) {
      const matches: TFile[] = [];
      for (const { file } of this.files.values()) {
        if (
          file.path === clean ||
          file.path === `${clean}.md` ||
          file.path.endsWith(`/${clean}`) ||
          file.path.endsWith(`/${clean}.md`) ||
          file.basename === clean
        ) {
          matches.push(file);
        }
      }
      matches.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
      return matches[0] ?? null;
    }

    return null;
  }

  private buildApp(): App {
    return {
      vault: {
        configDir: '.obsidian',
        getFileByPath: (p: string) => this.files.get(p)?.file ?? null,
        getAbstractFileByPath: (p: string) =>
          this.files.get(p)?.file ?? this.folders.get(p) ?? null,
        getAllLoadedFiles: (): TAbstractFile[] => [
          ...this.folders.values(),
          ...[...this.files.values()].map((e) => e.file),
        ].filter((entry) => entry.path !== '') as unknown as TAbstractFile[],
        createFolder: async (p: string) => {
          if (this.folders.has(p) || this.files.has(p)) {
            throw new Error(`Folder already exists: ${p}`);
          }
          const folder = makeFakeTFolder(p);
          this.folders.set(p, folder);
          return folder;
        },
        create: async (p: string, data: string) => {
          if (this.files.has(p) || this.folders.has(p)) {
            throw new Error(`File already exists: ${p}`);
          }
          const file = makeFakeTFile(p);
          this.files.set(p, { file, content: data });
          this.caches.set(p, { links: [], embeds: [] });
          this.createCount += 1;
          this.adapter.changed(p);
          this.onAfterCreate?.(p);
          return file;
        },
        read: async (file: TFile) => {
          const entry = this.files.get(file.path);
          if (!entry) throw new Error(`File not found: ${file.path}`);
          return entry.content;
        },
        process: async (file: TFile, fn: (current: string) => string) => {
          const entry = this.files.get(file.path);
          if (!entry) throw new Error(`File not found: ${file.path}`);
          const next = fn(entry.content);
          this.files.set(file.path, { file: entry.file, content: next });
          this.processCount += 1;
          this.adapter.changed(file.path);
          return next;
        },
      },
      metadataCache: {
        getFileCache: (file: TFile) =>
          this.caches.has(file.path) ? (this.caches.get(file.path) ?? null) : null,
        getFirstLinkpathDest: (linkpath: string, sourcePath: string) =>
          this.resolveLinkDest(linkpath, sourcePath),
      },
      fileManager: {
        generateMarkdownLink: (
          file: TFile,
          _sourcePath: string,
          _subpath?: string,
          alias?: string,
        ) => {
          this.onGenerateLink?.(file.path);
          const stem = file.path.replace(/\.md$/i, '');
          return alias ? `[[${stem}|${alias}]]` : `[[${stem}]]`;
        },
      },
      workspace: {
        getLeavesOfType: (type: string) => (type === 'markdown' ? this.leaves : []),
      },
    } as unknown as App;
  }
}

function buildAnchor(raw: string, branchTitle = 'Branch') {
  const doc = editableMap(raw, 'Map');
  const target = [...doc.nodes.values()].find(
    (n) => n.titleRaw === branchTitle && n.id !== doc.rootId,
  );
  if (!target) throw new Error(`Branch not found: ${branchTitle}`);
  return createHistoryAnchor(doc, target);
}

describe('ExtractionAdapter + FileCoordinator protected-block integration (M3 / R2)', () => {
  it('enforces all 3 conditions across blockquote, callout (header & body), table, and trailing-paragraph', async () => {
    const protectedBlocks: ReadonlyArray<{
      readonly name: string;
      readonly collisionBody: readonly string[];
      readonly safeBody: readonly string[];
      readonly buildCollisionCache: (lines: readonly string[]) => CachedMetadata;
      readonly buildSafeCache: (lines: readonly string[]) => CachedMetadata;
    }> = [
      {
        name: 'blockquote',
        collisionBody: ['> [[Picture.png]]'],
        safeBody: ['> [[Projects/Picture.png]]'],
        buildCollisionCache: (lines) => ({
          links: [cachedSpan(lines, 2, '[[Picture.png]]', 'Picture.png')],
        }),
        buildSafeCache: (lines) => ({
          links: [cachedSpan(lines, 2, '[[Projects/Picture.png]]', 'Projects/Picture.png')],
        }),
      },
      {
        name: 'blockquote-embed',
        collisionBody: ['> ![[Picture.png]]'],
        safeBody: ['> ![[Projects/Picture.png]]'],
        buildCollisionCache: (lines) => ({
          embeds: [cachedEmbedSpan(lines, 2, '![[Picture.png]]', 'Picture.png')],
        }),
        buildSafeCache: (lines) => ({
          embeds: [cachedEmbedSpan(lines, 2, '![[Projects/Picture.png]]', 'Projects/Picture.png')],
        }),
      },
      {
        name: 'callout-header',
        collisionBody: ['> [!note] [[Picture.png]]'],
        safeBody: ['> [!note] [[Projects/Picture.png]]'],
        buildCollisionCache: (lines) => ({
          links: [cachedSpan(lines, 2, '[[Picture.png]]', 'Picture.png')],
        }),
        buildSafeCache: (lines) => ({
          links: [cachedSpan(lines, 2, '[[Projects/Picture.png]]', 'Projects/Picture.png')],
        }),
      },
      {
        name: 'callout-body',
        collisionBody: ['> [!note] Header', '> [[Picture.png]]'],
        safeBody: ['> [!note] Header', '> [[Projects/Picture.png]]'],
        buildCollisionCache: (lines) => ({
          links: [cachedSpan(lines, 3, '[[Picture.png]]', 'Picture.png')],
        }),
        buildSafeCache: (lines) => ({
          links: [cachedSpan(lines, 3, '[[Projects/Picture.png]]', 'Projects/Picture.png')],
        }),
      },
      {
        name: 'table',
        collisionBody: ['| Col |', '| --- |', '| [[Picture.png\\|Alias]] |'],
        safeBody: ['| Col |', '| --- |', '| [[Diagram.png\\|Fig]] |'],
        buildCollisionCache: (lines) => ({
          links: [cachedSpan(lines, 4, '[[Picture.png\\|Alias]]', 'Picture.png')],
        }),
        buildSafeCache: (lines) => ({
          links: [cachedSpan(lines, 4, '[[Diagram.png\\|Fig]]', 'Diagram.png')],
        }),
      },
      {
        name: 'trailing-paragraph',
        collisionBody: ['%% marker %%', '', 'Trailing [[Picture.png]]'],
        safeBody: ['%% marker %%', '', 'Trailing [[Diagram.png]]'],
        buildCollisionCache: (lines) => ({
          links: [cachedSpan(lines, 4, '[[Picture.png]]', 'Picture.png')],
        }),
        buildSafeCache: (lines) => ({
          links: [cachedSpan(lines, 4, '[[Diagram.png]]', 'Diagram.png')],
        }),
      },
    ];

    for (const block of protectedBlocks) {
      // Condition 1: Stale/empty cache AND null cache -> metadata-updating, 0 writes
      for (const initialCache of [{ links: [], embeds: [] }, null] as Array<CachedMetadata | null>) {
        const harness = new MockObsidianHarness();
        const sourceRaw = ['# Map', '## Branch', ...block.collisionBody].join('\n');
        harness.seedFile('Projects/Picture.png', 'png');
        harness.seedFile('Archive/Picture.png', 'png');
        harness.seedFile('Projects/Map.md', sourceRaw, initialCache);

        const outcome = await harness.coordinator.extract({
          source: 'Projects/Map.md',
          destination: 'Archive/Branch.md',
          before: sourceRaw,
          anchor: buildAnchor(sourceRaw),
        });
        expect(outcome.accepted, `${block.name} cond1`).toBe(false);
        if (!outcome.accepted) {
          expect(outcome.reason).toBe('metadata-updating');
        }
        expect(harness.createCount).toBe(0);
        expect(harness.processCount).toBe(0);
        expect(harness.getContent('Projects/Map.md')).toBe(sourceRaw);
        expect(harness.getContent('Archive/Branch.md')).toBeUndefined();
        expect(harness.recordsList).toHaveLength(0);
      }

      // Condition 2: Fresh cache, resolves differently in Archive/ -> unsafe-reference, 0 writes
      {
        const harness = new MockObsidianHarness();
        const sourceRaw = ['# Map', '## Branch', ...block.collisionBody].join('\n');
        const lines = sourceRaw.split('\n');
        harness.seedFile('Projects/Picture.png', 'png');
        harness.seedFile('Archive/Picture.png', 'png');
        harness.seedFile('Projects/Map.md', sourceRaw, block.buildCollisionCache(lines));

        const outcome = await harness.coordinator.extract({
          source: 'Projects/Map.md',
          destination: 'Archive/Branch.md',
          before: sourceRaw,
          anchor: buildAnchor(sourceRaw),
        });
        expect(outcome.accepted, `${block.name} cond2`).toBe(false);
        if (!outcome.accepted) {
          expect(outcome.reason).toBe('unsafe-reference');
        }
        expect(harness.createCount).toBe(0);
        expect(harness.processCount).toBe(0);
        expect(harness.getContent('Projects/Map.md')).toBe(sourceRaw);
        expect(harness.getContent('Archive/Branch.md')).toBeUndefined();
        expect(harness.recordsList).toHaveLength(0);
      }

      // Condition 3: Fresh cache, resolves identically in Archive/ -> succeeds, byte-for-byte identical
      {
        const harness = new MockObsidianHarness();
        const sourceRaw = ['# Map', '## Branch', ...block.safeBody].join('\n');
        const lines = sourceRaw.split('\n');
        harness.seedFile('Projects/Picture.png', 'png');
        harness.seedFile('Archive/Picture.png', 'png');
        harness.seedFile('Assets/Diagram.png', 'png');
        harness.seedFile('Projects/Map.md', sourceRaw, block.buildSafeCache(lines));

        const outcome = await harness.coordinator.extract({
          source: 'Projects/Map.md',
          destination: 'Archive/Branch.md',
          before: sourceRaw,
          anchor: buildAnchor(sourceRaw),
        });
        expect(outcome.accepted, `${block.name} cond3`).toBe(true);
        expect(harness.createCount).toBe(1);
        expect(harness.processCount).toBe(1);
        expect(harness.getContent('Archive/Branch.md')).toBe(
          ['# Branch', ...block.safeBody].join('\n'),
        );
        expect(harness.getContent('Projects/Map.md')).toBe(
          ['# Map', '## [[Archive/Branch]]'].join('\n'),
        );
        expect(harness.recordsList).toHaveLength(0);
        expect(harness.coordinator.getHistoryStatus('Projects/Map.md').undoCount).toBe(1);
      }
    }
  });

  it('enforces all R1 4 edge cases end-to-end through ExtractionAdapter + FileCoordinator', async () => {
    // R1.1 + OQ-1: multiline Markdown link uncached -> metadata-updating
    {
      const harness = new MockObsidianHarness();
      const raw = ['# Map', '## Branch', '> [multi', '> line](Picture.png)'].join('\n');
      harness.seedFile('Projects/Picture.png', 'png');
      harness.seedFile('Projects/Map.md', raw, { links: [], embeds: [] });

      const outcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe('metadata-updating');
      expect(harness.createCount).toBe(0);
      expect(harness.processCount).toBe(0);
    }

    // R1.1 + OQ-1: multiline Markdown link cached internal -> unsafe-reference
    {
      const harness = new MockObsidianHarness();
      const raw = ['# Map', '## Branch', '> [multi', '> line](Picture.png)'].join('\n');
      const lines = raw.split('\n');
      harness.seedFile('Projects/Picture.png', 'png');
      harness.seedFile('Projects/Map.md', raw, {
        links: [cachedMultilineSpan(lines, 2, '[multi', 3, 'line](Picture.png)', 'Picture.png')],
      });

      const outcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe('unsafe-reference');
      expect(harness.createCount).toBe(0);
      expect(harness.processCount).toBe(0);
    }

    // R1.1 + OQ-1: multiline external URL (even when cached with start.line !== end.line) -> succeeds verbatim
    {
      const harness = new MockObsidianHarness();
      const raw = ['# Map', '## Branch', '> [multi', '> line](https://example.com)'].join('\n');
      const lines = raw.split('\n');
      harness.seedFile('Projects/Map.md', raw, {
        links: [
          cachedMultilineSpan(
            lines,
            2,
            '[multi',
            3,
            'line](https://example.com)',
            'https://example.com',
          ),
        ],
      });

      const outcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(outcome.accepted).toBe(true);
      expect(harness.getContent('Archive/Branch.md')).toBe(
        ['# Branch', '> [multi', '> line](https://example.com)'].join('\n'),
      );
    }

    // R1.2: 4-space indented ~~~ inside blockquote is NOT a fence -> metadata-updating / unsafe-reference
    {
      const harness = new MockObsidianHarness();
      const raw = ['# Map', '## Branch', '>     ~~~', '>', '> [[Picture.png]]'].join('\n');
      harness.seedFile('Projects/Picture.png', 'png');
      harness.seedFile('Archive/Picture.png', 'png');
      harness.seedFile('Projects/Map.md', raw, { links: [], embeds: [] });

      const staleOutcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(staleOutcome.accepted).toBe(false);
      if (!staleOutcome.accepted) expect(staleOutcome.reason).toBe('metadata-updating');
      expect(harness.createCount).toBe(0);

      // Fresh cache with colliding Archive/Picture.png -> unsafe-reference
      harness.caches.set('Projects/Map.md', {
        links: [cachedSpan(raw.split('\n'), 4, '[[Picture.png]]', 'Picture.png')],
      });
      const unsafeOutcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(unsafeOutcome.accepted).toBe(false);
      if (!unsafeOutcome.accepted) expect(unsafeOutcome.reason).toBe('unsafe-reference');
      expect(harness.createCount).toBe(0);
    }

    // R1.2: 2-space indented ~~~ inside blockquote IS a valid fence -> succeeds with empty cache
    {
      const harness = new MockObsidianHarness();
      const raw = ['# Map', '## Branch', '>   ~~~', '>   [[Picture.png]]', '>   ~~~'].join('\n');
      harness.seedFile('Projects/Map.md', raw, { links: [], embeds: [] });

      const outcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(outcome.accepted).toBe(true);
      expect(harness.getContent('Archive/Branch.md')).toBe(
        ['# Branch', '>   ~~~', '>   [[Picture.png]]', '>   ~~~'].join('\n'),
      );
    }

    // R1.2: nested quote depth-drop auto-close (`> > ~~~\n> > [[Fake.png]]\n> [[Picture.png]]`)
    {
      const harness = new MockObsidianHarness();
      const raw = ['# Map', '## Branch', '> > ~~~', '> > [[Fake.png]]', '> [[Picture.png]]'].join(
        '\n',
      );
      harness.seedFile('Projects/Map.md', raw, { links: [], embeds: [] });

      const outcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe('metadata-updating');
      expect(harness.createCount).toBe(0);
    }

    // R1.3: `> $$x$$ and [[Picture.png]]` + `> [[Other.png]]` (dropping each one-by-one, colliding, and safe)
    {
      const raw = ['# Map', '## Branch', '> $$x$$ and [[Picture.png]]', '> [[Other.png]]'].join(
        '\n',
      );
      const lines = raw.split('\n');
      const picSpan = cachedSpan(lines, 2, '[[Picture.png]]', 'Picture.png');
      const otherSpan = cachedSpan(lines, 3, '[[Other.png]]', 'Other.png');

      // Drop Picture.png
      const h1 = new MockObsidianHarness();
      h1.seedFile('Projects/Picture.png', 'png');
      h1.seedFile('Projects/Other.png', 'png');
      h1.seedFile('Projects/Map.md', raw, { links: [otherSpan] });
      const o1 = await h1.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(o1.accepted).toBe(false);
      if (!o1.accepted) expect(o1.reason).toBe('metadata-updating');
      expect(h1.createCount).toBe(0);

      // Drop Other.png
      const h2 = new MockObsidianHarness();
      h2.seedFile('Projects/Picture.png', 'png');
      h2.seedFile('Projects/Other.png', 'png');
      h2.seedFile('Projects/Map.md', raw, { links: [picSpan] });
      const o2 = await h2.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(o2.accepted).toBe(false);
      if (!o2.accepted) expect(o2.reason).toBe('metadata-updating');
      expect(h2.createCount).toBe(0);

      // Both cached, colliding Archive/Picture.png -> unsafe-reference
      const h3 = new MockObsidianHarness();
      h3.seedFile('Projects/Picture.png', 'png');
      h3.seedFile('Archive/Picture.png', 'png');
      h3.seedFile('Projects/Other.png', 'png');
      h3.seedFile('Projects/Map.md', raw, { links: [picSpan, otherSpan] });
      const o3 = await h3.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(o3.accepted).toBe(false);
      if (!o3.accepted) expect(o3.reason).toBe('unsafe-reference');
      expect(h3.createCount).toBe(0);

      // Both cached, unique targets -> succeeds byte-for-byte
      const h4 = new MockObsidianHarness();
      h4.seedFile('Projects/Picture.png', 'png');
      h4.seedFile('Projects/Other.png', 'png');
      h4.seedFile('Projects/Map.md', raw, { links: [picSpan, otherSpan] });
      const o4 = await h4.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(o4.accepted).toBe(true);
      expect(h4.getContent('Archive/Branch.md')).toBe(
        ['# Branch', '> $$x$$ and [[Picture.png]]', '> [[Other.png]]'].join('\n'),
      );
    }

    // R1.4 + OQ-2: multiline <img src=\n"Picture.png"> and relative href -> unsafe-reference; safe HTML -> ok
    for (const unsafeHtmlBody of [
      ['<div>', '<img src=', '"Picture.png">', '</div>'],
      ['<div>', '<a', 'href="Note.md">x</a>', '</div>'],
      ['<!-- ok --> <img src=', '"Picture.png">'],
      ['> <!-- ok --> <img src=', '> "Picture.png">'],
    ]) {
      const harness = new MockObsidianHarness();
      const raw = ['# Map', '## Branch', ...unsafeHtmlBody].join('\n');
      harness.seedFile('Projects/Picture.png', 'png');
      harness.seedFile('Projects/Note.md', 'note');
      harness.seedFile('Projects/Map.md', raw, { links: [], embeds: [] });

      const outcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(outcome.accepted).toBe(false);
      if (!outcome.accepted) expect(outcome.reason).toBe('unsafe-reference');
      expect(harness.createCount).toBe(0);
      expect(harness.processCount).toBe(0);
    }

    // Safe HTML -> succeeds verbatim
    {
      const harness = new MockObsidianHarness();
      const raw = [
        '# Map',
        '## Branch',
        '<!-- [[Ignored.png]] -->',
        '<div><a href="https://example.com">ext</a></div>',
      ].join('\n');
      harness.seedFile('Projects/Map.md', raw, { links: [], embeds: [] });

      const outcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(outcome.accepted).toBe(true);
      expect(harness.getContent('Archive/Branch.md')).toBe(
        [
          '# Branch',
          '<!-- [[Ignored.png]] -->',
          '<div><a href="https://example.com">ext</a></div>',
        ].join('\n'),
      );
    }
  });

  it('preserves valid top-level/quoted code fences, quoted math, and Obsidian comments verbatim with empty cache', async () => {
    const harness = new MockObsidianHarness();
    const raw = [
      '# Map',
      '## Branch',
      '```md',
      '[[Picture.png]]',
      '```',
      '~~~md',
      '[[Picture.png]]',
      '~~~',
      '> ```',
      '> [[Picture.png]]',
      '> ```',
      '> ~~~',
      '> [[Picture.png]]',
      '> ~~~',
      '> $$',
      '> [[Picture.png]]',
      '> $$',
      '%%',
      '[[IgnoredInComment.png]]',
      '%%',
    ].join('\n');
    const lines = raw.split('\n');
    // Simulate Obsidian erroneously caching a link inside a multiline %% comment
    harness.seedFile('Projects/Map.md', raw, {
      links: [cachedSpan(lines, 18, '[[IgnoredInComment.png]]', 'IgnoredInComment.png')],
      embeds: [],
    });

    const outcome = await harness.coordinator.extract({
      source: 'Projects/Map.md',
      destination: 'Archive/Branch.md',
      before: raw,
      anchor: buildAnchor(raw),
    });
    expect(outcome.accepted).toBe(true);
    expect(harness.createCount).toBe(1);
    expect(harness.processCount).toBe(1);
    expect(harness.getContent('Archive/Branch.md')).toBe(
      ['# Branch', ...lines.slice(2)].join('\n'),
    );
  });

  it('stops commitExtraction on post-precheck cache drift during initial extract, retryId, and redoForFile', async () => {
    const raw = ['# Map', '## Branch', '> [[Picture.png]]'].join('\n');
    const lines = raw.split('\n');
    const freshCache: CachedMetadata = {
      links: [cachedSpan(lines, 2, '[[Picture.png]]', 'Picture.png')],
      embeds: [],
    };
    const expectedOutput = ['# Branch', '> [[Picture.png]]'].join('\n');

    // 4a + 4b: Initial extract() post-createNote cache drift (empty cache and null cache) + retryId
    for (const driftCache of [{ links: [], embeds: [] }, null] as Array<CachedMetadata | null>) {
      const harness = new MockObsidianHarness();
      harness.seedFile('Projects/Picture.png', 'png');
      harness.seedFile('Projects/Map.md', raw, freshCache);
      harness.onAfterCreate = (createdPath) => {
        if (createdPath === 'Archive/Branch.md') {
          harness.caches.set('Projects/Map.md', driftCache);
        }
      };

      const initialOutcome = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(initialOutcome.accepted).toBe(false);
      if (!initialOutcome.accepted) {
        expect(initialOutcome.reason).toBe('metadata-updating');
      }
      expect(harness.createCount).toBe(1);
      expect(harness.processCount).toBe(0);
      expect(harness.getContent('Projects/Map.md')).toBe(raw);
      expect(harness.getContent('Archive/Branch.md')).toBe(expectedOutput);
      expect(harness.recordsList).toHaveLength(1);
      const record = harness.recordsList[0]!;
      expect(record.phase).toBe('created');
      expect(record.source).toBe('Projects/Map.md');
      expect(record.destination).toBe('Archive/Branch.md');
      expect(record.output).toBe(expectedOutput);
      expect(harness.coordinator.getHistoryStatus('Projects/Map.md').undoCount).toBe(0);

      // Retry while cache is still stale
      const staleRetry = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
        retryId: record.id,
      });
      expect(staleRetry.accepted).toBe(false);
      if (!staleRetry.accepted) {
        expect(staleRetry.reason).toBe('metadata-updating');
      }
      expect(harness.createCount).toBe(1);
      expect(harness.processCount).toBe(0);
      expect(harness.getContent('Projects/Map.md')).toBe(raw);
      expect(harness.getContent('Archive/Branch.md')).toBe(expectedOutput);
      expect(harness.recordsList[0]?.phase).toBe('created');

      // Restore fresh cache and retry -> succeeds without re-creating destination
      harness.caches.set('Projects/Map.md', freshCache);
      const recoveredRetry = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
        retryId: record.id,
      });
      expect(recoveredRetry.accepted).toBe(true);
      expect(harness.createCount).toBe(1);
      expect(harness.processCount).toBe(1);
      expect(harness.getContent('Projects/Map.md')).toBe('# Map\n## [[Archive/Branch]]');
      expect(harness.getContent('Archive/Branch.md')).toBe(expectedOutput);
      expect(harness.recordsList).toHaveLength(0);
      expect(harness.coordinator.getHistoryStatus('Projects/Map.md').undoCount).toBe(1);
    }

    // 4c: Redo drift (stale cache + newly colliding destination file)
    {
      const harness = new MockObsidianHarness();
      harness.seedFile('Projects/Picture.png', 'png');
      harness.seedFile('Projects/Map.md', raw, freshCache);

      const extracted = await harness.coordinator.extract({
        source: 'Projects/Map.md',
        destination: 'Archive/Branch.md',
        before: raw,
        anchor: buildAnchor(raw),
      });
      expect(extracted.accepted).toBe(true);

      const undone = await harness.coordinator.undoForFile('Projects/Map.md', 'Map');
      expect(undone.accepted).toBe(true);
      expect(harness.getContent('Projects/Map.md')).toBe(raw);
      expect(harness.coordinator.getHistoryStatus('Projects/Map.md').redoCount).toBe(1);
      expect(harness.recordsList).toHaveLength(0);

      // Variant A: cache becomes stale before redo
      harness.caches.set('Projects/Map.md', { links: [], embeds: [] });
      const redoStale = await harness.coordinator.redoForFile('Projects/Map.md', 'Map');
      expect(redoStale.accepted).toBe(false);
      if (!redoStale.accepted) {
        expect(redoStale.reason).toBe('metadata-updating');
      }
      expect(harness.getContent('Projects/Map.md')).toBe(raw);
      expect(harness.getContent('Archive/Branch.md')).toBe(expectedOutput);
      expect(harness.recordsList).toHaveLength(0);
      expect(harness.coordinator.getHistoryStatus('Projects/Map.md').redoCount).toBe(1);

      // Variant B: cache restored, but Archive/Picture.png now collides in destination folder
      harness.caches.set('Projects/Map.md', freshCache);
      harness.seedFile('Archive/Picture.png', 'png');
      const redoCollide = await harness.coordinator.redoForFile('Projects/Map.md', 'Map');
      expect(redoCollide.accepted).toBe(false);
      if (!redoCollide.accepted) {
        expect(redoCollide.reason).toBe('unsafe-reference');
      }
      expect(harness.getContent('Projects/Map.md')).toBe(raw);
      expect(harness.getContent('Archive/Branch.md')).toBe(expectedOutput);
      expect(harness.recordsList).toHaveLength(0);
      expect(harness.coordinator.getHistoryStatus('Projects/Map.md').redoCount).toBe(1);
    }
  });

  it('rejects extraction via editor-dirty guard when an open MarkdownView has unsaved buffer changes', async () => {
    const harness = new MockObsidianHarness();
    const raw = ['# Map', '## Branch', '> Clean text'].join('\n');
    const sourceFile = harness.seedFile('Projects/Map.md', raw, { links: [], embeds: [] });
    harness.leaves.push({
      view: makeFakeMarkdownView(sourceFile, raw, `${raw}\nUnsaved edit`),
    });

    const outcome = await harness.coordinator.extract({
      source: 'Projects/Map.md',
      destination: 'Archive/Branch.md',
      before: raw,
      anchor: buildAnchor(raw),
    });
    expect(outcome.accepted).toBe(false);
    if (!outcome.accepted) {
      expect(outcome.rejectCode).toBe('editor-dirty');
    }
    expect(harness.createCount).toBe(0);
    expect(harness.processCount).toBe(0);
  });
});
