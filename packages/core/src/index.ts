export const corePackageName = "@thoughtforge/core";

export function getCorePackageBoundary(): string {
  return "Host-independent parsing, validation, command, and patch logic.";
}

export type {
  SourceMetadata,
  SourcePosition,
  SourceRange,
  ThoughtMap,
  ThoughtNode,
  ThoughtNodeId,
  ValidationIssue,
  ValidationResult,
  ValidationSeverity
} from "./domain.js";

export { parseThoughtMapMarkdown } from "./parser.js";
export type { ParseThoughtMapOptions } from "./parser.js";

export {
  importThoughtMapFromOpml,
  serializeThoughtMapToOpml
} from "./opml.js";

export { serializeThoughtMapMarkdown } from "./serializer.js";

export {
  parseThoughtMapMarkdownWithRecovery,
  validateThoughtMapMarkdown
} from "./validation.js";
export type {
  ParseThoughtMapRecoveryOptions,
  ParseThoughtMapRecoveryResult,
  ValidateThoughtMapOptions
} from "./validation.js";

export { applyTextPatches, createMarkdownPatches } from "./patch.js";
export type { TextPatch } from "./patch.js";

export { createMapMdGuard, createMapMdWrapPatches, createMapMdSubtreeProof, createMapMdPastePatches } from "./map-md.js";
export type { MapMdGuard, MapMdSubtreeLimits, MapMdSubtreeProof, MapMdPasteCommand, MapMdPatchResult,
  MapMdPatchSuccess, MapMdFailure, MapMdRejectReason, RawSpan } from "./map-md.js";

export type {
  CommandHandler,
  CommandRegistry,
  CommandRegistryEntry,
  SemanticCommandType
} from "./command-registry.js";
export { createCommandRegistry } from "./command-registry.js";

export type {
  ClassicKeyBinding,
  ClassicKeymapContext,
  ClassicKeymapPlatform
} from "./classic-keymap.js";
export {
  getClassicKeymap,
  normalizeKeyGesture,
  resolveClassicKeyBinding
} from "./classic-keymap.js";

export type {
  ClearNodeNoteCommand,
  DeleteNodeCommand,
  IndentNodeCommand,
  InsertChildCommand,
  InsertSubtreeCommand,
  InsertSubtreeNode,
  InsertSiblingCommand,
  MoveNodeCommand,
  OutdentNodeCommand,
  RenameMapCommand,
  RenameNodeCommand,
  SemanticCommand,
  SemanticCommandBase,
  UpdateNodeNoteCommand
} from "./semantic-commands.js";

export { validateProposal, parseProposalFile, sha256Text, isProposalTextSensitive, proposalTimestampMillis } from "./proposal-format.js";
export type { ProposalFile, ProposalItem, ProposalTarget, ProposalSource, ProposalStatus, ProposalValidationResult, ParsedProposalResult } from "./proposal-format.js";

export { applyProposalCommands, applyProposalItems } from "./proposal-apply.js";
export type { CreatedProposalNode, ProposalApplyContext, ProposalApplyRequest, ProposalApplyFailure, ProposalApplySuccess, ProposalItemsApplyResult } from "./proposal-apply.js";

export { parseNoteMapMarkdown } from "./note-mode/parser.js";
export type { NoteMapParseOptions, NoteMapParseResult, NoteModeIndex, NoteModeCenterInfo,
  NoteModeNodeInfo, NoteModeReadOnlyReason, NoteNotOpenableReason, NoteLineClass, UnmappedBlock
} from "./note-mode/types.js";
export { createNoteMarkdownPatches } from "./note-mode/patch.js";
export type { NoteSemanticCommand, NotePatchResult, NotePatchRejectReason, NotePatchRejectDetail,
  NoteDeleteNodeCommand, WrapInNewParentCommand, DeleteKeepChildrenCommand,
  UpdateCenterNoteCommand, ClearCenterNoteCommand
} from "./note-mode/patch.js";
