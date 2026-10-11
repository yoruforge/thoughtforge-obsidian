import { load as loadYaml } from "js-yaml";
import type { SourceRange, ThoughtMap, ThoughtNode } from "../domain.js";
import { tokenizeNoteBlocks, TopicLimit } from "./blocks.js";
import { sha256 } from "./hash.js";
import { NoteSource, isBlankLine, newlineKind, removeIndent, visualWidth } from "./source.js";
import type { NoteLineClass, NoteMapParseOptions, NoteMapParseResult, NoteModeCenterInfo,
  NoteModeNodeInfo, NoteModeReadOnlyReason, UnmappedBlock } from "./types.js";

type Owner = {
  id?: string; kind: "heading" | "listItem" | "filename";
  start: number; end: number; headingLevel?: number;
  titleRange?: SourceRange; children: string[];
  list?: { marker: string; indent: string; contentIndent: number };
  taskMarker?: string; blockId?: string; note?: string; noteRange?: SourceRange;
  blockedNote: boolean; recovered?: boolean; unmapped: UnmappedBlock[];
};

const reasonOrder: readonly NoteModeReadOnlyReason[] = ["mixed-tab-space-indent", "mixed-newlines", "overlapping-ranges",
  "unclassified-lines", "heading-inside-list-item", "invalid-frontmatter"];

function label(source: NoteSource, line: number, kind: "heading" | "listItem") {
  const raw = source.lines[line];
  const prefix = kind === "heading" ? /^[ \t]*#{1,6}(?:[ \t]+|$)/.exec(raw) : /^([ \t]*)([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(raw);
  if (!prefix) throw new Error("Block tokenizer and source marker disagree.");
  let start = prefix[0].length, end = raw.replace(/[ \t]+$/, "").length;
  if (kind === "heading") {
    const close = /(?:[ \t]+|^)#+$/.exec(raw.slice(start, end));
    if (close) end = start + close.index;
  }
  let taskMarker: string | undefined, blockId: string | undefined;
  if (kind === "listItem") {
    const task = /^\[[^\]\r\n]\](?:[ \t]+|$)/.exec(raw.slice(start, end));
    if (task) { taskMarker = task[0].slice(0,3); start += task[0].length; }
  }
  const anchor = /(?:[ \t]+|^)\^([A-Za-z0-9-]+)$/.exec(raw.slice(start, end));
  if (anchor) { blockId = `^${anchor[1]}`; end = start + anchor.index; }
  while (end > start && /[ \t]/.test(raw[end - 1])) end--;
  const markerEnd = kind === "listItem" ? visualWidth(prefix[1]) + prefix[2].length : 0;
  const padding = visualWidth(prefix[0]) - markerEnd;
  // CommonMark uses one space after an empty marker or padding wider than four
  // columns. Preserve the raw prefix while recording the tokenizer's indent.
  const contentIndent = markerEnd + (prefix[0].length === raw.length || padding > 4 ? 1 : padding);
  return { titleRange: source.titleRange(line, start, Math.max(start, end)),
    ...(taskMarker === undefined ? {} : { taskMarker }), ...(blockId === undefined ? {} : { blockId }),
    ...(kind === "listItem" ? { list: { marker: prefix[2], indent: prefix[1], contentIndent } } : {}) };
}

