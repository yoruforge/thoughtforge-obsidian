/** Serialized into the opaque frame. Raw DOM values never use the renderer's
 * normalized directEditSession/optimistic text as their source of truth. */
export function createRawInputRecovery(doc: Document) {
  type State = { map?: { title: string; nodesById: Record<string, { text: string; note?: string; source?: unknown }> };
    selectedNodeId?: string; editingNodeId?: string; editingSurface?: string; documentText?: string; isComposingText?: boolean; directKeyQueue?: unknown[];
    directEditSession?: { phase: string; bufferedModelUpdate?: unknown }; deferredModelUpdate?: unknown; lastCompositionEndAt?: number };
  type Entry = { key: string; identity: string; text: string; start: number | null; end: number | null;
    direction: 'forward' | 'backward' | 'none' | null; focused: boolean; detached: boolean };
  let readState: () => State = () => ({}), applyModel: ((message: unknown) => void) | undefined, stagedModel: unknown, epoch = 0;
  let describeInput: ((input: HTMLInputElement | HTMLTextAreaElement) => { key: string; identity: string } | undefined) | undefined;
  const entries = new Map<string, Entry>(), bound = new WeakMap<Element, Entry>(), owners = new WeakMap<Entry, Element>();
  const selector = 'input[data-node-id], [data-thoughtforge-rename-input], [data-thoughtforge-node-note-editor]';
  // Separate from Entry.focused: automatic blur during inert redraw must not
  // erase who owned focus before the gate. Never follow a reused numeric ID.
  type Focus = Pick<Entry, 'key' | 'identity' | 'start' | 'end' | 'direction'> & {
    selected?: string; editing?: string; surface?: string };
  let focus: Focus | undefined;
  const bindOwner = (element: Element, entry: Entry) => {
    const old = owners.get(entry);
    if (old && old !== element && bound.get(old) === entry) {
      const retired = { ...entry, detached: true }; entries.set(entry.key + ':' + (++epoch), retired);
      bound.set(old, retired); owners.set(retired, old);
    }
    bound.set(element, entry); owners.set(entry, element);
  };
  const descriptor = (input: HTMLInputElement | HTMLTextAreaElement) => {
    const described = describeInput?.(input); if (described) return described;
    const state = readState(), note = input.matches('[data-thoughtforge-node-note-editor]');
    const nodeId = input.dataset.nodeId ?? state.selectedNodeId;
    if (!nodeId) return undefined;
    const center = nodeId === '__thoughtforge_map_title__';
    const node = center ? undefined : state.map?.nodesById[nodeId];
    if (!state.map || !center && !node) return undefined;
    const source = node?.source as { range?: { start: { line: number; column: number }; end: { line: number; column: number } } } | undefined;
    const raw = String(state.documentText ?? '').replace(/\r\n/g, '\n');
    const range = source?.range;
    const lines = raw.split('\n');
    const offset = (p: { line: number; column: number }) => lines.slice(0, p.line - 1).reduce((n, line) => n + line.length + 1, 0) + p.column - 1;
    const owned = range ? raw.slice(offset(range.start), offset(range.end)) : undefined;
    // A local identity is deliberately conservative. No persistent identity is
    // assigned to an optimistic child lacking committed source information.
    const identity = JSON.stringify(center ? [state.map.title, raw] : [node!.text, source, owned, node!.note]);
    const key = JSON.stringify([nodeId, note ? 'note' : 'title', input.dataset.editSurface ?? (note ? 'note' : 'side')]);
    return { key, identity };
  };
  const captureInput = (element: EventTarget | null | undefined) => {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || !element.matches(selector)) return;
    let entry = bound.get(element);
    const connected = element.isConnected ?? Array.from(doc.querySelectorAll(selector)).includes(element);
    if (entry && owners.get(entry) !== element) {
      // A late terminal event belongs to the retired input, not its replacement.
      entry = { ...entry, detached: true }; entries.set(entry.key + ':' + (++epoch), entry);
      bound.set(element, entry); owners.set(entry, element);
    }
    const d = descriptor(element);
    if (!d && !entry) return;
    // A vanished target keeps its original bound raw, including late connected-DOM input.
    if (entry && !d) entry.detached = true;
    if (entry && connected && d && (entry.key !== d.key || entry.identity !== d.identity)) {
      entry.detached = true;
      if (entries.get(entry.key) === entry) { entries.set(entry.key + ':' + (++epoch), entry); entries.delete(entry.key); }
      bound.delete(element); entry = undefined;
    }
    if (!entry && !d) return;
    if (!entry) {
      entry = entries.get(d!.key)?.identity === d!.identity ? entries.get(d!.key)! : { ...d!, text: '', start: null, end: null, direction: null, focused: false, detached: false };
      // Retain an unmatched old draft separately from any newly edited target.
      if (entries.has(d!.key) && entries.get(d!.key)!.identity !== d!.identity) {
        const previous = entries.get(d!.key)!; previous.detached = true; entries.set(d!.key + ':' + (++epoch), previous);
      }
      entries.set(d!.key, entry); bindOwner(element, entry);
    }
    entry.text = element.value; entry.start = element.selectionStart; entry.end = element.selectionEnd;
    entry.direction = element.selectionDirection; entry.focused = doc.activeElement === element;
  };
  const capture = () => { for (const input of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector))) captureInput(input); };
  const restore = () => {
    for (const input of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector))) {
      const d = descriptor(input), entry = d && entries.get(d.key);
      if (!entry) continue;
      if (entry.identity !== d!.identity) { entry.detached = true; continue; }
      bindOwner(input, entry); entry.detached = false;
      // The renderer already restored the focused input's caret with its text; only lost text brings its caret back.
      if (input.value === entry.text && doc.activeElement === input) continue;
      input.value = entry.text;
      input.setSelectionRange(entry.start, entry.end, entry.direction ?? 'none');
    }
  };
  const cancelFocus = () => { focus = undefined; };
  const rememberFocus = () => {
    cancelFocus();
    const input = doc.activeElement, state = readState();
    if (state.isComposingText || state.directEditSession?.phase === 'composing' ||
        !(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) || !input.matches(selector)) return;
    const d = descriptor(input); if (!d) return;
    focus = { ...d, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection,
      selected: state.selectedNodeId, editing: state.editingNodeId, surface: state.editingSurface };
  };
  const matchesFocus = (element: EventTarget | null) => {
    if (!focus || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || !element.matches(selector)) return false;
    const d = descriptor(element); return d?.key === focus.key && d.identity === focus.identity;
  };
  const restoreFocus = () => {
    const saved = focus, state = readState();
    // Consume once, even if the target disappeared or composition prevents it.
    if (!saved) return;
    if (doc.hasFocus?.() === false || state.isComposingText || state.directEditSession?.phase === 'composing' ||
        state.selectedNodeId !== saved.selected || state.editingNodeId !== saved.editing || state.editingSurface !== saved.surface ||
        doc.activeElement && doc.activeElement !== doc.body && !matchesFocus(doc.activeElement)) { cancelFocus(); return; }
    const input = Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(selector)).find(matchesFocus);
    cancelFocus();
    if (!input || input.isConnected === false || input.closest?.('[inert]')) return;
    input.focus({ preventScroll: true });
    if (doc.activeElement === input) input.setSelectionRange(saved.start, saved.end, saved.direction ?? 'none');
  };
  const takeModel = () => {
    const state = readState();
    const model = state.directEditSession?.bufferedModelUpdate ?? state.deferredModelUpdate ?? stagedModel;
    if (state.directEditSession) state.directEditSession.bufferedModelUpdate = undefined;
    state.deferredModelUpdate = undefined; stagedModel = undefined;
    return model;
  };
  const gate = () => {
    capture(); epoch++;
    const state = readState(); state.isComposingText = false; state.directKeyQueue = [];
    state.lastCompositionEndAt = performance.now(); // same monotonic clock as the renderer's IME guard
    if (state.directEditSession) state.directEditSession.phase = 'idle';
    const model = takeModel(); if (model) applyModel?.(model);
  };
  return { bindRenderer(getter: () => State, apply?: (message: unknown) => void) { readState = getter; applyModel = apply; }, capture, captureInput, restore, gate, takeModel, modelApplied() { takeModel(); restore(); }, beginComposition() { epoch++; },
    rememberFocus, restoreFocus, cancelFocus, hasSavedFocus: () => !!focus,
    focusMoved(element: EventTarget | null) { if (focus && !matchesFocus(element)) cancelFocus(); },
    describeWith(describe: typeof describeInput) { describeInput = describe; },
    discardNode(nodeId: string) { for (const [key, entry] of entries) if (JSON.parse(entry.key)[0] === nodeId) entries.delete(key); },
    remap(ids: Record<string, string>, revive: readonly string[] = []) {
      const nextEntries = new Map<string, Entry>();
      for (const [key, entry] of Array.from(entries)) {
        const parts = JSON.parse(entry.key); const next = ids[parts[0]];
        if (!next) { entry.detached = true; nextEntries.set(entry.key + ':' + (++epoch), entry); continue; }
        parts[0] = next; const mapped = JSON.stringify(parts);
        if (revive.includes(JSON.parse(entry.key)[0])) entry.detached = false;
        entry.key = mapped; nextEntries.set(entry.detached ? mapped + ':' + (++epoch) : mapped, entry);
      }
      entries.clear(); for (const [key, entry] of nextEntries) entries.set(key, entry);
    },
    stageModel(message: unknown) { if (message) stagedModel = message; return stagedModel; },
    flushModel() {
      const state = readState();
      if (state.isComposingText || state.directEditSession?.phase === 'composing') return;
      const message = takeModel(); if (message) applyModel?.(message);
    },
    epoch: () => epoch, snapshot: () => Array.from(entries.values(), entry => ({ ...entry })) };
}
