import { isR7Paste, type R7PasteCommand } from './r7Clipboard.ts';
import type { NoteSemanticCommand, MapMdRejectReason, NotePatchRejectReason, NotePatchRejectDetail, ThoughtMap, RawSpan,
  NoteModeReadOnlyReason, NoteNotOpenableReason, SourceRange, UnmappedBlock } from '@thoughtforge/core';

export type GuardTarget = Readonly<{ kind: 'node'; nodeId: string; titleSource: string; parentRawHash?: string }>
  | Readonly<{ kind: 'center'; titleSource: string }> | Readonly<{ kind: 'roots' }>;
export type CommandGuard = Readonly<{ baseHash: string; targets: readonly GuardTarget[] }>;
type Request = Readonly<{ source: 'webview'; protocolVersion: 2; documentUri: string; requestId: string }>;
export type HostCommand = NoteSemanticCommand | R7PasteCommand;
export type CommandRequestV2 = Request & Readonly<{ type: 'thoughtforge.command'; command: HostCommand; guard?: unknown }>;
export type CommandMessageV2 = CommandRequestV2 & Readonly<{ guard: CommandGuard }>;
export type HistoryRequestV2 = Request & Readonly<{ type: 'thoughtforge.history.undo' | 'thoughtforge.history.redo'; baseHash: string }>;
type Reply = Readonly<{ source: 'extension'; protocolVersion: 2; documentUri: string }>;
export type CommandRejectReason = 'stale' | 'pending-markdown' | 'markdown-state-unknown' | 'bad-guard'
  | 'read-only' | 'r7-rejected' | 'note-rejected' | 'validation-failed' | 'apply-rejected' | 'unexpected-error';
export type CommandResultV2 = Reply & Readonly<{ type: 'thoughtforge.command.result'; requestId: string }> & (
  | Readonly<{ status: 'applied'; nextHash: string; resultNodeId?: string; insertedRawSpan?: RawSpan; insertedSubtreeRange?: SourceRange; idMap: Readonly<Record<string, string>> }>
  | Readonly<{ status: 'rejected'; reason: CommandRejectReason; code?: NotePatchRejectReason | MapMdRejectReason | 'copy-expired' | 'request-limit'; detail?: NotePatchRejectDetail }>);
export type HistoryResultV2 = Reply & Readonly<{
  type: 'thoughtforge.history.result'; requestId: string;
  status: 'applied' | 'nothing' | 'stale' | 'pending-markdown' | 'markdown-state-unknown' | 'read-only' | 'invalidated';
  nextHash?: string; resultNodeId?: string; idMap?: Readonly<Record<string, string>>;
}>;
export type HistoryInvalidation = 'external-change' | 'renamed' | 'deleted' | 'closed';
export type HistoryStateV2 = Reply & Readonly<{
  type: 'thoughtforge.history.state'; canUndo: boolean; canRedo: boolean; invalidatedReason?: HistoryInvalidation;
}>;
export type ModelCauseV2 = Readonly<{ kind: 'initial' | 'external' }>
  | Readonly<{ kind: 'applied' | 'undo' | 'redo'; requestId: string }>
  | Readonly<{ kind: 'applied-elsewhere'; requestId: string; idMap: Readonly<Record<string, string>> }>;
type UnmappedSummary = Readonly<{ kind: UnmappedBlock['kind']; lines: number; range: SourceRange }>;
export type HostReasonV2 = 'plugin-data-unknown-version' | 'plugin-data-invalid' | 'plugin-data-load-failed'
  | 'pending-markdown' | 'markdown-state-unknown' | 'device-id-unavailable';
export type ModelUpdateV2 = Reply & Readonly<{
  type: 'thoughtforge.model.update'; contentHash: string; cause: ModelCauseV2; mode: 'map-md' | 'note'; map?: ThoughtMap;
  noteIndex?: Readonly<{
    center: Readonly<{ kind: 'h1' | 'filename'; noteEditable: boolean; note?: string; anchorHash?: string; unmapped: readonly UnmappedSummary[] }>;
    nodes: Readonly<Record<string, Readonly<{ kind: 'heading' | 'listItem'; noteEditable: boolean;
      unmapped: readonly UnmappedSummary[]; subtreeHasUnmapped: boolean; ownRangeHash: string }>>>;
  }>;
  writeState: 'ready' | 'waiting-markdown-save' | 'read-only' | 'not-openable' | 'stopped';
  parseReasons?: readonly (NoteModeReadOnlyReason | NoteNotOpenableReason)[];
  hostReasons?: readonly HostReasonV2[];
}>;
export type LinkOpenMessageV2 = Readonly<{ source: 'webview'; protocolVersion: 2; type: 'thoughtforge.link.open';
  documentUri: string; linktext: string; linkKind: 'wikilink' | 'markdown'; nodeId: string; openIn: 'same-tab' | 'new-tab' }>;
