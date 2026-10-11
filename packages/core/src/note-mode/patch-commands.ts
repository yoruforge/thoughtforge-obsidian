import type { ThoughtNodeId } from "../domain.js";
import type { TextPatch } from "../patch.js";
import type {
  SemanticCommandBase, RenameMapCommand, RenameNodeCommand, RenameAndInsertSiblingCommand,
  RenameAndInsertChildCommand, InsertChildCommand, InsertSiblingCommand, MoveNodeCommand,
  IndentNodeCommand, OutdentNodeCommand, UpdateNodeNoteCommand, ClearNodeNoteCommand, WrapInNewParentCommand
} from "../semantic-commands.js";
import type { NoteModeReadOnlyReason, UnmappedBlock } from "./types.js";

type Command<T extends string, P extends object = object> = Readonly<SemanticCommandBase & P & { type: T }>;
export type NoteDeleteNodeCommand = Command<"node.delete", { nodeId: ThoughtNodeId; confirmedUnmapped?: true }>;
export type { WrapInNewParentCommand } from "../semantic-commands.js";
export type DeleteKeepChildrenCommand = Command<"node.deleteKeepChildren", { nodeId: ThoughtNodeId }>;
export type UpdateCenterNoteCommand = Command<"map.updateNote", { note: string }>;
export type ClearCenterNoteCommand = Command<"map.clearNote">;
export type NoteSemanticCommand = RenameMapCommand | RenameNodeCommand | RenameAndInsertSiblingCommand
  | RenameAndInsertChildCommand | InsertChildCommand | InsertSiblingCommand | MoveNodeCommand
  | IndentNodeCommand | OutdentNodeCommand | UpdateNodeNoteCommand | ClearNodeNoteCommand
  | NoteDeleteNodeCommand | WrapInNewParentCommand | DeleteKeepChildrenCommand
  | UpdateCenterNoteCommand | ClearCenterNoteCommand;

export type NotePatchRejectReason = "unknown-target" | "note-has-block-syntax" | "note-not-editable"
  | "title-has-newline" | "reindent-unmapped" | "heading-list-conversion" | "heading-level-out-of-range"
  | "delete-keep-children-has-content" | "delete-keep-children-heading-has-list-children"
  | "center-not-deletable" | "needs-confirmation" | "result-not-editable" | "structure-changed"
  | "main-branch-outdent" | "unsupported-position";
export type NotePatchRejectDetail = Readonly<{
  unmappedSummary?: readonly Readonly<{ kind: UnmappedBlock["kind"]; lines: number }>[];
  readOnlyReasons?: readonly NoteModeReadOnlyReason[];
}>;
export type NotePatchResult =
  | Readonly<{ ok: true; patches: readonly TextPatch[]; nextLfText: string; resultNodeId?: ThoughtNodeId | "center";
      idMap: Readonly<Record<ThoughtNodeId, ThoughtNodeId>>; inverseIdMap: Readonly<Record<ThoughtNodeId, ThoughtNodeId>> }>
  | Readonly<{ ok: false; reason: NotePatchRejectReason; detail?: NotePatchRejectDetail }>;

/** Internal control flow; failures are converted to the public result at the boundary. */
export class PatchRejection extends Error {
  readonly reason: NotePatchRejectReason;
  readonly detail?: NotePatchRejectDetail;
  constructor(reason: NotePatchRejectReason, detail?: NotePatchRejectDetail) { super(reason); this.reason = reason; this.detail = detail; }
}
export function reject(reason: NotePatchRejectReason, detail?: NotePatchRejectDetail): never {
  throw new PatchRejection(reason, detail);
}
