import { toLf } from './host.ts';

export type MarkdownState = 'match' | 'pending' | 'unknown';
type Leaf = { view: unknown; getViewState(): unknown; isDeferred?: boolean; loadIfDeferred?(): Promise<void> };
type Workspace = { iterateAllLeaves(callback: (leaf: Leaf) => void): void };
type File = { path: string };
type Markdown = { file: File | null; getMode(): string; editor?: { getValue(): unknown }; getViewData(): unknown };
type IsMarkdown = (view: unknown) => view is Markdown;

function stateOf(leaf: Leaf): { type?: string; state?: { file?: string } } {
  return leaf.getViewState() as { type?: string; state?: { file?: string } };
}

/** Synchronous and side-effect free: safe to repeat inside vault.process. */
export function inspectMarkdown(workspace: Workspace, file: File, savedText: string, isMarkdown: IsMarkdown): MarkdownState {
  let pending = false, unknown = false;
  try {
    workspace.iterateAllLeaves(leaf => {
      try {
        const state = stateOf(leaf), view = leaf.view;
        const loaded = isMarkdown(view);
        const sameView = loaded && (view.file === file || view.file?.path === file.path);
        const sameState = state?.type === 'markdown' && state.state?.file === file.path;
        if (!sameView && !sameState) return;
        if (!loaded || leaf.isDeferred || !sameView || (state?.type === 'markdown' && !sameState)) { unknown = true; return; }
        const mode = view.getMode();
        // Reading has no reliable editor; Source and Live Preview use source mode.
        const value = mode === 'preview' ? view.getViewData() : mode === 'source' ? view.editor?.getValue() : undefined;
        if (typeof value !== 'string' || /\r(?!\n)/.test(value)) unknown = true;
        else if (toLf(value) !== toLf(savedText)) pending = true;
      } catch { unknown = true; }
    });
  } catch { unknown = true; }
  return unknown ? 'unknown' : pending ? 'pending' : 'match';
}

/** Invoke only from an explicit user action. Ordinary inspection never loads tabs. */
export async function loadDeferredMarkdown(workspace: Workspace, file: File, valid: () => boolean): Promise<boolean> {
  if (!valid()) return false;
  const targets: Leaf[] = [];
  try {
    workspace.iterateAllLeaves(leaf => {
      const state = stateOf(leaf);
      if (state?.type === 'markdown' && state.state?.file === file.path && leaf.isDeferred) targets.push(leaf);
    });
    for (const leaf of targets) {
      if (!valid()) return false;
      const state = stateOf(leaf);
      if (state?.type !== 'markdown' || state.state?.file !== file.path || !leaf.loadIfDeferred) return false;
      await leaf.loadIfDeferred();
      if (!valid()) return false;
      const after = stateOf(leaf);
      if (after?.type !== 'markdown' || after.state?.file !== file.path || leaf.isDeferred) return false;
    }
    return valid();
  } catch { return false; }
}
