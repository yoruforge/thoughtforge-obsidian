import type { createRawInputRecovery } from './rawInputRecovery.ts';
import type { createRendererV2 } from './rendererV2.ts';
import type { DraftNavigationGate } from './draftNavigation.ts';
import type { createMapCommandValidator } from './mapCommandTransport.ts';
// Serialized into the first nonce script, immediately following the CSP meta.
// All state is local to the opaque-origin frame; there is no Node/host import.
export function bootstrap(options: { generation: number; version: number; reason?: string; protocolVersion?: 2; theme?: Record<string, string>; commandIds?: readonly string[] }, recoveryFactory: typeof createRawInputRecovery,
  adapterFactory?: typeof createRendererV2, NavigationGate?: typeof DraftNavigationGate, validatorFactory?: typeof createMapCommandValidator): void {
  const parentWindow = window.parent;
  // Obsidian's theme colors for the shared --vscode-* variables (the map is white without them). Same filter as
  // theme.ts safeThemeValue (serialized separately, so it is repeated here). A key the new theme lacks is removed.
  let themed = new Set<string>();
  const applyTheme = (vars: unknown): void => {
    if (!vars || typeof vars !== 'object') return;
    const next = new Set<string>(), root = document.documentElement.style;
    for (const [name, value] of Object.entries(vars as Record<string, unknown>)) {
      if (typeof value !== 'string' || !value || value.length > 300 || !(name.startsWith('--vscode-') || name === 'color-scheme')) continue;
      const ok = name === 'color-scheme' ? value === 'light' || value === 'dark' : name.endsWith('font-family') ? /^[\p{L}\p{N}\s"',._-]+$/u.test(value)
        : /^[\w\s#.,%\/()*+-]+$/.test(value) && [...value.matchAll(/([a-z-]+)\s*\(/gi)].every(m => /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|calc|min|max|clamp)$/i.test(m[1]!));
      if (ok) { root.setProperty(name, value); next.add(name); }
    }
    for (const name of themed) if (!next.has(name)) root.removeProperty(name);
    themed = next;
  };
  applyTheme(options.theme);
  const raw = recoveryFactory(document);
  let port: MessagePort | undefined, connected = false, baseVersion = options.version;
  let explorable = false;
  let reason = options.reason, composing = false, compositionEnded = -Infinity;
  const delivered = new WeakSet<Event>(), pending: object[] = [];
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const send = (payload: object): boolean => {
    const envelope = { generation: options.generation, baseVersion, ...payload };
    try { if (port) port.postMessage(envelope); else pending.push(envelope); return true; } catch { return false; }
  };
  const forward = (message: object): void => {
    const forwarded = new MessageEvent('message', { data: message }); delivered.add(forwarded); window.dispatchEvent(forwarded);
  };
  let focusFrame: number | undefined, receivingModel = false;
  const scheduleFocus = () => {
    if (!raw.hasSavedFocus()) return;
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined;
      if (!reason && !composing) raw.restoreFocus(); else raw.cancelFocus();
    });
  };
  const setGate = (next: string | undefined, allowExplore = false) => {
    explorable = allowExplore;
    const entering = !reason && !!next, leaving = !!reason && !next;
    if (entering) {
      if (focusFrame !== undefined) { cancelAnimationFrame(focusFrame); focusFrame = undefined; }
      raw.rememberFocus(); if (composing) raw.cancelFocus();
    }
    reason = next;
    if (reason) { composing = false; compositionEnded = performance.now(); raw.gate(); }
    applyReadOnly();
    // A model's afterModelUpdate owns the final draw; readOnly-only releases
    // have no draw callback, so schedule them here instead.
    if (leaving && !receivingModel) scheduleFocus();
  };
  const adapter = options.protocolVersion === 2 && adapterFactory && NavigationGate ? adapterFactory(document, raw,
    (message, clipboardRequestId) => send({ message, ...(clipboardRequestId ? { clipboardRequestId } : {}) }), forward,
    setGate, NavigationGate, validatorFactory && options.commandIds ? { generation: options.generation, ids: options.commandIds,
      validator: validatorFactory(options.commandIds), send: payload => {
        if (!port) return false;
        try { port.postMessage({ generation: options.generation, baseVersion, obsidianOnly: 'mapCommand', mapCommand: payload }); return true; } catch { return false; }
      } } : undefined) : undefined;
  const api = Object.freeze({ hostPolicy: Object.freeze({ orderedIntents: !!adapter, singleClickEditsTitle: false, structuralPaste: !adapter,
    bindRenderer: adapter?.bindRenderer ?? raw.bindRenderer, beforeModelUpdate: adapter?.beforeModelUpdate ?? raw.capture,
    afterModelUpdate: () => { if (adapter) adapter.afterModelUpdate(); else raw.modelApplied(); if (!reason) scheduleFocus(); },
    reconcileMap: adapter?.reconcileMap, keepSelectionEmpty: adapter?.keepSelectionEmpty,
    afterRender: () => adapter?.updateUI(false),
    mapCommandGate: adapter?.mapCommandGate, mapCommandAvailability: adapter?.mapCommandAvailability,
    insertParent: adapter?.insertParent, parentCommand: adapter?.parentCommand, pasteBranch: adapter?.pasteBranch,
    mapCommandHistory: adapter?.history, mapCommandLink: adapter?.mapCommandLink,
    commandContextChanged: adapter?.commandContextChanged, allocateCopyEffect: adapter?.allocateCopyEffect,
    inputBlocked: () => !!reason, inputEpoch: raw.epoch, stageModel: raw.stageModel, takeModel: () => reason ? undefined : raw.takeModel(), flushModel: () => { if (!reason) raw.flushModel(); },
    captureBlockedInput: (input: EventTarget | null) => { if (!reason && (!(input instanceof Element) || input.isConnected)) return false; raw.captureInput(input); adapter?.captureInput(input, true); return true; },
    rawRecovery: raw.snapshot }), postMessage: (message: { type?: string }, clipboardRequestId?: string) => {
    if (reason && message?.type === "thoughtforge.command") return;
    if (adapter) { adapter.post(message, clipboardRequestId); return; }
    send({ message, ...(message?.type === "thoughtforge.clipboard.write" && clipboardRequestId ? { clipboardRequestId } : {}) });
  } });
  (window as Window & { acquireVsCodeApi?: () => typeof api }).acquireVsCodeApi = () => api;
  let retainedInput: HTMLElement | undefined;
  const showRetainedInput = () => {
    if (!retainedInput) {
      retainedInput = document.createElement('section');
      retainedInput.setAttribute('data-thoughtforge-recovery', 'true');
      retainedInput.setAttribute('data-thoughtforge-retired-input', 'true');
      retainedInput.style.cssText = 'padding:12px'; document.body.prepend(retainedInput);
    }
    retainedInput.replaceChildren();
    for (const entry of raw.snapshot()) {
      const input = document.createElement('textarea'); input.readOnly = true; input.value = entry.text;
      input.setAttribute('aria-label', '以前の入力（表示・コピーのみ）'); input.style.cssText = 'display:block;width:100%;min-height:72px';
      const button = document.createElement('button'); button.textContent = 'コピー';
      button.onclick = () => adapter?.post({ source: 'webview', type: 'thoughtforge.clipboard.write', text: input.value, format: 'text', scope: 'node', nodeId: 'center' });
      retainedInput.append(input, button);
    }
  };
  let band: HTMLElement | undefined;
  const applyReadOnly = (): void => {
    if (!("inert" in HTMLElement.prototype)) reason = "この環境のinert対応を確認できないため、書き込みを止めました";
    if (!document.body) return;
    if (!reason) raw.restore();
    if (!band) {
      band = document.createElement("div"); band.id = "thoughtforge-poc-readonly";
      band.setAttribute("role", "status"); band.tabIndex = 0;
      band.style.cssText = "padding:10px;background:#473a11;color:#fff;font:14px sans-serif;position:relative;z-index:10000";
      document.body.prepend(band);
    }
    band.hidden = !reason;
    band.textContent = reason ? reason + "。地図は表示のみです" : "";
    for (const root of Array.from(document.body.children)) if (root !== band && !root.hasAttribute('data-thoughtforge-recovery')) {
      if (reason && !explorable) root.setAttribute("inert", ""); else root.removeAttribute("inert");
    }
  };
  // Gate globals as well as inert descendants. Preserve native Tab escape.
  for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "paste", "cut", "compositionstart", "compositionupdate", "compositionend", "pointerdown", "pointermove", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu", "dragstart", "drop", "wheel"]) {
    window.addEventListener(type, (event) => {
      if (['pointerdown', 'mousedown', 'click', 'compositionstart'].includes(type) ||
          (event as InputEvent).isComposing || (event as KeyboardEvent).keyCode === 229) raw.cancelFocus();
      if (type === 'compositionstart') adapter?.beginComposition(event.target);
      if (type === "input" || type.startsWith("composition")) { raw.captureInput(event.target); adapter?.captureInput(event.target, type !== 'compositionstart'); }
      if (event.target instanceof Element && event.target.closest?.('[data-thoughtforge-recovery]')) return;
      if (retainedInput && (type === 'input' || type.startsWith('composition'))) showRetainedInput();
      if (reason && explorable) {
        const key = event as KeyboardEvent;
        const primary = isMac ? key.metaKey && !key.ctrlKey : key.ctrlKey && !key.metaKey;
        const target = event.target instanceof Element ? event.target : null;
        const viewingKey = !key.altKey && (!key.ctrlKey && !key.metaKey && (/^(Arrow(Up|Down|Left|Right)|Tab|Escape| |\.|[0-9]|f|\[|\])$/i.test(key.key ?? '')) || primary && key.key?.toLowerCase() === 'c');
        const viewingPointer = ['pointerdown','pointermove','pointerup','mousedown','mouseup','click','wheel','keyup'].includes(type);
        const editingControl = target?.closest('input,textarea,select,[contenteditable],[data-thoughtforge-command],[data-thoughtforge-rename-input],[data-thoughtforge-node-note-editor]');
        if ((viewingKey && type === 'keydown' || viewingPointer) && !editingControl) return;
        event.preventDefault();
      }
      if (reason) {
      raw.captureInput(event.target);
      if (type === "compositionend" || type === "input") {
        composing = false; compositionEnded = performance.now(); raw.gate();
        const target = event.target, epoch = raw.epoch(), owner = target instanceof HTMLElement ? target.dataset.nodeId : undefined;
        setTimeout(() => { if (raw.epoch() === epoch && (!(target instanceof HTMLElement) || target.dataset.nodeId === owner)) { raw.captureInput(target); adapter?.captureInput(target, true); } }, 0);
      }
      event.stopImmediatePropagation();
    } }, true);
  }
  for (const type of ["focusin", "focusout"]) window.addEventListener(type, event => raw.captureInput(event.target), true);
  window.addEventListener('focusin', event => raw.focusMoved(event.target), true);
  window.addEventListener('blur', () => raw.cancelFocus());
  window.addEventListener("compositionstart", () => { raw.beginComposition(); composing = true; }, true);
  window.addEventListener("compositionend", () => { composing = false; compositionEnded = performance.now(); }, true);
  window.addEventListener("message", (event: MessageEvent) => {
    if (delivered.has(event)) return;
    const data = event.data;
    if (!connected && event.source === parentWindow && data?.type === "thoughtforge-obsidian.connect" &&
        Number.isInteger(data.generation) && data.generation === options.generation && event.ports.length === 1) {
      connected = true; port = event.ports[0]!;
      port.onmessage = (incoming: MessageEvent) => {
        const envelope = incoming.data;
        if (envelope?.generation !== options.generation) return;
        if (envelope.obsidianOnly === 'mapCommand') { adapter?.executeMapCommand(envelope); return; }
        if (envelope.obsidianOnly === "readOnly") {
          // Gate state precedes inert/blur. Host has already refused writes.
          setGate(typeof envelope.reason === "string" ? envelope.reason : undefined);
          if (envelope.retainedInput === true) showRetainedInput();
          return;
        }
        if (envelope.obsidianOnly === "theme") { applyTheme(envelope.vars); return; }
        if (envelope.obsidianOnly === "clipboardResult") {
          if (typeof envelope.requestId === "string" && typeof envelope.ok === "boolean") {
            if (!adapter || adapter.clipboardResult(envelope.requestId, envelope.ok)) window.dispatchEvent(new CustomEvent("thoughtforge-host-clipboard-result", { detail: { requestId: envelope.requestId, ok: envelope.ok } }));
          }
          return;
        }
        const message = envelope.message;
        if (adapter && message?.protocolVersion === 2) {
          receivingModel = message.type === 'thoughtforge.model.update';
          try { adapter.receive(message); } finally { receivingModel = false; }
          return;
        }
        if (!message || message.source !== "extension" || message.protocolVersion !== 1 || adapter) return;
        if (message.type === "thoughtforge.model.update") baseVersion = message.document.version;
        const forwarded = new MessageEvent("message", { data: message });
        delivered.add(forwarded); window.dispatchEvent(forwarded);
      };
      port.start();
      adapter?.mapCommandConnected();
      send({ obsidianOnly: "capability", inert: "inert" in HTMLElement.prototype });
      for (const envelope of pending.splice(0)) port.postMessage(envelope);
    }
    // No ambient window message, including duplicate connect, reaches renderer.
    event.stopImmediatePropagation();
  }, true);
  document.addEventListener("DOMContentLoaded", () => {
    adapter?.mount();
    applyReadOnly();
    // Body's synchronous shared script has already registered window shortcuts.
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (reason || event.defaultPrevented || composing || event.isComposing || event.keyCode === 229 ||
          performance.now() - compositionEnded < 350 || event.key.toLowerCase() !== "z" || event.altKey ||
          (isMac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return;
      const target = event.target instanceof Element ? event.target.closest("input, textarea, select, [contenteditable]") : null;
      if (target && (target.tagName !== "INPUT" || !target.closest("form")?.classList.contains("tf-ime"))) return;
      event.preventDefault(); if (adapter) adapter.localMapCommand(event.shiftKey ? 'map-redo' : 'map-undo'); else send({ obsidianOnly: event.shiftKey ? "redo" : "undo" });
    });
  });
}
