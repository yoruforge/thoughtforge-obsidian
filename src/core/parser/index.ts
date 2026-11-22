import type { ParseResult } from '../model';
import {
  buildMindMapDocument,
  DEFAULT_PARSE_LIMITS,
  type ParseLimits,
} from './treeBuilder';

export function parseMarkdownToMap(
  rawText: string,
  fallbackTitle: string,
  limits?: Partial<ParseLimits>,
): ParseResult {
  return buildMindMapDocument(rawText, fallbackTitle, limits);
}

export { DEFAULT_PARSE_LIMITS, type ParseLimits };
