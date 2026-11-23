export interface GuardableKeyEvent {
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly key?: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
}

export type InlineEditorKeyAction =
  | 'pass-to-ime'
  | 'suppress-default'
  | 'commit'
  | 'split'
  | 'cancel'
  | 'ignore';

/**
 * Guards Enter/Tab structural and commit commands against Japanese/CJK IME
 * composition confirmation collisions (active composition + post-compositionend window).
 */
export class ImeGuard {
  private composing = false;
  private lastCompositionEndAt: number | null = null;

  get isComposing(): boolean {
    return this.composing;
  }

  onCompositionStart(): void {
    this.composing = true;
  }

  onCompositionEnd(nowMs: number): void {
    this.composing = false;
    this.lastCompositionEndAt = nowMs;
  }

  isCompositionActive(event: GuardableKeyEvent): boolean {
    return (
      this.composing ||
      event.isComposing === true ||
      event.keyCode === 229 ||
      event.key === 'Process'
    );
  }

  isKeyGuarded(event: GuardableKeyEvent, nowMs: number, guardWindowMs: number): boolean {
    if (this.isCompositionActive(event)) {
      return true;
    }
    if (this.lastCompositionEndAt !== null) {
      const elapsed = nowMs - this.lastCompositionEndAt;
      if (elapsed >= 0 && elapsed <= guardWindowMs) {
        return true;
      }
    }
    return false;
  }

  reset(): void {
    this.composing = false;
    this.lastCompositionEndAt = null;
  }
}

/**
 * Decides how InlineEditor should handle a keydown event while protecting
 * Japanese/CJK IME composition and suppressing focus-stealing Tab during the guard window.
 */
export function decideInlineEditorKeyAction(
  guard: ImeGuard,
  event: GuardableKeyEvent,
  nowMs: number,
  guardWindowMs: number,
): InlineEditorKeyAction {
  if (event.key === 'Enter' || event.key === 'Tab') {
    if (guard.isCompositionActive(event)) {
      return 'pass-to-ime';
    }
    if (guard.isKeyGuarded(event, nowMs, guardWindowMs)) {
      return 'suppress-default';
    }
    if (event.key === 'Enter' && (event.metaKey === true || event.ctrlKey === true)) {
      return 'split';
    }
    return 'commit';
  }

  if (event.key === 'Escape') {
    if (guard.isCompositionActive(event)) {
      return 'pass-to-ime';
    }
    return 'cancel';
  }

  return 'ignore';
}
