import { describe, expect, it } from 'vitest';
import type { MindMapDocument, TopicNode } from '../../src/core/model';
import { parseMarkdownToMap } from '../../src/core/parser';
import { extractSubtreeMarkdown, planAndValidatePatch } from '../../src/core/patch';
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
      type: 'renameAndInsertChild',
      guard: guardFor(doc, child),
      newTitle: 'New',
      childTitle: 'Child',
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

describe('M2-b structural edits, split, and task toggle', () => {
  it('deletes a branch cleanly (with/without trailing newline) and requires confirmation for unmapped blocks', () => {
    const mdNoEof = '# Root\n- A\n  - A1\n- B';
    const doc = parseOk(mdNoEof);
    const nodeA = findNode(doc, 'A');

    const delA = planAndValidatePatch(mdNoEof, doc, 'Test', {
      type: 'deleteBranch',
      guard: guardFor(doc, nodeA),
    });
    expect(delA.ok).toBe(true);
    if (!delA.ok) return;
    expect(delA.nextRawText).toBe('# Root\n- B');
    expect(delA.nextDocument.nodes.get(delA.focusNodeId)?.titleRaw).toBe('B');

    // Deleting last line without trailing newline must not leave a trailing newline
    const nodeB = findNode(delA.nextDocument, 'B');
    const delB = planAndValidatePatch(delA.nextRawText, delA.nextDocument, 'Test', {
      type: 'deleteBranch',
      guard: guardFor(delA.nextDocument, nodeB),
    });
    expect(delB.ok).toBe(true);
    if (!delB.ok) return;
    expect(delB.nextRawText).toBe('# Root');
    expect(delB.focusNodeId).toBe(delB.nextDocument.rootId);

    // Branch with unmapped block requires confirmation, then preserves other unmapped blocks
    const mdUnmapped = [
      '# Root',
      '## Keep',
      '> [!note] Survivor',
      '> intact',
      '## Remove',
      '```ts',
      'const gone = true;',
      '```',
      '',
    ].join('\n');
    const docU = parseOk(mdUnmapped);
    const removeNode = findNode(docU, 'Remove');

    const unconfirmed = planAndValidatePatch(mdUnmapped, docU, 'Test', {
      type: 'deleteBranch',
      guard: guardFor(docU, removeNode),
    });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) expect(unconfirmed.reason).toBe('unmapped-delete-requires-confirmation');

    const confirmed = planAndValidatePatch(mdUnmapped, docU, 'Test', {
      type: 'deleteBranch',
      guard: guardFor(docU, removeNode),
      confirmedUnmapped: true,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.nextRawText).toBe(['# Root', '## Keep', '> [!note] Survivor', '> intact', ''].join('\n'));
    expect(confirmed.nextDocument.nodes.get(confirmed.focusNodeId)?.titleRaw).toBe('Keep');

    // Cannot delete root
    const root = docU.nodes.get(docU.rootId);
    if (!root) return;
    const delRoot = planAndValidatePatch(mdUnmapped, docU, 'Test', {
      type: 'deleteBranch',
      guard: guardFor(docU, root),
    });
    expect(delRoot.ok).toBe(false);
    if (!delRoot.ok) expect(delRoot.reason).toBe('cannot-modify-root');
  });

  it('deletes a node while promoting children (headings, unordered lists, ordered lists) and blocks unsafe promotions', () => {
    // 1. Ordered list 3-space indent promotion
    const orderedMd = ['# Root', '1. Parent', '   1. Child 1', '      1. Grandchild', '   2. Child 2', ''].join('\n');
    const orderedDoc = parseOk(orderedMd);
    const parent = findNode(orderedDoc, 'Parent');
    const promoted = planAndValidatePatch(orderedMd, orderedDoc, 'Test', {
      type: 'deleteNodeKeepChildren',
      guard: guardFor(orderedDoc, parent),
    });
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    expect(promoted.nextRawText).toBe(
      ['# Root', '1. Child 1', '   1. Grandchild', '2. Child 2', ''].join('\n'),
    );
    expect(promoted.nextDocument.nodes.get(promoted.focusNodeId)?.titleRaw).toBe('Child 1');

    // 2. Heading promotion shifts heading children up by 1 level
    const headingMd = ['# Root', '## Wrapper', '### Sub A', '#### Deep A', '### Sub B', ''].join('\n');
    const headingDoc = parseOk(headingMd);
    const wrapper = findNode(headingDoc, 'Wrapper');
    const promotedHeading = planAndValidatePatch(headingMd, headingDoc, 'Test', {
      type: 'deleteNodeKeepChildren',
      guard: guardFor(headingDoc, wrapper),
    });
    expect(promotedHeading.ok).toBe(true);
    if (!promotedHeading.ok) return;
    expect(promotedHeading.nextRawText).toBe(
      ['# Root', '## Sub A', '### Deep A', '## Sub B', ''].join('\n'),
    );

    // 3. Reject when target owns a topic note
    const withNoteMd = '# Root\n- Parent\n  Note body\n  - Child\n';
    const withNoteDoc = parseOk(withNoteMd);
    const noteParent = findNode(withNoteDoc, 'Parent');
    const rejNote = planAndValidatePatch(withNoteMd, withNoteDoc, 'Test', {
      type: 'deleteNodeKeepChildren',
      guard: guardFor(withNoteDoc, noteParent),
    });
    expect(rejNote.ok).toBe(false);
    if (!rejNote.ok) expect(rejNote.reason).toBe('cannot-promote-with-note-or-unmapped');

    // 4. Reject when child subtree has indent-sensitive unmapped block
    const withCodeMd = ['# Root', '- Parent', '  - Child', '    ```js', '    1 + 1', '    ```', ''].join('\n');
    const withCodeDoc = parseOk(withCodeMd);
    const codeParent = findNode(withCodeDoc, 'Parent');
    const rejCode = planAndValidatePatch(withCodeMd, withCodeDoc, 'Test', {
      type: 'deleteNodeKeepChildren',
      guard: guardFor(withCodeDoc, codeParent),
    });
    expect(rejCode.ok).toBe(false);
    if (!rejCode.ok) expect(rejCode.reason).toBe('indent-sensitive-unmapped-block');
  });

  it('inserts a new parent above headings and lists while guarding H6 overflow and indent-sensitive blocks', () => {
    // 1. Heading wrap
    const headingMd = '# Root\n## Branch\n### Child\n- Leaf\n';
    const headingDoc = parseOk(headingMd);
    const branch = findNode(headingDoc, 'Branch');
    const wrappedH = planAndValidatePatch(headingMd, headingDoc, 'Test', {
      type: 'insertParent',
      guard: guardFor(headingDoc, branch),
      parentTitle: 'Group',
    });
    expect(wrappedH.ok).toBe(true);
    if (!wrappedH.ok) return;
    expect(wrappedH.nextRawText).toBe('# Root\n## Group\n### Branch\n#### Child\n- Leaf\n');
    expect(wrappedH.nextDocument.nodes.get(wrappedH.focusNodeId)?.titleRaw).toBe('Group');

    // 2. Reject H6 overflow
    const h6Md = '# Root\n##### H5\n###### H6\n';
    const h6Doc = parseOk(h6Md);
    const h5 = findNode(h6Doc, 'H5');
    const rejH6 = planAndValidatePatch(h6Md, h6Doc, 'Test', {
      type: 'insertParent',
      guard: guardFor(h6Doc, h5),
      parentTitle: 'Too Deep',
    });
    expect(rejH6.ok).toBe(false);
    if (!rejH6.ok) expect(rejH6.reason).toBe('heading-level-out-of-range');

    // 3. Ordered list wrap uses CommonMark 3-space child indent
    const orderedMd = '# Root\n1. Step\n   1. Substep\n';
    const orderedDoc = parseOk(orderedMd);
    const step = findNode(orderedDoc, 'Step');
    const wrappedO = planAndValidatePatch(orderedMd, orderedDoc, 'Test', {
      type: 'insertParent',
      guard: guardFor(orderedDoc, step),
      parentTitle: 'Phase',
    });
    expect(wrappedO.ok).toBe(true);
    if (!wrappedO.ok) return;
    expect(wrappedO.nextRawText).toBe('# Root\n1. Phase\n   1. Step\n      1. Substep\n');
  });

  it('reorders siblings up and down while preserving blank lines and indent-sensitive blocks', () => {
    const md = [
      '# Root',
      '## First',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '## Second',
      '- Leaf B',
      '',
    ].join('\n');
    const doc = parseOk(md);
    const second = findNode(doc, 'Second');

    const movedUp = planAndValidatePatch(md, doc, 'Test', {
      type: 'moveSibling',
      guard: guardFor(doc, second),
      direction: 'up',
    });
    expect(movedUp.ok).toBe(true);
    if (!movedUp.ok) return;
    expect(movedUp.nextRawText).toBe(
      [
        '# Root',
        '## Second',
        '- Leaf B',
        '',
        '## First',
        '```ts',
        'const a = 1;',
        '```',
        '',
      ].join('\n'),
    );
    expect(movedUp.nextDocument.nodes.get(movedUp.focusNodeId)?.titleRaw).toBe('Second');

    // Moving first sibling up returns boundary-no-op
    const movedSecond = movedUp.nextDocument.nodes.get(movedUp.focusNodeId);
    if (!movedSecond) return;
    const atTop = planAndValidatePatch(movedUp.nextRawText, movedUp.nextDocument, 'Test', {
      type: 'moveSibling',
      guard: guardFor(movedUp.nextDocument, movedSecond),
      direction: 'up',
    });
    expect(atTop.ok).toBe(false);
    if (!atTop.ok) expect(atTop.reason).toBe('boundary-no-op');

    // Moving back down restores original order
    const movedDown = planAndValidatePatch(movedUp.nextRawText, movedUp.nextDocument, 'Test', {
      type: 'moveSibling',
      guard: guardFor(movedUp.nextDocument, movedSecond),
      direction: 'down',
    });
    expect(movedDown.ok).toBe(true);
    if (!movedDown.ok) return;
    expect(movedDown.nextRawText).toBe(md);
  });

  it('indents and outdents lists and headings cleanly, relocating middle siblings on outdent without reparenting others', () => {
    // 1. Indent list item under ordered sibling (3 spaces)
    const md = '# Root\n1. First\n- Second\n  - Child\n';
    const doc = parseOk(md);
    const second = findNode(doc, 'Second');

    const indented = planAndValidatePatch(md, doc, 'Test', {
      type: 'indent',
      guard: guardFor(doc, second),
    });
    expect(indented.ok).toBe(true);
    if (!indented.ok) return;
    expect(indented.nextRawText).toBe('# Root\n1. First\n   - Second\n     - Child\n');

    // 2. Outdent middle child relocates it after parent so following siblings keep parent
    const midMd = [
      '# Root',
      '1. Parent',
      '   - Child A',
      '     - Grandchild A1',
      '   - Child B',
      '',
    ].join('\n');
    const midDoc = parseOk(midMd);
    const childA = findNode(midDoc, 'Child A');

    const outdented = planAndValidatePatch(midMd, midDoc, 'Test', {
      type: 'outdent',
      guard: guardFor(midDoc, childA),
    });
    expect(outdented.ok).toBe(true);
    if (!outdented.ok) return;
    expect(outdented.nextRawText).toBe(
      ['# Root', '1. Parent', '   - Child B', '- Child A', '  - Grandchild A1', ''].join('\n'),
    );
    const childBAfter = findNode(outdented.nextDocument, 'Child B');
    expect(outdented.nextDocument.nodes.get(childBAfter.parentId ?? '')?.titleRaw).toBe('Parent');

    // 3. Reject outdent of list item directly under heading (mixed heading/list)
    const mixedMd = '# Root\n## Section\n- Item\n';
    const mixedDoc = parseOk(mixedMd);
    const item = findNode(mixedDoc, 'Item');
    const rejMixed = planAndValidatePatch(mixedMd, mixedDoc, 'Test', {
      type: 'outdent',
      guard: guardFor(mixedDoc, item),
    });
    expect(rejMixed.ok).toBe(false);
    if (!rejMixed.ok) expect(rejMixed.reason).toBe('mixed-heading-list-conversion');
  });

  it('splits a topic atomically into two siblings while preserving task prefix and block ID', () => {
    const md = '# Root\n- [ ] Alpha Beta ^blk-9\n  - Sub\n';
    const doc = parseOk(md);
    const target = findNode(doc, 'Alpha Beta');

    const split = planAndValidatePatch(md, doc, 'Test', {
      type: 'splitSibling',
      guard: guardFor(doc, target),
      leftTitle: 'Alpha',
      rightTitle: 'Beta',
    });
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.nextRawText).toBe('# Root\n- [ ] Alpha ^blk-9\n  - Sub\n- Beta\n');
    expect(split.nextDocument.nodes.get(split.focusNodeId)?.titleRaw).toBe('Beta');
  });

  it('toggles standard [ ] / [x] task checkboxes with a 1-char edit while rejecting non-tasks and custom markers', () => {
    const md = '# Root\n- [ ] Write tests ^task-1\n- [-] Cancelled item\n- Plain item\n';
    const doc = parseOk(md);
    const todo = findNode(doc, 'Write tests');

    const checked = planAndValidatePatch(md, doc, 'Test', {
      type: 'toggleTask',
      guard: guardFor(doc, todo),
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.edits).toHaveLength(1);
    expect(checked.nextRawText).toBe('# Root\n- [x] Write tests ^task-1\n- [-] Cancelled item\n- Plain item\n');

    const checkedNode = checked.nextDocument.nodes.get(checked.focusNodeId);
    if (!checkedNode) return;
    const unchecked = planAndValidatePatch(checked.nextRawText, checked.nextDocument, 'Test', {
      type: 'toggleTask',
      guard: guardFor(checked.nextDocument, checkedNode),
    });
    expect(unchecked.ok).toBe(true);
    if (!unchecked.ok) return;
    expect(unchecked.nextRawText).toBe(md);

    // Custom [-] marker and plain list item are rejected
    const cancelled = findNode(doc, 'Cancelled item');
    const rejCustom = planAndValidatePatch(md, doc, 'Test', {
      type: 'toggleTask',
      guard: guardFor(doc, cancelled),
    });
    expect(rejCustom.ok).toBe(false);
    if (!rejCustom.ok) expect(rejCustom.reason).toBe('not-a-task');

    const plain = findNode(doc, 'Plain item');
    const rejPlain = planAndValidatePatch(md, doc, 'Test', {
      type: 'toggleTask',
      guard: guardFor(doc, plain),
    });
    expect(rejPlain.ok).toBe(false);
    if (!rejPlain.ok) expect(rejPlain.reason).toBe('not-a-task');
  });
});

