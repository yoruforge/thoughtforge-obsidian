import type { LineEnding } from '../model';
import type { TextEdit } from './commands';

export function normalizeToLf(rawText: string): string {
  return rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function restoreLineEnding(lfText: string, lineEnding: LineEnding): string {
  if (lineEnding === '\r\n') {
    return lfText.replace(/\n/g, '\r\n');
  }
  return lfText;
}

/**
 * Applies non-overlapping UTF-16 offset edits to LF-normalized text.
 * Throws if any edit is out of bounds or overlaps another edit.
 */
export function applyTextEdits(lfText: string, edits: readonly TextEdit[]): string {
  if (edits.length === 0) {
    return lfText;
  }

  const sorted = [...edits].sort((a, b) => {
    if (b.range.start !== a.range.start) {
      return b.range.start - a.range.start;
    }
    return b.range.end - a.range.end;
  });

  // Validate bounds and non-overlap in descending order.
  let previousStart = lfText.length;
  for (const edit of sorted) {
    const { start, end } = edit.range;
    if (start < 0 || end < start || end > lfText.length) {
      throw new Error(`TextEdit range [${start}, ${end}) is out of bounds (length ${lfText.length}).`);
    }
    if (end > previousStart) {
      throw new Error(`Overlapping TextEdit detected at [${start}, ${end}).`);
    }
    previousStart = start;
  }

  let result = lfText;
  for (const edit of sorted) {
    result = result.slice(0, edit.range.start) + edit.replacement + result.slice(edit.range.end);
  }
  return result;
}
