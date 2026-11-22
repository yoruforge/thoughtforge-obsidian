import type { MindMapDocument } from '../model';
import { applyTextEdits, normalizeToLf, restoreLineEnding } from './apply';
import type { PatchRejectReason, SemanticCommand, TextEdit } from './commands';
import { planPatch } from './planner';
import { validatePatchedDocument } from './validator';

export type PatchExecutionResult =
  | {
      readonly ok: true;
      readonly nextRawText: string;
      readonly nextDocument: MindMapDocument;
      readonly focusNodeId: string;
      readonly edits: readonly TextEdit[];
    }
  | {
      readonly ok: false;
      readonly reason: PatchRejectReason;
      readonly detail: string;
    };

/**
 * Plans minimal edits, applies them in memory, dry-run reparses and validates all
 * non-destructive invariants, and restores the original file line ending.
 */
export function planAndValidatePatch(
  rawText: string,
  doc: MindMapDocument,
  fallbackTitle: string,
  command: SemanticCommand,
): PatchExecutionResult {
  const lfText = normalizeToLf(rawText);
  const plan = planPatch(lfText, doc, command);
  if (!plan.ok) {
    return plan;
  }

  let nextLfText: string;
  try {
    nextLfText = applyTextEdits(lfText, plan.edits);
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Failed to apply TextEdits.';
    return { ok: false, reason: 'invariant-check-failed', detail };
  }

  const nextRawText = restoreLineEnding(nextLfText, doc.lineEnding);
  const validation = validatePatchedDocument(
    lfText,
    doc,
    nextRawText,
    nextLfText,
    fallbackTitle,
    command,
    plan.focusHint,
  );
  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    nextRawText,
    nextDocument: validation.nextDocument,
    focusNodeId: validation.focusNodeId,
    edits: plan.edits,
  };
}

export { applyTextEdits, normalizeToLf, restoreLineEnding } from './apply';
export { planPatch, type PlanResult } from './planner';
export { validatePatchedDocument, type ValidationResult } from './validator';
