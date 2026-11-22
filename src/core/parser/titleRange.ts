import type { OffsetRange, TopicLink } from '../model';

export interface ParsedTitleParts {
  readonly titleRaw: string;
  readonly displayTitle: string;
  readonly titleRange: OffsetRange;
  readonly preservedPrefix: string;
  readonly preservedBlockId: string | null;
  readonly links: readonly TopicLink[];
}

const TASK_PREFIX_RE = /^(\[[^[\]]\][ \t]+)/;
const BLOCK_ID_SUFFIX_RE = /([ \t]+\^[a-zA-Z0-9-]+)[ \t]*$/;
const CLOSING_ATX_HASHES_RE = /[ \t]+#+[ \t]*$/;

/**
 * Extracts editable title range while protecting task markers ("[ ] ", "[x] ")
 * and trailing Obsidian block IDs ("^block-id") from accidental overwrites.
 */
export function parseTitleParts(
  lineText: string,
  lineStartOffset: number,
  contentStartColumn: number,
  isHeading: boolean,
): ParsedTitleParts {
  let contentStart = contentStartColumn;
  let contentEnd = lineText.length;

  if (isHeading) {
    const rawSlice = lineText.slice(contentStart, contentEnd);
    const closingMatch = CLOSING_ATX_HASHES_RE.exec(rawSlice);
    if (closingMatch && closingMatch.index !== undefined) {
      contentEnd = contentStart + closingMatch.index;
    }
  }

  let preservedPrefix = '';
  if (!isHeading) {
    const sliceAfterMarker = lineText.slice(contentStart, contentEnd);
    const taskMatch = TASK_PREFIX_RE.exec(sliceAfterMarker);
    if (taskMatch && taskMatch[1] !== undefined) {
      preservedPrefix = taskMatch[1];
      contentStart += preservedPrefix.length;
    }
  }

  let preservedBlockId: string | null = null;
  const sliceBeforeBlockId = lineText.slice(contentStart, contentEnd);
  const blockIdMatch = BLOCK_ID_SUFFIX_RE.exec(sliceBeforeBlockId);
  if (blockIdMatch && blockIdMatch[1] !== undefined) {
    preservedBlockId = blockIdMatch[1].trim();
    contentEnd = contentStart + blockIdMatch.index;
  }

  // Trim trailing whitespace outside the editable range.
  while (contentEnd > contentStart) {
    const ch = lineText[contentEnd - 1];
    if (ch === ' ' || ch === '\t') {
      contentEnd -= 1;
    } else {
      break;
    }
  }

  const titleRaw = lineText.slice(contentStart, contentEnd);
  const links = extractTitleLinks(titleRaw);
  const displayTitle = formatDisplayTitle(titleRaw);

  return {
    titleRaw,
    displayTitle,
    titleRange: {
      start: lineStartOffset + contentStart,
      end: lineStartOffset + contentEnd,
    },
    preservedPrefix,
    preservedBlockId,
    links,
  };
}

export function extractTitleLinks(titleRaw: string): readonly TopicLink[] {
  const links: TopicLink[] = [];
  const seenSpans: Array<{ start: number; end: number }> = [];

  const overlaps = (start: number, end: number): boolean =>
    seenSpans.some((span) => start < span.end && end > span.start);

  // 1. Wikilinks [[target]] or [[target|alias]] (exclude embeds ![[...]])
  const wikilinkRe = /(?<!!)\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g;
  for (const match of titleRaw.matchAll(wikilinkRe)) {
    const index = match.index;
    const rawTarget = match[1];
    if (index === undefined || rawTarget === undefined) continue;
    const target = rawTarget.trim();
    const label = (match[2] ?? target).trim();
    if (target.length > 0) {
      links.push({ kind: 'wikilink', target, label });
      seenSpans.push({ start: index, end: index + match[0].length });
    }
  }

  // 2. Markdown links [label](target) (exclude images ![alt](...))
  const mdLinkRe = /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g;
  for (const match of titleRaw.matchAll(mdLinkRe)) {
    const index = match.index;
    const rawLabel = match[1];
    const rawTarget = match[2];
    if (index === undefined || rawLabel === undefined || rawTarget === undefined) continue;
    const end = index + match[0].length;
    if (overlaps(index, end)) continue;
    links.push({ kind: 'markdown', target: rawTarget.trim(), label: rawLabel.trim() });
    seenSpans.push({ start: index, end });
  }

  // 3. Bare http/https URLs
  const urlRe = /https?:\/\/[^\s<>()]+/g;
  for (const match of titleRaw.matchAll(urlRe)) {
    const index = match.index;
    if (index === undefined) continue;
    const rawUrl = match[0].replace(/[.,;:!?]+$/, '');
    const end = index + rawUrl.length;
    if (rawUrl.length === 0 || overlaps(index, end)) continue;
    links.push({ kind: 'url', target: rawUrl, label: rawUrl });
    seenSpans.push({ start: index, end });
  }

  return links;
}

export function formatDisplayTitle(titleRaw: string): string {
  const withoutWikiSyntax = titleRaw.replace(
    /(?<!!)\[\[([^[\]|]+)(?:\|([^[\]]+))?\]\]/g,
    (_full, target: string, alias?: string) => (alias ?? target).trim(),
  );
  const withoutMdLinks = withoutWikiSyntax.replace(
    /(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_full, label: string) => label.trim(),
  );
  return withoutMdLinks.trim();
}
