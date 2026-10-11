import type { SourceRange, ThoughtNodeId } from "./domain.js";

export type SemanticCommandBase = Readonly<{
  /**
   * Discriminant for host-independent routing.
   */
  type: string;
  /**
   * Optional source range pointing at the user action intent.
   * (e.g. selection range in the editor)
   */
  intentRange?: SourceRange;
}>;

type SemanticCommandOf<Type extends string, Payload extends object> = Readonly<
  SemanticCommandBase &
    Payload & {
      type: Type;
    }
>;

export type RenameNodeCommand = SemanticCommandOf<
  "node.rename",
  {
    nodeId: ThoughtNodeId;
    nextText: string;
  }
>;

export type RenameMapCommand = SemanticCommandOf<
  "map.rename",
  {
    nextTitle: string;
  }
>;

export type RenameAndInsertSiblingCommand = SemanticCommandOf<
  "node.renameAndInsertSibling",
  {
    nodeId: ThoughtNodeId;
    nextText: string;
    where: "before" | "after";
    nextNodeId: ThoughtNodeId;
    text: string;
  }
>;

export type RenameAndInsertChildCommand = SemanticCommandOf<
  "node.renameAndInsertChild",
  {
    nodeId: ThoughtNodeId;
    nextText: string;
    index: number;
    nextNodeId: ThoughtNodeId;
    text: string;
  }
>;

export type InsertChildCommand = SemanticCommandOf<
  "node.insertChild",
  {
    parentId: ThoughtNodeId | null;
    /**
     * 0-based index within the parent's children (or roots when parentId is null).
     */
    index: number;
    nodeId: ThoughtNodeId;
    text: string;
  }
>;

/** Copied labels and hierarchy only; IDs/source metadata belong to the confirmed model. */
export type InsertSubtreeNode = Readonly<{ text: string; children: readonly InsertSubtreeNode[] }>;
export type WrapInNewParentCommand = SemanticCommandOf<
  "node.wrapInNewParent", { nodeId: ThoughtNodeId; nextNodeId: ThoughtNodeId; text: string }
>;
export type InsertSubtreeCommand = SemanticCommandOf<
  "node.insertSubtree", { parentId: ThoughtNodeId; index: number; subtree: InsertSubtreeNode }
>;

export type InsertSiblingCommand = SemanticCommandOf<
  "node.insertSibling",
  {
    siblingId: ThoughtNodeId;
    /**
     * Insert before/after the sibling.
     */
    where: "before" | "after";
    nodeId: ThoughtNodeId;
    text: string;
  }
>;

export type DeleteNodeCommand = SemanticCommandOf<
  "node.delete",
  {
    nodeId: ThoughtNodeId;
  }
>;

export type MoveNodeCommand = SemanticCommandOf<
  "node.move",
  {
    nodeId: ThoughtNodeId;
    nextParentId: ThoughtNodeId | null;
    /**
     * 0-based index within the next parent (or roots when nextParentId is null).
     */
    nextIndex: number;
  }
>;

export type IndentNodeCommand = SemanticCommandOf<
  "node.indent",
  {
    nodeId: ThoughtNodeId;
  }
>;

export type OutdentNodeCommand = SemanticCommandOf<
  "node.outdent",
  {
    nodeId: ThoughtNodeId;
  }
>;

export type UpdateNodeNoteCommand = SemanticCommandOf<
  "node.updateNote",
  {
    nodeId: ThoughtNodeId;
    note: string;
  }
>;

export type ClearNodeNoteCommand = SemanticCommandOf<
  "node.clearNote",
  {
    nodeId: ThoughtNodeId;
  }
>;

export type SemanticCommand =
  | RenameMapCommand
  | RenameNodeCommand
  | RenameAndInsertSiblingCommand
  | RenameAndInsertChildCommand
  | InsertSubtreeCommand
  | InsertChildCommand
  | InsertSiblingCommand
  | DeleteNodeCommand
  | MoveNodeCommand
  | IndentNodeCommand
  | OutdentNodeCommand
  | UpdateNodeNoteCommand
  | ClearNodeNoteCommand;
