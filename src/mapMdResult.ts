import type { NoteSemanticCommand, SourcePosition, TextPatch, ThoughtMap } from '@thoughtforge/core';

function sourceText(text: string) {
  const lines = text.split('\n'), starts: number[] = [];
  let next = 0;
  for (const line of lines) { starts.push(next); next += line.length + 1; }
  return { lines, offset: (p: SourcePosition) => (starts[p.line - 1] ?? text.length) +
    (p.line > lines.length ? 0 : p.column - 1) };
}

type TopicAnchor = { id: string; start: number; end: number; text: string };

/** A move is the command's exact cut block reinserted with a uniform indent
 * change. Equal labels (or an arbitrary delete/insert pair) are not evidence. */
function movedAnchors(beforeLf: string, patches: readonly TextPatch[], map: ThoughtMap,
  command: NoteSemanticCommand, anchors: readonly TopicAnchor[]): { insertion: TextPatch; anchors: TopicAnchor[] } | undefined {
  if (!['node.move', 'node.indent', 'node.outdent'].includes(command.type) || !('nodeId' in command) || patches.length !== 2) return undefined;
  const range = map.nodesById[command.nodeId]?.source?.range, [cut, insertion] = patches;
  if (!range || !cut || !insertion || cut.text !== '') return undefined;
  const source = sourceText(beforeLf), start = source.offset({ line: range.start.line, column: 1 });
  const end = range.end.line < source.lines.length ? source.offset({ line: range.end.line + 1, column: 1 }) : beforeLf.length;
  const at = source.offset(insertion.range.start);
  const cutStart = source.offset(cut.range.start);
  // EOF moves may transfer the preceding LF separator(s) to the destination.
  // Prove that exact boundary change before comparing the reindented body.
  const transferred = command.type === 'node.move' && end === beforeLf.length && !beforeLf.endsWith('\n') &&
    cutStart < start && /^\n+$/.test(beforeLf.slice(cutStart, start)) &&
    !beforeLf.slice(0, cutStart).endsWith('\n') && at <= cutStart;
  if ((!transferred && cutStart !== start) || source.offset(cut.range.end) !== end ||
      source.offset(insertion.range.end) !== at || at > start && at < end) return undefined;
  const prefix = transferred && at === cutStart || at === beforeLf.length && !beforeLf.endsWith('\n') ? '\n' : '';
  const suffix = transferred && at < cutStart ? '\n' : '';
  if (!insertion.text.startsWith(prefix) || !insertion.text.endsWith(suffix)) return undefined;
  // Only node.move to an LF-less document's EOF may omit the cut block's final
  // LF. All other bytes and the uniform indent change still require exact proof.
  const oldBlock = beforeLf.slice(start, end), omitsFinalLf = command.type === 'node.move' &&
    at === beforeLf.length && !beforeLf.endsWith('\n') && !insertion.text.endsWith('\n');
  const block = sourceText(insertion.text.slice(prefix.length, insertion.text.length - suffix.length)),
    oldLines = (omitsFinalLf ? oldBlock.replace(/\n$/, '') : oldBlock).split('\n');
  const indent = block.lines[0]?.match(/^( *)- /)?.[1].length;
  if (indent === undefined || block.lines.length !== oldLines.length) return undefined;
  const delta = indent - (range.start.column - 1);
  if (!oldLines.every((line, index) => {
    if (index === oldLines.length - 1 && line === '') return block.lines[index] === '';
    const spaces = line.match(/^ */)![0].length, next = spaces + delta;
    return next >= 0 && block.lines[index] === ' '.repeat(next) + line.slice(spaces);
  })) return undefined;
  const moved = anchors.filter(anchor => anchor.start >= start && anchor.end <= end).map(anchor => {
    const position = map.nodesById[anchor.id]!.source!.range.start;
    const offset = prefix.length + block.offset({ line: position.line - range.start.line + 1, column: position.column + delta });
    return { ...anchor, start: offset, end: offset + 2 + anchor.text.length };
  });
  return { insertion, anchors: moved };
}

/** Prove old topic identities using the applied source edits, never parser IDs
 * or label search. Missing/ambiguous evidence only omits a mapping. */
