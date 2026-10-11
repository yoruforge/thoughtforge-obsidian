import type { ThoughtMap, ThoughtNodeId } from "./domain.js";
import { spacesPerDepth } from "./markdown-grammar.js";

export function serializeThoughtMapMarkdown(map: ThoughtMap): string {
  const lines = [`# ${assertSingleLine(map.title, "map.title")}`, ""];
  const seen = new Set<ThoughtNodeId>();

  for (const rootId of map.roots) {
    appendNode(lines, map, rootId, 0, seen);
  }

  return `${lines.join("\n")}\n`;
}

function appendNode(
  lines: string[],
  map: ThoughtMap,
  nodeId: ThoughtNodeId,
  depth: number,
  seen: Set<ThoughtNodeId>
): void {
  if (seen.has(nodeId)) {
    throw new Error(`ThoughtMap contains a cycle or duplicate reference at node '${nodeId}'.`);
  }

  const node = map.nodesById[nodeId];
  if (!node) {
    throw new Error(`ThoughtMap references missing node '${nodeId}'.`);
  }

  seen.add(nodeId);
  const indent = " ".repeat(depth * spacesPerDepth);
  lines.push(`${indent}- ${assertSingleLine(node.text, `node '${node.id}' text`)}`);
  appendNodeNote(lines, node.note, depth + 1);
  for (const childId of node.children) {
    appendNode(lines, map, childId, depth + 1, seen);
  }
}

function appendNodeNote(lines: string[], note: string | undefined, depth: number): void {
  if (!note || note.trim().length === 0) {
    return;
  }

  const indent = " ".repeat(depth * spacesPerDepth);
  lines.push(`${indent}> [!note]`);
  for (const noteLine of note.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    lines.push(noteLine.length > 0 ? `${indent}> ${noteLine}` : `${indent}> `);
  }
}

function assertSingleLine(value: string, label: string): string {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Cannot serialize ${label}: multiline text is not supported in .map.md.`);
  }

  return value;
}
