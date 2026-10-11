import type { ProposalUpdateMessage } from "./proposalProtocol.js";
import type { SemanticCommand, SourceRange, ThoughtMap, ValidationIssue } from "@thoughtforge/core";
import { type DebugTraceRecord, traceDebugEvent } from "./debugTrace.js";

export const THOUGHTFORGE_MAP_VIEW_TYPE = "thoughtforge.map";
export const THOUGHTFORGE_MAP_FILENAME_PATTERN = "*.map.md";
export const THOUGHTFORGE_NEW_MAP_COMMAND = "thoughtforge.newMap";
export const THOUGHTFORGE_OPEN_AS_MAP_COMMAND = "thoughtforge.openAsMap";
export const THOUGHTFORGE_OPEN_SAMPLE_MAP_COMMAND = "thoughtforge.openSampleMap";
export const THOUGHTFORGE_COPY_SELECTED_SUBTREE_COMMAND = "thoughtforge.copySelectedSubtree";
export const THOUGHTFORGE_EXPORT_SUBTREE_OPML_COMMAND = "thoughtforge.exportSelectedSubtreeOpml";
export const THOUGHTFORGE_EXPORT_AI_CONTEXT_PACK_COMMAND = "thoughtforge.exportAiContextPack";
export const THOUGHTFORGE_CREATE_GITHUB_ISSUE_DRAFT_COMMAND =
  "thoughtforge.createGithubIssueDraft";
export const THOUGHTFORGE_COPY_SUPPORT_BUNDLE_COMMAND = "thoughtforge.copySupportBundle";
export const THOUGHTFORGE_FOCUS_SELECTED_COMMAND = "thoughtforge.focusSelectedBranch";
export const THOUGHTFORGE_CLEAR_FOCUS_COMMAND = "thoughtforge.clearFocus";
export const THOUGHTFORGE_COPY_DEBUG_TRACE_COMMAND = "thoughtforge.copyDebugTrace";
export const THOUGHTFORGE_REVEAL_SOURCE_COMMAND = "thoughtforge.revealNodeInSource";
export const THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION = 1;
export const THOUGHTFORGE_CUSTOM_EDITOR_OPTIONS = {
  supportsMultipleEditorsPerDocument: false,
  webviewOptions: {
    retainContextWhenHidden: true
  }
};

export type DisposableLike = {
  dispose(): unknown;
};

export type UriLike = {
  fsPath?: string;
  scheme?: string;
  toString(): string;
};

export type ExtensionContextLike = {
  subscriptions: DisposableLike[];
  extension?: {
    packageJSON?: {
      name?: unknown;
      version?: unknown;
    };
  };
  extensionUri?: UriLike;
  globalStorageUri?: UriLike;
};

export type WorkspaceFolderLike = {
  uri: UriLike;
};

export type TextDocumentLike = {
  uri: UriLike;
  version?: number;
  getText(): string;
};

export type TextDocumentChangeEventLike = {
  document: TextDocumentLike;
};

export type WorkspaceEditLike = {
  replace(uri: TextDocumentLike["uri"], range: unknown, text: string): void;
};

export type WorkspaceEditMetadataLike = Readonly<{
  label: string;
  needsConfirmation?: boolean;
}>;

export type DiagnosticLike = {
  source?: string;
  code?: string | number | { value: string | number; target?: unknown };
  range?: unknown;
  message?: string;
  severity?: unknown;
};

export type DiagnosticCollectionLike = DisposableLike & {
  set(uri: TextDocumentLike["uri"], diagnostics: readonly DiagnosticLike[]): unknown;
  delete?(uri: TextDocumentLike["uri"]): unknown;
};

export type CodeActionLike = {
  title?: string;
  kind?: unknown;
  diagnostics?: readonly DiagnosticLike[];
  edit?: WorkspaceEditLike;
  isPreferred?: boolean;
};

export type CodeActionProviderLike = {
  provideCodeActions(
    document: TextDocumentLike,
    range: unknown,
    context: { diagnostics?: readonly DiagnosticLike[] }
  ): readonly CodeActionLike[];
};

