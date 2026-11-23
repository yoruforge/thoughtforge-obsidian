import type { MindMapDocument, TopicNode, UnmappedKind } from '../model';
import { parseMarkdownToMap } from '../parser';
import type { PatchFocusHint, PatchRejectReason, SemanticCommand } from './commands';

export type ValidationResult =
  | {
      readonly ok: true;
      readonly nextDocument: MindMapDocument;
      readonly focusNodeId: string;
    }
  | {
      readonly ok: false;
      readonly reason: PatchRejectReason;
      readonly detail: string;
    };

interface UnmappedSnapshot {
  readonly kind: UnmappedKind;
  readonly rawSlice: string;
}

function splitLfLines(lfText: string): readonly string[] {
  if (lfText.length === 0) return [];
  const lines = lfText.split('\n');
  if (lfText.endsWith('\n') && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function collectUnmappedSnapshots(
  lfText: string,
  doc: MindMapDocument,
): readonly UnmappedSnapshot[] {
  const lines = splitLfLines(lfText);
  const rawBlocks: Array<{
    readonly startLine: number;
    readonly kind: UnmappedKind;
    readonly rawSlice: string;
  }> = [];

  for (const node of doc.nodes.values()) {
    for (const block of node.unmappedBlocks) {
      rawBlocks.push({
        startLine: block.range.startLine,
        kind: block.kind,
        rawSlice: lines.slice(block.range.startLine, block.range.endLine).join('\n'),
      });
    }
  }

  rawBlocks.sort((a, b) => a.startLine - b.startLine);
  return rawBlocks.map(({ kind, rawSlice }) => ({ kind, rawSlice }));
}

function areUnmappedSnapshotsEqual(
  before: readonly UnmappedSnapshot[],
  after: readonly UnmappedSnapshot[],
): boolean {
  if (before.length !== after.length) return false;
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    if (!a || !b || a.kind !== b.kind || a.rawSlice !== b.rawSlice) {
      return false;
    }
  }
  return true;
}

function findNodeByHeaderLine(doc: MindMapDocument, headerLine: number): TopicNode | undefined {
  for (const node of doc.nodes.values()) {
    if (node.kind !== 'central-virtual' && node.headerLine === headerLine) {
      return node;
    }
  }
  return undefined;
}

function fail(reason: PatchRejectReason, detail: string): ValidationResult {
  return { ok: false, reason, detail };
}

/**
 * Dry-run reparses the patched text and verifies all fail-closed invariants:
 * - No blocked or read-only degradation
 * - Every unmapped block is preserved byte-for-byte
 * - Post-conditions for topic count, parent linkage, and protected title metadata hold
 */
export function validatePatchedDocument(
  beforeLfText: string,
  beforeDoc: MindMapDocument,
  afterRawText: string,
  afterLfText: string,
  fallbackTitle: string,
  command: SemanticCommand,
  focusHint: PatchFocusHint,
): ValidationResult {
  const reparsed = parseMarkdownToMap(afterRawText, fallbackTitle);
  if (reparsed.status !== 'ok') {
    return fail('blocked-document', reparsed.detail);
  }

  const afterDoc = reparsed.document;
  if (afterDoc.readOnlyReasons.length > 0) {
    return fail(
      'invariant-check-failed',
      `Patched document became read-only (${afterDoc.readOnlyReasons.join(', ')}).`,
    );
  }
  if (afterDoc.lineEnding !== beforeDoc.lineEnding) {
    return fail(
      'invariant-check-failed',
      'Dry-run verification detected an unintended line ending change.',
    );
  }

  const beforeUnmapped = collectUnmappedSnapshots(beforeLfText, beforeDoc);
  const afterUnmapped = collectUnmappedSnapshots(afterLfText, afterDoc);
  if (!areUnmappedSnapshotsEqual(beforeUnmapped, afterUnmapped)) {
    return fail(
      'invariant-check-failed',
      'Dry-run verification detected an unintended change to preserved unmapped blocks.',
    );
  }

  const beforeTarget = beforeDoc.nodes.get(command.guard.targetNodeId);
  if (!beforeTarget) {
    return fail('stale-target', 'Original target node was not found during validation.');
  }

  const focusedNode = findNodeByHeaderLine(afterDoc, focusHint.targetHeaderLine);
  if (!focusedNode) {
    return fail(
      'invariant-check-failed',
      `Expected topic at line ${focusHint.targetHeaderLine + 1} was not found after reparse.`,
    );
  }
  if (focusedNode.titleRaw !== focusHint.expectedTitleRaw) {
    return fail(
      'invariant-check-failed',
      'Reparsed topic title did not match the requested title (check for syntax characters or block IDs).',
    );
  }

  if (command.type === 'rename') {
    if (afterDoc.topicCount !== beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'Rename unexpectedly changed the topic count.');
    }
    if (beforeTarget.kind === 'central-virtual') {
      if (focusedNode.id !== afterDoc.rootId || focusedNode.headingLevel !== 1) {
        return fail('invariant-check-failed', 'Promoted central H1 did not become the root topic.');
      }
    } else {
      if (
        focusedNode.kind !== beforeTarget.kind ||
        focusedNode.headingLevel !== beforeTarget.headingLevel ||
        focusedNode.preservedPrefix !== beforeTarget.preservedPrefix ||
        focusedNode.preservedBlockId !== beforeTarget.preservedBlockId
      ) {
        return fail(
          'invariant-check-failed',
          'Rename altered protected topic structure, task marker, or block ID.',
        );
      }
    }
    return {
      ok: true,
      nextDocument: afterDoc,
      focusNodeId: focusedNode.id,
    };
  }

  if (command.type === 'insertChild') {
    if (afterDoc.topicCount !== beforeDoc.topicCount + 1) {
      return fail('invariant-check-failed', 'insertChild did not add exactly one topic.');
    }
    if (focusedNode.parentId === null) {
      return fail('invariant-check-failed', 'Inserted child has no parent.');
    }
    const actualParent = afterDoc.nodes.get(focusedNode.parentId);
    if (!actualParent) {
      return fail('invariant-check-failed', 'Inserted child parent was missing after reparse.');
    }
    const expectedParentMatches =
      beforeTarget.kind === 'central-virtual'
        ? actualParent.id === afterDoc.rootId
        : actualParent.headerLine === beforeTarget.headerLine &&
          actualParent.titleRaw === beforeTarget.titleRaw;
    if (!expectedParentMatches) {
      return fail(
        'invariant-check-failed',
        'Inserted child attached to an unexpected parent after reparse.',
      );
    }
    return {
      ok: true,
      nextDocument: afterDoc,
      focusNodeId: focusedNode.id,
    };
  }

  if (command.type === 'insertSibling') {
    if (afterDoc.topicCount !== beforeDoc.topicCount + 1) {
      return fail('invariant-check-failed', 'insertSibling did not add exactly one topic.');
    }
    const beforeParent =
      beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
    const afterParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!beforeParent || !afterParent) {
      return fail('invariant-check-failed', 'Sibling parent linkage was lost after reparse.');
    }
    const expectedParentMatches =
      beforeParent.kind === 'central-virtual'
        ? afterParent.id === afterDoc.rootId
        : afterParent.headerLine === beforeParent.headerLine &&
          afterParent.titleRaw === beforeParent.titleRaw;
    if (!expectedParentMatches) {
      return fail(
        'invariant-check-failed',
        'Inserted sibling attached to an unexpected parent after reparse.',
      );
    }
    return {
      ok: true,
      nextDocument: afterDoc,
      focusNodeId: focusedNode.id,
    };
  }

  return fail('unsupported-command', `Validation for "${command.type}" is not implemented yet.`);
}
