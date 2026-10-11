import { R7Clipboard, isR7Paste, r7Keys } from './r7Clipboard.ts';
import { createMapMdWrapPatches, applyTextPatches, createMarkdownPatches, createNoteMarkdownPatches, parseNoteMapMarkdown, sha256Text,
  type MapMdPatchResult, type NoteMapParseResult, type NoteSemanticCommand, type SemanticCommand, type SourceRange, type ThoughtMap } from '@thoughtforge/core';
import { parseDocumentForWebviewSync } from './shared/documentSync.js';
import { editableLineEndings, isMapPath, toLf, type MapHost } from './host.ts';
import { hasCommandGuard, isRequestV2, type HostCommand, type CommandGuard, type CommandRequestV2, type CommandRejectReason,
  type HistoryInvalidation, type HistoryRequestV2, type HistoryResultV2, type HostMessageV2,
  type HostReasonV2, type ModelCauseV2, type ModelUpdateV2 } from './protocolV2.ts';
import type { DraftRecoverySnapshot } from './draftRecovery.ts';
import { insertedMapNodeId, mapMdIdMaps } from './mapMdResult.ts';

export interface MapClientV2 { readonly alive: boolean; readonly generation: number; post(message: HostMessageV2): boolean }
type Ticket = Readonly<{ file: object; path: string; lifetime: number; epoch: number; client?: MapClientV2; generation?: number; attachment?: object }>;
type ReadyBinding = Readonly<{ generation: number; documentUri: string }>;
type ReadyDelivery = { ticket: Ticket; uri: string; pending?: Promise<boolean>; modelKey?: string; historyKey?: string; complete: boolean };
type History = Readonly<{ before: string; after: string; beforeHash: string; afterHash: string;
  idMap: Readonly<Record<string, string>>; inverseIdMap: Readonly<Record<string, string>> }>;
type Snapshot = { hash: string; raw: string; map?: ThoughtMap; note?: NoteMapParseResult; editable: boolean;
  noteIndex?: ModelUpdateV2['noteIndex']; parseReasons?: ModelUpdateV2['parseReasons'] };
const digest = async (raw: string): Promise<string> => (await sha256Text(raw)).slice('sha256:'.length);

function slice(text: string, range: SourceRange): string {
  const lines = text.split('\n');
  const offset = (p: SourceRange['start']) => lines.slice(0, p.line - 1).reduce((n, line) => n + line.length + 1, 0) + p.column - 1;
  return text.slice(offset(range.start), offset(range.end));
}

