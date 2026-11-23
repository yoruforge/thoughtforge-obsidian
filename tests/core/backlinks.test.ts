import { describe, expect, it } from 'vitest';
import {
  doesLinkSubpathMatchAnchors,
  formatSourceTitleFromPath,
  sortBacklinks,
} from '../../src/core/view/backlinks';

describe('backlinks (M4-b anchor matching & deterministic sorting)', () => {
  it('matches heading, nested heading, formatted heading, URL-encoded Japanese heading, and case-insensitive block IDs', () => {
    const anchors = ['^blk-alpha', 'Section Alpha', '**Section** Alpha', '設計方針'];

    expect(doesLinkSubpathMatchAnchors('target#Section Alpha', anchors)).toBe(true);
    expect(doesLinkSubpathMatchAnchors('target#Parent#Section Alpha', anchors)).toBe(true);
    expect(doesLinkSubpathMatchAnchors('target#^BLK-ALPHA', anchors)).toBe(true);
    expect(doesLinkSubpathMatchAnchors('target#%E8%A8%AD%E8%A8%88%E6%96%B9%E9%87%9D', anchors)).toBe(
      true,
    );
    expect(doesLinkSubpathMatchAnchors('target#Other Section', anchors)).toBe(false);
    expect(doesLinkSubpathMatchAnchors('target', anchors)).toBe(false);
  });

  it('sorts direct anchor backlinks ahead of note-level backlinks and formats titles cleanly', () => {
    expect(formatSourceTitleFromPath('folder/sub/My Note.md')).toBe('My Note');

    const sorted = sortBacklinks([
      { sourcePath: 'a-general.md', sourceTitle: 'A General', targetsSpecificAnchor: false },
      { sourcePath: 'z-direct.md', sourceTitle: 'Z Direct', targetsSpecificAnchor: true },
      { sourcePath: 'b-direct.md', sourceTitle: 'B Direct', targetsSpecificAnchor: true },
      { sourcePath: 'c-general.md', sourceTitle: 'C General', targetsSpecificAnchor: false },
    ]);

    expect(sorted.map((s) => s.sourcePath)).toEqual([
      'b-direct.md',
      'z-direct.md',
      'a-general.md',
      'c-general.md',
    ]);
  });
});
