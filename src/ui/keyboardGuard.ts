const POPOVER_SELECTOR = '.ito-popover, .ito-style-popover, .ito-filter-popover';
const CHROME_SELECTOR = '.ito-toolbar, .ito-statusbar, .ito-popover, .ito-style-popover, .ito-filter-popover';
const OBSIDIAN_OVERLAY_SELECTOR = '.modal-container, .prompt, .menu';

interface ElementLike {
  readonly nodeType?: unknown;
  readonly tagName?: unknown;
  readonly isContentEditable?: unknown;
  readonly parentElement?: unknown;
  readonly parentNode?: unknown;
  readonly closest?: (selector: string) => unknown;
}

function asElementLike(target: unknown): ElementLike | null {
  if (typeof target !== 'object' || target === null) return null;
  const candidate = target as ElementLike;
  // Handle text nodes by ascending to their parentElement/parentNode
  if (candidate.nodeType === 3) {
    return asElementLike(candidate.parentElement ?? candidate.parentNode);
  }
  return candidate;
}

/**
 * Cross-window-safe check for native text-input / editable targets.
 */
export function isEditableTarget(target: unknown): boolean {
  const el = asElementLike(target);
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  if (typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Cross-window-safe check for whether a DOM target resides inside any ThoughtForge
 * dialog popover (QuickStylePopover, NodePopover, or Structured Filter popover).
 */
export function isInsideMapPopover(target: unknown): boolean {
  const el = asElementLike(target);
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest(POPOVER_SELECTOR) !== null;
}

/**
 * Cross-window-safe check for whether a DOM target resides inside non-canvas UI chrome
 * (toolbar, floating status bar, or any dialog popover) where map keyboard shortcuts
 * such as Tab/Enter/Backspace must never intercept native control navigation.
 */
export function isInsideMapUiChrome(target: unknown): boolean {
  const el = asElementLike(target);
  if (!el || typeof el.closest !== 'function') return false;
  return el.closest(CHROME_SELECTOR) !== null;
}

/**
 * Returns true when canvas/editing keyboard shortcuts on `.ito-root` must not handle
 * the event (so native form/button/dialog navigation like Tab and Enter works safely).
 */
export function shouldIgnoreCanvasKeyEvent(target: unknown): boolean {
  return isEditableTarget(target) || isInsideMapUiChrome(target);
}

function isNodeContainedIn(container: unknown, target: unknown): boolean {
  if (typeof container !== 'object' || container === null) return false;
  if (typeof target !== 'object' || target === null) return false;
  let cursor: unknown = target;
  while (typeof cursor === 'object' && cursor !== null) {
    if (cursor === container) return true;
    cursor = (cursor as { readonly parentNode?: unknown }).parentNode;
  }
  return false;
}

export interface DocumentLikeForEscape {
  readonly body?: unknown;
  readonly documentElement?: unknown;
  querySelector(selector: string): unknown;
}

export interface EscapeEventLike {
  readonly key: string;
  readonly defaultPrevented?: boolean;
  readonly target: unknown;
}

/**
 * Decides whether a document-level Escape listener owned by a ThoughtForge popover
 * should close that popover, without ever stealing Escape from Obsidian's Command Palette,
 * modals, context menus, or an adjacent pane.
 */
export function shouldHandlePopoverDocumentEscape(
  ownerDoc: DocumentLikeForEscape,
  rootEl: unknown,
  event: EscapeEventLike,
): boolean {
  if (event.key !== 'Escape' || event.defaultPrevented === true) {
    return false;
  }
  if (ownerDoc.querySelector(OBSIDIAN_OVERLAY_SELECTOR) !== null) {
    return false;
  }
  if (rootEl !== null && rootEl !== undefined) {
    const target = event.target;
    const isDocumentLevel =
      target === null ||
      target === undefined ||
      target === ownerDoc ||
      target === ownerDoc.body ||
      target === ownerDoc.documentElement;
    if (!isDocumentLevel && !isNodeContainedIn(rootEl, target)) {
      return false;
    }
  }
  return true;
}
