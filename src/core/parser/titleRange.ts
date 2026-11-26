import type { OffsetRange, TopicLink } from '../model';
import { tokenizeInlineMarkdown } from './inlineMarkdown';

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
  for (const token of tokenizeInlineMarkdown(titleRaw)) {
    if (token.kind === 'wikilink') {
      links.push({ kind: 'wikilink', target: token.target, label: token.label });
    } else if (token.kind === 'mdlink') {
      links.push({ kind: 'markdown', target: token.rawTarget, label: token.label });
    } else if (token.kind === 'url') {
      links.push({ kind: 'url', target: token.raw, label: token.raw });
    }
  }
  return links;
}

export function formatDisplayTitle(titleRaw: string): string {
  let out = '';
  for (const token of tokenizeInlineMarkdown(titleRaw)) {
    if (token.kind === 'plain') {
      out += token.text;
    } else if (token.kind === 'wikilink' || token.kind === 'mdlink') {
      out += token.label;
    } else {
      out += token.raw;
    }
  }
  return out.trim();
}
