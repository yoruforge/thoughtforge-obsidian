import { isSafeVaultLinkPath } from '../core/view/vaultLinkPath';
import { TFolder, type App } from 'obsidian';
import { tokenizeInlineMarkdown } from '../core/parser/inlineMarkdown';
import { ObsidianHostAdapter } from './ObsidianHostAdapter';
import type { ExtractionHost, ExtractionRecord } from '../sync/branchExtraction';
import {
  editableMap,
  planBranchExtraction,
  validateVaultNotePath,
  type ReferenceEdit,
} from '../core/patch/extractBranch';
import {
  resolveHistoryAnchor,
  resolveTopicBySubpath,
  splitLinkTargetSubpath,
} from '../core/view/topicResolver';
import type { MapHistoryAnchor } from '../core/view/navigationHistory';

export class ExtractionAdapter extends ObsidianHostAdapter implements ExtractionHost {
  private readonly versions = new Map<string, number>();
  constructor(
    private readonly application: App,
    readonly records: () => readonly ExtractionRecord[],
    readonly put: (record: ExtractionRecord) => Promise<void>,
    readonly remove: (id: string) => Promise<void>,
  ) {
    super(application);
  }

  changed(path: string) {
    this.versions.set(path, this.version(path) + 1);
  }
  version(path: string) {
    return this.versions.get(path) ?? 0;
  }
  existingPath(path: string) {
    const vault = this.application.vault;
    const entries = vault
      .getAllLoadedFiles()
      .filter((f) => f.path.toLowerCase() === path.toLowerCase());
    if (entries.length > 1) throw new Error('ambiguous-path');
    return entries[0]?.path ?? null;
  }
  async createNote(path: string, raw: string) {
    validateVaultNotePath(path, '', this.application.vault.configDir);
    const folders = path.split('/').slice(0, -1);
    let prefix = '';
    for (const folder of folders) {
      prefix = prefix ? prefix + '/' + folder : folder;
      const existing = this.application.vault.getAbstractFileByPath(prefix);
      if (!existing) await this.application.vault.createFolder(prefix);
      else if (!(existing instanceof TFolder)) throw new Error('invalid-target-path');
    }
    await this.application.vault.create(path, raw);
  }
  linkTo(destination: string, source: string, alias: string) {
    const app = this.application,
      file = app.vault.getFileByPath(destination);
    if (!file) throw new Error('destination-missing-or-renamed');
    const safeAlias = alias !== file.basename && !/[[\]|\r\n]/.test(alias) ? alias : undefined;
    const generate = (context: string) =>
      app.fileManager.generateMarkdownLink(file, context, undefined, safeAlias);
    // The map blocks parent traversal. Generate the same Obsidian link syntax from the
    // vault root when its relative-path setting would otherwise produce "../".
    for (const context of [source, '']) {
      const link = generate(context);
      const parsed = editableMap('# Check\n- ' + link, 'Check');
      const refs = [...parsed.nodes.values()].at(-1)?.links;
      if (refs?.length !== 1 || !refs[0] || !isSafeVaultLinkPath(refs[0].target)) continue;
      const { pathPart } = splitLinkTargetSubpath(refs[0].target, {
        decodePath: refs[0].kind === 'markdown',
      });
      if (app.metadataCache.getFirstLinkpathDest(pathPart, source)?.path === destination)
        return link;
    }
    throw new Error('invalid-link');
  }