describe('M2-c updateNote, reparent (D&D), and pasteBranch (copy/paste)', () => {
  it('adds, edits, and deletes topic notes on headings and ordered list items while preserving unmapped blocks and rejecting block syntax', () => {
    const md = [
      '# Root',
      '## Section',
      '```ts',
      'const untouched = 1;',
      '```',
      '1. Ordered Item',
      '   1. Sub',
      '',
    ].join('\n');
    const doc = parseOk(md);
    const section = findNode(doc, 'Section');

    // 1. Add multi-line note to heading (above preserved fenced code block)
    const added = planAndValidatePatch(md, doc, 'Test', {
      type: 'updateNote',
      guard: guardFor(doc, section),
      newNoteBody: 'First paragraph\n\nSecond paragraph',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.nextRawText).toBe(
      [
        '# Root',
        '## Section',
        'First paragraph',
        '',
        'Second paragraph',
        '```ts',
        'const untouched = 1;',
        '```',
        '1. Ordered Item',
        '   1. Sub',
        '',
      ].join('\n'),
    );
    expect(added.nextDocument.nodes.get(added.focusNodeId)?.noteText).toBe(
      'First paragraph\n\nSecond paragraph',
    );

    // 2. Update existing note
    const section2 = findNode(added.nextDocument, 'Section');
    const updated = planAndValidatePatch(added.nextRawText, added.nextDocument, 'Test', {
      type: 'updateNote',
      guard: guardFor(added.nextDocument, section2),
      newNoteBody: 'Updated single paragraph',
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.nextDocument.nodes.get(updated.focusNodeId)?.noteText).toBe(
      'Updated single paragraph',
    );

    // 3. Delete note by saving empty string
    const section3 = findNode(updated.nextDocument, 'Section');
    const deleted = planAndValidatePatch(updated.nextRawText, updated.nextDocument, 'Test', {
      type: 'updateNote',
      guard: guardFor(updated.nextDocument, section3),
      newNoteBody: '   \n  ',
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.nextRawText).toBe(md);

    // 4. Add multi-paragraph note on ordered list item -> auto-indents to 3 spaces
    const ordered = findNode(deleted.nextDocument, 'Ordered Item');
    const orderedNote = planAndValidatePatch(deleted.nextRawText, deleted.nextDocument, 'Test', {
      type: 'updateNote',
      guard: guardFor(deleted.nextDocument, ordered),
      newNoteBody: 'Line one\n\nLine two',
    });
    expect(orderedNote.ok).toBe(true);
    if (!orderedNote.ok) return;
    expect(orderedNote.nextRawText).toContain('1. Ordered Item\n   Line one\n\n   Line two\n   1. Sub\n');
    expect(orderedNote.nextDocument.nodes.get(orderedNote.focusNodeId)?.noteText).toBe(
      'Line one\n\nLine two',
    );

    // 5. Reject Markdown block syntax inside topic notes (fail-closed)
    for (const badBody of [
      '## Heading in note',
      '- List item in note',
      '```js\ncode()\n```',
      '> Blockquote',
      '| A | B |\n|---|---|\n| 1 | 2 |',
      '$$\nx^2\n$$',
      '---',
      '<div>html</div>',
    ]) {
      const rejected = planAndValidatePatch(md, doc, 'Test', {
        type: 'updateNote',
        guard: guardFor(doc, section),
        newNoteBody: badBody,
      });
      expect(rejected.ok).toBe(false);
      if (!rejected.ok) expect(rejected.reason).toBe('invalid-note-block-syntax');
    }
  });

  it('reparents headings and list subtrees across parents with level/indent adjustment and safety guards', () => {
    // 1. Reparent heading under another heading -> shifts heading levels automatically
    const headingMd = [
      '# Root',
      '## Branch A',
      '### Child A1',
      '## Branch B',
      '### Child B1',
      '',
    ].join('\n');
    const headingDoc = parseOk(headingMd);
    const branchA = findNode(headingDoc, 'Branch A');
    const branchB = findNode(headingDoc, 'Branch B');

    const movedHeading = planAndValidatePatch(headingMd, headingDoc, 'Test', {
      type: 'reparent',
      guard: guardFor(headingDoc, branchA),
      targetParentId: branchB.id,
      index: 1,
    });
    expect(movedHeading.ok).toBe(true);
    if (!movedHeading.ok) return;
    expect(movedHeading.nextRawText).toBe(
      ['# Root', '## Branch B', '### Child B1', '### Branch A', '#### Child A1', ''].join('\n'),
    );
    const movedANode = movedHeading.nextDocument.nodes.get(movedHeading.focusNodeId);
    expect(movedANode?.titleRaw).toBe('Branch A');
    expect(movedANode?.headingLevel).toBe(3);

    // 2. Reparent list subtree across parents (preserving nested children & adjusting indent)
    const listMd = [
      '# Root',
      '- Alpha',
      '  - Alpha 1',
      '    - Alpha 1a',
      '- Beta',
      '  - Beta 1',
      '',
    ].join('\n');
    const listDoc = parseOk(listMd);
    const alpha1 = findNode(listDoc, 'Alpha 1');
    const beta = findNode(listDoc, 'Beta');
    const reparentList = planAndValidatePatch(listMd, listDoc, 'Test', {
      type: 'reparent',
      guard: guardFor(listDoc, alpha1),
      targetParentId: beta.id,
      index: 0,
    });
    expect(reparentList.ok).toBe(true);
    if (!reparentList.ok) return;
    expect(reparentList.nextRawText).toBe(
      ['# Root', '- Alpha', '- Beta', '  - Alpha 1', '    - Alpha 1a', '  - Beta 1', ''].join(
        '\n',
      ),
    );

    // 3. Reject cycle (moving parent under its own descendant)
    const alpha = findNode(listDoc, 'Alpha');
    const alpha1a = findNode(listDoc, 'Alpha 1a');
    const cycle = planAndValidatePatch(listMd, listDoc, 'Test', {
      type: 'reparent',
      guard: guardFor(listDoc, alpha),
      targetParentId: alpha1a.id,
      index: 0,
    });
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.reason).toBe('boundary-no-op');

    // 4. Reject heading under list item (mixed heading/list conversion)
    const mixedMd = '# Root\n## Head\n- Item\n';
    const mixedDoc = parseOk(mixedMd);
    const head = findNode(mixedDoc, 'Head');
    const item = findNode(mixedDoc, 'Item');
    const mixedRej = planAndValidatePatch(mixedMd, mixedDoc, 'Test', {
      type: 'reparent',
      guard: guardFor(mixedDoc, head),
      targetParentId: item.id,
      index: 0,
    });
    expect(mixedRej.ok).toBe(false);
    if (!mixedRej.ok) expect(mixedRej.reason).toBe('boundary-no-op'); // item is descendant of head

    const sepMixedMd = '# Root\n## Head A\n## Head B\n- Item B\n';
    const sepMixedDoc = parseOk(sepMixedMd);
    const headA = findNode(sepMixedDoc, 'Head A');
    const itemB = findNode(sepMixedDoc, 'Item B');
    const sepMixedRej = planAndValidatePatch(sepMixedMd, sepMixedDoc, 'Test', {
      type: 'reparent',
      guard: guardFor(sepMixedDoc, headA),
      targetParentId: itemB.id,
      index: 0,
    });
    expect(sepMixedRej.ok).toBe(false);
    if (!sepMixedRej.ok) expect(sepMixedRej.reason).toBe('mixed-heading-list-conversion');
  });

  it('extracts and pastes heading branches, deeply indented list branches (4+ spaces), and plain text cleanly', () => {
    const md = [
      '# Root',
      '## Source',
      '- L1',
      '  - L2',
      '    - Deep L3',
      '      - Deep L4',
      '## Target',
      '```ts',
      'const keep = true;',
      '```',
      '',
    ].join('\n');
    const doc = parseOk(md);
    const source = findNode(doc, 'Source');
    const deepL3 = findNode(doc, 'Deep L3');
    const target = findNode(doc, 'Target');

    // 1. Copy & paste deeply indented list subtree (4 spaces) directly under ## Target
    const copiedDeep = extractSubtreeMarkdown(md, deepL3);
    expect(copiedDeep).toBe('    - Deep L3\n      - Deep L4');

    const pastedDeep = planAndValidatePatch(md, doc, 'Test', {
      type: 'pasteBranch',
      guard: guardFor(doc, target),
      subtreeMarkdown: copiedDeep,
    });
    expect(pastedDeep.ok).toBe(true);
    if (!pastedDeep.ok) return;
    expect(pastedDeep.nextRawText).toContain('```\n- Deep L3\n  - Deep L4\n');
    expect(pastedDeep.nextDocument.nodes.get(pastedDeep.focusNodeId)?.titleRaw).toBe('Deep L3');

    // 2. Copy & paste heading subtree into another heading -> shifts ## -> ###
    const copiedHeading = extractSubtreeMarkdown(md, source);
    const pastedHeading = planAndValidatePatch(md, doc, 'Test', {
      type: 'pasteBranch',
      guard: guardFor(doc, target),
      subtreeMarkdown: copiedHeading,
    });
    expect(pastedHeading.ok).toBe(true);
    if (!pastedHeading.ok) return;
    expect(pastedHeading.nextRawText).toContain('### Source\n- L1\n  - L2\n    - Deep L3\n      - Deep L4\n');
    expect(pastedHeading.nextDocument.nodes.get(pastedHeading.focusNodeId)?.headingLevel).toBe(3);

    // 3. Plain single-line text pastes as a child topic
    const pastedPlain = planAndValidatePatch(md, doc, 'Test', {
      type: 'pasteBranch',
      guard: guardFor(doc, target),
      subtreeMarkdown: 'Plain Idea',
    });
    expect(pastedPlain.ok).toBe(true);
    if (!pastedPlain.ok) return;
    expect(pastedPlain.nextDocument.nodes.get(pastedPlain.focusNodeId)?.titleRaw).toBe('Plain Idea');

    // 4. Multi-line non-topic text is rejected cleanly
    const pastedBad = planAndValidatePatch(md, doc, 'Test', {
      type: 'pasteBranch',
      guard: guardFor(doc, target),
      subtreeMarkdown: 'Line one\nLine two',
    });
    expect(pastedBad.ok).toBe(false);
    if (!pastedBad.ok) expect(pastedBad.reason).toBe('invalid-note-block-syntax');
  });

  it('rejects moveSibling when swapping unevenly indented list siblings would reparent an adjacent subtree', () => {
    const md = '# Root\n- P\n      - A\n  - B\n    - C\n';
    const doc = parseOk(md);
    const nodeB = findNode(doc, 'B');
    const res = planAndValidatePatch(md, doc, 'Test', {
      type: 'moveSibling',
      guard: guardFor(doc, nodeB),
      direction: 'up',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('invariant-check-failed');
    }
  });

  it('allows deleting the final child in a CRLF document when no line endings remain', () => {
    const crlfMd = '# Root\r\n- A';
    const doc = parseOk(crlfMd);
    expect(doc.lineEnding).toBe('\r\n');
    const nodeA = findNode(doc, 'A');

    const delBranch = planAndValidatePatch(crlfMd, doc, 'Test', {
      type: 'deleteBranch',
      guard: guardFor(doc, nodeA),
    });
    expect(delBranch.ok).toBe(true);
    if (delBranch.ok) {
      expect(delBranch.nextRawText).toBe('# Root');
    }

    const delKeep = planAndValidatePatch(crlfMd, doc, 'Test', {
      type: 'deleteNodeKeepChildren',
      guard: guardFor(doc, nodeA),
    });
    expect(delKeep.ok).toBe(true);
    if (delKeep.ok) {
      expect(delKeep.nextRawText).toBe('# Root');
    }
  });
});
