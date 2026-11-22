import {
  FileView,
  MarkdownView,
  Notice,
  Scope,
  type TFile,
  type WorkspaceLeaf,
} from 'obsidian';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ResolvedThemeMode } from '../core/layout/theme';
import type { ParseResult, TopicLink } from '../core/model';
import { parseMarkdownToMap } from '../core/parser';
import type { SemanticCommand } from '../core/patch/commands';
import type { Messages } from '../i18n';
import type { CommandDispatchOutcome, SyncRejectCode } from '../sync/ports';
import { MindMapApp } from '../ui/App';
import type ThoughtForgePlugin from '../main';
import {
  isStaleAsyncViewUpdate,
  shouldSkipReloadRender,
  shouldTriggerScopeF2,
  type RenderedFileSnapshot,
} from './viewGuard';

export const MINDMAP_VIEW_TYPE = 'thoughtforge-mindmap-view';

function formatRejectMessage(
  messages: Messages,
  rejectCode: SyncRejectCode | undefined,
  fallbackReason: string | undefined,
): string {
  switch (rejectCode) {
    case 'read-only-document':
      return messages.edit.readOnlyRejected;
    case 'stale-target':
      return messages.edit.staleTarget;
    case 'newline-in-title':
      return messages.edit.newlineRejected;
    case 'empty-title':
      return messages.edit.emptyTitleRejected;
    case 'block-syntax-in-title':
      return messages.edit.blockSyntaxInTitleRejected;
    case 'cannot-insert-sibling-for-root':
      return messages.edit.rootSiblingRejected;
    case 'editor-dirty':
      return messages.edit.editorDirty;
    case 'editor-state-unknown':
      return messages.edit.editorUnknown;
    case 'blocked-document':
      return messages.edit.blockedDocument;
    case 'unsupported-command':
      return messages.edit.unsupportedCommand;
    case 'io-error':
      return messages.edit.ioError;
    case 'invariant-check-failed':
    case 'invalid-note-block-syntax':
    case 'heading-level-out-of-range':
    case 'mixed-heading-list-conversion':
    case 'indent-sensitive-unmapped-block':
    case 'unmapped-delete-requires-confirmation':
    case 'cannot-promote-with-note-or-unmapped':
      return messages.edit.invariantRejected;
    default:
      return fallbackReason ?? messages.edit.invariantRejected;
  }
}

function isSafeExternalUrl(rawTarget: string): string | null {
  try {
    const parsed = new URL(rawTarget);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function isSafeVaultLinkPath(rawTarget: string): boolean {
  if (rawTarget.length === 0) return false;
  if (/^[\\/]/.test(rawTarget)) return false;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawTarget)) return false;
  const pathPart = rawTarget.split('#')[0] ?? '';
  const segments = pathPart.split(/[\\/]/);
  return !segments.includes('..');
}

function isEditableDomTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const candidate = target as {
    readonly tagName?: unknown;
    readonly isContentEditable?: unknown;
  };
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.tagName !== 'string') return false;
  const tag = candidate.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isNodeInsideContainer(container: HTMLElement, target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false;
  if (target instanceof Node) {
    return container.contains(target);
  }
  const maybeNode = target as { readonly nodeType?: unknown; readonly parentNode?: unknown };
  if (typeof maybeNode.nodeType !== 'number') {
    return false;
  }
  let cursor: unknown = maybeNode;
  while (typeof cursor === 'object' && cursor !== null) {
    if (cursor === container) return true;
    cursor = (cursor as { readonly parentNode?: unknown }).parentNode;
  }
  return false;
}

