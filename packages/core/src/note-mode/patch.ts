import type { SourceRange } from "../domain.js";
import { tokenizeNoteBlocks, TopicLimit } from "./blocks.js";
import { removeIndent, visualWidth, isBlankLine } from "./source.js";
import { PatchSource, type Edit } from "./patch-source.js";
import { PatchRejection, reject, type NoteSemanticCommand, type NotePatchResult } from "./patch-commands.js";
import { children, location, order, renameFilenameCenter, semanticTree, subtree, validateCandidate,
  validateSnapshot, type EditableNote, type SemanticTree, type SemanticTopic } from "./patch-structure.js";

export type { NoteSemanticCommand, NotePatchResult, NotePatchRejectReason, NotePatchRejectDetail,
  NoteDeleteNodeCommand, WrapInNewParentCommand, DeleteKeepChildrenCommand, UpdateCenterNoteCommand,
  ClearCenterNoteCommand } from "./patch-commands.js";

type Placement = { edit: Edit; kind: "heading" | "listItem"; level?: number; indent?: number };
const CREATED = "\u0000created";

class Operation {
  readonly source: PatchSource;
  readonly tree: SemanticTree;
  readonly edits: Edit[] = [];
  selected?: string;
  readonly parsed: EditableNote;
  constructor(parsed: EditableNote) {
    this.parsed = parsed;
    this.source = new PatchSource(parsed.lfText); this.tree = semanticTree(parsed);
  }
  info(id: string) { return this.parsed.index.nodes[id]; }
  title(text: string): void { if (/[\r\n]/.test(text)) reject("title-has-newline"); }
  rename(id: string, text: string): void {
    this.title(text); this.tree.nodes[id].text = text;
    this.edits.push(this.source.replace(this.info(id).titleRange, text)); this.selected = id;
  }
  newIdentity(id: string): void {
    if (!id || Object.hasOwn(this.tree.nodes, id)) reject("structure-changed");
  }
  fresh(text: string, kind: SemanticTopic["kind"], level?: number): SemanticTopic {
    this.title(text); return { kind, level, text, unmapped: [], children: [] };
  }
  listPrefix(reference: string, increment: boolean): string {
    const info = this.info(reference), raw = this.source.lines[info.ownRange.start.line - 1];
    const match = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+|$)/.exec(raw);
    if (!match) reject("structure-changed");
    let marker = match[2];
    if (increment && /^\d/.test(marker)) marker = String(Number(marker.slice(0, -1)) + 1) + marker.at(-1);
    return match[1] + marker + (match[3] || " ");
  }
  /** Original coordinates for insertion, with the original adjacent separators intact. */
  placement(parent: string | null, index: number, siblings: readonly string[], body: string,
    forced?: { kind: "heading" | "listItem"; level?: number; indent?: number }): Placement {
    if (!Number.isInteger(index) || index < 0 || index > siblings.length) reject("unsupported-position");
    const parentInfo = parent === null ? undefined : this.info(parent);
    const previous = siblings[index - 1], next = siblings[index];
    let reference = previous ?? next;
    let kind: "heading" | "listItem", level: number | undefined, indent: number | undefined, prefix: string;
    if (forced) { kind = forced.kind; level = forced.level; indent = forced.indent; prefix = ""; }
    else {
      if (parentInfo?.kind === "heading") {
        if (index !== siblings.length) reject("unsupported-position");
        reference = [...siblings].reverse().find(id => this.info(id).kind === "heading") ?? reference;
        kind = siblings.some(id => this.info(id).kind === "heading") ? "heading" : "listItem";
      } else kind = reference ? this.info(reference).kind : "listItem";
      if (kind === "heading") {
        level = parentInfo?.headingLevel === undefined ? this.info(reference!).headingLevel : parentInfo.headingLevel + 1;
        if (level === undefined || level < 2 || level > 6) reject("heading-level-out-of-range");
        prefix = "#".repeat(level) + " ";
      } else {
        if (reference && this.info(reference).kind === "listItem") prefix = this.listPrefix(reference, previous !== undefined);
        else prefix = " ".repeat(parentInfo?.list?.contentIndent ?? 0) + "- ";
        indent = visualWidth(/^[ \t]*/.exec(prefix)![0]);
      }
    }
    let edit: Edit;
    const content = prefix + body;
    if (next) edit = this.source.beforeLine(this.info(next).ownRange.start.line, content);
    else if (previous) edit = this.source.afterRange(this.info(previous).ownRange, content);
    else if (parentInfo) {
      const separator = kind === "listItem" && parentInfo.kind === "heading"
        && !isBlankLine(this.source.lines[parentInfo.ownRange.end.line - 1])
        && !/^\s*(?:[-+*]|\d+[.)])(?:\s|$)/.test(this.source.lines[parentInfo.ownRange.end.line - 1]) ? "\n" : "";
      edit = this.source.afterRange(parentInfo.ownRange, separator + content);
    } else {
      const end = this.source.text.length;
      edit = { start: end, end, text: (end && !this.source.text.endsWith("\n") ? "\n" : "")
        + content + (this.source.text.endsWith("\n") ? "\n" : "") };
    }
    return { edit, kind, level, indent };
  }
  insert(parent: string | null, index: number, newId: string, text: string): void {
    this.newIdentity(newId); this.title(text);
    const siblings = children(this.tree, parent);
    const placement = this.placement(parent, index, siblings, text);
    this.tree.nodes[CREATED] = this.fresh(text, placement.kind, placement.level);
    siblings.splice(index, 0, CREATED); this.edits.push(placement.edit); this.selected = CREATED;
  }
  sibling(id: string, where: "before" | "after", newId: string, text: string): void {
    this.newIdentity(newId); this.title(text);
    const loc = location(this.tree, id), index = loc.index + (where === "after" ? 1 : 0);
    const info = this.info(id);
    if (info.kind === "heading") {
      const level = info.headingLevel!;
      if (level < 2 || level > 6) reject("heading-level-out-of-range");
      const body = "#".repeat(level) + " " + text;
      this.edits.push(where === "before" ? this.source.beforeLine(info.ownRange.start.line, body) : this.source.afterRange(info.ownRange, body));
      this.tree.nodes[CREATED] = this.fresh(text, "heading", level);
    } else {
      const siblings = children(this.tree, loc.parent);
      const reference = index > 0 && this.info(siblings[index - 1]).kind === "listItem" ? siblings[index - 1] : id;
      const body = this.listPrefix(reference, index > 0 && this.info(siblings[index - 1]).kind === "listItem") + text;
      this.edits.push(where === "before" ? this.source.beforeLine(info.ownRange.start.line, body) : this.source.afterRange(info.ownRange, body));
      this.tree.nodes[CREATED] = this.fresh(text, "listItem");
    }
    children(this.tree, loc.parent).splice(index, 0, CREATED); this.selected = CREATED;
  }
  note(id: string | null, value: string): void {
    const info = id === null ? this.parsed.index.center : this.info(id);
    if (!info.noteEditable) reject("note-not-editable");
    const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const note = normalized.split("\n");
    while (note.length && isBlankLine(note[0])) note.shift();
    while (note.length && isBlankLine(note.at(-1)!)) note.pop();
    const text = note.join("\n");
    const owner = id === null ? this.tree.center : this.tree.nodes[id];
    this.selected = id ?? "center";
    if (owner.note === (text || undefined)) return;
    if (text) {
      const allowed = new Set(["paragraph_open", "paragraph_close", "inline"]);
      try {
        // A note may contain zero topics. This also keeps container nesting
        // bounded while recognizing any forbidden block syntax.
        if (tokenizeNoteBlocks(text, 0).some(token => !allowed.has(token.type))) reject("note-has-block-syntax");
      } catch (error) {
        if (error instanceof TopicLimit) reject("note-has-block-syntax");
        throw error;
      }
    }
    owner.note = text || undefined;
    const indent = id === null ? 0 : this.info(id).list?.contentIndent ?? 0;
    const rendered = note.map(line => isBlankLine(line) ? line : " ".repeat(indent) + line).join("\n");
    if (info.noteRange) this.edits.push(text ? this.source.replace(info.noteRange, rendered) : this.source.deleteLines(info.noteRange));
    else if (text) {
      const range: SourceRange = id === null
        ? this.parsed.index.center.kind === "h1" ? this.parsed.index.center.lineRange : reject("note-not-editable")
        : { start: this.info(id).ownRange.start, end: { line: this.info(id).ownRange.start.line,
            column: this.source.lines[this.info(id).ownRange.start.line - 1].length + 1 } };
      this.edits.push(this.source.afterRange(range, rendered));
    }
  }
  /** Return prefix-only edits and update expected heading levels. Opaque bytes stay untouched. */
  shift(id: string, delta: number, tabIndent = false): Edit[] {
    if (!delta) return [];
    const ids = subtree(this.tree, id), info = this.info(id), edits: Edit[] = [];
    if (info.kind === "heading") {
      for (const topic of ids) {
        const node = this.tree.nodes[topic];
        if (node.kind !== "heading") continue;
        const level = node.level! + delta;
        if (level < 2 || level > 6) reject("heading-level-out-of-range");
        const start = this.source.starts[this.info(topic).ownRange.start.line - 1];
        const raw = this.source.lines[this.info(topic).ownRange.start.line - 1];
        const prefix = /^[ \t]*(#{1,6})/.exec(raw);
        if (!prefix) reject("structure-changed");
        const hashes = start + prefix[0].length - prefix[1].length;
        edits.push({ start: hashes, end: hashes + node.level!, text: "#".repeat(level) }); node.level = level;
      }
    } else {
      const opaqueLines = new Set<number>();
      for (const topic of ids) for (const block of this.info(topic).unmapped) {
        if (block.indentSensitive) reject("reindent-unmapped");
        for (let line = block.range.start.line; line <= block.range.end.line; line++) opaqueLines.add(line);
      }
      tabIndent ||= ids.some(topic => this.info(topic).list?.indent.includes("\t"));
      // A pure-tab branch cannot express an intermediate two-space column.
      // Keep whole tab stops while the candidate parser verifies its new parent.
      if (tabIndent) delta = Math.ceil(delta / 4) * 4;
      for (let line = info.ownRange.start.line; line <= info.ownRange.end.line; line++) {
        const raw = this.source.lines[line - 1];
        if (isBlankLine(raw) || opaqueLines.has(line)) continue;
        const prefix = /^[ \t]*/.exec(raw)![0], width = visualWidth(prefix);
        if (width + delta < 0) reject("structure-changed");
        const next = delta > 0
          ? (tabIndent && /^\t*$/.test(prefix) ? "\t".repeat(delta / 4) : " ".repeat(delta)) + prefix
          : removeIndent(prefix, -delta);
        const start = this.source.starts[line - 1];
        edits.push({ start, end: start + prefix.length, text: next });
      }
    }
    return edits;
  }
  move(id: string, parent: string | null, index: number, explicitDelta?: number): void {
    const ids = subtree(this.tree, id);
    if (parent !== null && ids.includes(parent)) reject("structure-changed");
    const oldLoc = location(this.tree, id), info = this.info(id), parentInfo = parent === null ? undefined : this.info(parent);
    const beforeOrder = order(this.tree);
    const siblings = children(this.tree, parent).filter(child => child !== id);
    if (!Number.isInteger(index) || index < 0 || index > siblings.length) reject("unsupported-position");
    if (oldLoc.parent === parent && oldLoc.index === index) { this.selected = id; return; }
    if (info.kind === "heading" && parentInfo?.kind === "listItem") reject("heading-list-conversion");
    if (info.kind === "listItem" && oldLoc.parent !== null && this.info(oldLoc.parent).kind === "heading" && parent === null) reject("heading-list-conversion");
    const reference = siblings[index - 1] ?? siblings[index];
    if (parent === null && oldLoc.parent !== parent && reference && this.info(reference).kind !== info.kind) reject("heading-list-conversion");
    const nextLevel = parentInfo?.headingLevel !== undefined ? parentInfo.headingLevel + 1 : reference ? this.info(reference).headingLevel ?? 2 : 2;
    const referenceIndent = reference ? this.info(reference).list?.indent : undefined;
    const tabIndent = parentInfo?.list?.indent.includes("\t") || referenceIndent?.includes("\t") || false;
    const nextIndent = referenceIndent?.includes("\t") ? visualWidth(referenceIndent)
      : parentInfo?.list?.contentIndent ?? (referenceIndent === undefined ? 0 : visualWidth(referenceIndent));
    const delta = explicitDelta ?? (oldLoc.parent === parent ? 0
      : info.kind === "heading" ? nextLevel - info.headingLevel! : nextIndent - visualWidth(info.list!.indent));
    const shifts = this.shift(id, delta, tabIndent);
    children(this.tree, oldLoc.parent).splice(oldLoc.index, 1);
    children(this.tree, parent).splice(index, 0, id);
    if (JSON.stringify(beforeOrder) === JSON.stringify(order(this.tree))) this.edits.push(...shifts);
    else {
      const [start, end] = this.source.bounds(info.ownRange);
      let body = this.source.text.slice(start, end);
      for (const shift of [...shifts].sort((a, b) => b.start - a.start)) body = body.slice(0, shift.start - start) + shift.text + body.slice(shift.end - start);
      const placement = this.placement(parent, index, siblings, body, { kind: info.kind });
      this.edits.push(this.source.deleteLines(info.ownRange), placement.edit);
    }
    this.selected = id;
  }
  wrap(id: string, newId: string, text: string): void {
    this.newIdentity(newId); this.title(text);
    const loc = location(this.tree, id), info = this.info(id);
    if (info.kind === "heading" && info.headingLevel! < 2) reject("heading-level-out-of-range");
    const wrapper = this.fresh(text, info.kind, info.headingLevel);
    const shifts = this.shift(id, info.kind === "heading" ? 1 : info.list!.contentIndent - visualWidth(info.list!.indent));
    const prefix = info.kind === "heading" ? "#".repeat(info.headingLevel!) + " " : this.listPrefix(id, false);
    // Ordered markers other than 1 cannot interrupt the wrapper paragraph.
    const separator = info.list && /^\d/.test(info.list.marker) && Number(info.list.marker.slice(0, -1)) !== 1 ? "\n" : "";
    this.edits.push(this.source.beforeLine(info.ownRange.start.line, prefix + text + separator), ...shifts);
    wrapper.children = [id]; this.tree.nodes[CREATED] = wrapper;
    children(this.tree, loc.parent).splice(loc.index, 1, CREATED); this.selected = CREATED;
  }
  delete(id: string, confirmed: boolean): void {
    const ids = subtree(this.tree, id), blocks = ids.flatMap(topic => this.info(topic).unmapped);
    if (blocks.length && !confirmed) reject("needs-confirmation", { unmappedSummary: blocks.map(block => ({ kind: block.kind, lines: block.range.end.line - block.range.start.line + 1 })) });
    const loc = location(this.tree, id);
    children(this.tree, loc.parent).splice(loc.index, 1);
    for (const topic of ids) delete this.tree.nodes[topic];
    this.edits.push(this.source.deleteLines(this.info(id).ownRange));
  }
  keepChildren(id: string): void {
    const info = this.info(id), node = this.tree.nodes[id], loc = location(this.tree, id);
    if (node.note !== undefined || info.unmapped.length) reject("delete-keep-children-has-content");
    if (info.kind === "heading" && node.children.some(child => this.info(child).kind === "listItem")) reject("delete-keep-children-heading-has-list-children");
    for (const child of node.children) this.edits.push(...this.shift(child,
      info.kind === "heading" ? -1 : visualWidth(info.list!.indent) - visualWidth(this.info(child).list!.indent)));
    const line = info.ownRange.start.line;
    this.edits.push(this.source.deleteLines({ start: { line, column: 1 }, end: { line, column: this.source.lines[line - 1].length + 1 } }));
    children(this.tree, loc.parent).splice(loc.index, 1, ...node.children); delete this.tree.nodes[id];
  }
}

