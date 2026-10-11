// The legacy VS Code API is also supplied by Obsidian's unchanged bootstrap.
// Keep this as a literal template: the host bundle must not reprint this JS.
export function renderV1MapHostBridgeScript(protocolVersion) {
  return `      function createV1MapHostBridge(documentUri) {
        const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : undefined;
        return {
          policy: vscode?.hostPolicy,
          post(intent, meta) {
            const { type, ...payload } = intent;
            vscode?.postMessage({ source: "webview", type, protocolVersion: ${protocolVersion}, documentUri, ...payload }, meta?.clipboardRequestId);
          },
          subscribe(listener, observe) {
            const receive = (event) => {
              const { source, protocolVersion, documentUri: uri, ...message } = event.data ?? {};
              observe?.(message);
              if (source !== "extension" || protocolVersion !== ${protocolVersion}) return;
              if (message.type === "thoughtforge.command.result" && (uri !== documentUri || typeof message.requestId !== "string")) return;
              if (message.type === "thoughtforge.proposal.update" && uri !== documentUri) return;
              listener(message);
            };
            window.addEventListener("message", receive);
            return () => window.removeEventListener("message", receive);
          },
          subscribeClipboardResult(listener) {
            const receive = (event) => listener({ clipboardRequestId: event.detail?.requestId, ok: event.detail?.ok });
            window.addEventListener("thoughtforge-host-clipboard-result", receive);
            return () => window.removeEventListener("thoughtforge-host-clipboard-result", receive);
          }
        };
      }
`;
}
