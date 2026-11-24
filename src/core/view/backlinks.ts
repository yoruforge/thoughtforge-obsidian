import type { MindMapDocument } from '../model';
import type { BacklinkItem } from '../../sync/ports';
import { resolveTopicBySubpath, splitLinkTargetSubpath } from './topicResolver';

/**
 * Returns true ONLY when `rawLink` carries an explicit `#subpath` (heading, nested
 * `#Parent#Child` heading path, or `#^block-id`) that resolves via `resolveTopicBySubpath`
 * to the exact `targetNodeId` in `doc`.
 *
 * This guarantees that `[[Target#One#Summary]]` marks ONLY `One > Summary` as a direct
 * backlink and NEVER falsely marks a duplicate `Two > Summary` sibling.
 */
export function doesLinkTargetTopicNode(
  doc: MindMapDocument,
  rawLink: string,
  targetNodeId: string,
  options?: { readonly decodeUrl?: boolean },
): boolean {
  const { subpath } = splitLinkTargetSubpath(rawLink, {
    decodePath: options?.decodeUrl ?? false,
  });
  if (subpath === undefined) {
    return false;
  }
  return resolveTopicBySubpath(doc, subpath) === targetNodeId;
}

/**
 * Sorts backlinks deterministically: direct anchor matches (`targetsSpecificAnchor: true`)
 * first, then alphabetical by display title and source path.
 */
export function sortBacklinks(items: readonly BacklinkItem[]): readonly BacklinkItem[] {
  return [...items].sort((a, b) => {
    if (a.targetsSpecificAnchor !== b.targetsSpecificAnchor) {
      return a.targetsSpecificAnchor ? -1 : 1;
    }
    const titleCmp = a.sourceTitle.localeCompare(b.sourceTitle);
    if (titleCmp !== 0) return titleCmp;
    return a.sourcePath.localeCompare(b.sourcePath);
  });
}

export function formatSourceTitleFromPath(sourcePath: string): string {
  const fileName = sourcePath.split('/').pop() ?? sourcePath;
  return fileName.replace(/\.md$/i, '');
}