export function parseNoteMapMarkdown(markdown: string, options: NoteMapParseOptions): NoteMapParseResult {
  const limits = options.limits ?? { maxBytes: 2 * 1024 * 1024, maxTopics: 5000 };
  if (new TextEncoder().encode(markdown).byteLength > limits.maxBytes) return { status: "notOpenable", mode: "note", reason: "too-large" };
  const newline = newlineKind(markdown), contentHash = sha256(markdown);
  const lfText = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const source = new NoteSource(lfText);
  const reasons = new Set<NoteModeReadOnlyReason>();
  if (newline === "mixed") reasons.add("mixed-newlines");
  const lineClasses: (NoteLineClass | undefined)[] = source.lines.map(line => isBlankLine(line) ? "blank" : undefined);
  let frontmatterEnd = 0;
  if (source.lines[0] === "---") {
    const close = source.lines.findIndex((line, i) => i > 0 && line === "---");
    if (close < 0) return { status: "notOpenable", mode: "note", reason: "unclosed-frontmatter", contentHash, newline, firstProblemLine: 1 };
    frontmatterEnd = close + 1;
    try { loadYaml(source.lines.slice(1, close).join("\n")); }
    catch { reasons.add("invalid-frontmatter"); }
  }
  // Blank only the frontmatter for structural tokenization; all ranges/hashes
  // refer to the original LF source, and every line position remains unchanged.
  const blockText = source.lines.map((line, i) => i < frontmatterEnd ? "" : line).join("\n");
  let tokens;
  try { tokens = tokenizeNoteBlocks(blockText, limits.maxTopics); }
  catch (error) {
    if (error instanceof TopicLimit) return { status: "notOpenable", mode: "note", reason: "too-many-topics" };
    throw error;
  }
  if (tokens.some(token => token.type === "note_unclassified")) reasons.add("unclassified-lines");
  let center: Owner = { kind: "filename", start: -1, end: source.lines.length, children: [], blockedNote: true, unmapped: [] };
  const nodes: Owner[] = [], roots: string[] = [], headings: Owner[] = [], items: Owner[] = [];
  const listGroups: { hasTab: boolean; hasSpace: boolean }[] = [];
  let centerH1: Owner | undefined;
  const current = () => items.at(-1) ?? headings.at(-1) ?? center;
  const classify = (start: number, end: number, kind: NoteLineClass) => {
    for (let line = start; line < end; line++) {
      if (lineClasses[line] !== undefined && lineClasses[line] !== "blank") reasons.add("overlapping-ranges");
      lineClasses[line] = kind;
    }
  };
  const opaque = (owner: Owner, kind: UnmappedBlock["kind"], start: number, end: number) => {
    const range = source.range(start, source.trimEnd(start, end));
    owner.unmapped.push({ kind, range, contentHash: sha256(source.slice(range)),
      indentSensitive: ["code", "table", "blockquote", "callout", "html", "math", "heading"].includes(kind) });
    owner.blockedNote = true;
    classify(start, range.end.line, "unmapped");
  };
  const recover = (owner: Owner) => {
    // Supplement 11: this physical title line belongs only to the outer item.
    owner.recovered = true;
    owner.blockedNote = true;
    reasons.add("overlapping-ranges");
  };
  const block = (owner: Owner, kind: UnmappedBlock["kind"], start: number, end: number) => {
    if (owner.kind === "listItem" && owner.start === start) {
      // Trim separator blanks while the original nonblank opener still belongs
      // to this span, before removing its separately owned recovery title line.
      end = source.trimEnd(start, end);
      recover(owner); start++;
    }
    if (start < end) opaque(owner, kind, start, end);
  };
  if (frontmatterEnd) opaque(center, "frontmatter", 0, frontmatterEnd);
  const addNode = (node: Owner, parent: Owner | undefined) => {
    node.id = `node-${nodes.length + 1}`;
    nodes.push(node);
    if (parent?.id) parent.children.push(node.id); else roots.push(node.id);
    if (parent) parent.blockedNote = true;
    classify(node.start, node.start + 1, "topic");
  };
  const paragraph = (owner: Owner, start: number, end: number) => {
    if (owner.kind === "listItem" && start === owner.start) start++;
    while (start < end && isBlankLine(source.lines[start])) start++;
    while (end > start && isBlankLine(source.lines[end - 1])) end--;
    if (start === end) return;
    if (owner.blockedNote || owner.kind === "filename") { opaque(owner, "paragraph", start, end); return; }
    const noteStart = owner.noteRange ? owner.noteRange.start.line - 1 : start;
    owner.noteRange = source.range(noteStart, end);
    owner.note = source.lines.slice(noteStart, end).map(line => owner.list ? removeIndent(line, owner.list.contentIndent) : line).join("\n");
    for (let line = start; line < end; line++) classify(line, line + 1, isBlankLine(source.lines[line]) ? "blank" : "note");
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "list_item_close") { items.pop(); continue; }
    if (token.type === "bullet_list_close" || token.type === "ordered_list_close") { listGroups.pop(); continue; }
    if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
      listGroups.push(listGroups[0] ?? { hasTab: false, hasSpace: false }); continue;
    }
    if (!token.map) continue;
    const [start, end] = token.map;
    if (token.type === "list_item_open") {
      const outer = items.at(-1);
      if (outer?.start === start) {
        recover(outer);
        // Keep the container stack balanced but merge the same-line inner item.
        // Its later siblings/descendants attach to this one recovery topic.
        items.push(outer);
        continue;
      }
      const node: Owner = { kind: "listItem", start, end: source.trimEnd(start, end), children: [], blockedNote: false, unmapped: [], ...label(source, start, "listItem") };
      const group = listGroups[0];
      if (group) {
        group.hasTab ||= node.list!.indent.includes("\t"); group.hasSpace ||= node.list!.indent.includes(" ");
        if (group.hasTab && group.hasSpace) reasons.add("mixed-tab-space-indent");
      }
      addNode(node, items.at(-1) ?? headings.at(-1)); items.push(node); continue;
    }
    if (token.type === "heading_open" && token.markup.startsWith("#")) {
      if (items.length) { block(current(), "heading", start, end); reasons.add("heading-inside-list-item"); continue; }
      const level = Number(token.tag.slice(1));
      while (headings.length && headings.at(-1)!.headingLevel! >= level) {
        const previous = headings.pop()!;
        previous.end = source.trimEnd(previous.start, start);
      }
      const node: Owner = { kind: "heading", start, end: source.lines.length, headingLevel: level,
        children: [], blockedNote: false, unmapped: [], ...label(source, start, "heading") };
      if (level === 1 && !centerH1) {
        node.unmapped = center.unmapped; centerH1 = node; center = node;
        classify(start, start + 1, "topic");
      } else addNode(node, headings.at(-1));
      headings.push(node); continue;
    }
    if (token.type === "paragraph_open") { paragraph(current(), start, end); continue; }
    const kind: UnmappedBlock["kind"] | undefined = {
      fence: "code", code_block: "code", table_open: "table", blockquote_open: token.meta?.noteCallout ? "callout" : "blockquote",
      html_block: "html", note_math: "math", note_comment: "comment", note_footnote: "footnote-definition",
      note_reference: "link-reference-definition", hr: "thematic-break", heading_open: "setext-heading"
    }[token.type] as UnmappedBlock["kind"] | undefined;
    if (!kind) continue;
    block(current(), kind, start, end);
    if (token.nesting === 1) {
      let depth = 1;
      while (depth && ++i < tokens.length) depth += tokens[i].nesting;
    }
  }
  for (const heading of headings) heading.end = source.trimEnd(heading.start, heading.end);
  // Fail closed on classification gaps. Keep the source visible as a paragraph.
  for (let line = 0; line < lineClasses.length; line++) {
    if (lineClasses[line] !== undefined) continue;
    reasons.add("unclassified-lines");
    const owner = [...nodes].reverse().find(node => node.start <= line && line < node.end) ?? center;
    opaque(owner, "paragraph", line, line + 1);
  }
  const sourceId = options.sourceId === undefined ? {} : { sourceId: options.sourceId };
  const nodesById: Record<string, ThoughtNode> = {}, indexNodes: Record<string, NoteModeNodeInfo> = {};
  for (const node of nodes) {
    const ownRange = source.range(node.start, node.end);
    nodesById[node.id!] = { id: node.id!, text: source.slice(node.titleRange!), children: node.children,
      ...(node.note === undefined ? {} : { note: node.note }), source: { ...sourceId, range: ownRange } };
    indexNodes[node.id!] = { kind: node.kind as "heading" | "listItem", titleRange: node.titleRange!, ownRange,
      ...(node.headingLevel === undefined ? {} : { headingLevel: node.headingLevel }), ...(node.list === undefined ? {} : { list: node.list }),
      ...(node.taskMarker === undefined ? {} : { taskMarker: node.taskMarker }), ...(node.blockId === undefined ? {} : { blockId: node.blockId }),
      ...(node.noteRange === undefined ? {} : { noteRange: node.noteRange }), noteEditable: !node.recovered,
      unmapped: node.unmapped, subtreeHasUnmapped: false, ownRangeHash: source.hashRange(ownRange) };
  }
  for (const node of [...nodes].reverse()) {
    const info = indexNodes[node.id!];
    indexNodes[node.id!] = { ...info, subtreeHasUnmapped: info.unmapped.length > 0 || node.children.some(id => indexNodes[id].subtreeHasUnmapped) };
  }
  const centerInfo: NoteModeCenterInfo = centerH1 ? {
    kind: "h1", titleRange: centerH1.titleRange!, lineRange: source.range(centerH1.start, centerH1.start + 1),
    anchorHash: sha256(source.lines[centerH1.start]), unmapped: center.unmapped, noteEditable: true,
    ...(center.noteRange === undefined ? {} : { noteRange: center.noteRange }), ...(center.note === undefined ? {} : { note: center.note })
  } : { kind: "filename", fallbackTitle: options.fallbackTitle, insertAfterLine: frontmatterEnd, unmapped: center.unmapped, noteEditable: false };
  const map: ThoughtMap = { title: centerH1 ? source.slice(centerH1.titleRange!) : options.fallbackTitle, roots, nodesById,
    ...(centerH1 ? { source: { ...sourceId, range: centerH1.titleRange! } } : {}) };
  const common = { mode: "note" as const, map, index: { center: centerInfo, nodes: indexNodes, lineClasses: lineClasses as NoteLineClass[] }, contentHash, lfText };
  return reasons.size ? { ...common, status: "readOnly", newline, reasons: reasonOrder.filter(reason => reasons.has(reason)) } : { ...common, status: "editable", newline: newline as "lf" | "crlf" };
}
