import type { ObsidianHostPort, SyncRejectCode } from './ports';

export type EditorGateResult =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly rejectCode: Extract<SyncRejectCode, 'editor-dirty' | 'editor-state-unknown'>;
      readonly reason: string;
    };

/**
 * Fail-closed gate that blocks mind-map writes when an open Markdown editor
 * for the same note has unsaved changes or cannot be inspected reliably.
 */
export function checkMarkdownEditorGate(
  host: Pick<ObsidianHostPort, 'inspectOpenMarkdownEditors'>,
  filePath: string,
): EditorGateResult {
  let inspection: ReturnType<ObsidianHostPort['inspectOpenMarkdownEditors']>;
  try {
    inspection = host.inspectOpenMarkdownEditors(filePath);
  } catch {
    return {
      allowed: false,
      rejectCode: 'editor-state-unknown',
      reason: 'Failed to inspect open Markdown editors for unsaved changes.',
    };
  }

  if (inspection.state === 'clean') {
    return { allowed: true };
  }
  if (inspection.state === 'dirty') {
    return {
      allowed: false,
      rejectCode: 'editor-dirty',
      reason: 'An open Markdown editor has unsaved changes for this note.',
    };
  }
  return {
    allowed: false,
    rejectCode: 'editor-state-unknown',
    reason: 'Could not confirm whether open Markdown editors have unsaved changes.',
  };
}