export class MindMapView extends FileView {
  private reactRoot: Root | null = null;
  private parseResult: ParseResult | null = null;
  private lastRenderedSnapshot: RenderedFileSnapshot | null = null;
  private loadSequence = 0;
  private editSelectedTrigger: (() => boolean) | null = null;
  private readonly registerEditSelectedTrigger = (trigger: (() => boolean) | null): void => {
    this.editSelectedTrigger = trigger;
  };

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ThoughtForgePlugin,
  ) {
    super(leaf);
    // Register a view-local Scope so F2 opens inline topic editing when this
    // MindMapView is active instead of being intercepted by Obsidian's global
    // "Edit file title" hotkey.
    this.scope = new Scope(this.plugin.app.scope);
    this.scope.register([], 'F2', (evt) => {
      const ownerDoc = this.contentEl.ownerDocument;
      const activeEl = ownerDoc.activeElement;
      const shouldHandle = shouldTriggerScopeF2(evt, {
        targetIsEditable: isEditableDomTarget(evt.target),
        activeElementIsEditable: isEditableDomTarget(activeEl),
        targetInsideMap: isNodeInsideContainer(this.contentEl, evt.target),
        activeElementInsideMap: isNodeInsideContainer(this.contentEl, activeEl),
        activeElementIsBody: activeEl === null || activeEl === ownerDoc.body,
      });
      if (!shouldHandle) {
        return undefined;
      }
      if (this.editSelectedTrigger !== null && this.editSelectedTrigger()) {
        return false;
      }
      return undefined;
    });
  }

  getViewType(): string {
    return MINDMAP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? this.plugin.messages.pluginName;
  }

  getIcon(): string {
    return 'git-fork';
  }

  canAcceptExtension(extension: string): boolean {
    return extension.toLowerCase() === 'md';
  }

  async onLoadFile(file: TFile): Promise<void> {
    await this.reloadFromFile(file);
  }

  async reloadFromFile(file: TFile): Promise<void> {
    const seq = ++this.loadSequence;
    const rawText = await this.app.vault.read(file);
    if (isStaleAsyncViewUpdate(file.path, seq, this.file?.path, this.loadSequence)) {
      return;
    }
    if (
      this.parseResult !== null &&
      shouldSkipReloadRender(this.lastRenderedSnapshot, file.path, file.basename, rawText)
    ) {
      return;
    }
    this.parseResult = parseMarkdownToMap(rawText, file.basename);
    this.lastRenderedSnapshot = {
      path: file.path,
      basename: file.basename,
      rawText,
    };
    this.renderApp();
  }

  private async dispatchCommand(command: SemanticCommand): Promise<CommandDispatchOutcome> {
    const file = this.file;
    if (!file) {
      return { accepted: false, rejectCode: 'io-error', reason: 'No active file.' };
    }

    const targetPath = file.path;
    const targetBasename = file.basename;
    const seq = this.loadSequence;

    const outcome = await this.plugin
      .getFileCoordinator()
      .dispatchForFile(targetPath, targetBasename, command);

    if (isStaleAsyncViewUpdate(targetPath, seq, this.file?.path, this.loadSequence)) {
      return outcome;
    }

    if (outcome.accepted && outcome.nextDocument !== undefined) {
      this.parseResult = { status: 'ok', document: outcome.nextDocument };
      this.lastRenderedSnapshot =
        outcome.nextRawText !== undefined
          ? { path: targetPath, basename: targetBasename, rawText: outcome.nextRawText }
          : null;
      this.renderApp();
    } else if (!outcome.accepted) {
      new Notice(formatRejectMessage(this.plugin.messages, outcome.rejectCode, outcome.reason));
      if (outcome.rejectCode === 'stale-target') {
        void this.reloadFromFile(file);
      }
    }

    return outcome;
  }

  refreshAppearance(): void {
    this.renderApp();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
    this.lastRenderedSnapshot = null;
    this.editSelectedTrigger = null;
    this.unmountReact();
  }

  async onClose(): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
    this.lastRenderedSnapshot = null;
    this.editSelectedTrigger = null;
    this.unmountReact();
  }

  private resolveThemeMode(): ResolvedThemeMode {
    const mode = this.plugin.mindMapSettings.themeMode;
    if (mode === 'light' || mode === 'dark-solarized') {
      return mode;
    }
    const isDark = this.contentEl.ownerDocument.body.classList.contains('theme-dark');
    return isDark ? 'dark-solarized' : 'light';
  }

  private renderApp(): void {
    if (!this.parseResult) return;
    if (!this.reactRoot) {
      this.contentEl.empty();
      this.contentEl.addClass('ito-view-container');
      this.reactRoot = createRoot(this.contentEl);
    }

    this.reactRoot.render(
      createElement(MindMapApp, {
        filePath: this.file?.path ?? '',
        parseResult: this.parseResult,
        themeMode: this.resolveThemeMode(),
        rainbowBranches: this.plugin.mindMapSettings.rainbowBranches,
        imeGuardWindowMs: this.plugin.mindMapSettings.imeGuardWindowMs,
        messages: this.plugin.messages,
        onOpenMarkdown: (line?: number) => {
          void this.openMarkdownAtLine(line);
        },
        onOpenLink: (link: TopicLink, newTab: boolean) => {
          void this.handleOpenLink(link, newTab);
        },
        onDispatchCommand: (command: SemanticCommand) => this.dispatchCommand(command),
        onRegisterEditSelectedTrigger: this.registerEditSelectedTrigger,
        onNotify: (message: string) => {
          new Notice(message, 15000);
        },
      }),
    );
  }

  private unmountReact(): void {
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    this.contentEl.empty();
  }

  private async openMarkdownAtLine(line?: number): Promise<void> {
    const file = this.file;
    if (!file) return;

    const existingMarkdownLeaf = this.app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    const targetLeaf = existingMarkdownLeaf ?? this.app.workspace.getLeaf('split');
    await targetLeaf.openFile(file);
    this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

    if (line !== undefined && targetLeaf.view instanceof MarkdownView) {
      const clampedLine = Math.max(0, Math.min(line, targetLeaf.view.editor.lastLine()));
      targetLeaf.view.editor.setCursor({ line: clampedLine, ch: 0 });
      targetLeaf.view.editor.scrollIntoView(
        {
          from: { line: clampedLine, ch: 0 },
          to: { line: clampedLine, ch: 0 },
        },
        true,
      );
    }
  }

  private async handleOpenLink(link: TopicLink, newTab: boolean): Promise<void> {
    const sourceFile = this.file;
    if (!sourceFile) return;

    const safeExternal = isSafeExternalUrl(link.target);
    if (safeExternal !== null) {
      window.open(safeExternal, '_blank', 'noopener,noreferrer');
      return;
    }

    if (!isSafeVaultLinkPath(link.target)) {
      new Notice(this.plugin.messages.notices.unsafeLinkBlocked);
      return;
    }

    const linkPathOnly = link.target.split('#')[0] ?? '';
    if (linkPathOnly.length > 0) {
      const destination = this.app.metadataCache.getFirstLinkpathDest(
        linkPathOnly,
        sourceFile.path,
      );
      if (!destination) {
        new Notice(this.plugin.messages.notices.noteNotFound);
        return;
      }
    }

    await this.app.workspace.openLinkText(link.target, sourceFile.path, newTab);
  }
}
