import { describe, expect, it } from 'vitest';
import {
  isStaleAsyncViewUpdate,
  shouldSkipReloadRender,
  shouldTriggerScopeF2,
  shouldTriggerScopeInlineSplit,
  type RenderedFileSnapshot,
} from '../../src/obsidian/viewGuard';

describe('viewGuard (P2-1 and P2-2 regressions)', () => {
  it('treats async write/read completions as stale after switching files or reloading (P2-1)', () => {
    expect(isStaleAsyncViewUpdate('notes/a.md', 3, 'notes/a.md', 3)).toBe(false);
    expect(isStaleAsyncViewUpdate('notes/a.md', 3, 'notes/b.md', 3)).toBe(true);
    expect(isStaleAsyncViewUpdate('notes/a.md', 3, 'notes/a.md', 4)).toBe(true);
    expect(isStaleAsyncViewUpdate('notes/a.md', 3, null, 3)).toBe(true);
  });

  it('does not skip reload when line endings become mixed even though LF text matches (P2-2)', () => {
    const snapshot: RenderedFileSnapshot = {
      path: 'notes/eol.md',
      basename: 'eol',
      rawText: '# Root\n- A\n- B\n',
    };

    expect(shouldSkipReloadRender(snapshot, 'notes/eol.md', 'eol', '# Root\n- A\n- B\n')).toBe(
      true,
    );
    expect(shouldSkipReloadRender(snapshot, 'notes/eol.md', 'eol', '# Root\r\n- A\n- B\n')).toBe(
      false,
    );
  });

  it('does not skip reload when an H1-less note is renamed (basename changes) (P2-2)', () => {
    const snapshot: RenderedFileSnapshot = {
      path: 'notes/old-name.md',
      basename: 'old-name',
      rawText: '## Section 1\n- Leaf\n',
    };

    expect(
      shouldSkipReloadRender(snapshot, 'notes/new-name.md', 'new-name', '## Section 1\n- Leaf\n'),
    ).toBe(false);
    expect(
      shouldSkipReloadRender(snapshot, 'notes/old-name.md', 'new-name', '## Section 1\n- Leaf\n'),
    ).toBe(false);
  });

  it('handles F2 inside the active mind map while falling through for inputs, IME, and outside focus', () => {
    // Focused on a topic node inside the map -> handle F2
    expect(
      shouldTriggerScopeF2(
        { isComposing: false, keyCode: 113 },
        {
          targetIsEditable: false,
          activeElementIsEditable: false,
          targetInsideMap: true,
          activeElementInsideMap: true,
          activeElementIsBody: false,
        },
      ),
    ).toBe(true);

    // Just opened map (focus on document.body) -> handle F2
    expect(
      shouldTriggerScopeF2(
        {},
        {
          targetIsEditable: false,
          activeElementIsEditable: false,
          targetInsideMap: false,
          activeElementInsideMap: false,
          activeElementIsBody: true,
        },
      ),
    ).toBe(true);

    // Focused inside Quick Filter input or InlineEditor -> let input handle F2
    expect(
      shouldTriggerScopeF2(
        {},
        {
          targetIsEditable: true,
          activeElementIsEditable: true,
          targetInsideMap: true,
          activeElementInsideMap: true,
          activeElementIsBody: false,
        },
      ),
    ).toBe(false);

    // IME composing -> ignore
    expect(
      shouldTriggerScopeF2(
        { isComposing: true },
        {
          targetIsEditable: false,
          activeElementIsEditable: false,
          targetInsideMap: true,
          activeElementInsideMap: true,
          activeElementIsBody: false,
        },
      ),
    ).toBe(false);

    // Focus inside QuickStylePopover / NodePopover / Filter popover -> ignore scope shortcuts
    expect(
      shouldTriggerScopeF2(
        {},
        {
          targetIsEditable: false,
          activeElementIsEditable: false,
          targetInsidePopover: true,
          activeElementInsidePopover: true,
          targetInsideMap: true,
          activeElementInsideMap: true,
          activeElementIsBody: false,
        },
      ),
    ).toBe(false);

    // Focus outside map (e.g. file explorer or pane header title) -> let Obsidian handle F2
    expect(
      shouldTriggerScopeF2(
        {},
        {
          targetIsEditable: false,
          activeElementIsEditable: false,
          targetInsideMap: false,
          activeElementInsideMap: false,
          activeElementIsBody: false,
        },
      ),
    ).toBe(false);
  });

  it('allows Mod+Enter inline split only when InlineEditor is active and not IME composing', () => {
    expect(shouldTriggerScopeInlineSplit({ isComposing: false }, true)).toBe(true);
    expect(shouldTriggerScopeInlineSplit({ isComposing: true }, true)).toBe(false);
    expect(shouldTriggerScopeInlineSplit({ keyCode: 229 }, true)).toBe(false);
    expect(shouldTriggerScopeInlineSplit({ isComposing: false }, false)).toBe(false);
  });
});