export type LinkOpenResultV2 = Reply & Readonly<{ type: 'thoughtforge.link.open.result'; status: 'opened' | 'unresolved' | 'refused' }>;
export type R7ResultV2 = Reply & Readonly<{type: 'thoughtforge.r7.copy.result' | 'thoughtforge.r7.read.result'; requestId: string; ok: boolean; effectId?: string; copyToken?: string; reason?: string; command?: R7PasteCommand; guard?: CommandGuard}>;
export type HostMessageV2 = R7ResultV2 | ModelUpdateV2 | CommandResultV2 | HistoryResultV2 | HistoryStateV2 | LinkOpenResultV2;

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function index(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
export function isContentHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
export function isNoteCommand(value: unknown): value is NoteSemanticCommand {
  if (!record(value)) return false;
  const c = value, text = (key: string) => typeof c[key] === 'string', node = (key = 'nodeId') => id(c[key]);
  switch (c.type) {
    case 'map.rename': return text('nextTitle');
    case 'map.updateNote': return text('note');
    case 'map.clearNote': return true;
    case 'node.rename': return node() && text('nextText');
    case 'node.updateNote': return node() && text('note');
    case 'node.clearNote': case 'node.deleteKeepChildren': case 'node.indent': case 'node.outdent': return node();
    case 'node.delete': return node() && (c.confirmedUnmapped === undefined || c.confirmedUnmapped === true);
    case 'node.insertChild': return (c.parentId === null || node('parentId')) && node() && index(c.index) && text('text');
    case 'node.insertSibling': return node('siblingId') && node() && (c.where === 'before' || c.where === 'after') && text('text');
    case 'node.move': return node() && (c.nextParentId === null || node('nextParentId')) && index(c.nextIndex);
    case 'node.renameAndInsertChild': return node() && text('nextText') && node('nextNodeId') && index(c.index) && text('text');
    case 'node.renameAndInsertSibling': return node() && text('nextText') && node('nextNodeId') && (c.where === 'before' || c.where === 'after') && text('text');
    case 'node.wrapInNewParent': return node() && node('nextNodeId') && text('text');
    default: return false; // v2 subtree guard has no accepted definition; do not invent one.
  }
}
export function isRequestV2(value: unknown, uri: string): value is CommandRequestV2 | HistoryRequestV2 {
  if (!record(value) || value.source !== 'webview' || value.protocolVersion !== 2 || value.documentUri !== uri || !id(value.requestId)) return false;
  if (value.type === 'thoughtforge.command') return isR7Paste(value.command) || isNoteCommand(value.command);
  return (value.type === 'thoughtforge.history.undo' || value.type === 'thoughtforge.history.redo') && isContentHash(value.baseHash);
}
/** Shape + exact multiset of command targets; title values are checked against the current model separately. */
export function hasCommandGuard(command: HostCommand, value: unknown): value is CommandGuard {
  if (!record(value) || !isContentHash(value.baseHash) || !Array.isArray(value.targets)) return false;
  const node = (nodeId: string | null): string => nodeId === null ? 'roots' : `node:${nodeId}`;
  let expected: string[];
  switch (command.type) {
    case 'map.rename': case 'map.updateNote': case 'map.clearNote': expected = ['center']; break;
    case 'node.pasteSubtreeAsLastChild': expected = [node(command.parentId)]; break;
    case 'node.insertChild': expected = [node(command.parentId)]; break;
    case 'node.insertSibling': expected = [node(command.siblingId)]; break;
    case 'node.move': expected = [node(command.nodeId), node(command.nextParentId)]; break;
    default: expected = [node(command.nodeId)];
  }
  if (value.targets.length !== expected.length) return false;
  const actual: string[] = [];
  for (const t of value.targets) {
    if (!record(t)) return false;
    const keys = Object.keys(t).sort().join(',');
    if (t.kind === 'roots' && keys === 'kind') actual.push('roots');
    else if (t.kind === 'center' && keys === 'kind,titleSource' && typeof t.titleSource === 'string') actual.push('center');
    else if (t.kind === 'node' && (keys === 'kind,nodeId,titleSource' && command.type !== 'node.pasteSubtreeAsLastChild' || keys === 'kind,nodeId,parentRawHash,titleSource' && command.type === 'node.pasteSubtreeAsLastChild' && isContentHash(t.parentRawHash)) && id(t.nodeId) && typeof t.titleSource === 'string') actual.push(node(t.nodeId));
    else return false;
  }
  return actual.sort().every((key, i) => key === expected.sort()[i]);
}
