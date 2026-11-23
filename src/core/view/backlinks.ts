import type { BacklinkItem } from '../../sync/ports';
import { splitLinkTargetSubpath } from './topicResolver';

function stripInlineFormatting(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__|~~)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2');
}

function normalizeAnchorText(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const stripped = decoded.trim().replace(/^#/, '').trim();
  if (stripped.startsWith('^')) {
    return stripped.toLowerCase();
  }
  return stripInlineFormatting(stripped).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Checks whether a raw Obsidian link string (e.g. `TargetNote#Section 1`,
 * `TargetNote#Parent#Section 1`, or `TargetNote#^blk-1`) directly targets one of the
 * topic's anchor candidates (block ID, heading/display title, or raw title).
 */
export function doesLinkSubpathMatchAnchors(
  rawLink: string,
  anchors: readonly string[],
): boolean {
  if (anchors.length === 0) return false;
  const { subpath } = splitLinkTargetSubpath(rawLink);
  if (subpath === undefined) return false;

  const normalizedAnchors = new Set(
    anchors.map(normalizeAnchorText).filter((a) => a.length > 0),
  );
  if (normalizedAnchors.size === 0) return false;

  const normalizedSubpath = normalizeAnchorText(subpath);
  if (normalizedSubpath.length === 0) return false;

  if (normalizedAnchors.has(normalizedSubpath)) {
    return true;
  }

  // For nested heading subpaths like `Parent#Child`, check the leaf heading segment as well.
  if (!normalizedSubpath.startsWith('^') && subpath.includes('#')) {
    const segments = subpath
      .split('#')
      .map(normalizeAnchorText)
      .filter((s) => s.length > 0);
    const leaf = segments[segments.length - 1];
    if (leaf !== undefined && normalizedAnchors.has(leaf)) {
      return true;
    }
  }

  return false;
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
