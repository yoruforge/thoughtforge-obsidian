import { describe, expect, it } from 'vitest';
import type { MindMapDocument, TopicNode } from '../../src/core/model';
import { parseMarkdownToMap } from '../../src/core/parser';
import { planAndValidatePatch } from '../../src/core/patch';
import type { PatchGuard } from '../../src/core/patch/commands';

function parseOk(md: string, fallback = 'TestNote'): MindMapDocument {
  const result = parseMarkdownToMap(md, fallback);
  if (result.status !== 'ok') {
    throw new Error(`Expected ok parse result, got blocked: ${result.reason}`);
  }
  return result.document;
}

function findNode(doc: MindMapDocument, titleRaw: string): TopicNode {
  const found = [...doc.nodes.values()].find((node) => node.titleRaw === titleRaw);
  if (!found) {
    throw new Error(`Node "${titleRaw}" not found`);
  }
  return found;
}

function guardFor(doc: MindMapDocument, node: TopicNode): PatchGuard {
  return {
    expectedContentHash: doc.contentHash,
    targetNodeId: node.id,
    expectedTitleRaw: node.titleRaw,
    expectedOwnRangeHash: node.ownRangeHash,
  };
}

describe('M2-a core patch engine', () => {
  it('renames a topic with minimal diff while preserving task prefix, block ID, and all unmapped blocks byte-for-byte', () => {
    const fencedCode = ['```ts', '# not a heading', '- not a list', '```'].join('\n');
    const callout = ['> [!note] Keep me', '> exact content'].join('\n');
    const table = ['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const frontmatter = ['---', 'title: Demo', '---'].join('\n');

    const md = [
      frontmatter,
      '# Central',
      '## Branch A',
      '- [ ] Old [[Target|Alias]] ^blk-42',
      '  Child note line',
      '',
      fencedCode,
      '',
      callout,
      '',
      table,
      '',
    ].join('\n');

    const doc = parseOk(md);
    const target = findNode(doc, 'Old [[Target|Alias]]');

    const result = planAndValidatePatch(md, doc, 'TestNote', {
      type: 'rename',
      guard: guardFor(doc, target),
      newTitle: 'Updated [[Target|New]]',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.nextRawText).toContain('- [ ] Updated [[Target|New]] ^blk-42');
    expect(result.nextRawText).toContain(frontmatter);
    expect(result.nextRawText).toContain(fencedCode);
    expect(result.nextRawText).toContain(callout);
    expect(result.nextRawText).toContain(table);
    expect(result.nextRawText.endsWith('\n')).toBe(true);
    expect(result.nextDocument.nodes.get(result.focusNodeId)?.preservedPrefix).toBe('[ ] ');
    expect(result.nextDocument.nodes.get(result.focusNodeId)?.preservedBlockId).toBe('^blk-42');
  });

  it('promotes a virtual central topic by inserting H1 right after frontmatter without touching body', () => {
    const md = ['---', 'tags: [mindmap]', '---', '## First Branch', '- Leaf'].join('\n');
    const doc = parseOk(md, 'FallbackTitle');
    const root = doc.nodes.get(doc.rootId);
    expect(root?.kind).toBe('central-virtual');
    if (!root) return;

    const result = planAndValidatePatch(md, doc, 'FallbackTitle', {
      type: 'rename',
      guard: guardFor(doc, root),
      newTitle: 'Real Central Title',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.nextRawText).toBe(
      ['---', 'tags: [mindmap]', '---', '# Real Central Title', '## First Branch', '- Leaf'].join(
        '\n',
      ),
    );
    expect(result.nextDocument.nodes.get(result.nextDocument.rootId)?.kind).toBe('heading');
    expect(result.nextDocument.nodes.get(result.nextDocument.rootId)?.titleRaw).toBe(
      'Real Central Title',
    );
  });

  it('rejects newline, empty title, and metadata-corrupting title edits', () => {
    const md = '# Root\n- Plain Task\n';
    const doc = parseOk(md);
    const task = findNode(doc, 'Plain Task');

    const withNewline = planAndValidatePatch(md, doc, 'Test', {
      type: 'rename',
      guard: guardFor(doc, task),
      newTitle: 'Line 1\nLine 2',
    });
    expect(withNewline.ok).toBe(false);
    if (!withNewline.ok) expect(withNewline.reason).toBe('newline-in-title');

    const empty = planAndValidatePatch(md, doc, 'Test', {
      type: 'rename',
      guard: guardFor(doc, task),
      newTitle: '   ',
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('empty-title');

    const forgedBlockId = planAndValidatePatch(md, doc, 'Test', {
      type: 'rename',
      guard: guardFor(doc, task),
      newTitle: 'Sneaky ^other-id',
    });
    expect(forgedBlockId.ok).toBe(false);
    if (!forgedBlockId.ok) expect(forgedBlockId.reason).toBe('invariant-check-failed');

    const forgedTaskPrefix = planAndValidatePatch(md, doc, 'Test', {
      type: 'rename',
      guard: guardFor(doc, task),
      newTitle: '[x] Forged task',
    });
    expect(forgedTaskPrefix.ok).toBe(false);
    if (!forgedTaskPrefix.ok) expect(forgedTaskPrefix.reason).toBe('invariant-check-failed');
  });

  it('inserts children using matching heading/list styles and preserves tab indentation', () => {
    const md = ['# Root', '## Branch A', '- Item 1', '\t- Sub 1', '## Branch B'].join('\n');
    const doc = parseOk(md);

    // 1. Insert child under heading with existing list child -> inherits marker and indent
    const branchA = findNode(doc, 'Branch A');
    const childUnderA = planAndValidatePatch(md, doc, 'Test', {
      type: 'insertChild',
      guard: guardFor(doc, branchA),
      title: 'Item 2',
      position: 'end',
    });
    expect(childUnderA.ok).toBe(true);
    if (!childUnderA.ok) return;
    expect(childUnderA.nextRawText).toBe(
      ['# Root', '## Branch A', '- Item 1', '\t- Sub 1', '- Item 2', '## Branch B'].join('\n'),
    );
    expect(childUnderA.nextDocument.readOnlyReasons).toEqual([]);

    // 2. Insert child under tab-indented leaf list item -> adds one tab level without mixing spaces
    const sub1 = findNode(childUnderA.nextDocument, 'Sub 1');
    const childUnderSub1 = planAndValidatePatch(
      childUnderA.nextRawText,
      childUnderA.nextDocument,
      'Test',
      {
        type: 'insertChild',
        guard: guardFor(childUnderA.nextDocument, sub1),
        title: 'Deep 1',
      },
    );
    expect(childUnderSub1.ok).toBe(true);
    if (!childUnderSub1.ok) return;
    expect(childUnderSub1.nextRawText).toContain('\t\t- Deep 1');
    expect(childUnderSub1.nextDocument.readOnlyReasons).toEqual([]);

    // 3. Insert child under H1 with existing H2 children -> adds H2 at end
    const root = doc.nodes.get(doc.rootId);
    if (!root) return;
    const childUnderRoot = planAndValidatePatch(md, doc, 'Test', {
      type: 'insertChild',
      guard: guardFor(doc, root),
      title: 'Branch C',
    });
    expect(childUnderRoot.ok).toBe(true);
    if (!childUnderRoot.ok) return;
    expect(childUnderRoot.nextRawText.endsWith('\n## Branch C')).toBe(true);
  });

  it('inserts a blank separator before inserting after an HTML block so the block is not corrupted', () => {
    const md = ['# Root', '## Branch', '<div>keep intact</div>'].join('\n');
    const doc = parseOk(md);
    const branch = findNode(doc, 'Branch');

    const result = planAndValidatePatch(md, doc, 'Test', {
      type: 'insertChild',
      guard: guardFor(doc, branch),
      title: 'Safe Child',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nextRawText).toBe(
      ['# Root', '## Branch', '<div>keep intact</div>', '', '- Safe Child'].join('\n'),
    );
    expect(result.nextDocument.topicCount).toBe(2);
  });

  it('inserts siblings before and after a topic subtree and increments ordered markers', () => {
    const md = ['# Root', '## Section', '1. First', '   - Nested', '2. Second'].join('\n');
    const doc = parseOk(md);
    const first = findNode(doc, 'First');

    const afterResult = planAndValidatePatch(md, doc, 'Test', {
      type: 'insertSibling',
      guard: guardFor(doc, first),
      title: 'Inserted After',
      placement: 'after',
    });
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.nextRawText).toBe(
      ['# Root', '## Section', '1. First', '   - Nested', '2. Inserted After', '2. Second'].join(
        '\n',
      ),
    );

    const beforeResult = planAndValidatePatch(md, doc, 'Test', {
      type: 'insertSibling',
      guard: guardFor(doc, first),
      title: 'Inserted Before',
      placement: 'before',
    });
    expect(beforeResult.ok).toBe(true);
    if (!beforeResult.ok) return;
    expect(beforeResult.nextRawText).toBe(
      ['# Root', '## Section', '1. Inserted Before', '1. First', '   - Nested', '2. Second'].join(
        '\n',
      ),
    );
  });

  it('rejects sibling insertion on root, read-only documents, stale guards, and unsupported commands', () => {
    const md = '# Root\n- Child\n';
    const doc = parseOk(md);
    const root = doc.nodes.get(doc.rootId);
    const child = findNode(doc, 'Child');
    if (!root) return;

    const rootSib = planAndValidatePatch(md, doc, 'Test', {
      type: 'insertSibling',
      guard: guardFor(doc, root),
      title: 'Nope',
      placement: 'after',
    });
    expect(rootSib.ok).toBe(false);
    if (!rootSib.ok) expect(rootSib.reason).toBe('cannot-insert-sibling-for-root');

    const stale = planAndValidatePatch(md, doc, 'Test', {
      type: 'rename',
      guard: { ...guardFor(doc, child), expectedContentHash: 'deadbeef00000000' },
      newTitle: 'Changed',
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe('stale-target');

    const unsupported = planAndValidatePatch(md, doc, 'Test', {
      type: 'deleteBranch',
      guard: guardFor(doc, child),
    });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) expect(unsupported.reason).toBe('unsupported-command');

    const mixedMd = '# Root\r\n- A\n- B';
    const mixedDoc = parseOk(mixedMd);
    const nodeA = findNode(mixedDoc, 'A');
    const readOnly = planAndValidatePatch(mixedMd, mixedDoc, 'Test', {
      type: 'rename',
      guard: guardFor(mixedDoc, nodeA),
      newTitle: 'Blocked',
    });
    expect(readOnly.ok).toBe(false);
    if (!readOnly.ok) expect(readOnly.reason).toBe('read-only-document');
  });

  it('preserves uniform CRLF line endings across consecutive edits', () => {
    const crlf = '# Root\r\n## Branch\r\n- Leaf\r\n';
    const doc = parseOk(crlf);
    const leaf = findNode(doc, 'Leaf');

    const firstEdit = planAndValidatePatch(crlf, doc, 'CRLF', {
      type: 'insertSibling',
      guard: guardFor(doc, leaf),
      title: 'Leaf 2',
      placement: 'after',
    });
    expect(firstEdit.ok).toBe(true);
    if (!firstEdit.ok) return;
    expect(firstEdit.nextRawText).toBe('# Root\r\n## Branch\r\n- Leaf\r\n- Leaf 2\r\n');
    expect(firstEdit.nextDocument.lineEnding).toBe('\r\n');

    const leaf2 = firstEdit.nextDocument.nodes.get(firstEdit.focusNodeId);
    expect(leaf2?.titleRaw).toBe('Leaf 2');
    if (!leaf2) return;

    const secondEdit = planAndValidatePatch(firstEdit.nextRawText, firstEdit.nextDocument, 'CRLF', {
      type: 'rename',
      guard: guardFor(firstEdit.nextDocument, leaf2),
      newTitle: 'Leaf Two',
    });
    expect(secondEdit.ok).toBe(true);
    if (!secondEdit.ok) return;
    expect(secondEdit.nextRawText).toBe('# Root\r\n## Branch\r\n- Leaf\r\n- Leaf Two\r\n');
    expect(secondEdit.nextDocument.lineEnding).toBe('\r\n');
  });
  it('nests a first child under an ordered item at the CommonMark content column', () => {
    for (const [md, parentTitle, expected] of [
      ['# R\n1. a\n', 'a', '# R\n1. a\n   1. x\n'],
      ['# R\n10. a\n', 'a', '# R\n10. a\n    1. x\n'],
      ['# R\n-   a\n', 'a', '# R\n-   a\n    - x\n'],
      ['# R\n- a\n', 'a', '# R\n- a\n  - x\n'],
    ] as const) {
      const doc = parseOk(md);
      const parent = findNode(doc, parentTitle);
      const result = planAndValidatePatch(md, doc, 'TestNote', {
        type: 'insertChild',
        guard: guardFor(doc, parent),
        title: 'x',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.nextRawText).toBe(expected);
      const child = findNode(result.nextDocument, 'x');
      expect(result.nextDocument.nodes.get(child.parentId ?? '')?.titleRaw).toBe(parentTitle);
    }
  });

  it('rejects list topic titles that start with Markdown block syntax but allows them on headings', () => {
    const md = '# R\n## H\n- a\n';
    const doc = parseOk(md);
    const item = findNode(doc, 'a');
    for (const title of ['# x', '1. x', '- x', '> x', '```', '---', '<div>']) {
      for (const command of [
        { type: 'rename', guard: guardFor(doc, item), newTitle: title },
        { type: 'insertSibling', guard: guardFor(doc, item), title, placement: 'after' },
        { type: 'insertChild', guard: guardFor(doc, item), title },
      ] as const) {
        const result = planAndValidatePatch(md, doc, 'TestNote', command);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('block-syntax-in-title');
      }
    }

    const heading = findNode(doc, 'H');
    const renamed = planAndValidatePatch(md, doc, 'TestNote', {
      type: 'rename',
      guard: guardFor(doc, heading),
      newTitle: '1. Overview',
    });
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.nextRawText).toBe('# R\n## 1. Overview\n- a\n');
  });
});
