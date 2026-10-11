import { createThoughtForgeWebviewNonce, renderInitialMapEditorHtml } from "./shared/webviewHtml.js";
import type { TextDocumentLike } from "./shared/protocol.js";
import { createRawInputRecovery } from './rawInputRecovery.ts';
import { bootstrap } from "./bootstrap.ts";
import { createRendererV2 } from './rendererV2.ts';
import { DraftNavigationGate } from './draftNavigation.ts';
import { createMapCommandValidator } from './mapCommandTransport.ts';
import { MAP_COMMAND_IDS } from '../packages/map-view/src/map-view/commandIds.mjs';

export function renderMapFrame(document: TextDocumentLike, generation: number, reason?: string, protocolVersion?: 2, theme?: Record<string, string>): string {
  const nonce = createThoughtForgeWebviewNonce();
  const html = renderInitialMapEditorHtml(document, { readOnly: !!reason, keymapMode: "classic", debugTrace: false },
    { nonce, cspSource: "'none'", locale: "ja" });
  const options = JSON.stringify({ generation, version: document.version ?? 1, reason, protocolVersion, theme, commandIds: MAP_COMMAND_IDS }).replace(/</g, "\\u003c");
  const script = `<script nonce="${nonce}">(${bootstrap.toString()})(${options}, (${createRawInputRecovery.toString()}), (${createRendererV2.toString()}), (${DraftNavigationGate.toString()}), (${createMapCommandValidator.toString()}));</script>`;
  const meta = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i;
  if (!meta.test(html)) throw new Error("CSP meta missing");
  // M1 proposals belong to the VS Code host; this PoC has no proposal adapter.
  // Retain the shared script and its CSP while hiding the unsupported action.
  return html.replace(meta, (match) => match + script)
    .replace('data-thoughtforge-proposal-toggle', 'hidden data-thoughtforge-proposal-toggle');
}