  async referenceEdits(
    source: string,
    before: string,
    anchor: MapHistoryAnchor,
    destination: string,
  ): Promise<readonly ReferenceEdit[]> {
    const app = this.application,
      file = app.vault.getFileByPath(source);
    if (!file || (await app.vault.read(file)) !== before) throw new Error('stale-target');
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) throw new Error('metadata-updating');
    const doc = editableMap(before, file.basename);
    const id = resolveHistoryAnchor(doc, anchor),
      target = id && doc.nodes.get(id);
    if (!target) throw new Error('stale-target');
    const lines = before.split(doc.lineEnding),
      edits: ReferenceEdit[] = [];
    const movedAnchors: { subpath: string; line: number }[] = [];
    const inBranch = (line: number) =>
      line >= target.headerLine && line < target.subtreeRange.endLine;
    if (
      [
        ...(cache.footnoteRefs ?? []),
        ...(cache.footnotes ?? []),
        ...(cache.referenceLinks ?? []),
      ].some((ref) => inBranch(ref.position.start.line))
    ) {
      throw new Error('unsafe-reference');
    }
    const refs = [...(cache.links ?? []), ...(cache.embeds ?? [])];
    const cachedPositions = new Map(
      refs.map((ref) => [ref.position.start.line + ':' + ref.position.start.col, ref.original]),
    );
    for (let line = target.headerLine; line < target.subtreeRange.endLine; line++) {
      if (!['heading', 'list-item', 'topic-note'].includes(doc.lineKinds[line] ?? '')) continue;
      let col = 0;
      for (const token of tokenizeInlineMarkdown(lines[line] ?? '')) {
        const spelling = token.kind === 'plain' ? token.text : token.raw;
        const internal =
          token.kind === 'wikilink' ||
          token.kind === 'wikiembed' ||
          (token.kind === 'mdlink' && !/^[a-z][a-z0-9+.-]*:/i.test(token.rawTarget)) ||
          (token.kind === 'mdimage' && !/\]\(<?[a-z][a-z0-9+.-]*:/i.test(token.raw));
        if (internal && cachedPositions.get(line + ':' + col) !== spelling)
          throw new Error('metadata-updating');
        col += spelling.length;
      }
    }
    for (const ref of refs) {
      const { start, end } = ref.position;
      if (start.line < target.subtreeRange.startLine || start.line >= target.subtreeRange.endLine)
        continue;
      const original = ref.original;
      if (start.line !== end.line || lines[start.line]?.slice(start.col, end.col) !== original)
        throw new Error('metadata-updating');
      const { pathPart, subpath } = splitLinkTargetSubpath(ref.link);
      if (/^https?:\/\//i.test(ref.link)) continue;
      const old = pathPart ? app.metadataCache.getFirstLinkpathDest(pathPart, source) : file;
      if (!old) throw new Error('unresolved-reference');
      let expected = old.path;
      if (expected === source && subpath) {
        const refId = resolveTopicBySubpath(doc, subpath);
        const node = refId && doc.nodes.get(refId);
        if (!node) throw new Error('unresolved-reference');
        if (
          node.headerLine >= target.headerLine &&
          node.headerLine < target.subtreeRange.endLine &&
          !(node.id === target.id && subpath.startsWith('^'))
        ) {
          expected = destination;
          movedAnchors.push({ subpath, line: node.headerLine - target.headerLine });
        }
      }
      const relocated = pathPart
        ? app.metadataCache.getFirstLinkpathDest(pathPart, destination)?.path
        : destination;
      if (relocated === expected && (!pathPart || isSafeVaultLinkPath(pathPart))) continue;
      const wiki = /^!?\[\[/.test(original);
      const mark = wiki ? original.indexOf('[[') + 2 : original.lastIndexOf('](') + 2;
      if (!wiki && mark === 1) throw new Error('unsafe-reference');
      const offset = mark + (original[mark] === '<' ? 1 : 0);
      const rest = original.slice(offset);
      // Replace the destination only, preserving fragments, aliases, titles and exact label spelling.
      const rawPath = wiki ? rest.split(/[#|\]]/, 1)[0] : markdownPathPrefix(rest, pathPart);
      if (rawPath === undefined) throw new Error('unsafe-reference');
      let replacement: string;
      if (expected === destination) {
        replacement = '';
      } else {
        replacement = wiki
          ? expected
          : encodeURI(expected).replace(/#/g, '%23').replace(/\(/g, '%28').replace(/\)/g, '%29');
        if (app.metadataCache.getFirstLinkpathDest(expected, destination)?.path !== expected)
          throw new Error('ambiguous-reference');
      }
      if (rawPath === '') {
        edits.push({
          line: start.line,
          column: start.col + offset,
          original: '#',
          replacement: replacement + '#',
        });
      } else
        edits.push({
          line: start.line,
          column: start.col + offset,
          original: rawPath,
          replacement,
        });
    }
    if (movedAnchors.length) {
      const { output } = planBranchExtraction(before, doc, target, '[[Extracted Branch]]', edits);
      const moved = editableMap(output, target.displayTitle);
      for (const ref of movedAnchors) {
        const resolved = resolveTopicBySubpath(moved, ref.subpath);
        if (!resolved || moved.nodes.get(resolved)?.headerLine !== ref.line)
          throw new Error('unsafe-reference');
      }
    }
    return edits;
  }
}

// Locate the original URL spelling without decoding the remainder (alias, fragment or title).
function markdownPathPrefix(rest: string, decodedPath: string): string | undefined {
  for (let i = 0; i < rest.length; i++) {
    if (!'#)> "'.includes(rest[i]!)) continue;
    const prefix = rest.slice(0, i);
    try {
      if (decodeURIComponent(prefix) === decodedPath) return prefix;
    } catch {
      if (prefix === decodedPath) return prefix;
    }
  }
  return undefined;
}
