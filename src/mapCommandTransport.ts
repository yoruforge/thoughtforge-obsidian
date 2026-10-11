import { MAP_COMMAND_IDS, type MapCommandId } from '../packages/map-view/src/map-view/commandIds.mjs';

export type { MapCommandId };
export type CommandStamp = Readonly<{ documentUri: string; mountEpoch: number; revision: number; contentHash: string }>;
export type CommandRoute = 'ui' | 'interaction' | 'semantic' | 'history' | 'clipboard' | 'host-navigation';
export type CommandReject = 'stale-context' | 'busy' | 'unavailable' | 'ime-active' | 'confirmation-active' | 'permission-denied' |
  'read-only' | 'target-invisible' | 'unsupported-command' | 'unsupported-mode' | 'invalid-request' | 'dispatch-failed';
export type CommandAdmission = Readonly<{ status: 'admitted'; route: CommandRoute }> |
  Readonly<{ status: 'rejected'; reason: CommandReject }> | Readonly<{ status: 'outcome-unknown'; reason: 'dispatch-interrupted' }>;
export type CommandExecute = CommandStamp & Readonly<{ transportVersion: 1; type: 'execute'; requestSeq: number; requestId: string; commandId: MapCommandId }>;
export type CommandState = Readonly<{ transportVersion: 1; type: 'state'; documentUri: string; mountEpoch: number; revision: number }> &
  (Readonly<{ status: 'ready'; contentHash: string; available: readonly MapCommandId[] }> |
   Readonly<{ status: 'unavailable'; reason: 'not-ready' | 'disposed' | 'retired' | 'inert' | 'unsupported-version' }>);
export type CommandResult = Readonly<{ transportVersion: 1; type: 'result'; documentUri: string; mountEpoch: number; requestSeq: number; requestId: string }> &
  (Readonly<{ status: 'dispatched'; route: CommandRoute }> | Readonly<{ status: 'rejected'; reason: CommandReject }> |
   Readonly<{ status: 'outcome-unknown'; reason: 'dispatch-interrupted' }>);
export type CommandEnvelope = Readonly<{ generation: number; obsidianOnly: 'mapCommand'; mapCommand: CommandExecute }>;

