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

function collectSubtreeNodeIds(doc: MindMapDocument, rootId: string): ReadonlySet<string> {
  const ids = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || ids.has(id)) continue;
    ids.add(id);
    const node = doc.nodes.get(id);
    if (!node) continue;
    for (const childId of node.childIds) {
      stack.push(childId);
    }
  }
  return ids;
}

function collectUnmappedSnapshots(
  lfText: string,
  doc: MindMapDocument,
  excludeNodeIds?: ReadonlySet<string>,
): readonly UnmappedSnapshot[] {
  const lines = splitLfLines(lfText);
  const rawBlocks: Array<{
    readonly startLine: number;
    readonly kind: UnmappedKind;
    readonly rawSlice: string;
  }> = [];

  for (const node of doc.nodes.values()) {
    if (excludeNodeIds?.has(node.id)) continue;
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

function areUnmappedSnapshotsSubset(
  before: readonly UnmappedSnapshot[],
  after: readonly UnmappedSnapshot[],
): boolean {
  const counts = new Map<string, number>();
  for (const item of after) {
    const key = `${item.kind}\0${item.rawSlice}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const item of before) {
    const key = `${item.kind}\0${item.rawSlice}`;
    const prev = counts.get(key) ?? 0;
    if (prev <= 0) return false;
    counts.set(key, prev - 1);
  }
  return true;
}

function areUnmappedSnapshotsEqual(
  before: readonly UnmappedSnapshot[],
  after: readonly UnmappedSnapshot[],
  allowReordered: boolean,
): boolean {
  if (before.length !== after.length) return false;
  if (!allowReordered) {
    for (let i = 0; i < before.length; i += 1) {
      const a = before[i];
      const b = after[i];
      if (!a || !b || a.kind !== b.kind || a.rawSlice !== b.rawSlice) {
        return false;
      }
    }
    return true;
  }

  const counts = new Map<string, number>();
  for (const item of before) {
    const key = `${item.kind}\0${item.rawSlice}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const item of after) {
    const key = `${item.kind}\0${item.rawSlice}`;
    const prev = counts.get(key) ?? 0;
    if (prev <= 0) return false;
    counts.set(key, prev - 1);
  }
  return true;
}

function findNodeByHeaderLine(doc: MindMapDocument, headerLine: number): TopicNode | undefined {
  if (headerLine === -1) {
    return doc.nodes.get(doc.rootId);
  }
  for (const node of doc.nodes.values()) {
    if (node.kind !== 'central-virtual' && node.headerLine === headerLine) {
      return node;
    }
  }
  return undefined;
}

function parentMatchesReference(
  afterDoc: MindMapDocument,
  actualParent: TopicNode | undefined,
  expectedParent: TopicNode | undefined,
): boolean {
  if (!actualParent || !expectedParent) return false;
  if (expectedParent.kind === 'central-virtual') {
    return actualParent.id === afterDoc.rootId;
  }
  return (
    actualParent.headerLine === expectedParent.headerLine &&
    actualParent.titleRaw === expectedParent.titleRaw
  );
}

function fail(reason: PatchRejectReason, detail: string): ValidationResult {
  return { ok: false, reason, detail };
}

/**
 * Dry-run reparses the patched text and verifies all fail-closed invariants:
 * - No blocked or read-only degradation
 * - Every surviving unmapped block is preserved byte-for-byte
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

  const beforeTarget = beforeDoc.nodes.get(command.guard.targetNodeId);
  if (!beforeTarget) {
    return fail('stale-target', 'Original target node was not found during validation.');
  }

  const excludedForUnmapped =
    command.type === 'deleteBranch' && command.confirmedUnmapped === true
      ? collectSubtreeNodeIds(beforeDoc, beforeTarget.id)
      : undefined;
  const allowReorderedUnmapped =
    command.type === 'moveSibling' ||
    command.type === 'outdent' ||
    command.type === 'reparent';

  const beforeUnmapped = collectUnmappedSnapshots(beforeLfText, beforeDoc, excludedForUnmapped);
  const afterUnmapped = collectUnmappedSnapshots(afterLfText, afterDoc);
  const unmappedValid =
    command.type === 'pasteBranch'
      ? areUnmappedSnapshotsSubset(beforeUnmapped, afterUnmapped)
      : areUnmappedSnapshotsEqual(beforeUnmapped, afterUnmapped, allowReorderedUnmapped);
  if (!unmappedValid) {
    return fail(
      'invariant-check-failed',
      'Dry-run verification detected an unintended change to preserved unmapped blocks.',
    );
  }

  const focusedNode = findNodeByHeaderLine(afterDoc, focusHint.targetHeaderLine);
  if (!focusedNode) {
    return fail(
      'invariant-check-failed',
      `Expected topic at line ${focusHint.targetHeaderLine + 1} was not found after reparse.`,
    );
  }
  if (focusHint.targetHeaderLine !== -1 && focusedNode.titleRaw !== focusHint.expectedTitleRaw) {
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
    } else if (
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
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'toggleTask') {
    if (afterDoc.topicCount !== beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'Task toggle unexpectedly changed topic count.');
    }
    if (
      focusedNode.kind !== 'list-item' ||
      focusedNode.titleRaw !== beforeTarget.titleRaw ||
      focusedNode.preservedBlockId !== beforeTarget.preservedBlockId ||
      focusedNode.preservedPrefix === beforeTarget.preservedPrefix
    ) {
      return fail('invariant-check-failed', 'Task toggle did not cleanly flip the checkbox prefix.');
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'insertChild') {
    if (afterDoc.topicCount !== beforeDoc.topicCount + 1) {
      return fail('invariant-check-failed', 'insertChild did not add exactly one topic.');
    }
    const actualParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, actualParent, beforeTarget)) {
      return fail(
        'invariant-check-failed',
        'Inserted child attached to an unexpected parent after reparse.',
      );
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'insertSibling') {
    if (afterDoc.topicCount !== beforeDoc.topicCount + 1) {
      return fail('invariant-check-failed', 'insertSibling did not add exactly one topic.');
    }
    const beforeParent =
      beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
    const afterParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, afterParent, beforeParent)) {
      return fail(
        'invariant-check-failed',
        'Inserted sibling attached to an unexpected parent after reparse.',
      );
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'splitSibling') {
    if (afterDoc.topicCount !== beforeDoc.topicCount + 1) {
      return fail('invariant-check-failed', 'splitSibling did not add exactly one topic.');
    }
    const leftNode = findNodeByHeaderLine(afterDoc, beforeTarget.headerLine);
    if (
      !leftNode ||
      leftNode.titleRaw !== command.leftTitle.trim() ||
      leftNode.preservedPrefix !== beforeTarget.preservedPrefix ||
      leftNode.preservedBlockId !== beforeTarget.preservedBlockId
    ) {
      return fail('invariant-check-failed', 'splitSibling corrupted the original topic.');
    }
    const beforeParent =
      beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
    const afterParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, afterParent, beforeParent)) {
      return fail(
        'invariant-check-failed',
        'Split sibling attached to an unexpected parent after reparse.',
      );
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'insertParent') {
    if (afterDoc.topicCount !== beforeDoc.topicCount + 1) {
      return fail('invariant-check-failed', 'insertParent did not add exactly one topic.');
    }
    const beforeParent =
      beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
    const afterParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, afterParent, beforeParent)) {
      return fail('invariant-check-failed', 'New parent attached to an unexpected parent.');
    }
    if (focusedNode.childIds.length !== 1) {
      return fail('invariant-check-failed', 'New parent did not wrap the original topic cleanly.');
    }
    const wrappedChildId = focusedNode.childIds[0];
    const wrappedChild = wrappedChildId !== undefined ? afterDoc.nodes.get(wrappedChildId) : undefined;
    if (!wrappedChild || wrappedChild.titleRaw !== beforeTarget.titleRaw) {
      return fail('invariant-check-failed', 'Wrapped child title mismatch after insertParent.');
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'moveSibling') {
    if (afterDoc.topicCount !== beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'moveSibling unexpectedly changed topic count.');
    }
    const beforeParent =
      beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
    const afterParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, afterParent, beforeParent)) {
      return fail('invariant-check-failed', 'Moved sibling changed parent unexpectedly.');
    }
    if (focusedNode.childIds.length !== beforeTarget.childIds.length) {
      return fail('invariant-check-failed', 'Moved sibling lost or gained children unexpectedly.');
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'indent') {
    if (afterDoc.topicCount !== beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'indent unexpectedly changed topic count.');
    }
    const beforeParent =
      beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
    const idx = beforeParent ? beforeParent.childIds.indexOf(beforeTarget.id) : -1;
    const expectedNewParentId = idx > 0 && beforeParent ? beforeParent.childIds[idx - 1] : undefined;
    const expectedNewParent =
      expectedNewParentId !== undefined ? beforeDoc.nodes.get(expectedNewParentId) : undefined;
    const actualNewParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, actualNewParent, expectedNewParent)) {
      return fail('invariant-check-failed', 'Indented topic did not attach under previous sibling.');
    }
    if (focusedNode.childIds.length !== beforeTarget.childIds.length) {
      return fail('invariant-check-failed', 'Indented topic child count changed unexpectedly.');
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'outdent') {
    if (afterDoc.topicCount !== beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'outdent unexpectedly changed topic count.');
    }
    const beforeParent =
      beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
    const expectedGrandParent =
      beforeParent && beforeParent.parentId !== null
        ? beforeDoc.nodes.get(beforeParent.parentId)
        : undefined;
    const actualNewParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, actualNewParent, expectedGrandParent)) {
      return fail('invariant-check-failed', 'Outdented topic did not attach under grandparent.');
    }
    if (focusedNode.childIds.length !== beforeTarget.childIds.length) {
      return fail('invariant-check-failed', 'Outdented topic child count changed unexpectedly.');
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'updateNote') {
    if (afterDoc.topicCount !== beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'updateNote unexpectedly changed the topic count.');
    }
    const lfBody = command.newNoteBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const bodyLines = lfBody.split('\n');
    let start = 0;
    let end = bodyLines.length;
    while (start < end && /^[ \t]*$/.test(bodyLines[start] ?? '')) start += 1;
    while (end > start && /^[ \t]*$/.test(bodyLines[end - 1] ?? '')) end -= 1;
    const expectedNoteText =
      start < end
        ? bodyLines
            .slice(start, end)
            .map((line) => {
              if (/^[ \t]*$/.test(line)) return '';
              return beforeTarget.kind === 'list-item' ? line.replace(/^[ \t]+/, '') : line;
            })
            .join('\n')
        : null;

    if (focusedNode.noteText !== expectedNoteText) {
      return fail(
        'invalid-note-block-syntax',
        'Reparsed topic note did not match the requested plain paragraph content.',
      );
    }
    if (
      focusedNode.kind !== beforeTarget.kind ||
      focusedNode.preservedPrefix !== beforeTarget.preservedPrefix ||
      focusedNode.preservedBlockId !== beforeTarget.preservedBlockId
    ) {
      return fail('invariant-check-failed', 'updateNote altered protected topic metadata.');
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'reparent') {
    if (afterDoc.topicCount !== beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'reparent unexpectedly changed the topic count.');
    }
    if (focusedNode.childIds.length !== beforeTarget.childIds.length) {
      return fail(
        'invariant-check-failed',
        'Reparented topic lost or absorbed children unexpectedly.',
      );
    }
    const beforeTargetParent = beforeDoc.nodes.get(command.targetParentId);
    const actualParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!beforeTargetParent || !actualParent) {
      return fail('invariant-check-failed', 'Reparented topic parent could not be verified.');
    }
    if (beforeTargetParent.kind === 'central-virtual') {
      if (actualParent.id !== afterDoc.rootId) {
        return fail('invariant-check-failed', 'Reparented topic did not attach to the root.');
      }
    } else if (
      actualParent.kind !== beforeTargetParent.kind ||
      actualParent.titleRaw !== beforeTargetParent.titleRaw
    ) {
      return fail(
        'invariant-check-failed',
        'Reparented topic attached to an unexpected parent after reparse.',
      );
    }
    const expectedParentChildCount =
      beforeTargetParent.childIds.length + (beforeTarget.parentId === command.targetParentId ? 0 : 1);
    if (actualParent.childIds.length !== expectedParentChildCount) {
      return fail(
        'invariant-check-failed',
        'Target parent child count did not match expected value after reparent.',
      );
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'pasteBranch') {
    if (afterDoc.topicCount <= beforeDoc.topicCount) {
      return fail('invariant-check-failed', 'pasteBranch did not add any topics.');
    }
    const actualParent =
      focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
    if (!parentMatchesReference(afterDoc, actualParent, beforeTarget)) {
      return fail(
        'invariant-check-failed',
        'Pasted branch did not attach to the selected parent topic.',
      );
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'deleteBranch') {
    const deletedIds = collectSubtreeNodeIds(beforeDoc, beforeTarget.id);
    if (afterDoc.topicCount !== beforeDoc.topicCount - deletedIds.size) {
      return fail(
        'invariant-check-failed',
        `deleteBranch expected topicCount ${beforeDoc.topicCount - deletedIds.size}, got ${afterDoc.topicCount}.`,
      );
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  if (command.type === 'deleteNodeKeepChildren') {
    if (afterDoc.topicCount !== beforeDoc.topicCount - 1) {
      return fail('invariant-check-failed', 'deleteNodeKeepChildren did not remove exactly one topic.');
    }
    if (beforeTarget.childIds.length > 0) {
      const beforeParent =
        beforeTarget.parentId !== null ? beforeDoc.nodes.get(beforeTarget.parentId) : undefined;
      const afterParent =
        focusedNode.parentId !== null ? afterDoc.nodes.get(focusedNode.parentId) : undefined;
      if (!parentMatchesReference(afterDoc, afterParent, beforeParent)) {
        return fail('invariant-check-failed', 'Promoted child did not attach under original parent.');
      }
    }
    return { ok: true, nextDocument: afterDoc, focusNodeId: focusedNode.id };
  }

  return fail('unsupported-command', `Validation for "${command.type}" is not implemented yet.`);
}
