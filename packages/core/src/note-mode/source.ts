import type { SourceRange } from "../domain.js";
import { hashOwnRange } from "./range-hash.js";

// CommonMark blank lines contain only ASCII spaces and tabs. NBSP and other
// Unicode whitespace remain paragraph content and must retain ownership.
export const isBlankLine = (text: string): boolean => /^[ \t]*$/.test(text);

export function visualWidth(text: string, initial = 0): number {
  let column = initial;
  for (const char of text) column += char === "\t" ? 4 - column % 4 : 1;
  return column;
}
export function removeIndent(text: string, width: number): string {
  let column = 0, offset = 0;
  while (offset < text.length && column < width && /[ \t]/.test(text[offset])) {
    column += text[offset++] === "\t" ? 4 - column % 4 : 1;
  }
  return " ".repeat(Math.max(0, column - width)) + text.slice(offset);
}
export function newlineKind(raw: string): "lf" | "crlf" | "mixed" {
  const crlf = raw.includes("\r\n"), remainder = raw.replaceAll("\r\n", "");
  return remainder.includes("\r") || (crlf && remainder.includes("\n")) ? "mixed" : crlf ? "crlf" : "lf";
}
export class NoteSource {
  readonly lines: string[];
  readonly text: string;
  private readonly offsets: number[] = [];
  constructor(text: string) {
    this.text = text;
    this.lines = text.split("\n");
    if (text.endsWith("\n")) this.lines.pop();
    let offset = 0;
    for (const line of this.lines) { this.offsets.push(offset); offset += line.length + 1; }
  }
  range(start: number, end: number): SourceRange {
    return { start: { line: start + 1, column: 1 }, end: { line: end, column: this.lines[end - 1].length + 1 } };
  }
  titleRange(line: number, start: number, end: number): SourceRange {
    return { start: { line: line + 1, column: start + 1 }, end: { line: line + 1, column: end + 1 } };
  }
  slice(range: SourceRange): string {
    return this.text.slice(this.offsets[range.start.line - 1] + range.start.column - 1,
      this.offsets[range.end.line - 1] + range.end.column - 1);
  }
  hashRange(range: SourceRange): string {
    const offset = (position: SourceRange["start"]) => {
      const { line, column } = position;
      if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || line > this.lines.length
        || column < 1 || column > this.lines[line - 1].length + 1) throw new RangeError("Invalid own range");
      return this.offsets[line - 1] + column - 1;
    };
    return hashOwnRange(this.text, offset(range.start), offset(range.end), this);
  }
  trimEnd(start: number, end: number): number {
    while (end > start + 1 && isBlankLine(this.lines[end - 1])) end--;
    return end;
  }
}
