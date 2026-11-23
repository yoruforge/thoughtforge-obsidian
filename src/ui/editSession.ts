import type { MindMapDocument, TopicNode } from '../core/model';
import type { PatchGuard, SemanticCommand } from '../core/patch/commands';

export interface EditingSession {
  readonly filePath: string;
  readonly nodeId: string;
  readonly initialTitleRaw: string;
  readonly guard: PatchGuard;
}

export function buildPatchGuard(doc: MindMapDocument, node: TopicNode): PatchGuard {
  return {
    expectedContentHash: doc.contentHash,
    targetNodeId: node.id,
    expectedTitleRaw: node.titleRaw,
    expectedOwnRangeHash: node.ownRangeHash,
  };
}

/**
 * Captures an immutable snapshot of the file, node, and CAS guard when inline
 * editing begins so external edits cannot redirect the commit to another topic.
 */
export function createEditingSession(
  filePath: string,
  doc: MindMapDocument,
  node: TopicNode,
): EditingSession {
  return {
    filePath,
    nodeId: node.id,
    initialTitleRaw: node.titleRaw,
    guard: buildPatchGuard(doc, node),
  };
}

export function isEditingSessionValid(
  session: EditingSession | null,
  currentFilePath: string,
  currentDoc: MindMapDocument | null,
): session is EditingSession {
  if (session === null || currentDoc === null) return false;
  if (session.filePath !== currentFilePath) return false;
  if (currentDoc.readOnlyReasons.length > 0) return false;
  if (currentDoc.contentHash !== session.guard.expectedContentHash) return false;
  return currentDoc.nodes.has(session.nodeId);
}

/**
 * Builds a rename command strictly from the session's original CAS guard.
 * Returns null if the active file changed, the title is empty, or unchanged.
 */
export function buildCommitRenameCommand(
  session: EditingSession,
  currentFilePath: string,
  nextTitle: string,
): Extract<SemanticCommand, { readonly type: 'rename' }> | null {
  if (session.filePath !== currentFilePath) {
    return null;
  }
  const trimmed = nextTitle.trim();
  if (trimmed.length === 0 || trimmed === session.initialTitleRaw) {
    return null;
  }
  return {
    type: 'rename',
    guard: session.guard,
    newTitle: trimmed,
  };
}

/**
 * Builds an atomic splitSibling command from the session's original CAS guard.
 * Returns null if the file changed or either split half is empty.
 */
export function buildSplitSiblingCommand(
  session: EditingSession,
  currentFilePath: string,
  leftTitle: string,
  rightTitle: string,
): Extract<SemanticCommand, { readonly type: 'splitSibling' }> | null {
  if (session.filePath !== currentFilePath) {
    return null;
  }
  const left = leftTitle.trim();
  const right = rightTitle.trim();
  if (left.length === 0 || right.length === 0) {
    return null;
  }
  return {
    type: 'splitSibling',
    guard: session.guard,
    leftTitle: left,
    rightTitle: right,
  };
}
