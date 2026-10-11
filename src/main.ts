import { FileSystemAdapter, FileView, Modal, Notice, Plugin, PluginSettingTab, Setting, type TFile, type WorkspaceLeaf } from 'obsidian';
import { setDebugTraceSettingReader } from './shared/debugTrace.js';
import { FileCoordinatorV2, type MapClientV2 } from './coordinatorV2.ts';
import { ObsidianMapHost } from './obsidianHost.ts';
import { MapSession, type FrameEnvelope } from './session.ts';
import { obsidianThemeVars } from './theme.ts';
import { EditPermission, createPermissionBarrier, PERMISSION_TEXT, type PermissionBarrier, type PermissionToken } from './editPermission.ts';
import { WriteTargetGuard, type VaultBinding } from './writeTargetGuard.ts';
import { DraftStore } from './draftStore.ts';
import { DraftHostAdapter, type DraftClient } from './draftHost.ts';
import { getDraftDeviceId } from './draftDeviceId.ts';
import { listRemainingDrafts, listReadonlyDrafts } from './draftRecovery.ts';
import { emptyDraftData, validateDraftData, mergeDraftDataSources } from './draftData.ts';
import type { HostMessageV2, HostReasonV2, LinkOpenMessageV2 } from './protocolV2.ts';
import type { DraftSaveResultMessage, DraftRestoreMessage } from './draftTypes.ts';
import { MAP_COMMANDS, registerMapCommands, type MapCommandId } from './mapCommands.ts';
import { MapCommandKeyChecks, KEY_CHECK_LABELS, type KeyCheckStatus } from './mapCommandKeyChecks.ts';

