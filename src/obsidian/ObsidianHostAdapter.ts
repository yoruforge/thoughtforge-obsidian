import { MarkdownView, type App } from 'obsidian';
import { normalizeToLf } from '../core/patch/apply';
import type { ObsidianHostPort } from '../sync/ports';

/**
 * Production Obsidian adapter implementing ObsidianHostPort using only non-deprecated public APIs.
 */
export class ObsidianHostAdapter implements ObsidianHostPort {
  constructor(private readonly app: App) {}

  async readFile(path: string): Promise<string> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`Markdown file not found: ${path}`);
    }
    return this.app.vault.read(file);
  }

  async processFile(path: string, transform: (current: string) => string): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      throw new Error(`Markdown file not found: ${path}`);
    }
    await this.app.vault.process(file, transform);
  }

  inspectOpenMarkdownEditors(
    path: string,
  ): { readonly state: 'clean' } | { readonly state: 'dirty' } | { readonly state: 'unknown' } {
    try {
      const leaves = this.app.workspace.getLeavesOfType('markdown');
      for (const leaf of leaves) {
        if (!(leaf.view instanceof MarkdownView)) continue;
        if (leaf.view.file?.path !== path) continue;

        const currentEditorText = leaf.view.getViewData();
        const savedText = leaf.view.data;
        if (typeof currentEditorText !== 'string' || typeof savedText !== 'string') {
          return { state: 'unknown' };
        }
        if (normalizeToLf(currentEditorText) !== normalizeToLf(savedText)) {
          return { state: 'dirty' };
        }
      }
      return { state: 'clean' };
    } catch {
      return { state: 'unknown' };
    }
  }

  async revealSourceLine(path: string, line: number): Promise<void> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return;

    const existingMarkdownLeaf = this.app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);

    const targetLeaf = existingMarkdownLeaf ?? this.app.workspace.getLeaf('split');
    await targetLeaf.openFile(file);
    this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });

    if (targetLeaf.view instanceof MarkdownView) {
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

  async openLink(sourcePath: string, linkText: string, newTab: boolean): Promise<void> {
    await this.app.workspace.openLinkText(linkText, sourcePath, newTab);
  }
}
