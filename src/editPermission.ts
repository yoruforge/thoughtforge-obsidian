import type { VaultBinding } from './writeTargetGuard.ts';

export const EDIT_PERMISSION_KEY = 'thoughtforge:edit-permission:v1';
export const PERMISSION_TEXT = {
  unpermitted: 'このVaultでは表示のみです。編集するには、設定で「このVaultで編集を許可」を選んでください。',
  revoking: '許可を取り消しています。開始済みの保存処理が終わるまでお待ちください。',
  revoked: '編集許可を取り消しました。地図は表示でき、残っている入力はコピーできます。',
  changed: 'Vaultの場所または識別情報が変わったため、編集を停止しました。設定で再度許可してください。',
  error: '編集許可を確認できないため、表示のみにしています。設定とVaultの状態を確認してください。',
  unsafe: 'この保存先の安全性を確認できないため、保存を停止しました。入力はコピーできます。'
} as const;
export type PermissionRecord = { schemaVersion: 1; state: 'granted' | 'revoked'; generation: string; binding: VaultBinding };
export type PermissionToken = Readonly<{ epoch: number; generation: string }>;
export type PermissionStorage = { loadLocalStorage(key: string): unknown; saveLocalStorage(key: string, value: unknown): void };
export type PermissionBarrier = { epoch: number; io: Set<Promise<unknown>>; control: Promise<unknown>; listeners: Set<() => void> };
export const createPermissionBarrier = (): PermissionBarrier => ({ epoch: 0, io: new Set(), control: Promise.resolve(), listeners: new Set() });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('\0');
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
export function validBinding(v: unknown): v is VaultBinding {
  return object(v) && keys(v, ['adapterBasePath', 'canonicalRoot', 'rootDev', 'rootIno', 'rootBirthtimeNs', 'vaultName', 'configDir']) &&
    ['adapterBasePath', 'canonicalRoot', 'vaultName', 'configDir'].every(k => string(v[k])) &&
    ['rootDev', 'rootIno', 'rootBirthtimeNs'].every(k => typeof v[k] === 'string' && /^\d+$/.test(v[k] as string)) &&
    v.rootIno !== '0' && v.rootBirthtimeNs !== '0';
}
export function validPermissionRecord(v: unknown): v is PermissionRecord {
  return object(v) && keys(v, ['schemaVersion', 'state', 'generation', 'binding']) && v.schemaVersion === 1 &&
    (v.state === 'granted' || v.state === 'revoked') && typeof v.generation === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v.generation) && validBinding(v.binding);
}
export const sameBinding = (a: VaultBinding, b: VaultBinding): boolean => Object.keys(a).every(k => a[k as keyof VaultBinding] === b[k as keyof VaultBinding]);
const sameRecord = (a: PermissionRecord, b: PermissionRecord) => a.state === b.state && a.generation === b.generation && sameBinding(a.binding, b.binding);

