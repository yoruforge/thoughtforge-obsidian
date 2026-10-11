import type { SemanticCommand, TextPatch, ThoughtMap, ValidationResult } from "@thoughtforge/core";
import {
  applyTextPatches,
  createMarkdownPatches,
  parseThoughtMapMarkdownWithRecovery
} from "@thoughtforge/core";
import { traceDebugEvent } from "./debugTrace.js";
import {
  isEmptyThoughtForgeDocument,
  parseDocumentForWebviewSync
} from "./documentSync.js";
import {
  getDocumentUri,
  type TextDocumentLike,
  type ThoughtForgeCommandResultReason,
  type VsCodeApiLike,
  type WorkspaceEditLike,
  type WorkspaceEditMetadataLike
} from "./protocol.js";

export type ThoughtForgeCommandApplyResult = Readonly<{
  applied: boolean;
  patches: readonly TextPatch[];
  validation: ValidationResult;
  failureReason?: ThoughtForgeCommandResultReason;
}>;

export type ThoughtForgeCommandTransactionMetadata = WorkspaceEditMetadataLike;


function createRangeFromTextPatch(
  vscodeApi: Pick<VsCodeApiLike, "Range">,
  patch: TextPatch
): unknown {
  if (!vscodeApi.Range) {
    throw new Error("VS Code Range API is unavailable.");
  }

  return new vscodeApi.Range(
    patch.range.start.line - 1,
    patch.range.start.column - 1,
    patch.range.end.line - 1,
    patch.range.end.column - 1
  );
}

export function createWorkspaceEditForTextPatches(
  document: TextDocumentLike,
  patches: readonly TextPatch[],
  vscodeApi: Pick<VsCodeApiLike, "Range" | "WorkspaceEdit">
): WorkspaceEditLike {
  if (!vscodeApi.WorkspaceEdit) {
    throw new Error("VS Code WorkspaceEdit API is unavailable.");
  }

  const workspaceEdit = new vscodeApi.WorkspaceEdit();
  for (const patch of patches) {
    workspaceEdit.replace(document.uri, createRangeFromTextPatch(vscodeApi, patch), patch.text);
  }

  return workspaceEdit;
}

export function createThoughtForgeCommandTransactionMetadata(
  command: SemanticCommand
): ThoughtForgeCommandTransactionMetadata {
  const labels: Record<SemanticCommand["type"], string> = {
    "map.rename": "ThoughtForge: Rename map title",
    "node.rename": "ThoughtForge: Rename node",
    "node.renameAndInsertSibling": "ThoughtForge: Rename and insert sibling node",
    "node.renameAndInsertChild": "ThoughtForge: Rename and insert child node",
    "node.insertSubtree": "ThoughtForge: Paste child branch",
    "node.insertChild": "ThoughtForge: Insert child node",
    "node.insertSibling": "ThoughtForge: Insert sibling node",
    "node.delete": "ThoughtForge: Delete node",
    "node.move": "ThoughtForge: Move node",
    "node.indent": "ThoughtForge: Indent node",
    "node.outdent": "ThoughtForge: Outdent node",
    "node.updateNote": "ThoughtForge: Update node note",
    "node.clearNote": "ThoughtForge: Clear node note"
  };

  return {
    label: labels[command.type],
    needsConfirmation: false
  };
}

function endPositionForMarkdown(markdown: string): { line: number; column: number } {
  const lines = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lastLine = lines[lines.length - 1] ?? "";
  return {
    line: lines.length,
    column: lastLine.length + 1
  };
}

function firstRootInsertionText(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.endsWith("\n\n")) {
    return "- \n";
  }
  if (normalized.endsWith("\n")) {
    return "\n- \n";
  }
  return "\n\n- \n";
}

function rootlessMapRenamePatches(markdown: string, map: ThoughtMap, nextTitle: string): readonly TextPatch[] {
  const patches: TextPatch[] = [];
  if (map.title !== nextTitle) {
    if (!map.source) {
      throw new Error("Map has no source range.");
    }
    patches.push({
      range: map.source.range,
      text: nextTitle
    });
  }
  patches.push({
    range: {
      start: endPositionForMarkdown(markdown),
      end: endPositionForMarkdown(markdown)
    },
    text: firstRootInsertionText(markdown)
  });
  return patches;
}

