import { isThoughtForgeWebviewMessage, type TextDocumentLike, type ThoughtForgeExtensionToWebviewMessage } from "./shared/protocol.js";
import { renderMapFrame } from "./iframe.ts";
import type { HostMessageV2 } from './protocolV2.ts';
import type { DraftSaveResultMessage, DraftRestoreMessage } from './draftTypes.ts';
import { MapCommandClient, type CommandEnvelope } from './mapCommandTransport.ts';

export type FrameEnvelope = { generation: number; baseVersion: number; clipboardRequestId?: string; message?: unknown; obsidianOnly?: "undo" | "redo" | "capability"; inert?: boolean };
export function validEnvelope(value: unknown, generation: number): value is FrameEnvelope {
  if (!value || typeof value !== "object") return false;
  const e = value as FrameEnvelope;
  return e.generation === generation && Number.isInteger(e.baseVersion) && e.baseVersion >= 1 &&
    (e.clipboardRequestId === undefined || (typeof e.clipboardRequestId === "string" && e.clipboardRequestId.length > 0));
}
export class MapSession {
  readonly commands: MapCommandClient;
  readonly iframe: HTMLIFrameElement;
  private port?: MessagePort;
  private timer?: ReturnType<typeof setTimeout>;
  private active = true;
  private ready = false;
  private retiredReason?: string;
  private readonly documentUri: string;
  private boundUri: string;
  constructor(container: HTMLElement, readonly generation: number, document: TextDocumentLike, reason: string | undefined,
    private readonly receive: (envelope: FrameEnvelope) => void,
    private readonly failed: () => void,
    private readonly onReady?: (binding: Readonly<{ generation: number; documentUri: string }>) => void,
    protocolVersion?: 2, theme?: Record<string, string>, commandNotice?: (text: string) => void) {
    this.documentUri = document.uri.toString();
    this.boundUri = this.documentUri;
    this.commands = new MapCommandClient(generation, () => this.boundUri, () => this.active && this.ready && !this.retiredReason,
      envelope => this.postMapCommand(envelope), commandNotice);
    const iframe = container.ownerDocument.createElement("iframe"); this.iframe = iframe;
    iframe.className = "thoughtforge-obsidian-frame"; iframe.title = "ThoughtForge マップ";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.addEventListener("load", () => this.connect(), { once: true });
    iframe.srcdoc = renderMapFrame(document, generation, reason, protocolVersion, theme);
    container.appendChild(iframe);
  }
  get alive(): boolean { return this.active; }
  rebind(uri: string): void { this.commands.invalidate(); if (this.active) this.boundUri = uri; }
  private postMapCommand(envelope: CommandEnvelope): boolean {
    if (!this.active || !this.ready || this.retiredReason || !this.port) return false;
    try { this.port.postMessage(envelope); return true; } catch { this.commands.invalidate(); return false; }
  }
  private connect(): void {
    if (!this.active || !this.iframe.contentWindow) return;
    const channel = new MessageChannel(); this.port = channel.port1;
    const documentUri = this.documentUri;
    this.port.onmessage = (event) => {
      if (this.active && !this.retiredReason && event.data?.generation === this.generation && event.data?.obsidianOnly === 'mapCommand') {
        this.commands.receive(event.data); return;
      }
      if (!this.active || !validEnvelope(event.data, this.generation)) return;
      const e = event.data;
      if (this.retiredReason) {
        // Keep the old DOM and clipboard route, never re-handshake its mutations.
        if ((e.message as { type?: string } | undefined)?.type === 'thoughtforge.clipboard.write') this.receive(e);
        return;
      }
      if (isThoughtForgeWebviewMessage(e.message) && e.message.type === "thoughtforge.webview.ready" && e.message.documentUri === documentUri) {
        this.ready = true; if (this.timer) clearTimeout(this.timer);
        try { this.onReady?.({ generation: this.generation, documentUri: this.boundUri }); }
        catch { this.close(); this.failed(); return; }
      }
      if (!this.active) return;
      this.receive(e);
    };
    this.port.start();
    if (this.retiredReason) this.retire(this.retiredReason);
    if (this.latestTheme) this.port.postMessage({ generation: this.generation, obsidianOnly: "theme", vars: this.latestTheme });
    if (!this.retiredReason) this.timer = setTimeout(() => { if (!this.ready && this.active) { this.close(); this.failed(); } }, 5000);
    // The sandboxed srcdoc frame has an opaque origin, so "*" is required to transfer the port.
    this.iframe.contentWindow.postMessage({ type: "thoughtforge-obsidian.connect", generation: this.generation }, "*", [channel.port2]);
  }
  post(message: ThoughtForgeExtensionToWebviewMessage | HostMessageV2 | DraftSaveResultMessage | DraftRestoreMessage): boolean {
    if (!this.active || !this.port || !this.ready) return false;
    try { this.port.postMessage({ generation: this.generation, message }); return true; }
    catch { return false; }
  }
  clipboardResult(requestId: string, ok: boolean): void {
    if (this.active) this.port?.postMessage({ generation: this.generation, obsidianOnly: "clipboardResult", requestId, ok });
  }
  private latestTheme?: Record<string, string>;
  // A change before the frame connects is kept (latest only) and sent on connect.
  theme(vars: Record<string, string>): void {
    this.latestTheme = vars;
    if (this.active) this.port?.postMessage({ generation: this.generation, obsidianOnly: "theme", vars });
  }
  readOnly(reason: string | undefined): void {
    if (this.active) this.port?.postMessage({ generation: this.generation, obsidianOnly: "readOnly", reason });
  }
  retire(reason: string): void {
    this.commands.invalidate();
    this.retiredReason = reason;
    if (this.timer) clearTimeout(this.timer);
    if (this.active) this.port?.postMessage({ generation: this.generation, obsidianOnly: 'readOnly', reason, retainedInput: true });
  }
  close(): void {
    this.commands.invalidate();
    this.active = false; if (this.timer) clearTimeout(this.timer);
    if (this.port) { this.port.onmessage = null; this.port.close(); }
    this.iframe.remove();
  }
}
