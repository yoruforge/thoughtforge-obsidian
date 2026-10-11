import type { SourcePosition, ThoughtMap, ThoughtNode } from './domain.js';
import { classifyMarkdownLine } from './markdown-grammar.js';
import { parseThoughtMapMarkdown } from './parser.js';
import { applyTextPatches, type TextPatch } from './patch.js';
import type { WrapInNewParentCommand } from './semantic-commands.js';

export type MapMdRejectReason = 'unsupported-eol' | 'invalid-source' | 'unknown-target'
  | 'unrepresentable-source' | 'invalid-label' | 'identity-collision' | 'invalid-command'
  | 'bad-guard' | 'stale' | 'stale-proof' | 'invalid-proof' | 'invalid-payload'
  | 'payload-limit' | 'payload-mismatch' | 'structure-changed';
export class MapMdRejection extends Error {
  readonly reason: MapMdRejectReason;
  constructor(reason: MapMdRejectReason) { super(reason); this.reason = reason; }
}
export function refuse(reason: MapMdRejectReason): never { throw new MapMdRejection(reason); }
export const utf8Length = (text: string): number => new TextEncoder().encode(text).byteLength;
export type RawSpan = Readonly<{ startUtf16: number; endUtf16: number; startByte: number; endByte: number }>;
export function rawSpan(raw: string, startUtf16: number, endUtf16: number): RawSpan {
  return { startUtf16, endUtf16, startByte: utf8Length(raw.slice(0, startUtf16)), endByte: utf8Length(raw.slice(0, endUtf16)) };
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function keys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join(',') === expected;
}
export function label(value: unknown): value is string {
  return typeof value === 'string' && !/[\r\n\u2028\u2029]/u.test(value);
}

/** Source positions stay LF/UTF-16. Ownership scans the physical envelope,
 * including late content that the legacy parser's subtree end may omit. */
export class MapMdSource {
  readonly lf: string;
  readonly newline: '\n' | '\r\n';
  readonly lines: string[];
  readonly starts: number[] = [];
  readonly map: ThoughtMap;
  readonly atLine = new Map<number, ThoughtNode>();
  readonly owners = new Map<number, string>();
  readonly content = new Map<string, { line: number; kind: string; raw: string }[]>();
  readonly raw: string;
  constructor(raw: string) {
    this.raw = raw;
    if (raw.includes('\r') && /[\r\n]/.test(raw.replaceAll('\r\n', ''))) refuse('unsupported-eol');
    this.newline = raw.includes('\r') ? '\r\n' : '\n';
    this.lf = raw.replaceAll('\r\n', '\n'); this.lines = this.lf.split('\n');
    let start = 0;
    for (const line of this.lines) { this.starts.push(start); start += line.length + 1; }
    try { this.map = parseThoughtMapMarkdown(this.lf); } catch { refuse('invalid-source'); }
    for (const node of Object.values(this.map.nodesById)) {
      const p = node.source!.range.start;
      if (this.atLine.has(p.line) || this.lines[p.line - 1] !== ' '.repeat(p.column - 1) + '- ' + node.text) refuse('invalid-source');
      this.atLine.set(p.line, node);
    }
    const stack: ThoughtNode[] = [];
    let callout: { owner: string; indent: number } | undefined;
    for (let i = 0; i < this.lines.length; i++) {
      const line = i + 1, text = this.lines[i], c = classifyMarkdownLine({ text });
      if (c.kind !== 'blockquote') callout = undefined;
      const node = this.atLine.get(line);
      if (node) {
        while (stack.length && this.indent(stack.at(-1)!) >= this.indent(node)) stack.pop();
        stack.push(node); this.owners.set(line, node.id);
      } else if (c.kind === 'note-start' || c.kind === 'id-anchor' || c.kind === 'blockquote') {
        const owner = [...stack].reverse().find(n => this.indent(n) + 2 === c.indent);
        if (owner && (c.kind !== 'blockquote' || callout?.owner === owner.id && callout.indent === c.indent)) {
          this.owners.set(line, owner.id);
          const content = this.content.get(owner.id) ?? [];
          content.push({ line, kind: c.kind, raw: text.slice(c.indent) }); this.content.set(owner.id, content);
          if (c.kind === 'note-start') callout = { owner: owner.id, indent: c.indent };
        } else callout = undefined;
      }
    }
  }
  node(id: string): ThoughtNode {
    if (!Object.hasOwn(this.map.nodesById, id)) refuse('unknown-target');
    return this.map.nodesById[id];
  }
  indent(node: ThoughtNode): number { return node.source!.range.start.column - 1; }
  offset(p: SourcePosition): number {
    const start = this.starts[p.line - 1];
    if (start === undefined || !Number.isInteger(p.column) || p.column < 1 || p.column > this.lines[p.line - 1].length + 1) refuse('invalid-source');
    return start + p.column - 1;
  }
  position(offset: number): SourcePosition {
    let line = this.starts.length - 1;
    while (line > 0 && this.starts[line] > offset) line--;
    return { line: line + 1, column: offset - this.starts[line] + 1 };
  }
  ids(id: string): Set<string> {
    const found = new Set<string>(), stack = [id];
    while (stack.length) {
      const current = stack.pop()!;
      if (found.has(current)) refuse('invalid-source');
      found.add(current); stack.push(...this.node(current).children);
    }
    return found;
  }
  envelope(id: string): { startLine: number; endLine: number; ids: Set<string>; ownedLines: number[] } {
    const node = this.node(id), startLine = node.source!.range.start.line, ids = this.ids(id);
    let endLine = this.lines.length + 1;
    for (const candidate of this.atLine.values()) {
      const line = candidate.source!.range.start.line;
      if (line > startLine && this.indent(candidate) <= this.indent(node)) endLine = Math.min(endLine, line);
    }
    const ownedLines: number[] = [];
    for (let line = startLine; line < endLine; line++) {
      const text = this.lines[line - 1], owner = this.owners.get(line);
      if (classifyMarkdownLine({ text }).kind === 'blank') continue;
      // Unknown or standalone quote/header cannot be proven safe to reindent,
      // and must not silently disappear from a label-only copied branch.
      if (!owner) refuse('unrepresentable-source');
      if (ids.has(owner)) ownedLines.push(line);
    }
    return { startLine, endLine, ids, ownedLines };
  }
  occupied(id: string): { start: number; end: number } {
    const envelope = this.envelope(id), last = envelope.ownedLines.at(-1)!;
    return { start: this.starts[envelope.startLine - 1], end: this.starts[last] ?? this.lf.length };
  }
  rawOffset(lfOffset: number): number {
    return this.newline === '\n' ? lfOffset : lfOffset + this.lf.slice(0, lfOffset).split('\n').length - 1;
  }
  span(id: string): RawSpan {
    const { start, end } = this.occupied(id);
    return rawSpan(this.raw, this.rawOffset(start), this.rawOffset(end));
  }
}

