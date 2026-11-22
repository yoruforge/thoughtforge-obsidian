import { describe, expect, it } from 'vitest';
import { decideInlineEditorKeyAction, ImeGuard } from '../../src/ui/imeGuard';

describe('ImeGuard', () => {
  it('guards key events during active composition and within the post-compositionend window', () => {
    const guard = new ImeGuard();

    expect(guard.isKeyGuarded({ key: 'Enter' }, 1000, 300)).toBe(false);

    guard.onCompositionStart();
    expect(guard.isComposing).toBe(true);
    expect(guard.isCompositionActive({ key: 'Enter' })).toBe(true);
    expect(guard.isKeyGuarded({ key: 'Enter' }, 1050, 300)).toBe(true);
    expect(guard.isKeyGuarded({ key: 'Tab' }, 1060, 300)).toBe(true);

    guard.onCompositionEnd(1100);
    expect(guard.isComposing).toBe(false);
    expect(guard.isCompositionActive({ key: 'Escape' })).toBe(false);

    // Still guarded inside [1100, 1400]
    expect(guard.isKeyGuarded({ key: 'Enter' }, 1100, 300)).toBe(true);
    expect(guard.isKeyGuarded({ key: 'Enter' }, 1250, 300)).toBe(true);
    expect(guard.isKeyGuarded({ key: 'Tab' }, 1400, 300)).toBe(true);

    // Released after window expires
    expect(guard.isKeyGuarded({ key: 'Enter' }, 1401, 300)).toBe(false);
    expect(guard.isKeyGuarded({ key: 'Tab' }, 1450, 300)).toBe(false);
  });

  it('guards browser-flagged IME key events (isComposing, keyCode 229, key Process)', () => {
    const guard = new ImeGuard();

    expect(guard.isKeyGuarded({ isComposing: true, key: 'Enter' }, 500, 300)).toBe(true);
    expect(guard.isKeyGuarded({ keyCode: 229, key: 'Enter' }, 500, 300)).toBe(true);
    expect(guard.isKeyGuarded({ key: 'Process' }, 500, 300)).toBe(true);
  });

  it('clears composition state and guard timestamp on reset', () => {
    const guard = new ImeGuard();
    guard.onCompositionStart();
    guard.onCompositionEnd(1000);
    expect(guard.isKeyGuarded({ key: 'Enter' }, 1050, 300)).toBe(true);

    guard.reset();
    expect(guard.isComposing).toBe(false);
    expect(guard.isKeyGuarded({ key: 'Enter' }, 1050, 300)).toBe(false);
  });

  it('suppresses default Tab focus movement during the post-compositionend guard window (P2-3 regression)', () => {
    const guard = new ImeGuard();

    guard.onCompositionStart();
    expect(decideInlineEditorKeyAction(guard, { key: 'Tab' }, 1000, 300)).toBe('pass-to-ime');
    expect(decideInlineEditorKeyAction(guard, { key: 'Enter' }, 1000, 300)).toBe('pass-to-ime');
    expect(decideInlineEditorKeyAction(guard, { key: 'Escape' }, 1000, 300)).toBe('pass-to-ime');

    guard.onCompositionEnd(1000);
    // Inside guard window: Tab and Enter must preventDefault so Tab cannot blur-commit
    expect(decideInlineEditorKeyAction(guard, { key: 'Tab' }, 1100, 300)).toBe('suppress-default');
    expect(decideInlineEditorKeyAction(guard, { key: 'Enter' }, 1100, 300)).toBe(
      'suppress-default',
    );
    expect(decideInlineEditorKeyAction(guard, { key: 'Escape' }, 1100, 300)).toBe('cancel');

    // Outside guard window: Tab and Enter commit normally
    expect(decideInlineEditorKeyAction(guard, { key: 'Tab' }, 1301, 300)).toBe('commit');
    expect(decideInlineEditorKeyAction(guard, { key: 'Enter' }, 1301, 300)).toBe('commit');
  });
});
