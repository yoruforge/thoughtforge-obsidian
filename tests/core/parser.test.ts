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

  it('terminates HTML comments and declarations at their closing delimiter without swallowing headings', () => {
    const singleLine = '# Root\n<!-- comment -->\n## Branch\n- Child\n';
    const r1 = parseMarkdownToMap(singleLine, 'Root');
    expect(r1.status).toBe('ok');
    if (r1.status !== 'ok') return;
    const titles1 = [...r1.document.nodes.values()].map((n) => n.titleRaw);
    expect(titles1).toEqual(['Root', 'Branch', 'Child']);

    const multiLine = '# Root\n<!--\n  line 1\n  line 2\n-->\n## Branch\n- Child\n';
    const r2 = parseMarkdownToMap(multiLine, 'Root');
    expect(r2.status).toBe('ok');
    if (r2.status !== 'ok') return;
    const titles2 = [...r2.document.nodes.values()].map((n) => n.titleRaw);
    expect(titles2).toEqual(['Root', 'Branch', 'Child']);
  });

  it('resolves dedented paragraph ownership back to the outer list item after a nested child', () => {
    const md = '# Root\n- Parent\n  - Child\n\n  Parent details\n';
    const res = parseMarkdownToMap(md, 'Root');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    const parent = [...res.document.nodes.values()].find((n) => n.titleRaw === 'Parent');
    const child = [...res.document.nodes.values()].find((n) => n.titleRaw === 'Child');
    expect(parent).toBeDefined();
    expect(child).toBeDefined();
    if (!parent || !child) return;

    // Child MUST NOT absorb "Parent details" as its note or subtree range
    expect(child.noteText).toBeNull();
    expect(child.subtreeRange).toEqual({ startLine: 2, endLine: 3 });
    // Parent owns "Parent details" as a preserved trailing unmapped block
    expect(parent.unmappedBlocks.some((b) => b.range.startLine === 4 && b.range.endLine === 5)).toBe(
      true,
    );
  });

  it('parses Markdown links with balanced parentheses and angle-bracket destinations while ignoring code spans (Codex #5cb909c4 / #7822c46c)', () => {
    const md = [
      '# Root',
      '- [Plan Paren](Plan(1).md)',
      '- [Plan Space](<Plan One.md>)',
      '- [Plan Quoted](<Plan (2).md> "title")',
      '- Code `[Fake](ignored.md)` real [Real](<Sub Dir/My (Note).md>)',
      '',
    ].join('\n');
    const res = parseMarkdownToMap(md, 'Root');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;

    const getByDisplay = (label: string) =>
      [...res.document.nodes.values()].find((n) => n.displayTitle.includes(label));

    const parenNode = getByDisplay('Plan Paren');
    const spaceNode = getByDisplay('Plan Space');
    const quotedNode = getByDisplay('Plan Quoted');
    const codeAndReal = getByDisplay('Code');
    expect(parenNode && spaceNode && quotedNode && codeAndReal).toBeTruthy();
    if (!parenNode || !spaceNode || !quotedNode || !codeAndReal) return;

    expect(parenNode.displayTitle).toBe('Plan Paren');
    expect(parenNode.links).toEqual([{ kind: 'markdown', target: 'Plan(1).md', label: 'Plan Paren' }]);

    expect(spaceNode.displayTitle).toBe('Plan Space');
    expect(spaceNode.links).toEqual([{ kind: 'markdown', target: 'Plan One.md', label: 'Plan Space' }]);

    expect(quotedNode.displayTitle).toBe('Plan Quoted');
    expect(quotedNode.links).toEqual([
      { kind: 'markdown', target: 'Plan (2).md', label: 'Plan Quoted' },
    ]);

    expect(codeAndReal.displayTitle).toBe('Code `[Fake](ignored.md)` real Real');
    expect(codeAndReal.links).toEqual([
      { kind: 'markdown', target: 'Sub Dir/My (Note).md', label: 'Real' },
    ]);
  });
  it('keeps code brackets inside link labels and preserves Wiki alias pipes', () => {
    const labels = ['Use `[` operator', 'Use `]` operator', 'Use ``a ` ]`` operator'];
    const md = ['# Root', ...labels.map(label => '- [' + label + '](Plan.md)'),
      '- [[Plan|A | B]]', '- [](Plan.md)'].join('\n');
    const result = parseMarkdownToMap(md, 'Root');
    if (result.status !== 'ok') throw new Error(result.detail);
    const topics = [...result.document.nodes.values()].slice(1);
    expect(topics.map(n => n.displayTitle)).toEqual([...labels, 'A | B', 'Plan.md']);
    expect(topics.map(n => n.links[0]?.target)).toEqual(['Plan.md', 'Plan.md', 'Plan.md', 'Plan', 'Plan.md']);
  });

});
