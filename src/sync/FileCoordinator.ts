import type { MindMapDocument } from '../core/model';
import { parseMarkdownToMap } from '../core/parser';
import { validateVaultNotePath } from '../core/patch/extractBranch';
import { planAndValidatePatch, type PatchExecutionResult } from '../core/patch';
import type { SemanticCommand } from '../core/patch/commands';
import { checkMarkdownEditorGate } from './MarkdownEditorGate';
import type {
  CommandDispatcher,
  CommandDispatchOutcome,
  FileHistoryStatus,
  ObsidianHostPort,
  SyncRejectCode,
} from './ports';

import { commitExtraction, confirmExtraction, extractBranch, type ExtractionHost, type ExtractionRecord, type ExtractionRequest } from './branchExtraction';

const DEFAULT_MAX_HISTORY_ENTRIES = 100;
const DEFAULT_MAX_HISTORY_CHARS_PER_FILE = 5 * 1024 * 1024;

interface HistoryEntry {
  readonly extraction?: ExtractionRecord;
  readonly beforeRawText: string;
  readonly afterRawText: string;
  readonly focusBeforeHeaderLine: number;
  readonly focusAfterHeaderLine: number;
  readonly charCost: number;
}

interface FileHistoryState {
  readonly undoStack: HistoryEntry[];
  readonly redoStack: HistoryEntry[];
}

export interface FileCoordinatorOptions {
  extractionHost?: ExtractionHost;
  readonly maxHistoryEntries?: number;
  readonly maxHistoryCharsPerFile?: number;
}

class PatchAbortError extends Error {
  constructor(
    readonly rejectCode: SyncRejectCode,
    message: string,
  ) {
    super(message);
    this.name = 'PatchAbortError';
  }
}

export function extractionFailureCode(error: unknown): SyncRejectCode {
  const reason = error instanceof Error ? error.message : error;
  switch (reason) {
    case 'editor-dirty':
    case 'editor-state-unknown':
    case 'read-only-document':
    case 'blocked-document':
    case 'stale-target':
    case 'indent-sensitive-unmapped-block':
      return reason;
    case 'cannot-extract':
      return 'cannot-modify-root';
    case 'invalid-extracted-structure':
    case 'invalid-replacement':
    case 'invalid-list':
    case 'invalid-heading':
      return 'invariant-check-failed';
    default:
      return 'io-error';
  }
}

function resolveFocusNodeId(doc: MindMapDocument, preferredHeaderLine: number): string {
  if (preferredHeaderLine >= 0) {
    for (const node of doc.nodes.values()) {
      if (node.kind !== 'central-virtual' && node.headerLine === preferredHeaderLine) {
        return node.id;
      }
    }
  }
  return doc.rootId;
}

/**
 * Coordinates per-file serialized, CAS-verified, fail-closed writes and per-file
 * CAS-protected Undo/Redo stacks through ObsidianHostPort.
 */
export class FileCoordinator {
  private readonly extractionHost?: ExtractionHost;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly histories = new Map<string, FileHistoryState>();
  private readonly maxHistoryEntries: number;
  private readonly maxHistoryCharsPerFile: number;

  constructor(
    private readonly host: ObsidianHostPort,
    options?: FileCoordinatorOptions,
  ) {
    this.extractionHost = options?.extractionHost;
    this.maxHistoryEntries = options?.maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;
    this.maxHistoryCharsPerFile =
      options?.maxHistoryCharsPerFile ?? DEFAULT_MAX_HISTORY_CHARS_PER_FILE;
  }

  createDispatcher(filePath: string, fallbackTitle: string): CommandDispatcher {
    return {
      dispatch: (command) => this.dispatchForFile(filePath, fallbackTitle, command),
    };
  }

  getHistoryStatus(filePath: string): FileHistoryStatus {
    const state = this.histories.get(filePath);
    const undoCount = state?.undoStack.length ?? 0;
    const redoCount = state?.redoStack.length ?? 0;
    return {
      canUndo: undoCount > 0,
      canRedo: redoCount > 0,
      undoCount,
      redoCount,
    };
  }

  clearHistory(filePath: string): void {
    this.histories.delete(filePath);
  }

  renameHistoryPath(oldPath: string, newPath: string): void {
    if (oldPath === newPath) return;
    const existing = this.histories.get(oldPath);
    if (!existing) return;
    this.histories.delete(oldPath);
    this.histories.set(newPath, existing);
  }