/** Self-contained factory: explicitly injected into the serialized frame. */
export function createMapCommandValidator(ids: readonly string[]) {
  const allowed = new Set(ids), integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
  const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const keys = (v: any, names: string[]) => object(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const base = ['transportVersion', 'type', 'documentUri', 'mountEpoch'];
  const binding = (p: any) => object(p) && p.transportVersion === 1 && typeof p.documentUri === 'string' && integer(p.mountEpoch);
  const correlation = (p: any, generation: number) => binding(p) && integer(p.requestSeq) && p.requestId === `${generation}:${p.requestSeq}`;
  const routes = ['ui', 'interaction', 'semantic', 'history', 'clipboard', 'host-navigation'];
  const rejects = ['stale-context', 'busy', 'unavailable', 'ime-active', 'confirmation-active', 'permission-denied', 'read-only', 'target-invisible', 'unsupported-command', 'unsupported-mode', 'invalid-request', 'dispatch-failed'];
  const envelope = (e: any, frame: boolean, generation: number) => keys(e, frame ? ['generation', 'baseVersion', 'obsidianOnly', 'mapCommand'] : ['generation', 'obsidianOnly', 'mapCommand']) &&
    integer(generation) && e.generation === generation && e.obsidianOnly === 'mapCommand' && (!frame || integer(e.baseVersion));
  const execute = (p: any, generation: number) => correlation(p, generation) && p.type === 'execute' &&
    keys(p, [...base, 'requestSeq', 'requestId', 'commandId', 'revision', 'contentHash']) && integer(p.revision) && hash(p.contentHash) && allowed.has(p.commandId);
  const state = (p: any) => binding(p) && p.type === 'state' && integer(p.revision) && (p.status === 'ready'
    ? keys(p, [...base, 'revision', 'status', 'contentHash', 'available']) && hash(p.contentHash) && Array.isArray(p.available) && p.available.length <= ids.length &&
      Object.keys(p.available).length === p.available.length && Array.from(p.available).every((id: unknown) => typeof id === 'string' && allowed.has(id)) && new Set(p.available).size === p.available.length
    : p.status === 'unavailable' && keys(p, [...base, 'revision', 'status', 'reason']) && ['not-ready', 'disposed', 'retired', 'inert', 'unsupported-version'].includes(p.reason));
  const result = (p: any, generation: number) => correlation(p, generation) && p.type === 'result' &&
    keys(p, [...base, 'requestSeq', 'requestId', 'status', p.status === 'dispatched' ? 'route' : 'reason']) &&
    (p.status === 'dispatched' ? routes.includes(p.route) : p.status === 'rejected' ? rejects.includes(p.reason) : p.status === 'outcome-unknown' && p.reason === 'dispatch-interrupted');
  return { envelope, correlation, execute, state, result, integer };
}

const validator = createMapCommandValidator(MAP_COMMAND_IDS);
/** Exactly one host dispatch slot, no queue or retry. Identity is owned by MapSession. */
export class MapCommandClient {
  private cache?: Extract<CommandState, { status: 'ready' }>;
  private accepted = 0;
  private floor = 0;
  private mount = 0;
  private sequence = 0;
  private navigationLifetime = {};
  private slot?: { request: CommandExecute; timer: ReturnType<typeof setTimeout> };
  private readonly generation: number;
  private readonly uri: () => string;
  private readonly live: () => boolean;
  private readonly send: (e: CommandEnvelope) => boolean;
  private readonly notify: (text: string) => void;
  constructor(generation: number, uri: () => string, live: () => boolean, send: (e: CommandEnvelope) => boolean, notify: (text: string) => void = () => {}) {
    this.generation = generation; this.uri = uri; this.live = live; this.send = send; this.notify = notify;
  }
  invalidate(): void {
    this.cache = undefined;
    this.navigationLifetime = {};
    if (this.slot) clearTimeout(this.slot.timer);
    this.slot = undefined;
  }
  get navigationToken(): object { return this.navigationLifetime; }
  receive(e: any): void {
    if (!this.live() || e?.generation !== this.generation) return;
    // Old bindings never touch the current cache or slot.
    const p = e.mapCommand;
    if (typeof p?.documentUri === 'string' && p.documentUri !== this.uri()) return;
    if (validator.integer(p?.mountEpoch) && p.mountEpoch < this.mount) return;
    if (p?.type === 'result' && (!this.slot || p.requestSeq !== this.slot.request.requestSeq || p.requestId !== this.slot.request.requestId || p.mountEpoch !== this.slot.request.mountEpoch)) return;
    if (p?.type === 'state' && validator.integer(p.revision) && p.revision < Math.max(this.accepted, this.floor)) return;
    if (!validator.envelope(e, true, this.generation)) { this.cache = undefined; return; }
    if (p?.type === 'state') {
      if (!validator.state(p)) { this.cache = undefined; return; }
      if (p.revision === this.accepted && this.cache && (p.status !== 'ready' || p.contentHash !== this.cache.contentHash || p.mountEpoch !== this.cache.mountEpoch ||
          p.available.length !== this.cache.available.length || !p.available.every((id: MapCommandId) => this.cache!.available.includes(id)))) this.cache = undefined;
      if (p.mountEpoch < this.mount || p.revision <= this.accepted || p.revision <= this.floor) return;
      if (p.mountEpoch > this.mount && this.slot) { clearTimeout(this.slot.timer); this.slot = undefined; }
      if (p.mountEpoch !== this.mount || p.status === 'unavailable') this.navigationLifetime = {};
      this.mount = p.mountEpoch; this.accepted = p.revision;
      this.cache = p.status === 'ready' ? Object.freeze({ ...p, available: Object.freeze([...p.available]) }) : undefined;
    } else if (validator.result(p, this.generation) && this.slot && p.documentUri === this.slot.request.documentUri && p.mountEpoch === this.slot.request.mountEpoch &&
      p.requestSeq === this.slot.request.requestSeq && p.requestId === this.slot.request.requestId) {
      clearTimeout(this.slot.timer); this.slot = undefined;
      if (p.status === 'outcome-unknown') this.notify('地図コマンドの結果を確認できませんでした。入力と保存状態を確認してください。');
      else if (p.status === 'rejected') this.notify(`地図コマンドを実行できませんでした（${p.reason}）。もう一度操作してください。`);
    } else if (!validator.result(p, this.generation)) this.cache = undefined;
  }
  available(id: MapCommandId): boolean {
    return this.live() && !this.slot && !!this.cache && this.cache.documentUri === this.uri() && this.cache.available.includes(id);
  }
  execute(id: MapCommandId, stillCurrent: () => boolean): boolean {
    if (!this.available(id) || !stillCurrent() || !validator.integer(this.sequence + 1)) return false;
    const state = this.cache!, requestSeq = ++this.sequence;
    const request: CommandExecute = { transportVersion: 1, type: 'execute', documentUri: state.documentUri, mountEpoch: state.mountEpoch,
      revision: state.revision, contentHash: state.contentHash, commandId: id, requestSeq, requestId: `${this.generation}:${requestSeq}` };
    this.floor = Math.max(this.floor, state.revision); this.cache = undefined;
    const slot = { request, timer: setTimeout(() => {
      if (this.slot !== slot) return;
      this.slot = undefined; this.cache = undefined;
      this.notify('地図コマンドの結果が未確認です。入力と保存状態を確認してください。');
    }, 5000) }; this.slot = slot;
    if (!stillCurrent() || !this.live() || !this.send({ generation: this.generation, obsidianOnly: 'mapCommand', mapCommand: request })) { this.invalidate(); return false; }
    return true;
  }
}
