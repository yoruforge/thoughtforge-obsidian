import { describe, expect, it } from 'vitest';
import { MapNavigationHistory } from '../../src/core/view/navigationHistory';

describe('MapNavigationHistory (M4-a Back/Forward stack)', () => {
  it('records visits, updates current anchor before jump, steps back/forward, and truncates forward branch on new visit', () => {
    const history = new MapNavigationHistory();
    expect(history.canGoBack()).toBe(false);
    expect(history.canGoForward()).toBe(false);

    history.recordVisit({ filePath: 'a.md' });
    history.updateCurrentAnchor('a.md', 12);
    history.recordVisit({ filePath: 'b.md', targetSubpath: 'Section 1' });
    history.recordVisit({ filePath: 'c.md' });

    expect(history.canGoBack()).toBe(true);
    expect(history.canGoForward()).toBe(false);
    expect(history.peekBack()).toEqual({ filePath: 'b.md', targetSubpath: 'Section 1' });

    expect(history.stepBack()).toEqual({ filePath: 'b.md', targetSubpath: 'Section 1' });
    expect(history.canGoForward()).toBe(true);
    expect(history.peekForward()).toEqual({ filePath: 'c.md' });

    expect(history.stepBack()).toEqual({ filePath: 'a.md', targetLine: 12 });
    expect(history.canGoBack()).toBe(false);

    expect(history.stepForward()).toEqual({ filePath: 'b.md', targetSubpath: 'Section 1' });

    // Visiting a new note from the middle drops 'c.md' from forward stack
    history.recordVisit({ filePath: 'd.md' });
    expect(history.canGoForward()).toBe(false);
    expect(history.peekBack()).toEqual({ filePath: 'b.md', targetSubpath: 'Section 1' });
  });

  it('tracks file renames and prunes deleted files while collapsing adjacent duplicates', () => {
    const history = new MapNavigationHistory();
    history.recordVisit({ filePath: 'a.md', targetLine: 3 });
    history.recordVisit({ filePath: 'b.md' });
    history.recordVisit({ filePath: 'a.md', targetLine: 3 });

    history.renamePath('a.md', 'folder/a-renamed.md');
    expect(history.current).toEqual({ filePath: 'folder/a-renamed.md', targetLine: 3 });
    expect(history.peekBack()).toEqual({ filePath: 'b.md' });

    // Removing middle 'b.md' collapses adjacent identical 'folder/a-renamed.md' entries
    history.removePath('b.md');
    expect(history.length).toBe(1);
    expect(history.current).toEqual({ filePath: 'folder/a-renamed.md', targetLine: 3 });
    expect(history.canGoBack()).toBe(false);
    expect(history.canGoForward()).toBe(false);
  });

  it('caps history length at 50 entries and deduplicates consecutive identical visits', () => {
    const history = new MapNavigationHistory();
    history.recordVisit({ filePath: 'same.md' });
    history.recordVisit({ filePath: 'same.md' });
    expect(history.length).toBe(1);

    for (let i = 0; i < 60; i += 1) {
      history.recordVisit({ filePath: `note-${i}.md` });
    }
    expect(history.length).toBe(50);
    expect(history.current).toEqual({ filePath: 'note-59.md' });
  });
});
