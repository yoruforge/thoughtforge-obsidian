import { en, type Messages } from './en';
import { ja } from './ja';

export type LocaleCode = 'ja' | 'en';

export function resolveLocale(rawLocale?: string): LocaleCode {
  const normalized = (rawLocale ?? '').toLowerCase();
  if (normalized.startsWith('ja')) {
    return 'ja';
  }
  return 'en';
}

export function getMessages(rawLocale?: string): Messages {
  return resolveLocale(rawLocale) === 'ja' ? ja : en;
}

export function formatExtractionError(messages: Messages, rawCode?: string): string {
  switch (rawCode) {
    case 'editor-dirty':
      return messages.edit.editorDirty;
    case 'editor-state-unknown':
      return messages.edit.editorUnknown;
    case 'read-only-document':
      return messages.edit.readOnlyRejected;
    case 'blocked-document':
      return messages.edit.blockedDocument;
    case 'stale-target':
      return messages.edit.staleTarget;
    case 'indent-sensitive-unmapped-block':
      return messages.edit.indentSensitiveRejected;
    case 'cannot-extract':
      return messages.edit.cannotModifyRoot;
    case 'invalid-extracted-structure':
    case 'invalid-replacement':
    case 'invalid-list':
    case 'invalid-heading':
      return messages.edit.invariantRejected;
    case 'invalid-target-path':
      return messages.extraction.errors.invalidTargetPath;
    case 'target-same-as-source':
      return messages.extraction.errors.targetSameAsSource;
    case 'target-already-exists':
      return messages.extraction.errors.targetAlreadyExists;
    case 'ambiguous-path':
      return messages.extraction.errors.ambiguousPath;
    case 'destination-missing-or-renamed':
      return messages.extraction.errors.destinationMissingOrRenamed;
    case 'destination-changed':
      return messages.extraction.errors.destinationChanged;
    case 'pending-extraction':
      return messages.extraction.errors.pendingExtraction;
    case 'ambiguous-recovery':
      return messages.extraction.errors.ambiguousRecovery;
    case 'recovery-required':
      return messages.extraction.errors.recoveryRequired;
    case 'branch-changed':
      return messages.extraction.errors.branchChanged;
    case 'metadata-updating':
      return messages.extraction.errors.metadataUpdating;
    case 'unresolved-reference':
      return messages.extraction.errors.unresolvedReference;
    case 'ambiguous-reference':
      return messages.extraction.errors.ambiguousReference;
    case 'unsafe-reference':
      return messages.extraction.errors.unsafeReference;
    case 'invalid-link':
      return messages.extraction.errors.invalidLink;
    case 'storage-unavailable':
      return messages.extraction.errors.storageUnavailable;
    case 'history-changed':
      return messages.extraction.historyRefused;
    default:
      return messages.edit.ioError;
  }
}

export type { Messages };