const VIEW_TYPE = 'thoughtforge-map-poc0';
const markdown = (path: string) => path.endsWith('.md');
const PERMISSION_BARRIER = Symbol.for('thoughtforge.edit-permission-io');
function permissionBarrier(app: object): PermissionBarrier {
  let value = Reflect.get(app, PERMISSION_BARRIER) as PermissionBarrier | undefined;
  if (!value) { value = createPermissionBarrier(); Object.defineProperty(app, PERMISSION_BARRIER, { value }); }
  return value;
}
const DATA_QUEUE = Symbol.for('thoughtforge.draft-data-writer');
type DataQueue = { tail: Promise<unknown>; observed?: Promise<unknown>; rejected?: Promise<unknown>; evidence: { existing: boolean; v2: boolean } };
function sharedDataQueue(app: object): DataQueue {
  let queue = Reflect.get(app, DATA_QUEUE) as DataQueue | undefined;
  if (!queue) { queue = { tail: Promise.resolve(), evidence: { existing: false, v2: false } }; Object.defineProperty(app, DATA_QUEUE, { value: queue }); }
  queue.evidence ??= { existing: false, v2: false }; // A previous plugin build may own the shared queue.
  return queue;
}
// Session evidence is independent of the latest/coalesced raw envelope.
function observeDataRead(queue: DataQueue, read: Promise<unknown>): Promise<unknown> {
  return read.then(raw => {
    if (raw !== null) queue.evidence.existing = true;
    if (raw && typeof raw === 'object' && 'version' in raw && raw.version === 2) queue.evidence.v2 = true;
    return raw;
  }, error => { queue.evidence.existing = true; throw error; });
}
class ThoughtForgeView extends FileView implements MapClientV2, DraftClient {
  private coordinator?: FileCoordinatorV2;
  private session?: MapSession;
  private framePermission?: PermissionToken;
  private readonly retiredSessions = new Set<MapSession>();
  generation = 0;
  private active = false;
  private capable = false;
  private closing = false;
  private finishing?: Promise<void>;
  private loadEpoch = 0;
  private readyBinding?: Readonly<{ generation: number; documentUri: string }>;
  private initialReady = false;
  private automaticRestore = true;
  private permissionBand?: HTMLElement;
  permissionChanged(): void {
    if (this.permissionBand) { this.permissionBand.textContent = this.plugin.editPermissionMessage ?? ''; this.permissionBand.hidden = this.plugin.isEditingAllowed; }
    const current = this.plugin.captureEditingPermission();
    if (this.session && this.framePermission && (current.epoch !== this.framePermission.epoch || current.generation !== this.framePermission.generation)) {
      const old = this.session;
      old.commands.invalidate();
      this.session = undefined; this.framePermission = undefined; this.generation++;
      this.capable = false; this.readyBinding = undefined; this.initialReady = false;
      this.plugin.draftHost?.detach(this);
      this.retiredSessions.add(old); old.retire('この地図の編集を停止しました。以前の入力は表示・コピーできます');
      // Never reparent a live iframe: removal destroys its document and port.
      const retained = old.iframe.parentElement as HTMLDetailsElement;
      retained.removeClass('thoughtforge-current-frame'); retained.addClass('thoughtforge-retired-input');
      retained.open = true;
      retained.querySelector('summary')!.hidden = false;
    }
    if (this.active && !this.closing && !this.session && this.coordinator?.isAlive && this.plugin.isEditingAllowed) this.startSession(this.coordinator);
  }
  get needsInitialModel(): boolean { return !!this.readyBinding && !this.initialReady && this.active && !this.closing; }
  async retryInitialModel(): Promise<void> { if (this.needsInitialModel && this.coordinator && this.readyBinding) await this.ready(this.coordinator, this.readyBinding); }
  get alive(): boolean { return this.active; }
  themeChanged(): void { this.session?.theme(obsidianThemeVars(this.contentEl.ownerDocument)); }
  constructor(leaf: WorkspaceLeaf, private readonly plugin: ThoughtForgePlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return this.file?.basename ?? 'ThoughtForge'; }
  getIcon(): string { return 'git-fork'; }
  canAcceptExtension(extension: string): boolean { return extension === 'md'; }
  async onLoadFile(file: TFile): Promise<void> {
    const loadEpoch = ++this.loadEpoch;
    await this.finish();
    if (loadEpoch !== this.loadEpoch || !this.plugin.isActive) return;
    if (!markdown(file.path)) { this.contentEl.setText('Markdownノートを選んでください'); return; }
    this.active = true; this.closing = false; this.generation++; this.capable = false; this.readyBinding = undefined; this.initialReady = false; this.automaticRestore = true;
    this.plugin.mapViews.add(this);
    const coordinator = this.plugin.acquire(file); this.coordinator = coordinator; coordinator.attach(this);
    this.contentEl.addClass('thoughtforge-obsidian-view');
    await coordinator.sync();
    if (!this.active || this.coordinator !== coordinator || loadEpoch !== this.loadEpoch) return;
    this.startSession(coordinator);
    this.permissionBand = this.contentEl.createEl('p', { cls: 'thoughtforge-permission-status', attr: { role: 'status' } }); this.permissionChanged();
    this.plugin.watchMarkdownGates();
  }
  private startSession(coordinator: FileCoordinatorV2): void {
    if (this.session || !this.active || this.closing) return;
    const generation = this.generation;
    for (const old of this.retiredSessions) (old.iframe.parentElement as HTMLDetailsElement).open = false;
    this.framePermission = this.plugin.captureEditingPermission();
    const container = this.contentEl.createEl('details', { cls: 'thoughtforge-current-frame' }); container.open = true;
    container.createEl('summary', { text: '以前の地図と入力を表示・コピー' }).hidden = true;
    const session = new MapSession(container, generation, coordinator.seedDocument, '保存済み本文を確認中',
      envelope => { if (this.active && session.alive) this.receive(envelope, session); },
      () => { if (this.generation === generation && this.session === session) { new Notice('地図を開けませんでした（接続タイムアウト）'); this.release(); } },
      binding => { if (this.session === session) void this.ready(coordinator, binding); }, 2, obsidianThemeVars(this.contentEl.ownerDocument), text => { new Notice(text); });
    this.session = session;
  }
  private bindDraft(coordinator: FileCoordinatorV2): void {
    const file = coordinator.host.file!, path = coordinator.host.path!, uri = coordinator.host.uri, generation = this.generation, token = this.framePermission;
    this.plugin.draftHost?.attach(this, { file, path, documentUri: uri,
      isCurrent: () => this.active && this.coordinator === coordinator && this.generation === generation &&
        coordinator.host.file === file && coordinator.host.path === path && coordinator.host.uri === uri && !!this.session?.alive &&
        !!token && this.plugin.isEditingPermissionCurrent(token) });
  }
  private async ready(coordinator: FileCoordinatorV2, binding: Readonly<{ generation: number; documentUri: string }>): Promise<void> {
    if (this.closing || !this.active || this.coordinator !== coordinator || binding.generation !== this.generation || !this.session?.alive) return;
    this.readyBinding = binding;
    if (await coordinator.ready(this, binding) && this.active && !this.closing && this.coordinator === coordinator && binding.generation === this.generation) {
      this.initialReady = true;
      if (this.capable) { this.bindDraft(coordinator); await this.restore(); }
    }
    this.plugin.watchMarkdownGates();
  }
  async restore(automatic = this.automaticRestore): Promise<void> {
    if (!automatic) this.automaticRestore = false;
    const coordinator = this.coordinator;
    if (this.plugin.isEditingAllowed && coordinator?.isAlive && !this.closing) {
      await this.plugin.draftHost?.restore(this,
        () => this.active && this.coordinator === coordinator ? coordinator.recoverySnapshot : undefined, Date.now(), automatic);
      this.plugin.updateDataGate();
    }
  }
  async renamed(coordinator: FileCoordinatorV2): Promise<void> {
    if (!this.active || this.closing || this.coordinator !== coordinator || !this.session?.alive) return;
    this.initialReady = false; this.session.rebind(coordinator.host.uri); this.plugin.draftHost?.detach(this);
    await this.ready(coordinator, { generation: this.generation, documentUri: coordinator.host.uri });
  }
  private receive(envelope: FrameEnvelope, origin = this.session): void {
    const coordinator = this.coordinator; if (!coordinator || !this.active) return;
    if (origin && this.retiredSessions.has(origin)) {
      const message = envelope.message as Record<string, unknown> | undefined;
      if (envelope.generation !== origin.generation || message?.source !== 'webview' || message.protocolVersion !== 2 ||
          message.type !== 'thoughtforge.clipboard.write' || typeof message.text !== 'string') return;
      const acknowledge = (ok: boolean) => { if (this.active && this.retiredSessions.has(origin) && origin.alive && envelope.clipboardRequestId) origin.clipboardResult(envelope.clipboardRequestId, ok); };
      void coordinator.host.writeClipboard(message.text).then(() => acknowledge(true), () => acknowledge(false)); return;
    }
    if (origin !== this.session || envelope.generation !== this.generation) return;
    if (envelope.obsidianOnly === 'capability') {
      this.capable = envelope.inert === true;
      if (!this.capable) coordinator.lock('inert対応を確認できないため、書き込みを止めました');
      else if (this.initialReady) { this.bindDraft(coordinator); void this.restore(); }
      return;
    }
    const value = envelope.message;
    if (!this.capable || !value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    if (message.source !== 'webview' || message.protocolVersion !== 2 || message.documentUri !== coordinator.host.uri) return;
    const viewing = ['thoughtforge.r7.mount', 'thoughtforge.r7.copy.ack', 'thoughtforge.r7.cancel', 'thoughtforge.clipboard.write', 'thoughtforge.source.reveal', 'thoughtforge.link.open'].includes(message.type as string);
    if (!viewing && (!this.initialReady || !this.framePermission || !this.plugin.isEditingPermissionCurrent(this.framePermission))) {coordinator.retireR7Request(message,this);return;}
    // During standard close only already-admitted/new autosave drafts can finish;
    // semantic tickets were retired before awaiting the store, never prolonged.
    if (message.type === 'thoughtforge.draft.save' || message.type === 'thoughtforge.draft.clear') {
      const task = this.plugin.draftHost?.handleMessage(message, this);
      void task?.then(async ok => {
        this.plugin.updateDataGate();
        if (message.type === 'thoughtforge.draft.clear') {
          if (ok) await this.restore(); else new Notice('下書きの破棄を保存できませんでした。入力を保持しています。地図内で破棄を再試行してください');
        }
      }); return;
    }
    if (this.closing) return;
    const session = this.session, generation = this.generation;
    let task: Promise<boolean>;
    if (message.type === 'thoughtforge.clipboard.write' && typeof message.text === 'string') {
      task = coordinator.handleMessage({...message,effectId:envelope.clipboardRequestId},this);
    } else if (message.type === 'thoughtforge.source.reveal') {
      const range = message.range as { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } } | undefined;
      if (!range?.start || !range.end || ![range.start.line, range.start.column, range.end.line, range.end.column].every(v => Number.isSafeInteger(v) && (v as number) >= 1)) return;
      const uri = coordinator.host.uri, contentHash = coordinator.contentHash;
      const navigationToken = session?.commands.navigationToken;
      task = coordinator.host.revealSource(range as Parameters<typeof coordinator.host.revealSource>[0], () => this.active && !this.closing &&
        this.session === session && this.generation === generation && this.coordinator === coordinator && coordinator.isAlive &&
        session?.commands.navigationToken === navigationToken &&
        coordinator.host.uri === uri && coordinator.contentHash === contentHash).then(() => true);
    } else if (message.type === 'thoughtforge.link.open') {
      if (typeof message.linktext !== 'string' || typeof message.nodeId !== 'string' || !['wikilink', 'markdown'].includes(message.linkKind as string) || !['same-tab', 'new-tab'].includes(message.openIn as string)) return;
      task = this.plugin.openLink(message as unknown as LinkOpenMessageV2, this, coordinator);
    } else task = coordinator.handleMessage(message, this);
    if (envelope.clipboardRequestId && message.type === 'thoughtforge.clipboard.write') {
      const requestId = envelope.clipboardRequestId;
      const acknowledge = (ok: boolean): void => { if (this.active && this.generation === generation && this.session === session && session?.alive) session.clipboardResult(requestId, ok); };
      void task.then(ok => acknowledge(ok === true), () => acknowledge(false));
    }
    void task.catch(() => { if (this.active) new Notice('地図の操作を完了できませんでした。入力は下書きで確認してください'); });
  }
  mapCommand(id: MapCommandId, checking: boolean): boolean {
    // R3: every invocation obtains its own live view/session; checking reserves nothing.
    const session = this.session, coordinator = this.coordinator, generation = this.generation, uri = coordinator?.host.uri;
    const current = () => this.plugin.isActive && this.active && !this.closing && this.initialReady && this.capable &&
      this.plugin.app.workspace.activeLeaf?.view === this && this.session === session && session?.alive === true &&
      this.coordinator === coordinator && coordinator?.isAlive === true && coordinator.host.uri === uri && this.generation === generation;
    return current() && !!session && (checking ? session.commands.available(id) : session.commands.execute(id, current));
  }
  post(message: HostMessageV2 | DraftSaveResultMessage | DraftRestoreMessage): boolean { return this.session?.post(message) === true; }
  async close(): Promise<void> { this.loadEpoch++; await this.finish(); this.leaf.detach(); }
  async onUnloadFile(): Promise<void> { this.loadEpoch++; await this.finish(); }
  async onClose(): Promise<void> { this.loadEpoch++; await this.finish(); }
  private finish(): Promise<void> {
    if (this.finishing) return this.finishing;
    if (!this.active) return Promise.resolve();
    this.closing = true;
    this.session?.commands.invalidate();
    const coordinator = this.coordinator;
    coordinator?.detach(this); if (coordinator) this.plugin.release(coordinator);
    // No undefined host->frame flush wire. Await saves received so far, then
    // retire this binding/port. Latest DOM collection remains a separate gate.
    const work = Promise.allSettled([this.plugin.draftStore?.idle(), coordinator?.finalizer]).then(() => this.release());
    this.finishing = work.finally(() => { this.finishing = undefined; }); return this.finishing;
  }
  private release(): void {
    this.active = false; this.closing = false; this.generation++;
    this.plugin.mapViews.delete(this); this.framePermission = undefined;
    this.plugin.draftHost?.detach(this); this.session?.close(); this.session = undefined;
    for (const old of this.retiredSessions) old.close(); this.retiredSessions.clear();
    const coordinator = this.coordinator; this.coordinator = undefined;
    if (coordinator) { coordinator.detach(this); this.plugin.release(coordinator); }
    this.contentEl.empty();
  }
}

