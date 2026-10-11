import { cloneDraftData, cloneDraftTarget, draftTextBytes, emptyDraftData, isDraftPath, isDraftRecord, isDraftRevision,
  equalDraftValue, isDraftSavedAt, isDraftTimestamp, mergeDraftData, NOTE_DRAFT_LIMITS, validateDraftData,
  type DraftDataFailure, type DraftRecord, type DraftTarget, type PluginDataV2 } from "./draftData.ts";

export type DraftDataTransport = Readonly<{
  loadData(): Promise<unknown>;
  captureWrite?(): () => boolean;
  observations?(): Readonly<{ existing: boolean; v2: boolean }>;
  saveData(data: PluginDataV2): Promise<void>;
}>;
export type DraftSaveInput = Readonly<{ draftId: string; revision: number; path: string; target: DraftTarget; text: string; savedAt: string }>;
export type DraftSaveFailure = "draft-limit-count" | "draft-too-large" | "plugin-data-unavailable" | "device-id-unavailable";
export type DraftMutationResult =
  | Readonly<{ status: "saved"; ok: true }>
  | Readonly<{ status: "ignored"; ok: false }>
  | Readonly<{ status: "refused"; ok: false; reason: DraftSaveFailure }>;
const unavailable = (): DraftMutationResult => ({ status: "refused", ok: false, reason: "plugin-data-unavailable" });
type ObservedDraftPath = { deviceId: string; currentPath: string; formerPaths: Set<string> };

/** One owner per plugin instance. Obsidian lifecycle/ACK routing belongs to the host adapter. */
export class DraftStore {
  private data: PluginDataV2 = emptyDraftData();
  private tail: Promise<unknown> = Promise.resolve();
  private started = false;
  private reloadRequested = 0;
  private reloadHandled = 0;
  private failure: DraftDataFailure | undefined;
  private saveFailed = false;
  private observedExisting = false;
  private observedV2 = false;
  // Keep both sources of rejected data; never serialize a guessed winner.
  private rejectedLoad: unknown;
  private inputs = new Map<string, DraftSaveInput>();
  // Runtime evidence only. Never infer an alias after restart or for a reused ID/device.
  private renamedPaths = new Map<string, ObservedDraftPath>();
  private deviceIdentity: string | undefined;
  get deviceId(): string | undefined { return this.deviceIdentity; }

