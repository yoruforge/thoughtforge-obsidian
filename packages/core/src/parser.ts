import type {
  SourceMetadata,
  SourceRange,
  ThoughtMap,
  ThoughtNode,
  ThoughtNodeId
} from "./domain.js";
import {
  classifyMarkdownLine,
  depthFromIndent,
  hasValidDepthIndent,
  metadataBlockLineNumbers,
  spacesPerDepth,
  splitMarkdownLines,
  type MarkdownLine
} from "./markdown-grammar.js";

export type ParseThoughtMapOptions = Readonly<{
  sourceId?: string;
}>;

type MutableNode = {
  id: ThoughtNodeId;
  text: string;
  children: ThoughtNodeId[];
  note?: string;
  source: SourceMetadata;
  depth: number;
  lineText: string;
  contentEndLine: MarkdownLine;
};

type StackEntry = Readonly<{
  id: ThoughtNodeId;
  depth: number;
}>;

export function parseThoughtMapMarkdown(
  markdown: string,
  options: ParseThoughtMapOptions = {}
): ThoughtMap {
  const allLines = splitMarkdownLines(markdown);
  const metadataLines = metadataBlockLineNumbers(allLines);
  const lines = allLines.filter((line) => !metadataLines.has(line.lineNumber));
  const titleLine = findTitleLine(lines);
  const title = titleLine.classification.title;
  const nodes = parseNodes(lines, options.sourceId);

  return {
    title,
    roots: nodes.roots,
    nodesById: nodes.nodesById,
    source: {
      ...sourceIdMetadata(options.sourceId),
      range: textRange(
        titleLine.line.lineNumber,
        titleLine.classification.marker.length + 2,
        titleLine.line.lineNumber,
        titleLine.line.text.length + 1
      )
    }
  };
}

function findTitleLine(lines: readonly MarkdownLine[]): {
  line: MarkdownLine;
  classification: Extract<ReturnType<typeof classifyMarkdownLine>, { kind: "heading" }>;
} {
  for (const line of lines) {
    const classification = classifyMarkdownLine(line);
    if (classification.kind === "heading") {
      return { line, classification };
    }
  }

  throw new Error("ThoughtForge map requires a top-level '# ' title.");
}

function parseNodes(
  lines: readonly MarkdownLine[],
  sourceId: string | undefined
): {
  roots: ThoughtNodeId[];
  nodesById: Record<ThoughtNodeId, ThoughtNode>;
} {
  const nodesById: Record<ThoughtNodeId, MutableNode> = {};
  const roots: ThoughtNodeId[] = [];
  const stack: StackEntry[] = [];
  let nodeIndex = 0;

  for (const line of lines) {
    const classification = classifyMarkdownLine(line);
    if (
      classification.kind === "blank" ||
      classification.kind === "heading" ||
      classification.kind === "metadata-boundary"
    ) {
      continue;
    }

    if (classification.kind === "id-anchor") {
      const node = nodeForDirectContentLine(line, classification.indent, stack, nodesById, "id anchor");
      node.contentEndLine = laterLine(node.contentEndLine, line);
      continue;
    }

    if (classification.kind === "note-start") {
      const node = nodeForDirectNoteLine(line, classification.indent, stack, nodesById);
      if (node.note !== undefined) {
        throw new Error(`Duplicate note block for node '${node.text}' on line ${line.lineNumber}.`);
      }
      const note = collectNoteBlock(lines, line, classification.indent);
      node.note = note.text;
      node.contentEndLine = note.endLine;
      continue;
    }

    if (classification.kind === "blockquote") {
      continue;
    }

    if (classification.kind !== "bullet") {
      continue;
    }

    const indent = classification.indent;
    if (!hasValidDepthIndent(indent)) {
      throw new Error(`Invalid indentation on line ${line.lineNumber}: use ${spacesPerDepth} spaces per depth.`);
    }

    const depth = depthFromIndent(indent);
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (depth > 0 && stack.length === 0) {
      throw new Error(`Invalid hierarchy on line ${line.lineNumber}: nested node has no parent.`);
    }

    if (depth > 0 && stack[stack.length - 1].depth !== depth - 1) {
      throw new Error(`Invalid hierarchy on line ${line.lineNumber}: skipped parent depth.`);
    }

    const id = `node-${++nodeIndex}`;
    const node: MutableNode = {
      id,
      text: classification.text,
      children: [],
      depth,
      lineText: line.text,
      contentEndLine: line,
      source: {
        ...sourceIdMetadata(sourceId),
        range: lineRange(line.lineNumber, indent + 1, line.text.length)
      }
    };

    nodesById[id] = node;

    const parent = stack[stack.length - 1];
    if (parent) {
      nodesById[parent.id].children.push(id);
    } else {
      roots.push(id);
    }

    stack.push({ id, depth });
  }

  const orderedNodes = Object.values(nodesById);
  for (const node of orderedNodes) {
    const subtreeEndLine = findSubtreeEndLine(node, orderedNodes);
    node.source = {
      ...node.source,
      range: textRange(
        node.source.range.start.line,
        node.source.range.start.column,
        subtreeEndLine.lineNumber,
        subtreeEndLine.text.length + 1
      )
    };
  }

  return {
    roots,
    nodesById: Object.fromEntries(
      Object.values(nodesById).map((node) => [
        node.id,
        {
          id: node.id,
          text: node.text,
          children: node.children,
          ...(node.note === undefined ? {} : { note: node.note }),
          source: node.source
        }
      ])
    )
  };
}