/** Pure, raw-preserving operations for editable ordinary Markdown notes. */
export function createNoteMarkdownPatches(parsed: EditableNote, command: NoteSemanticCommand): NotePatchResult {
  try {
    // Existing-target lookup precedes operation-specific validation. Created IDs
    // are deliberately excluded from this lookup.
    const targets: (string | null)[] = command.type === "node.insertChild" ? [command.parentId]
      : command.type === "node.insertSibling" ? [command.siblingId]
      : command.type === "node.move" ? [command.nodeId, command.nextParentId]
      : "nodeId" in command ? [command.nodeId] : [];
    if (targets.some(id => id !== null && !Object.hasOwn(parsed.map.nodesById, id))) reject("unknown-target");
    validateSnapshot(parsed);
    const op = new Operation(parsed);
    switch (command.type) {
      case "map.rename": {
        op.title(command.nextTitle); op.selected = "center";
        const center = parsed.index.center;
        if (center.kind === "h1") { op.tree.center.text = command.nextTitle; op.edits.push(op.source.replace(center.titleRange, command.nextTitle)); }
        else {
          renameFilenameCenter(parsed, op.tree, command.nextTitle);
          const offset = center.insertAfterLine === 0 ? 0 : op.source.starts[center.insertAfterLine] ?? op.source.text.length;
          const prefix = offset > 0 && op.source.text[offset - 1] !== "\n" ? "\n" : "";
          op.edits.push({ start: offset, end: offset, text: prefix + "# " + command.nextTitle + "\n\n" });
        }
        break;
      }
      case "map.updateNote": op.note(null, command.note); break;
      case "map.clearNote": op.note(null, ""); break;
      case "node.rename": op.rename(command.nodeId, command.nextText); break;
      case "node.updateNote": op.note(command.nodeId, command.note); break;
      case "node.clearNote": op.note(command.nodeId, ""); break;
      case "node.insertChild": op.insert(command.parentId, command.index, command.nodeId, command.text); break;
      case "node.insertSibling": op.sibling(command.siblingId, command.where, command.nodeId, command.text); break;
      case "node.renameAndInsertChild": op.rename(command.nodeId, command.nextText); op.insert(command.nodeId, command.index, command.nextNodeId, command.text); break;
      case "node.renameAndInsertSibling": op.rename(command.nodeId, command.nextText); op.sibling(command.nodeId, command.where, command.nextNodeId, command.text); break;
      case "node.move": op.move(command.nodeId, command.nextParentId, command.nextIndex); break;
      case "node.indent": {
        const loc = location(op.tree, command.nodeId);
        if (loc.index === 0) reject("unsupported-position");
        const parent = children(op.tree, loc.parent)[loc.index - 1];
        op.move(command.nodeId, parent, op.tree.nodes[parent].children.length, op.info(command.nodeId).kind === "heading" ? 1 : undefined); break;
      }
      case "node.outdent": {
        const loc = location(op.tree, command.nodeId);
        if (loc.parent === null) reject("main-branch-outdent");
        const parent = location(op.tree, loc.parent);
        op.move(command.nodeId, parent.parent, parent.index + 1, op.info(command.nodeId).kind === "heading" ? -1 : undefined); break;
      }
      case "node.wrapInNewParent": op.wrap(command.nodeId, command.nextNodeId, command.text); break;
      case "node.delete": op.delete(command.nodeId, command.confirmedUnmapped === true); break;
      case "node.deleteKeepChildren": op.keepChildren(command.nodeId); break;
    }
    return validateCandidate(parsed, op.tree, op.source.patches(op.edits), op.selected);
  } catch (error) {
    if (error instanceof PatchRejection) return { ok: false, reason: error.reason, ...(error.detail ? { detail: error.detail } : {}) };
    throw error;
  }
}
