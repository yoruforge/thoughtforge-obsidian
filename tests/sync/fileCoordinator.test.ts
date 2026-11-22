import { describe, expect, it } from 'vitest';
import type { MindMapDocument, TopicNode } from '../../src/core/model';
import { parseMarkdownToMap } from '../../src/core/parser';
import type { PatchGuard } from '../../src/core/patch/commands';
import { FileCoordinator } from '../../src/sync/FileCoordinator';
import type { ObsidianHostPort } from '../../src/sync/ports';

class InMemoryHost implements ObsidianHostPort {
  readonly files = new Map<string, string>();
  editorState: 'clean' | 'dirty' | 'unknown' | 'throw' = 'clean';
  editorStateInsideProcess: 'clean' | 'dirty' | 'unknown' | 'throw' | null = null;
  processCalls = 0;
  processDelayMs = 0;
  failNextIo = false;

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`Missing file ${path}`);
    }
    return content;
  }

  async processFile(path: string, transform: (current: string) => string): Promise<void> {
    this.processCalls += 1;
    if (this.processDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.processDelayMs));
    }
    if (this.editorStateInsideProcess !== null) {
      this.editorState = this.editorStateInsideProcess;
      this.editorStateInsideProcess = null;
    }
    if (this.failNextIo) {
      this.failNextIo = false;
      throw new Error('Disk write failed');
    }
    const current = this.files.get(path);
    if (current === undefined) {
      throw new Error(`Missing file ${path}`);
    }
    const next = transform(current);
    this.files.set(path, next);
  }

  inspectOpenMarkdownEditors(
    _path: string,
  ): { readonly state: 'clean' } | { readonly state: 'dirty' } | { readonly state: 'unknown' } {
    if (this.editorState === 'throw') {
      throw new Error('Workspace inspection unavailable');
    }
    return { state: this.editorState };
  }

  async revealSourceLine(_path: string, _line: number): Promise<void> {
    // No-op in memory mock
  }

  async openLink(_sourcePath: string, _linkText: string, _newTab: boolean): Promise<void> {
    // No-op in memory mock
  }
}

function parseOk(md: string): MindMapDocument {
  const res = parseMarkdownToMap(md, 'Note');
  if (res.status !== 'ok') throw new Error('Parse failed');
  return res.document;
}

function findNode(doc: MindMapDocument, title: string): TopicNode {
  const node = [...doc.nodes.values()].find((n) => n.titleRaw === title);
  if (!node) throw new Error(`Missing node ${title}`);
  return node;
}

function guardFor(doc: MindMapDocument, node: TopicNode): PatchGuard {
  return {
    expectedContentHash: doc.contentHash,
    targetNodeId: node.id,
    expectedTitleRaw: node.titleRaw,
    expectedOwnRangeHash: node.ownRangeHash,
  };
}

