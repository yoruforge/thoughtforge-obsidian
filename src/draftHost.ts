import { isDraftPath, isDraftRevision, isDraftTarget, isDraftTimestamp } from './draftData.ts';
import { restoreDrafts, type DraftRecoverySnapshot } from './draftRecovery.ts';
import { DraftStore } from './draftStore.ts';
import type { DraftRestoreMessage, DraftSaveFailure, DraftSaveResultMessage } from './draftTypes.ts';

export interface DraftClient {
  readonly alive: boolean;
  readonly generation: number;
  post(message: DraftSaveResultMessage | DraftRestoreMessage): boolean;
}
export type DraftDocumentBinding = Readonly<{ file: object; path: string; documentUri: string; isCurrent(): boolean; cancelNavigation?(): void }>;
type Binding = DraftDocumentBinding & { generation: number };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\0');

/** One instance shares the plugin-owned draft store across all map views. */
export class DraftHostAdapter {
  private active = true;
  private readonly bindings = new Map<DraftClient, Binding>();
  constructor(readonly store: DraftStore,
    private readonly stopNavigation: (client: DraftClient, reason: DraftSaveFailure) => void = () => {}) {}
  attach(client: DraftClient, document: DraftDocumentBinding): void {
    const previous = this.bindings.get(client); if (previous) this.retire(previous);
    this.bindings.set(client, { ...document, generation: client.generation });
  }
  private retire(binding: Binding): void { try { binding.cancelNavigation?.(); } catch { /* Already admitted saves still preserve input. */ } }
  detach(client: DraftClient): void { const binding = this.bindings.get(client); if (binding) this.retire(binding); this.bindings.delete(client); }
  close(): void { this.active = false; for (const binding of this.bindings.values()) this.retire(binding); this.bindings.clear(); }
  private live(client: DraftClient, binding: Binding): boolean {
    try { return this.active && client.alive && client.generation === binding.generation &&
      this.bindings.get(client) === binding && binding.isCurrent(); } catch { return false; }
  }
  private post(client: DraftClient, binding: Binding, message: DraftSaveResultMessage | DraftRestoreMessage): boolean {
    if (!this.live(client, binding)) return false;
    try { return client.post(structuredClone(message)) === true && this.live(client, binding); } catch { return false; }
  }
  private stop(client: DraftClient, binding: Binding, reason: DraftSaveFailure): void {
    if (this.live(client, binding)) { try { this.stopNavigation(client, reason); } catch { /* Retained input remains in the store. */ } }
  }
  async handleMessage(value: unknown, client: DraftClient): Promise<boolean> {
    const binding = this.bindings.get(client);
    if (!binding || !this.live(client, binding) || !record(value) || value.source !== 'webview' || value.protocolVersion !== 2 ||
      value.documentUri !== binding.documentUri || !id(value.draftId) || !isDraftRevision(value.revision) || !isDraftPath(binding.path)) return false;
    if (value.type === 'thoughtforge.draft.clear') {
      const result = await this.store.clear(value.draftId, value.revision, binding.path);
      if (result.status === 'refused') this.stop(client, binding, result.reason);
      return result.status === 'saved' && this.live(client, binding);
    }
    if (value.type !== 'thoughtforge.draft.save') return false;
    // The store owns clock admission and exact retries; the host still checks the wire shape.
    if (!isDraftTarget(value.target) || typeof value.text !== 'string' || typeof value.final !== 'boolean' || !isDraftTimestamp(value.savedAt)) {
      this.stop(client, binding, 'plugin-data-unavailable');
      this.post(client, binding, { source: 'extension', type: 'thoughtforge.draft.save.result', protocolVersion: 2,
        draftId: value.draftId, revision: value.revision, ok: false, reason: 'plugin-data-unavailable' });
      return false;
    }
    // Admit exactly this live document's path. Never re-read a renamed file path
    // after the store queue has begun, and never derive authority from a URI.
    const request = structuredClone({ draftId: value.draftId, revision: value.revision,
      target: value.target, text: value.text, savedAt: value.savedAt, path: binding.path });
    const result = await this.store.save(request);
    if (!this.live(client, binding)) return false;
    const ok = result.status === 'saved';
    if (result.status === 'refused') this.stop(client, binding, result.reason);
    const delivered = this.post(client, binding, { source: 'extension', type: 'thoughtforge.draft.save.result', protocolVersion: 2,
      draftId: request.draftId, revision: request.revision, ok,
      ...(result.status === 'refused' ? { reason: result.reason } : {}) });
    if (!delivered) { this.retire(binding); this.stop(client, binding, 'plugin-data-unavailable'); }
    return ok && delivered && this.live(client, binding);
  }
  /** Invalidate old bindings synchronously; queue rename before any await. */
  rename(file: object, oldPath: string, newPath: string): Promise<boolean> {
    for (const [client, binding] of this.bindings) if (binding.file === file) { this.retire(binding); this.bindings.delete(client); }
    return this.store.rename(oldPath, newPath);
  }
  externalSettingsChanged(): Promise<boolean> { return this.store.externalSettingsChanged(); }
  async restore(client: DraftClient, readCurrent: () => DraftRecoverySnapshot | undefined, now: number, automatic = true): Promise<boolean> {
    const binding = this.bindings.get(client);
    if (!binding || !this.live(client, binding)) return false;
    if (!await this.store.start() || !this.live(client, binding)) {
      this.stop(client, binding, 'plugin-data-unavailable'); return false;
    }
    if (!this.store.deviceId) { this.stop(client, binding, 'device-id-unavailable'); return false; }
    const current = readCurrent(); if (!current || !this.live(client, binding)) return false;
    const snapshot = structuredClone(current);
    const restored = restoreDrafts(this.store.snapshot(), this.store.deviceId, binding.path, snapshot, now, automatic);
    return this.post(client, binding, { source: 'extension', protocolVersion: 2, type: 'thoughtforge.draft.restore', ...restored });
  }
}