class RemainingDraftsModal extends Modal {
  private waitingForReload = false;
  constructor(private readonly plugin: ThoughtForgePlugin) { super(plugin.app); }
  open(): void { this.plugin.remainingDraftsModals.add(this); super.open(); }
  onOpen(): void {
    this.waitingForReload = false;
    const store = this.plugin.draftStore; this.contentEl.empty();
    this.contentEl.createEl('h2', { text: '残っている下書き' });
    this.contentEl.createEl('p', { text: '30日を超えたもの・元のノートがないものも表示します。自動削除はしません。data.jsonはSyncで他端末へ同期される場合があります。' });
    if (!store?.state.loaded || store.state.dataFailure) {
      this.contentEl.createEl('p', { text: '下書きデータを確認できないため一覧を表示できません。データの読込み状態を確認してください。' }); return;
    }
    const data = store.snapshot(), deviceId = store.deviceId, epoch = this.plugin.draftListEpoch, now = Date.now();
    if (epoch === undefined || !this.plugin.isActive) {
      this.waitingForReload = epoch === undefined && this.plugin.isActive;
      this.contentEl.createEl('p', { text: '下書きの更新中です。「残っている下書きを見る」を開き直してください。' }); return;
    }
    if (deviceId) this.contentEl.createEl('h3', { text: 'この端末の下書き' });
    for (const draft of listRemainingDrafts(data, deviceId, now)) {
      const row = this.contentEl.createDiv();
      row.createEl('p', { text: `${draft.path} — ${draft.target.titleSource}${draft.expired ? '（自動提示の対象外）' : ''}` });
      row.createEl('textarea', { text: draft.text, attr: { readonly: 'true', 'aria-label': '保持した入力' } });
      row.createEl('button', { text: 'コピー' }).onclick = () => { void navigator.clipboard.writeText(draft.text).catch(() => new Notice('コピーできませんでした')); };
      row.createEl('button', { text: '地図で適用先を確認' }).onclick = () => {
        const file = this.plugin.app.vault.getFileByPath(draft.path);
        if (!file) { new Notice('元のノートがありません。入力をコピーして適用先を選んでください'); return; }
        void this.plugin.openMap(file, false); this.close();
      };
      const discard = row.createEl('button', { text: '破棄' });
      if (!this.plugin.isEditingAllowed) { discard.disabled = true; discard.title = 'このVaultは表示のみのため、下書き・表示スタイルを保存しません。'; }
      if (this.plugin.hasOpenMap(draft.path)) { discard.disabled = true; discard.title = '開いている地図の下書きは、その地図内で破棄してください'; }
      discard.onclick = () => {
        if (!this.plugin.isEditingAllowed) return;
        if (this.plugin.hasOpenMap(draft.path)) { new Notice('開いている地図の下書きは、その地図内で破棄してください'); this.onOpen(); return; }
        if (!window.confirm('この下書きを破棄しますか？')) return;
        discard.disabled = true;
        void store.clear(draft.draftId, draft.revision + 1, draft.path).then(result => {
          if (result.status === 'saved') this.onOpen(); else { discard.disabled = false; new Notice('下書きを破棄できませんでした。入力は保持しています'); }
          this.plugin.updateDataGate();
        });
      };
    }
    const drafts = listReadonlyDrafts(data, deviceId, now);
    const section = this.contentEl.createDiv();
    section.createEl('h3', { text: deviceId ? '別の端末IDの下書き' : '端末判定不能の下書き' });
    section.createEl('p', { text: deviceId ? '以前の自端末か別端末かは判別できません。本文の閲覧とコピーだけができます。' :
      '端末IDを取得できないため、どの端末の下書きか判定できません。検証済みの下書きの閲覧とコピーだけができます。' });
    if (!drafts.length) { section.createEl('p', { text: '残っている下書きはありません' }); return; }
    section.createEl('p', { text: '一覧を開いた時点の内容です。更新の通知後は一覧を開き直してください。コピーした入力は、適用先を選んで手動で取り込んでください。' });
    // Retire every old recovery handler before a queued settings reload completes.
    // No recovery action starts/retries a read, writes data or creates an identity.
    const current = (): boolean => {
      if (this.plugin.isActive && this.plugin.draftStore === store && store.deviceId === deviceId &&
          this.plugin.draftListEpoch === epoch && store.state.loaded && !store.state.dataFailure) return true;
      this.invalidate();
      return false;
    };
    let shown = 0;
    const reveal = section.createEl('button', { text: `${deviceId ? '別の端末ID' : '端末判定不能'}の下書きを表示（${drafts.length}件）` });
    const rows = section.createDiv(), progress = section.createEl('p');
    reveal.onclick = () => {
      if (!current()) return;
      const end = Math.min(shown + 20, drafts.length);
      for (; shown < end; shown++) {
        const draft = drafts[shown]!, row = rows.createDiv();
        const kind = draft.target.kind === 'pending-child' ? '未作成の子' : draft.target.kind === 'center' ? '中心' : 'ノード';
        row.createEl('p', { text: `${draft.path} — ${kind}（${draft.target.field === 'note' ? 'ノート' : 'タイトル'}） — ${draft.target.titleSource}` });
        row.createEl('p', { text: `端末ID: ${draft.deviceId} — 保存日時: ${draft.savedAt}${draft.expired ? '（自動提示の対象外: 30日以上または未来日時）' : ''}` });
        row.createEl('textarea', { text: draft.text, attr: { readonly: 'true', 'aria-label': `${draft.path} の保持した入力（読み取り専用）` } });
        row.createEl('button', { text: 'コピー' }).onclick = async () => {
          if (!current()) return;
          try { await navigator.clipboard.writeText(draft.text); }
          catch { new Notice('コピーできませんでした。本文を選択して手動でコピーしてください'); }
        };
      }
      progress.setText(`${drafts.length}件中${shown}件を表示`);
      if (shown < drafts.length) reveal.setText(`さらに表示（残り${drafts.length - shown}件）`);
      else { reveal.setText(`すべて表示済み（${drafts.length}件）`); reveal.disabled = true; }
    };
  }
  invalidate(): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: '下書きや端末の状態が更新されました。「残っている下書きを見る」を開き直してください。' });
  }
  reloadCompleted(): void { if (this.waitingForReload) this.onOpen(); }
  onClose(): void { this.plugin.remainingDraftsModals.delete(this); this.waitingForReload = false; this.contentEl.empty(); }
}

