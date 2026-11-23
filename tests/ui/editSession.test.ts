import { describe, expect, it } from 'vitest';
import { parseMarkdownToMap } from '../../src/core/parser';
import { FileCoordinator } from '../../src/sync/FileCoordinator';
import type { ObsidianHostPort } from '../../src/sync/ports';
import {
  buildCommitRenameCommand,
  buildSplitSiblingCommand,
  buildUpdateNoteCommand,
  createEditingSession,
  createNoteEditingSession,
  isEditingSessionValid,
  isNoteEditingSessionValid,
} from '../../src/ui/editSession';

function createMemoryHost(initialPath: string, initialText: string): {
  readonly host: ObsidianHostPort;
  readonly files: Map<string, string>;
} {
  const files = new Map<string, string>([[initialPath, initialText]]);
  const host: ObsidianHostPort = {
    async readFile(path: string): Promise<string> {
      const value = files.get(path);
      if (value === undefined) throw new Error(`Missing ${path}`);
      return value;
    },
    async processFile(path: string, transform: (current: string) => string): Promise<void> {
      const current = files.get(path);
      if (current === undefined) throw new Error(`Missing ${path}`);
      files.set(path, transform(current));
    },
    inspectOpenMarkdownEditors(): { readonly state: 'clean' } {
      return { state: 'clean' };
    },
    async revealSourceLine(): Promise<void> {
      // No-op in memory mock
    },
    async openLink(): Promise<void> {
      // No-op in memory mock
    },
  };
  return { host, files };
}

describe('editSession (P1-1 regression)', () => {
  it('never overwrites topic A when an item is inserted before A while editing topic B', async () => {
    const filePath = 'notes/race.md';
    const initialMd = '# Root\n- A\n- B\n';
    const { host, files } = createMemoryHost(filePath, initialMd);
    const coordinator = new FileCoordinator(host);

    const initialParse = parseMarkdownToMap(initialMd, 'race');
    expect(initialParse.status).toBe('ok');
    if (initialParse.status !== 'ok') return;

    const nodeB = [...initialParse.document.nodes.values()].find((n) => n.titleRaw === 'B');
    expect(nodeB).toBeDefined();
    if (!nodeB) return;

    // Start editing B (id: n-2)
    const session = createEditingSession(filePath, initialParse.document, nodeB);
    expect(session.nodeId).toBe('n-2');

    // External editor inserts "- X" before "- A", shifting A to id "n-2"
    const externallyUpdatedMd = '# Root\n- X\n- A\n- B\n';
    files.set(filePath, externallyUpdatedMd);

    const updatedParse = parseMarkdownToMap(externallyUpdatedMd, 'race');
    expect(updatedParse.status).toBe('ok');
    if (updatedParse.status !== 'ok') return;

    // Confirm n-2 now points to A in the latest document
    expect(updatedParse.document.nodes.get('n-2')?.titleRaw).toBe('A');

    // Session must be invalidated against the updated document
    expect(isEditingSessionValid(session, filePath, updatedParse.document)).toBe(false);

    // Even if a commit fires from the stale InlineEditor session (e.g. via blur race),
    // the command carries the original guard and is rejected without modifying A.
    const commitCommand = buildCommitRenameCommand(session, filePath, 'B Renamed');
    expect(commitCommand).not.toBeNull();
    if (!commitCommand) return;

    const outcome = await coordinator.dispatchForFile(filePath, 'race', commitCommand);
    expect(outcome.accepted).toBe(false);
    expect(outcome.rejectCode).toBe('stale-target');
    expect(files.get(filePath)).toBe(externallyUpdatedMd);
  });

  it('drops commit command when the active view has switched to another file', () => {
    const md = '# Root\n- Topic\n';
    const parsed = parseMarkdownToMap(md, 'noteA');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    const topic = [...parsed.document.nodes.values()].find((n) => n.titleRaw === 'Topic');
    if (!topic) return;

    const session = createEditingSession('notes/a.md', parsed.document, topic);
    expect(isEditingSessionValid(session, 'notes/b.md', parsed.document)).toBe(false);
    expect(buildCommitRenameCommand(session, 'notes/b.md', 'New Name')).toBeNull();
    expect(buildSplitSiblingCommand(session, 'notes/b.md', 'Left', 'Right')).toBeNull();
    expect(buildSplitSiblingCommand(session, 'notes/a.md', 'Left', '   ')).toBeNull();
    expect(buildSplitSiblingCommand(session, 'notes/a.md', 'Left', 'Right')).toEqual({
      type: 'splitSibling',
      guard: session.guard,
      leftTitle: 'Left',
      rightTitle: 'Right',
    });

    // Note editing session binds CAS guard and rejects cross-file commits
    const noteSession = createNoteEditingSession('notes/a.md', parsed.document, topic);
    expect(isNoteEditingSessionValid(noteSession, 'notes/a.md', parsed.document)).toBe(true);
    expect(isNoteEditingSessionValid(noteSession, 'notes/b.md', parsed.document)).toBe(false);
    expect(buildUpdateNoteCommand(noteSession, 'notes/b.md', 'Body')).toBeNull();
    expect(buildUpdateNoteCommand(noteSession, 'notes/a.md', 'Body')).toEqual({
      type: 'updateNote',
      guard: noteSession.guard,
      newNoteBody: 'Body',
    });

    // Title draft prefill preserves original CAS guard expectedTitleRaw
    const prefilled = createEditingSession('notes/a.md', parsed.document, topic, 'Draft Title');
    expect(prefilled.draftPrefillValue).toBe('Draft Title');
    expect(prefilled.guard.expectedTitleRaw).toBe('Topic');
  });
});
