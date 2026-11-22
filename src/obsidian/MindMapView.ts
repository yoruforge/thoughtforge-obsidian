import {
  FileView,
  MarkdownView,
  Notice,
  type TFile,
  type WorkspaceLeaf,
} from 'obsidian';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ResolvedThemeMode } from '../core/layout/theme';
import type { ParseResult, TopicLink } from '../core/model';
import { parseMarkdownToMap } from '../core/parser';
import { MindMapApp } from '../ui/App';
import type ThoughtForgePlugin from '../main';

export const MINDMAP_VIEW_TYPE = 'thoughtforge-mindmap-view';

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

export class MindMapView extends FileView {
  private reactRoot: Root | null = null;
  private parseResult: ParseResult | null = null;
  private loadSequence = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ThoughtForgePlugin,
  ) {
    super(leaf);
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
    const rawText = await this.app.vault.cachedRead(file);
    if (seq !== this.loadSequence || this.file?.path !== file.path) {
      return;
    }
    this.parseResult = parseMarkdownToMap(rawText, file.basename);
    this.renderApp();
  }

  refreshAppearance(): void {
    this.renderApp();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
    this.unmountReact();
  }

  async onClose(): Promise<void> {
    this.loadSequence += 1;
    this.parseResult = null;
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
        messages: this.plugin.messages,
        onOpenMarkdown: (line?: number) => {
          void this.openMarkdownAtLine(line);
        },
        onOpenLink: (link: TopicLink, newTab: boolean) => {
          void this.handleOpenLink(link, newTab);
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
