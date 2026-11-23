import { TFile, type App } from 'obsidian';
import type { MindMapDocument } from '../core/model';
import { formatSourceTitleFromPath, sortBacklinks } from '../core/view/backlinks';
import {
  defaultImageAltFromPath,
  extractNodeImageEmbeds,
  isNumericImageDimension,
  isSafeVaultImagePath,
} from '../core/view/imageEmbeds';
import { resolveTopicBySubpath, splitLinkTargetSubpath } from '../core/view/topicResolver';
import type {
  BacklinkItem,
  BacklinkQueryTarget,
  NodeMetadataProvider,
  ResolvedNodeImage,
} from '../sync/ports';

/**
 * Obsidian metadataCache-backed implementation of `NodeMetadataProvider` (M4-b).
 * Strictly read-only, uses only public Obsidian APIs (`metadataCache.resolvedLinks`,
 * `metadataCache.getFileCache`, `metadataCache.getFirstLinkpathDest`, `vault.getResourcePath`),
 * aligns embed recognition with Obsidian's own parser (`cache.embeds` + source line ownership)
 * when fresh, and validates all image paths against traversal and non-image extensions.
 */
export class ObsidianMetadataProvider implements NodeMetadataProvider {
  private readonly updatingPaths = new Set<string>();
  private version = 0;

  constructor(private readonly app: App) {}

  getVersion(): number {
    return this.version;
  }

  markFileUpdating(filePath: string): void {
    this.updatingPaths.add(filePath);
  }

  markFileFresh(filePath: string): void {
    this.updatingPaths.delete(filePath);
    this.version += 1;
  }

  markAllFresh(): void {
    this.updatingPaths.clear();
    this.version += 1;
  }

  renamePath(oldPath: string, newPath: string): void {
    if (this.updatingPaths.delete(oldPath)) {
      this.updatingPaths.add(newPath);
    }
    this.version += 1;
  }

  removePath(deletedPath: string): void {
    this.updatingPaths.delete(deletedPath);
    this.version += 1;
  }

  bumpVersion(): void {
    this.version += 1;
  }

