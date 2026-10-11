import type { SourcePosition, SourceRange } from "../domain.js";
import type { TextPatch } from "../patch.js";
import { reject } from "./patch-commands.js";
import { hashOwnRange } from "./range-hash.js";

export type Edit = Readonly<{ start: number; end: number; text: string }>;

/** Strict UTF-16 coordinates over LF text, including the real empty EOF line. */
export class PatchSource {
  readonly lines: string[];
  readonly starts: number[] = [];
  readonly text: string;
  constructor(text: string) {
    this.text = text;
    if (text.includes("\r")) reject("structure-changed");
    this.lines = text.split("\n");
    let offset = 0;
    for (const line of this.lines) { this.starts.push(offset); offset += line.length + 1; }
  }
  offset(position: SourcePosition): number {
    const { line, column } = position;
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || line > this.lines.length
      || column < 1 || column > this.lines[line - 1].length + 1) reject("structure-changed");
    return this.starts[line - 1] + column - 1;
  }
  position(offset: number): SourcePosition {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.text.length) reject("structure-changed");
    let low = 0, high = this.starts.length;
    while (low + 1 < high) { const mid = (low + high) >>> 1; if (this.starts[mid] <= offset) low = mid; else high = mid; }
    return { line: low + 1, column: offset - this.starts[low] + 1 };
  }
  bounds(range: SourceRange): [number, number] {
    const start = this.offset(range.start), end = this.offset(range.end);
    if (start > end) reject("structure-changed");
    return [start, end];
  }
  slice(range: SourceRange): string { const [start, end] = this.bounds(range); return this.text.slice(start, end); }
  hashRange(range: SourceRange): string { const [start, end] = this.bounds(range); return hashOwnRange(this.text, start, end, this); }
  replace(range: SourceRange, text: string): Edit { const [start, end] = this.bounds(range); return { start, end, text }; }
  /** Remove exactly the owned lines and one delimiter, keeping surrounding blank lines. */
  deleteLines(range: SourceRange): Edit {
    let [start, end] = this.bounds(range);
    if (range.start.column !== 1 || range.end.column !== this.lines[range.end.line - 1].length + 1) reject("structure-changed");
    if (this.text[end] === "\n") end++;
    else if (start > 0) start--;
    return { start, end, text: "" };
  }
  beforeLine(line: number, body: string): Edit {
    const start = this.offset({ line, column: 1 });
    return { start, end: start, text: body + "\n" };
  }
  afterRange(range: SourceRange, body: string): Edit {
    const [, end] = this.bounds(range);
    return { start: end, end, text: "\n" + body };
  }
  patches(edits: readonly Edit[]): TextPatch[] {
    // Adjacent edits are composed on the same original coordinate space. This
    // also removes delete/insert ambiguity at the same offset.
    const ordered = edits.filter(edit => edit.text !== this.text.slice(edit.start, edit.end))
      .map(edit => ({ ...edit })).sort((a, b) => a.start - b.start || a.end - b.end);
    const combined: { start: number; end: number; text: string }[] = [];
    for (const edit of ordered) {
      this.position(edit.start); this.position(edit.end);
      if (edit.start > edit.end || edit.text.includes("\r")) reject("structure-changed");
      const previous = combined.at(-1);
      if (previous && edit.start < previous.end) reject("structure-changed");
      if (previous && edit.start === previous.end) { previous.end = edit.end; previous.text += edit.text; }
      else combined.push(edit);
    }
    return combined.map(edit => ({ range: { start: this.position(edit.start), end: this.position(edit.end) }, text: edit.text }));
  }
}

export function validatePatches(source: PatchSource, patches: readonly TextPatch[]): void {
  const bounds = patches.map(patch => {
    if (patch.text.includes("\r")) reject("structure-changed");
    return source.bounds(patch.range);
  }).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i][0] < bounds[i - 1][1] || bounds[i][0] === bounds[i - 1][0]) reject("structure-changed");
  }
}
