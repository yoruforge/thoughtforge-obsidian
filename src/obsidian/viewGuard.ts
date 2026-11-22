export interface RenderedFileSnapshot {
  readonly path: string;
  readonly basename: string;
  readonly rawText: string;
}

/**
 * Returns true when an async file read or write completed after the view moved
 * to another file, reloaded, or closed.
 */
export function isStaleAsyncViewUpdate(
  capturedPath: string,
  capturedSeq: number,
  currentPath: string | null | undefined,
  currentSeq: number,
): boolean {
  return capturedSeq !== currentSeq || currentPath !== capturedPath;
}

export interface ScopeF2EventLike {
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

export interface ScopeF2Context {
  readonly targetIsEditable: boolean;
  readonly activeElementIsEditable: boolean;
  readonly targetInsideMap: boolean;
  readonly activeElementInsideMap: boolean;
  readonly activeElementIsBody: boolean;
}

/**
 * Decides whether a MindMapView-scoped F2 shortcut should open inline topic editing
 * instead of falling through to Obsidian's global "Edit file title" hotkey.
 */
export function shouldTriggerScopeF2(
  event: ScopeF2EventLike,
  context: ScopeF2Context,
): boolean {
  if (event.isComposing === true || event.keyCode === 229) {
    return false;
  }
  if (context.targetIsEditable || context.activeElementIsEditable) {
    return false;
  }
  return (
    context.targetInsideMap ||
    context.activeElementInsideMap ||
    context.activeElementIsBody
  );
}

/**
 * Skips re-rendering only when path, basename, and raw text (including exact line endings)
 * match byte-for-byte, ensuring CRLF mixing or virtual-root renames always re-render.
 */
export function shouldSkipReloadRender(
  lastSnapshot: RenderedFileSnapshot | null,
  path: string,
  basename: string,
  rawText: string,
): boolean {
  if (lastSnapshot === null) return false;
  return (
    lastSnapshot.path === path &&
    lastSnapshot.basename === basename &&
    lastSnapshot.rawText === rawText
  );
}