export type WebviewPanelLike = {
  active?: boolean;
  visible?: boolean;
  webview: {
    html: string;
    onDidReceiveMessage?(
      listener: (message: unknown) => unknown,
      thisArg?: unknown,
      disposables?: DisposableLike[]
    ): DisposableLike;
    postMessage?(message: ThoughtForgeExtensionToWebviewMessage): boolean | PromiseLike<boolean>;
    cspSource?: string;
    options?: {
      enableScripts?: boolean;
    };
  };
  onDidChangeViewState?(listener: () => void): DisposableLike;
  onDidDispose?(listener: () => void): DisposableLike;
};


export type ThoughtForgeDocumentSnapshot = Readonly<{
  uri: string;
  version: number | null;
  text: string;
}>;

export type ThoughtForgeWebviewSettings = Readonly<{
  readOnly: boolean;
  keymapMode: "classic" | "vscode";
  debugTrace: boolean;
}>;

export type ThoughtForgeModelUpdateMessage = Readonly<{
  source: "extension";
  type: "thoughtforge.model.update";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  document: ThoughtForgeDocumentSnapshot;
  map?: ThoughtMap;
}>;

export type ThoughtForgeParseErrorMessage = Readonly<{
  source: "extension";
  type: "thoughtforge.parse.error";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  issues: readonly ValidationIssue[];
  fallbackText: string;
}>;

export type ThoughtForgeSettingsUpdateMessage = Readonly<{
  source: "extension";
  type: "thoughtforge.settings.update";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  settings: ThoughtForgeWebviewSettings;
}>;

export type ThoughtForgeFocusActionMessage = Readonly<{
  source: "extension";
  type: "thoughtforge.focus.action";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  action:
    | "focus-selected"
    | "clear-focus"
    | "reveal-source"
    | "copy-selected-subtree"
    | "export-ai-context-pack"
    | "create-github-issue-draft"
    | "export-selected-subtree-opml";
}>;

export type ThoughtForgeCommandResultReason =
  | "validation-failed"
  | "apply-rejected"
  | "unexpected-error";

type ThoughtForgeCommandResultMessageBase = Readonly<{
  source: "extension";
  type: "thoughtforge.command.result";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  requestId: string;
}>;

export type ThoughtForgeCommandResultMessage = ThoughtForgeCommandResultMessageBase &
  (
    | Readonly<{ status: "applied"; reason?: never }>
    | Readonly<{ status: "rejected"; reason: ThoughtForgeCommandResultReason }>
  );

export type ThoughtForgeExtensionToWebviewMessage =
  | ProposalUpdateMessage
  | ThoughtForgeModelUpdateMessage
  | ThoughtForgeParseErrorMessage
  | ThoughtForgeSettingsUpdateMessage
  | ThoughtForgeCommandResultMessage
  | ThoughtForgeFocusActionMessage;

export type ThoughtForgeReadyMessage = Readonly<{
  source: "webview";
  type: "thoughtforge.webview.ready";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
}>;

export type ThoughtForgeCommandMessage = Readonly<{
  source: "webview";
  type: "thoughtforge.command";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  requestId?: string;
  command: SemanticCommand;
}>;

export type ThoughtForgeClipboardWriteMessage = Readonly<{
  source: "webview";
  type: "thoughtforge.clipboard.write";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  text: string;
  format: "markdown" | "opml";
  scope: "node" | "subtree";
  nodeId: string;
}>;

export type ThoughtForgeSettingsChangeMessage = Readonly<{
  source: "webview";
  type: "thoughtforge.settings.change";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  settings: Partial<ThoughtForgeWebviewSettings>;
}>;

export type ThoughtForgeDebugTraceMessage = Readonly<{
  source: "webview";
  type: "thoughtforge.debug.trace";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  record: Omit<DebugTraceRecord, "ts" | "source"> & Partial<Pick<DebugTraceRecord, "ts" | "source">>;
}>;

export type ThoughtForgeMarkdownLinkOpenMessage = Readonly<{
  source: "webview";
  type: "thoughtforge.markdown-link.open";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  title: string;
}>;