describe('FileCoordinator', () => {
  it('applies sequential rename, insertChild, and insertSibling edits through processFile', async () => {
    const host = new InMemoryHost();
    const path = 'notes/demo.md';
    host.files.set(path, '# Root\n## Branch A\n');
    const coordinator = new FileCoordinator(host);

    const doc1 = parseOk(host.files.get(path) ?? '');
    const branchA = findNode(doc1, 'Branch A');

    const step1 = await coordinator.dispatchForFile(path, 'demo', {
      type: 'rename',
      guard: guardFor(doc1, branchA),
      newTitle: 'Branch Alpha',
    });
    expect(step1.accepted).toBe(true);
    expect(host.files.get(path)).toBe('# Root\n## Branch Alpha\n');
    if (!step1.nextDocument || !step1.focusNodeId) return;

    const alpha = step1.nextDocument.nodes.get(step1.focusNodeId);
    if (!alpha) return;
    const step2 = await coordinator.dispatchForFile(path, 'demo', {
      type: 'insertChild',
      guard: guardFor(step1.nextDocument, alpha),
      title: 'Child 1',
    });
    expect(step2.accepted).toBe(true);
    expect(host.files.get(path)).toBe('# Root\n## Branch Alpha\n- Child 1\n');
    if (!step2.nextDocument || !step2.focusNodeId) return;

    const child1 = step2.nextDocument.nodes.get(step2.focusNodeId);
    if (!child1) return;
    const step3 = await coordinator.dispatchForFile(path, 'demo', {
      type: 'insertSibling',
      guard: guardFor(step2.nextDocument, child1),
      title: 'Child 2',
      placement: 'after',
    });
    expect(step3.accepted).toBe(true);
    expect(host.files.get(path)).toBe('# Root\n## Branch Alpha\n- Child 1\n- Child 2\n');
  });

  it('blocks writes fail-closed when an open Markdown editor is dirty, unknown, or throws', async () => {
    const host = new InMemoryHost();
    const path = 'notes/dirty.md';
    host.files.set(path, '# Root\n- A\n');
    const coordinator = new FileCoordinator(host);
    const doc = parseOk(host.files.get(path) ?? '');
    const nodeA = findNode(doc, 'A');

    host.editorState = 'dirty';
    const dirtyRes = await coordinator.dispatchForFile(path, 'dirty', {
      type: 'rename',
      guard: guardFor(doc, nodeA),
      newTitle: 'B',
    });
    expect(dirtyRes.accepted).toBe(false);
    expect(dirtyRes.rejectCode).toBe('editor-dirty');
    expect(host.processCalls).toBe(0);

    host.editorState = 'unknown';
    const unknownRes = await coordinator.dispatchForFile(path, 'dirty', {
      type: 'rename',
      guard: guardFor(doc, nodeA),
      newTitle: 'B',
    });
    expect(unknownRes.accepted).toBe(false);
    expect(unknownRes.rejectCode).toBe('editor-state-unknown');
    expect(host.processCalls).toBe(0);

    host.editorState = 'throw';
    const throwRes = await coordinator.dispatchForFile(path, 'dirty', {
      type: 'rename',
      guard: guardFor(doc, nodeA),
      newTitle: 'B',
    });
    expect(throwRes.accepted).toBe(false);
    expect(throwRes.rejectCode).toBe('editor-state-unknown');
    expect(host.processCalls).toBe(0);
  });

  it('rejects stale CAS edits without overwriting external disk changes', async () => {
    const host = new InMemoryHost();
    const path = 'notes/cas.md';
    host.files.set(path, '# Root\n- Original\n');
    const coordinator = new FileCoordinator(host);
    const staleDoc = parseOk(host.files.get(path) ?? '');
    const originalNode = findNode(staleDoc, 'Original');

    // Simulate external edit before write runs
    host.files.set(path, '# Root\n- Externally Edited\n');

    const outcome = await coordinator.dispatchForFile(path, 'cas', {
      type: 'rename',
      guard: guardFor(staleDoc, originalNode),
      newTitle: 'My Edit',
    });

    expect(outcome.accepted).toBe(false);
    expect(outcome.rejectCode).toBe('stale-target');
    expect(host.files.get(path)).toBe('# Root\n- Externally Edited\n');
  });

  it('serializes concurrent writes to the same file and rejects the second stale command safely', async () => {
    const host = new InMemoryHost();
    const path = 'notes/concurrent.md';
    host.files.set(path, '# Root\n- Item\n');
    host.processDelayMs = 15;
    const coordinator = new FileCoordinator(host);
    const doc = parseOk(host.files.get(path) ?? '');
    const item = findNode(doc, 'Item');
    const sharedGuard = guardFor(doc, item);

    const [first, second] = await Promise.all([
      coordinator.dispatchForFile(path, 'concurrent', {
        type: 'rename',
        guard: sharedGuard,
        newTitle: 'Winner',
      }),
      coordinator.dispatchForFile(path, 'concurrent', {
        type: 'rename',
        guard: sharedGuard,
        newTitle: 'Loser',
      }),
    ]);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.rejectCode).toBe('stale-target');
    expect(host.files.get(path)).toBe('# Root\n- Winner\n');
  });

  it('recovers the queue cleanly after a transient I/O error', async () => {
    const host = new InMemoryHost();
    const path = 'notes/io.md';
    host.files.set(path, '# Root\n- Item\n');
    const coordinator = new FileCoordinator(host);
    const doc = parseOk(host.files.get(path) ?? '');
    const item = findNode(doc, 'Item');

    host.failNextIo = true;
    const failed = await coordinator.dispatchForFile(path, 'io', {
      type: 'rename',
      guard: guardFor(doc, item),
      newTitle: 'Retry Me',
    });
    expect(failed.accepted).toBe(false);
    expect(failed.rejectCode).toBe('io-error');

    const recovered = await coordinator.dispatchForFile(path, 'io', {
      type: 'rename',
      guard: guardFor(doc, item),
      newTitle: 'Succeeded',
    });
    expect(recovered.accepted).toBe(true);
    expect(host.files.get(path)).toBe('# Root\n- Succeeded\n');
  });

  it('aborts inside processFile when a Markdown editor becomes dirty after pre-check (P1-2 regression)', async () => {
    const host = new InMemoryHost();
    const path = 'notes/race-dirty.md';
    host.files.set(path, '# Root\n- Original\n');
    host.processDelayMs = 10;
    host.editorState = 'clean';
    host.editorStateInsideProcess = 'dirty';

    const coordinator = new FileCoordinator(host);
    const doc = parseOk(host.files.get(path) ?? '');
    const original = findNode(doc, 'Original');

    const outcome = await coordinator.dispatchForFile(path, 'race-dirty', {
      type: 'rename',
      guard: guardFor(doc, original),
      newTitle: 'Should Not Write',
    });

    expect(outcome.accepted).toBe(false);
    expect(outcome.rejectCode).toBe('editor-dirty');
    expect(host.files.get(path)).toBe('# Root\n- Original\n');
  });
});