function findSubtreeEndLine(node: MutableNode, nodes: readonly MutableNode[]): Pick<MarkdownLine, "lineNumber" | "text"> {
  const nodeIndex = nodes.findIndex((candidate) => candidate.id === node.id);
  const nextPeerOrAncestor = nodes
    .slice(nodeIndex + 1)
    .find((candidate) => candidate.depth <= node.depth);
  const lastDescendant = nextPeerOrAncestor
    ? nodes[nodes.findIndex((candidate) => candidate.id === nextPeerOrAncestor.id) - 1]
    : nodes[nodes.length - 1];
  const subtreeEndLine = lastDescendant?.contentEndLine ?? node.contentEndLine;

  return laterLine(node.contentEndLine, subtreeEndLine);
}

function laterLine(
  left: Pick<MarkdownLine, "lineNumber" | "text">,
  right: Pick<MarkdownLine, "lineNumber" | "text">
): Pick<MarkdownLine, "lineNumber" | "text"> {
  return left.lineNumber >= right.lineNumber ? left : right;
}

function nodeForDirectNoteLine(
  line: MarkdownLine,
  indent: number,
  stack: readonly StackEntry[],
  nodesById: Record<ThoughtNodeId, MutableNode>
): MutableNode {
  return nodeForDirectContentLine(line, indent, stack, nodesById, "note block");
}

function nodeForDirectContentLine(
  line: MarkdownLine,
  indent: number,
  stack: readonly StackEntry[],
  nodesById: Record<ThoughtNodeId, MutableNode>,
  label: string
): MutableNode {
  if (!hasValidDepthIndent(indent) || indent < spacesPerDepth) {
    throw new Error(`Invalid ${label} indentation on line ${line.lineNumber}.`);
  }

  const parentDepth = depthFromIndent(indent) - 1;
  const parent = [...stack].reverse().find((entry) => entry.depth === parentDepth);
  if (!parent) {
    throw new Error(`Invalid ${label} on line ${line.lineNumber}: ${label} has no parent node.`);
  }

  return nodesById[parent.id];
}

function collectNoteBlock(
  lines: readonly MarkdownLine[],
  startLine: MarkdownLine,
  indent: number
): {
  text: string;
  endLine: MarkdownLine;
} {
  const startIndex = lines.findIndex((line) => line.lineNumber === startLine.lineNumber);
  const body: string[] = [];
  let endLine = startLine;

  for (const line of lines.slice(startIndex + 1)) {
    const classification = classifyMarkdownLine(line);
    if (classification.kind !== "blockquote" || classification.indent !== indent) {
      break;
    }
    body.push(classification.text ?? "");
    endLine = line;
  }

  return {
    text: body.join("\n"),
    endLine
  };
}

function lineRange(line: number, startColumn: number, lineLength: number): SourceRange {
  return textRange(line, startColumn, line, lineLength + 1);
}

function textRange(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
): SourceRange {
  return {
    start: { line: startLine, column: startColumn },
    end: { line: endLine, column: endColumn }
  };
}

function sourceIdMetadata(id: string | undefined): Pick<SourceMetadata, "sourceId"> {
  return id ? { sourceId: id } : {};
}
