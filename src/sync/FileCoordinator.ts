import { parseMarkdownToMap } from '../core/parser';
import { planAndValidatePatch, type PatchExecutionResult } from '../core/patch';
import type { SemanticCommand } from '../core/patch/commands';
import { checkMarkdownEditorGate } from './MarkdownEditorGate';
import type {
  CommandDispatcher,
  CommandDispatchOutcome,
  ObsidianHostPort,
  SyncRejectCode,
} from './ports';

class PatchAbortError extends Error {
  constructor(
    readonly rejectCode: SyncRejectCode,
    message: string,
  ) {
    super(message);
    this.name = 'PatchAbortError';
  }
}

/**
 * Coordinates per-file serialized, CAS-verified, fail-closed writes through ObsidianHostPort.
 */
export class FileCoordinator {
  private readonly queues = new Map<string, Promise<void>>();

  constructor(private readonly host: ObsidianHostPort) {}

  createDispatcher(filePath: string, fallbackTitle: string): CommandDispatcher {
    return {
      dispatch: (command) => this.dispatchForFile(filePath, fallbackTitle, command),
    };
  }

  dispatchForFile(
    filePath: string,
    fallbackTitle: string,
    command: SemanticCommand,
  ): Promise<CommandDispatchOutcome> {
    const previous = this.queues.get(filePath) ?? Promise.resolve();
    const runTask = previous
      .catch(() => undefined)
      .then(() => this.executeSerialized(filePath, fallbackTitle, command));

    const queueTail = runTask.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(filePath, queueTail);
    void queueTail.finally(() => {
      if (this.queues.get(filePath) === queueTail) {
        this.queues.delete(filePath);
      }
    });

    return runTask;
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
    const outcomeBox: { applied: AcceptedPatch | null } = { applied: null };

    try {
      await this.host.processFile(filePath, (currentRaw) => {
        // Re-check editor gate synchronously inside the atomic write callback
        // so edits becoming dirty after queue entry cannot be overwritten.
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

    if (outcomeBox.applied === null) {
      return {
        accepted: false,
        rejectCode: 'io-error',
        reason: 'Vault file processor did not apply the patch.',
      };
    }

    return {
      accepted: true,
      focusNodeId: outcomeBox.applied.focusNodeId,
      nextDocument: outcomeBox.applied.nextDocument,
      nextRawText: outcomeBox.applied.nextRawText,
    };
  }
}
