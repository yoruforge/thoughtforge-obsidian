import { applyTextPatches, type TextPatch, type ThoughtMap } from "@thoughtforge/core";
import { applyThoughtForgeCommandToDocument } from "./shared/commandApply.js";
import { parseDocumentForWebviewSync } from "./shared/documentSync.js";
import {
  createCommandResultMessage,
  createModelUpdateMessage,
  createParseErrorMessage,
  createSettingsUpdateMessage,
  isThoughtForgeWebviewMessage,
  type TextDocumentLike,
  type ThoughtForgeExtensionToWebviewMessage
} from "./shared/protocol.js";
import { editableLineEndings, toLf, type MapHost } from "./host.ts";
export { FileCoordinatorV2, type MapClientV2 } from './coordinatorV2.ts';

type HistoryEntry = Readonly<{ before: string; after: string }>;
class PatchRange {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  constructor(
    startLine: number, startColumn: number, endLine: number, endColumn: number
  ) {
    this.startLine = startLine; this.startColumn = startColumn;
    this.endLine = endLine; this.endColumn = endColumn;
  }
}
class PatchEdit {
  readonly patches: TextPatch[] = [];
  replace(_uri: unknown, range: unknown, text: string): void {
    if (!(range instanceof PatchRange)) throw new Error("Invalid patch range");
    this.patches.push({ range: {
      start: { line: range.startLine + 1, column: range.startColumn + 1 },
      end: { line: range.endLine + 1, column: range.endColumn + 1 }
    }, text });
  }
}

export interface MapClient {
  readonly alive: boolean;
  readonly generation: number;
  post(message: ThoughtForgeExtensionToWebviewMessage): void;
  readOnly(reason: string | undefined): void;
  rebuild(reason: string): void;
  close(): void;
}
type Ticket = Readonly<{ file: object; path: string; lifetime: number; epoch: number; client?: MapClient; generation?: number }>;
type SnapshotKey = Readonly<{ version: number; uri: string; reason?: string; generation?: number }>;

