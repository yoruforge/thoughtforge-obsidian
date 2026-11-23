import {
  FileView,
  MarkdownView,
  Notice,
  Scope,
  TFile,
  type WorkspaceLeaf,
} from 'obsidian';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ResolvedThemeMode } from '../core/layout/theme';
import type { MindMapDocument, ParseResult, TopicLink, TopicNode } from '../core/model';
import { parseMarkdownToMap } from '../core/parser';
import { extractSubtreeMarkdown } from '../core/patch';
import type { SemanticCommand } from '../core/patch/commands';
import { MapNavigationHistory, type MapHistoryEntry } from '../core/view/navigationHistory';
import { splitLinkTargetSubpath } from '../core/view/topicResolver';
import type { Messages } from '../i18n';
import type { SaveDraftInput } from '../sync/DraftStore';
import type { CommandDispatchOutcome, SyncRejectCode } from '../sync/ports';
import {
  MindMapApp,
  type MapRevealRequest,
  type MindMapActionTriggers,
} from '../ui/App';
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
    case 'invalid-note-block-syntax':
      return messages.edit.invalidNoteBlockSyntax;
    case 'invariant-check-failed':
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
  let decoded = rawTarget;
  try {
    decoded = decodeURIComponent(rawTarget);
  } catch {
    decoded = rawTarget;
  }
  for (const candidate of [rawTarget, decoded]) {
    if (/^[\\/]/.test(candidate)) return false;
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(candidate)) return false;
    const pathPart = candidate.split('#')[0] ?? '';
    const segments = pathPart.split(/[\\/]/);
    if (segments.includes('..')) return false;
  }
  return true;
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

function hasNonEmptyWindowSelection(ownerDoc: Document): boolean {
  const sel = ownerDoc.defaultView?.getSelection?.();
  return sel !== null && sel !== undefined && sel.toString().length > 0;
}

