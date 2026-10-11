// Obsidian draft wire v2: C7 adds pending-child and immutable renderer capture timestamps.
export { NOTE_DRAFT_LIMITS } from './draftData.ts';
import type { DraftTarget } from './draftData.ts';
export type { DraftTarget, DraftTombstone, PluginDataV1, PluginDataV2 } from './draftData.ts';
export type { DraftSaveFailure } from './draftStore.ts';
import type { DraftSaveFailure } from './draftStore.ts';
export type DraftSaveMessage = Readonly<{
  source: 'webview'; type: 'thoughtforge.draft.save'; protocolVersion: 2;
  documentUri: string; draftId: string; revision: number; target: DraftTarget; text: string; savedAt: string; final: boolean;
}>;
export type DraftClearMessage = Readonly<{
  source: 'webview'; type: 'thoughtforge.draft.clear'; protocolVersion: 2;
  documentUri: string; draftId: string; revision: number;
}>;
export type DraftSaveResultMessage = Readonly<{
  source: 'extension'; type: 'thoughtforge.draft.save.result'; protocolVersion: 2;
  draftId: string; revision: number; ok: boolean; reason?: DraftSaveFailure;
}>;
export type { DraftRecord as StoredDraft } from './draftData.ts';
export type DraftMatch = Readonly<{ kind: 'same-version' | 'unique'; target: string }> | Readonly<{ kind: 'none' }>;
export type RestoredDraft = Readonly<{
  draftId: string; revision: number; target: DraftTarget; text: string;
  savedAt: string; match: DraftMatch; expired: boolean;
}>;
export type DraftRestoreMessage = Readonly<{
  source: 'extension'; type: 'thoughtforge.draft.restore'; protocolVersion: 2;
  drafts: readonly RestoredDraft[]; otherDeviceCount: number;
}>;
