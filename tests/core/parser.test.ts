import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';

describe('parseMarkdownToMap', () => {
  it('parses headings, nested lists, topic notes, and preserves all unmapped blocks', () => {
    const md = [
      '---',
      'title: Demo',
      'tags: [plan]',
      '---',
      '# Central Topic',
      'Central description paragraph.',
      '',
      '## Branch A',
      'Branch A note line 1',
      'Branch A note line 2',
      '',
      '- [ ] Child 1 [[Linked Note|Alias]] ^blk-1',
      '  Child 1 note paragraph',
      '  - Grandchild 1',
      '- [x] Child 2 https://example.com',
      '',
      '```md',
      '# Not a heading',
      '- Not a list item',
      '```',
      '',
      '> [!note] Callout title',
      '> - Not a list item either',
      '',
      '| Col A | Col B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      'Trailing paragraph after unmapped block.',
      '',
      '#### Skipped depth heading',
      '# Second H1 as main branch',
    ].join('\n');

    const result = parseMarkdownToMap(md, 'Fallback');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const doc = result.document;
    expect(doc.readOnlyReasons).toEqual([]);
    expect(doc.lineKinds).toHaveLength(doc.lineCount);

    const root = doc.nodes.get(doc.rootId);
    expect(root?.kind).toBe('heading');
    expect(root?.titleRaw).toBe('Central Topic');
    expect(root?.noteText).toBe('Central description paragraph.');
    expect(root?.unmappedBlocks.some((b) => b.kind === 'frontmatter')).toBe(true);

    // Main branches: Branch A and Second H1
    expect(root?.childIds).toHaveLength(2);
    const branchA = doc.nodes.get(root?.childIds[0] ?? '');
    const secondH1 = doc.nodes.get(root?.childIds[1] ?? '');
    expect(branchA?.titleRaw).toBe('Branch A');
    expect(branchA?.noteText).toBe('Branch A note line 1\nBranch A note line 2');
    expect(secondH1?.titleRaw).toBe('Second H1 as main branch');

    // Children of Branch A: Child 1, Child 2, Skipped depth heading (####)
    expect(branchA?.childIds).toHaveLength(3);
    const child1 = doc.nodes.get(branchA?.childIds[0] ?? '');
    expect(child1?.preservedPrefix).toBe('[ ] ');
    expect(child1?.preservedBlockId).toBe('^blk-1');
    expect(child1?.titleRaw).toBe('Child 1 [[Linked Note|Alias]]');
    expect(child1?.displayTitle).toBe('Child 1 Alias');
    expect(child1?.links).toEqual([
      { kind: 'wikilink', target: 'Linked Note', label: 'Alias' },
    ]);
    expect(child1?.noteText).toBe('Child 1 note paragraph');
    expect(child1?.childIds).toHaveLength(1);

    // Verify exact titleRange slice in LF-normalized text
    expect(child1?.titleRange).not.toBeNull();
    if (child1?.titleRange) {
      expect(md.slice(child1.titleRange.start, child1.titleRange.end)).toBe(child1.titleRaw);
    }

    const child2 = doc.nodes.get(branchA?.childIds[1] ?? '');
    expect(child2?.preservedPrefix).toBe('[x] ');
    expect(child2?.links).toEqual([
      { kind: 'url', target: 'https://example.com', label: 'https://example.com' },
    ]);

    // Unmapped blocks after blank line at indent 0 belong to parent heading (Branch A), not Child 2
    expect(branchA?.unmappedBlocks.map((b) => b.kind)).toEqual([
      'fenced-code',
      'callout',
      'table',
      'trailing-paragraph',
    ]);
    expect(child2?.unmappedBlocks).toEqual([]);

    // Unmapped blocks (code, callout, table, trailing paragraph) must not become topics
    const allTitles = [...doc.nodes.values()].map((n) => n.titleRaw);
    expect(allTitles).not.toContain('Not a heading');
    expect(allTitles).not.toContain('Not a list item');
    expect(allTitles).not.toContain('Not a list item either');

    const skippedHeading = doc.nodes.get(branchA?.childIds[2] ?? '');
    expect(skippedHeading?.headingLevel).toBe(4);
    expect(skippedHeading?.titleRaw).toBe('Skipped depth heading');
  });

  it('uses fallback filename as virtual central topic when no H1 exists', () => {
    const md = ['## Section 1', '- Item A', '## Section 2'].join('\n');
    const result = parseMarkdownToMap(md, 'My Note');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const root = result.document.nodes.get(result.document.rootId);
    expect(root?.kind).toBe('central-virtual');
    expect(root?.displayTitle).toBe('My Note');
    expect(root?.childIds).toHaveLength(2);
    expect(result.document.topicCount).toBe(3);
  });

  it('blocks notes with unclosed frontmatter', () => {
    const md = ['---', 'title: Broken', '# Heading'].join('\n');
    const result = parseMarkdownToMap(md, 'Broken');
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toBe('unclosed-frontmatter');
    }
  });

  it('blocks notes exceeding byte size limit before scanning', () => {
    const md = `# Title\n${'a'.repeat(500)}`;
    const result = parseMarkdownToMap(md, 'Big', { maxBytes: 128 });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toBe('file-too-large');
    }
  });

  it('allows exactly maxTopics and blocks at maxTopics + 1', () => {
    const makeNote = (count: number): string =>
      ['# Root', ...Array.from({ length: count }, (_, i) => `- Topic ${i + 1}`)].join('\n');

    const exact = parseMarkdownToMap(makeNote(5), 'Exact', { maxTopics: 5 });
    expect(exact.status).toBe('ok');
    if (exact.status === 'ok') {
      expect(exact.document.topicCount).toBe(5);
    }

    const over = parseMarkdownToMap(makeNote(6), 'Over', { maxTopics: 5 });
    expect(over.status).toBe('blocked');
    if (over.status === 'blocked') {
      expect(over.reason).toBe('too-many-topics');
    }
  });

  it('marks read-only on mixed line endings, bare CR, mixed list indents, and headings in lists', () => {
    const mixedEol = parseMarkdownToMap('# Root\r\n- A\n- B', 'Mixed');
    expect(mixedEol.status).toBe('ok');
    if (mixedEol.status === 'ok') {
      expect(mixedEol.document.readOnlyReasons).toContain('mixed-line-endings');
    }

    const bareCr = parseMarkdownToMap('# Root\r- A', 'CR');
    expect(bareCr.status).toBe('ok');
    if (bareCr.status === 'ok') {
      expect(bareCr.document.readOnlyReasons).toContain('bare-cr-line-endings');
    }

    const mixedIndent = parseMarkdownToMap('# Root\n- A\n  - Space child\n\t- Tab child', 'Indent');
    expect(mixedIndent.status).toBe('ok');
    if (mixedIndent.status === 'ok') {
      expect(mixedIndent.document.readOnlyReasons).toContain('mixed-list-indent');
    }

    const headingInList = parseMarkdownToMap('# Root\n- A\n  ## Nested heading', 'HeadingInList');
    expect(headingInList.status).toBe('ok');
    if (headingInList.status === 'ok') {
      expect(headingInList.document.readOnlyReasons).toContain('heading-inside-list');
    }
  });

  it('keeps uniform CRLF notes editable and preserves detected lineEnding', () => {
    const crlf = '# Root\r\n## Branch\r\n- Leaf\r\n';
    const result = parseMarkdownToMap(crlf, 'CRLF');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.document.lineEnding).toBe('\r\n');
    expect(result.document.readOnlyReasons).toEqual([]);
  });
  it('nests list items only at the parent content column, as CommonMark does', () => {
    const result = parseMarkdownToMap(
      '# R\n1. a\n  1. b\n1. c\n   1. d\n- e\n - f\n- g\n  - h\n',
      'F',
    );
    if (result.status !== 'ok') throw new Error('expected ok');
    const doc = result.document;
    const parentOf = (title: string): string | undefined => {
      const node = [...doc.nodes.values()].find((n) => n.titleRaw === title);
      return node?.parentId ? doc.nodes.get(node.parentId)?.titleRaw : undefined;
    };
    // "  1. b" does not reach the 3-column content of "1. a", so it is a sibling.
    expect(parentOf('a')).toBe('R');
    expect(parentOf('b')).toBe('R');
    expect(parentOf('c')).toBe('R');
    expect(parentOf('d')).toBe('c');
    // " - f" does not reach the 2-column content of "- e", so it is a sibling.
    expect(parentOf('e')).toBe('R');
    expect(parentOf('f')).toBe('R');
    expect(parentOf('g')).toBe('R');
    expect(parentOf('h')).toBe('g');
  });
});