/** Admission and the I/O drain are shared by all views/instances of this app, never across Vaults. */
export class EditPermission {
  private record?: PermissionRecord;
  private admittedEpoch = -1;
  private status: 'unpermitted' | 'granted' | 'revoking' | 'revoked' | 'changed' | 'error' = 'unpermitted';
  constructor(private readonly storage: PermissionStorage, private readonly binding: () => Promise<VaultBinding>,
    private readonly certify: () => Promise<VaultBinding>, readonly barrier = createPermissionBarrier(), private readonly contextMatches: () => boolean = () => true) {}
  get authorized(): boolean { return this.status === 'granted' && this.admittedEpoch === this.barrier.epoch; }
  get message(): string | undefined { return this.authorized ? undefined : PERMISSION_TEXT[this.status === 'granted' ? 'error' : this.status]; }
  get busy(): boolean { return this.status === 'revoking'; }
  capture(): PermissionToken { return { epoch: this.barrier.epoch, generation: this.record?.generation ?? '' }; }
  private read(): PermissionRecord | undefined {
    const value = this.storage.loadLocalStorage(EDIT_PERMISSION_KEY);
    if (value === null) return undefined;
    if (!validPermissionRecord(value)) throw Error('invalid permission record');
    return structuredClone(value);
  }
  private signal(status: typeof this.status): void {
    this.status = status; this.barrier.epoch++;
    for (const listener of this.barrier.listeners) listener();
  }
  async initialize(): Promise<void> {
    // A reloaded instance cannot authorize an old record while another instance
    // is draining I/O and committing its revoke/grant metadata.
    await this.barrier.control;
    const epoch = this.barrier.epoch;
    try {
      const record = this.read();
      if (!record) return;
      this.record = record;
      if (record.state === 'revoked') { this.status = 'revoked'; return; }
      const current = await this.certify();
      if (epoch !== this.barrier.epoch) return;
      if (!sameBinding(record.binding, current)) { await this.invalidate('changed'); return; }
      if (!sameRecord(record, this.read()!)) throw Error('permission changed during load');
      // Certification opens a fresh admission, never reviving tokens captured while waiting.
      this.admittedEpoch = ++this.barrier.epoch; this.status = 'granted';
    } catch { if (epoch === this.barrier.epoch) await this.invalidate('error'); }
  }
  isCurrent(token: PermissionToken): boolean {
    if (!this.authorized || token.epoch !== this.barrier.epoch || token.generation !== this.record?.generation) return false;
    if (!this.contextMatches()) { void this.invalidate('changed'); return false; }
    try {
      const live = this.read();
      if (live && this.record && sameRecord(live, this.record)) return true;
    } catch { /* A missing/invalid/new record never revives this request. */ }
    void this.invalidate('error'); return false;
  }
  async check(token = this.capture()): Promise<boolean> {
    if (!this.isCurrent(token)) return false;
    try {
      const current = await this.binding();
      if (!this.isCurrent(token)) return false;
      if (this.record && sameBinding(this.record.binding, current)) return true;
      await this.invalidate('changed');
    } catch { await this.invalidate('changed'); }
    return false;
  }
  /** No await between the last admission check and the SDK invocation. */
  run<T>(token: PermissionToken, operation: () => Promise<T>): Promise<T> {
    if (!this.isCurrent(token)) return Promise.reject(Error('edit permission refused'));
    let task: Promise<T>;
    try { task = Promise.resolve(operation()); } catch (error) { return Promise.reject(error); }
    this.barrier.io.add(task);
    void task.then(() => this.barrier.io.delete(task), () => this.barrier.io.delete(task));
    return task;
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const task = this.barrier.control.then(work, work); this.barrier.control = task.catch(() => undefined); return task;
  }
  private async drain(): Promise<boolean> { return (await Promise.allSettled([...this.barrier.io])).every(result => result.status === 'fulfilled'); }
  private writeRevoked(): void {
    const current = this.read();
    const binding = this.record?.binding ?? current?.binding;
    if (!binding) return; // Never initialize an absent record automatically.
    const revoked: PermissionRecord = { schemaVersion: 1, state: 'revoked', generation: crypto.randomUUID(), binding };
    this.storage.saveLocalStorage(EDIT_PERMISSION_KEY, revoked);
    const readback = this.read();
    if (!readback || !sameRecord(revoked, readback)) throw Error('permission readback failed');
    this.record = revoked;
  }
  private invalidate(reason: 'changed' | 'error'): Promise<void> {
    if (this.status !== 'granted' && this.status !== 'unpermitted') return Promise.resolve();
    this.signal(reason); const epoch = this.barrier.epoch;
    // Restart must observe revocation even while an already-started SDK I/O stalls.
    try { this.writeRevoked(); } catch { this.status = 'error'; }
    return this.serialize(async () => {
      if (!await this.drain() && epoch === this.barrier.epoch) this.status = 'error';
    });
  }
  invalidateBinding(): Promise<void> { return this.invalidate('changed'); }
  grant(expectedBinding?: VaultBinding): Promise<boolean> {
    if (this.busy) return Promise.resolve(false);
    this.signal('revoking'); let epoch = this.barrier.epoch;
    return this.serialize(async () => {
      try {
        if (!await this.drain()) throw Error('started I/O failed');
        this.read(); // Unknown schema/corruption requires separately approved repair.
        const binding = await this.certify();
        if (!validBinding(binding) || expectedBinding && !sameBinding(expectedBinding, binding)) throw Error('confirmation target changed');
        if (epoch !== this.barrier.epoch) return false;
        const record: PermissionRecord = { schemaVersion: 1, state: 'granted', generation: crypto.randomUUID(), binding };
        this.record = record;
        this.storage.saveLocalStorage(EDIT_PERMISSION_KEY, record);
        const readback = this.read();
        if (!readback || !sameRecord(record, readback) || !sameBinding(binding, await this.binding()) || epoch !== this.barrier.epoch) throw Error('grant readback failed');
        // Tokens captured during readback must stay retired after admission opens.
        epoch = ++this.barrier.epoch;
        this.record = record; this.status = 'granted'; this.admittedEpoch = epoch;
        return true;
      } catch {
        if (epoch !== this.barrier.epoch) return false;
        this.status = 'error';
        try { this.writeRevoked(); } catch { /* Remain stopped; never report persistent completion. */ }
        return false;
      } finally { if (epoch === this.barrier.epoch) for (const listener of this.barrier.listeners) listener(); }
    });
  }
  revoke(): Promise<boolean> {
    this.signal('revoking'); const epoch = this.barrier.epoch;
    let persisted = false;
    try { this.writeRevoked(); persisted = true; } catch { /* Drain still owns completion; admission stays closed. */ }
    return this.serialize(async () => {
      const completed = await this.drain();
      if (epoch !== this.barrier.epoch) return false;
      this.status = persisted && completed ? 'revoked' : 'error';
      for (const listener of this.barrier.listeners) listener();
      return persisted && completed;
    });
  }
}
