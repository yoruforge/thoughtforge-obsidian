import { MarkdownView, Notice, type App, type TFile, type WorkspaceLeaf } from "obsidian";
import type { SourceRange } from "@thoughtforge/core";
import { mapUri, type MapHost, type PreflightResult } from "./host.ts";
import type { WriteTargetGuard } from "./writeTargetGuard.ts";
import { inspectMarkdown, loadDeferredMarkdown, type MarkdownState } from './markdownGate.ts';

import { PERMISSION_TEXT, type EditPermission } from './editPermission.ts';

export class ConflictError extends Error {}
export class ObsidianMapHost implements MapHost {
  get uri(): string { return mapUri(this.file.path); }
  get path(): string { return this.file.path; }
  constructor(
    private readonly app: App,
    readonly file: TFile,
    private readonly openMarkdown: () => Promise<WorkspaceLeaf>,
    private readonly guard: Pick<WriteTargetGuard, "check">,
    private readonly isActive: () => boolean,
    private readonly permission: EditPermission
  ) {}
  read(): Promise<string> { return this.app.vault.read(this.file); }
  async preflight(): Promise<PreflightResult> {
    // Permission is a transient coordinator gate, not a sticky target failure.
    if (!this.permission || !await this.permission.check()) return { kind: 'permission-denied', reason: this.permission?.message ?? PERMISSION_TEXT.unpermitted };
    return this.guard.check(this.file.path);
  }
  hasPendingMarkdown(savedText: string): boolean {
    return this.markdownState(savedText) !== 'match';
  }
  markdownState(savedText: string): MarkdownState {
    return inspectMarkdown(this.app.workspace, this.file, savedText, (view): view is MarkdownView => view instanceof MarkdownView);
  }
  async loadMarkdownTabs(): Promise<boolean> {
    const path = this.file.path;
    return loadDeferredMarkdown(this.app.workspace, this.file, () => this.isActive() && this.file.path === path &&
      this.app.vault.getAbstractFileByPath(path) === this.file);
  }
  async compareAndSwap(expected: string, next: string, valid: (current?: string) => boolean = () => true): Promise<boolean> {
    if (!this.permission) return false;
    const permission = this.permission, token = permission.capture();
    const expectedPath = this.file.path;
    const active = (current?: string) => permission.isCurrent(token) && this.isActive() && valid(current) && this.file.path === expectedPath &&
      this.app.vault.getAbstractFileByPath(expectedPath) === this.file;
    if (!active() || !await permission.check(token) || this.hasPendingMarkdown(expected) || await this.preflight() || !active()) return false;
    try {
      const process = async () => {
        try { await this.app.vault.process(this.file, (current) => {
        // Returning current still permits a disk write. Throw to abort process.
        if (!active(current) || current !== expected || this.hasPendingMarkdown(current)) throw new ConflictError();
        return next;
        }); return true; }
        catch (error) { if (error instanceof ConflictError) return false; throw error; }
      };
      return await permission.run(token, process);
    } catch (error) {
      if (error instanceof ConflictError) return false;
      throw error;
    }
  }
  async readClipboard(): Promise<string> { return navigator.clipboard.readText(); }
  async writeClipboard(text: string): Promise<void> { await navigator.clipboard.writeText(text); }
  async openVaultLink(title: string): Promise<void> {
    if (/^[a-z][a-z\d+.-]*:/i.test(title) || /^[\\/]/.test(title) || title.includes("..")) {
      this.notify("PoC-0では外部URL・絶対パス・親フォルダへのリンクを開きません"); return;
    }
    const destination = this.app.metadataCache.getFirstLinkpathDest(title, this.file.path);
    if (!destination || this.app.vault.getAbstractFileByPath(destination.path) !== destination) {
      this.notify("ノートが見つかりません（PoC-0では作りません）"); return;
    }
    const leaf = await this.openMarkdown();
    if (this.isActive()) await leaf.openFile(destination, { state: { mode: "source" } });
  }
  async revealSource(range: SourceRange, bindingLive: () => boolean = () => true): Promise<void> {
    const uri = this.uri;
    if (!this.isActive() || !bindingLive()) return;
    const leaf = await this.openMarkdown();
    if (this.isActive() && this.uri === uri && bindingLive() && leaf.view instanceof MarkdownView) {
      const start = { line: range.start.line - 1, ch: range.start.column - 1 };
      const end = { line: range.end.line - 1, ch: range.end.column - 1 };
      leaf.view.editor.setSelection(start, end);
      leaf.view.editor.scrollIntoView({ from: start, to: end }, true);
    }
  }
  notify(message: string): void { new Notice(message); }
}
