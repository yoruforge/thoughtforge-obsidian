import type { MindMapDocument } from '../core/model';
import type { PatchRejectReason, SemanticCommand } from '../core/patch/commands';

export type SyncRejectCode =
  | PatchRejectReason
  | 'editor-dirty'
  | 'editor-state-unknown'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'io-error';

export interface FileHistoryStatus {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoCount: number;
  readonly redoCount: number;
}

export interface BacklinkItem {
  readonly sourcePath: string;
  readonly sourceTitle: string;
  readonly targetsSpecificAnchor: boolean;
}

/**
 * Host abstraction port for Vault I/O and editor inspection.
 * Implemented in M2 so Sync logic can be unit-tested with pure mocks.
 */
export interface ObsidianHostPort {
  readFile(path: string): Promise<string>;
  processFile(path: string, transform: (current: string) => string): Promise<void>;
  inspectOpenMarkdownEditors(
    path: string,
  ): { readonly state: 'clean' } | { readonly state: 'dirty' } | { readonly state: 'unknown' };
  revealSourceLine(path: string, line: number): Promise<void>;
  openLink(sourcePath: string, linkText: string, newTab: boolean): Promise<void>;
}

/**
 * Reserved read-only port for Phase 2 (M4) Obsidian metadataCache features
 * (backlinks, image embeds, freshness tracking).
 */
export interface NodeMetadataProvider {
  getFreshness(filePath: string, contentHash: string): 'fresh' | 'updating';
  getResolvedImageSrc(sourcePath: string, embedText: string): string | null;
  getBacklinks(filePath: string, headingOrBlockId?: string): readonly BacklinkItem[];
}

export interface CommandDispatchOutcome {
  readonly accepted: boolean;
  readonly rejectCode?: SyncRejectCode;
  readonly reason?: string;
  readonly focusNodeId?: string;
  readonly nextDocument?: MindMapDocument;
  readonly nextRawText?: string;
}

export interface CommandDispatcher {
  dispatch(command: SemanticCommand): Promise<CommandDispatchOutcome>;
}

// TODO: [M2-c/M3 DraftStore] - data.json への下書き退避・回復（field:'title'|'note'）を FileCoordinator / MindMapView に接続する