export function mapMdIdMaps(beforeLf: string, afterLf: string, patches: readonly TextPatch[], before: ThoughtMap,
  after: ThoughtMap, command: NoteSemanticCommand): { idMap: Record<string, string>; inverseIdMap: Record<string, string> } {
  const empty = { idMap: {}, inverseIdMap: {} }, source = sourceText(beforeLf);
  let anchors: TopicAnchor[] = Object.values(before.nodesById).flatMap(node => {
    const p = node.source?.range.start; if (!p) return [];
    const line = source.lines[p.line - 1];
    if (line !== ' '.repeat(Math.max(0, p.column - 1)) + '- ' + node.text) return [];
    const start = source.offset(p);
    return [{ id: node.id, start, end: start + 2 + node.text.length, text: node.text }];
  });
  const move = movedAnchors(beforeLf, patches, before, command, anchors);
  const movedIds = new Set(move?.anchors.map(anchor => anchor.id));
  anchors = anchors.filter(anchor => !movedIds.has(anchor.id));
  const rename = command.type === 'node.rename' || command.type === 'node.renameAndInsertChild' || command.type === 'node.renameAndInsertSibling'
    ? command : undefined;
  const order = patches.map((patch, index) => ({ patch, index })).sort((a, b) =>
    source.offset(b.patch.range.start) - source.offset(a.patch.range.start) || a.index - b.index);
  let text = beforeLf;
  for (const { patch } of order) {
    // Recompute offsets exactly as the patch applier does, including EOF and
    // same-position edits. Final raw equality is mandatory for any mapping.
    const current = sourceText(text), a = current.offset(patch.range.start), b = current.offset(patch.range.end);
    if (a < 0 || b < a || b > text.length) return empty;
    const delta = patch.text.length - (b - a);
    anchors = anchors.flatMap(anchor => {
      if (rename?.nodeId === anchor.id && a === anchor.start + 2 && b === anchor.end && patch.text === rename.nextText) {
        return [{ ...anchor, end: anchor.end + delta, text: rename.nextText }];
      }
      // deleteKeepChildren removes only the descendant's indent prefix: its
      // unchanged bullet survives here, independent of its changed ownRangeHash.
      if (b <= anchor.start) return [{ ...anchor, start: anchor.start + delta, end: anchor.end + delta }];
      if (a >= anchor.end) return [anchor];
      return []; // A replaced/deleted bullet cannot prove its old identity.
    });
    text = text.slice(0, a) + patch.text + text.slice(b);
    if (move?.insertion === patch) anchors.push(...move.anchors.map(anchor => ({ ...anchor, start: a + anchor.start, end: a + anchor.end })));
  }
  if (text !== afterLf) return empty;
  const nextSource = sourceText(afterLf), atOffset = new Map<number, typeof after.nodesById[string][]>();
  for (const node of Object.values(after.nodesById)) {
    const p = node.source?.range.start; if (!p) continue;
    const offset = nextSource.offset(p), candidates = atOffset.get(offset) ?? [];
    candidates.push(node); atOffset.set(offset, candidates);
  }
  const proven = anchors.flatMap(anchor => {
    const candidates = atOffset.get(anchor.start);
    if (candidates?.length !== 1) return [];
    const node = candidates[0]!, p = node.source!.range.start;
    return node.text === anchor.text && anchor.end === anchor.start + 2 + node.text.length &&
      nextSource.lines[p.line - 1] === ' '.repeat(Math.max(0, p.column - 1)) + '- ' + node.text &&
      text.slice(anchor.start, anchor.end) === '- ' + node.text ? [[anchor.id, node.id] as const] : [];
  });
  const counts = new Map<string, number>();
  for (const [, id] of proven) counts.set(id, (counts.get(id) ?? 0) + 1);
  const idMap: Record<string, string> = {}, inverseIdMap: Record<string, string> = {};
  for (const [oldId, newId] of proven) if (counts.get(newId) === 1) { idMap[oldId] = newId; inverseIdMap[newId] = oldId; }
  return { idMap, inverseIdMap };
}

/** Prove the parsed topic came from this insertion patch. IDs, labels and
 * sibling indices cannot identify it after the legacy parser renumbers nodes. */
export function insertedMapNodeId(beforeLf: string, afterLf: string, patches: readonly TextPatch[], map: ThoughtMap): string | undefined {
  const insertion = patches.at(-1); if (!insertion || !/^\n? *- [^\r\n]*\n?$/.test(insertion.text)) return undefined;
  const offset = (text: string, p: SourcePosition) => {
    const lines = text.split('\n'); if (p.line > lines.length) return text.length;
    return lines.slice(0, p.line - 1).reduce((n, line) => n + line.length + 1, 0) + p.column - 1;
  };
  const order = patches.map((patch, index) => ({ patch, index })).sort((a, b) => offset(beforeLf, b.patch.range.start) - offset(beforeLf, a.patch.range.start) || a.index - b.index);
  let text = beforeLf, span: { start: number; end: number } | undefined;
  for (const { patch } of order) {
    const a = offset(text, patch.range.start), b = offset(text, patch.range.end);
    if (span) {
      if (b <= span.start) { const delta = patch.text.length - (b - a); span.start += delta; span.end += delta; }
      else if (a < span.end) return undefined;
    }
    text = text.slice(0, a) + patch.text + text.slice(b);
    if (patch === insertion) span = { start: a, end: a + patch.text.length };
  }
  if (!span || text !== afterLf || text.slice(span.start, span.end) !== insertion.text) return undefined;
  // A generated bullet may omit its final LF only for an actual EOF append
  // to a document that already omits it, after all atomic edits are replayed.
  if (!insertion.text.endsWith('\n') && (beforeLf.length === 0 || beforeLf.endsWith('\n') ||
      offset(beforeLf, insertion.range.start) !== beforeLf.length || span.end !== text.length)) return undefined;
  const start = span.start + (insertion.text.startsWith('\n') ? 1 : 0), line = text.slice(0, start).split('\n').length;
  const bullet = insertion.text.replace(/^\n/, '').replace(/\n$/, ''), indent = bullet.indexOf('- ');
  const candidates = Object.values(map.nodesById).filter(node => node.source?.range.start.line === line &&
    node.source.range.start.column === indent + 1 && node.source.range.end.line === line && node.source.range.end.column === bullet.length + 1 &&
    node.text === bullet.slice(indent + 2) && node.children.length === 0);
  return candidates.length === 1 ? candidates[0]!.id : undefined;
}
