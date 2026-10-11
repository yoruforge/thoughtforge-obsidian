import type { SourceMetadata, SourceRange, ThoughtMap, ThoughtNode, ThoughtNodeId } from "./domain.js";
import {
  decodeXmlAttribute,
  decodeXmlText,
  escapeXmlAttribute,
  escapeXmlText,
  normalizeLineEndings,
  unescapeLegacyAttributeEscapes
} from "./opml-xml.js";

export type SerializeThoughtMapToOpmlOptions = Readonly<{
  includeNotes?: boolean;
}>;

export function serializeThoughtMapToOpml(
  map: ThoughtMap,
  options: SerializeThoughtMapToOpmlOptions = {}
): string {
  const includeNotes = options.includeNotes ?? true;
  const normalizedTitle = assertSingleLine(map.title, "map.title").trim();
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeXmlText(normalizedTitle)}</title>`,
    "  </head>",
    "  <body>"
  ];

  const seen = new Set<ThoughtNodeId>();
  for (const rootId of map.roots) {
    appendNodeOutline(parts, map, rootId, 2, seen, includeNotes);
  }

  parts.push("  </body>");
  parts.push("</opml>");
  return `${parts.join("\n")}\n`;
}

function appendNodeOutline(
  parts: string[],
  map: ThoughtMap,
  nodeId: ThoughtNodeId,
  depth: number,
  seen: Set<ThoughtNodeId>,
  includeNotes: boolean
): void {
  if (seen.has(nodeId)) {
    throw new Error(`ThoughtMap contains a cycle or duplicate reference at node '${nodeId}'.`);
  }

  const node = map.nodesById[nodeId];
  if (!node) {
    throw new Error(`ThoughtMap references missing node '${nodeId}'.`);
  }

  seen.add(nodeId);
  const safeIndent = "  ".repeat(depth);
  const escapedText = escapeXmlAttribute(node.text);
  const attr = includeNotes && node.note
    ? ` text="${escapedText}" _note="${escapeXmlAttribute(node.note)}"`
    : ` text="${escapedText}"`;
  parts.push(`${safeIndent}<outline${attr}>`);
  for (const childId of node.children) {
    appendNodeOutline(parts, map, childId, depth + 1, seen, includeNotes);
  }
  parts.push(`${safeIndent}</outline>`);
}

export type ImportThoughtMapFromOpmlOptions = Readonly<{
  sourceId?: string;
  includeNotes?: boolean;
}>;

export function importThoughtMapFromOpml(
  opml: string,
  options: ImportThoughtMapFromOpmlOptions = {}
): ThoughtMap {
  const source = parseOutlineStructure(opml);
  const mapTitle = options.includeNotes === false ? `imported-${Date.now()}` : (source.title || "Imported Map");

  const nodesById: Record<ThoughtNodeId, ThoughtNode> = {};
  const roots: ThoughtNodeId[] = [];
  const seenIds = new Set<string>();
  let nodeIndex = 0;

  const nodeSource = {
    ...sourceMetadata(options.sourceId),
    range: sourceRange(1, 1, 1, 1)
  };

  const visit = (current: ParsedOutlineNode, depth: number): ThoughtNodeId => {
    const nodeId = `node-${++nodeIndex}`;
    if (seenIds.has(nodeId)) {
      throw new Error(`OPML import produced duplicate node id '${nodeId}'.`);
    }
    seenIds.add(nodeId);

    const nodeText = assertSingleLine(
      assertNonEmptyString(current.text, "OPML outline text"),
      `outline '${nodeId}' text`
    );
    const childIds: ThoughtNodeId[] = [];
    const node: ThoughtNode = {
      id: nodeId,
      text: nodeText,
      children: childIds,
      ...(options.includeNotes === false || !current.note ? {} : { note: normalizeLineEndings(current.note) }),
      source: nodeSource
    };
    nodesById[nodeId] = node;
    childIds.push(...current.children.map((child) => visit(child, depth + 1)));
    return nodeId;
  };

  for (const parsedNode of source.nodes) {
    const nodeId = visit(parsedNode, 0);
    roots.push(nodeId);
  }

  if (roots.length === 0) {
    const fallback = "Imported Root";
    const fallbackId = `node-${++nodeIndex}`;
    roots.push(fallbackId);
    nodesById[fallbackId] = {
      id: fallbackId,
      text: fallback,
      children: [],
      source: nodeSource
    };
  }

  return {
    title: assertSingleLine(mapTitle, "map.title"),
    roots,
    nodesById,
    source: nodeSource
  };
}

type ParsedOutlineNode = Readonly<{
  text: string;
  note?: string;
  children: ParsedOutlineNode[];
}>;

function parseOutlineStructure(opml: string): Readonly<{
  title: string | undefined;
  nodes: ParsedOutlineNode[];
}> {
  const source = unescapeLegacyAttributeEscapes(opml.replace(/\uFEFF/g, ""));
  const title = extractTitle(source);
  const outlineTokens = tokenizeOutlineTags(source);

  const rootNodes: ParsedOutlineNode[] = [];
  const stack: ParsedOutlineNode[] = [];

  for (const token of outlineTokens) {
    if (token.type === "open") {
      if (token.text.length === 0) {
        throw new Error("OPML outline text is empty.");
      }
      const current: ParsedOutlineNode = {
        text: token.text,
        ...(token.note ? { note: token.note } : {}),
        children: []
      };
      if (stack.length > 0) {
        const parent = stack[stack.length - 1];
        parent.children.push(current);
      } else {
        rootNodes.push(current);
      }
      stack.push(current);
      continue;
    }

    if (token.type === "self-close") {
      if (token.text.length === 0) {
        throw new Error("OPML outline text is empty.");
      }
      const current = {
        text: token.text,
        ...(token.note ? { note: token.note } : {}),
        children: []
      };
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(current);
      } else {
        rootNodes.push(current);
      }
      continue;
    }

    if (token.type === "close") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
  }

  if (stack.length > 0) {
    throw new Error("OPML outline tags are not balanced.");
  }

  return {
    title: title?.trim(),
    nodes: rootNodes
  };
}

type ParsedOutlineToken = Readonly<{
  type: "open" | "close" | "self-close";
  text: string;
  note?: string;
}>;

function tokenizeOutlineTags(opml: string): ParsedOutlineToken[] {
  const outlineTagRegex = /<\/?outline\b[^>]*>/g;
  const tokens: ParsedOutlineToken[] = [];

  for (const match of opml.matchAll(outlineTagRegex)) {
    const rawTag = match[0];
    if (rawTag.startsWith("</")) {
      tokens.push({ type: "close", text: "" });
      continue;
    }

    const rawAttributes = rawTag.slice("<outline".length, -1);
    const selfClose = /\/\s*>$/.test(rawTag);
    const text = decodeXmlAttribute(extractAttribute(rawAttributes, "text") ?? "");
    const note = extractAttribute(rawAttributes, "note") ?? extractAttribute(rawAttributes, "_note");
    tokens.push({
      type: selfClose ? "self-close" : "open",
      text: text,
      note: note ? decodeXmlAttribute(note) : undefined
    });
  }

  return tokens;
}

function extractTitle(opml: string): string | undefined {
  const match = opml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeXmlText(match[1] ?? "") : undefined;
}

function extractAttribute(rawAttributes: string, name: string): string | undefined {
  const match = rawAttributes.match(new RegExp(`\\b${name}\\s*=\\s*["\']([^"\']*)["\']`, "i"));
  return match ? match[1] : undefined;
}

function sourceMetadata(sourceId: string | undefined): Pick<SourceMetadata, "sourceId"> {
  return sourceId === undefined ? {} : { sourceId };
}

function sourceRange(
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

function assertNonEmptyString(value: string, label: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${label} is empty.`);
  }
  return value;
}

function assertSingleLine(value: string, label: string): string {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Cannot import/export ${label}: multiline text is not supported.`);
  }

  return value;
}
