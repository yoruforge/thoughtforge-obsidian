export type ThoughtNodeId = string;

export type SourcePosition = Readonly<{
  /**
   * 1-based line number in the original `.map.md`.
   */
  line: number;
  /**
   * 1-based UTF-16 column number in the original `.map.md` line.
   */
  column: number;
}>;

export type SourceRange = Readonly<{
  start: SourcePosition;
  end: SourcePosition;
}>;

export type SourceMetadata = Readonly<{
  /**
   * Optional filename or URI-like identifier provided by the host.
   * (e.g. workspace-relative path, virtual document ID)
   */
  sourceId?: string;
  /**
   * Range in the original `.map.md` that produced this artifact.
   */
  range: SourceRange;
}>;

export type ThoughtNode = Readonly<{
  id: ThoughtNodeId;
  /**
   * Plaintext label for the node (not Markdown).
   */
  text: string;
  /**
   * Child node IDs in document order.
   */
  children: readonly ThoughtNodeId[];
  /**
   * Optional long-form Markdown note persisted as a direct child blockquote callout.
   */
  note?: string;
  source?: SourceMetadata;
}>;

export type ThoughtMap = Readonly<{
  /**
   * Document title (usually the first `# ...` heading).
   */
  title: string;
  /**
   * Top-level nodes in document order.
   */
  roots: readonly ThoughtNodeId[];
  /**
   * All nodes keyed by ID.
   */
  nodesById: Readonly<Record<ThoughtNodeId, ThoughtNode>>;
  source?: SourceMetadata;
}>;

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = Readonly<{
  severity: ValidationSeverity;
  code: string;
  message: string;
  range?: SourceRange;
}>;

export type ValidationResult = Readonly<{
  ok: boolean;
  issues: readonly ValidationIssue[];
}>;
