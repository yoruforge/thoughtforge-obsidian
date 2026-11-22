import type { OffsetRange } from '../model';

/**
 * Guard payload attached to every mutating command to prevent stale writes.
 * Used by the M2 PatchEngine and FileCoordinator CAS verification.
 */
export interface PatchGuard {
  readonly expectedContentHash: string;
  readonly targetNodeId: string;
  readonly expectedTitleRaw: string;
  readonly expectedOwnRangeHash: string;
}

export type SemanticCommand =
  | { readonly type: 'rename'; readonly guard: PatchGuard; readonly newTitle: string }
  | { readonly type: 'updateNote'; readonly guard: PatchGuard; readonly newNoteBody: string }
  | {
      readonly type: 'insertChild';
      readonly guard: PatchGuard;
      readonly title: string;
      readonly position?: 'end' | number;
    }
  | {
      readonly type: 'insertSibling';
      readonly guard: PatchGuard;
      readonly title: string;
      readonly placement: 'after' | 'before';
    }
  | {
      readonly type: 'renameAndInsertChild';
      readonly guard: PatchGuard;
      readonly newTitle: string;
      readonly childTitle: string;
    }
  | { readonly type: 'insertParent'; readonly guard: PatchGuard; readonly parentTitle: string }
  | { readonly type: 'moveSibling'; readonly guard: PatchGuard; readonly direction: 'up' | 'down' }
  | { readonly type: 'indent'; readonly guard: PatchGuard }
  | { readonly type: 'outdent'; readonly guard: PatchGuard }
  | {
      readonly type: 'reparent';
      readonly guard: PatchGuard;
      readonly targetParentId: string;
      readonly index: number;
    }
  | {
      readonly type: 'deleteBranch';
      readonly guard: PatchGuard;
      readonly confirmedUnmapped?: boolean;
    }
  | { readonly type: 'deleteNodeKeepChildren'; readonly guard: PatchGuard }
  | { readonly type: 'pasteBranch'; readonly guard: PatchGuard; readonly subtreeMarkdown: string };

export interface TextEdit {
  readonly range: OffsetRange;
  readonly replacement: string;
}

export type PatchRejectReason =
  | 'read-only-document'
  | 'stale-target'
  | 'newline-in-title'
  | 'invalid-note-block-syntax'
  | 'heading-level-out-of-range'
  | 'mixed-heading-list-conversion'
  | 'indent-sensitive-unmapped-block'
  | 'unmapped-delete-requires-confirmation'
  | 'cannot-promote-with-note-or-unmapped'
  | 'invariant-check-failed';

// TODO: [M2 双方向編集] - planner.ts / apply.ts / validator.ts を実装し、SemanticCommand から最小 TextEdit と Dry-Run 再解析を返す