/** Host v2 boundary with local ready delivery and shared document history. */
export class FileCoordinatorV2 {
  readonly host: MapHost;
  readonly clients = new Set<MapClientV2>();
  // Session consumption is independent of document/model/history/mount epochs.
  private readonly r7 = new R7Clipboard({maxNodes:1000,maxDepth:100,maxPayloadBytes:1000000,maxSourceBytes:1000000,maxInsertionBytes:1000000},()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join(''));
  private readonly copyRevisions = new WeakMap<MapClientV2, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 1;
  private lifetime = 1;
  private active = true;
  private snapshot?: Snapshot;
  private undoStack: History[] = [];
  private redoStack: History[] = [];
  private guardFailure?: string;
  private permissionDenied = false;
  private preflightPermissionDenied = false;
  setEditPermission(allowed: boolean): void {
    if (this.permissionDenied === !allowed) return;
    this.permissionDenied = !allowed; this.epoch++; this.refreshState();
  }
  private stoppedReason?: HostReasonV2;
  private savedBodyUnknown = false;
  private lastState?: ModelUpdateV2['writeState'];
  private deliveryDepth = 0;
  private deferredRefresh = false;
  private readonly delivered = new WeakMap<MapClientV2, string>();
  private readonly attachments = new WeakMap<MapClientV2, object>();
  private readonly readyDeliveries = new WeakMap<MapClientV2, ReadyDelivery>();
  private readonly pendingHistoryInvalidations = new WeakMap<MapClientV2, HistoryInvalidation>();
  constructor(host: MapHost) { this.host = host; }
  get isAlive(): boolean { return this.active; }
  get contentHash(): string | undefined { return this.snapshot?.hash; }
  get finalizer(): Promise<unknown> { return this.queue; }
  get writeState(): ModelUpdateV2['writeState'] { return this.state().writeState; }
  get seedDocument() {
    const uri = this.host.uri, raw = this.snapshot?.raw ?? '';
    return { uri: { toString: () => uri }, version: 1, getText: () => raw };
  }
  get recoverySnapshot(): DraftRecoverySnapshot | undefined {
    const s = this.snapshot; if (this.savedBodyUnknown || !s?.map || !s.noteIndex) return undefined;
    return { contentHash: s.hash, nodes: Object.entries(s.map.nodesById).flatMap(([nodeId, node]) => {
      const info = s.noteIndex?.nodes[nodeId]; return info ? [{ nodeId, titleSource: node.text, ownRangeHash: info.ownRangeHash }] : [];
    }), center: { kind: isMapPath(this.host.path ?? this.host.uri) ? 'map-md' : s.noteIndex.center.kind,
      titleSource: s.map.title, ...(s.noteIndex.center.anchorHash ? { anchorHash: s.noteIndex.center.anchorHash } : {}) } };
  }
  lock(reason: string): void { this.guardFailure = reason; this.epoch++; this.refreshState(); }
  setPluginDataFailure(reason: HostReasonV2 | undefined): void {
    if (reason === this.stoppedReason || !reason && !this.stoppedReason?.startsWith('plugin-data-')) return;
    if (reason && !reason.startsWith('plugin-data-')) return;
    this.stoppedReason = reason; this.epoch++; this.refreshState();
  }
  attach(client: MapClientV2): void {
    if (this.active && !this.clients.has(client)) {
      this.clients.add(client); this.attachments.set(client, {}); this.delivered.delete(client);
    }
  }
  detach(client: MapClientV2): void {
    if (this.clients.has(client) && this.clients.size === 1) this.dispose('closed');
    else this.clients.delete(client);
    this.r7.invalidate(client);this.readyDeliveries.delete(client);
  }
  private capture(client?: MapClientV2): Ticket {
    return { file: this.host.file ?? this.host, path: this.host.path ?? this.host.uri,
      lifetime: this.lifetime, epoch: this.epoch, client, generation: client?.generation,
      attachment: client ? this.attachments.get(client) : undefined };
  }
  private live(t: Ticket): boolean {
    return this.active && t.lifetime === this.lifetime && t.file === (this.host.file ?? this.host) &&
      t.path === (this.host.path ?? this.host.uri) && (!t.client ||
        (this.clients.has(t.client) && t.client.alive && t.client.generation === t.generation &&
          this.attachments.get(t.client) === t.attachment));
  }
  private valid(t: Ticket): boolean { return this.live(t) && t.epoch === this.epoch; }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const job = this.queue.then(run, run); this.queue = job.catch(() => undefined); return job;
  }
  private notify(message: string): void { try { this.host.notify(message); } catch { /* A notice cannot undo a committed write. */ } }
  private post(client: MapClientV2, message: HostMessageV2): boolean {
    if (!this.active || !client.alive || !this.clients.has(client)) return false;
    const ticket = this.capture(client);
    try { return client.post(structuredClone(message)) === true && this.live(ticket); }
    catch { this.notify('地図への結果の配信に失敗しました。保存済み本文を再確認してください'); return false; }
  }
  private deliver(run: () => void): void {
    this.deliveryDepth++;
    try { run(); }
    finally {
      this.deliveryDepth--;
      if (!this.deliveryDepth && this.deferredRefresh) { this.deferredRefresh = false; this.refreshState(); }
    }
  }
  private state(): { writeState: ModelUpdateV2['writeState']; hostReasons?: readonly HostReasonV2[] } {
    if (this.permissionDenied || this.preflightPermissionDenied) return { writeState: 'read-only' };
    if (this.stoppedReason) return { writeState: 'stopped', hostReasons: [this.stoppedReason] };
    if (this.guardFailure) return { writeState: 'stopped' };
    if (this.snapshot?.note?.status === 'notOpenable') return { writeState: 'not-openable' };
    if (!this.snapshot?.editable) return { writeState: 'read-only' };
    if (this.savedBodyUnknown) return { writeState: 'read-only', hostReasons: ['markdown-state-unknown'] };
    let gate;
    try { gate = this.host.markdownState?.(this.snapshot.raw) ?? (this.host.hasPendingMarkdown(this.snapshot.raw) ? 'unknown' : 'match'); }
    catch { gate = 'unknown'; }
    if (gate === 'pending') return { writeState: 'waiting-markdown-save', hostReasons: ['pending-markdown'] };
    if (gate === 'unknown') return { writeState: 'read-only', hostReasons: ['markdown-state-unknown'] };
    return { writeState: 'ready' };
  }
  private rejection(): CommandRejectReason | undefined {
    const s = this.state();
    if (s.hostReasons?.includes('pending-markdown')) return 'pending-markdown';
    if (s.hostReasons?.includes('markdown-state-unknown')) return 'markdown-state-unknown';
    return s.writeState === 'ready' ? undefined : 'read-only';
  }
  private guardTitles(guard: CommandGuard, s: Snapshot): boolean {
    return guard.targets.every(target => target.kind === 'roots' || (target.kind === 'center'
      ? !!s.map && target.titleSource === s.map.title
      : !!s.map && Object.hasOwn(s.map.nodesById, target.nodeId) && target.titleSource === s.map.nodesById[target.nodeId].text));
  }
  private async parse(raw: string): Promise<Snapshot> {
    const sourceId = this.host.uri, path = this.host.path ?? sourceId;
    if (!isMapPath(path)) {
      const note = parseNoteMapMarkdown(raw, { sourceId, fallbackTitle: path.split('/').at(-1)!.replace(/\.md$/, '') });
      const hash = note.contentHash ?? await digest(raw);
      if (note.status === 'notOpenable') return { raw, hash, note, editable: false, parseReasons: [note.reason] };
      const summary = (blocks: typeof note.index.center.unmapped) => blocks.map(block => ({ kind: block.kind,
        lines: block.range.end.line - block.range.start.line + 1, range: block.range }));
      const center = note.index.center;
      return { raw, hash, note, map: note.map, editable: note.status === 'editable',
        ...(note.status === 'readOnly' ? { parseReasons: note.reasons } : {}), noteIndex: {
          center: { kind: center.kind, noteEditable: center.noteEditable, ...(center.note === undefined ? {} : { note: center.note }),
            ...('anchorHash' in center ? { anchorHash: center.anchorHash } : {}), unmapped: summary(center.unmapped) },
          nodes: Object.fromEntries(Object.entries(note.index.nodes).map(([id, info]) => [id, { kind: info.kind,
            noteEditable: info.noteEditable, unmapped: summary(info.unmapped), subtreeHasUnmapped: info.subtreeHasUnmapped, ownRangeHash: info.ownRangeHash }]))
        } };
    }
    // Only the existing .map.md parser sees a .map.md model.
    const lf = toLf(raw), result = parseDocumentForWebviewSync({ uri: { toString: () => sourceId }, version: 1, getText: () => lf });
    const hash = await digest(raw), map = result.map;
    const nodes = map ? await Promise.all(Object.entries(map.nodesById).map(async ([id, node]) => [id, {
      kind: 'listItem' as const, noteEditable: true, unmapped: [], subtreeHasUnmapped: false,
      ownRangeHash: await digest(node.source ? slice(lf, node.source.range) : '')
    }] as const)) : [];
    return { raw, hash, map, editable: result.validation.ok && editableLineEndings(raw),
      noteIndex: { center: { kind: 'h1', noteEditable: false, unmapped: [] }, nodes: Object.fromEntries(nodes) } };
  }
  private adopt(s: Snapshot, external: boolean): boolean {
    const t = this.capture();
    if (this.snapshot && s.raw !== this.snapshot.raw && external) { this.epoch++; this.invalidate('external-change'); }
    if (!this.live(t)) return false;
    if(this.snapshot && s.raw!==this.snapshot.raw)for(const c of this.clients)this.r7.invalidate(c);
    this.snapshot = s;
    return true;
  }
  private historyState(reason?: HistoryInvalidation): void {
    const batch = this.capture();
    for (const client of [...this.clients]) {
      // A gate transition cannot retract shared-stack availability from surviving views.
      if (!this.live(batch)) break;
      if (!this.hasInitialModel(client)) continue;
      if (this.post(client, { source: 'extension', protocolVersion: 2,
      documentUri: this.host.uri, type: 'thoughtforge.history.state', canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0, ...(reason ? { invalidatedReason: reason } : {}) }) && reason) this.pendingHistoryInvalidations.delete(client);
    }
  }
  private invalidate(reason: HistoryInvalidation): void {
    this.undoStack = []; this.redoStack = []; for (const client of this.clients) this.pendingHistoryInvalidations.set(client, reason); this.historyState(reason);
    this.notify(reason === 'external-change' ? 'ノートが外部で変更されたため地図のUndo履歴を消去しました'
      : reason === 'closed' ? '最後の地図を閉じたため地図のUndo履歴を消去しました'
      : reason === 'renamed' ? 'ノートの名前・場所が変わったため地図のUndo履歴を消去しました' : 'ノートが削除されたため地図のUndo履歴を消去しました');
  }
  dispose(reason: HistoryInvalidation = 'closed'): void {
    if (!this.active) return;
    this.invalidate(reason); this.active = false; this.epoch++; this.lifetime++; this.clients.clear();
  }
  rename(): void {
    if (!this.active) return;
    this.epoch++; this.lifetime++; this.invalidate('renamed'); this.snapshot = undefined;
    void this.sync();
  }
  stop(reason: HostReasonV2): void {
    this.stoppedReason = reason; this.epoch++; this.refreshState();
  }
  private hasInitialModel(client: MapClientV2): boolean {
    const ready = this.readyDeliveries.get(client);
    return !!ready?.modelKey && this.live(ready.ticket) && ready.uri === this.host.uri;
  }
  private publish(cause: ModelCauseV2, sender?: MapClientV2, idMap: Readonly<Record<string, string>> = {}, force = true,
    exclude?: MapClientV2): void {
    const s = this.snapshot; if (!this.active || !s) return;
    const batch = this.capture();
    this.deliver(() => {
    for (const client of [...this.clients]) {
      // Gate epochs invalidate queued writes immediately, but cannot retract a committed model/idMap.
      if (!this.live(batch)) break;
      if (!client.alive || client === exclude || !this.hasInitialModel(client)) continue;
      const state = this.state(); this.lastState = state.writeState;
      const key = JSON.stringify([s.hash, state, client.generation]);
      if (!force && this.delivered.get(client) === key) continue;
      const c = sender && client !== sender && 'requestId' in cause
        ? { kind: 'applied-elsewhere' as const, requestId: cause.requestId, idMap } : cause;
      // Reserve before delivery so a synchronous observer cannot recursively resend the same model.
      this.delivered.set(client, key);
      const delivered = this.post(client, { source: 'extension', protocolVersion: 2, documentUri: this.host.uri,
        type: 'thoughtforge.model.update', mode: isMapPath(this.host.path ?? this.host.uri) ? 'map-md' : 'note',
        contentHash: s.hash, cause: c, ...(s.map ? { map: s.map } : {}), ...(s.noteIndex ? { noteIndex: s.noteIndex } : {}),
        ...(s.parseReasons ? { parseReasons: s.parseReasons } : {}), ...state });
      if (!delivered && this.delivered.get(client) === key) this.delivered.delete(client);
    }
    });
  }
  refreshState(): void {
    if (!this.active) return;
    const next = this.state().writeState;
    if (this.lastState === 'ready' && next !== 'ready') this.epoch++;
    this.lastState = next;
    if (this.deliveryDepth) { this.deferredRefresh = true; return; }
    this.publish({ kind: 'external' }, undefined, {}, false);
  }
  sync(): Promise<void> {
    const t = this.capture();
    return this.enqueue(async () => {
      // Background notifications follow document epochs, never file lifetimes.
      if (!this.live(t)) return;
      const initial = !this.snapshot;
      if (!await this.readSnapshot(this.capture())) return;
      if (initial) this.publish({ kind: 'initial' });
      else this.refreshState();
    });
  }
  private async readSnapshot(current: Ticket, followGate = false): Promise<boolean> {
    const valid = () => followGate ? this.live(current) : this.valid(current);
    try {
      const raw = await this.host.read(); if (!valid()) return false;
      const reason = await this.host.preflight?.(); if (!valid()) return false;
      if (typeof reason === 'string') this.guardFailure = reason;
      this.preflightPermissionDenied = typeof reason === 'object';
      const parsed = this.snapshot?.raw === raw ? this.snapshot : await this.parse(raw);
      if (!valid()) return false;
      this.savedBodyUnknown = false;
      return this.adopt(parsed, true);
    } catch {
      if (valid()) { this.savedBodyUnknown = true; this.refreshState(); this.notify('地図の保存済み本文を確認できませんでした。編集を停止します'); }
      return false;
    }
  }
  /** A local port handshake, bound to this attachment; no additional wire protocol. */
  ready(client: MapClientV2, binding: ReadyBinding): Promise<boolean> {
    const ticket = this.capture(client), uri = this.host.uri;
    if (!this.live(ticket) || binding.generation !== ticket.generation || binding.documentUri !== uri) return Promise.resolve(false);
    let delivery = this.readyDeliveries.get(client);
    if (!delivery || !this.live(delivery.ticket) || delivery.uri !== uri) {
      delivery = { ticket, uri, complete: false }; this.readyDeliveries.set(client, delivery);
    }
    if (delivery.pending) return delivery.pending;
    if (delivery.complete) return Promise.resolve(true);
    const current = delivery;
    const live = () => this.live(current.ticket) && this.host.uri === current.uri && this.readyDeliveries.get(client) === current;
    const job = this.enqueue(async () => {
      if (!live()) return false;
      const before = this.snapshot, documentTicket = this.capture();
      if (!await this.readSnapshot(this.capture(client), true) || !this.live(documentTicket) || !this.snapshot) return false;
      // Keep existing views current without sending their initial model again.
      if (before && before !== this.snapshot) this.publish({ kind: 'external' }, undefined, {}, false, client);
      if (!live()) return false;
      let successful = false;
      this.deliver(() => {
        if (!live() || !this.snapshot) return;
        const s = this.snapshot, state = this.state();
        this.lastState = state.writeState;
        const modelKey = JSON.stringify([s.hash, state, client.generation]);
        if (current.modelKey !== modelKey) {
          const previousKey = current.modelKey;
          current.modelKey = modelKey; this.delivered.set(client, modelKey);
          if (!this.post(client, { source: 'extension', protocolVersion: 2, documentUri: uri,
            type: 'thoughtforge.model.update', mode: isMapPath(this.host.path ?? uri) ? 'map-md' : 'note',
            contentHash: s.hash, cause: { kind: 'initial' }, ...(s.map ? { map: s.map } : {}),
            ...(s.noteIndex ? { noteIndex: s.noteIndex } : {}), ...(s.parseReasons ? { parseReasons: s.parseReasons } : {}), ...state }) || !live()) {
            current.modelKey = previousKey;
            if (this.delivered.get(client) === modelKey) this.delivered.delete(client);
            return;
          }
        }
        const history = { source: 'extension' as const, protocolVersion: 2 as const, documentUri: uri,
          type: 'thoughtforge.history.state' as const, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0,
          ...(this.pendingHistoryInvalidations.has(client) ? { invalidatedReason: this.pendingHistoryInvalidations.get(client)! } : {}) };
        const historyKey = JSON.stringify(history);
        if (current.historyKey !== historyKey) {
          if (!this.post(client, history) || !live()) return;
          this.pendingHistoryInvalidations.delete(client);
          current.historyKey = historyKey;
        }
        current.complete = true; successful = true;
      });
      return successful && live();
    });
    current.pending = job;
    const clearPending = () => { if (current.pending === job) current.pending = undefined; };
    void job.then(clearPending, clearPending);
    return job;
  }
  private patches(s: Snapshot, command: HostCommand, client?: MapClientV2, guard?: unknown): ReturnType<typeof createNoteMarkdownPatches> | MapMdPatchResult {
    if(isR7Paste(command))return s.note || !client ? {ok:false,reason:'unsupported-position'} : this.r7.patches(client,s.raw,command,guard);
    if (s.note) {
      if (s.note.status !== 'editable') throw Error('read-only note');
      return createNoteMarkdownPatches(s.note, command);
    }
    if (command.type === 'node.wrapInNewParent') {
      const result = createMapMdWrapPatches(s.raw, command, { baseHash: s.hash, targets: [{ kind: 'node', nodeId: command.nodeId, titleSource: s.map?.nodesById[command.nodeId]?.text ?? '' }] });
      return result;
    }
    if (['map.updateNote', 'map.clearNote'].includes(command.type) || !s.map) throw Error('unsupported map-md command');
    const beforeLf = toLf(s.raw), patches = createMarkdownPatches(beforeLf, s.map, command as SemanticCommand);
    // The legacy patcher cannot atomically rename an empty EOF label when its
    // insertion occupies the same offset. Refuse before CAS rather than lose it.
    if ((command.type === 'node.renameAndInsertSibling' || command.type === 'node.renameAndInsertChild') && patches.length > 1 &&
      patches[0]!.range.start.line === patches.at(-1)!.range.start.line && patches[0]!.range.start.column === patches.at(-1)!.range.start.column) throw Error('overlapping atomic patches');
    const nextLfText = applyTextPatches(beforeLf, patches);
    const result = parseDocumentForWebviewSync({ uri: { toString: () => this.host.uri }, version: 1, getText: () => nextLfText });
    if (!result.validation.ok) throw Error('map-md validation failed');
    const inserted = /^node\.(insertChild|insertSibling|renameAndInsertChild|renameAndInsertSibling)$/.test(command.type);
    const resultNodeId = inserted && result.map ? insertedMapNodeId(beforeLf, nextLfText, patches, result.map) : undefined;
    if (inserted && !resultNodeId) throw Error('unproven inserted topic');
    const ids = result.map ? mapMdIdMaps(beforeLf, nextLfText, patches, s.map, result.map, command) : { idMap: {}, inverseIdMap: {} };
    return { ok: true, patches: [], nextLfText, ...ids, ...(resultNodeId ? { resultNodeId } : {}) };
  }
  retireR7Request(value: Record<string, unknown>, client: MapClientV2): void {
    if(value.source!=='webview'||value.protocolVersion!==2||value.documentUri!==this.host.uri||typeof value.requestId!=='string')return;
    const command=value.command as {type?: string} | undefined;
    if(value.type==='thoughtforge.r7.read'||command?.type==='node.wrapInNewParent'||command?.type==='node.pasteSubtreeAsLastChild')this.r7.cancel(client,value.requestId);
  }
  handleMessage(value: unknown, client: MapClientV2): Promise<boolean> {
    if (!this.clients.has(client) || !client.alive) return Promise.resolve(false);
    let receiptLive: (()=>boolean) | undefined;
    const incoming = value as Record<string, any> | undefined;
    if(incoming?.source==='webview' && incoming.protocolVersion===2 && incoming.documentUri===this.host.uri) {
      const id=incoming.requestId;
      // Invalid IDs cannot poison the session or re-enter as legacy/history payloads.
      if(['thoughtforge.command','thoughtforge.history.undo','thoughtforge.history.redo','thoughtforge.r7.read','thoughtforge.r7.cancel'].includes(incoming.type) && (typeof id!=='string'||!id.length||id.length>256))return Promise.resolve(false);
      if(incoming.type==='thoughtforge.r7.mount'&&r7Keys(incoming,'documentUri,mountEpoch,protocolVersion,requestId,source,type'))return Promise.resolve(this.r7.mount(client,incoming.mountEpoch));
      if(incoming.type==='thoughtforge.r7.copy.ack'&&r7Keys(incoming,'copyToken,documentUri,effectId,mountEpoch,protocolVersion,requestId,source,type'))return Promise.resolve(this.r7.ack(client,incoming.copyToken,incoming.effectId,incoming.mountEpoch));
      if(typeof id==='string' && id.length>0) {
        if(incoming.type==='thoughtforge.r7.cancel'&&r7Keys(incoming,'documentUri,protocolVersion,requestId,source,type')){this.r7.cancel(client,id);return Promise.resolve(true)}
        if(incoming.type==='thoughtforge.r7.read') {
          if(!this.r7.consume(client,id)){if(this.r7.limitRejection(client,id))this.post(client,{source:'extension',protocolVersion:2,documentUri:this.host.uri,type:'thoughtforge.r7.read.result',requestId:id,ok:false,reason:'request-limit'});return Promise.resolve(false)}
          if(id.length>256||!r7Keys(incoming,'documentUri,protocolVersion,requestId,source,type,value'))return Promise.resolve(false);
          const t=this.capture(client),rejection=this.rejection();let request: Record<string,any>;try{request=structuredClone(incoming)}catch{return Promise.resolve(false)};
          return this.readR7(request,t,client,rejection);
        }
        if(incoming.type==='thoughtforge.command' && incoming.command?.type==='node.pasteSubtreeAsLastChild') {
          if(!this.r7.continuation(client,id))return Promise.resolve(false);
          receiptLive=this.r7.admission(client,id,incoming.command,incoming.guard);
          if(!receiptLive){this.r7.cancel(client,id);this.post(client,{source:'extension',protocolVersion:2,documentUri:this.host.uri,type:'thoughtforge.command.result',requestId:id,status:'rejected',reason:'r7-rejected',code:'copy-expired'});return Promise.resolve(false)}
        }
        if((incoming.type==='thoughtforge.history.undo' || incoming.type==='thoughtforge.history.redo' || incoming.type==='thoughtforge.command' && incoming.command?.type!=='node.wrapInNewParent' && incoming.command?.type!=='node.pasteSubtreeAsLastChild') && this.r7.consumed(client,id)) {
          if(this.r7.limitRejection(client,id)) {
            if(incoming.type==='thoughtforge.command')this.post(client,{source:'extension',protocolVersion:2,documentUri:this.host.uri,type:'thoughtforge.command.result',requestId:id,status:'rejected',reason:'r7-rejected',code:'request-limit'});
            else this.post(client,{source:'extension',protocolVersion:2,documentUri:this.host.uri,type:'thoughtforge.history.result',requestId:id,status:'read-only'});
            this.notify('この画面の操作記録の上限に達しました。入力をコピーして地図を開き直してください。');
          }
          return Promise.resolve(false);
        }
        if(incoming.type==='thoughtforge.command' && incoming.command?.type==='node.wrapInNewParent') {
          if(!this.r7.consume(client,id)){if(this.r7.limitRejection(client,id))this.post(client,{source:'extension',protocolVersion:2,documentUri:this.host.uri,type:'thoughtforge.command.result',requestId:id,status:'rejected',reason:'r7-rejected',code:'request-limit'});return Promise.resolve(false)}
          receiptLive=this.r7.parentAdmission(client,id);
        }
      }
      if(incoming.type==='thoughtforge.clipboard.write' && typeof incoming.text==='string') {
        this.r7.invalidate(client);const revision=(this.copyRevisions.get(client)??0)+1;this.copyRevisions.set(client,revision);
        const t=this.capture(client);let request: Record<string,any>;try{request=structuredClone(incoming)}catch{return Promise.resolve(false)};
        return this.enqueue(()=>this.copyR7(request,t,client,revision));
      }
    }
    if (!isRequestV2(value, this.host.uri)) {if(receiptLive)this.r7.finishParent(client,String(incoming?.requestId));return Promise.resolve(false);}
    // Snapshot the intention at receipt, not after its queue wait.
    let request: CommandRequestV2 | HistoryRequestV2;
    try { request = structuredClone(value); } catch { if(receiptLive)this.r7.finishParent(client,String(incoming?.requestId));return Promise.resolve(false); }
    const t = this.capture(client), receivedRejection = this.rejection();
    return this.enqueue(async () => {
      if (!this.live(t)) {
        if(receiptLive)this.r7Rejected(request,t,client);return false;
      }
      if (request.type === 'thoughtforge.command') return this.command(request, t, client, receivedRejection, receiptLive);
      return this.history(request, t, client, receivedRejection);
    }).finally(()=>{if(client.generation===t.generation&&request.type==='thoughtforge.command'&&request.command.type==='node.wrapInNewParent')this.r7.finishParent(client,request.requestId)});
  }
  private r7Rejected(request: CommandRequestV2 | HistoryRequestV2,t: Ticket,client: MapClientV2): void {
    // A retired file/permission ticket still owes its current sender a settlement;
    // detached clients and old generations cannot receive into a newer binding.
    if(client.generation===t.generation && this.attachments.get(client)===t.attachment)
      this.post(client,{source:'extension',protocolVersion:2,documentUri:request.documentUri,type:'thoughtforge.command.result',requestId:request.requestId,status:'rejected',reason:'r7-rejected',code:'copy-expired'});
  }
  private async copyR7(request: Record<string, any>,t: Ticket,client: MapClientV2,revision: number): Promise<boolean> {
    const live=()=>this.valid(t)&&this.copyRevisions.get(client)===revision&&this.snapshot?.hash===request.r7?.baseHash&&!this.rejection();
    const reply=(result: {ok: boolean; copyToken?: string; reason?: string})=>this.post(client,{source:'extension',protocolVersion:2,documentUri:this.host.uri,type:'thoughtforge.r7.copy.result',requestId:String(request.requestId??request.effectId??''),effectId:request.effectId,...result});
    try {
      if(!this.live(t))return false;
      const s=this.snapshot;
      if(request.r7 && s?.map && !s.note && live() && typeof request.effectId==='string' && request.r7.text===request.text) {
        let wrote=false;
        const result=await this.r7.copy(client,s.raw,s.map,request.r7,request.effectId,live,text=>{wrote=true;return this.host.writeClipboard(text)});
        if(result.ok){reply(result);return true}
        // Unsupported structure still retains ordinary Markdown copy.
        if(!this.live(t))return false;
        if(!wrote)await this.host.writeClipboard(request.text);reply(result);return true;
      }
      await this.host.writeClipboard(request.text);
      reply({ok:false,reason:s?.note&&request.scope==='subtree'&&request.format==='markdown'?'note-mode-deferred':'copy-not-eligible'});return true;
    } catch {this.r7.invalidate(client);reply({ok:false,reason:'clipboard-write-failed'});return false}
  }
  private async readR7(request: Record<string, any>,t: Ticket,client: MapClientV2,received?: CommandRejectReason): Promise<boolean> {
    const reply=(result: {ok: boolean; reason?: string; command?: any; guard?: any})=>{if(this.live(t))this.post(client,{source:'extension',protocolVersion:2,documentUri:this.host.uri,type:'thoughtforge.r7.read.result',requestId:request.requestId,...result});return result.ok};
    try {
      const s=await this.enqueue(async()=>await this.prepare(t)&&!received&&!this.rejection()?this.snapshot:undefined);
      if(!s)return reply({ok:false,reason:received??this.rejection()??'stale'});
      if(s.note)return reply({ok:false,reason:'note-mode-deferred'});
      const live=()=>this.valid(t)&&this.snapshot?.hash===s.hash&&!this.rejection();
      return reply(await this.r7.read(client,request.requestId,request.value,s.raw,live,()=>this.host.readClipboard(),finish=>this.enqueue(async()=>{
        await this.prepare(t); // Re-read external changes before issuing any receipt.
        return finish();
      })));
    } catch{return reply({ok:false,reason:'clipboard-read-failed'})}
  }
  private async prepare(t: Ticket): Promise<boolean> {
    if (!this.valid(t)) return false;
    try {
    const raw = await this.host.read(); if (!this.valid(t)) return false;
    const reason = await this.host.preflight?.(); if (!this.valid(t)) return false;
    if (typeof reason === 'string') this.guardFailure = reason;
    this.preflightPermissionDenied = typeof reason === 'object';
    const unknownBefore = this.savedBodyUnknown;
    this.savedBodyUnknown = false;
    if (raw !== this.snapshot?.raw) {
      const parsed = await this.parse(raw); if (!this.valid(t)) return false;
      if (!this.adopt(parsed, true)) return false;
      this.publish({ kind: 'external' });
    } else if (unknownBefore || reason) this.refreshState();
    return this.valid(t);
    } catch {
      if (this.valid(t)) { this.savedBodyUnknown = true; this.refreshState(); this.notify('地図の保存済み本文を確認できませんでした。編集を停止します'); }
      return false;
    }
  }
  private async command(request: CommandRequestV2, t: Ticket, client: MapClientV2, receivedRejection?: CommandRejectReason,receiptLive?: ()=>boolean): Promise<boolean> {
    const reply = (reason: CommandRejectReason, extra: object = {}) => {
      if (this.live(t)) this.post(client, { source: 'extension', protocolVersion: 2, documentUri: request.documentUri,
        type: 'thoughtforge.command.result', requestId: request.requestId, status: 'rejected', reason, ...extra });
      else if(receiptLive)this.r7Rejected(request,t,client);
      return false;
    };
    try {
      if (!await this.prepare(t)) return reply(this.rejection() ?? 'stale');
      const s = this.snapshot!;
      if(receiptLive && !receiptLive())return reply('r7-rejected',{code:'copy-expired'});
      // Parser/host stop has precedence over malformed guards; Markdown gate follows guard shape.
      if (!s.editable || this.guardFailure || this.stoppedReason || receivedRejection === 'read-only') return reply('read-only');
      if (!hasCommandGuard(request.command, request.guard)) return reply('bad-guard');
      const guard = request.guard;
      if (receivedRejection) return reply(receivedRejection);
      const rejection = this.rejection(); if (rejection) return reply(rejection);
      if (s.hash !== guard.baseHash || !this.guardTitles(guard, s)) return reply('stale');
      const result = this.patches(s, request.command,client,request.guard);
      if (!result.ok) return reply((request.command.type === 'node.wrapInNewParent' || isR7Paste(request.command)) && !s.note ? 'r7-rejected' : 'note-rejected', { code: result.reason, ...('detail' in result && result.detail ? { detail: result.detail } : {}) });
      const after = s.raw.includes('\r\n') ? result.nextLfText.replace(/\n/g, '\r\n') : result.nextLfText;
      const parsed = await this.parse(after); if (!this.valid(t)||receiptLive&&!receiptLive()) return reply('stale');
      const saved = await this.host.compareAndSwap(s.raw, after, current => {
        if (!this.valid(t) || receiptLive && !receiptLive() || this.rejection() || guard.baseHash !== s.hash || !this.guardTitles(guard, s)) return false;
        if (current !== undefined) {
          if (current !== s.raw) return false;
          // Recheck the pure patch result under the process callback's raw CAS.
          const rechecked = this.patches(s, request.command,client,request.guard);
          if (!rechecked.ok || rechecked.nextLfText !== result.nextLfText) return false;
        }
        return true;
      });
      if (!saved) { void this.sync(); return reply(this.rejection() ?? 'stale'); }
      // Sender retirement cannot undo a completed save or erase another view's shared history.
      const documentTicket = { ...t, client: undefined, generation: undefined };
      if (!this.live(documentTicket)) return true;
      if (after !== s.raw) {
        this.undoStack.push({ before: s.raw, after, beforeHash: s.hash, afterHash: parsed.hash,
          idMap: result.idMap, inverseIdMap: result.inverseIdMap });
        if (this.undoStack.length > 100) this.undoStack.shift();
        this.redoStack = [];
      }
      this.adopt(parsed, false);
      this.deliver(() => {
      if (this.live(t)) this.post(client, { source: 'extension', protocolVersion: 2, documentUri: this.host.uri, type: 'thoughtforge.command.result',
        requestId: request.requestId, status: 'applied', nextHash: parsed.hash, idMap: result.idMap,
        ...(result.resultNodeId ? { resultNodeId: result.resultNodeId } : {}), ...('insertedRawSpan' in result ? {insertedRawSpan: result.insertedRawSpan,insertedSubtreeRange: result.insertedSubtreeRange} : {}) });
      if (this.live(documentTicket)) {
        this.publish({ kind: 'applied', requestId: request.requestId }, client, result.idMap, true, this.live(t) ? undefined : client);
        this.historyState();
      }
      });
      return true;
    } catch { return reply('unexpected-error'); }
  }
  private async history(request: HistoryRequestV2, t: Ticket, client: MapClientV2, receivedRejection?: CommandRejectReason): Promise<boolean> {
    const reply = (status: HistoryResultV2['status']) => {
      if (this.live(t)) this.post(client, { source: 'extension', protocolVersion: 2, documentUri: this.host.uri,
        type: 'thoughtforge.history.result', requestId: request.requestId, status });
      return false;
    };
    try {
      if (!await this.prepare(t)) {
        const reason = this.rejection(); return reply(reason === 'pending-markdown' || reason === 'markdown-state-unknown' || reason === 'read-only' ? reason : 'stale');
      }
      if (receivedRejection) return reply(receivedRejection === 'pending-markdown' || receivedRejection === 'markdown-state-unknown' ? receivedRejection : 'read-only');
      const rejection = this.rejection(); if (rejection) return reply(rejection === 'pending-markdown' || rejection === 'markdown-state-unknown' ? rejection : 'read-only');
      const undo = request.type === 'thoughtforge.history.undo', from = undo ? this.undoStack : this.redoStack;
      const entry = from.at(-1), s = this.snapshot!;
      if (request.baseHash !== s.hash) return reply('stale');
      if (!entry) return reply('nothing');
      const expected = undo ? entry.after : entry.before, expectedHash = undo ? entry.afterHash : entry.beforeHash;
      if (request.baseHash !== expectedHash || s.raw !== expected) return reply('stale');
      const after = undo ? entry.before : entry.after, parsed = await this.parse(after);
      if (!this.valid(t)) return reply('stale');
      const saved = await this.host.compareAndSwap(expected, after, current => this.valid(t) && !this.rejection()
        && request.baseHash === s.hash && s.hash === expectedHash && (current === undefined || current === expected));
      if (!saved) {
        void this.sync(); const reason = this.rejection(); return reply(reason === 'pending-markdown' || reason === 'markdown-state-unknown' ? reason : 'stale');
      }
      const documentTicket = { ...t, client: undefined, generation: undefined };
      if (!this.live(documentTicket)) return true;
      from.pop(); (undo ? this.redoStack : this.undoStack).push(entry); this.adopt(parsed, false);
      const idMap = undo ? entry.inverseIdMap : entry.idMap;
      this.deliver(() => {
      if (this.live(t)) this.post(client, { source: 'extension', protocolVersion: 2, documentUri: this.host.uri, type: 'thoughtforge.history.result',
        requestId: request.requestId, status: 'applied', nextHash: parsed.hash, idMap });
      if (this.live(documentTicket)) {
        this.publish({ kind: undo ? 'undo' : 'redo', requestId: request.requestId }, client, idMap, true, this.live(t) ? undefined : client);
        this.historyState();
      }
      });
      return true;
    } catch {
      if (this.live(t)) this.notify('地図のUndo/Redoを保存できませんでした。履歴は保持しています');
      return reply('read-only');
    }
  }
}