export type ThoughtForgeSourceRevealMessage = Readonly<{
  source: "webview";
  type: "thoughtforge.source.reveal";
  protocolVersion: typeof THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION;
  documentUri: string;
  nodeId: string;
  range: SourceRange;
}>;

export type ThoughtForgeWebviewToExtensionMessage =
  | ThoughtForgeReadyMessage
  | ThoughtForgeCommandMessage
  | ThoughtForgeClipboardWriteMessage
  | ThoughtForgeSettingsChangeMessage
  | ThoughtForgeDebugTraceMessage
  | ThoughtForgeMarkdownLinkOpenMessage
  | ThoughtForgeSourceRevealMessage;

export type CustomTextEditorProviderLike = {
  resolveCustomTextEditor(document: TextDocumentLike, webviewPanel: WebviewPanelLike): void;
};

export type VsCodeApiLike = {
  version?: string;
  Position?: new (line: number, character: number) => unknown;
  Range?: new (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  ) => unknown;
  Selection?: new (
    anchorLine: number,
    anchorCharacter: number,
    activeLine: number,
    activeCharacter: number
  ) => unknown;
  TextEditorRevealType?: {
    InCenter?: unknown;
  };
  ViewColumn?: {
    Beside?: unknown;
  };
  WorkspaceEdit?: new () => WorkspaceEditLike;
  Diagnostic?: new (range: unknown, message: string, severity: unknown) => DiagnosticLike;
  DiagnosticSeverity?: {
    Error?: unknown;
    Warning?: unknown;
  };
  CodeAction?: new (title: string, kind?: unknown) => CodeActionLike;
  CodeActionKind?: {
    QuickFix?: unknown;
  };
  Uri?: {
    joinPath?(base: UriLike, ...pathSegments: string[]): UriLike;
  };
  languages?: {
    createDiagnosticCollection?(name: string): DiagnosticCollectionLike;
    registerCodeActionsProvider?(
      selector: unknown,
      provider: CodeActionProviderLike,
      metadata?: { providedCodeActionKinds?: readonly unknown[] }
    ): DisposableLike;
  };
  window: {
    activeTextEditor?: {
      document: TextDocumentLike;
    };
    createOutputChannel?(name: string): {
      appendLine(value: string): void;
      dispose?(): unknown;
    };
    showErrorMessage?(message: string): unknown | PromiseLike<unknown>;
    showTextDocument?(document: unknown, columnOrOptions?: unknown): unknown | PromiseLike<unknown>;
    registerCustomEditorProvider(
      viewType: string,
      provider: CustomTextEditorProviderLike,
      options: typeof THOUGHTFORGE_CUSTOM_EDITOR_OPTIONS
    ): DisposableLike;
  };
  commands?: {
    registerCommand?(command: string, callback: (...args: unknown[]) => unknown): DisposableLike;
    executeCommand?<T = unknown>(command: string, ...args: unknown[]): T | PromiseLike<T>;
  };
  workspace?: {
    isTrusted?: boolean;
    workspaceFolders?: readonly WorkspaceFolderLike[];
    textDocuments?: readonly TextDocumentLike[];
    fs?: {
      readDirectory?(uri: UriLike): readonly [string, number][] | PromiseLike<readonly [string, number][]>;
      stat?(uri: UriLike): { type: number; size: number } | PromiseLike<{ type: number; size: number }>;
      createDirectory?(uri: UriLike): void | PromiseLike<void>;
      writeFile?(uri: UriLike, content: Uint8Array): void | PromiseLike<void>;
      readFile?(uri: UriLike): Uint8Array | PromiseLike<Uint8Array>;
    };
    openTextDocument?(
      uriOrOptions: UriLike | { content: string; language?: string }
    ): unknown | PromiseLike<unknown>;
    getConfiguration?(section?: string): {
      get?<T>(key: string, defaultValue?: T): T | undefined;
    };
    onDidChangeTextDocument?(listener: (event: TextDocumentChangeEventLike) => void): DisposableLike;
    onDidSaveTextDocument?(listener: (document: TextDocumentLike) => void): DisposableLike;
    onDidOpenTextDocument?(listener: (document: TextDocumentLike) => void): DisposableLike;
    applyEdit?(
      edit: WorkspaceEditLike,
      metadata?: WorkspaceEditMetadataLike
    ): boolean | PromiseLike<boolean>;
  };
  env?: {
    language?: string;
    clipboard?: {
      writeText?(text: string): void | PromiseLike<void>;
    };
  };
};


