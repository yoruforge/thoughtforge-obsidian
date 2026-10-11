import type { ThoughtMap, ValidationIssue, ValidationResult } from "@thoughtforge/core";
import { parseThoughtMapMarkdownWithRecovery } from "@thoughtforge/core";
import { traceDebugEvent } from "./debugTrace.js";
import {
  createModelUpdateMessage,
  createParseErrorMessage,
  getDocumentUri,
  summarizeThoughtMap,
  traceWebviewPostMessage,
  type TextDocumentChangeEventLike,
  type TextDocumentLike,
  type ThoughtForgeExtensionToWebviewMessage,
  type WebviewPanelLike
} from "./protocol.js";

export type ThoughtForgeDocumentSyncOptions = Readonly<{
  debounceMs?: number;
  scheduleTimeout?: (listener: () => void, delayMs: number) => unknown;
  clearScheduledTimeout?: (handle: unknown) => void;
}>;

export type ThoughtForgeDocumentSyncResult = Readonly<{
  map?: ThoughtMap;
  validation: ValidationResult;
  recoveredFromLastValidMap: boolean;
}>;

export type ThoughtForgeDocumentSyncController = Readonly<{
  handleDocumentChanged(event: TextDocumentChangeEventLike): void;
  syncNow(): void;
  dispose(): void;
}>;


export function postModelUpdateToWebview(
  document: TextDocumentLike,
  webviewPanel: WebviewPanelLike,
  map?: ThoughtMap
): Promise<boolean> {
  const message = createModelUpdateMessage(document, map);
  traceWebviewPostMessage(message);
  return postSyncMessageToWebview(webviewPanel, message);
}

export function postParseErrorToWebview(
  document: TextDocumentLike,
  webviewPanel: WebviewPanelLike,
  issues: readonly ValidationIssue[]
): Promise<boolean> {
  const message = createParseErrorMessage(document, issues);
  traceWebviewPostMessage(message);
  return postSyncMessageToWebview(webviewPanel, message);
}

async function postSyncMessageToWebview(
  webviewPanel: WebviewPanelLike,
  message: ThoughtForgeExtensionToWebviewMessage
): Promise<boolean> {
  try {
    return await Promise.resolve(webviewPanel.webview.postMessage?.(message) ?? false);
  } catch (error) {
    traceDebugEvent({
      scope: "webview",
      event: "syncPostMessageFailed",
      source: "extension",
      result: "failed",
      reason: error instanceof Error ? error.message : String(error),
      payload: { type: message.type }
    });
    return false;
  }
}

export function isEmptyThoughtForgeDocument(document: TextDocumentLike): boolean {
  return document.getText().trim().length === 0;
}

export function createEmptyThoughtForgeDraftMap(document: TextDocumentLike): ThoughtMap {
  return {
    title: "",
    roots: [],
    nodesById: {},
    source: {
      sourceId: getDocumentUri(document),
      range: {
        start: { line: 1, column: 3 },
        end: { line: 1, column: 3 }
      }
    }
  };
}

export function parseDocumentForWebviewSync(
  document: TextDocumentLike,
  lastValidMap?: ThoughtMap
): ThoughtForgeDocumentSyncResult {
  const markdown = document.getText();
  traceDebugEvent({
    scope: "parser",
    event: "parseStart",
    source: "extension",
    payload: {
      markdownLength: markdown.length,
      hasLastValidMap: lastValidMap !== undefined
    }
  });
  if (isEmptyThoughtForgeDocument(document)) {
    return {
      map: createEmptyThoughtForgeDraftMap(document),
      validation: { ok: true, issues: [] },
      recoveredFromLastValidMap: false
    };
  }
  const result = parseThoughtMapMarkdownWithRecovery(markdown, {
    sourceId: getDocumentUri(document),
    ...(lastValidMap === undefined ? {} : { lastValidMap })
  });
  traceDebugEvent({
    scope: "parser",
    event: result.validation.ok ? "parseSuccess" : result.map ? "parseRecover" : "parseFailed",
    source: "extension",
    payload: {
      ...summarizeThoughtMap(result.map),
      issueCount: result.validation.issues.length,
      errorCount: result.validation.issues.filter((issue) => issue.severity === "error").length,
      warningCount: result.validation.issues.filter((issue) => issue.severity === "warning").length
    },
    result: result.validation.ok ? "ok" : result.map ? "ignored" : "failed"
  });
  return result;
}

export function postDocumentSyncUpdateToWebview(
  document: TextDocumentLike,
  webviewPanel: WebviewPanelLike,
  lastValidMap?: ThoughtMap
): ThoughtMap | undefined {
  const result = parseDocumentForWebviewSync(document, lastValidMap);

  if (result.validation.ok && result.map) {
    void postModelUpdateToWebview(document, webviewPanel, result.map);
    return result.map;
  }

  void postParseErrorToWebview(document, webviewPanel, result.validation.issues);
  if (result.map) {
    void postModelUpdateToWebview(document, webviewPanel, result.map);
  }

  return result.map ?? lastValidMap;
}


export function createThoughtForgeDocumentSyncController(
  document: TextDocumentLike,
  webviewPanel: WebviewPanelLike,
  options: ThoughtForgeDocumentSyncOptions = {}
): ThoughtForgeDocumentSyncController {
  const debounceMs = options.debounceMs ?? 120;
  const scheduleTimeout = options.scheduleTimeout ?? globalThis.setTimeout;
  const clearScheduledTimeout =
    options.clearScheduledTimeout ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    });
  let lastValidMap: ThoughtMap | undefined;
  let pendingSync: unknown;

  function clearPendingSync(): void {
    if (pendingSync !== undefined) {
      clearScheduledTimeout(pendingSync);
      pendingSync = undefined;
    }
  }

  function syncNow(): void {
    clearPendingSync();
    lastValidMap = postDocumentSyncUpdateToWebview(document, webviewPanel, lastValidMap);
  }

  function scheduleSync(): void {
    clearPendingSync();
    pendingSync = scheduleTimeout(syncNow, debounceMs);
  }

  return {
    handleDocumentChanged(event): void {
      if (getDocumentUri(event.document) === getDocumentUri(document)) {
        scheduleSync();
      }
    },
    syncNow,
    dispose: clearPendingSync
  };
}