export default class ThoughtForgePlugin extends Plugin {
  readonly mapViews = new Set<ThoughtForgeView>();
  readonly remainingDraftsModals = new Set<RemainingDraftsModal>();
  private readonly coordinators = new Map<TFile, FileCoordinatorV2>();
  private readonly finalizers = new Set<Promise<unknown>>();
  private guard = new WriteTargetGuard();
  private permission?: EditPermission;
  private permissionListener?: () => void;
  get isEditingAllowed(): boolean { return !!this.permission?.isCurrent(this.permission.capture()); }
  captureEditingPermission(): PermissionToken { return this.permission?.capture() ?? { epoch: -1, generation: '' }; }
  isEditingPermissionCurrent(token: PermissionToken): boolean { return this.active && !!this.permission?.isCurrent(token); }
  get editPermissionLabel(): string { return this.editPermissionMessage === PERMISSION_TEXT.unpermitted ? '編集は許可されていません' : this.editPermissionMessage ?? '編集を許可しています'; }
  get editPermissionMessage(): string | undefined { return this.permission ? this.permission.message : PERMISSION_TEXT.unpermitted; }
  get permissionBusy(): boolean { return this.permission?.busy ?? false; }
  get vaultFolder(): string { const adapter = this.app.vault.adapter; return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '識別できません'; }
  private async certifyPermission() {
    const guard = new WriteTargetGuard(); this.guard = guard;
    guard.onRevoked = () => { if (this.active && this.guard === guard) void this.permission?.invalidateBinding(); };
    const base = () => { const adapter = this.app.vault.adapter; return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined; };
    if (!await this.guard.certify(base(), () => this.app.vault.configDir, () => this.app.vault.getName(), base)) throw Error('unsafe Vault binding');
    return this.guard.inspectBinding();
  }
  private updatePermissionGate(): void {
    for (const c of this.coordinators.values()) c.setEditPermission(this.isEditingAllowed);
    // Closing views have left coordinator.clients but still own a live draft port.
    for (const v of this.mapViews) v.permissionChanged();
  }
  async checkEditing(): Promise<void> { await this.permission?.check(); this.updatePermissionGate(); }
  async inspectEditingTarget(): Promise<VaultBinding> {
    const guard = new WriteTargetGuard(), adapter = this.app.vault.adapter;
    if (!await guard.certify(adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined,
      () => this.app.vault.configDir, () => this.app.vault.getName())) throw Error('unsafe confirmation target');
    return guard.inspectBinding();
  }
  async grantEditing(expectedBinding?: VaultBinding): Promise<boolean> {
    const lifecycle = this.lifecycle;
    if (!this.active || !await this.permission?.grant(expectedBinding) || !this.active || lifecycle !== this.lifecycle) return false;
    const permission = this.permission!, token = permission.capture();
    const device = await getDraftDeviceId({ loadLocalStorage: key => this.app.loadLocalStorage(key),
      saveLocalStorage: (key, value) => permission.run(token, async () => { this.app.saveLocalStorage(key, value); }) }, 'thoughtforge:draft-device-id');
    if (!this.active || lifecycle !== this.lifecycle || !permission.isCurrent(token)) return false;
    this.draftStore?.setDeviceId(device.ok ? device.deviceId : undefined);
    await this.draftStore?.externalSettingsChanged(); this.updateDataGate(); this.updatePermissionGate();
    for (const c of this.coordinators.values()) await c.sync(); return true;
  }
  async revokeEditing(): Promise<boolean> { const result = await this.permission?.revoke() ?? false; this.updatePermissionGate(); return result; }
  draftStore?: DraftStore;
  draftHost?: DraftHostAdapter;
  mapCommandKeyChecks?: MapCommandKeyChecks;
  private active = false;
  private lifecycle = 0;
  private settingsEpoch = 0;
  private settingsReadEpoch = 0;
  get draftListEpoch(): number | undefined { return this.settingsReadEpoch === this.settingsEpoch ? this.settingsEpoch : undefined; }
  private gateTimer?: ReturnType<typeof setTimeout>;
  get isActive(): boolean { return this.active; }
  hasOpenMap(path: string): boolean { return [...this.coordinators.values()].some(c => c.isAlive && c.host.path === path && c.clients.size > 0); }
  async onload(): Promise<void> {
    const lifecycle = ++this.lifecycle; setDebugTraceSettingReader(() => false);
    this.permission = new EditPermission(this.app, () => this.guard.inspectBinding(), () => this.certifyPermission(), permissionBarrier(this.app), () => this.guard.contextMatches());
    await this.permission.initialize();
    if (lifecycle !== this.lifecycle) return;
    this.active = true;
    this.permissionListener = () => this.updatePermissionGate(); this.permission.barrier.listeners.add(this.permissionListener);
    const permission = this.permission, token = permission.capture();
    const device = await getDraftDeviceId({ loadLocalStorage: key => this.app.loadLocalStorage(key),
      saveLocalStorage: (key, value) => permission.run(token, async () => { this.app.saveLocalStorage(key, value); }) },
      'thoughtforge:draft-device-id', () => crypto.randomUUID(), this.isEditingAllowed);
    if (!this.active || lifecycle !== this.lifecycle) return;
    const dataQueue = sharedDataQueue(this.app);
    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
      const task = dataQueue.tail.then(operation, operation); dataQueue.tail = task.catch(() => undefined); return task;
    };
    const live = () => this.active && this.lifecycle === lifecycle;
    this.mapCommandKeyChecks = new MapCommandKeyChecks(this.app, permission, live);
    this.draftStore = new DraftStore({ captureWrite: () => { const token = permission.capture(); return () => live() && permission.isCurrent(token); }, observations: () => dataQueue.evidence, loadData: () => serialize(async () => {
      if (!live()) throw Error('retired settings reader');
      const observation = dataQueue.observed, retry = !!observation && dataQueue.rejected === observation;
      const rejected = () => { if (dataQueue.observed === observation) dataQueue.rejected = observation; };
      let observed: unknown;
      try { observed = await observation; }
      catch (error) { if (!retry) { rejected(); throw error; } }
      const known = observed === undefined || observed === null ? { ok: true as const, data: emptyDraftData() } : validateDraftData(observed);
      if (!known.ok && !retry) { rejected(); return observed; }
      const disk = await observeDataRead(dataQueue, this.loadData());
      // Keep absence/regression visible to the store; canonicalization must not erase source evidence.
      if (disk === null) return null;
      const parsed = validateDraftData(disk);
      if (!parsed.ok) return disk;
      // The store will reject this regression; its consumed observation is retryable after actual v2 repair.
      if (dataQueue.evidence.v2 && (disk as { version: number }).version === 1) rejected();
      if (observed == null || !known.ok) return disk; // Recovery imports actual data, never guessed empty defaults.
      if (typeof disk === 'object' && disk && typeof observed === 'object' && observed &&
          'version' in disk && 'version' in observed && disk.version !== observed.version) {
        if (retry) return disk;
        rejected(); throw Error('plugin-data-invalid');
      }
      return mergeDraftDataSources(disk, observed);
    }), saveData: data => {
      const settingsEpoch = this.settingsEpoch, token = permission.capture(), pluginDir = this.manifest?.dir;
      const dataPath = typeof pluginDir === 'string' ? `${pluginDir}/data.json` : '';
      const matchesInstalledPath = () => dataPath !== '' && pluginDir === `${this.app.vault.configDir}/plugins/thoughtforge` && this.manifest?.dir === pluginDir;
      const checkInstalledPath = () => {
        if (matchesInstalledPath()) return true;
        new Notice('data.json の保存先がプラグインの配置と一致しないため、保存を停止しました。設定フォルダの plugins/thoughtforge への配置を確認してください。入力はコピーできます。');
        return false;
      };
      return serialize(async () => {
      if (!live() || !checkInstalledPath() || !await permission.check(token) || await this.guard.checkPluginData(dataPath) ||
          !live() || !checkInstalledPath() || this.settingsEpoch !== settingsEpoch) throw Error('draft write target refused');
      // A fresh instance's load/save waits for this admitted transport to finish.
      await permission.run(token, () => this.saveData(data));
    }); } }, device.ok ? device.deviceId : undefined);
    this.draftHost = new DraftHostAdapter(this.draftStore, (_client, reason) => new Notice(reason === 'device-id-unavailable'
      ? '端末IDを取得できません。下書きを保存できないため、地図の移動を停止します' : '下書きを保存できませんでした。入力を保持して地図の移動を停止します'));
    const initialObserved = dataQueue.observed, loaded = await this.draftStore.start();
    if (!this.active || lifecycle !== this.lifecycle) { this.draftHost.close(); return; }
    if (loaded && initialObserved && dataQueue.observed === initialObserved) dataQueue.observed = undefined;
    this.addSettingTab(new EditPermissionSettings(this));
    this.registerView(VIEW_TYPE, leaf => new ThoughtForgeView(leaf, this));
    this.addCommand({ id: 'open-as-map', name: 'マップで開く', checkCallback: checking => {
      const file = this.app.workspace.getActiveFile(); if (!file || !markdown(file.path)) return false;
      if (!checking) void this.openMap(file); return true;
    } });
    this.addCommand({ id: 'open-markdown-beside-map', name: 'Markdownを並べて開く', checkCallback: checking => {
      const file = this.app.workspace.getActiveFile(); if (!file || !markdown(file.path)) return false;
      if (!checking) void this.openMarkdown(file); return true;
    } });
    this.addCommand({ id: 'remaining-drafts', name: '残っている下書きを見る', callback: () => {
      const observed = dataQueue.observed;
      void this.draftStore?.start().then(loaded => {
        if (!live()) return;
        if (loaded && dataQueue.observed === observed) { dataQueue.observed = undefined; dataQueue.rejected = undefined; }
        this.updateDataGate(); new RemainingDraftsModal(this).open();
      });
    } });
    this.addCommand({ id: 'load-markdown-tabs-for-map', name: 'この地図の保存確認のためMarkdownタブを読み込む', checkCallback: checking => {
      const file = this.app.workspace.getActiveFile(), coordinator = file && this.coordinators.get(file);
      if (!coordinator?.isAlive || !coordinator.host.loadMarkdownTabs) return false;
      if (!checking) void coordinator.host.loadMarkdownTabs().then(async ok => {
        if (!coordinator.isAlive) return;
        if (!ok) new Notice('Markdownタブを確認できませんでした。地図の編集は保存確認まで停止します');
        await coordinator.sync(); this.watchMarkdownGates();
      }); return true;
    } });
    registerMapCommands(command => this.addCommand(command), (id, checking) => {
      const view = this.app.workspace.activeLeaf?.view;
      return view instanceof ThoughtForgeView && view.mapCommand(id, checking);
    }, message => { new Notice(message); });
    // Follow light/dark and theme switches in open maps.
    this.registerEvent(this.app.workspace.on('css-change', () => { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ThoughtForgeView) leaf.view.themeChanged(); }));
    this.registerEvent(this.app.vault.on('modify', file => { void this.coordinators.get(file as TFile)?.sync().then(() => this.watchMarkdownGates()); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      // Queue every observed rename, including files whose maps are closed.
      const renamed = this.draftHost!.rename(file, oldPath, file.path);
      const coordinator = this.coordinators.get(file as TFile);
      coordinator?.rename();
      if (coordinator) for (const view of [...coordinator.clients]) if (view instanceof ThoughtForgeView) void view.renamed(coordinator);
      void renamed.then(() => this.updateDataGate());
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      const coordinator = this.coordinators.get(file as TFile); coordinator?.dispose('deleted'); if (coordinator) this.release(coordinator);
      // Retain drafts for the explicit missing-path recovery list.
    }));
    this.registerEvent(this.app.workspace.on('editor-change', (_editor, view) => {
      if (view.file) this.coordinators.get(view.file)?.refreshState(); this.watchMarkdownGates();
    }));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.watchMarkdownGates()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.watchMarkdownGates()));
    this.registerEvent(this.app.workspace.on('quit', tasks => {
      tasks.addPromise(Promise.allSettled([this.permission!.barrier.control, this.draftStore!.idle(), ...this.finalizers, ...[...this.coordinators.values()].map(c => c.finalizer)]));
    }));
  }
  onExternalSettingsChange(): void {
    if (!this.active || !this.draftHost) return;
    const epoch = ++this.settingsEpoch;
    // Retire visible bodies synchronously, before either Sync read can await.
    for (const modal of this.remainingDraftsModals) modal.invalidate();
    // Capture the notified file now: an already admitted SDK write can otherwise
    // overwrite it before the serialized store reload reaches loadData.
    const queue = sharedDataQueue(this.app), captured = observeDataRead(queue, this.loadData()), previous = queue.observed;
    queue.rejected = undefined; // This new observation has not been handled as a failure.
    queue.observed = Promise.all([previous?.catch(() => null) ?? null, captured]).then(([old, next]) => {
      return mergeDraftDataSources(old, next);
    });
    void queue.observed.catch(() => undefined);
    const observed = queue.observed, lifecycle = this.lifecycle;
    const reload = this.draftHost.externalSettingsChanged(); // signals reload generation before any await
    void reload.then(async ok => { if (ok && this.active && this.lifecycle === lifecycle && queue.observed === observed) queue.observed = undefined;
      if (this.active && this.lifecycle === lifecycle && this.settingsEpoch === epoch) {
        this.settingsReadEpoch = epoch;
        for (const modal of this.remainingDraftsModals) modal.reloadCompleted();
      }
      this.updateDataGate(); for (const c of this.coordinators.values()) for (const view of c.clients) if (view instanceof ThoughtForgeView) await view.restore(); });
  }
  updateDataGate(): void {
    const reason = this.draftStore?.state.dataFailure as HostReasonV2 | undefined;
    for (const c of this.coordinators.values()) c.setPluginDataFailure(reason);
  }
  watchMarkdownGates(): void {
    if (!this.active) return;
    let blocked = false;
    for (const c of this.coordinators.values()) {
      c.refreshState(); if (c.isAlive && (c.writeState === 'waiting-markdown-save' || c.writeState === 'read-only')) blocked = true;
      if ([...c.clients].some(view => view instanceof ThoughtForgeView && view.needsInitialModel)) blocked = true;
    }
    if (!blocked) { if (this.gateTimer) clearTimeout(this.gateTimer); this.gateTimer = undefined; }
    else if (!this.gateTimer) {
      const lifecycle = this.lifecycle;
      this.gateTimer = setTimeout(() => {
        this.gateTimer = undefined; if (!this.active || this.lifecycle !== lifecycle) return;
        // Read only; never load deferred leaves or write on this timer.
        void Promise.allSettled([...this.coordinators.values()].map(async c => { await c.sync(); await Promise.allSettled([...c.clients].map(view => view instanceof ThoughtForgeView ? view.retryInitialModel() : Promise.resolve())); })).then(() => this.watchMarkdownGates());
      }, 1000);
    }
  }
  acquire(file: TFile): FileCoordinatorV2 {
    if (!this.permission) throw Error('edit permission unavailable');
    let coordinator = this.coordinators.get(file);
    if (!coordinator || !coordinator.isAlive) {
      const host = new ObsidianMapHost(this.app, file, () => this.openMarkdown(file), { check: path => this.guard.check(path) },
        () => this.active && !!coordinator?.isAlive && this.app.vault.getAbstractFileByPath(file.path) === file, this.permission);
      coordinator = new FileCoordinatorV2(host); this.coordinators.set(file, coordinator);
      coordinator.setEditPermission(this.isEditingAllowed);
      coordinator.setPluginDataFailure(this.draftStore?.state.dataFailure as HostReasonV2 | undefined);
    }
    return coordinator;
  }
  release(coordinator: FileCoordinatorV2): void {
    if (coordinator.isAlive) return;
    for (const [file, value] of this.coordinators) if (value === coordinator) this.coordinators.delete(file);
    const finalizer = coordinator.finalizer; this.finalizers.add(finalizer);
    void finalizer.finally(() => this.finalizers.delete(finalizer)); this.watchMarkdownGates();
  }
  onunload(): void {
    this.lifecycle++; this.active = false; if (this.gateTimer) clearTimeout(this.gateTimer); this.gateTimer = undefined;
    this.remainingDraftsModals.clear();
    if (this.permission && this.permissionListener) this.permission.barrier.listeners.delete(this.permissionListener);
    this.draftHost?.close();
    for (const c of [...this.coordinators.values()]) { c.dispose('closed'); this.release(c); }
  }
  async openMap(file: TFile, automaticRestore = true): Promise<void> {
    if (!this.active || !markdown(file.path)) return;
    try {
      const leaf = this.app.workspace.getLeaf('split');
      await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      if (!automaticRestore && leaf.view instanceof ThoughtForgeView) await leaf.view.restore(false);
    } catch { new Notice('マップを開けませんでした'); }
  }
  async openLink(message: LinkOpenMessageV2, view: ThoughtForgeView, coordinator: FileCoordinatorV2): Promise<boolean> {
    const generation = view.generation, uri = coordinator.host.uri;
    const live = () => this.active && view.alive && view.generation === generation && coordinator.isAlive && coordinator.host.uri === uri;
    let status: 'opened' | 'unresolved' | 'refused' = 'refused';
    if (live() && !/^[\\/]/.test(message.linktext) && !message.linktext.split('#')[0]!.split(/[\\/]/).includes('..')) {
      if (/^https?:\/\//i.test(message.linktext)) { window.open(message.linktext, '_blank', 'noopener,noreferrer'); status = 'opened'; }
      else if (!/^[a-z][a-z\d+.-]*:/i.test(message.linktext)) {
        const linkpath = message.linktext.split('#')[0]!, file = this.app.metadataCache.getFirstLinkpathDest(linkpath, coordinator.host.path!);
        if (!file || this.app.vault.getAbstractFileByPath(file.path) !== file) status = 'unresolved';
        else if (live()) {
          const leaf = message.openIn === 'new-tab' ? this.app.workspace.getLeaf('tab') : view.leaf;
          const subpath = message.linktext.includes('#') ? message.linktext.slice(message.linktext.indexOf('#')) : '';
          // Anchor belongs to this admitted open, rather than a late mutation of a leaf.
          await leaf.openFile(file, { state: { mode: 'source' }, ...(subpath ? { eState: { subpath } } : {}) });
          status = 'opened';
        }
      }
    }
    if (live()) view.post({ source: 'extension', protocolVersion: 2, documentUri: uri, type: 'thoughtforge.link.open.result', status });
    return status === 'opened';
  }
  async openMarkdown(file: TFile): Promise<WorkspaceLeaf> {
    const leaf = this.app.workspace.getLeaf('split'); await leaf.openFile(file, { state: { mode: 'source' } }); return leaf;
  }
}

