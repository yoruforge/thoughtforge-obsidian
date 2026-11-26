import { describe, expect, it } from 'vitest';
import { editableMap, type ReferenceEdit } from '../../src/core/patch/extractBranch';
import { createHistoryAnchor } from '../../src/core/view/topicResolver';
import { FileCoordinator } from '../../src/sync/FileCoordinator';
import type {
  ExtractionHost,
  ExtractionRecord,
  ExtractionRequest,
} from '../../src/sync/branchExtraction';

const source = 'Projects/Map.md';
const destination = 'Archive/設計案.md';
const initial = '# Map\n## メモ\nbody\n## メモ\nbody\n## Tail\n';
const output = '# メモ\nbody\n';

class Vault implements ExtractionHost {
  files = new Map([[source, initial]]);
  journal = new Map<string, ExtractionRecord>();
  editors = new Map<string, 'dirty' | 'unknown'>();
  writes = 0;
  creates = 0;
  rev = 0;
  onCreated?: () => void;
  beforeSourceWrite?: () => void;
  afterSourceWrite?: () => void;
  journalFail?: ExtractionRecord['phase'] | 'remove';
  edits: ReferenceEdit[] = [];
  coordinator() {
    return new FileCoordinator(this, { extractionHost: this });
  }
  async revealSourceLine() {}
  async openLink() {}
  async readFile(path: string) {
    const value = this.files.get(path);
    if (value === undefined) throw new Error('missing');
    return value;
  }
  existingPath(path: string) {
    return [...this.files.keys()].find((p) => p.toLowerCase() === path.toLowerCase()) ?? null;
  }
  version() {
    return this.rev;
  }
  inspectOpenMarkdownEditors(path: string) {
    return { state: this.editors.get(path) ?? ('clean' as const) };
  }
  async createNote(path: string, raw: string) {
    if (this.existingPath(path)) throw new Error('already-exists');
    this.creates++;
    this.files.set(path, raw);
    this.onCreated?.();
  }
  async processFile(path: string, fn: (current: string) => string) {
    this.beforeSourceWrite?.();
    const next = fn(await this.readFile(path));
    this.files.set(path, next);
    this.writes++;
    this.afterSourceWrite?.();
  }
  referenceEdits() {
    return Promise.resolve(this.edits);
  }
  linkTo() {
    return '[[Archive/設計案|メモ]]';
  }
  records() {
    return [...this.journal.values()];
  }
  async put(r: ExtractionRecord) {
    if (this.journalFail === r.phase) throw new Error('persist failed');
    this.journal.set(r.id, structuredClone(r));
  }
  async remove(id: string) {
    if (this.journalFail === 'remove') throw new Error('persist failed');
    this.journal.delete(id);
  }
  request(index = 1): ExtractionRequest {
    const before = this.files.get(source)!;
    const doc = editableMap(before, 'Map');
    const target = [...doc.nodes.values()].filter((n) => n.titleRaw === 'メモ')[index]!;
    return { source, destination, before, anchor: createHistoryAnchor(doc, target) };
  }
  restart() {
    const next = new Vault();
    next.files = new Map(this.files);
    next.journal = structuredClone(this.journal);
    return next;
  }
}

async function interrupt(v: Vault) {
  v.onCreated = () => v.editors.set(source, 'dirty');
  expect((await v.coordinator().extract(v.request())).accepted).toBe(false);
  return v.records()[0]!.id;
}

