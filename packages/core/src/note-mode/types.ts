import type { SourceRange, ThoughtMap, ThoughtNodeId } from "../domain.js";

export type NoteMapParseOptions = Readonly<{
  sourceId?: string;
  fallbackTitle: string;
  limits?: Readonly<{ maxBytes: number; maxTopics: number }>;
}>;

export type NoteModeReadOnlyReason =
  | "mixed-tab-space-indent" | "mixed-newlines" | "overlapping-ranges"
  | "unclassified-lines" | "heading-inside-list-item" | "invalid-frontmatter";
export type NoteNotOpenableReason = "too-large" | "too-many-topics" | "unclosed-frontmatter";
export type NoteLineClass = "topic" | "note" | "unmapped" | "blank";
export type UnmappedBlock = Readonly<{
  kind: "frontmatter" | "code" | "table" | "blockquote" | "callout" | "html" | "math"
    | "thematic-break" | "setext-heading" | "footnote-definition" | "link-reference-definition"
    | "comment" | "paragraph" | "heading";
  range: SourceRange;
  contentHash: string;
  indentSensitive: boolean;
}>;
export type NoteModeCenterInfo =
  | Readonly<{ kind: "h1"; titleRange: SourceRange; lineRange: SourceRange;
      unmapped: readonly UnmappedBlock[]; noteRange?: SourceRange; noteEditable: boolean;
      note?: string; anchorHash: string }>
  | Readonly<{ kind: "filename"; fallbackTitle: string; insertAfterLine: number;
      unmapped: readonly UnmappedBlock[]; noteRange?: SourceRange; noteEditable: boolean; note?: string }>;
export type NoteModeNodeInfo = Readonly<{
  kind: "heading" | "listItem";
  headingLevel?: number;
  list?: Readonly<{ marker: string; indent: string; contentIndent: number }>;
  taskMarker?: string;
  blockId?: string;
  titleRange: SourceRange;
  ownRange: SourceRange;
  noteRange?: SourceRange;
  noteEditable: boolean;
  unmapped: readonly UnmappedBlock[];
  subtreeHasUnmapped: boolean;
  ownRangeHash: string;
}>;
export type NoteModeIndex = Readonly<{
  center: NoteModeCenterInfo;
  nodes: Readonly<Record<ThoughtNodeId, NoteModeNodeInfo>>;
  lineClasses: readonly NoteLineClass[];
}>;
export type NoteMapParseResult =
  | Readonly<{ status: "editable"; mode: "note"; map: ThoughtMap; index: NoteModeIndex;
      contentHash: string; newline: "lf" | "crlf"; lfText: string }>
  | Readonly<{ status: "readOnly"; mode: "note"; map: ThoughtMap; index: NoteModeIndex;
      contentHash: string; newline: "lf" | "crlf" | "mixed"; lfText: string;
      reasons: readonly NoteModeReadOnlyReason[] }>
  | Readonly<{ status: "notOpenable"; mode: "note"; reason: NoteNotOpenableReason;
      contentHash?: string; newline?: "lf" | "crlf" | "mixed"; firstProblemLine?: number }>;