export function wrapEdits(source: MapMdSource, command: WrapInNewParentCommand): readonly TextPatch[] {
  if (!label(command.text)) refuse('invalid-label');
  if (typeof command.nextNodeId !== 'string' || !command.nextNodeId || Object.hasOwn(source.map.nodesById, command.nextNodeId)) refuse('identity-collision');
  const target = source.node(command.nodeId), envelope = source.envelope(command.nodeId);
  return envelope.ownedLines.map(line => {
    const p = { line, column: 1 };
    return { range: { start: p, end: p }, text: line === envelope.startLine
      ? ' '.repeat(source.indent(target)) + '- ' + command.text + '\n  ' : '  ' };
  });
}

/** Unguarded legacy patch entrypoint; guarded R7 callers use map-md.ts. */
export function mapMdWrapEdits(raw: string, map: ThoughtMap, command: WrapInNewParentCommand): readonly TextPatch[] {
  const source = new MapMdSource(raw);
  const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
  const sameRange = (a: ThoughtNode['source'], b: ThoughtNode['source']) => !!a && !!b &&
    a.range.start.line === b.range.start.line && a.range.start.column === b.range.start.column &&
    a.range.end.line === b.range.end.line && a.range.end.column === b.range.end.column;
  if (source.map.title !== map.title || !sameRange(source.map.source, map.source) || !sameIds(source.map.roots, map.roots) ||
    Object.keys(source.map.nodesById).length !== Object.keys(map.nodesById).length ||
    Object.values(source.map.nodesById).some(node => {
      const supplied = map.nodesById[node.id];
      return !supplied || node.id !== supplied.id || node.text !== supplied.text || node.note !== supplied.note ||
        !sameRange(node.source, supplied.source) || !sameIds(node.children, supplied.children);
    })) refuse('invalid-source');
  const patches = wrapEdits(source, command), after = new MapMdSource(applyTextPatches(raw, patches));
  if (Object.hasOwn(after.map.nodesById, command.nextNodeId)) refuse('identity-collision');
  return patches;
}