export type ThoughtForgeDebugTraceSink = Readonly<{
  appendRecord(record: DebugTraceRecord): void;
  readLatestTrace(): Promise<string>;
  flush(): Promise<void>;
  dispose(): void;
}>;


export const THOUGHTFORGE_DEFAULT_WEBVIEW_SETTINGS: ThoughtForgeWebviewSettings = {
  readOnly: true,
  keymapMode: "classic",
  debugTrace: false
};


export function getDocumentUri(document: TextDocumentLike): string {
  return document.uri.toString();
}

export function summarizeThoughtMap(map?: ThoughtMap): Record<string, number> | undefined {
  if (!map) {
    return undefined;
  }
  return {
    nodeCount: Object.keys(map.nodesById ?? {}).length,
    rootCount: Array.isArray(map.roots) ? map.roots.length : 0
  };
}

function summarizeExtensionToWebviewMessage(
  message: ThoughtForgeExtensionToWebviewMessage
): Record<string, unknown> {
  if (message.type === "thoughtforge.proposal.update") {
    return { type: message.type, fileCount: message.state.files.length };
  }
  if (message.type === "thoughtforge.model.update") {
    return {
      type: message.type,
      version: message.document.version,
      markdownLength: message.document.text.length,
      ...summarizeThoughtMap(message.map)
    };
  }
  if (message.type === "thoughtforge.parse.error") {
    return {
      type: message.type,
      issueCount: message.issues.length,
      fallbackLength: message.fallbackText.length
    };
  }
  if (message.type === "thoughtforge.settings.update") {
    return {
      type: message.type,
      settings: message.settings
    };
  }
  if (message.type === "thoughtforge.command.result") {
    return {
      type: message.type,
      requestId: message.requestId,
      status: message.status,
      reason: message.reason
    };
  }
  return {
    type: message.type,
    action: message.action
  };
}

export function summarizeWebviewToExtensionMessage(
  message: ThoughtForgeWebviewToExtensionMessage
): Record<string, unknown> {
  if (message.type === "thoughtforge.command") {
    return {
      type: message.type,
      requestId: message.requestId,
      command: message.command.type,
      nodeId: "nodeId" in message.command ? message.command.nodeId : undefined
    };
  }
  if (message.type === "thoughtforge.clipboard.write") {
    return {
      type: message.type,
      scope: message.scope,
      nodeId: message.nodeId,
      textLength: message.text.length
    };
  }
  if (message.type === "thoughtforge.settings.change") {
    return {
      type: message.type,
      settings: message.settings
    };
  }
  if (message.type === "thoughtforge.debug.trace") {
    return {
      type: message.type,
      scope: message.record.scope,
      event: message.record.event,
      nodeId: message.record.nodeId,
      result: message.record.result
    };
  }
  if (message.type === "thoughtforge.markdown-link.open") {
    return {
      type: message.type,
      titleLength: message.title.length
    };
  }
  if (message.type === "thoughtforge.source.reveal") {
    return {
      type: message.type,
      nodeId: message.nodeId,
      line: message.range.start.line
    };
  }
  return {
    type: message.type
  };
}

export function traceWebviewPostMessage(message: ThoughtForgeExtensionToWebviewMessage): void {
  traceDebugEvent({
    scope: "webview",
    event: "postMessage",
    source: "extension",
    payload: summarizeExtensionToWebviewMessage(message)
  });
}


export function createModelUpdateMessage(
  document: TextDocumentLike,
  map?: ThoughtMap
): ThoughtForgeModelUpdateMessage {
  return {
    source: "extension",
    type: "thoughtforge.model.update",
    protocolVersion: THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
    document: {
      uri: getDocumentUri(document),
      version: document.version ?? null,
      text: document.getText()
    },
    ...(map === undefined ? {} : { map })
  };
}

