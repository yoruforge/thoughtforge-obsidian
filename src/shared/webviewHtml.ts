import {
  createSettingsUpdateMessage,
  getDocumentUri,
  THOUGHTFORGE_DEFAULT_WEBVIEW_SETTINGS,
  THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
  type TextDocumentLike,
  type ThoughtForgeReadyMessage,
  type ThoughtForgeWebviewSettings
} from "./protocol.js";
import { getMapViewDocumentTitle, mapViewCss, renderMapViewMarkup, renderMapViewScript, resolveMapViewLocale } from "@thoughtforge/map-view/map-view";

const THOUGHTFORGE_MAP_DROP_BEFORE_RATIO = 0.35;
const THOUGHTFORGE_MAP_DROP_AFTER_RATIO = 0.65;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toInlineScriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function compactInitialHtmlShell(html: string): string {
  const compact = html.replace(/^[ \t]+/gm, (indent, offset, source) => {
    const lineEnd = source.indexOf("\n", offset);
    const line = source.slice(offset, lineEnd < 0 ? undefined : lineEnd);
    const trimmed = line.trim();

    // Keep function anchors and only top-level function closing braces stable for
    // regex-based contracts. Nested closing-brace indentation is safe to omit.
    return (trimmed === "}" && indent.length <= 6) || trimmed.startsWith("function ") ? indent : "";
  });
  const styleStart = compact.indexOf("<style>") + "<style>".length;
  const styleEnd = compact.indexOf("</style>", styleStart);
  // Only compact the static stylesheet; preserve CSP, script tokens and function
  // anchors. M1 plus the PoC must retain the existing 380000-byte shell budget.
  const css = compact.slice(styleStart, styleEnd).replace(/\s*([{};:,])\s*/g, "$1").replace(/;}/g, "}");
  return compact.slice(0, styleStart) + css + compact.slice(styleEnd).replace(/\n[ \t]*\n/g, "\n").replace(/,\n/g, ",");
}

export function createThoughtForgeWebviewNonce(randomBytes = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)): string {
  const bytes = new Uint8Array(16);
  if (randomBytes) {
    randomBytes(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createThoughtForgeWebviewCsp(nonce: string, cspSource = "'self'"): string {
  // 'none' is only valid alone; omit its ignored token from mixed source lists.
  const resourceSource = cspSource === "'none'" ? "" : `${cspSource} `;
  return [
    "default-src 'none'",
    `img-src ${resourceSource}data:`,
    `style-src ${resourceSource}'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${cspSource}`,
    "connect-src 'none'"
  ].join("; ");
}

export function renderInitialMapEditorHtml(
  document: TextDocumentLike,
  settings: ThoughtForgeWebviewSettings = THOUGHTFORGE_DEFAULT_WEBVIEW_SETTINGS,
  options: { cspSource?: string; nonce?: string; locale?: string } = {}
): string {
  const nonce = options.nonce ?? createThoughtForgeWebviewNonce();
  const csp = escapeHtml(createThoughtForgeWebviewCsp(nonce, options.cspSource));
  const escapedUri = escapeHtml(document.uri.toString());
  const documentUri = toInlineScriptJson(getDocumentUri(document));
  const readyMessage = toInlineScriptJson({
    source: "webview",
    type: "thoughtforge.webview.ready",
    protocolVersion: THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
    documentUri: getDocumentUri(document)
  } satisfies ThoughtForgeReadyMessage);
  const initialSettings = toInlineScriptJson(
    createSettingsUpdateMessage(settings)
  );
  const uiLocale = resolveMapViewLocale(options.locale);

  return compactInitialHtmlShell(`<!doctype html>
<html lang="${uiLocale}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>${getMapViewDocumentTitle(options.locale)}</title>
    <style>
${mapViewCss}
    </style>
  </head>
  <body>
${renderMapViewMarkup(options.locale, escapedUri)}
    <script nonce="${nonce}">
${renderMapViewScript({ THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION, THOUGHTFORGE_MAP_DROP_BEFORE_RATIO, THOUGHTFORGE_MAP_DROP_AFTER_RATIO, readyMessage, initialSettings, documentUri })}
    </script>
  </body>
</html>`);
}
