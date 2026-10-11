import type { SemanticCommand, SourceRange, ThoughtMap, ValidationIssue } from "@thoughtforge/core";
import type { MapCommandId } from './commandIds.mjs';

export type MapCommandAdmission = Readonly<{ status: 'admitted'; route: 'ui' | 'interaction' | 'semantic' | 'history' | 'clipboard' | 'host-navigation' }> |
  Readonly<{ status: 'rejected'; reason: string }> | Readonly<{ status: 'outcome-unknown'; reason: 'dispatch-interrupted' }>;

/** Package-internal messages have no transport source, version or URI envelope. */
export type MapModel = Readonly<{
  type: "thoughtforge.model.update";
  document: Readonly<{ uri: string; version: number | null; text: string }>;
  map?: ThoughtMap;
  /** Opaque host-owned object: its identity must survive delivery/buffering. */
  adapterModel?: object;
}>;

export type MapCommandResult = Readonly<{ type: "thoughtforge.command.result"; requestId: string }> &
  (Readonly<{ status: "applied"; reason?: undefined }> |
   Readonly<{ status: "rejected"; reason: "validation-failed" | "apply-rejected" | "unexpected-error" }>);

export type MapSettings = Readonly<{ readOnly: boolean; keymapMode: "classic" | "vscode"; debugTrace: boolean }>;
export type MapSubtree = Readonly<{ text: string; children: readonly MapSubtree[] }>;
export type MapCommand = (SemanticCommand |
  Readonly<{ type: "node.insertSubtree"; parentId: string; index: number; subtree: MapSubtree }>) & Readonly<{ intentSeq?: number }>;
export type MapIntent =
  | Readonly<{ type: "thoughtforge.webview.ready" }>
  | Readonly<{ type: "thoughtforge.command"; requestId: string; command: MapCommand }>
  | Readonly<{ type: "thoughtforge.clipboard.write"; text: string; format: "markdown" | "opml"; scope: "node" | "subtree"; nodeId: string }>
  | Readonly<{ type: "thoughtforge.markdown-link.open"; title: string }>
  | Readonly<{ type: "thoughtforge.source.reveal"; nodeId: string; range: SourceRange }>
  | Readonly<{ type: "thoughtforge.debug.trace"; record: Readonly<Record<string, unknown>> }>
  | Readonly<{ type: "thoughtforge.proposal.action"; action: string; proposalId?: string; baseVersion?: number }>;

export type MapInbound = MapModel | MapCommandResult
  | Readonly<{ type: "thoughtforge.parse.error"; fallbackText: string; issues: readonly ValidationIssue[] }>
  | Readonly<{ type: "thoughtforge.settings.update"; settings: MapSettings }>
  | Readonly<{ type: "thoughtforge.focus.action"; action: string }>
  | Readonly<{ type: "thoughtforge.proposal.update"; state: unknown; styles?: string }>;

export type MapRendererController = Readonly<{
  render: () => void;
  postCommand: (command: MapCommand) => "blocked" | "queued" | "posted";
  retarget: (previousNodeId: string, resolvedNodeId: string, surface?: string) => void;
  flush: (previousNodeId: string, resolvedNodeId: string) => void;
  dependents: (previousNodeId: string, resolvedNodeId: string) => void;
  overlay: (map: ThoughtMap, meta: unknown) => boolean;
  clearDraft: (nodeId: string) => void;
  removeDraft: (map: ThoughtMap, nodeId: string, parentId: string | null) => void;
  mapCommandContext: () => unknown;
  dispatchMapCommand: (id: MapCommandId, external?: boolean) => MapCommandAdmission;
  updateCommandControls?: (context?: unknown) => void;
  commandAvailability: () => Readonly<{ revision: number; status: 'ready'; available: readonly MapCommandId[] }> | undefined;
}>;
/** Preserve the complete legacy policy, including an absent policy in VS Code. */
export type MapHostPolicy = Readonly<{
  orderedIntents?: boolean;
  singleClickEditsTitle?: boolean;
  structuralPaste?: boolean;
  bindRenderer?: (getState: () => unknown, apply: (model: MapModel) => void, controller: MapRendererController) => void | (() => void);
  beforeModelUpdate?: (model: MapModel) => void;
  afterModelUpdate?: (model: MapModel) => void;
  reconcileMap?: (map: ThoughtMap | undefined, model: MapModel) => ThoughtMap | undefined;
  keepSelectionEmpty?: () => boolean;
  afterRender?: () => void;
  mapCommandGate?: (id: MapCommandId, external?: boolean) => string | undefined;
  mapCommandAvailability?: MapRendererController['commandAvailability'];
  pasteBranch?: (parentId: string, eventText?: string) => void;
  insertParent?: (nodeId: string) => void;
  parentCommand?: (confirm: boolean) => boolean;
  mapCommandLink?: (title: string, nodeId: string, openIn: string) => void;
  mapCommandHistory?: (kind: 'undo' | 'redo') => void;
  commandContextChanged?: () => void;
  allocateCopyEffect?: () => string | undefined;
  inputBlocked?: () => boolean;
  inputEpoch?: () => number;
  stageModel?: (model?: MapModel) => MapModel | undefined;
  takeModel?: () => MapModel | undefined;
  flushModel?: () => void;
  captureBlockedInput?: (target: EventTarget | null) => boolean;
  rawRecovery?: () => unknown;
}>;

export type MapHostBridge = Readonly<{
  policy?: MapHostPolicy;
  post: (intent: MapIntent, meta?: Readonly<{ clipboardRequestId?: string }>) => void;
  /** observe sees an envelope-free payload even when the adapter rejects it. */
  subscribe: (listener: (message: MapInbound) => void, observe?: (payload: unknown) => void) => () => void;
  subscribeClipboardResult?: (listener: (result: Readonly<{ clipboardRequestId: string; ok: boolean }>) => void) => () => void;
}>;
/** One screen per document; mount disposes the previous screen, reusing its host. */
export type MapViewLifecycle = Readonly<{ mount: () => () => void; dispose: () => void }>;
declare global { interface Window { __thoughtforgeMapView?: MapViewLifecycle } }
