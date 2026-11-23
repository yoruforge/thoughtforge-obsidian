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
import { MindMapApp, type MindMapActionTriggers } from '../ui/App';
import { isInsideMapPopover } from '../ui/keyboardGuard';
import type ThoughtForgePlugin from '../main';
import { promptConfirmDeleteBranch } from './ConfirmModal';
import {
  isStaleAsyncViewUpdate,
  shouldSkipReloadRender,
  shouldTriggerMindMapScopeShortcut,
  shouldTriggerScopeInlineSplit,
  type RenderedFileSnapshot,
} from './viewGuard';

export const MINDMAP_VIEW_TYPE = 'thoughtforge-mindmap-view';

function formatRejectMessage(
  messages: Messages,
  rejectCode: SyncRejectCode | undefined,
  fallbackReason: string | undefined,
  isHistoryAction = false,
): string {
  switch (rejectCode) {
    case 'read-only-document':
      return messages.edit.readOnlyRejected;
    case 'stale-target':
      return isHistoryAction ? messages.edit.undoStale : messages.edit.staleTarget;
    case 'newline-in-title':
      return messages.edit.newlineRejected;
    case 'empty-title':
      return messages.edit.emptyTitleRejected;
    case 'block-syntax-in-title':
      return messages.edit.blockSyntaxInTitleRejected;
    case 'cannot-insert-sibling-for-root':
      return messages.edit.rootSiblingRejected;
    case 'cannot-modify-root':
      return messages.edit.cannotModifyRoot;
    case 'not-a-task':
      return messages.edit.notATask;
    case 'heading-level-out-of-range':
      return messages.edit.headingLevelOutOfRange;
    case 'mixed-heading-list-conversion':
      return messages.edit.mixedHeadingListRejected;
    case 'indent-sensitive-unmapped-block':
      return messages.edit.indentSensitiveRejected;
    case 'cannot-promote-with-note-or-unmapped':
      return messages.edit.cannotPromoteWithNoteOrUnmapped;
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
    case 'unmapped-delete-requires-confirmation':
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

function hasCssClass(target: unknown, className: string): boolean {
  if (typeof target !== 'object' || target === null) return false;
  const candidate = target as { readonly classList?: { readonly contains?: (cls: string) => boolean } };
  return typeof candidate.classList?.contains === 'function' && candidate.classList.contains(className);
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
  private actionTriggers: MindMapActionTriggers | null = null;
  private readonly registerActionTriggers = (triggers: MindMapActionTriggers | null): void => {
    this.actionTriggers = triggers;
  };

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ThoughtForgePlugin,
  ) {
    super(leaf);
    // Register a view-local Scope so F2 and Undo/Redo are handled by MindMapView
    // when active on the canvas without colliding with Obsidian's global hotkeys
    // or interfering with native editing inside text inputs.
    this.scope = new Scope(this.plugin.app.scope);
    this.scope.register([], 'F2', (evt) => {
      if (!this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.editSelected() ? false : undefined;
    });
    this.scope.register(['Mod'], 'z', (evt) => {
      if (evt.shiftKey || !this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.undo() ? false : undefined;
    });
    this.scope.register(['Mod', 'Shift'], 'z', (evt) => {
      if (!this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.redo() ? false : undefined;
    });
    this.scope.register(['Ctrl'], 'y', (evt) => {
      if (evt.metaKey || evt.shiftKey || !this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.redo() ? false : undefined;
    });
    this.scope.register(['Mod'], 'Enter', (evt) => {
      if (evt.shiftKey || evt.altKey) return undefined;
      const activeEl = this.contentEl.ownerDocument.activeElement;
      const activeIsInlineEditor =
        hasCssClass(activeEl, 'ito-inline-editor') &&
        isNodeInsideContainer(this.contentEl, activeEl);
      if (shouldTriggerScopeInlineSplit(evt, activeIsInlineEditor)) {
        return this.actionTriggers?.splitEditing(evt) ? false : undefined;
      }
      if (!this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.editSelected() ? false : undefined;
    });
    this.scope.register(['Mod', 'Shift'], '0', (evt) => {
      if (evt.altKey || !this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.fitSelection() ? false : undefined;
    });
  }

  private canHandleScopeShortcut(evt: KeyboardEvent): boolean {
    const ownerDoc = this.contentEl.ownerDocument;
    const activeEl = ownerDoc.activeElement;
    return shouldTriggerMindMapScopeShortcut(evt, {
      targetIsEditable: isEditableDomTarget(evt.target),
      activeElementIsEditable: isEditableDomTarget(activeEl),
      targetInsidePopover: isInsideMapPopover(evt.target),
      activeElementInsidePopover: isInsideMapPopover(activeEl),
      targetInsideMap: isNodeInsideContainer(this.contentEl, evt.target),
      activeElementInsideMap: isNodeInsideContainer(this.contentEl, activeEl),
      activeElementIsBody: activeEl === null || activeEl === ownerDoc.body,
    });
  }

  triggerUndo(): void {
    this.actionTriggers?.undo();
  }

  triggerRedo(): void {
    this.actionTriggers?.redo();
  }

  triggerToggleSelectedTask(): void {
    this.actionTriggers?.toggleSelectedTask();
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

    if (
      !outcome.accepted &&
      outcome.rejectCode === 'unmapped-delete-requires-confirmation' &&
      command.type === 'deleteBranch' &&
      command.confirmedUnmapped !== true
    ) {
      const confirmed = await promptConfirmDeleteBranch(this.app, {
        title: this.plugin.messages.edit.unmappedDeleteConfirmTitle,
        body: this.plugin.messages.edit.unmappedDeleteConfirmBody,
        cancelLabel: this.plugin.messages.edit.unmappedDeleteConfirmCancel,
        confirmLabel: this.plugin.messages.edit.unmappedDeleteConfirmDelete,
      });
      if (!confirmed) {
        return { accepted: false, rejectCode: 'boundary-no-op', reason: 'Deletion cancelled.' };
      }
      if (isStaleAsyncViewUpdate(targetPath, seq, this.file?.path, this.loadSequence)) {
        return { accepted: false, rejectCode: 'stale-target', reason: 'View changed during confirmation.' };
      }
      return this.dispatchCommand({ ...command, confirmedUnmapped: true });
    }

    this.applyOutcomeToView(file, targetPath, targetBasename, outcome, false);
    return outcome;
  }

  private async dispatchHistory(direction: 'undo' | 'redo'): Promise<CommandDispatchOutcome> {
    const file = this.file;
    if (!file) {
      return { accepted: false, rejectCode: 'io-error', reason: 'No active file.' };
    }

    const targetPath = file.path;
    const targetBasename = file.basename;
    const seq = this.loadSequence;
    const coordinator = this.plugin.getFileCoordinator();

    const outcome =
      direction === 'undo'
        ? await coordinator.undoForFile(targetPath, targetBasename)
        : await coordinator.redoForFile(targetPath, targetBasename);

    if (isStaleAsyncViewUpdate(targetPath, seq, this.file?.path, this.loadSequence)) {
      return outcome;
    }

    this.applyOutcomeToView(file, targetPath, targetBasename, outcome, true);
    return outcome;
  }

  private applyOutcomeToView(
    file: TFile,
    targetPath: string,
    targetBasename: string,
    outcome: CommandDispatchOutcome,
    isHistoryAction: boolean,
  ): void {
    if (outcome.accepted && outcome.nextDocument !== undefined) {
      this.parseResult = { status: 'ok', document: outcome.nextDocument };
      this.lastRenderedSnapshot =
        outcome.nextRawText !== undefined
          ? { path: targetPath, basename: targetBasename, rawText: outcome.nextRawText }
          : null;
      this.renderApp();
      return;
    }

    if (
      outcome.rejectCode === 'boundary-no-op' ||
      outcome.rejectCode === 'nothing-to-undo' ||
      outcome.rejectCode === 'nothing-to-redo'
    ) {
      return;
    }

    new Notice(
      formatRejectMessage(this.plugin.messages, outcome.rejectCode, outcome.reason, isHistoryAction),
    );
    if (outcome.rejectCode === 'stale-target') {
      void this.reloadFromFile(file);
    }
  }

  refreshAppearance(): void {
    this.renderApp();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
    this.lastRenderedSnapshot = null;
    this.actionTriggers = null;
    this.unmountReact();
  }

  async onClose(): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
    this.lastRenderedSnapshot = null;
    this.actionTriggers = null;
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
        settings: this.plugin.mindMapSettings,
        messages: this.plugin.messages,
        onOpenMarkdown: (line?: number) => {
          void this.openMarkdownAtLine(line);
        },
        onOpenLink: (link: TopicLink, newTab: boolean) => {
          void this.handleOpenLink(link, newTab);
        },
        onUpdateSettings: (patch) => {
          void this.plugin.updateSettings(patch);
        },
        onDispatchCommand: (command: SemanticCommand) => this.dispatchCommand(command),
        onUndo: () => this.dispatchHistory('undo'),
        onRedo: () => this.dispatchHistory('redo'),
        onRegisterActionTriggers: this.registerActionTriggers,
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