export function createParseErrorMessage(
  document: TextDocumentLike,
  issues: readonly ValidationIssue[]
): ThoughtForgeParseErrorMessage {
  return {
    source: "extension",
    type: "thoughtforge.parse.error",
    protocolVersion: THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
    documentUri: getDocumentUri(document),
    issues,
    fallbackText: document.getText()
  };
}

export function createSettingsUpdateMessage(
  settings: ThoughtForgeWebviewSettings
): ThoughtForgeSettingsUpdateMessage {
  return {
    source: "extension",
    type: "thoughtforge.settings.update",
    protocolVersion: THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
    settings
  };
}

export function createFocusActionMessage(
  action: ThoughtForgeFocusActionMessage["action"]
): ThoughtForgeFocusActionMessage {
  return {
    source: "extension",
    type: "thoughtforge.focus.action",
    protocolVersion: THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
    action
  };
}

export function createCommandResultMessage(
  document: TextDocumentLike,
  requestId: string,
  status: "applied"
): ThoughtForgeCommandResultMessage;
export function createCommandResultMessage(
  document: TextDocumentLike,
  requestId: string,
  status: "rejected",
  reason: ThoughtForgeCommandResultReason
): ThoughtForgeCommandResultMessage;
export function createCommandResultMessage(
  document: TextDocumentLike,
  requestId: string,
  status: ThoughtForgeCommandResultMessage["status"],
  reason?: ThoughtForgeCommandResultReason
): ThoughtForgeCommandResultMessage {
  const base = {
    source: "extension",
    type: "thoughtforge.command.result",
    protocolVersion: THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
    documentUri: getDocumentUri(document),
    requestId
  } as const;
  if (status === "applied") {
    return { ...base, status };
  }
  if (reason === undefined) {
    throw new Error("Rejected ThoughtForge commands require a failure reason.");
  }
  return {
    ...base,
    status,
    reason
  };
}


function isSourcePositionLike(value: unknown): value is SourceRange["start"] {
  const position = value as { line?: unknown; column?: unknown };
  return (
    typeof position === "object" &&
    position !== null &&
    typeof position.line === "number" &&
    Number.isInteger(position.line) &&
    position.line >= 1 &&
    typeof position.column === "number" &&
    Number.isInteger(position.column) &&
    position.column >= 1
  );
}