  constructor(private readonly transport: DraftDataTransport, deviceId: string | undefined,
    private readonly now: () => number = () => Date.now()) {
    this.deviceIdentity = typeof deviceId === "string" && deviceId.length > 0 && !deviceId.includes("\0") ? deviceId : undefined;
  }
  setDeviceId(deviceId: string | undefined): void { this.deviceIdentity = typeof deviceId === "string" && deviceId.length > 0 && !deviceId.includes("\0") ? deviceId : undefined; }
  private captureWrite(): () => boolean { return this.transport.captureWrite?.() ?? (() => true); }
  get state(): Readonly<{ loaded: boolean; dataFailure?: DraftDataFailure; saveFailed: boolean }> {
    return { loaded: this.started, ...(this.failure ? { dataFailure: this.failure } : {}), saveFailed: this.saveFailed };
  }
  /** Host-only diagnostic snapshot; never forward other-device text to a view. */
  snapshot(): PluginDataV2 { return cloneDraftData(this.data); }
  /** Latest valid input, even when quota, device identity or persistence refuses a save. */
  retainedInput(draftId: string): DraftSaveInput | undefined {
    const input = this.inputs.get(draftId);
    return input ? { ...input, target: cloneDraftTarget(input.target) } : undefined;
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
  private enqueuePrepared<T>(work: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      do { await this.prepare(); } while (this.reloadHandled < this.reloadRequested);
      // No await between this generation check and the mutation/save invocation.
      // A notification may otherwise arrive in prepare's completion microtask.
      return work();
    });
  }
  async idle(): Promise<void> { await this.tail; }
  start(): Promise<boolean> {
    // Explicit reads can retry a stopped reader; normal restore/start adds no I/O.
    return this.failure ? this.externalSettingsChanged() : this.enqueuePrepared(async () => !this.failure && !this.saveFailed);
  }

  /** Signal synchronously. Already queued saves will reload before their next write. */
  externalSettingsChanged(): Promise<boolean> {
    this.reloadRequested++;
    return this.enqueuePrepared(async () => !this.failure && !this.saveFailed);
  }
  private async prepare(): Promise<void> {
    if (!this.started) {
      this.started = true;
      await this.loadAndMerge();
    }
    while (this.reloadHandled < this.reloadRequested) {
      this.reloadHandled = this.reloadRequested;
      await this.loadAndMerge();
    }
  }
  private observe(raw: unknown, failed = false): void {
    const evidence = this.transport.observations?.();
    if (failed || raw !== null || evidence?.existing) this.observedExisting = true;
    if (evidence?.v2 || raw && typeof raw === 'object' && 'version' in raw && raw.version === 2) this.observedV2 = true;
  }
  private async loadAndMerge(): Promise<void> {
    const writable = this.captureWrite();
    const readGeneration = this.reloadRequested;
    let raw: unknown;
    try { raw = await this.transport.loadData(); }
    catch {
      this.observe(undefined, true);
      if (readGeneration === this.reloadRequested) this.failure = "plugin-data-load-failed";
      return;
    }
    this.observe(raw); // Even an obsolete read is evidence; only its data merge is discarded.
    // A settings notification can arrive while loadData is pending. Never write
    // that obsolete snapshot over the newer external settings before reloading.
    if (readGeneration !== this.reloadRequested) return;
    if (raw === null && this.observedExisting || this.observedV2 && raw && typeof raw === 'object' && 'version' in raw && raw.version === 1) {
      this.failure = "plugin-data-invalid"; this.rejectedLoad = raw; return;
    }
    const parsed = raw === null ? { ok: true as const, data: emptyDraftData() } : validateDraftData(raw);
    if (!parsed.ok) { this.failure = parsed.reason; this.rejectedLoad = raw; return; }
    const merged = mergeDraftData(this.data, this.applyObservedRenames(parsed.data));
    if (!merged.ok) { this.failure = merged.reason; this.rejectedLoad = raw; return; }
    this.data = merged.data;
    this.retireContradictedRenames();
    this.failure = undefined; this.rejectedLoad = undefined;
    // A genuinely absent new-install file is initialized on the first mutation.
    if (writable() && (raw !== null || this.data.drafts.length || this.data.draftTombstones.length)) await this.persist(writable);
  }
  private async persist(writable = this.captureWrite()): Promise<boolean> {
    if (!writable() || this.failure) return false;
    try {
      // Do not hand the transport a mutable reference to the retained input.
      await this.transport.saveData(cloneDraftData(this.data));
      this.saveFailed = false; this.observedExisting = true; this.observedV2 = true; return true;
    } catch { this.saveFailed = true; return false; }
  }
  private rememberRename(draftId: string, deviceId: string, from: string, to: string): void {
    const previous = this.renamedPaths.get(draftId);
    const formerPaths = previous?.deviceId === deviceId && previous.currentPath === from ? new Set(previous.formerPaths) : new Set<string>();
    formerPaths.add(from); formerPaths.delete(to);
    this.renamedPaths.set(draftId, { deviceId, currentPath: to, formerPaths });
  }
  private applyObservedRenames(incoming: PluginDataV2): PluginDataV2 {
    return { ...incoming, drafts: incoming.drafts.map((draft) => {
      const known = this.renamedPaths.get(draft.draftId);
      return known?.deviceId === draft.deviceId && known.formerPaths.has(draft.path) ? { ...draft, path: known.currentPath } : draft;
    }) };
  }
  private retireContradictedRenames(): void {
    for (const [id, known] of this.renamedPaths) {
      const winner = this.data.drafts.find((draft) => draft.draftId === id);
      // A higher revision may legitimately name an unobserved path/device.
      // Keep that winner and never redirect subsequent data using old evidence.
      if (winner && (winner.path !== known.currentPath || winner.deviceId !== known.deviceId)) this.renamedPaths.delete(id);
    }
  }
  private observedPathMatches(draftId: string, deviceId: string, path: string): boolean {
    const known = this.renamedPaths.get(draftId);
    return !known || known.deviceId !== deviceId || known.currentPath === path;
  }
  private result(saved: boolean): DraftMutationResult { return saved ? { status: "saved", ok: true } : unavailable(); }
  private time(): string | undefined {
    try { const time = new Date(this.now()).toISOString(); return isDraftTimestamp(time) ? time : undefined; }
    catch { return undefined; }
  }

  save(input: DraftSaveInput): Promise<DraftMutationResult> {
    // Snapshot now: delayed queue execution must not observe subsequent caller edits.
    const writable = this.captureWrite();
    const request = { ...input, target: cloneDraftTarget(input.target) };
    // Queue delay must not turn an originally excessive future capture into valid input.
    const retained = this.inputs.get(request.draftId);
    const admitted = isDraftRecord({ ...request, deviceId: "validation-only" }) &&
      (equalDraftValue(retained, request) || isDraftSavedAt(request.savedAt, this.now()));
    if (admitted) {
      const previous = this.inputs.get(request.draftId);
      if (!previous || previous.revision < request.revision) this.inputs.set(request.draftId, request);
    }
    return this.enqueuePrepared(async () => {
      if (!writable() || this.failure) return unavailable();
      if (!this.deviceId) return { status: "refused", ok: false, reason: "device-id-unavailable" };
      const draft: DraftRecord = { ...request, deviceId: this.deviceId };
      if (!admitted || !isDraftRecord(draft)) return unavailable();
      const previous = this.data.drafts.find((item) => item.draftId === draft.draftId);
      const stone = this.data.draftTombstones.find((item) => item.draftId === draft.draftId);
      if (stone && stone.revision >= draft.revision || previous && previous.revision > draft.revision) return { status: "ignored", ok: false };
      if (!this.observedPathMatches(draft.draftId, this.deviceId, draft.path)) return unavailable();
      if (previous && (previous.deviceId !== this.deviceId || previous.path !== draft.path)) return unavailable();
      if (draftTextBytes(draft.text) > NOTE_DRAFT_LIMITS.maxDraftTextBytes) return { status: "refused", ok: false, reason: "draft-too-large" };
      if (!previous && this.data.drafts.filter((item) => item.deviceId === this.deviceId).length >= NOTE_DRAFT_LIMITS.maxDraftsPerVaultDevice) {
        return { status: "refused", ok: false, reason: "draft-limit-count" };
      }
      const merged = mergeDraftData(this.data, { ...this.data, drafts: [draft] });
      if (!merged.ok) return unavailable();
      const previousData = this.data;
      this.data = merged.data;
      this.retireContradictedRenames();
      const saved = await this.persist(writable);
      if (!saved && !writable()) this.data = previousData;
      return this.result(saved);
    });
  }
  clear(draftId: string, revision: number, path: string): Promise<DraftMutationResult> {
    const writable = this.captureWrite();
    return this.enqueuePrepared(async () => {
      if (!writable() || this.failure) return unavailable();
      if (!this.deviceId) return { status: "refused", ok: false, reason: "device-id-unavailable" };
      const clearedAt = this.time();
      if (typeof draftId !== "string" || !draftId.length || draftId.includes("\0") || !isDraftRevision(revision) || !isDraftPath(path) || !clearedAt) return unavailable();
      const previous = this.data.drafts.find((item) => item.draftId === draftId);
      const stone = this.data.draftTombstones.find((item) => item.draftId === draftId);
      if (previous && (previous.deviceId !== this.deviceId || previous.path !== path)) return unavailable();
      if (previous && previous.revision > revision || stone && stone.revision > revision) return { status: "ignored", ok: false };
      if (!this.observedPathMatches(draftId, this.deviceId, path)) return unavailable();
      const merged = mergeDraftData(this.data, { ...this.data, drafts: [], draftTombstones: [stone?.revision === revision ? stone : { draftId, revision, clearedAt }] });
      if (!merged.ok) return unavailable();
      const previousData = this.data;
      this.data = merged.data;
      const saved = await this.persist(writable);
      if (!saved && !writable()) this.data = previousData;
      if (saved && (this.inputs.get(draftId)?.revision ?? Infinity) <= revision) this.inputs.delete(draftId);
      return this.result(saved);
    });
  }
  rename(oldPath: string, newPath: string): Promise<boolean> {
    const writable = this.captureWrite();
    return this.enqueuePrepared(async () => {
      if (!writable() || this.failure || !isDraftPath(oldPath) || !isDraftPath(newPath)) return false;
      const previousData = this.data, previousInputs = new Map(this.inputs), previousPaths = new Map(this.renamedPaths);
      // styles deliberately do not follow rename. Preserve all devices' drafts.
      const recorded = new Set<string>();
      const movedInputs = new Set<string>();
      for (const draft of this.data.drafts) if (draft.path === oldPath) {
        this.rememberRename(draft.draftId, draft.deviceId, oldPath, newPath); recorded.add(draft.draftId);
      }
      // Clearing removes input/data, but not the observed identity of its note.
      // Follow only its current path; a former path may already be reused.
      for (const [id, known] of this.renamedPaths) if (!recorded.has(id) && known.currentPath === oldPath) {
        const owner = this.data.drafts.find((draft) => draft.draftId === id);
        if (!owner || owner.deviceId === known.deviceId && owner.path === oldPath) {
          this.rememberRename(id, known.deviceId, oldPath, newPath); recorded.add(id);
        }
      }
      for (const input of this.inputs.values()) if (input.path === oldPath && this.deviceId) {
        const owner = this.data.drafts.find((draft) => draft.draftId === input.draftId);
        const known = this.renamedPaths.get(input.draftId);
        // A syntactically valid but refused cross-path input carries no rename
        // authority. Retain it verbatim rather than rebind it to another note.
        if (owner && (owner.deviceId !== this.deviceId || owner.path !== oldPath)) continue;
        if (known && (known.deviceId !== this.deviceId || !recorded.has(input.draftId) && known.currentPath !== oldPath)) continue;
        if (!recorded.has(input.draftId)) this.rememberRename(input.draftId, this.deviceId, oldPath, newPath);
        movedInputs.add(input.draftId);
      }
      this.data = { ...this.data, drafts: this.data.drafts.map((draft) => draft.path === oldPath ? { ...draft, path: newPath } : draft) };
      for (const [id, input] of this.inputs) if (movedInputs.has(id)) this.inputs.set(id, { ...input, path: newPath });
      const saved = await this.persist(writable);
      if (!saved && !writable()) { this.data = previousData; this.inputs = previousInputs; this.renamedPaths = previousPaths; }
      return saved;
    });
  }
}
