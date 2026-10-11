export type MarkdownLine = Readonly<{
  lineNumber: number;
  text: string;
}>;

export type MarkdownLineClassification =
  | Readonly<{ kind: "blank" }>
  | Readonly<{ kind: "heading"; marker: string; title: string }>
  | Readonly<{ kind: "bullet"; indent: number; text: string }>
  | Readonly<{ kind: "note-start"; indent: number }>
  | Readonly<{ kind: "blockquote"; indent: number; text: string | undefined }>
  | Readonly<{ kind: "metadata-boundary" }>
  | Readonly<{ kind: "id-anchor"; indent: number; id: string }>
  | Readonly<{ kind: "unknown" }>;

const headingPattern = /^(#) (.*)$/;
const bulletPattern = /^( *)- (.*)$/;
const noteStartPattern = /^( *)> \[!note\]\s*$/;
const blockquotePattern = /^( *)>(?: ?(.*))?$/;
const metadataBoundaryPattern = /^---\s*$/;
const idAnchorPattern = /^( *)\^([A-Za-z0-9][A-Za-z0-9_-]*)\s*$/;

export const spacesPerDepth = 2;

export function splitMarkdownLines(markdown: string): MarkdownLine[] {
  return markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((text, index) => ({
    lineNumber: index + 1,
    text
  }));
}

export function classifyMarkdownLine(line: Pick<MarkdownLine, "text">): MarkdownLineClassification {
  if (line.text.trim().length === 0) {
    return { kind: "blank" };
  }

  const headingMatch = line.text.match(headingPattern);
  if (headingMatch) {
    return { kind: "heading", marker: headingMatch[1], title: headingMatch[2] };
  }

  const noteStartMatch = line.text.match(noteStartPattern);
  if (noteStartMatch) {
    return { kind: "note-start", indent: noteStartMatch[1].length };
  }

  const blockquoteMatch = line.text.match(blockquotePattern);
  if (blockquoteMatch) {
    return { kind: "blockquote", indent: blockquoteMatch[1].length, text: blockquoteMatch[2] };
  }

  const bulletMatch = line.text.match(bulletPattern);
  if (bulletMatch) {
    return { kind: "bullet", indent: bulletMatch[1].length, text: bulletMatch[2] };
  }

  if (metadataBoundaryPattern.test(line.text)) {
    return { kind: "metadata-boundary" };
  }

  const idAnchorMatch = line.text.match(idAnchorPattern);
  if (idAnchorMatch) {
    return { kind: "id-anchor", indent: idAnchorMatch[1].length, id: idAnchorMatch[2] };
  }

  return { kind: "unknown" };
}

export function depthFromIndent(indent: number): number {
  return indent / spacesPerDepth;
}

export function hasValidDepthIndent(indent: number): boolean {
  return indent % spacesPerDepth === 0;
}

export function metadataBlockLineNumbers(lines: readonly MarkdownLine[]): ReadonlySet<number> {
  const firstContentLine = lines.find((line) => classifyMarkdownLine(line).kind !== "blank");
  if (!firstContentLine || classifyMarkdownLine(firstContentLine).kind !== "metadata-boundary") {
    return new Set();
  }

  const lineNumbers = new Set<number>([firstContentLine.lineNumber]);
  for (const line of lines.slice(firstContentLine.lineNumber)) {
    lineNumbers.add(line.lineNumber);
    if (classifyMarkdownLine(line).kind === "metadata-boundary") {
      return lineNumbers;
    }
  }

  return new Set([firstContentLine.lineNumber]);
}