function isSourceRangeLike(value: unknown): value is SourceRange {
  const range = value as { start?: unknown; end?: unknown };
  return (
    typeof range === "object" &&
    range !== null &&
    isSourcePositionLike(range.start) &&
    isSourcePositionLike(range.end)
  );
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalSourceRangeLike(value: unknown): boolean {
  return value === undefined || isSourceRangeLike(value);
}

function isNullableNodeId(value: unknown): boolean {
  return value === null || isNonEmptyString(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isThoughtForgeWebviewSettingsPatch(value: unknown): value is Partial<ThoughtForgeWebviewSettings> {
  if (!isStringRecord(value)) {
    return false;
  }
  return (
    (value.readOnly === undefined || typeof value.readOnly === "boolean") &&
    (value.debugTrace === undefined || typeof value.debugTrace === "boolean") &&
    (value.keymapMode === undefined || value.keymapMode === "classic" || value.keymapMode === "vscode")
  );
}

function isCopiedSubtree(value: unknown): boolean {
  const pending: unknown[] = [value], seen = new Set<object>();
  while (pending.length) {
    const node = pending.pop();
    if (!isStringRecord(node) || seen.has(node) || typeof node.text !== "string" ||
        /[\r\n\u2028\u2029]/u.test(node.text) || !Array.isArray(node.children)) return false;
    seen.add(node);
    for (let i = 0; i < node.children.length; i++) pending.push(node.children[i]);
  }
  return true;
}

function isSemanticCommandLike(value: unknown): value is SemanticCommand {
  if (!isStringRecord(value) || typeof value.type !== "string" || !isOptionalSourceRangeLike(value.intentRange)) {
    return false;
  }

  switch (value.type) {
    case "map.rename":
      return typeof value.nextTitle === "string";
    case "node.rename":
      return isNonEmptyString(value.nodeId) && typeof value.nextText === "string";
    case "node.renameAndInsertSibling":
      return (
        isNonEmptyString(value.nodeId) &&
        typeof value.nextText === "string" &&
        (value.where === "before" || value.where === "after") &&
        isNonEmptyString(value.nextNodeId) &&
        typeof value.text === "string"
      );
    case "node.renameAndInsertChild":
      return (
        isNonEmptyString(value.nodeId) &&
        typeof value.nextText === "string" &&
        isNonNegativeInteger(value.index) &&
        isNonEmptyString(value.nextNodeId) &&
        typeof value.text === "string"
      );
    case "node.insertChild":
      return (
        isNullableNodeId(value.parentId) &&
        isNonNegativeInteger(value.index) &&
        isNonEmptyString(value.nodeId) &&
        typeof value.text === "string"
      );
    case "node.insertSubtree":
      return isNonEmptyString(value.parentId) && isNonNegativeInteger(value.index) && isCopiedSubtree(value.subtree);
    case "node.insertSibling":
      return (
        isNonEmptyString(value.siblingId) &&
        (value.where === "before" || value.where === "after") &&
        isNonEmptyString(value.nodeId) &&
        typeof value.text === "string"
      );
    case "node.delete":
    case "node.indent":
    case "node.outdent":
    case "node.clearNote":
      return isNonEmptyString(value.nodeId);
    case "node.move":
      return (
        isNonEmptyString(value.nodeId) &&
        isNullableNodeId(value.nextParentId) &&
        isNonNegativeInteger(value.nextIndex)
      );
    case "node.updateNote":
      return isNonEmptyString(value.nodeId) && typeof value.note === "string";
    default:
      return false;
  }
}


export function isThoughtForgeWebviewMessage(
  value: unknown
): value is ThoughtForgeWebviewToExtensionMessage {
  if (!isStringRecord(value)) {
    return false;
  }

  const candidate = value as { documentUri?: unknown; protocolVersion?: unknown; source?: unknown; type?: unknown };
  if (
    candidate.source !== "webview" ||
    candidate.protocolVersion !== THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION ||
    typeof candidate.documentUri !== "string"
  ) {
    return false;
  }

  if (candidate.type === "thoughtforge.debug.trace") {
    const record = (candidate as { record?: unknown }).record;
    return (
      isStringRecord(record) &&
      typeof record.scope === "string" &&
      typeof record.event === "string"
    );
  }

  if (candidate.type === "thoughtforge.markdown-link.open") {
    const linkMessage = candidate as { title?: unknown };
    return typeof linkMessage.title === "string";
  }

  if (candidate.type === "thoughtforge.source.reveal") {
    const revealMessage = candidate as { nodeId?: unknown; range?: unknown };
    return isNonEmptyString(revealMessage.nodeId) && isSourceRangeLike(revealMessage.range);
  }

  if (candidate.type === "thoughtforge.webview.ready") {
    return true;
  }

  if (candidate.type === "thoughtforge.command") {
    const commandMessage = candidate as { command?: unknown; requestId?: unknown };
    return (
      (commandMessage.requestId === undefined || isNonEmptyString(commandMessage.requestId)) &&
      isSemanticCommandLike(commandMessage.command)
    );
  }

  if (candidate.type === "thoughtforge.clipboard.write") {
    const clipboardMessage = candidate as {
      text?: unknown;
      format?: unknown;
      scope?: unknown;
      nodeId?: unknown;
    };
    return (
      typeof clipboardMessage.text === "string" &&
      (clipboardMessage.format === "markdown" || clipboardMessage.format === "opml") &&
      (clipboardMessage.scope === "node" || clipboardMessage.scope === "subtree") &&
      isNonEmptyString(clipboardMessage.nodeId)
    );
  }

  if (candidate.type === "thoughtforge.settings.change") {
    const settingsMessage = candidate as { settings?: unknown };
    return isThoughtForgeWebviewSettingsPatch(settingsMessage.settings);
  }

  return false;
}