export class MindMapView extends FileView {
  private reactRoot: Root | null = null;
  private parseResult: ParseResult | null = null;
  private lastRenderedSnapshot: RenderedFileSnapshot | null = null;
  private lastCommandFocus: { readonly doc: MindMapDocument; readonly nodeId: string } | null = null;
  private readonly navHistory = new MapNavigationHistory();
  private pendingReveal: MapRevealRequest | null = null;
  private nextRevealToken = 0;
  private selectedHeaderLine: number | undefined = undefined;
  private suppressNextLoadHistoryRecord = false;
  private isNavigating = false;
  private loadSequence = 0;
  private actionTriggers: MindMapActionTriggers | null = null;
  private readonly registerActionTriggers = (triggers: MindMapActionTriggers | null): void => {
    this.actionTriggers = triggers;
  };
  private readonly handleSelectedLineChange = (line: number | undefined): void => {
    this.selectedHeaderLine = line;
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
      const activeIsNoteEditor =
        hasCssClass(activeEl, 'ito-note-editor-textarea') &&
        isNodeInsideContainer(this.contentEl, activeEl);
      if (shouldTriggerScopeInlineSplit(evt, activeIsNoteEditor)) {
        return this.actionTriggers?.commitNoteEdit(evt) ? false : undefined;
      }
      if (!this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.editSelected() ? false : undefined;
    });
    this.scope.register(['Mod', 'Shift'], '0', (evt) => {
      if (evt.altKey || !this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.fitSelection() ? false : undefined;
    });
    this.scope.register(['Mod', 'Shift'], 't', (evt) => {
      if (evt.altKey || !this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.editSelectedNote() ? false : undefined;
    });
    this.scope.register(['Mod'], 'c', (evt) => {
      if (evt.shiftKey || evt.altKey || !this.canHandleScopeShortcut(evt)) return undefined;
      if (hasNonEmptyWindowSelection(this.contentEl.ownerDocument)) return undefined;
      return this.actionTriggers?.copySelectedBranch() ? false : undefined;
    });
    this.scope.register(['Mod'], 'x', (evt) => {
      if (evt.shiftKey || evt.altKey || !this.canHandleScopeShortcut(evt)) return undefined;
      if (hasNonEmptyWindowSelection(this.contentEl.ownerDocument)) return undefined;
      return this.actionTriggers?.cutSelectedBranch() ? false : undefined;
    });
    this.scope.register(['Mod'], 'v', (evt) => {
      if (evt.shiftKey || evt.altKey || !this.canHandleScopeShortcut(evt)) return undefined;
      return this.actionTriggers?.pasteBranch() ? false : undefined;
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

  triggerEditSelectedNote(): void {
    this.actionTriggers?.editSelectedNote();
  }

  triggerCopySelectedBranch(): void {
    this.actionTriggers?.copySelectedBranch();
  }

  triggerCutSelectedBranch(): void {
    this.actionTriggers?.cutSelectedBranch();
  }

  triggerPasteBranch(): void {
    this.actionTriggers?.pasteBranch();
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

  canNavigateBack(): boolean {
    return this.navHistory.canGoBack();
  }

  canNavigateForward(): boolean {
    return this.navHistory.canGoForward();
  }

  renameHistoryPath(oldPath: string, newPath: string): void {
    this.navHistory.renamePath(oldPath, newPath);
    if (this.pendingReveal && this.pendingReveal.filePath === oldPath) {
      this.pendingReveal = { ...this.pendingReveal, filePath: newPath };
    }
    this.renderApp();
  }

  removeHistoryPath(deletedPath: string): void {
    this.navHistory.removePath(deletedPath);
    if (this.pendingReveal && this.pendingReveal.filePath === deletedPath) {
      this.pendingReveal = null;
    }
    this.renderApp();
  }

  revealTarget(target: { readonly line?: number; readonly subpath?: string }): void {
    const activePath = this.file?.path;
    if (!activePath) return;
    this.pendingReveal = {
      token: ++this.nextRevealToken,
      filePath: activePath,
      ...(target.line !== undefined ? { line: target.line } : {}),
      ...(target.subpath !== undefined ? { subpath: target.subpath } : {}),
    };
    this.renderApp();
  }

  async navigateBack(): Promise<void> {
    await this.traverseHistory('back');
  }

  async navigateForward(): Promise<void> {
    await this.traverseHistory('forward');
  }

  private async traverseHistory(direction: 'back' | 'forward'): Promise<void> {
    if (this.isNavigating) return;
    this.isNavigating = true;
    try {
      const currentPath = this.file?.path;
      if (currentPath) {
        this.navHistory.updateCurrentAnchor(currentPath, this.selectedHeaderLine);
      }

      while (true) {
        const candidate: MapHistoryEntry | null =
          direction === 'back' ? this.navHistory.peekBack() : this.navHistory.peekForward();
        if (!candidate) {
          this.renderApp();
          return;
        }

        const abstractFile = this.app.vault.getAbstractFileByPath(candidate.filePath);
        if (!(abstractFile instanceof TFile) || abstractFile.extension.toLowerCase() !== 'md') {
          this.navHistory.removePath(candidate.filePath);
          new Notice(this.plugin.messages.notices.noteNotFound);
          continue;
        }

        const target =
          direction === 'back' ? this.navHistory.stepBack() : this.navHistory.stepForward();
        if (!target) {
          this.renderApp();
          return;
        }

        const nextReveal: MapRevealRequest | null =
          target.targetSubpath !== undefined || target.targetLine !== undefined
            ? {
                token: ++this.nextRevealToken,
                filePath: target.filePath,
                ...(target.targetLine !== undefined ? { line: target.targetLine } : {}),
                ...(target.targetSubpath !== undefined ? { subpath: target.targetSubpath } : {}),
              }
            : null;

        this.pendingReveal = nextReveal;
        if (currentPath === target.filePath) {
          this.renderApp();
          return;
        }

        this.suppressNextLoadHistoryRecord = true;
        try {
          await this.leaf.setViewState({
            type: MINDMAP_VIEW_TYPE,
            state: { file: target.filePath },
            active: true,
          });
        } finally {
          this.suppressNextLoadHistoryRecord = false;
        }
        return;
      }
    } finally {
      this.isNavigating = false;
    }
  }

  async onLoadFile(file: TFile): Promise<void> {
    if (!this.suppressNextLoadHistoryRecord) {
      this.navHistory.recordVisit({ filePath: file.path });
    }
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
    this.lastCommandFocus = null;
    this.lastRenderedSnapshot = {
      path: file.path,
      basename: file.basename,
      rawText,
    };
    this.renderApp();
  }

  private async dispatchCommand(
    command: SemanticCommand,
    expectedFilePath?: string,
  ): Promise<CommandDispatchOutcome> {
    const file = this.file;
    if (!file) {
      return { accepted: false, rejectCode: 'io-error', reason: 'No active file.' };
    }
    if (expectedFilePath !== undefined && file.path !== expectedFilePath) {
      return {
        accepted: false,
        rejectCode: 'stale-target',
        reason: 'Active file changed before command dispatch.',
      };
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
      return this.dispatchCommand({ ...command, confirmedUnmapped: true }, targetPath);
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
      this.lastCommandFocus =
        outcome.focusNodeId !== undefined
          ? { doc: outcome.nextDocument, nodeId: outcome.focusNodeId }
          : null;
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

  async onUnloadFile(file: TFile): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
    this.lastCommandFocus = null;
    this.lastRenderedSnapshot = null;
    this.selectedHeaderLine = undefined;
    if (this.pendingReveal?.filePath === file.path) {
      this.pendingReveal = null;
    }
    this.actionTriggers = null;
    this.unmountReact();
  }

  async onClose(): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
    this.lastCommandFocus = null;
    this.lastRenderedSnapshot = null;
    this.selectedHeaderLine = undefined;
    this.pendingReveal = null;
    this.navHistory.clear();
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

  private async copyBranchSubtree(node: TopicNode): Promise<boolean> {
    const rawText = this.lastRenderedSnapshot?.rawText;
    if (rawText === undefined || node.kind === 'central-virtual') {
      return false;
    }
    const subtree = extractSubtreeMarkdown(rawText, node);
    if (subtree.trim().length === 0) {
      return false;
    }
    let syncedToOs = false;
    try {
      const clipboard = this.contentEl.ownerDocument.defaultView?.navigator?.clipboard;
      if (clipboard && typeof clipboard.writeText === 'function') {
        await clipboard.writeText(subtree);
        syncedToOs = true;
      }
    } catch {
      syncedToOs = false;
    }
    this.plugin.setBranchClipboard(subtree, syncedToOs);
    return true;
  }

  private async readBranchClipboard(): Promise<string | null> {
    const cached = this.plugin.getBranchClipboard();
    if (!cached.syncedToOs && cached.markdown !== null) {
      return cached.markdown;
    }
    try {
      const clipboard = this.contentEl.ownerDocument.defaultView?.navigator?.clipboard;
      if (clipboard && typeof clipboard.readText === 'function') {
        const text = await clipboard.readText();
        if (typeof text === 'string' && text.trim().length > 0) {
          return text;
        }
      }
    } catch {
      // Fall back to in-plugin clipboard cache when OS clipboard read is unavailable.
    }
    return cached.markdown;
  }

  private renderApp(): void {
    if (!this.parseResult) return;
    if (!this.reactRoot) {
      this.contentEl.empty();
      this.contentEl.addClass('ito-view-container');
      this.reactRoot = createRoot(this.contentEl);
    }

    const activePath = this.file?.path ?? '';
    const draftStore = this.plugin.getDraftStore();
    const fileDrafts = activePath.length > 0 ? draftStore.listDraftsForFile(activePath) : [];

    const backEntry = this.navHistory.peekBack();
    const forwardEntry = this.navHistory.peekForward();
    const formatEntryName = (entry: MapHistoryEntry): string => {
      const base = entry.filePath.split('/').pop() ?? entry.filePath;
      return base.replace(/\.md$/i, '');
    };
    const backTitle = backEntry
      ? `${this.plugin.messages.toolbar.navBack} (${formatEntryName(backEntry)})`
      : this.plugin.messages.toolbar.navBack;
    const forwardTitle = forwardEntry
      ? `${this.plugin.messages.toolbar.navForward} (${formatEntryName(forwardEntry)})`
      : this.plugin.messages.toolbar.navForward;
    const activeReveal =
      this.pendingReveal !== null && this.pendingReveal.filePath === activePath
        ? this.pendingReveal
        : null;

    this.reactRoot.render(
      createElement(MindMapApp, {
        filePath: activePath,
        parseResult: this.parseResult,
        preferredSelection: this.lastCommandFocus,
        revealRequest: activeReveal,
        canGoBack: this.navHistory.canGoBack(),
        canGoForward: this.navHistory.canGoForward(),
        backTitle,
        forwardTitle,
        onNavigateBack: () => {
          void this.navigateBack();
        },
        onNavigateForward: () => {
          void this.navigateForward();
        },
        onSelectedLineChange: this.handleSelectedLineChange,
        themeMode: this.resolveThemeMode(),
        settings: this.plugin.mindMapSettings,
        messages: this.plugin.messages,
        drafts: fileDrafts,
        unpersistedDraftIds: draftStore.getUnpersistedDraftIds(),
        draftRevisions: draftStore.getDraftRevisions(),
        onSaveDraft: (input: SaveDraftInput) => draftStore.saveDraft(input),
        onIsLatestDraftRevision: (draftId: string, expectedRevision: number) =>
          draftStore.isLatestDraftRevision(draftId, expectedRevision),
        onGetDraftRevision: (draftId: string) => draftStore.getDraftRevision(draftId),
        onGetDraftSnapshotRevision: () => draftStore.getSnapshotRevision(),
        onDeleteDraft: (draftId: string, expectedRevision?: number) =>
          draftStore.deleteDraft(draftId, expectedRevision),
        onDeleteMatchingDraft: (
          filePath: string,
          field: 'title' | 'note',
          targetTitleRaw: string,
          targetHeaderLine: number,
          targetAncestorPath?: readonly string[],
          targetOwnRangeHash?: string,
          baseContentHash?: string,
          targetHadIdenticalSibling?: boolean,
          maxRevision?: number,
        ) =>
          draftStore.deleteMatchingDraft(
            filePath,
            field,
            targetTitleRaw,
            targetHeaderLine,
            targetAncestorPath,
            targetOwnRangeHash,
            baseContentHash,
            targetHadIdenticalSibling,
            maxRevision,
          ),
        onCopyBranchSubtree: (node: TopicNode) => this.copyBranchSubtree(node),
        onReadBranchClipboard: () => this.readBranchClipboard(),
        onOpenMarkdown: (line?: number) => {
          void this.openMarkdownAtLine(line);
        },
        onOpenLink: (link: TopicLink, newTab: boolean) => {
          void this.handleOpenLink(link, newTab);
        },
        onUpdateSettings: (patch) => {
          void this.plugin.updateSettings(patch);
        },
        onDispatchCommand: (command: SemanticCommand, expectedFilePath?: string) =>
          this.dispatchCommand(command, expectedFilePath),
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
    if (this.isNavigating) return;
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

    const { pathPart, subpath } = splitLinkTargetSubpath(link.target);
    const destination =
      pathPart.length === 0
        ? sourceFile
        : this.app.metadataCache.getFirstLinkpathDest(pathPart, sourceFile.path);

    if (!destination) {
      new Notice(this.plugin.messages.notices.noteNotFound);
      return;
    }

    if (destination instanceof TFile && destination.extension.toLowerCase() === 'md') {
      if (newTab) {
        await this.plugin.openFileAsMindMap(destination, {
          openMode: 'new-tab',
          ...(subpath !== undefined ? { reveal: { subpath } } : {}),
        });
        return;
      }

      if (destination.path === sourceFile.path) {
        if (subpath !== undefined) {
          this.navHistory.updateCurrentAnchor(sourceFile.path, this.selectedHeaderLine);
          this.navHistory.recordVisit({
            filePath: sourceFile.path,
            targetSubpath: subpath,
          });
          this.revealTarget({ subpath });
        } else {
          this.revealTarget({ line: 0 });
        }
        return;
      }

      this.isNavigating = true;
      this.suppressNextLoadHistoryRecord = true;
      try {
        this.navHistory.updateCurrentAnchor(sourceFile.path, this.selectedHeaderLine);
        this.navHistory.recordVisit({
          filePath: destination.path,
          ...(subpath !== undefined ? { targetSubpath: subpath } : {}),
        });
        this.pendingReveal =
          subpath !== undefined
            ? {
                token: ++this.nextRevealToken,
                filePath: destination.path,
                subpath,
              }
            : null;
        await this.leaf.setViewState({
          type: MINDMAP_VIEW_TYPE,
          state: { file: destination.path },
          active: true,
        });
      } finally {
        this.suppressNextLoadHistoryRecord = false;
        this.isNavigating = false;
      }
      return;
    }

    await this.app.workspace.openLinkText(link.target, sourceFile.path, newTab);
  }
}