  getFreshness(filePath: string, _contentHash: string): 'fresh' | 'updating' {
    if (this.updatingPaths.has(filePath)) {
      return 'updating';
    }
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return 'updating';
    }
    return this.app.metadataCache.getFileCache(file) !== null ? 'fresh' : 'updating';
  }

  getResolvedImageSrc(sourcePath: string, embedText: string): string | null {
    const cleanTarget = embedText.trim();
    if (cleanTarget.length === 0) {
      return null;
    }
    const { pathPart } = splitLinkTargetSubpath(cleanTarget);
    if (pathPart.length === 0 || !isSafeVaultImagePath(pathPart)) {
      return null;
    }
    const dest = this.app.metadataCache.getFirstLinkpathDest(pathPart, sourcePath);
    if (!(dest instanceof TFile) || !isSafeVaultImagePath(dest.path)) {
      return null;
    }
    return this.app.vault.getResourcePath(dest);
  }

  /**
   * Resolves all safe vault image embeds per topic node in `doc`.
   * When Obsidian's `metadataCache` is fresh for `filePath`, uses Obsidian's own parsed
   * `cache.embeds` mapped by exact source line (`headerLine` / `noteRange`) so filename syntax
   * (`pic(1).png`, `<pic one.png>`) and code-span skipping match Obsidian 100%.
   * Falls back to the CommonMark-compliant pure scanner while cache is updating.
   */
  getResolvedNodeImages(
    filePath: string,
    doc: MindMapDocument,
  ): ReadonlyMap<string, readonly ResolvedNodeImage[]> {
    const result = new Map<string, ResolvedNodeImage[]>();
    if (filePath.length === 0) return result;

    const file = this.app.vault.getAbstractFileByPath(filePath);
    const cache =
      file instanceof TFile && !this.updatingPaths.has(filePath)
        ? this.app.metadataCache.getFileCache(file)
        : null;

    if (cache !== null) {
      const ownerByLine = new Map<number, string>();
      for (const node of doc.nodes.values()) {
        // Virtual central roots (H1-less notes) have no real heading line, so skip `headerLine`,
        // but still map their `noteRange` so leading body images appear on the central topic!
        if (node.kind !== 'central-virtual') {
          ownerByLine.set(node.headerLine, node.id);
        }
        if (node.noteRange !== null) {
          for (let line = node.noteRange.startLine; line < node.noteRange.endLine; line += 1) {
            ownerByLine.set(line, node.id);
          }
        }
      }

      const seenPerNode = new Map<string, Set<string>>();
      for (const embed of cache.embeds ?? []) {
        const line = embed.position?.start?.line;
        if (line === undefined) continue;
        const nodeId = ownerByLine.get(line);
        if (nodeId === undefined) continue;

        const rawLink = embed.link?.trim() ?? '';
        const resolvedSrc = this.getResolvedImageSrc(filePath, rawLink);
        if (resolvedSrc === null) continue;

        const { pathPart } = splitLinkTargetSubpath(rawLink);
        const dedupeKey = pathPart.toLowerCase();
        let seen = seenPerNode.get(nodeId);
        if (!seen) {
          seen = new Set<string>();
          seenPerNode.set(nodeId, seen);
        }
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const rawDisplay = embed.displayText?.trim() ?? '';
        const alt =
          rawDisplay.length > 0 && !isNumericImageDimension(rawDisplay)
            ? rawDisplay
            : defaultImageAltFromPath(pathPart);

        let list = result.get(nodeId);
        if (!list) {
          list = [];
          result.set(nodeId, list);
        }
        list.push({ target: pathPart, src: resolvedSrc, alt });
      }
      return result;
    }

    // Fallback while metadataCache is updating (also CommonMark-compliant!)
    for (const node of doc.nodes.values()) {
      const embeds = extractNodeImageEmbeds(node);
      if (embeds.length === 0) continue;
      const list: ResolvedNodeImage[] = [];
      for (const embed of embeds) {
        const resolvedSrc = this.getResolvedImageSrc(filePath, embed.target);
        if (resolvedSrc !== null) {
          list.push({ target: embed.target, src: resolvedSrc, alt: embed.alt });
        }
      }
      if (list.length > 0) {
        result.set(node.id, list);
      }
    }
    return result;
  }

  getBacklinks(filePath: string, target?: BacklinkQueryTarget): readonly BacklinkItem[] {
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    if (!resolvedLinks || filePath.length === 0) {
      return [];
    }

    const results: BacklinkItem[] = [];

    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (sourcePath === filePath) continue;
      if (!targets || (targets[filePath] ?? 0) <= 0) continue;

      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile) || sourceFile.extension.toLowerCase() !== 'md') {
        continue;
      }

      let targetsSpecificAnchor = false;
      if (target !== undefined) {
        const cache = this.app.metadataCache.getFileCache(sourceFile);
        const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? [])];
        const destCache = new Map<string, TFile | null>();
        for (const ref of refs) {
          const rawLink = ref.link;
          if (!rawLink || !rawLink.includes('#')) continue;
          const { pathPart, subpath } = splitLinkTargetSubpath(rawLink);
          if (subpath === undefined) continue;
          let resolvedDest: TFile | null;
          if (pathPart.length === 0) {
            resolvedDest = sourceFile;
          } else if (destCache.has(pathPart)) {
            resolvedDest = destCache.get(pathPart) ?? null;
          } else {
            resolvedDest = this.app.metadataCache.getFirstLinkpathDest(pathPart, sourcePath);
            destCache.set(pathPart, resolvedDest);
          }
          if (resolvedDest?.path !== filePath) continue;
          if (resolveTopicBySubpath(target.doc, subpath) === target.nodeId) {
            targetsSpecificAnchor = true;
            break;
          }
        }
      }

      results.push({
        sourcePath,
        sourceTitle: formatSourceTitleFromPath(sourcePath),
        targetsSpecificAnchor,
      });
    }

    return sortBacklinks(results);
  }
}