class EditPermissionSettings extends PluginSettingTab {
  private renderEpoch = 0;
  constructor(private readonly owner: ThoughtForgePlugin) { super(owner.app, owner); }
  display(): void {
    const epoch = ++this.renderEpoch; this.containerEl.empty();
    this.containerEl.createEl('h2', { text: `このVault：${this.owner.app.vault.getName()}` });
    this.containerEl.createEl('p', { text: this.owner.vaultFolder });
    const status = this.containerEl.createEl('p', { text: this.owner.editPermissionLabel, attr: { role: 'status' } });
    this.containerEl.createEl('p', { text: 'このVaultの既存Markdownと、下書き・表示スタイルの保存を許可します。編集許可はVaultごとに設定します。' });
    this.containerEl.createEl('p', { text: '許可の記録はこのVaultごとに保持します。移動・改名・複製・復元後は、設定で再度許可してください。' });
    new Setting(this.containerEl).addButton(button => button.setButtonText('このVaultで編集を許可').setDisabled(this.owner.permissionBusy).onClick(async () => {
      new GrantPermissionModal(this.owner, async binding => { await this.owner.grantEditing(binding); this.display(); }).open();
    })).addButton(button => button.setButtonText('このVaultの編集許可を取り消す').setDisabled(this.owner.permissionBusy).onClick(async () => {
      // Stop admission synchronously before rendering the processing state.
      const revoke = this.owner.revokeEditing(); status.textContent = PERMISSION_TEXT.revoking; button.setDisabled(true);
      await revoke; this.display();
    }));
    void this.owner.checkEditing().then(() => { if (epoch === this.renderEpoch) status.textContent = this.owner.editPermissionLabel; });
    this.displayKeyChecks();
  }
  private displayKeyChecks(): void {
    const checks = this.owner.mapCommandKeyChecks; if (!checks) return;
    this.containerEl.createEl('h2', { text: 'キー確認' });
    this.containerEl.createEl('p', { text: '地図にフォーカスを置いてキーを試し、結果を手動で記録してください。自動の衝突検出ではありません。割り当てはObsidianの「設定 → ホットキー」で変更できます。' });
    this.containerEl.createEl('p', { text: '代替経路はObsidianのコマンドパレットと地図の右クリックメニューです。接続後に有効になります。現在は地図への実行接続と右クリックへの全操作追加が準備中のため、未接続のコマンドはパレットに表示されません。' });
    this.containerEl.createEl('p', { text: this.owner.isEditingAllowed
      ? '確認記録はこのVaultごとに保存します。環境やキー割り当てを変えたら、再確認してください。'
      : 'このVaultは未許可のため、変更はこの画面の記録だけです。プラグインを再読み込みすると失われ、編集を許可しても自動保存しません。' });
    if (!checks.storageAvailable) this.containerEl.createEl('p', { text: '保存済みのキー確認記録を読み取れません。元の記録を上書きせず、変更はこの画面だけに保持します。', attr: { role: 'status' } });
    let group = '';
    for (const command of MAP_COMMANDS) {
      if (command.group !== group) { group = command.group; this.containerEl.createEl('h3', { text: group }); }
      const key = 'classicKey' in command ? command.classicKey : command.id === 'map-insert-parent'
        ? '未割当（Cmd+Shift+Enterは実機確認まで候補）' : '既定キーなし';
      const setting = new Setting(this.containerEl).setName(command.name)
        .setDesc(`地図内のキー: ${key}。代替（接続後に有効）: コマンドパレット → ThoughtForge: ${command.name} ／ 地図の右クリックメニュー。`);
      const result = setting.settingEl.createEl('span', { attr: { role: 'status' } });
      setting.addDropdown(dropdown => {
        for (const [value, label] of Object.entries(KEY_CHECK_LABELS)) dropdown.addOption(value, label);
        dropdown.setValue(checks.get(command.id)).onChange(async value => {
          dropdown.setDisabled(true); result.textContent = '記録中';
          const saved = await checks.record(command.id, value as KeyCheckStatus);
          dropdown.setDisabled(false);
          result.textContent = saved === 'saved' ? '保存しました' : saved === 'session-only'
            ? 'この画面のみ（永続保存していません）' : '保存できませんでした（この画面のみ保持）';
        });
      });
    }
  }
  hide(): void { this.renderEpoch++; }
}
class GrantPermissionModal extends Modal {
  private live = false;
  constructor(private readonly owner: ThoughtForgePlugin, private readonly grant: (binding: VaultBinding) => Promise<void>) { super(owner.app); }
  onOpen(): void {
    this.live = true;
    const vaultName = this.owner.app.vault.getName(), folder = this.owner.vaultFolder, configDir = this.owner.app.vault.configDir;
    this.contentEl.createEl('p', { text: `${vaultName}で編集を許可しますか？` });
    const allow = this.contentEl.createEl('button', { text: '許可する' }); allow.disabled = true;
    this.contentEl.createEl('button', { text: 'キャンセル' }).onclick = () => this.close();
    // Bind confirmation to the displayed folder; a delayed dialog is not consent
    // to a replaced/moved/renamed Vault or changed configDir.
    void this.owner.inspectEditingTarget().then(binding => {
      if (!this.live) return;
      if (binding.adapterBasePath !== folder || binding.vaultName !== vaultName || binding.configDir !== configDir) throw Error('confirmation changed');
      allow.disabled = false;
      allow.onclick = () => { if (!this.live || allow.disabled) return; allow.disabled = true; void this.grant(binding).finally(() => this.close()); };
    }).catch(() => { if (this.live) this.contentEl.createEl('p', { text: PERMISSION_TEXT.unsafe }); });
  }
  onClose(): void { this.live = false; this.contentEl.empty(); }
}
