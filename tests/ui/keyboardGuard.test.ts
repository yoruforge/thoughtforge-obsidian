import { describe, expect, it } from 'vitest';
import {
  isEditableTarget,
  isInsideMapPopover,
  isInsideMapUiChrome,
  shouldHandlePopoverDocumentEscape,
  shouldIgnoreCanvasKeyEvent,
} from '../../src/ui/keyboardGuard';

function makeElement(
  tagName: string,
  matchedSelectors: readonly string[] = [],
  parentNode: unknown = null,
) {
  return {
    nodeType: 1,
    tagName,
    isContentEditable: false,
    parentNode,
    closest(selector: string) {
      const parts = selector.split(',').map((s) => s.trim());
      return parts.some((p) => matchedSelectors.includes(p)) ? this : null;
    },
  };
}

describe('keyboardGuard (PR #5 P1/P2 regressions)', () => {
  it('blocks canvas keyboard shortcuts for editable controls and all non-canvas chrome/popovers', () => {
    const input = makeElement('INPUT');
    const styleButton = makeElement('BUTTON', ['.ito-style-popover']);
    const filterCheckbox = makeElement('INPUT', ['.ito-filter-popover']);
    const popoverButton = makeElement('BUTTON', ['.ito-popover']);
    const toolbarButton = makeElement('BUTTON', ['.ito-toolbar']);
    const statusButton = makeElement('BUTTON', ['.ito-statusbar']);
    const textInsideStyleButton = { nodeType: 3, parentElement: styleButton };
    const canvasNode = makeElement('DIV', ['.ito-node']);
    const canvasRoot = makeElement('DIV', ['.ito-root']);

    expect(isEditableTarget(input)).toBe(true);
    expect(isInsideMapPopover(styleButton)).toBe(true);
    expect(isInsideMapPopover(popoverButton)).toBe(true);
    expect(isInsideMapPopover(toolbarButton)).toBe(false);
    expect(isInsideMapUiChrome(toolbarButton)).toBe(true);
    expect(isInsideMapUiChrome(statusButton)).toBe(true);

    expect(shouldIgnoreCanvasKeyEvent(input)).toBe(true);
    expect(shouldIgnoreCanvasKeyEvent(styleButton)).toBe(true);
    expect(shouldIgnoreCanvasKeyEvent(filterCheckbox)).toBe(true);
    expect(shouldIgnoreCanvasKeyEvent(popoverButton)).toBe(true);
    expect(shouldIgnoreCanvasKeyEvent(toolbarButton)).toBe(true);
    expect(shouldIgnoreCanvasKeyEvent(statusButton)).toBe(true);
    expect(shouldIgnoreCanvasKeyEvent(textInsideStyleButton)).toBe(true);

    // Canvas nodes and canvas root still accept mind-map shortcuts
    expect(shouldIgnoreCanvasKeyEvent(canvasNode)).toBe(false);
    expect(shouldIgnoreCanvasKeyEvent(canvasRoot)).toBe(false);
  });

  it('prevents popover Escape listeners from stealing Escape from Obsidian overlays or other panes', () => {
    const rootEl = makeElement('DIV', ['.ito-root']);
    const insideButton = makeElement('BUTTON', ['.ito-style-popover'], rootEl);
    const otherPaneEditor = makeElement('DIV', ['.cm-content'], null);
    const body = makeElement('BODY');

    const docWithCommandPalette = {
      body,
      querySelector: (selector: string) =>
        selector.includes('.prompt') ? makeElement('DIV', ['.prompt']) : null,
    };

    const docClean = {
      body,
      querySelector: () => null,
    };

    // Command Palette / modal open -> do NOT steal Escape
    expect(
      shouldHandlePopoverDocumentEscape(docWithCommandPalette, rootEl, {
        key: 'Escape',
        target: insideButton,
      }),
    ).toBe(false);

    // Event from adjacent Markdown pane outside .ito-root -> do NOT steal Escape
    expect(
      shouldHandlePopoverDocumentEscape(docClean, rootEl, {
        key: 'Escape',
        target: otherPaneEditor,
      }),
    ).toBe(false);

    // Event inside .ito-root or on document.body -> close popover
    expect(
      shouldHandlePopoverDocumentEscape(docClean, rootEl, {
        key: 'Escape',
        target: insideButton,
      }),
    ).toBe(true);
    expect(
      shouldHandlePopoverDocumentEscape(docClean, rootEl, {
        key: 'Escape',
        target: body,
      }),
    ).toBe(true);

    // Non-Escape or already-prevented events -> ignore
    expect(
      shouldHandlePopoverDocumentEscape(docClean, rootEl, {
        key: 'Tab',
        target: insideButton,
      }),
    ).toBe(false);
    expect(
      shouldHandlePopoverDocumentEscape(docClean, rootEl, {
        key: 'Escape',
        defaultPrevented: true,
        target: insideButton,
      }),
    ).toBe(false);
  });
});
