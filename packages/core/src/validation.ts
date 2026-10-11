import type { SourceMetadata, SourceRange, ThoughtMap, ValidationIssue, ValidationResult } from "./domain.js";
import {
  classifyMarkdownLine,
  depthFromIndent,
  hasValidDepthIndent,
  metadataBlockLineNumbers,
  spacesPerDepth,
  splitMarkdownLines,
  type MarkdownLine
} from "./markdown-grammar.js";
import { parseThoughtMapMarkdown, type ParseThoughtMapOptions } from "./parser.js";

export type ValidateThoughtMapOptions = ParseThoughtMapOptions;

export type ParseThoughtMapRecoveryOptions = ParseThoughtMapOptions &
  Readonly<{
    lastValidMap?: ThoughtMap;
  }>;

export type ParseThoughtMapRecoveryResult = Readonly<{
  map?: ThoughtMap;
  validation: ValidationResult;
  recoveredFromLastValidMap: boolean;
}>;

type StackEntry = Readonly<{
  depth: number;
}>;

export function validateThoughtMapMarkdown(
  markdown: string,
  options: ValidateThoughtMapOptions = {}
): ValidationResult {
  const lines = splitMarkdownLines(markdown);
  const issues: ValidationIssue[] = [];
  const title = findTitle(lines);

  if (!title) {
    issues.push({
      severity: "error",
      code: "missing-title",
      message: "ThoughtForge map requires a top-level '# ' title.",
      range: documentStartRange(lines)
    });
  }

  issues.push(...validateNodeHierarchy(lines));

  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, issues };
  }

  try {
    parseThoughtMapMarkdown(markdown, options);
  } catch (error) {
    issues.push({
      severity: "error",
      code: "parse-error",
      message: error instanceof Error ? error.message : "Unable to parse ThoughtForge map.",
      range: documentStartRange(lines)
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== "error"),
    issues
  };
}

export function parseThoughtMapMarkdownWithRecovery(
  markdown: string,
  options: ParseThoughtMapRecoveryOptions = {}
): ParseThoughtMapRecoveryResult {
  const validation = validateThoughtMapMarkdown(markdown, options);

  if (!validation.ok) {
    return {
      map: options.lastValidMap,
      validation,
      recoveredFromLastValidMap: Boolean(options.lastValidMap)
    };
  }

  return {
    map: parseThoughtMapMarkdown(markdown, options),
    validation,
    recoveredFromLastValidMap: false
  };
}

function validateNodeHierarchy(lines: readonly MarkdownLine[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stack: StackEntry[] = [];
  const metadataLines = metadataBlockLineNumbers(lines);

  for (const line of lines) {
    const classification = classifyMarkdownLine(line);
    if (
      metadataLines.has(line.lineNumber) ||
      classification.kind === "blank" ||
      classification.kind === "heading" ||
      classification.kind === "note-start" ||
      classification.kind === "blockquote"
    ) {
      continue;
    }

    if (classification.kind === "id-anchor") {
      validateDirectOwnedLine(line, classification.indent, stack, issues);
      continue;
    }

    if (classification.kind !== "bullet") {
      issues.push({
        severity: "warning",
        code: "ignored-line",
        message: "Only '- ' bullet lines are included in the ThoughtForge map.",
        range: lineTextRange(line, firstNonWhitespaceColumn(line.text))
      });
      continue;
    }

    const indent = classification.indent;
    if (!hasValidDepthIndent(indent)) {
      issues.push({
        severity: "error",
        code: "invalid-indentation",
        message: `Use ${spacesPerDepth} spaces per depth.`,
        range: lineTextRange(line, indent + 1)
      });
      continue;
    }

    const depth = depthFromIndent(indent);
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (depth > 0 && stack.length === 0) {
      issues.push({
        severity: "error",
        code: "invalid-hierarchy.skipped-parent-depth",
        message: "Nested node has no parent at the previous depth.",
        range: lineTextRange(line, indent + 1)
      });
      continue;
    }

    if (depth > 0 && stack[stack.length - 1].depth !== depth - 1) {
      issues.push({
        severity: "error",
        code: "invalid-hierarchy.skipped-parent-depth",
        message: "Nested node has no parent at the previous depth.",
        range: lineTextRange(line, indent + 1)
      });
      continue;
    }

    stack.push({ depth });
  }

  return issues;
}

function validateDirectOwnedLine(
  line: MarkdownLine,
  indent: number,
  stack: readonly StackEntry[],
  issues: ValidationIssue[]
): void {
  if (!hasValidDepthIndent(indent) || indent < spacesPerDepth) {
    issues.push({
      severity: "error",
      code: "invalid-indentation",
      message: `Use ${spacesPerDepth} spaces per depth.`,
      range: lineTextRange(line, Math.max(indent + 1, 1))
    });
    return;
  }

  const parentDepth = depthFromIndent(indent) - 1;
  const parent = [...stack].reverse().find((entry) => entry.depth === parentDepth);
  if (!parent) {
    issues.push({
      severity: "error",
      code: "invalid-hierarchy.skipped-parent-depth",
      message: "Nested node has no parent at the previous depth.",
      range: lineTextRange(line, indent + 1)
    });
  }
}

function findTitle(lines: readonly MarkdownLine[]): MarkdownLine | undefined {
  return lines.find((line) => classifyMarkdownLine(line).kind === "heading");
}

function documentStartRange(lines: readonly MarkdownLine[]): SourceRange {
  const firstLine = lines[0] ?? { lineNumber: 1, text: "" };
  return textRange(firstLine.lineNumber, 1, firstLine.lineNumber, Math.max(firstLine.text.length + 1, 1));
}

function lineTextRange(line: MarkdownLine, startColumn: number): SourceRange {
  return textRange(line.lineNumber, startColumn, line.lineNumber, line.text.length + 1);
}

function textRange(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): SourceMetadata["range"] {
  return {
    start: { line: startLine, column: startColumn },
    end: { line: endLine, column: endColumn }
  };
}

function firstNonWhitespaceColumn(text: string): number {
  const index = text.search(/\S/);
  return index === -1 ? 1 : index + 1;
}
