import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';
import {
  computeDepthCollapsedIds,
  computeVisibilityAndEmphasis,
} from '../../src/core/view/filterFocus';

describe('filterFocus', () => {
  const sampleMd = [
    '# Root',
    '## A',
    '- A1',
    '  - A1a',
    '## B',
    '- B1',
  ].join('\n');

  it('temporarily expands Quick Filter matches and restores base collapse state on clear', () => {
    const parsed = parseMarkdownToMap(sampleMd, 'Sample');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;

    const findId = (title: string): string => {
      const found = [...doc.nodes.values()].find((n) => n.titleRaw === title);
      if (!found) throw new Error(`Missing node ${title}`);
      return found.id;
    };

    const idA = findId('A');
    const idA1 = findId('A1');
    const idA1a = findId('A1a');
    const idB = findId('B');
    const idB1 = findId('B1');

    // Initial state: A collapsed, B expanded
    let baseCollapsed: ReadonlySet<string> = new Set([idA]);

    // Step 1: Quick Filter "A1a" temporarily expands A and A1, dims B, temporarily collapses B
    const step1 = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: baseCollapsed,
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: 'A1a',
      userOpenedDuringFilterIds: new Set(),
    });
    expect(step1.visibleNodeIds.has(idA1a)).toBe(true);
    expect(step1.dimmedNodeIds.has(idA1a)).toBe(false);
    expect(step1.dimmedNodeIds.has(idA)).toBe(false);
    expect(step1.dimmedNodeIds.has(idB)).toBe(true);
    expect(step1.visibleNodeIds.has(idB1)).toBe(false);

    // Step 2: Apply depth 1 from Root during filter (modifies baseCollapsed, temp expansion remains)
    baseCollapsed = computeDepthCollapsedIds(doc, doc.rootId, 1, baseCollapsed);
    const step2 = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: baseCollapsed,
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: 'A1a',
      userOpenedDuringFilterIds: new Set(),
    });
    expect(step2.visibleNodeIds.has(idA1a)).toBe(true);

    // Step 3: Clear Quick Filter -> returns to depth 1 (A and B visible, A1 and B1 collapsed)
    const step3 = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: baseCollapsed,
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: '',
      userOpenedDuringFilterIds: new Set(),
    });
    expect(step3.visibleNodeIds.has(idA)).toBe(true);
    expect(step3.visibleNodeIds.has(idB)).toBe(true);
    expect(step3.visibleNodeIds.has(idA1)).toBe(false);
    expect(step3.visibleNodeIds.has(idB1)).toBe(false);
  });

  it('intersects Focus and Quick Filter dimming when both are active', () => {
    const parsed = parseMarkdownToMap(sampleMd, 'Sample');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;

    const findId = (title: string): string => {
      const found = [...doc.nodes.values()].find((n) => n.titleRaw === title);
      if (!found) throw new Error(`Missing node ${title}`);
      return found.id;
    };

    const idA = findId('A');
    const idA1 = findId('A1');
    const idB1 = findId('B1');

    // Focus fixed on A, filter matches "1" (matches A1, A1a, B1)
    const result = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: new Set(),
      focusMode: { kind: 'fixed', anchorId: idA },
      selectedId: idB1,
      filterQuery: '1',
      userOpenedDuringFilterIds: new Set(),
    });

    expect(result.dimmedNodeIds.has(idA1)).toBe(false);
    expect(result.dimmedNodeIds.has(idB1)).toBe(true);
  });

  it('filters by Markdown-derived structured attributes (note, tasks, link, unmapped, tags)', () => {
    const md = [
      '# Root',
      '## With Note #work/urgent',
      'Detailed paragraph note',
      '- [ ] Open task #重要',
      '- [x] Done task [[OtherNote]]',
      '- With Code',
      '  ```ts',
      '  const x = 1;',
      '  ```',
    ].join('\n');

    const parsed = parseMarkdownToMap(md, 'Rich');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    const doc = parsed.document;
    const findId = (needle: string): string => {
      const found = [...doc.nodes.values()].find((n) => n.titleRaw.includes(needle));
      if (!found) throw new Error(`Missing ${needle}`);
      return found.id;
    };

    const noteId = findId('With Note');
    const openTaskId = findId('Open task');
    const doneTaskId = findId('Done task');
    const codeId = findId('With Code');

    const byNote = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: new Set(),
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: '',
      structuredFilter: { hasNote: true },
      userOpenedDuringFilterIds: new Set(),
    });
    expect(byNote.filterActive).toBe(true);
    expect(byNote.matchedNodeIds.has(noteId)).toBe(true);
    expect(byNote.matchedNodeIds.size).toBe(1);

    const byOpenTask = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: new Set(),
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: '',
      structuredFilter: { hasOpenTask: true },
      userOpenedDuringFilterIds: new Set(),
    });
    expect([...byOpenTask.matchedNodeIds]).toEqual([openTaskId]);

    const byDoneLink = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: new Set(),
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: '',
      structuredFilter: { hasCompletedTask: true, hasLink: true },
      userOpenedDuringFilterIds: new Set(),
    });
    expect([...byDoneLink.matchedNodeIds]).toEqual([doneTaskId]);

    const byUnmapped = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: new Set(),
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: '',
      structuredFilter: { hasUnmapped: true },
      userOpenedDuringFilterIds: new Set(),
    });
    expect([...byUnmapped.matchedNodeIds]).toEqual([codeId]);

    // Prefix tag match (#work matches #work/urgent) & Japanese tag match (#重要)
    const byWorkTag = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: new Set(),
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: '',
      structuredFilter: { tag: '#work' },
      userOpenedDuringFilterIds: new Set(),
    });
    expect([...byWorkTag.matchedNodeIds]).toEqual([noteId]);

    const byJaTag = computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds: new Set(),
      focusMode: { kind: 'off' },
      selectedId: doc.rootId,
      filterQuery: '',
      structuredFilter: { tag: '#重要' },
      userOpenedDuringFilterIds: new Set(),
    });
    expect([...byJaTag.matchedNodeIds]).toEqual([openTaskId]);
  });
});