export async function applyThoughtForgeCommandToDocument(
  document: TextDocumentLike,
  command: SemanticCommand,
  vscodeApi: Pick<VsCodeApiLike, "Range" | "WorkspaceEdit" | "env" | "workspace">
): Promise<ThoughtForgeCommandApplyResult> {
  traceDebugEvent({
    scope: "command",
    event: "dispatch",
    source: "extension",
    command: command.type,
    nodeId: "nodeId" in command ? command.nodeId : undefined,
    payload: command
  });
  let currentValidation: ValidationResult = { ok: true, issues: [] };
  try {
    if (command.type === "map.rename" && isEmptyThoughtForgeDocument(document)) {
      const nextTitle = command.nextTitle.trim();
      if (nextTitle.length === 0) {
        return {
          applied: true,
          patches: [],
          validation: { ok: true, issues: [] }
        };
      }
      const patches: readonly TextPatch[] = [
        {
          range: {
            start: { line: 1, column: 1 },
            end: { line: 1, column: 1 }
          },
          text: `# ${nextTitle}\n\n- \n`
        }
      ];
      const patchedMarkdown = applyTextPatches(document.getText(), patches);
      const patchedResult = parseThoughtMapMarkdownWithRecovery(patchedMarkdown, {
        sourceId: getDocumentUri(document)
      });
      if (!patchedResult.validation.ok) {
        return {
          applied: false,
          patches,
          validation: patchedResult.validation,
          failureReason: "validation-failed"
        };
      }
      const workspaceEdit = createWorkspaceEditForTextPatches(document, patches, vscodeApi);
      const applied = await Promise.resolve(
        vscodeApi.workspace?.applyEdit?.(
          workspaceEdit,
          createThoughtForgeCommandTransactionMetadata(command)
        ) ?? false
      );
      return {
        applied,
        patches,
        validation: patchedResult.validation,
        ...(applied ? {} : { failureReason: "apply-rejected" as const })
      };
    }
    const result = parseDocumentForWebviewSync(document);
    currentValidation = result.validation;

    if (
      command.type === "map.rename" &&
      result.validation.ok &&
      result.map &&
      result.map.roots.length === 0
    ) {
      const nextTitle = command.nextTitle.trim();
      if (nextTitle.length === 0) {
        return {
          applied: true,
          patches: [],
          validation: result.validation
        };
      }
      const patches = rootlessMapRenamePatches(document.getText(), result.map, nextTitle);
      const patchedMarkdown = applyTextPatches(document.getText(), patches);
      const patchedResult = parseThoughtMapMarkdownWithRecovery(patchedMarkdown, {
        sourceId: getDocumentUri(document),
        lastValidMap: result.map
      });
      if (!patchedResult.validation.ok) {
        return {
          applied: false,
          patches,
          validation: patchedResult.validation,
          failureReason: "validation-failed"
        };
      }
      const workspaceEdit = createWorkspaceEditForTextPatches(document, patches, vscodeApi);
      const applied = await Promise.resolve(
        vscodeApi.workspace?.applyEdit?.(
          workspaceEdit,
          createThoughtForgeCommandTransactionMetadata(command)
        ) ?? false
      );
      return {
        applied,
        patches,
        validation: patchedResult.validation,
        ...(applied ? {} : { failureReason: "apply-rejected" as const })
      };
    }

    if (!result.validation.ok || !result.map) {
      traceDebugEvent({
        scope: "command",
        event: "ignored",
        source: "extension",
        command: command.type,
        result: "ignored",
        reason: "parse validation failed",
        payload: { issueCount: result.validation.issues.length }
      });
      return {
        applied: false,
        patches: [],
        validation: result.validation,
        failureReason: "validation-failed"
      };
    }

    const patches = createMarkdownPatches(document.getText(), result.map, command);
    traceDebugEvent({
      scope: "patch",
      event: "create",
      source: "extension",
      command: command.type,
      payload: {
        patchCount: patches.length
      },
      result: "ok"
    });
    const patchedMarkdown = applyTextPatches(document.getText(), patches);
    const patchedResult = parseThoughtMapMarkdownWithRecovery(patchedMarkdown, {
      sourceId: getDocumentUri(document),
      lastValidMap: result.map
    });
    if (!patchedResult.validation.ok) {
      traceDebugEvent({
        scope: "patch",
        event: "reject",
        source: "extension",
        command: command.type,
        payload: {
          patchCount: patches.length,
          issueCount: patchedResult.validation.issues.length
        },
        result: "failed",
        reason: "patched markdown validation failed"
      });
      return {
        applied: false,
        patches,
        validation: patchedResult.validation,
        failureReason: "validation-failed"
      };
    }

    if (patches.length === 0) {
      traceDebugEvent({
        scope: "command",
        event: "handled",
        source: "extension",
        command: command.type,
        result: "ok",
        reason: "no patches"
      });
      return {
        applied: true,
        patches,
        validation: result.validation
      };
    }

    const workspaceEdit = createWorkspaceEditForTextPatches(document, patches, vscodeApi);
    const applied = await Promise.resolve(
      vscodeApi.workspace?.applyEdit?.(
        workspaceEdit,
        createThoughtForgeCommandTransactionMetadata(command)
      ) ?? false
    );
    traceDebugEvent({
      scope: "patch",
      event: "apply",
      source: "extension",
      command: command.type,
      payload: {
        patchCount: patches.length
      },
      result: applied ? "ok" : "failed"
    });

    return {
      applied,
      patches,
      validation: result.validation,
      ...(applied ? {} : { failureReason: "apply-rejected" as const })
    };
  } catch (error) {
    traceDebugEvent({
      scope: "command",
      event: "failed",
      source: "extension",
      command: command.type,
      result: "failed",
      payload: {
        errorName: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error)
      }
    });
    return {
      applied: false,
      patches: [],
      validation: currentValidation,
      failureReason: "unexpected-error"
    };
  }
}