describe('branch extraction recovery', () => {
  it('R1 resumes a nondefault destination after restart, for the second identical branch only', async () => {
    const v = new Vault(),
      id = await interrupt(v);
    expect(v.files.get(source)).toBe(initial);
    const next = v.restart(),
      co = next.coordinator();
    expect((await co.extract({ ...next.request(), retryId: id })).accepted).toBe(true);
    expect(next.creates).toBe(0);
    expect(next.files.get(destination)).toBe(output);
    expect(next.files.get(source)).toBe(
      '# Map\n## メモ\nbody\n## [[Archive/設計案|メモ]]\n## Tail\n',
    );
    expect(co.getHistoryStatus(source).undoCount).toBe(1);
  });
  it('R2 rejects shifted identical siblings; resumes a uniquely identified branch', async () => {
    for (const unique of [false, true]) {
      const v = new Vault();
      if (unique) v.files.set(source, initial.replace('body\n## メモ', 'body\n## メモ ^b'));
      const id = await interrupt(v),
        next = v.restart(),
        before = '\n' + v.files.get(source)!;
      next.files.set(source, before);
      const result = await next.coordinator().extract({ ...next.request(), retryId: id });
      expect(result.accepted).toBe(unique);
      if (!unique) expect(next.files.get(source)).toBe(before);
      else expect(next.files.get(source)).toContain('[[Archive/設計案|メモ]] ^b');
      expect(next.creates).toBe(0);
    }
  });
  it('R3 reconciles interrupted journal transitions, including an already committed source', async () => {
    for (const stage of ['prepared', 'created', 'replacing', 'remove'] as const) {
      const v = new Vault();
      v.journalFail = stage;
      expect((await v.coordinator().extract(v.request())).accepted).toBe(false);
      if (stage === 'prepared') {
        expect(v.creates).toBe(0);
        continue;
      }
      const next = v.restart(),
        co = next.coordinator(),
        r = next.records()[0]!;
      if (r.phase === 'prepared') {
        expect((await co.extract({ ...next.request(), retryId: r.id })).accepted).toBe(false);
        expect(next.files.get(source)).toBe(initial);
      }
      const result =
        stage === 'remove'
          ? await co.reconcileExtraction(r)
          : await co.extract({
              ...next.request(),
              retryId: r.id,
              confirmedRecovery: r.phase === 'prepared',
            });
      expect(result.accepted).toBe(true);
      expect(next.creates).toBe(0);
      expect(next.records()).toEqual([]);
    }
    // Crash immediately after prepare: the file may never have been created.
    const interrupted = new Vault();
    interrupted.createNote = async () => {
      throw new Error('interrupted before create');
    };
    expect((await interrupted.coordinator().extract(interrupted.request())).accepted).toBe(false);
    const recovered = interrupted.restart();
    const pendingRequest = { ...recovered.request(), retryId: recovered.records()[0]!.id };
    expect((await recovered.coordinator().extract(pendingRequest)).accepted).toBe(false);
    expect(recovered.creates).toBe(0);
    expect(
      (await recovered.coordinator().extract({ ...pendingRequest, confirmedRecovery: true }))
        .accepted,
    ).toBe(true);
    expect(recovered.creates).toBe(1);
    const v = new Vault(),
      id = await interrupt(v),
      next = v.restart();
    next.files.delete(destination);
    expect((await next.coordinator().extract({ ...next.request(), retryId: id })).accepted).toBe(
      false,
    );
    expect(next.creates).toBe(0);
  });
  it('R4 rechecks destination at commit and on restart', async () => {
    for (const issue of ['delete', 'rename', 'edit', 'dirty', 'unknown'] as const) {
      const v = new Vault();
      let fired = false;
      v.beforeSourceWrite = () => {
        if (fired) return;
        fired = true;
        if (issue === 'dirty' || issue === 'unknown') v.editors.set(destination, issue);
        else {
          v.rev++;
          if (issue === 'edit') v.files.set(destination, 'external');
          else {
            v.files.delete(destination);
            if (issue === 'rename') v.files.set('Archive/Moved.md', output);
          }
        }
      };
      const co = v.coordinator();
      expect((await co.extract(v.request())).accepted).toBe(false);
      expect(v.files.get(source)).toBe(initial);
      expect(co.getHistoryStatus(source).undoCount).toBe(0);
      const next = v.restart();
      next.editors = new Map(v.editors);
      expect(
        (await next.coordinator().extract({ ...next.request(), retryId: next.records()[0]!.id }))
          .accepted,
      ).toBe(false);
      expect(next.files).toEqual(v.files);
      expect(next.creates).toBe(0);
    }
  });
  it('R5 restores by CAS only, retaining recovery text if the source has also changed', async () => {
    for (const external of [false, true]) {
      const v = new Vault(),
        co = v.coordinator();
      v.afterSourceWrite = () => {
        v.afterSourceWrite = undefined;
        v.files.delete(destination);
        if (external) v.files.set(source, v.files.get(source) + 'addition\n');
      };
      expect((await co.extract(v.request())).accepted).toBe(false);
      expect(co.getHistoryStatus(source).undoCount).toBe(0);
      if (external) {
        expect(v.files.get(source)).toMatch(/addition\n$/);
        expect(v.records()[0]?.originalBranch).toContain('body');
      } else expect(v.files.get(source)).toBe(initial);
    }
  });
  it('B1 compares raw bytes including CRLF and trailing newline', async () => {
    for (const change of ['lf', 'trim', 'none']) {
      const v = new Vault();
      v.files.set(
        source,
        initial.replaceAll('body', 'body\n```\nprotected\n```').replaceAll('\n', '\r\n'),
      );
      const id = await interrupt(v),
        next = v.restart(),
        raw = next.files.get(destination)!;
      next.files.set(
        destination,
        change === 'lf' ? raw.replaceAll('\r\n', '\n') : change === 'trim' ? raw.trimEnd() : raw,
      );
      expect((await next.coordinator().extract({ ...next.request(), retryId: id })).accepted).toBe(
        change === 'none',
      );
      if (change !== 'none') expect(next.files.get(source)).toBe(v.files.get(source));
    }
  });
  it('B2 uses verified reference spans and rejects unprovable destinations before creation', async () => {
    const v = new Vault();
    v.files.set(source, initial.replace('body\n## Tail', '![fig](assets/fig.png)\n## Tail'));
    v.edits = [
      { line: 4, column: 7, original: 'assets/fig.png', replacement: '../Projects/assets/fig.png' },
    ];
    expect((await v.coordinator().extract(v.request())).accepted).toBe(true);
    expect(v.files.get(destination)).toContain('![fig](../Projects/assets/fig.png)');
    const other = new Vault();
    other.referenceEdits = async () => {
      throw new Error('ambiguous-reference');
    };
    expect((await other.coordinator().extract(other.request())).accepted).toBe(false);
    expect(other.creates).toBe(0);
    expect(other.files.get(source)).toBe(initial);
  });
  it('H1 preserves redo on destination divergence and retries after resolution', async () => {
    for (const change of ['removed', 'renamed', 'changed', 'crlf', 'dirty', 'unknown'] as const) {
      const v = new Vault(),
        co = v.coordinator();
      expect((await co.extract(v.request())).accepted).toBe(true);
      const linked = v.files.get(source);
      expect((await co.undoForFile(source, 'Map')).accepted).toBe(true);
      if (change === 'dirty' || change === 'unknown') v.editors.set(destination, change);
      else if (change === 'removed' || change === 'renamed') {
        v.files.delete(destination);
        if (change === 'renamed') v.files.set('Archive/Other.md', output);
      } else
        v.files.set(destination, change === 'crlf' ? output.replaceAll('\n', '\r\n') : 'changed');
      const files = new Map(v.files);
      expect((await co.redoForFile(source, 'Map')).accepted).toBe(false);
      expect(v.files).toEqual(files);
      expect(v.files.get(source)).toBe(initial);
      expect(co.getHistoryStatus(source).redoCount).toBe(1);
      v.editors.clear();
      v.files.set(destination, output);
      expect((await co.redoForFile(source, 'Map')).accepted).toBe(true);
      expect(v.files.get(source)).toBe(linked);
      expect(v.creates).toBe(1);
    }
  });
  it('H2 refuses stale source and recovers destination changed during redo', async () => {
    for (const change of ['source', 'destination']) {
      const v = new Vault(),
        co = v.coordinator();
      await co.extract(v.request());
      await co.undoForFile(source, 'Map');
      if (change === 'source') v.files.set(source, initial + 'extra');
      else
        v.afterSourceWrite = () => {
          v.afterSourceWrite = undefined;
          v.files.set(destination, 'modified');
        };
      expect((await co.redoForFile(source, 'Map')).accepted).toBe(false);
      expect(v.files.get(source)).toBe(change === 'source' ? initial + 'extra' : initial);
      if (change === 'destination') expect(v.files.get(destination)).toBe('modified');
    }
  });
  it('C1 rejects dirty, stale, conflicting case or content, and competing requests', async () => {
    const v = new Vault(),
      co = v.coordinator(),
      req = v.request();
    v.editors.set(source, 'dirty');
    expect((await co.extract(req)).accepted).toBe(false);
    v.editors.clear();
    expect((await co.extract({ ...req, before: 'stale' })).accepted).toBe(false);
    for (const path of [destination, destination.toLowerCase()]) {
      v.files.set(path, output);
      expect((await co.extract(req)).accepted).toBe(false);
      v.files.delete(path);
    }
    expect(v.creates).toBe(0);
    expect((await Promise.all([co.extract(req), co.extract(req)])).map((r) => r.accepted)).toEqual([
      true,
      false,
    ]);
    expect(v.creates).toBe(1);
  });
});
