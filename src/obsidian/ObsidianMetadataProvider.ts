import { TFile, type App } from 'obsidian';
import {
  doesLinkSubpathMatchAnchors,
  formatSourceTitleFromPath,
  sortBacklinks,
} from '../core/view/backlinks';
import { isSafeVaultImagePath } from '../core/view/imageEmbeds';
import { splitLinkTargetSubpath } from '../core/view/topicResolver';
import type { BacklinkItem, NodeMetadataProvider } from '../sync/ports';

/**
 * Obsidian metadataCache-backed implementation of `NodeMetadataProvider` (M4-b).
 * Strictly read-only, uses only public Obsidian APIs (`metadataCache.resolvedLinks`,
 * `metadataCache.getFileCache`, `metadataCache.getFirstLinkpathDest`, `vault.getResourcePath`),
 * and validates image paths against traversal and non-image extensions.
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
    if (!isSafeVaultImagePath(cleanTarget)) {
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

  getBacklinks(
    filePath: string,
    headingOrBlockId?: string | readonly string[],
  ): readonly BacklinkItem[] {
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    if (!resolvedLinks || filePath.length === 0) {
      return [];
    }

    const anchors: readonly string[] =
      headingOrBlockId === undefined
        ? []
        : typeof headingOrBlockId === 'string'
          ? [headingOrBlockId]
          : headingOrBlockId;

    const results: BacklinkItem[] = [];

    for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
      if (sourcePath === filePath) continue;
      if (!targets || (targets[filePath] ?? 0) <= 0) continue;

      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile) || sourceFile.extension.toLowerCase() !== 'md') {
        continue;
      }

      let targetsSpecificAnchor = false;
      if (anchors.length > 0) {
        const cache = this.app.metadataCache.getFileCache(sourceFile);
        const refs = [...(cache?.links ?? []), ...(cache?.embeds ?? [])];
        for (const ref of refs) {
          const rawLink = ref.link;
          if (!rawLink) continue;
          const { pathPart } = splitLinkTargetSubpath(rawLink);
          const resolvedDest =
            pathPart.length === 0
              ? sourceFile
              : this.app.metadataCache.getFirstLinkpathDest(pathPart, sourcePath);
          if (resolvedDest?.path !== filePath) continue;
          if (doesLinkSubpathMatchAnchors(rawLink, anchors)) {
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