  dispatchForFile(
    filePath: string,
    fallbackTitle: string,
    command: SemanticCommand,
  ): Promise<CommandDispatchOutcome> {
    return this.enqueueForFile(filePath, () =>
      this.executeSerialized(filePath, fallbackTitle, command),
    );
  }

  undoForFile(filePath: string, fallbackTitle: string): Promise<CommandDispatchOutcome> {
    return this.enqueueForFile(filePath, () =>
      this.executeHistoryStep(filePath, fallbackTitle, 'undo'),
    );
  }

  redoForFile(filePath: string, fallbackTitle: string): Promise<CommandDispatchOutcome> {
    return this.enqueueRedo(filePath, fallbackTitle);
  }

  private async enqueueRedo(
    filePath: string,
    fallbackTitle: string,
  ): Promise<CommandDispatchOutcome> {
    let expectedDestination = this.histories.get(filePath)?.redoStack.at(-1)?.extraction?.destination;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const paths = expectedDestination ? [filePath, expectedDestination] : [filePath];
      let needsReacquire = false;
      let nextDestination: string | undefined;
      const outcome = await this.enqueueForPaths(paths, () => {
        const liveDest = this.histories.get(filePath)?.redoStack.at(-1)?.extraction?.destination;
        if (liveDest !== expectedDestination) {
          needsReacquire = true;
          nextDestination = liveDest;
          return Promise.resolve({
            accepted: false,
            rejectCode: 'boundary-no-op',
            reason: 'reacquire-redo-lock',
          });
        }
        return this.executeHistoryStep(filePath, fallbackTitle, 'redo', expectedDestination);
      });
      if (needsReacquire) {
        expectedDestination = nextDestination;
        continue;
      }
      return outcome;
    }
    return {
      accepted: false,
      rejectCode: 'stale-target',
      reason: 'history-changed',
    };
  }

  extract(request: ExtractionRequest): Promise<CommandDispatchOutcome> {
    let destination: string;
    try {
      destination = validateVaultNotePath(request.destination, request.source);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return Promise.resolve({
        accepted: false,
        rejectCode: extractionFailureCode(reason),
        reason,
      });
    }
    return this.enqueueForPaths([request.source, destination], async () => {
      if (!this.extractionHost) return { accepted: false, rejectCode: 'unsupported-command' };
      try {
        const record = await extractBranch(this.extractionHost, request);
        const parsed = parseMarkdownToMap(
          record.after,
          request.source.split('/').pop()!.replace(/\.md$/i, ''),
        );
        if (parsed.status !== 'ok') throw new Error('invalid-replacement');
        this.pushUndoEntry(request.source, {
          extraction: record,
          beforeRawText: record.before,
          afterRawText: record.after,
          focusBeforeHeaderLine: record.line,
          focusAfterHeaderLine: record.line,
          charCost: record.before.length + record.after.length + record.output.length,
        });
        return {
          accepted: true,
          nextRawText: record.after,
          nextDocument: parsed.document,
          focusNodeId: resolveFocusNodeId(parsed.document, record.line),
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
          accepted: false,
          rejectCode: extractionFailureCode(reason),
          reason,
        };
      }
    });
  }

  async dismissExtraction(record: ExtractionRecord): Promise<void> {
    const result = await this.enqueueForPaths([record.source, record.destination], async () => {
      const host = this.extractionHost;
      if (!host || host.records().find((r) => r.id === record.id) !== record) {
        return { accepted: false };
      }
      await host.remove(record.id);
      return { accepted: true };
    });
    if (!result.accepted) throw new Error('recovery-record-changed');
  }

  reconcileExtraction(record: ExtractionRecord): Promise<CommandDispatchOutcome> {
    return this.enqueueForPaths([record.source, record.destination], async () => {
      if (!this.extractionHost || record.phase !== 'replacing')
        return { accepted: false, rejectCode: 'unsupported-command' };
      try {
        if (this.extractionHost.records().find((r) => r.id === record.id) !== record) {
          return { accepted: false, rejectCode: 'stale-target' };
        }
        await confirmExtraction(this.extractionHost, record);
        return { accepted: true };
      } catch (error) {
        return {
          accepted: false,
          rejectCode: 'io-error',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  private enqueueForFile(filePath: string, task: () => Promise<CommandDispatchOutcome>) {
    return this.enqueueForPaths([filePath], task);
  }

  private enqueueForPaths(paths: readonly string[], task: () => Promise<CommandDispatchOutcome>) {
    // Reserve every path in the same tick, before yielding to a competing operation.
    const keys = [...new Set(paths.map((path) => path.toLowerCase()))].sort();
    const runTask = Promise.all(keys.map((key) => this.queues.get(key))).then(task);
    const tail = runTask.then(
      () => undefined,
      () => undefined,
    );
    for (const key of keys) this.queues.set(key, tail);
    void tail.then(() => {
      for (const key of keys) {
        if (this.queues.get(key) === tail) this.queues.delete(key);
      }
    });
    return runTask;
  }

  private getOrCreateHistory(filePath: string): FileHistoryState {
    let state = this.histories.get(filePath);
    if (!state) {
      state = { undoStack: [], redoStack: [] };
      this.histories.set(filePath, state);
    }
    return state;
  }

  private pushUndoEntry(filePath: string, entry: HistoryEntry): void {
    const state = this.getOrCreateHistory(filePath);
    state.undoStack.push(entry);
    state.redoStack.length = 0;

    let totalChars = 0;
    for (const item of state.undoStack) {
      totalChars += item.charCost;
    }
    while (
      state.undoStack.length > 1 &&
      (state.undoStack.length > this.maxHistoryEntries || totalChars > this.maxHistoryCharsPerFile)
    ) {
      const removed = state.undoStack.shift();
      if (removed) {
        totalChars -= removed.charCost;
      }
    }
  }

  private async executeSerialized(
    filePath: string,
    fallbackTitle: string,
    command: SemanticCommand,
  ): Promise<CommandDispatchOutcome> {
    const gate = checkMarkdownEditorGate(this.host, filePath);
    if (!gate.allowed) {
      return {
        accepted: false,
        rejectCode: gate.rejectCode,
        reason: gate.reason,
      };
    }

    type AcceptedPatch = Extract<PatchExecutionResult, { readonly ok: true }>;
    const outcomeBox: {
      applied: AcceptedPatch | null;
      beforeRawText: string | null;
      focusBeforeHeaderLine: number;
    } = { applied: null, beforeRawText: null, focusBeforeHeaderLine: -1 };

    try {
      await this.host.processFile(filePath, (currentRaw) => {
        const callbackGate = checkMarkdownEditorGate(this.host, filePath);
        if (!callbackGate.allowed) {
          throw new PatchAbortError(callbackGate.rejectCode, callbackGate.reason);
        }

        const parsed = parseMarkdownToMap(currentRaw, fallbackTitle);
        if (parsed.status !== 'ok') {
          throw new PatchAbortError('blocked-document', parsed.detail);
        }

        const result = planAndValidatePatch(currentRaw, parsed.document, fallbackTitle, command);
        if (!result.ok) {
          throw new PatchAbortError(result.reason, result.detail);
        }

        const beforeTarget = parsed.document.nodes.get(command.guard.targetNodeId);
        outcomeBox.beforeRawText = currentRaw;
        outcomeBox.focusBeforeHeaderLine =
          beforeTarget && beforeTarget.kind !== 'central-virtual' ? beforeTarget.headerLine : -1;
        outcomeBox.applied = result;
        return result.nextRawText;
      });
    } catch (err) {
      if (err instanceof PatchAbortError) {
        return {
          accepted: false,
          rejectCode: err.rejectCode,
          reason: err.message,
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to write Markdown file.';
      return {
        accepted: false,
        rejectCode: 'io-error',
        reason: message,
      };
    }

    if (outcomeBox.applied === null || outcomeBox.beforeRawText === null) {
      return {
        accepted: false,
        rejectCode: 'io-error',
        reason: 'Vault file processor did not apply the patch.',
      };
    }

    const applied = outcomeBox.applied;
    const afterFocused = applied.nextDocument.nodes.get(applied.focusNodeId);
    const focusAfterHeaderLine =
      afterFocused && afterFocused.kind !== 'central-virtual' ? afterFocused.headerLine : -1;

    this.pushUndoEntry(filePath, {
      beforeRawText: outcomeBox.beforeRawText,
      afterRawText: applied.nextRawText,
      focusBeforeHeaderLine: outcomeBox.focusBeforeHeaderLine,
      focusAfterHeaderLine,
      charCost: outcomeBox.beforeRawText.length + applied.nextRawText.length,
    });

    return {
      accepted: true,
      focusNodeId: applied.focusNodeId,
      nextDocument: applied.nextDocument,
      nextRawText: applied.nextRawText,
    };
  }

  private async executeHistoryStep(
    filePath: string,
    fallbackTitle: string,
    direction: 'undo' | 'redo',
    lockedDestination?: string,
  ): Promise<CommandDispatchOutcome> {
    const state = this.histories.get(filePath);
    const sourceStack = direction === 'undo' ? state?.undoStack : state?.redoStack;
    const targetStack = direction === 'undo' ? state?.redoStack : state?.undoStack;

    if (!state || !sourceStack || !targetStack || sourceStack.length === 0) {
      return {
        accepted: false,
        rejectCode: direction === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo',
        reason: direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.',
      };
    }

    const entry = sourceStack[sourceStack.length - 1];
    if (!entry) {
      return {
        accepted: false,
        rejectCode: direction === 'undo' ? 'nothing-to-undo' : 'nothing-to-redo',
        reason: direction === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.',
      };
    }

    const gate = checkMarkdownEditorGate(this.host, filePath);
    if (!gate.allowed) {
      return {
        accepted: false,
        rejectCode: gate.rejectCode,
        reason: gate.reason,
      };
    }

    const expectedCurrentRaw = direction === 'undo' ? entry.afterRawText : entry.beforeRawText;
    const nextRawText = direction === 'undo' ? entry.beforeRawText : entry.afterRawText;
    const preferredFocusLine =
      direction === 'undo' ? entry.focusBeforeHeaderLine : entry.focusAfterHeaderLine;

    const outcomeBox: { nextDocument: MindMapDocument | null } = { nextDocument: null };
    let divergedExternally = false;

    try {
      if (direction === 'redo' && entry.extraction) {
        if (!this.extractionHost || lockedDestination !== entry.extraction.destination) {
          throw new Error('history-changed');
        }
        if ((await this.host.readFile(filePath)) !== expectedCurrentRaw) {
          divergedExternally = true;
          throw new PatchAbortError('stale-target', 'Source changed since undo.');
        }
        await commitExtraction(
          this.extractionHost,
          { ...entry.extraction, source: filePath, fromRedo: true },
        );
        const parsed = parseMarkdownToMap(nextRawText, fallbackTitle);
        if (parsed.status !== 'ok') throw new Error('invalid-replacement');
        outcomeBox.nextDocument = parsed.document;
      } else {
        await this.host.processFile(filePath, (currentRaw) => {
          const callbackGate = checkMarkdownEditorGate(this.host, filePath);
          if (!callbackGate.allowed) {
            throw new PatchAbortError(callbackGate.rejectCode, callbackGate.reason);
          }

          if (currentRaw !== expectedCurrentRaw) {
            divergedExternally = true;
            throw new PatchAbortError(
              'stale-target',
              'Cannot apply undo/redo because the note was modified outside the mind map.',
            );
          }

          const reparsed = parseMarkdownToMap(nextRawText, fallbackTitle);
          if (reparsed.status !== 'ok') {
            throw new PatchAbortError('blocked-document', reparsed.detail);
          }
          if (reparsed.document.readOnlyReasons.length > 0) {
            throw new PatchAbortError(
              'invariant-check-failed',
              `Restored snapshot became read-only (${reparsed.document.readOnlyReasons.join(', ')}).`,
            );
          }

          outcomeBox.nextDocument = reparsed.document;
          return nextRawText;
        });
      }
    } catch (err) {
      if (divergedExternally) {
        // Drop diverged history so subsequent undo/redo cannot clobber external edits.
        this.histories.delete(filePath);
      }
      if (err instanceof PatchAbortError) {
        return {
          accepted: false,
          rejectCode: err.rejectCode,
          reason: err.message,
        };
      }
      const message = err instanceof Error ? err.message : 'Failed to write Markdown file.';
      return {
        accepted: false,
        rejectCode: 'io-error',
        reason: message,
      };
    }

    if (outcomeBox.nextDocument === null) {
      return {
        accepted: false,
        rejectCode: 'io-error',
        reason: 'Vault file processor did not apply undo/redo.',
      };
    }

    sourceStack.pop();
    targetStack.push(entry);

    return {
      accepted: true,
      focusNodeId: resolveFocusNodeId(outcomeBox.nextDocument, preferredFocusLine),
      nextDocument: outcomeBox.nextDocument,
      nextRawText,
    };
  }
}