// One instance per TFile, owned by the plugin, including one write/read queue
// and raw history for every view of that file. MapBridge is kept as an alias
// for host-independent consumers of the original PoC test boundary.
export class FileCoordinator {
  private text: string;
  private initialized: boolean;
  private version = 1;
  private epoch = 1;
  private lifetime = 1;
  private lastValidMap?: ThoughtMap;
  private parsed?: { text: string; version: number; uri: string; recovery?: ThoughtMap;
    result: ReturnType<typeof parseDocumentForWebviewSync> };
  private readonly snapshots = new WeakMap<MapClient, SnapshotKey>();
  private callbackSnapshot?: SnapshotKey;
  private queue: Promise<unknown> = Promise.resolve();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private alive = true;
  private stickyReason?: string;
  private permissionReason?: string;
  private currentReason?: string;
  readonly clients = new Set<MapClient>();
  readonly host: MapHost;
  private readonly post?: (message: ThoughtForgeExtensionToWebviewMessage) => void;
  constructor(host: MapHost, initialText?: string,
    post?: (message: ThoughtForgeExtensionToWebviewMessage) => void) {
    this.host = host; this.post = post;
    this.text = initialText ?? ""; this.initialized = initialText !== undefined;
  }
  get document(): TextDocumentLike {
    const text = this.text, version = this.version, uri = this.host.uri;
    return Object.freeze({ uri: { toString: () => uri }, version, getText: () => text });
  }
  get readOnlyReason(): string | undefined { return this.currentReason; }
  get isAlive(): boolean { return this.alive; }
  get finalizer(): Promise<unknown> { return this.queue; }
  private capture(client?: MapClient): Ticket {
    return Object.freeze({ file: this.host.file ?? this.host, path: this.host.path ?? this.host.uri,
      lifetime: this.lifetime, epoch: this.epoch, client, generation: client?.generation });
  }
  private live(t: Ticket): boolean {
    return this.alive && t.lifetime === this.lifetime && t.file === (this.host.file ?? this.host) &&
      t.path === (this.host.path ?? this.host.uri) && (!t.client ||
      (this.clients.has(t.client) && t.client.alive && t.client.generation === t.generation));
  }
  private valid(t: Ticket): boolean { return this.live(t) && t.epoch === this.epoch; }
  attach(client: MapClient): void { this.clients.add(client); }
  detach(client: MapClient): void {
    this.clients.delete(client);
    if (!this.clients.size) this.dispose();
  }
  dispose(closeViews = false): void {
    this.alive = false; this.epoch++; this.lifetime++;
    this.undoStack = []; this.redoStack = [];
    if (closeViews) for (const client of [...this.clients]) client.close();
    this.clients.clear();
  }
  rename(): void {
    this.epoch++; this.lifetime++; this.undoStack = []; this.redoStack = [];
    for (const client of this.clients) client.rebuild("名前の変更");
    void this.sync();
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run); this.queue = next.catch(() => undefined); return next;
  }
  private async read(t: Ticket): Promise<string | undefined> {
    if (!this.valid(t)) return undefined;
    const next = await this.host.read();
    return this.valid(t) ? next : undefined;
  }
  private adopt(next: string, external: boolean, deferRebuild = false): boolean {
    if (next === this.text && this.initialized) return false;
    const wasInitialized = this.initialized;
    this.text = next; this.initialized = true; this.version++;
    if (external && wasInitialized) {
      this.epoch++; this.undoStack = []; this.redoStack = [];
      if (!deferRebuild) this.commitReadOnly("外部の変更");
      return true;
    }
    return false;
  }
  private send(message: ThoughtForgeExtensionToWebviewMessage, client?: MapClient): void {
    if (!this.alive) return;
    if (client) { if (client.alive && this.clients.has(client)) client.post(message); }
    else this.post?.(message);
  }
  private computeReason(): string | undefined {
    if (this.permissionReason) return this.permissionReason;
    if (this.stickyReason) return this.stickyReason;
    if (!editableLineEndings(this.text)) return "改行が混在しているか単独CRがあるため、地図は表示のみです";
    if (this.host.hasPendingMarkdown(this.text)) return "Markdownに未保存の変更がある、またはエディタを確認できません";
    if (!this.parseSnapshot().validation.ok) return "Markdownを地図として読み取れないため、地図は表示のみです";
    return undefined;
  }
  private parseSnapshot(): ReturnType<typeof parseDocumentForWebviewSync> {
    const uri = this.host.uri;
    if (this.parsed?.text === this.text && this.parsed.version === this.version &&
      this.parsed.uri === uri && this.parsed.recovery === this.lastValidMap) return this.parsed.result;
    const result = parseDocumentForWebviewSync(this.document, this.lastValidMap);
    this.parsed = { text: this.text, version: this.version, uri, recovery: this.lastValidMap, result };
    return result;
  }
  refreshReadOnly(): void {
    this.commitReadOnly();
  }
  private commitReadOnly(rebuildReason?: string): void {
    if (!this.alive) return;
    const batch = this.capture();
    const reason = this.computeReason(), previous = this.currentReason;
    if (!this.valid(batch)) return;
    // Host rejection state is committed before any child notification/focus.
    this.currentReason = reason;
    if (rebuildReason || reason !== previous) for (const client of [...this.clients]) {
      if (!this.valid(batch) || this.currentReason !== reason) break;
      const t = this.capture(client);
      if (!this.valid(t) || this.currentReason !== reason) continue;
      if (reason !== previous) client.readOnly(reason);
      // A readOnly callback may synchronously close/rebuild a view or lock the host.
      if (this.valid(t) && this.currentReason === reason)
        client.rebuild(rebuildReason ?? (reason ? "読み取り専用への移行" : "読み取り専用の解除"));
    }
  }
  lock(reason: string): void { this.stickyReason = reason; this.refreshReadOnly(); }
  private async preflight(t: Ticket): Promise<boolean> {
    if (!this.valid(t)) return false;
    const reason = await this.host.preflight?.();
    if (!this.valid(t)) return false;
    if (typeof reason === 'string') this.stickyReason = reason;
    this.permissionReason = typeof reason === 'object' ? reason.reason : undefined;
    this.commitReadOnly();
    return this.valid(t) && !this.currentReason;
  }
  private postSnapshot(client?: MapClient, force = true): void {
    if (!this.alive) return;
    const key = { version: this.version, uri: this.host.uri, reason: this.currentReason, generation: client?.generation };
    const previous = client ? this.snapshots.get(client) : this.callbackSnapshot;
    if (!force && previous && previous.version === key.version && previous.uri === key.uri &&
      previous.reason === key.reason && previous.generation === key.generation) return;
    const result = this.parseSnapshot();
    if (result.validation.ok) {
      this.lastValidMap = result.map;
      // Successful parsing does not use recovery; retain the result for its new recovery basis.
      this.parsed!.recovery = this.lastValidMap;
    }
    const t = this.capture(client);
    this.send(createSettingsUpdateMessage({ readOnly: !!this.currentReason, keymapMode: "classic", debugTrace: false }), client);
    if (!this.valid(t)) return;
    client?.readOnly(this.currentReason);
    if (!this.valid(t) || this.currentReason !== key.reason) return;
    this.send(createModelUpdateMessage(this.document, result.map), client);
    if (!this.valid(t) || this.currentReason !== key.reason) return;
    if (!result.validation.ok) this.send(createParseErrorMessage(this.document, result.validation.issues), client);
    if (this.valid(t) && this.currentReason === key.reason) {
      if (client) this.snapshots.set(client, key); else this.callbackSnapshot = key;
    }
  }
  sync(client?: MapClient): Promise<void> {
    const t = this.capture(client);
    return this.enqueue(async () => {
      // Only background modify reads may follow a prior adoption's epoch. A
      // rename/close/identity change and all client intentions keep strict tickets.
      if (!this.live(t)) return;
      const readTicket = client ? t : this.capture();
      try {
        const next = await this.read(readTicket); if (next === undefined) return;
        // An asynchronous guard failure must not leave adopted, unpublished bytes.
        const reason = await this.host.preflight?.();
        if (!this.valid(readTicket)) return;
        if (typeof reason === 'string') this.stickyReason = reason;
        this.permissionReason = typeof reason === 'object' ? reason.reason : undefined;
        const external = this.adopt(next, true, true);
        const current = this.capture(client);
        this.commitReadOnly(external ? "外部の変更" : undefined);
        if (!this.valid(current)) return;
        if (!this.alive || (client && !client.alive)) return;
        if (client) this.postSnapshot(client);
        else { this.postSnapshot(undefined, false); for (const c of this.clients) this.postSnapshot(c, false); }
      } catch { if (this.valid(readTicket)) this.host.notify("地図を読み込めませんでした。ファイルの状態を確認してください"); }
    });
  }
  private async write(t: Ticket, before: string, after: string): Promise<boolean> {
    if (!await this.preflight(t)) return false;
    return this.host.compareAndSwap(before, after, () => this.valid(t) && !this.computeReason());
  }
  private publishSuccess(client?: MapClient): void {
    for (const other of this.clients) if (other !== client) { other.rebuild("他の地図の編集"); this.postSnapshot(other); }
    this.postSnapshot(client);
  }
  private async rejectRefresh(t: Ticket): Promise<void> {
    const next = await this.read(t); if (next === undefined) return;
    this.adopt(next, true);
    await this.preflight(this.capture(t.client));
    if (!this.alive) return;
    this.refreshReadOnly();
    if (this.valid(t)) t.client?.rebuild("書き込みの拒否");
    this.postSnapshot(); for (const client of this.clients) this.postSnapshot(client);
  }
  handleMessage(value: unknown, baseVersion: number, client?: MapClient): Promise<boolean> {
    if (!isThoughtForgeWebviewMessage(value) || value.documentUri !== this.host.uri) return Promise.resolve(false);
    const t = this.capture(client);
    if (value.type === "thoughtforge.webview.ready") return this.sync(client).then(() => this.alive);
    return this.enqueue(async () => {
      if (!this.valid(t)) return false;
      try {
        if (value.type === "thoughtforge.clipboard.write") { await this.host.writeClipboard(value.text); return true; }
        if (value.type === "thoughtforge.markdown-link.open") { await this.host.openVaultLink(value.title); return true; }
        if (value.type === "thoughtforge.source.reveal") { await this.host.revealSource(value.range); return true; }
      } catch { if (this.valid(t)) this.host.notify("コピー・リンク・ソース表示を完了できませんでした"); return false; }
      if (value.type !== "thoughtforge.command" || !value.requestId) return false;
      let reason: "apply-rejected" | "validation-failed" | "unexpected-error" = "apply-rejected", applied = false;
      try {
        const before = this.text;
        const current = await this.read(t);
        if (current !== undefined && current !== before) this.adopt(current, true);
        if (this.valid(t) && current === before && baseVersion === this.version && await this.preflight(t)) {
          const snapshot = this.document, normalized = toLf(before);
          const result = await applyThoughtForgeCommandToDocument(Object.freeze({ ...snapshot, getText: () => normalized }), value.command, {
            Range: PatchRange, WorkspaceEdit: PatchEdit, workspace: { applyEdit: async (edit) => {
              if (!(edit instanceof PatchEdit) || !this.valid(t)) return false;
              const patched = applyTextPatches(normalized, edit.patches);
              const after = before.includes("\r\n") ? patched.replace(/\n/g, "\r\n") : patched;
              if (!await this.write(t, before, after)) return false;
              if (!this.valid(t)) return false;
              if (after !== before) {
                this.undoStack.push(Object.freeze({ before, after }));
                if (this.undoStack.length > 100) this.undoStack.shift();
                this.redoStack = []; this.adopt(after, false);
              }
              return true;
            } }
          });
          applied = result.applied; reason = result.failureReason ?? "validation-failed";
        }
      } catch { reason = "unexpected-error"; }
      if (this.valid(t)) {
        this.send(applied ? createCommandResultMessage(this.document, value.requestId, "applied") : createCommandResultMessage(this.document, value.requestId, "rejected", reason), client);
        // Result -> confirming model -> later history model on the same port.
        if (applied) this.publishSuccess(client);
        else {
          this.host.notify("地図の編集を保存できませんでした。未保存変更・外部変更・保存先を確認してください");
          await this.rejectRefresh(t);
        }
      }
      return true;
    });
  }
  history(action: "undo" | "redo", _baseVersion: number, client?: MapClient): Promise<boolean> {
    const t = this.capture(client);
    return this.enqueue(async () => {
      if (!this.valid(t)) return false;
      const stack = action === "undo" ? this.undoStack : this.redoStack, entry = stack.at(-1);
      if (!entry) { this.host.notify("地図のUndo/Redo履歴がありません"); return false; }
      const expected = action === "undo" ? entry.after : entry.before, next = action === "undo" ? entry.before : entry.after;
      try {
        const current = await this.read(t);
        if (current === undefined) return false;
        if (current !== this.text) this.adopt(current, true);
        if (!this.valid(t)) { this.host.notify("外部の変更によりUndo/Redoの依頼が失効しました"); return false; }
        // History authenticates lifetime/epoch/raw stack/CAS, not command version.
        if (this.text !== expected || !await this.write(t, expected, next)) {
          if (this.valid(t)) await this.rejectRefresh(t);
          this.host.notify("未保存変更・外部変更・保存先のためUndo/Redoを適用できません"); return false;
        }
        if (!this.valid(t)) return false;
        stack.pop(); (action === "undo" ? this.redoStack : this.undoStack).push(entry);
        this.adopt(next, false); this.publishSuccess(client); return true;
      } catch {
        if (this.valid(t)) this.host.notify("地図のUndo/Redoを完了できませんでした"); return false;
      }
    });
  }
}
export { FileCoordinator as MapBridge };
