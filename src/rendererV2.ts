import type { ModelUpdateV2, CommandResultV2, HistoryResultV2, HostMessageV2, CommandGuard } from './protocolV2.ts';
import type { DraftTarget, DraftSaveMessage, DraftRestoreMessage, DraftSaveResultMessage, RestoredDraft } from './draftTypes.ts';
import type { createRawInputRecovery } from './rawInputRecovery.ts';
import type { DraftNavigationGate } from './draftNavigation.ts';
import type { createMapCommandValidator, CommandAdmission, CommandState, CommandReject, MapCommandId } from './mapCommandTransport.ts';

/** This factory is serialized into the opaque frame. All protocol decisions stay
 * here; the shared renderer receives only its ordinary model/controller API. */
export function createRendererV2(doc: Document, raw: ReturnType<typeof createRawInputRecovery>,
  send: (message: object, clipboardRequestId?: string) => boolean,
  forward: (message: object) => void, setGate: (reason: string | undefined, allowExplore?: boolean) => void,
  NavigationGate: typeof DraftNavigationGate, transport?: { generation: number; ids: readonly string[];
    validator: ReturnType<typeof createMapCommandValidator>; send: (payload: object) => boolean }) {
  // The shared renderer's private state is deliberately a local adapter seam.
  type State = Record<string, any>;
  type Controller = { updateCommandControls?(context?: any): void; render(): void; postCommand(command: object): string;
    retarget(oldId: string, newId: string, surface?: string): void; flush(oldId: string, newId: string): void;
    dependents(oldId: string, newId: string): void; overlay(map: any, meta: any): boolean;
    finishRename?(requestId: string, saved?: boolean): string | undefined;
    rebindRenames?(ids: Record<string, string>, keep: (id: string) => boolean): void;
    clearDraft?(id: string): void; removeDraft?(map: any, id: string, parentId: string | null): void;
    mapCommandContext?(): any; dispatchMapCommand?(id: string, external?: boolean, options?: Record<string, unknown>): CommandAdmission };
  type Local = { draftId: string; revision: number; target: DraftTarget; text: string; savedAt: string; key: string; inputId?: string; operation?: object; persistenceBlocked?: boolean; permissionRetired?: boolean; revisionBlocked?: boolean; saved: number; sent: number;
    detached: boolean; restored?: RestoredDraft; pendingClear?: boolean; saving?: Set<number>;
    failedRevision?: number; failedReason?: string; clearFailed?: boolean; clearSentAt?: number };
  let state: () => State = () => ({}), controller: Controller | undefined, committed: ModelUpdateV2 | undefined;
  let serial = 0, version = 1, active = true, selectionCleared = false, timer: ReturnType<typeof setTimeout> | undefined, shellUri: string | undefined;
  const viewId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const locals = new Map<string, Local>(), byTarget = new Map<string, string>();
  type InputBinding = { key: string; identity: string; target: DraftTarget; draftId?: string; owner: string; value: string; operation?: object };
  // Queued callbacks own their input, so weak lookup survives index retirement
  // without keeping old DOM or payloads alive after those callbacks finish.
  let inputBindings = new WeakMap<Element, InputBinding>();
  const bindings = new Map<InputBinding, WeakRef<Element>>();
  const inputBinding = (input: Element) => inputBindings.get(input);
  const bindInput = (input: Element, binding: InputBinding) => {
    const previous = inputBinding(input); if (previous) bindings.delete(previous);
    inputBindings.set(input, binding); bindings.set(binding, new WeakRef(input));
  };
  const pruneBindings = () => {
    for (const [binding, input] of bindings) if (!input.deref()?.isConnected &&
      !(binding.draftId && locals.has(binding.draftId))) bindings.delete(binding);
  };
  const retiredCompositions = new WeakMap<Element, string>();
  const composingInputs = new WeakSet<Element>();
  const identities = new Map<string, string>(), pending = new Map<string, { command?: any; hash?: string; intentSeq?: number; pasteCanceled?: boolean; drafts: { id: string; revision: number }[] }>();
  const results = new Map<string, CommandResultV2 | HistoryResultV2>();
  const waiting = new Map<string, ModelUpdateV2>();
  const failedInsert = new Map<string, { command: any; hash: string }>();
  const modelTrail: ModelUpdateV2[] = [], queuedFlushes = new Map<string, string>();
  // Every request carries the base hash it was made against, so a second one sent before the first lands would be
  // stale. Intents made meanwhile (rename then outdent, blur then Undo) wait here and go out in order.
  // Each intent carries the order it was made in (the shared renderer stamps commands it holds back itself),
  // so input released by a settled creation still goes out before an Undo pressed after it, and vice versa.
  type Deferred = ({ message: any; clipboardRequestId?: string } | { history: 'undo' | 'redo' }) & { seq: number };
  const deferred: Deferred[] = [];
  const deleteWhenCreated = new Map<string, string>(); // saved ID -> optimistic ID
  let draining = false, historyStale = false, modelCount = 0;
  const nextSeq = () => { const s = state(); s.intentSeq = (s.intentSeq ?? 0) + 1; return s.intentSeq as number; };
  const enqueue = (item: Deferred) => { captureAll(); const at = deferred.findIndex(d => d.seq > item.seq); deferred.splice(at < 0 ? deferred.length : at, 0, item); commandContextChanged(); };
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let permissionBlocked = false, permissionRetirement = false;
  let permissionCompositions = new WeakSet<Element>();
  let history = { canUndo: false, canRedo: false }, navigation: { token: object; gate: DraftNavigationGate; signature: string } | undefined;
  // The map owns the frame. A single notice line appears only when the user
  // must act to keep input (save failure, rejected operation, previous input).
  let notice: HTMLElement | undefined, noticeText: HTMLElement | undefined, status: HTMLElement | undefined;
  let undo: HTMLButtonElement | undefined, redo: HTMLButtonElement | undefined;
  let noticeButtons: HTMLButtonElement[] = [];
  let latestStatus = '', navFailed = false, lastFailure: string | undefined, lastFailureReason: string | undefined, transient: string | undefined, topicFailure: string | undefined, announced = '';
  const noticeDrafts = new Set<string>();
  const CLEAR_CONFIRM_MS = 2000;
  let noticeGeneration = '', builtGeneration: string | undefined; // kind + text + targets of the visible line
  let deleteConfirmation: { command: any; hash: string; intentSeq: number; requestId: string; detail: string } | undefined;
  // All allocators outlive renderer mounts; no transport intent joins deferred.
  let mountEpoch = 0, commandRevision = 0, commandHighWater = 0, copyEffectSeq = 0;
  let commandConnected = false, commandNotifyPending = false, commandDispatching = false, externalCopy = false;
  let imeReleaseDeadline: number | undefined;
  let imeReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  const copyEffects = new Map<string, { mount: number; consumer: Controller; external: boolean }>();
  let externalCopyId: string | undefined;
  const commandRegistry = (transport?.ids ?? []).map(id => {
    const short = id.slice(4), copy = /^copy-(node|subtree)-(.+)$/.exec(short);
    const semantic = /^(confirm-input|indent|outdent|move-sibling-|confirm-move-|delete-)/.test(short);
    const interaction = /^(paste-branch|edit-|insert-|cancel-input|move-branch|cancel-move)/.test(short);
    const route = short.startsWith('copy-') ? 'clipboard' : /^(undo|redo)$/.test(short) ? 'history' :
      /^(reveal-source|open-selected-link)$/.test(short) ? 'host-navigation' : semantic ? 'semantic' : interaction ? 'interaction' : 'ui';
    return Object.freeze({ id, handler: 'dispatchMapCommand', route, targetSource: /central/.test(short) ? 'center' : /confirm-input|cancel-input/.test(short) ? 'title-input' :
      /confirm-move/.test(short) ? 'captured-move-source-and-selection' : 'logical-selection',
      gates: ['binding', 'context', 'ime', 'confirmation', 'inert', ...(semantic || interaction || route === 'history' ? ['write', 'visibility', 'semantic-busy'] : ['visibility'])],
      modes: short === 'paste-branch' ? ['map-md'] : ['note', 'map-md'],
      unsupportedReason: short === 'paste-branch' ? 'note-modeの枝貼り付けは原文保全の契約が未提供のため後続保留です' : undefined,
      ...(copy ? { scope: copy[1], format: copy[2] } : {}),
      ...(copy?.[2] === 'prompt-template' ? { presetSource: 'prompt-template-select', includeNotesSource: 'include-notes-checkbox' } : {}),
      ...(short.startsWith('copy-subtree-ai-') ? { preset: short.endsWith('worker') ? 'codex-worker/full' : short.endsWith('chat') ? 'chatgpt-claude/compact' : 'github-issue-fragment/checklist-only' } : {}) });
  });
  const registry = new Map(commandRegistry.map(entry => [entry.id, entry]));
  const semanticBusy = () => !!(pending.size || deferred.length || flushTimer || draining || historyStale || queuedFlushes.size || state().pendingOptimisticNodes?.size || state().queuedOptimisticCommands?.size || state().directEditSession?.phase === 'committing');
  const mapCommandGate = (id: string, external = true, context = controller?.mapCommandContext?.()): CommandReject | undefined => {
    const entry = registry.get(id), s = state(), c = context;
    if (!entry) return 'unsupported-command';
    if (!entry.modes.includes(committed?.mode as string)) {if(id==='map-paste-branch'&&!external)say('note-modeの枝貼り付けは原文保全の契約が未提供のため後続保留です。','error');return 'unsupported-mode';}
    if (!active || !controller || !committed?.map || !s.map || !c || c.inert) return 'unavailable';
    if (parentInput?.active && /^(confirm-input|cancel-input)$/.test(id.slice(4))) return isComposing() || parentInput.composing || performance.now()-parentInput.ended<350 ? 'ime-active' : undefined;
    if (parentInput?.active || pasteAttempt?.sent || pasteAttempt && id==='map-paste-branch') return 'busy';
    if (deleteConfirmation || c.confirmation) return 'confirmation-active';
    if (s.isComposingText || s.directEditSession?.phase === 'composing' || performance.now() - (s.lastCompositionEndAt ?? -Infinity) < 350) return 'ime-active';
    const short = id.slice(4), writing = entry.route === 'semantic' || entry.route === 'history' || entry.route === 'interaction';
    if (writing && (permissionBlocked || external && permissionRetirement)) return 'permission-denied';
    if (writing && (committed.writeState !== 'ready' || s.readOnly)) return 'read-only';
    if (writing && external && semanticBusy()) return 'busy';
    if (entry.route === 'clipboard' && (external && externalCopyId || copyEffectSeq >= Number.MAX_SAFE_INTEGER)) return 'busy';
    if (entry.route === 'host-navigation' && navigation) return 'busy';
    // A palette may own focus while the original title input still owns edits.
    // Local title compound commands retain their existing commit/queue path.
    if (c.titleInput && (external || c.paletteInput) && !(short === 'insert-child' && c.pristineCenterInput) && !/^(confirm-input|cancel-input|close-(shortcut-help|command-palette|context-menu)|focus-notice|return-to-map)$/.test(short)) return 'unavailable';
    if (c.titleInput && c.inputOwner === c.titleInput && (entry.route === 'history' || entry.route === 'clipboard')) return 'unavailable';
    if (c.nativeInput && (entry.route === 'history' || entry.route === 'clipboard' || writing && !/^(confirm-input|cancel-input)$/.test(short))) return 'unavailable';
    if (/^(confirm-input|cancel-input)$/.test(short)) return c.titleInput ? undefined : 'unavailable';
    if (/^confirm-move-/.test(short)) return c.moveValid?.[short.slice(13)] ? undefined : 'unavailable';
    if (short === 'cancel-move') return c.moving ? undefined : 'unavailable';
    if (short === 'undo' || short === 'redo') return (!external && (pending.size || deferred.length || flushTimer) || history[short === 'undo' ? 'canUndo' : 'canRedo']) ? undefined : 'unavailable';
    if (/^(paste-branch|edit-title|select-(previous|next|left|right)|insert-|indent|outdent|move-|delete-|toggle-collapse|copy-|reveal-source|open-selected-link|open-context-menu)$/.test(short) ||
      /^(insert-|move-|delete-|copy-)/.test(short)) {
      if (!c.nodeId && short !== 'copy-visible-svg') return 'unavailable';
      if (!c.visible) return 'target-invisible';
    }
    if (short === 'focus-selected' && c.nodeId && !c.visible) return 'target-invisible';
    if (/^(paste-branch|insert-sibling|insert-parent|indent|outdent|move-|delete-)/.test(short) && c.center) return 'unavailable';
    if(short==='paste-branch' && (!structuralCopy?.acked || structuralCopy.hash!==committed.contentHash || semanticBusy())) {if(!external)say('同じ画面で枝をMarkdownコピーし、完了を確認してから貼り付けてください。','error');return 'unavailable';}
    if (short === 'indent' && !c.canIndent || short === 'outdent' && !c.canOutdent || short === 'move-sibling-before' && !c.before || short === 'move-sibling-after' && !c.after) return 'unavailable';
    if (short === 'reveal-source' && !c.source || short === 'open-selected-link' && !c.links) return 'unavailable';
    if (short === 'focus-back' && !s.focusHistoryNodeIds?.length || short === 'focus-forward' && !s.focusForwardNodeIds?.length) return 'unavailable';
    if (/^focus-sibling-/.test(short) && !c.focusSibling) return 'unavailable';
    if (short === 'filter-previous' || short === 'filter-next') return s.searchMatchNodeIds?.length ? undefined : 'unavailable';
    if (short === 'filter-clear' && !s.searchQuery || short === 'clear-focus' && !s.focusRootNodeId && !s.focusFollowingSelection) return 'unavailable';
    if (short === 'close-shortcut-help' && !s.shortcutOverlayOpen || short === 'close-command-palette' && !s.commandPaletteOpen || short === 'close-context-menu' && !s.contextMenuNodeId) return 'unavailable';
    return undefined;
  };
  const mapCommandAvailability = (context = controller?.mapCommandContext?.()) => {
    return { revision: commandRevision, status: 'ready' as const,
      available: commandRegistry.filter(entry => !mapCommandGate(entry.id, true, context)).map(entry => entry.id as MapCommandId) };
  };
  const publishCommandState = () => {
    if (!transport || !commandConnected || !mountEpoch || !commandRevision || commandDispatching) return;
    const binding = { transportVersion: 1, type: 'state', documentUri: committed?.documentUri ?? shellUri ?? '', mountEpoch, revision: commandRevision };
    const context=controller?.mapCommandContext?.();
    controller?.updateCommandControls?.(context);
    transport.send(active && controller && committed?.map && state().map && (!permissionRetirement || permissionBlocked)
      ? { ...binding, status: 'ready', contentHash: committed.contentHash, available: mapCommandAvailability(context).available }
      : { ...binding, status: 'unavailable', reason: active ? permissionRetirement ? 'retired' : 'not-ready' : 'disposed' });
  };
  const navSignature = () => {
    const s = state(), context = controller?.mapCommandContext?.(), input = context?.titleInput, owner = context?.inputOwner;
    return JSON.stringify([mountEpoch, committed?.documentUri, committed?.contentHash, s.selectedNodeId, s.editingNodeId,
      input?.dataset?.nodeId, input?.value, owner?.tagName, owner?.dataset?.nodeId, owner?.getAttribute?.('aria-label'), owner?.dataset?.editSurface, owner?.value, !!context?.nativeInput]);
  };
  const commandContextChanged = () => {
    if (!transport) return;
    if(pasteAttempt && pasteAttempt.signature!==pasteSignature())cancelPaste();
    if (commandRevision >= Number.MAX_SAFE_INTEGER) { commandConnected = false; return; }
    commandRevision++;
    if(parentInput?.active && (parentInput.nodeId!==state().selectedNodeId || parentInput.mount!==mountEpoch))cancelParent();
    const deadline=(state().lastCompositionEndAt ?? -Infinity)+350, remaining=deadline-performance.now();
    if (Number.isFinite(deadline) && remaining>0 && deadline!==imeReleaseDeadline) {
      if(imeReleaseTimer)clearTimeout(imeReleaseTimer);imeReleaseDeadline=deadline;
      imeReleaseTimer=setTimeout(()=>{imeReleaseTimer=undefined;imeReleaseDeadline=undefined;if(active)commandContextChanged();},remaining+1);
    }
    if (navigation && navigation.signature !== navSignature()) cancelNavigation();
    if (!commandNotifyPending) { commandNotifyPending = true; queueMicrotask(() => { commandNotifyPending = false; publishCommandState(); }); }
  };
  const allocateCopyEffect = () => {
    if (!controller || copyEffectSeq >= Number.MAX_SAFE_INTEGER) return undefined;
    const id = `mc-copy:${mountEpoch}:${++copyEffectSeq}`;
    copyEffects.set(id, { mount: mountEpoch, consumer: controller, external: externalCopy });
    if (externalCopy) externalCopyId = id;
    commandContextChanged(); return id;
  };
  const clipboardResult = (id: string, _ok: boolean) => {
    const effect = copyEffects.get(id); if (!effect) return false;
    copyEffects.delete(id);
    if (effect.mount !== mountEpoch || effect.consumer !== controller) return false;
    if (effect.external && externalCopyId === id) externalCopyId = undefined;
    if(structuralCopy?.effectId===id) {if(_ok){structuralCopy.acked=true;send({source:'webview',protocolVersion:2,documentUri:committed?.documentUri,type:'thoughtforge.r7.copy.ack',requestId:id,effectId:id,copyToken:structuralCopy.token,mountEpoch})}else structuralCopy=undefined;}
    commandContextChanged(); return true;
  };
  const executeMapCommand = (envelope: any) => {
    const v = transport?.validator, p = envelope?.mapCommand;
    if (!transport || !v || !active || envelope?.generation !== transport.generation || p?.type !== 'execute' || !v.correlation(p, transport.generation)) return;
    const duplicate = p.requestSeq <= commandHighWater;
    if (duplicate && commandDispatching) return;
    // Correlatable requests consume their sequence before the remaining schema.
    commandHighWater = Math.max(commandHighWater, p.requestSeq);
    commandDispatching = true;
    let admission: CommandAdmission;
    const reject = (reason: CommandReject): CommandAdmission => ({ status: 'rejected', reason });
    if (duplicate || !v.envelope(envelope, false, transport.generation) || !v.execute(p, transport.generation)) admission = reject('invalid-request');
    else if (!commandConnected) admission = reject('unavailable');
    else if (p.documentUri !== committed?.documentUri || p.mountEpoch !== mountEpoch || p.revision !== commandRevision || p.contentHash !== committed?.contentHash) admission = reject('stale-context');
    else {
      const reason = mapCommandGate(p.commandId);
      if (reason) admission = reject(reason);
      else { externalCopy = p.commandId.startsWith('map-copy-');
        try { admission = controller?.dispatchMapCommand?.(p.commandId, true) ?? reject('unavailable'); }
        catch { admission = { status: 'outcome-unknown', reason: 'dispatch-interrupted' }; }
        finally { externalCopy = false; }
      }
    }
    commandContextChanged();
    transport.send({ transportVersion: 1, type: 'result', documentUri: p.documentUri, mountEpoch: p.mountEpoch, requestSeq: p.requestSeq, requestId: p.requestId,
      ...(admission.status === 'admitted' ? { status: 'dispatched', route: admission.route } : admission) });
    commandDispatching = false; publishCommandState();
  };
  const cancelDeleteConfirmation = () => {
    if (deleteConfirmation) { deleteConfirmation = undefined; commandContextChanged(); renderNotice(); }
  };
  // Compare user intent order, not dispatch order: earlier shared-queue flushes keep their original sequence.
  const currentDeleteIntent = (intent: { command?: any; hash?: string; intentSeq?: number }) =>
    intent.intentSeq !== undefined && intent.intentSeq === state().intentSeq &&
    intent.command?.nodeId === state().selectedNodeId && intent.hash === committed?.contentHash;
  const confirmDelete = (intent: NonNullable<typeof deleteConfirmation>) => {
    if (deleteConfirmation !== intent) return;
    // Retire before sending: old/double activations cannot enqueue a second deletion.
    deleteConfirmation = undefined; commandContextChanged(); renderNotice();
    if (active && currentDeleteIntent(intent) &&
      !pending.size && !deferred.length && !flushTimer && !navigation && !isComposing()) controller?.postCommand({ ...intent.command, confirmedUnmapped: true });
  };
  const centerId = '__thoughtforge_map_title__';
  const title = (model: ModelUpdateV2, id: string) => id === centerId || id === 'center' ? model.map?.title : model.map?.nodesById[id]?.text;
  const targetKey = (target: DraftTarget, operation?: string) => JSON.stringify([target.kind,
    target.kind === 'node' ? target.nodeId : target.kind === 'center' ? 'center' : operation, target.field]);
  const pendingBindings = new WeakMap<object, { target: DraftTarget; identity: string; key: string }>();
  const pendingEligible = (id: string, operation: any) => {
    const s = state(), m = committed, node = s.map?.nodesById[id];
    if (!operation || s.pendingOptimisticNodes?.get(id) !== operation || operation.adapterDetached || m?.map?.nodesById[id] || !node ||
      operation.parentId === undefined || operation.parentId !== null && !m?.map?.nodesById[operation.parentId] ||
      operation.dependsOnNodeId && !m?.map?.nodesById[operation.dependsOnNodeId] || node.children?.length) return false;
    if ([...s.pendingOptimisticNodes.values()].some((other: any) => other !== operation &&
      [other.parentId, other.dependsOnNodeId, other.siblingId].includes(id))) return false;
    const siblings = operation.parentId === null ? s.map?.roots : s.map?.nodesById[operation.parentId]?.children;
    if (!siblings || siblings.at(-1) !== id || siblings.filter((x: string) => x === id).length !== 1) return false;
    const surfaces = new Set<string>();
    for (const e of raw.snapshot()) {
      const parts = JSON.parse(e.key); if (parts[0] === id && e.text !== '') surfaces.add(JSON.stringify(parts.slice(1)));
    }
    for (const input of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[data-node-id], [data-thoughtforge-rename-input], [data-thoughtforge-node-note-editor]'))) {
      if ((input.dataset.nodeId ?? s.selectedNodeId) === id && input.value !== '') surfaces.add(JSON.stringify([
        input.matches('[data-thoughtforge-node-note-editor]') ? 'note' : 'title', input.dataset.editSurface ?? (input.matches('[data-thoughtforge-node-note-editor]') ? 'note' : 'side')]));
    }
    return surfaces.size <= 1;
  };
  const pendingTarget = (id: string): DraftTarget | undefined => {
    const m = committed, meta = state().pendingOptimisticNodes?.get(id);
    if (!m?.map || !m.noteIndex || !pendingEligible(id, meta)) return undefined;
    const bound = pendingBindings.get(meta); if (bound) return structuredClone(bound.target);
    // Walk real edges from every root, retaining only a unique complete path to the existing parent.
    const paths: string[][] = [], stack = (m.map.roots ?? []).map(root => [root]);
    while (stack.length) {
      const path = stack.pop()!, at = path.at(-1)!;
      if (!m.map.nodesById[at] || path.slice(0, -1).includes(at)) return undefined;
      if (at === meta.parentId) paths.push(path);
      for (const child of m.map.nodesById[at]!.children ?? []) stack.push([...path, child]);
    }
    if (meta.parentId !== null && paths.length !== 1) return undefined;
    const center = currentTarget(centerId, 'title'); if (center?.kind !== 'center') return undefined;
    const parentChain: any[] = [{ kind: 'center', centerKind: center.centerKind, titleSource: center.titleSource,
      ...(center.anchorHash ? { anchorHash: center.anchorHash } : {}) }];
    for (const nodeId of paths[0] ?? []) {
      const target = currentTarget(nodeId, 'title'); if (target?.kind !== 'node') return undefined;
      parentChain.push({ kind: 'node', nodeId, titleSource: target.titleSource, ownRangeHash: target.ownRangeHash });
    }
    const target: DraftTarget = { kind: 'pending-child', parentChain, position: 'last-child', baseHash: m.contentHash, field: 'title' };
    pendingBindings.set(meta, { target: structuredClone(target), identity: `pending-${viewId}-${++serial}`, key: targetKey(target, `operation-${serial}`) });
    return target;
  };
  const currentTarget = (id: string, field: 'title' | 'note'): DraftTarget | undefined => {
    const m = committed; if (!m?.map || !m.noteIndex) return undefined;
    if (id === centerId || id === 'center') {
      const c = m.noteIndex.center;
      if (field === 'note' && !c.noteEditable) return undefined;
      return { kind: 'center', field, baseHash: m.contentHash, titleSource: m.map.title,
        centerKind: m.mode === 'map-md' ? 'map-md' : c.kind, ...(c.anchorHash ? { anchorHash: c.anchorHash } : {}) };
    }
    const node = m.map.nodesById[id], info = m.noteIndex.nodes[id];
    if (!node || !info || field === 'note' && !info.noteEditable) return undefined;
    return { kind: 'node', nodeId: id, field, baseHash: m.contentHash, titleSource: node.text, ownRangeHash: info.ownRangeHash };
  };
  const baseline = (target: DraftTarget) => target.kind === 'pending-child' ? '' : target.field === 'title' ? target.titleSource : target.kind === 'node'
    ? committed?.map?.nodesById[target.nodeId]?.note ?? '' : committed?.noteIndex?.center.note ?? '';
  const descriptor = (input: HTMLInputElement | HTMLTextAreaElement) => {
    const field = input.matches('[data-thoughtforge-node-note-editor]') ? 'note' : 'title';
    const id = input.dataset.nodeId ?? state().selectedNodeId;
    const target = id && (currentTarget(id, field) ?? (field === 'title' ? pendingTarget(id) : undefined)); if (!target) return undefined;
    const operation = target.kind === 'pending-child' ? state().pendingOptimisticNodes?.get(id) : undefined;
    const binding = operation && pendingBindings.get(operation);
    const key = binding?.key ?? targetKey(target), identity = binding?.identity ?? identities.get(key) ?? JSON.stringify(target.kind === 'node'
      ? [target.titleSource, target.ownRangeHash] : target.kind === 'center' ? [target.centerKind, target.titleSource, target.anchorHash] : []);
    identities.set(key, identity);
    return { target, key, identity, owner: id, operation, rawKey: JSON.stringify([id === 'center' ? centerId : id, field, input.dataset.editSurface ?? (field === 'note' ? 'note' : 'side')]) };
  };
  raw.describeWith(input => { const d = descriptor(input); return d && { key: d.rawKey, identity: d.identity }; });
  // Every message is announced; only 'error' ones stay visible until resolved or closed.
  const say = (text: string, level: 'info' | 'error' = 'info') => {
    latestStatus = text; if (status) status.textContent = text;
    if (level === 'error') { transient = text; renderNotice(); }
  };
  const failure = (reason?: string) => reason === 'draft-limit-count' ? '下書きは50件までです。新しい入力を下書きに保存できません。入力は保持しています。'
    : reason === 'draft-too-large' ? '下書きはUTF-8で65536 bytesまでです。入力は保持しています。'
    : reason === 'device-id-unavailable' ? '端末IDを取得できません。下書きを保存できないため移動を停止しました。入力はコピーできます。'
    : '下書きを保存できませんでした。移動を停止し、入力を保持しています。';
  const add = (target: DraftTarget, text: string, detached = false, key?: string, inputId?: string, operation?: object): Local => {
    const draftId = `draft-${viewId}-${++serial}`;
    const local: Local = { draftId, revision: 0, target: structuredClone(target), text, savedAt: new Date().toISOString(),
      key: key ?? targetKey(target, draftId), inputId, operation, permissionRetired: permissionRetirement || undefined, saved: -1, sent: -1, detached };
    locals.set(local.draftId, local); if (!detached) byTarget.set(local.key, local.draftId); return local;
  };
  const issue = (local: Local, text = local.text, target = local.target, minimum = -1) => {
    const maximum = Math.max(local.revision, local.sent, local.saved, minimum);
    if (!Number.isSafeInteger(maximum) || maximum >= Number.MAX_SAFE_INTEGER) {
      local.revisionBlocked = true; say('下書きの番号を更新できません。入力をコピーして保全してください。', 'error'); return false;
    }
    Object.assign(local, { revision: maximum + 1, target: structuredClone(target), text, savedAt: new Date().toISOString() });
    return true;
  };
  const captureInput = (input: EventTarget | null, changed = false) => {
    if (!active) return;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) ||
      !input.matches('input[data-node-id], [data-thoughtforge-rename-input], [data-thoughtforge-node-note-editor]')) return;
    if (changed) cancelDeleteConfirmation();
    const d = descriptor(input), previous = inputBinding(input);
    const boundLocal = previous?.draftId && locals.get(previous.draftId);
    if (previous?.target.kind === 'pending-child' && boundLocal && boundLocal.operation && !pendingEligible(boundLocal.inputId!, boundLocal.operation)) boundLocal.persistenceBlocked = true;
    // Late IME/input events from a retired element keep their original target.
    const owner = input.dataset.nodeId ?? state().selectedNodeId;
    const retainedOwner = retiredCompositions.get(input) === previous?.draftId || previous?.owner === owner;
    if (previous?.draftId && (!input.isConnected || changed && !d && retainedOwner)) {
      let old = locals.get(previous.draftId);
      if ((!old || old.pendingClear) && input.value !== (old?.text ?? previous.value)) {
        const target = previous.target.kind !== 'pending-child' && old?.inputId && currentTarget(old.inputId, previous.target.field) || previous.target;
        const revisionBlocked = old?.revisionBlocked;
        old = add(target, input.value, true, undefined, old?.inputId ?? previous.owner, target.kind === 'pending-child' ? old?.operation : undefined);
        old.revisionBlocked = revisionBlocked;
        if (target.kind === 'pending-child' && !old.operation) old.persistenceBlocked = true;
        bindInput(input, { ...previous, draftId: old.draftId, target: structuredClone(old.target), value: input.value,
          operation: target.kind === 'pending-child' ? previous.operation : undefined });
      }
      if (old && old.text !== input.value) { issue(old, input.value); old.detached = true; renderNotice(); }
      else if (old) renderNotice();
      if (old) bindInput(input, { ...inputBinding(input)!, value: input.value });
      return;
    }
    if (!d) {
      const local = previous?.draftId && locals.get(previous.draftId);
      if (previous?.target.kind === 'pending-child' && local) local.persistenceBlocked = true;
      return; // Out-of-scope dependencies/surfaces remain in frame raw recovery.
    }
    if (changed) retiredCompositions.delete(input);
    const same = !!previous && previous.key === d.key && previous.identity === d.identity;
    let local = same && previous?.draftId ? locals.get(previous.draftId) : undefined;
    local ??= locals.get(byTarget.get(d.key) ?? '');
    if (!changed && input.value === baseline(d.target)) { bindInput(input, { key: d.key, identity: d.identity, owner: d.owner, target: structuredClone(d.target), value: input.value, operation: d.operation,
      ...(same && previous?.draftId ? { draftId: previous.draftId } : {}) }); return; }
    // A passive re-render of another surface must not replace an active draft.
    if (!changed && same && previous?.value === input.value) return;
    if (local?.detached || local?.pendingClear) local = undefined;
    if (!local) local = add(d.target, input.value, false, d.key, d.owner, d.operation);
    else if (local.text !== input.value) issue(local, input.value);
    bindInput(input, { key: d.key, identity: d.identity, owner: d.owner, target: structuredClone(d.target), draftId: local.draftId, value: input.value, operation: d.operation });
    renderNotice();
  };
  const captureAll = () => {
    raw.capture();
    for (const input of Array.from(doc.querySelectorAll('input[data-node-id], [data-thoughtforge-rename-input], [data-thoughtforge-node-note-editor]'))) captureInput(input);
  };
  const retireComposition = (input: Element | null = doc.activeElement) => {
    if (!state().isComposingText && state().directEditSession?.phase !== 'composing' && !(input && composingInputs.has(input))) return;
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) { raw.captureInput(input); captureInput(input, true); }
    const id = input && inputBinding(input)?.draftId;
    if (input && id && locals.has(id)) retiredCompositions.set(input, id);
  };
  const messageFor = (local: Local): DraftSaveMessage => ({ source: 'webview', type: 'thoughtforge.draft.save', protocolVersion: 2,
    documentUri: committed!.documentUri, draftId: local.draftId, revision: local.revision, target: structuredClone(local.target), text: local.text, savedAt: local.savedAt, final: false });
  const sendDraft = (local: Local, message: DraftSaveMessage) => {
    if (!committed || permissionBlocked || !active || local.pendingClear || local.permissionRetired || local.persistenceBlocked || local.revisionBlocked || local.operation && !pendingEligible(local.inputId!, local.operation)) return false;
    (local.saving ??= new Set()).add(message.revision); local.sent = Math.max(local.sent, message.revision);
    let ok = false; try { ok = send(message); } catch { /* Retain the exact input on transport failure. */ }
    if (!ok && local.saving.delete(message.revision) && message.revision > local.saved) {
      local.failedRevision = Math.max(local.failedRevision ?? -1, message.revision); local.failedReason = undefined; navFailed = true; lastFailure = failure(); say(lastFailure);
    }
    renderNotice(); return ok;
  };
  const save = (local: Local, final = false) => committed && active && !local.pendingClear ? sendDraft(local, { ...messageFor(local), final }) : false;
  const autosave = () => {
    if (!active) return;
    captureAll();
    if (!navigation) for (const local of locals.values()) if (!local.pendingClear && local.revision > local.sent) save(local);
    pruneBindings();
    timer = setTimeout(autosave, 500);
  };
  const cancelNavigation = () => { navigation?.gate.close(); navigation = undefined; };
  const navigate = async (action: () => void | Promise<void>) => {
    cancelDeleteConfirmation();
    cancelNavigation(); // A newer navigation retires the old intent, never an admitted draft save.
    const gate = new NavigationGate(), token = {}, intent = { gate, token, signature: navSignature() }; navigation = intent;
    commandContextChanged();
    const final = new Map<string, number>();
    const valid = () => active && navigation === intent;
    try {
      while (valid()) {
        captureAll();
        if (state().isComposingText || state().directEditSession?.phase === 'composing') { say('変換を確定してから移動してください。入力は保持しています。', 'error'); return false; }
        if ([...locals.values()].some(local => local.pendingClear)) {
          for (const local of locals.values()) if (local.pendingClear) local.clearFailed = true; // offer a resend; a duplicate clear is harmless
          say('入力の破棄の完了を確認するまで移動できません。'); renderNotice(); return false;
        }
        if ([...state().pendingOptimisticNodes?.keys() ?? []].some(id => !committed?.map?.nodesById[id])) {
          say('新しいトピックの保存を確認するまで移動できません。入力は保持しています。', 'error'); return false;
        }
        const next = [...locals.values()].find(local => !local.pendingClear && final.get(local.draftId) !== local.revision);
        if (!next) { if (valid()) { await action(); return true; } return false; }
        const ok = await gate.navigate(() => {
          captureAll(); return locals.has(next.draftId) && !next.pendingClear ? messageFor(next) : undefined;
        }, message => sendDraft(next, message), () => { final.set(next.draftId, next.revision); }, valid,
        (draft, minimum) => issue(next, next.text, next.target, minimum) ? messageFor(next) : { ...draft, revision: NaN });
        if (!ok) { if (valid()) { navFailed = true; lastFailure = failure(); say(lastFailure); renderNotice(); } return false; }
      }
      return false;
    } finally { if (navigation === intent) navigation = undefined; gate.close(); syncActions(); }
  };
  // HD-4=A: collect a title without an optimistic node or persistent pending-child draft.
  let structuralCopy: {effectId: string; token: string; hash: string; acked: boolean} | undefined;
  let selectedFocus: string | undefined;
  let pasteAttempt: {id: string; parentId: string; hash: string; signature: string; sent: boolean} | undefined;
  const pasteSignature=()=>JSON.stringify([navSignature(),committed?.writeState,state().focusRootNodeId,state().searchQuery,state().isComposingText]);
  const r7Reason=(reason: string)=>reason==='request-limit'?'この画面の操作記録の上限に達しました。入力をコピーして地図を開き直してください。':reason==='payload-limit'?'枝の上限（1000ノード・深さ100・各1,000,000 UTF-8 bytes）を超えるため貼り付けできません。':
    /note|unmapped|unsupported|source/.test(reason)?'note・anchor・未対応行などを含む枝は、内容を保全できないため構造貼り付けできません。Markdownコピーは利用できます。':
    `枝を貼り付けできませんでした（${reason}）。本文は変更していません。枝をコピーし直してください。`;
  let pasteWait: HTMLElement | undefined;
  const clearPasteWait=()=>{pasteWait?.remove();pasteWait=undefined;};
  const cancelPaste=()=>{clearPasteWait();const p=pasteAttempt;if(!p)return;pasteAttempt=undefined;structuralCopy=undefined;
    send({source:'webview',protocolVersion:2,documentUri:committed?.documentUri,type:'thoughtforge.r7.cancel',requestId:p.id});
    if(p.sent){const request=pending.get(p.id);if(request)request.pasteCanceled=true;}else pending.delete(p.id);
    say('貼り付けを取り消しました。保存結果が届いた場合は地図のUndoで戻せます。');};
  const pasteBranch=(parentId: string,eventText?: string)=>{if(!committed?.map || !structuralCopy?.acked || mapCommandGate('map-paste-branch',false,controller?.mapCommandContext?.()))return;
    const parent=committed.map.nodesById[parentId];if(!parent)return;
    const id=`r7-s:${viewId}:${++serial}`;pasteAttempt={id,parentId,hash:committed.contentHash,signature:pasteSignature(),sent:false};
    clearPasteWait();pasteWait=doc.createElement('section');pasteWait.setAttribute('data-r7-wait','');
    pasteWait.setAttribute('role','status');pasteWait.style.cssText='position:fixed;bottom:12px;left:12px;z-index:100;padding:12px;background:var(--background-primary,#fff)';
    const text=doc.createElement('p');text.textContent='クリップボードを確認しています。時間がかかる場合は取り消せます。';pasteWait.append(text);
    const cancel=doc.createElement('button');cancel.type='button';cancel.textContent='貼り付けを取り消す';cancel.addEventListener('click',cancelPaste);pasteWait.append(cancel);doc.body.append(pasteWait);
    if(!send({source:'webview',protocolVersion:2,documentUri:committed.documentUri,type:'thoughtforge.r7.read',requestId:id,
      value:{baseHash:committed.contentHash,copyToken:structuralCopy.token,expectedChildCount:parent.children.length,mountEpoch,parentId,...(eventText!==undefined?{eventText}:{})}})){cancelPaste();}
    else say('クリップボードを確認しています。');commandContextChanged();};
  type ParentInput = { active: boolean; nodeId: string; hash: string; mount: number; input: HTMLInputElement; panel: HTMLElement; composing: boolean; ended: number; requestId?: string; canceled?: boolean };
  let parentInput: ParentInput | undefined;
  const parentPanels: ParentInput[] = [];
  const parentArchive: string[] = [];
  let parentRecovery: HTMLElement | undefined;
  const showParentRecovery = (closing=false) => {
    parentRecovery?.remove();parentRecovery=undefined;
    const texts=[...parentArchive,...parentPanels.map(p=>p.input.value)];
    if(!texts.length)return;
    const panel=doc.createElement('section');panel.setAttribute('data-r7-recovery','');panel.setAttribute('data-thoughtforge-recovery','');
    panel.style.cssText='position:fixed;bottom:12px;right:12px;z-index:101;padding:12px;background:var(--background-primary,#fff);color:var(--text-normal,#222);max-height:50vh;overflow:auto';
    const label=doc.createElement('p');label.textContent='保存していない新親入力の一覧です。閉じる前にコピーして回収してください。';panel.append(label);
    const list=doc.createElement('textarea');list.readOnly=true;list.setAttribute('aria-label','保持中の新親入力');list.value=texts.join('\n');panel.append(list);
    const copy=doc.createElement('button');copy.type='button';copy.textContent='入力をコピー';copy.addEventListener('click',()=>send({source:'webview',protocolVersion:2,type:'thoughtforge.clipboard.write',documentUri:committed?.documentUri,text:list.value,format:'text',scope:'node',nodeId:'center'}));panel.append(copy);
    const back=doc.createElement('button');back.type='button';back.textContent='地図へ戻る';back.addEventListener('click',()=>{panel.hidden=true;});if(!closing)panel.append(back);
    parentRecovery=panel;doc.body.append(panel);
  };
  const compactParentPanels = () => {
    for(let i=0;i<parentPanels.length;i++){const p=parentPanels[i]!;if(!p.requestId&&(p.canceled||p.panel.hidden)){
      if(p.input.value)parentArchive.push(p.input.value);p.panel.remove();parentPanels.splice(i--,1);if(parentInput===p)parentInput=undefined;
    }}
  };
  const settleParent = (requestId: string,applied: boolean,reason?: string) => {
    const p=parentPanels.find(p=>p.requestId===requestId);if(!p)return;
    p.requestId=undefined;
    if(applied){p.panel.hidden=true;p.panel.remove();parentPanels.splice(parentPanels.indexOf(p),1);if(parentInput===p)parentInput=undefined;}
    else {
      p.active=parentInput===p&&!p.canceled;p.input.readOnly=!p.active;
      p.panel.querySelector<HTMLButtonElement>('[data-r7-confirm]')!.disabled=!p.active;
      p.panel.querySelector('[data-r7-status]')!.textContent=p.canceled?'追加を取り消しました。入力は保持しています。':`保存できませんでした（${reason??'接続切れ'}）。入力は保持しています。再試行または取消ができます。`;
    }
  };
  const cancelParent = (p=parentInput) => {
    if (!p || !p.active&&!p.requestId) return;
    if(p.requestId)send({source:'webview',protocolVersion:2,documentUri:committed?.documentUri,type:'thoughtforge.r7.cancel',requestId:p.requestId});
    p.canceled=true;p.active=false;p.input.readOnly=true;
    p.panel.querySelector<HTMLButtonElement>('[data-r7-confirm]')!.disabled=true;
    p.panel.querySelector('[data-r7-status]')!.textContent='追加を取り消しました。入力はこの画面で保持しています。';
    commandContextChanged();
  };
  const confirmParent = () => {
    const p = parentInput;
    if (!p?.active || p.composing || performance.now()-p.ended<350 || isComposing() || performance.now() - (state().lastCompositionEndAt ?? -Infinity) < 350) return;
    const c = controller?.mapCommandContext?.();
    if (p.hash !== committed?.contentHash || p.mount !== mountEpoch || p.nodeId !== state().selectedNodeId ||
        !c?.visible || committed?.writeState !== 'ready' || permissionBlocked || semanticBusy()) { cancelParent(); return; }
    p.active = false; p.input.readOnly = true;
    const requestId = `r7-p:${viewId}:${++serial}`;p.requestId=requestId;p.canceled=false;
    p.panel.querySelector<HTMLButtonElement>('[data-r7-confirm]')!.disabled = true;
    p.panel.querySelector('[data-r7-status]')!.textContent = '保存結果を確認しています。入力はこの画面で保持しています。';
    if(!post({ source: 'webview', type: 'thoughtforge.command', requestId, command: {
      type: 'node.wrapInNewParent', nodeId: p.nodeId, nextNodeId: `r7-parent:${viewId}:${serial}`, text: p.input.value } }))settleParent(requestId,false);
    commandContextChanged();
  };
  const insertParent = (nodeId: string) => {
    if (mapCommandGate('map-insert-parent', false) || !committed?.map?.nodesById[nodeId]) return;
    compactParentPanels();
    if(parentPanels.filter(p=>!p.canceled&&!p.panel.hidden).length>=20){showParentRecovery();say('保持中の新親入力が20件に達しました。入力をコピーして回収してください。','error');return;}
    cancelParent(); if(parentInput)parentInput.panel.hidden=true;
    const panel = doc.createElement('section'); panel.setAttribute('data-r7-parent', '');
    panel.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:100;padding:12px;background:var(--background-primary,#fff);color:var(--text-normal,#222);border:1px solid currentColor';
    const label = doc.createElement('label'); label.textContent = '新しい親のタイトル ';
    const input = doc.createElement('input'); input.setAttribute('aria-label', '新しい親のタイトル'); label.append(input); panel.append(label);
    const status = doc.createElement('p'); status.setAttribute('data-r7-status', ''); status.textContent = '確定するまで地図は変わりません。取消後の入力はこの画面で保持します。'; panel.append(status);
    const button = (text: string, run: () => void) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', run); panel.append(b); return b; };
    button('確定', () => {if(parentInput?.panel===panel)confirmParent();}).setAttribute('data-r7-confirm', ''); button('取消', () => cancelParent(parentPanels.find(p=>p.panel===panel)));
    button('入力をコピー', () => send({source:'webview',protocolVersion:2,type:'thoughtforge.clipboard.write',documentUri:committed?.documentUri,text:input.value,format:'text',scope:'node',nodeId:'center'}));
    if(parentPanels.length||parentArchive.length)button('前の入力',()=>showParentRecovery());
    button('地図へ戻る', () => { cancelParent(parentPanels.find(p=>p.panel===panel)); panel.hidden = true; doc.querySelector<HTMLInputElement>(`input[data-node-id="${state().selectedNodeId}"]`)?.focus(); });
    parentInput = { active: true, nodeId, hash: committed.contentHash, mount: mountEpoch, input, panel, composing: false, ended: -Infinity };
    input.addEventListener('compositionstart', () => { if(parentInput?.input===input)parentInput.composing=true; });
    input.addEventListener('compositionend', () => { if(parentInput?.input===input){parentInput.composing=false;parentInput.ended=performance.now();} });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'Enter') { e.stopImmediatePropagation(); if (!e.isComposing && !isComposing()) { e.preventDefault(); if(e.key==='Enter')confirmParent();else cancelParent(); } }
    });
    parentPanels.push(parentInput); doc.body.append(panel); input.focus(); commandContextChanged();
  };
  const parentCommand = (confirm: boolean) => { if (!parentInput?.active) return false; if(confirm)confirmParent();else cancelParent(); return true; };
  const localMapCommand = (id: string) => transport ? controller?.dispatchMapCommand?.(id, false) : historyRequest(id === 'map-redo' ? 'redo' : 'undo');
  const mapCommandLink = (title: string, nodeId: string, openIn: string) => {
    const uri=committed?.documentUri, hash=committed?.contentHash;
    const message={source:'webview',protocolVersion:2,documentUri:uri,type:'thoughtforge.link.open',linktext:title.split('|')[0],linkKind:'wikilink',nodeId:nodeId===centerId?'center':nodeId,openIn};
    void navigate(() => { if(committed?.documentUri===uri && committed?.contentHash===hash)send(message); });
  };
  const guard = (command: any): CommandGuard | undefined => {
    const m = committed; if (!m?.map || m.writeState !== 'ready') return undefined;
    const node = (id: string | null): any => id === null ? { kind: 'roots' } : Object.hasOwn(m.map!.nodesById, id)
      ? { kind: 'node', nodeId: id, titleSource: m.map!.nodesById[id]!.text } : undefined;
    let targets: any[];
    switch (command.type) {
      case 'map.rename': case 'map.updateNote': case 'map.clearNote': targets = [{ kind: 'center', titleSource: m.map.title }]; break;
      case 'node.insertChild': targets = [node(command.parentId)]; break;
      case 'node.insertSibling': targets = [node(command.siblingId)]; break;
      case 'node.move': targets = [node(command.nodeId), node(command.nextParentId)]; break;
      case 'node.rename': case 'node.updateNote': case 'node.clearNote': case 'node.delete': case 'node.deleteKeepChildren':
      case 'node.indent': case 'node.outdent': case 'node.wrapInNewParent': case 'node.renameAndInsertChild': case 'node.renameAndInsertSibling': targets = [node(command.nodeId)]; break;
      default: return undefined;
    }
    return targets.every(Boolean) ? { baseHash: m.contentHash, targets } : undefined;
  };
  const forgetRenameRequest = (requestId: string) => controller?.finishRename?.(requestId);
  const cleanupInsert = (requestId: string, command: any): boolean => {
    const created = command && createdId(command);
    if (!created || !state().pendingOptimisticNodes?.has(created)) return false;
    forgetRenameRequest(requestId);
    captureAll(); state().pendingCommandRequests?.delete(requestId);
    if (state().directEditSession?.nodeId === created && state().directEditSession.phase === 'committing') state().directEditSession.phase = 'editing';
    return true;
  };
  const rejectLocal = (message: any, detail: string) => {
    captureAll(); say(detail, 'error');
    if (state().isComposingText || state().directEditSession?.phase === 'composing') {
      if (forgetRenameRequest(message.requestId)) redrawSaved(modelCount);
      state().pendingCommandRequests?.delete(message.requestId);
      return; // A rejected older intent cannot tear down the new composition.
    }
    forward({ source: 'extension', type: 'thoughtforge.command.result', protocolVersion: 1, documentUri: shellUri ?? message.documentUri,
      requestId: message.requestId, status: 'rejected', reason: 'apply-rejected' }); raw.restore();
  };
  const post = (message: any, clipboardRequestId?: string, queuedSeq?: number): boolean => {
    if (message.type === 'thoughtforge.command') {
      if(pasteAttempt&&!pasteAttempt.sent)cancelPaste();
      cancelDeleteConfirmation();
      const { intentSeq, ...command } = message.command; message = { ...message, command };
      const seq = queuedSeq ?? intentSeq ?? nextSeq();
      if (!draining && (pending.size || deferred.length || flushTimer)) { enqueue({ message: structuredClone(message), clipboardRequestId, seq }); return true; }
      captureAll(); const g = guard(message.command);
      if (!g) { rejectLocal(message, 'この操作は現在実行できません。入力は下書きに保持しています。'); return false; }
      const field = /Note$/.test(message.command.type) ? 'note' : 'title';
      const id = message.command.type.startsWith('map.') ? 'center' : message.command.nodeId;
      const drafts = /^(map\.rename|node\.rename|node\.renameAndInsertChild|node\.renameAndInsertSibling|map\.updateNote|map\.clearNote|node\.updateNote|node\.clearNote)$/.test(message.command.type) ? [...locals.values()].filter(local => local.target.field === field &&
        (local.target.kind === 'center' ? id === 'center' : local.target.kind === 'node' && local.target.nodeId === id) &&
        (field === 'note' ? local.text === (message.command.note ?? '') : local.text.replace(/\s+/g, ' ').trim() === (message.command.nextTitle ?? message.command.nextText))).map(local => ({ id: local.draftId, revision: local.revision }))
        : [];
      const created = createdId(message.command);
      if (created) for (const local of locals.values()) if (local.target.kind === 'pending-child' && local.inputId === created) drafts.push({ id: local.draftId, revision: local.revision });
      pending.set(message.requestId, { command: structuredClone(message.command), hash: g.baseHash, intentSeq: seq, drafts });
      if (!send({ ...message, documentUri: committed!.documentUri, protocolVersion: 2, guard: g })) { pending.delete(message.requestId); commandContextChanged(); rejectLocal(message, '地図との接続が切れました。入力は保持しています。'); return false; }
      syncActions();
      return true;
    }
    if (message.type === 'thoughtforge.markdown-link.open') {
      const uri = committed?.documentUri, hash = committed?.contentHash, nodeId = state().selectedNodeId === centerId ? 'center' : state().selectedNodeId ?? 'center';
      void navigate(() => { if (committed?.documentUri === uri && committed?.contentHash === hash) send({ source: 'webview', protocolVersion: 2, documentUri: uri,
        type: 'thoughtforge.link.open', linktext: String(message.title).split('|')[0], linkKind: 'wikilink',
        nodeId, openIn: 'same-tab' }); }); return true;
    }
    if (message.type === 'thoughtforge.source.reveal') { const hash = committed?.contentHash; void navigate(() => { if (committed?.contentHash !== hash) { say('本文の位置が変わりました。内容を確認してもう一度開いてください。', 'error'); return; } send({ ...message, documentUri: committed!.documentUri, protocolVersion: 2 }); }); return true; }
    if (message.type === 'thoughtforge.clipboard.write') {
      structuralCopy=undefined;cancelPaste();
      return send({ ...message,documentUri:committed?.documentUri,protocolVersion:2,effectId:clipboardRequestId,
        ...(message.scope==='subtree'&&message.format==='markdown'&&committed?.mode==='map-md'&&clipboardRequestId?{r7:{baseHash:committed.contentHash,mountEpoch,nodeId:message.nodeId,text:message.text}}:{})},clipboardRequestId);
    }
    // Ready remains a local shell handshake, not a semantic v1 command channel.
    if (message.type === 'thoughtforge.webview.ready') { shellUri = message.documentUri;send({source:'webview',protocolVersion:2,documentUri:shellUri,type:'thoughtforge.r7.mount',requestId:`r7-mount:${viewId}:${mountEpoch}`,mountEpoch}); return send(message); }
    return false;
  };
  const clear = (local: Local) => {
    if (permissionBlocked) return;
    if (!local.pendingClear && !issue(local)) return; local.pendingClear = true;
    let ok = false;
    try { ok = send({ source: 'webview', protocolVersion: 2, type: 'thoughtforge.draft.clear', documentUri: committed!.documentUri,
      draftId: local.draftId, revision: local.revision }); } catch { /* An unconfirmed clear never removes the recoverable input. */ }
    // Elapsed time uses the monotonic clock: a wall-clock rollback must not hide the resend forever.
    local.clearFailed = !ok || undefined; local.clearSentAt = performance.now();
    // The host reports a later persistence failure only as an Obsidian notice; surface a resend if no restore confirms it.
    setTimeout(() => { if (active) renderNotice(); }, CLEAR_CONFIRM_MS + 10);
    if (!ok) say('入力を破棄できませんでした。移動は止めています。');
    renderNotice();
  };
  const historyRequest = (kind: 'undo' | 'redo', queuedSeq?: number) => {
    if(pasteAttempt&&!pasteAttempt.sent)cancelPaste();
    cancelDeleteConfirmation();
    const seq = queuedSeq ?? nextSeq();
    if (!draining && (pending.size || deferred.length || flushTimer)) { enqueue({ history: kind, seq }); return; }
    if (!committed || committed.writeState !== 'ready' || !history[kind === 'undo' ? 'canUndo' : 'canRedo']) return;
    captureAll(); const requestId = `history-${viewId}-${++serial}`;
    pending.set(requestId, { intentSeq: seq, drafts: [] }); commandContextChanged();
    send({ source: 'webview', protocolVersion: 2, documentUri: committed.documentUri,
      type: `thoughtforge.history.${kind}`, requestId, baseHash: committed.contentHash });
  };
  // Label+hash match for changes without a host idMap. A signature shared by two topics on either side proves
  // nothing (a deleted duplicate's ID can be reused by its twin), so it never matches.
  const signature = (m: ModelUpdateV2, id: string) => JSON.stringify([m.map?.nodesById[id]?.text, m.noteIndex?.nodes[id]?.ownRangeHash]);
  // Counted once per model (linear), not per node.
  const signatureCounts = new WeakMap<ModelUpdateV2, Map<string, number>>();
  const uniqueSignature = (m: ModelUpdateV2, id: string) => {
    let counts = signatureCounts.get(m);
    if (!counts) { counts = new Map(); for (const other of Object.keys(m.map?.nodesById ?? {})) { const sig = signature(m, other); counts.set(sig, (counts.get(sig) ?? 0) + 1); } signatureCounts.set(m, counts); }
    return counts.get(signature(m, id)) === 1;
  };
  const signatureIndex = new WeakMap<ModelUpdateV2, Map<string, string>>();
  const bySignature = (m: ModelUpdateV2) => {
    let index = signatureIndex.get(m);
    if (!index) { index = new Map(); for (const id of Object.keys(m.map?.nodesById ?? {})) if (m.noteIndex?.nodes[id] && uniqueSignature(m, id)) index.set(signature(m, id), id); signatureIndex.set(m, index); }
    return index;
  };
  const sameNode = (a: ModelUpdateV2, b: ModelUpdateV2, id: string) => a.map?.nodesById[id]?.text === b.map?.nodesById[id]?.text &&
    !!a.noteIndex?.nodes[id] && !!b.noteIndex?.nodes[id] && a.noteIndex.nodes[id]!.ownRangeHash === b.noteIndex.nodes[id]!.ownRangeHash &&
    uniqueSignature(a, id) && uniqueSignature(b, id);
  const sameCenter = (a: ModelUpdateV2, b: ModelUpdateV2) => a.mode === b.mode && a.map?.title === b.map?.title &&
    a.noteIndex?.center.kind === b.noteIndex?.center.kind && a.noteIndex?.center.anchorHash === b.noteIndex?.center.anchorHash;
  const beforeModelStep = (projection: any) => {
    const next: ModelUpdateV2 = projection.adapterModel; if (!next) return;
    const previous = committed, cause = next.cause;
    const result = 'requestId' in cause ? results.get(cause.requestId) : undefined;
    const hostMap = cause.kind === 'applied-elsewhere' ? cause.idMap : result?.status === 'applied' ? result.idMap : undefined;
    const explicit = hostMap ?? {};
    // A status-only notice (edit gate, save state) re-sends the same raw: parser IDs are stable for identical text.
    const unchangedText = !!previous && previous.documentUri === next.documentUri && previous.mode === next.mode && previous.contentHash === next.contentHash;
    if (!unchangedText || hostMap && Object.keys(previous?.map?.nodesById ?? {}).some(id => explicit[id] !== id)) {
      state().commandModelEpoch = (state().commandModelEpoch ?? 0) + 1;
    }
    const ids: Record<string, string> = {}, follow: Record<string, string> = {};
    if (previous?.map && next.map) for (const id of Object.keys(previous.map.nodesById)) {
      const mapped = explicit[id];
      // When the host sent an idMap it is authoritative in both note and map-md modes: a missing ID means the topic
      // is gone or unproven, never "same label, same ID" (a deleted duplicate must not hand its input to a survivor).
      // Without one (external change), the conservative label+hash match remains.
      if (mapped && Object.hasOwn(next.map.nodesById, mapped)) ids[id] = mapped;
      else if (!hostMap && unchangedText && Object.hasOwn(next.map.nodesById, id)) ids[id] = id; // same raw: IDs are the same topics
      else if (!hostMap && sameNode(previous, next, id)) ids[id] = id;
      // An external insert above shifts parser IDs: the selection (never input, drafts or pending operations, which
      // could land on a different topic with the same label and body) follows a label+hash unique on both sides.
      else if (!hostMap && uniqueSignature(previous, id)) { const moved = bySignature(next).get(signature(previous, id)); if (moved) follow[id] = moved; }
    }
    if (previous && sameCenter(previous, next)) ids[centerId] = centerId;
    // Display requests follow the same proven IDs as pending operations.
    const request = 'requestId' in cause ? pending.get(cause.requestId) : undefined;
    const s = state();
    s.commandModelHash = next.contentHash;
    const inserted = request?.command && (/^node\.(insertChild|insertSibling)$/.test(request.command.type) ? request.command.nodeId : request.command.nextNodeId);
    const resolving = inserted && s.pendingOptimisticNodes?.has(inserted) && !previous?.map?.nodesById[inserted];
    if (resolving && result?.status === 'applied' && result.resultNodeId && next.map?.nodesById[result.resultNodeId]) ids[inserted] = result.resultNodeId;
    for (const meta of s.pendingOptimisticNodes?.values() ?? []) for (const field of ['parentId', 'siblingId', 'dependsOnNodeId']) {
      const old = meta[field]; if (old === null || old === undefined) continue;
      if (ids[old]) meta[field] = ids[old];
      else if (!s.pendingOptimisticNodes.has(old) || previous?.map?.nodesById[old]) meta.adapterDetached = true;
    }
    // Detachment propagates to uncreated topics that depend on a detached one (they cannot be placed either).
    for (let changed = true; changed;) {
      changed = false;
      for (const meta of s.pendingOptimisticNodes?.values() ?? []) if (!meta.adapterDetached && ['parentId', 'siblingId', 'dependsOnNodeId']
        .some(field => meta[field] && s.pendingOptimisticNodes.get(meta[field])?.adapterDetached)) { meta.adapterDetached = true; changed = true; }
    }
    for (const [owner, commands] of s.queuedOptimisticCommands?.entries() ?? []) {
      const retained = commands.filter(({ requestId, command }: any) => {
        const fields = command.type === 'node.insertChild' ? ['parentId'] : command.type === 'node.insertSibling' ? ['siblingId']
          : command.type === 'node.move' ? ['nodeId', 'nextParentId'] : ['nodeId'];
        for (const field of fields) {
          const old = command[field]; if (old === null || old === undefined) continue;
          if (ids[old]) command[field] = ids[old];
          else if (!s.pendingOptimisticNodes?.has(old) || previous?.map?.nodesById[old]) { forgetRenameRequest(requestId); say('操作の適用先が変わりました。入力を保持し、保留中の操作を停止しました。', 'error'); return false; }
        }
        return true;
      });
      s.queuedOptimisticCommands.set(owner, retained);
    }
    for (let i = deferred.length - 1; i >= 0; i--) {
      const item = deferred[i]!; if ('history' in item) continue;
      const command = item.message.command;
      for (const field of ['nodeId', 'parentId', 'siblingId', 'nextParentId']) {
        // An insert's nodeId is the topic it creates, not a target to follow.
        const old = command[field]; if (old === null || old === undefined || (field === 'nodeId' && /^(map\.|node\.insert(Child|Sibling)$)/.test(command.type))) continue;
        if (ids[old]) command[field] = ids[old];
        else if (!s.pendingOptimisticNodes?.has(old) || previous?.map?.nodesById[old]) {
          forgetRenameRequest(item.message.requestId); deferred.splice(i, 1); say('操作の適用先が変わりました。入力を保持し、保留中の操作を停止しました。', 'error'); break;
        }
      }
    }
    // A topic still being created (e.g. the next sibling made by Enter) was never in the previous map: keep pointing at it.
    const stillUncreated = (id: string) => !ids[id] && !!s.pendingOptimisticNodes?.has(id) && !s.pendingOptimisticNodes.get(id).adapterDetached && !previous?.map?.nodesById[id];
    controller?.rebindRenames?.(ids, stillUncreated);
    for (const key of ['selectedNodeId', 'editingNodeId', 'pendingFocusNodeId', 'pendingEditingRefocusNodeId', 'focusRootNodeId']) {
      const old = s[key]; if (!old || stillUncreated(old)) continue;
      if (ids[old]) s[key] = ids[old];
      else if (follow[old] && (key === 'selectedNodeId' || key === 'focusRootNodeId')) s[key] = follow[old];
      else { s[key] = undefined; if (key === 'selectedNodeId') selectionCleared = true; }
    }
    if (s.directEditSession?.nodeId && !stillUncreated(s.directEditSession.nodeId)) {
      const old = s.directEditSession.nodeId;
      if (ids[old]) controller?.retarget(old, ids[old]!, s.directEditSession.surface);
      else { s.directEditSession = undefined; s.editingSurface = undefined; s.directKeyQueue = []; }
    }
    s.pendingMoveSelection = undefined;
    s.pendingFocusTarget = undefined;
    for (const key of ['focusHistoryNodeIds', 'focusForwardNodeIds']) if (s[key]) s[key] = s[key].flatMap((id: string) => ids[id] ? [ids[id]] : []);
    if (s.collapsedNodeIds) s.collapsedNodeIds = new Set([...s.collapsedNodeIds].flatMap((id: string) => ids[id] ? [ids[id]] : []));
    const nextIdentities = new Map<string, string>();
    for (const [key, identity] of identities) {
      const [kind, id, field] = JSON.parse(key); const mapped = kind === 'pending-child' ? undefined : ids[id === 'center' ? centerId : id];
      if (mapped) nextIdentities.set(JSON.stringify([kind, mapped === centerId ? 'center' : mapped, field]), identity);
    }
    identities.clear(); for (const pair of nextIdentities) identities.set(...pair);
    if (resolving && ids[inserted]) for (const entry of raw.snapshot()) {
      const [id, field] = JSON.parse(entry.key);
      if (id === inserted) identities.set(JSON.stringify(['node', ids[inserted], field]), entry.identity);
    }
    raw.remap(ids, resolving && ids[inserted] ? [inserted] : []);
    for (const [old, mapped] of queuedFlushes) { if (ids[mapped]) queuedFlushes.set(old, ids[mapped]!); else queuedFlushes.delete(old); }
    committed = structuredClone(next);
    // Publish this creation once to every input binding, including retired DOM.
    // Keep each binding object intact for callbacks already queued against it.
    const createdOperation = inserted && s.pendingOptimisticNodes?.get(inserted);
    if (createdOperation && ids[inserted] && result?.status === 'applied') {
      for (const binding of bindings.keys()) if (binding.operation === createdOperation && binding.target.kind === 'pending-child') {
        const target = currentTarget(ids[inserted]!, binding.target.field);
        if (target) { binding.target = structuredClone(target); binding.operation = undefined; }
      }
    }
    byTarget.clear();
    const completedPending: Local[] = [];
    for (const local of [...locals.values()]) {
      if (local.pendingClear) continue; // A pending tombstone keeps its issued revision until confirmation.
      const old = local.target.kind === 'node' ? local.target.nodeId : local.target.kind === 'center' ? centerId : local.inputId!;
      const mapped = ids[old], target = mapped && currentTarget(mapped, local.target.field);
      if (mapped) local.inputId = mapped;
      const settled = request?.drafts.some(d => d.id === local.draftId && d.revision === local.revision) && result?.status === 'applied';
      if (target && local.target.kind === 'pending-child' && old === inserted && result?.status === 'applied') {
        // The pending operation is complete. Keep newer/unapplied raw as an
        // ordinary node draft with a fresh identity, not pending-only state.
        if (local.text !== baseline(target) || local.revisionBlocked) {
          const fresh = add(target, local.text, local.detached, undefined, mapped);
          fresh.revisionBlocked = local.revisionBlocked;
        }
        local.operation = undefined;
        completedPending.push(local);
      } else if (target && !local.detached) {
        if (!settled && JSON.stringify(local.target) !== JSON.stringify(target)) issue(local, local.text, target);
        if (local.target.kind !== 'pending-child') { local.key = targetKey(local.target); local.inputId = mapped; local.operation = undefined; }
        byTarget.set(local.key, local.draftId);
      } else if (local.target.kind === 'pending-child' && stillUncreated(old) && unchangedText) {
        byTarget.set(local.key, local.draftId); // Preserve the original proof/time for a status-only model.
      } else if (previous && previous.contentHash !== next.contentHash) {
        local.detached = true;
        if (local.target.kind === 'pending-child') local.persistenceBlocked = true;
        say('ノートが変わりました。引き継げない入力は下書きに保持しています（次に開いたときに知らせます）。', 'error');
      }
    }
    if (request?.command && result?.status === 'applied' && result.resultNodeId &&
        (request.command.type === 'node.wrapInNewParent' || request.command.type==='node.pasteSubtreeAsLastChild') && !request.pasteCanceled && s.selectedNodeId === ids[request.command.nodeId??request.command.parentId] && !s.editingNodeId) {
      s.selectedNodeId = result.resultNodeId; s.editingNodeId = undefined; s.editingSurface = undefined;
      s.pendingFocusNodeId=undefined;s.pendingFocusSurface=undefined;selectedFocus=result.resultNodeId;
      let id: string | undefined = result.resultNodeId;
      while(id) { s.collapsedNodeIds?.delete(id); id = Object.values(next.map?.nodesById ?? {}).find(n => n.children.includes(id!))?.id; }
      if(request.command.type==='node.pasteSubtreeAsLastChild')say('枝を保存しました。地図のUndoで戻せます。');
    } else if (request?.command?.type === 'node.insertChild' && request.command.parentId === null &&
        result?.status === 'applied' && result.resultNodeId && s.selectedNodeId === centerId && !controller?.mapCommandContext?.().nativeInput) {
      s.selectedNodeId = result.resultNodeId; s.editingNodeId = result.resultNodeId; s.editingSurface = 'map';
      s.pendingEditingRefocusNodeId = result.resultNodeId; s.pendingFocusSurface = 'map';
    }
    // Settlement is causal, never guessed from title/position or a reused numeric ID.
    if (inserted && ids[inserted]) {
      const mapped = ids[inserted]!, meta = s.pendingOptimisticNodes?.get(inserted);
      s.pendingOptimisticNodes?.delete(inserted); s.draftNodeIds?.delete(inserted);
      if (next.map?.nodesById[mapped]?.text === '') { s.draftNodeIds?.add(mapped); if (meta?.deleteWhenCreated) deleteWhenCreated.set(mapped, inserted); }
      controller?.dependents(inserted, mapped);
      queuedFlushes.set(inserted, mapped);
      failedInsert.delete(inserted);
    }
    if (request && result?.status === 'applied' && 'requestId' in cause) {
      controller?.finishRename?.(cause.requestId, true);
      for (const local of completedPending) clear(local);
      for (const captured of request.drafts) { const local = locals.get(captured.id); if (local && local.target.kind !== 'pending-child' && local.revision === captured.revision) clear(local); }
      pending.delete(cause.requestId); results.delete(cause.requestId);
    }
    pruneBindings();
  };
  const beforeModel = (projection: any) => {
    captureAll();
    const end = modelTrail.indexOf(projection.adapterModel);
    const trail = end >= 0 ? modelTrail.splice(0, end + 1) : [projection.adapterModel];
    for (const next of trail) if (next) beforeModelStep({ adapterModel: next });
    const flush = () => {
      flushTimer = undefined;
      if (!active) return;
      if (state().isComposingText || ['composing', 'committing'].includes(state().directEditSession?.phase)) { flushTimer = setTimeout(flush, 50); return; }
      const flushes = [...queuedFlushes]; queuedFlushes.clear();
      if (active) for (const [old, mapped] of flushes) if (committed?.map?.nodesById[mapped]) controller?.flush(old, mapped);
      commandContextChanged(); drain();
    };
    if (!flushTimer && queuedFlushes.size) flushTimer = setTimeout(flush, 0);
  };
  const reconcileMap = (map: any) => {
    const next = map ? structuredClone(map) : undefined;
    for (const meta of state().pendingOptimisticNodes?.values() ?? []) if (next && !meta.adapterDetached &&
      (meta.parentId === null || !meta.parentId || next.nodesById[meta.parentId])) controller?.overlay(next, meta);
    return next;
  };
  const drain = () => {
    if (!controller || flushTimer) return; // a retired mount cannot dispatch its held commands
    while (active && !pending.size && deferred.length) {
      const head = deferred[0]!;
      if ('history' in head && !history[head.history === 'undo' ? 'canUndo' : 'canRedo']) {
        // An applied operation's history state follows its result: an Undo/Redo made after it waits for that
        // state (and so does everything after it). One that still cannot run is dropped.
        if (historyStale) { setTimeout(() => { historyStale = false; commandContextChanged(); drain(); }, 1000); return; }
        deferred.shift(); continue;
      }
      const next = deferred.shift()!;
      draining = true; // the head of the queue goes out; later intents keep waiting behind it
      try { if ('history' in next) historyRequest(next.history, next.seq); else post(next.message, next.clipboardRequestId, next.seq); } finally { draining = false; }
    }
    commandContextChanged();
  };
  const afterModel = () => {
    raw.modelApplied(); updateUI();
    if(selectedFocus){const id=selectedFocus;selectedFocus=undefined;Array.from(doc.querySelectorAll<HTMLElement>('input[data-node-id],button[data-node-id]')).find(e=>e.dataset.nodeId===id&&e.closest('.thoughtforge-map-node'))?.focus({preventScroll:true});}
    // A new topic the user cancelled with Esc while its creation was in flight is removed once saved.
    for (const [id, old] of [...deleteWhenCreated]) {
      deleteWhenCreated.delete(id);
      const s = state(), dependents = (nodeId: string) => !!s.queuedOptimisticCommands?.get(nodeId)?.length ||
        [...s.pendingOptimisticNodes?.values() ?? []].some((m: any) => [m.parentId, m.siblingId, m.dependsOnNodeId].includes(nodeId));
      if (committed?.map?.nodesById[id]?.text === '' && s.editingNodeId !== id && !committed.map.nodesById[id]!.children?.length && !dependents(id) && !dependents(old)) {
        state().draftNodeIds?.delete(id); controller?.postCommand({ type: 'node.delete', nodeId: id });
      }
    }
    drain(); // waits for a scheduled flush, which drains after it
  };
  // Redraw from the saved text the way a status-only update does (input, focus and caret are kept). It waits for
  // an IME commit, and gives way to any newer host model (which already redraws without the cleared title).
  const redrawSaved = (since: number) => setTimeout(() => {
    if (!active || !committed || modelCount !== since) return;
    if (isComposing()) { redrawSaved(since); return; }
    model({ ...structuredClone(committed), cause: { kind: 'external' } });
  }, 50);
  const model = (message: ModelUpdateV2) => {
    if (!active) return;
    if (deleteConfirmation && (message.contentHash !== deleteConfirmation.hash || message.documentUri !== committed?.documentUri || message.writeState !== 'ready')) cancelDeleteConfirmation();
    modelCount++;
    retireComposition();
    const reasons: Record<string, string> = { 'pending-markdown': 'Markdownの保存待ち', 'markdown-state-unknown': '保存済み本文との一致を確認できません',
      'plugin-data-unknown-version': '設定データの版を読み取れません', 'plugin-data-invalid': '設定データが不正です', 'plugin-data-load-failed': '設定データを読み込めません' };
    const reason = message.writeState === 'ready' ? undefined : message.hostReasons?.map(r => reasons[r] ?? r).join('、') ||
      (message.writeState === 'not-openable' ? 'このノートを地図で開けません' : '地図の編集を停止しています');
    const nextPermissionBlocked = message.writeState === 'read-only' && !message.hostReasons?.length;
    if (permissionBlocked || nextPermissionBlocked) {
      permissionRetirement = true; permissionCompositions = new WeakSet();
      captureAll();
      for (const d of deferred) if ('message' in d) forgetRenameRequest(d.message.requestId);
      deferred.length = 0; queuedFlushes.clear();
      if (flushTimer) clearTimeout(flushTimer); flushTimer = undefined;
      // Retain input without replay.
      for (const local of locals.values()) { local.permissionRetired = true; local.sent = Math.max(local.sent, local.revision); }
    }
    permissionBlocked = nextPermissionBlocked;
    setGate(reason, message.writeState === 'read-only' || message.writeState === 'stopped');
    if (message.cause.kind === 'applied' || message.cause.kind === 'undo' || message.cause.kind === 'redo') {
      const r = results.get(message.cause.requestId);
      if (!r || r.status !== 'applied' || r.nextHash !== message.contentHash || !pending.has(message.cause.requestId)) {
        waiting.set(message.cause.requestId, message); return;
      }
    }
    modelTrail.push(message);
    forward({ source: 'extension', type: 'thoughtforge.model.update', protocolVersion: 1, documentUri: shellUri ?? message.documentUri,
      document: { uri: shellUri ?? message.documentUri, version: ++version, text: '' }, map: message.map, adapterModel: message });
  };
  const receive = (message: HostMessageV2 | DraftSaveResultMessage | DraftRestoreMessage | any): boolean => {
    if (!active || message?.source !== 'extension' || message.protocolVersion !== 2) return false;
    if (message.documentUri && committed && message.documentUri !== committed.documentUri) {
      if (message.type !== 'thoughtforge.model.update' || message.cause?.kind !== 'initial') return false;
      state().pendingRenames?.clear();
      captureAll(); retireComposition(); cancelNavigation(); pending.clear(); results.clear(); waiting.clear(); modelTrail.length = 0; queuedFlushes.clear(); deferred.length = 0; deleteWhenCreated.clear();
      raw.takeModel(); setGate('名前・場所の変更を確認しています');
      for (const local of locals.values()) {
        local.saving?.clear(); // Retired host bindings cannot deliver their ACKs.
        if (!local.pendingClear) issue(local);
      }
    }
    if(message.type==='thoughtforge.r7.copy.result') {
      const effect=copyEffects.get(message.effectId);
      if(effect && effect.mount===mountEpoch && effect.consumer===controller){
        if(message.ok&&typeof message.copyToken==='string'&&committed)structuralCopy={effectId:message.effectId,token:message.copyToken,hash:committed.contentHash,acked:false};
        else if(message.reason!=='copy-not-eligible'&&message.reason!=='note-mode-deferred')say(r7Reason(message.reason??'copy-expired'),'error');
      }return true;
    }
    if(message.type==='thoughtforge.r7.read.result') {
      const p=pasteAttempt;if(!p||p.id!==message.requestId)return true;clearPasteWait();
      if(!message.ok||p.signature!==pasteSignature()){pending.delete(p.id);pasteAttempt=undefined;say(r7Reason(message.reason??'stale'),'error');commandContextChanged();return true;}
      const request={command:structuredClone(message.command),hash:p.hash,intentSeq:nextSeq(),drafts:[]};pending.set(p.id,request);p.sent=true;
      if(!send({source:'webview',protocolVersion:2,documentUri:committed?.documentUri,type:'thoughtforge.command',requestId:p.id,command:message.command,guard:message.guard}))cancelPaste();
      commandContextChanged();return true;
    }
    if (message.type === 'thoughtforge.model.update') { if(structuralCopy&&message.contentHash!==structuralCopy.hash)structuralCopy=undefined; if(pasteAttempt&&!(message.cause?.kind==='applied'&&message.cause.requestId===pasteAttempt.id)&&(message.contentHash!==pasteAttempt.hash||message.writeState!=='ready'))cancelPaste(); if(parentInput?.active && (message.contentHash!==parentInput.hash || message.writeState!=='ready'))cancelParent(); model(message); return true; }
    if (message.type === 'thoughtforge.command.result' || message.type === 'thoughtforge.history.result') {
      if (!pending.has(message.requestId)) return true;
      if(pasteAttempt?.id===message.requestId)pasteAttempt=undefined;
      if(message.type==='thoughtforge.command.result'&&['applied','rejected'].includes(message.status))settleParent(message.requestId,message.status==='applied',message.code??message.reason);
      if (message.type === 'thoughtforge.command.result' && !['applied', 'rejected'].includes(message.status)) {
        // Release an insert's internal wait without claiming success/failure or notifying.
        cleanupInsert(message.requestId, pending.get(message.requestId)?.command);
        pending.delete(message.requestId); waiting.delete(message.requestId); results.delete(message.requestId); commandContextChanged();
        setTimeout(drain, 0);
        return true;
      }
      if (message.status === 'applied') {
        results.set(message.requestId, structuredClone(message)); transient = undefined;
        historyStale = true; // its history state follows
        if (message.type === 'thoughtforge.command.result') forward({ ...message, documentUri: shellUri ?? message.documentUri, protocolVersion: 1 });
        const buffered = waiting.get(message.requestId); if (buffered) { waiting.delete(message.requestId); model(buffered); }
      } else {
        const intent = pending.get(message.requestId), command = intent?.command;
        // A rejected rename no longer shows its unsaved title (the recovery input keeps the text).
        if (forgetRenameRequest(message.requestId)) redrawSaved(modelCount);
        const created = command && (/^node\.(insertChild|insertSibling)$/.test(command.type) ? command.nodeId : command.nextNodeId);
        if (created && intent?.hash && state().pendingOptimisticNodes?.has(created)) failedInsert.set(created, { command: structuredClone(command), hash: intent.hash });
        if (cleanupInsert(message.requestId, command)) {
          topicFailure = `トピックを保存できませんでした（${message.reason ?? message.status}）。入力を保持しています。`; say(topicFailure); raw.restore(); renderNotice();
        } else if (message.type === 'thoughtforge.command.result') rejectLocal(message, (command?.type==='node.pasteSubtreeAsLastChild'||message.code==='request-limit')?r7Reason(message.code??message.reason??message.status):`操作を保存できませんでした（${message.reason ?? message.status}）。入力は保持しています。`);
        else say(`Undo/Redoを実行できませんでした（${message.status}）`, 'error');
        pending.delete(message.requestId); waiting.delete(message.requestId);
        setTimeout(drain, 0);
        if (command?.type === 'node.delete' && message.code === 'needs-confirmation' && intent?.hash && intent.intentSeq !== undefined && currentDeleteIntent(intent) &&
          !pending.size && !deferred.length && !flushTimer && !navigation && !isComposing()) {
          const summary = message.detail?.unmappedSummary ?? [];
          const detail = summary.map((b: any) => `${b.kind}: ${b.lines}行`).join('、');
          transient = undefined;
          deleteConfirmation = { command: structuredClone(command), hash: intent.hash, intentSeq: intent.intentSeq, requestId: message.requestId, detail };
        }
      }
      syncActions();
      return true;
    }
    if (message.type === 'thoughtforge.history.state') {
      history = message; historyStale = false; updateUI(); if (message.invalidatedReason) say('地図のUndo履歴を消去しました。');
      drain();
      return true;
    }
    if (message.type === 'thoughtforge.draft.save.result') {
      const local = locals.get(message.draftId);
      const issued = local?.saving?.delete(message.revision);
      if (local && issued && message.ok === true) {
        local.saved = Math.max(local.saved, message.revision);
        if (local.failedRevision !== undefined && local.failedRevision <= local.saved) { local.failedRevision = undefined; local.failedReason = undefined; }
      }
      navigation?.gate.accept(message);
      if (local && issued && message.ok !== true && message.revision > local.saved) {
        local.failedRevision = Math.max(local.failedRevision ?? -1, message.revision); local.failedReason = message.reason;
        if (![...local.saving ?? []].some(revision => revision > message.revision)) {
          navFailed = true; cancelNavigation(); lastFailure = failure(message.reason); lastFailureReason = message.reason; say(lastFailure);
        }
      } else if (local && issued && message.ok === true && ![...locals.values()].some(d => d.failedRevision !== undefined)) {
        navFailed = false; lastFailure = undefined; lastFailureReason = undefined;
        say(local.saved >= local.revision ? 'この下書きの保存を確認しました。ノートへの適用は別の操作です。' : '前の入力の保存を確認しました。現在の入力は未保存です。');
      }
      renderNotice(); return true;
    }
    if (message.type === 'thoughtforge.draft.restore') {
      const restoredIds = new Set(message.drafts.map((d: RestoredDraft) => d.draftId));
      for (const [id, local] of locals) if (local.pendingClear && !restoredIds.has(id)) { locals.delete(id); if (byTarget.get(local.key) === id) byTarget.delete(local.key); }
      for (const draft of message.drafts as RestoredDraft[]) {
        const existing = locals.get(draft.draftId); if (existing && existing.revision >= draft.revision) continue;
        locals.set(draft.draftId, { ...draft, target: structuredClone(draft.target), key: targetKey(draft.target, draft.draftId), saved: draft.revision, sent: draft.revision, detached: true, restored: draft });
        // Only input left by an earlier session is announced, once per view.
        // The host's automatic restore already omits expired drafts (contract 12.1). An expired draft arrives only when
        // the user opened this map from the remaining-drafts list, so it is announced and can be discarded here.
        if (!existing) noticeDrafts.add(draft.draftId);
      }
      pruneBindings();
      renderNotice(); return true;
    }
    if (message.type === 'thoughtforge.link.open.result') { if (message.status !== 'opened') say(message.status === 'unresolved' ? 'まだないノートです。ノートは作成しません。' : 'このリンクは開けません。', 'error'); return true; }
    return false;
  };
  const button = (label: string, action: (event: MouseEvent) => void) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', action); return b; };
  const isComposing = () => !!state().isComposingText || ['composing', 'committing'].includes(state().directEditSession?.phase);
  const retryable = (local: Local) => local.failedRevision !== undefined && local.failedRevision > local.saved && !local.pendingClear &&
    ![...local.saving ?? []].some(revision => revision > local.failedRevision!);
  const retrySaves = () => {
    if (navigation || isComposing()) return;
    captureAll(); for (const local of locals.values()) if (retryable(local) && issue(local)) { if (!permissionBlocked && committed?.writeState === 'ready') local.permissionRetired = false; save(local); }
    renderNotice();
  };
  const createdId = (command: any) => command && (/^node\.(insertChild|insertSibling)$/.test(command.type) ? command.nodeId : command.nextNodeId);
  const failedTopics = () => [...failedInsert.keys()].filter(id => state().pendingOptimisticNodes?.has(id) && !committed?.map?.nodesById[id]);
  const canDiscardOptimistic = (id: string) => {
    const s = state(), meta = s.pendingOptimisticNodes?.get(id), node = s.map?.nodesById[id];
    if (!meta || meta.nodeId !== id || committed?.map?.nodesById[id] || !node || node.id !== id ||
      !Array.isArray(node.children) || node.children.length || !controller?.clearDraft || !controller.removeDraft) return false;
    if ([...pending.values(), ...deferred.flatMap(d => 'message' in d ? [d.message] : [])].some(p => createdId(p.command) === id)) { say('トピックの作成結果を確認するまで捨てられません。入力は保持しています。', 'error'); return false; }
    // clearDraft recursively removes queued children, so a parent with uncreated children is kept.
    if ([...s.pendingOptimisticNodes.values()].some(child => child.nodeId !== id && [child.parentId, child.siblingId, child.dependsOnNodeId].includes(id)) ||
      (s.queuedOptimisticCommands?.get(id) ?? []).some(({ command }: any) => createdId(command) && createdId(command) !== id)) {
      say('この入力に続く未作成のトピックがあるため捨てられません。入力は保持しています。', 'error'); return false;
    }
    return true;
  };
  // Uncreated topics that depend on a failed one (children, siblings, queued creates), leaf first.
  // Built from the metadata and the current map children, so topics moved under a failed parent are included.
  // Queued moves are not counted: a moved-back topic leaves only a stale intent, which is dropped with the parent.
  const uncreatedTree = (root: string) => {
    const s = state(), order: string[] = [], seen = new Set<string>(); let blocked = false;
    const visit = (id: string) => {
      if (seen.has(id)) return; seen.add(id);
      if (committed?.map?.nodesById[id] || !s.pendingOptimisticNodes?.has(id)) { blocked = true; return; } // an existing topic is never discarded
      const children = new Set<string>(s.map?.nodesById[id]?.children ?? []);
      for (const meta of s.pendingOptimisticNodes?.values() ?? []) if (meta.nodeId !== id && [meta.parentId, meta.siblingId, meta.dependsOnNodeId].includes(id)) children.add(meta.nodeId);
      for (const child of children) visit(child);
      order.push(id);
    };
    visit(root); return { order, blocked };
  };
  const currentParent = (id: string): string | null => {
    const map = state().map; if (!map || map.roots?.includes(id)) return null;
    return Object.keys(map.nodesById).find(key => map.nodesById[key]?.children?.includes(id)) ?? null;
  };
  const discardUncreated = (id: string) => {
    // The topic may have moved since it was created: detach it from where it is now, not its creation parent.
    const parent = currentParent(id);
    controller!.clearDraft!(id); if (state().map?.nodesById[id]) controller!.removeDraft!(state().map, id, parent);
    for (const commands of state().queuedOptimisticCommands?.values() ?? []) for (let i = commands.length - 1; i >= 0; i--) {
      const entry = commands[i], command = entry.command; if ([command.nodeId, command.parentId, command.nextParentId, command.siblingId].includes(id)) { forgetRenameRequest(entry.requestId); commands.splice(i, 1); }
    }
    state().pendingOptimisticNodes?.delete(id); state().queuedOptimisticCommands?.delete(id); state().draftNodeIds?.delete(id); failedInsert.delete(id); raw.discardNode(id);
    for (const local of locals.values()) if (local.target.kind === 'pending-child' && local.inputId === id && !local.pendingClear) clear(local);
    for (let i = deferred.length - 1; i >= 0; i--) { const c = (deferred[i] as any).message?.command; if (c && [createdId(c), c.nodeId, c.parentId, c.nextParentId, c.siblingId].includes(id)) { forgetRenameRequest((deferred[i] as any).message.requestId); deferred.splice(i, 1); } }
    for (const key of ['selectedNodeId', 'editingNodeId', 'pendingFocusNodeId']) if (state()[key] === id) state()[key] = undefined;
    if (state().directEditSession?.nodeId === id) { state().directEditSession = undefined; state().isComposingText = false; state().directKeyQueue = []; }
  };
  // Closing the failed-topic notice discards that uncreated input and the uncreated topics that depend on it.
  // The line states the count first; nothing in flight is discarded (2026-10-06 decision, no confirmation).
  const discardFailedTopics = () => {
    if (isComposing() || !controller?.clearDraft || !controller.removeDraft) return;
    captureAll(); transient = undefined; // a refusal below re-reports its own reason
    for (const root of failedTopics()) {
      if (!state().pendingOptimisticNodes?.has(root)) continue; // already discarded as part of another failed tree
      const { order, blocked } = uncreatedTree(root);
      if (blocked) { say('既にあるトピックが中に入っているため捨てられません。移動してから閉じてください。入力は保持しています。', 'error'); continue; }
      if (order.some(id => [...pending.values()].some(p => createdId(p.command) === id))) { say('トピックの作成結果を確認するまで捨てられません。入力は保持しています。', 'error'); continue; }
      for (const id of order) if (state().pendingOptimisticNodes?.has(id)) discardUncreated(id);
    }
    if (!failedTopics().length) topicFailure = undefined;
    controller?.render(); renderNotice();
  };
  const retryFailedTopics = () => {
    if (isComposing()) return;
    transient = undefined;
    for (const id of failedTopics()) {
      if ([...pending.values(), ...deferred.flatMap(d => 'message' in d ? [d.message] : [])].some(p => createdId(p.command) === id)) continue; // a retry is already in flight or waiting (e.g. a held Enter)
      const failed = failedInsert.get(id)!;
      if (committed?.contentHash !== failed.hash || committed.writeState !== 'ready') { say('ノートが変わったため作成を再試行できません。閉じると未作成の入力を捨てます。', 'error'); continue; }
      controller?.postCommand(failed.command);
    }
    renderNotice();
  };
  const retryClears = () => { for (const local of locals.values()) if (local.pendingClear) clear(local); };
  // Closing the previous-session notice discards those drafts (decision D-11=B, 2026-10-06).
  const discardPreviousInput = () => {
    if ([...noticeDrafts].some(id => locals.get(id)?.saving?.size)) return; // wait for the save ACK; close is disabled meanwhile
    for (const id of noticeDrafts) { const local = locals.get(id); if (local && !local.pendingClear) clear(local); }
    noticeDrafts.clear(); renderNotice();
  };
  const copyFailedInput = () => {
    const texts = [...locals.values()].filter(local => local.failedRevision !== undefined && local.failedRevision > local.saved && !local.pendingClear).map(local => local.text);
    if (!texts.length || !committed) return;
    send({ source: 'webview', protocolVersion: 2, type: 'thoughtforge.clipboard.write', documentUri: committed.documentUri, text: texts.join('\n'), format: 'text', scope: 'node', nodeId: 'center' });
  };
  const previewOf = (text: string) => { const line = text.replace(/\s+/g, ' ').trim(); return line.length > 30 ? `${line.slice(0, 30)}…` : line || '（空の入力）'; };
  const renderNotice = () => {
    if (!notice || !noticeText) return;
    if (deleteConfirmation && !currentDeleteIntent(deleteConfirmation)) { deleteConfirmation = undefined; commandContextChanged(); }
    for (const id of noticeDrafts) { const local = locals.get(id); if (!local || local.pendingClear) noticeDrafts.delete(id); }
    const clearFailed = [...locals.values()].some(local => local.pendingClear && (local.clearFailed || performance.now() - (local.clearSentAt ?? 0) >= CLEAR_CONFIRM_MS));
    const failedLocals = [...locals.values()].filter(local => local.failedRevision !== undefined && local.failedRevision > local.saved && !local.pendingClear);
    if (navFailed && !failedLocals.length && ![...locals.values()].some(local => !local.pendingClear && local.saved < local.revision)) navFailed = false;
    const saveFailed = failedLocals.length > 0 || navFailed;
    if (!saveFailed) { lastFailure = undefined; lastFailureReason = undefined; }
    const topics = failedTopics(); if (!topics.length) topicFailure = undefined;
    const previous = [...noticeDrafts].map(id => locals.get(id)!).filter(Boolean);
    const previousSaving = previous.some(local => local.saving?.size);
    let kind = '', text = '', retry: (() => void) | undefined, copy: (() => void) | undefined, close: (() => void) | undefined;
    const deletion = deleteConfirmation;
    if (deletion) {
      kind = 'delete-confirm'; text = `未対応の本文を含む枝を削除しますか？ ${deletion.detail}。Markdownで内容を確認してから削除できます。`;
    } else if (saveFailed) {
      // Guidance follows the drafts that are still failing, not whichever failure arrived last.
      const reasons = failedLocals.map(local => local.failedReason);
      const reason = reasons.includes('draft-limit-count') ? 'draft-limit-count' : reasons.find(Boolean) ?? (failedLocals.length ? undefined : lastFailureReason);
      kind = 'save-failed'; text = failedLocals.length ? failure(reason) : lastFailure ?? failure(lastFailureReason);
      const resendClears = clearFailed;
      if (failedLocals.some(retryable) || resendClears) retry = () => { if (resendClears) retryClears(); retrySaves(); };
      if (failedLocals.length) copy = copyFailedInput;
      if (resendClears) text += '（破棄の送り直しも行います）';
      if (reason === 'draft-limit-count' && previous.length) { text += `（前回の入力${previous.length}件を×で破棄すると保存できます）`; close = discardPreviousInput; }
      else if (!failedLocals.length) close = () => { navFailed = false; renderNotice(); };
    } else if (clearFailed) { kind = 'clear-failed'; text = '入力の破棄を完了できませんでした。移動は止めています。'; retry = retryClears; }
    else if (topics.length) {
      const count = new Set(topics.flatMap(id => uncreatedTree(id).order)).size;
      kind = 'topic-failed'; retry = retryFailedTopics; close = discardFailedTopics;
      text = `${topicFailure ?? 'トピックを保存できませんでした。入力を保持しています。'}閉じると未作成の入力${count}件${count > 1 ? '（続きのトピックを含む）' : ''}を破棄します。${transient ? ` ${transient}` : ''}`;
    } else if (transient) { kind = 'error'; text = transient; close = () => { transient = undefined; renderNotice(); }; }
    else if (previous.length) {
      kind = 'previous-input'; close = discardPreviousInput;
      text = `前回、保存できなかった入力が${previous.length}件あります：「${previewOf(previous[0]!.text)}」（閉じると破棄します）`;
    }
    const wasFocused = !!doc.activeElement && notice.contains(doc.activeElement);
    noticeGeneration = JSON.stringify([kind, text, deletion?.requestId, [...noticeDrafts], topics.map(id => uncreatedTree(id).order), !!retry, !!copy, !!close]);
    notice.hidden = !kind; notice.dataset.thoughtforgeNoticeKind = kind; noticeText.textContent = text;
    notice.setAttribute('aria-label', deletion ? '枝の削除確認' : '保存の知らせ');
    // Buttons belong to one visible line. A new line gets new buttons, so a press that began on the old line
    // (pointer, Enter, Space or a held key) can never act on the new one; the old buttons do nothing.
    if (noticeGeneration !== builtGeneration) {
      builtGeneration = noticeGeneration;
      for (const b of noticeButtons) b.remove();
      const gen = noticeGeneration, make = (label: string, act: () => void, aria?: string) => {
        const b = button(label, () => { if (gen === noticeGeneration && b.isConnected && !b.disabled) act(); });
        if (aria) b.setAttribute('aria-label', aria); return b;
      };
      noticeButtons = deletion ? [make('削除する', () => confirmDelete(deletion)), make('やめる', cancelDeleteConfirmation)]
        : [...(retry ? [make('再試行', retry)] : []), ...(copy ? [make('コピー', copy)] : []), ...(close ? [make('×', close, '閉じる')] : [])];
      if (deletion) for (const b of noticeButtons) b.setAttribute('aria-describedby', 'thoughtforge-notice-text');
      notice.append(...noticeButtons);
      // Confirmation starts on the safe action; other new lines never focus a destructive action.
      if (deletion) noticeButtons[1]?.focus();
      else if (wasFocused) status?.focus();
    }
    for (const b of noticeButtons) b.disabled = b.textContent === '再試行' ? !!navigation || isComposing() : b.textContent === '×' ? isComposing() || kind === 'previous-input' && previousSaving : false;
    // Announce only when the visible line changes, not on every autosave tick.
    if (text !== announced && status) { status.textContent = text; latestStatus = text; }
    announced = text;
  };
  const syncActions = () => { commandContextChanged(); renderNotice(); };
  const updateUI = (notify = true) => {
    if (notify) commandContextChanged();
    if (undo) undo.disabled = !history.canUndo || committed?.writeState !== 'ready';
    if (redo) redo.disabled = !history.canRedo || committed?.writeState !== 'ready';
    renderNotice();
  };
  const pasteEscape = (e: KeyboardEvent) => {if(active&&pasteAttempt&&e.key==='Escape'&&!e.isComposing&&!isComposing()){e.preventDefault();e.stopImmediatePropagation();cancelPaste();commandContextChanged();}};
  const mount = () => {
    if (notice || !doc.body) return;
    doc.addEventListener('keydown',pasteEscape,true);
    doc.body.setAttribute('data-thoughtforge-v2-layout', '');
    const style = doc.createElement('style'); style.textContent = `
      body[data-thoughtforge-v2-layout]{display:flex;flex-direction:column;height:100vh;overflow:hidden}
      body[data-thoughtforge-v2-layout]>.thoughtforge-shell{flex:1;min-height:0;height:auto}
      body[data-thoughtforge-v2-layout]>#thoughtforge-poc-readonly{flex-shrink:0;max-height:20vh;overflow:auto;box-sizing:border-box}
      #thoughtforge-notice{flex-shrink:0;display:flex;align-items:center;gap:8px;padding:6px 10px;box-sizing:border-box;font:13px/1.4 sans-serif;color:var(--vscode-foreground,#1f2328);background:var(--vscode-inputValidation-warningBackground,#fff4e5);border-bottom:1px solid var(--vscode-inputValidation-warningBorder,#d4a72c)}
      #thoughtforge-notice[hidden]{display:none}
      #thoughtforge-notice[data-thoughtforge-notice-kind=previous-input]{background:var(--vscode-inputValidation-infoBackground,#eaf2ff);border-bottom-color:var(--vscode-inputValidation-infoBorder,#4a7bd0)}
      #thoughtforge-notice p{margin:0;flex:1;min-width:0}
      #thoughtforge-status{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
      .thoughtforge-history-button{min-width:28px}
    `;
    notice = doc.createElement('section'); notice.id = 'thoughtforge-notice'; notice.dataset.thoughtforgeNotice = 'true'; notice.hidden = true;
    notice.setAttribute('data-thoughtforge-recovery', 'true'); // stays operable while the edit gate makes the map inert
    notice.setAttribute('aria-label', '保存の知らせ');
    for (const type of ['keydown', 'keyup', 'keypress']) notice.addEventListener(type, event => event.stopPropagation());
    noticeText = doc.createElement('p'); noticeText.id = 'thoughtforge-notice-text';
    // An action runs only for the notice that was shown when the press started; a switch in between cancels it.
    notice.append(noticeText);
    status = doc.createElement('p'); status.id = 'thoughtforge-status'; status.setAttribute('role', 'status'); status.tabIndex = -1; status.textContent = latestStatus;
    status.setAttribute('data-thoughtforge-recovery', 'true');
    // Focus can rest here after the notice changes; keys from here never reach the map shortcuts (native Tab still moves focus).
    for (const type of ['keydown', 'keyup', 'keypress']) status.addEventListener(type, event => event.stopPropagation());
    undo = button('↶', () => localMapCommand('map-undo')); undo.setAttribute('aria-label', '地図のUndo'); undo.title = '地図のUndo（⌘Z）'; undo.className = 'thoughtforge-history-button';
    redo = button('↷', () => localMapCommand('map-redo')); redo.setAttribute('aria-label', '地図のRedo'); redo.title = '地図のRedo（⇧⌘Z）'; redo.className = 'thoughtforge-history-button';
    // Keys on these buttons keep their native click/Tab behavior but never reach the map shortcuts.
    for (const b of [undo, redo]) for (const type of ['keydown', 'keyup', 'keypress']) b.addEventListener(type, event => event.stopPropagation());
    const toolbar = doc.querySelectorAll('[data-thoughtforge-map-zoom-toolbar]')[0];
    if (toolbar) toolbar.append(undo, redo);
    else { const own = doc.createElement('div'); own.setAttribute('role', 'toolbar'); own.setAttribute('aria-label', '地図のUndo/Redo'); own.append(undo, redo); doc.body.prepend(own); }
    doc.body.prepend(notice); doc.body.append(style, status); updateUI(false);
    timer = setTimeout(autosave, 500);
    // Only a fresh press begun in this confirmation may operate it. Keep old phases
    // isolated after it closes, including when another confirmation replaces it.
    const confirmationKeys = new Map<string, NonNullable<typeof deleteConfirmation>>();
    doc.defaultView?.addEventListener('blur', () => confirmationKeys.clear());
    doc.addEventListener('focusout', event => {
      if (!event.relatedTarget && !doc.hasFocus()) confirmationKeys.clear();
    }, true);
    for (const type of ['keypress', 'keyup'] as const) doc.addEventListener(type, event => {
      const press = event.code || event.key;
      const owner = confirmationKeys.get(press);
      if (type === 'keyup') confirmationKeys.delete(press);
      if (!owner && !deleteConfirmation) return;
      if (owner !== deleteConfirmation || !notice?.contains(event.target as Node)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    doc.addEventListener('keydown', event => {
      const press = event.code || event.key;
      if (event.repeat) {
        const owner = confirmationKeys.get(press);
        if ((owner || deleteConfirmation) && (owner !== deleteConfirmation || !notice?.contains(event.target as Node))) {
          event.preventDefault(); event.stopImmediatePropagation(); return;
        }
      } else confirmationKeys.delete(press); // A fresh press recovers even if the host lost the old key-up.
      if (!deleteConfirmation) return;
      if (!event.repeat) confirmationKeys.set(press, deleteConfirmation);
      if (event.key === 'Escape' || !notice?.contains(event.target as Node)) {
        event.preventDefault(); event.stopImmediatePropagation(); cancelDeleteConfirmation();
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopImmediatePropagation();
        const index = noticeButtons.findIndex(b => b === doc.activeElement);
        noticeButtons[index < 0 ? 1 : (index + (event.shiftKey ? -1 : 1) + noticeButtons.length) % noticeButtons.length]?.focus();
        return;
      }
    }, true);
    doc.addEventListener('pointerdown', event => { if (!notice?.contains(event.target as Node)) cancelDeleteConfirmation(); }, true);
    doc.addEventListener('input', e => {
      captureInput(e.target, true);
      const input = e.target;
      if (e.isTrusted && !permissionBlocked && committed?.writeState === 'ready' && input instanceof Element && input.isConnected &&
        (/^(insertText|insertFromPaste|deleteContentBackward|deleteContentForward)$/.test((e as InputEvent).inputType) || permissionCompositions.has(input))) {
        const local = locals.get(inputBinding(input)?.draftId ?? ''); if (local) local.permissionRetired = false;
      }
    }, true);
    doc.addEventListener('compositionend', e => {
      commandContextChanged();
      captureInput(e.target, true); const target = e.target, epoch = raw.epoch();
      const element = target instanceof HTMLElement ? target : undefined, owner = element?.dataset.nodeId, binding = element && inputBinding(element);
      setTimeout(() => { if (active && raw.epoch() === epoch && element?.dataset.nodeId === owner && element && inputBinding(element) === binding) captureInput(target, true); syncActions(); }, 0);
    }, true);
    doc.addEventListener('focusin', e => captureInput(e.target), true);
    doc.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-thoughtforge-wiki-link-title]') : null;
      if (!link || !committed) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const nodeId=link.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId ?? state().selectedNodeId ?? centerId;
      const linkTitle=link.dataset.thoughtforgeWikiLinkTitle!,openIn=event.metaKey || event.ctrlKey ? 'new-tab' : 'same-tab';
      if(transport)controller?.dispatchMapCommand?.('map-open-selected-link',false,{nodeId,linkTitle,openIn});
      else mapCommandLink(linkTitle,nodeId,openIn);
    }, true);
    doc.addEventListener('click', () => setTimeout(() => updateUI(false), 0));
  };
  return { post, receive, captureInput, captureAll, navigate, cancelNavigation, history: historyRequest,
    mapCommandGate, mapCommandAvailability, commandContextChanged, allocateCopyEffect, clipboardResult, executeMapCommand, localMapCommand, mapCommandLink, insertParent, parentCommand, pasteBranch,
    mapCommandConnected() { commandConnected = true; commandContextChanged(); },
    commandRegistry: () => commandRegistry,
    beginComposition(input: EventTarget | null) { cancelDeleteConfirmation(); if (input instanceof Element) { retiredCompositions.delete(input); composingInputs.add(input); if (!permissionBlocked && committed?.writeState === 'ready') permissionCompositions.add(input); syncActions(); } },
    bindRenderer(getter: () => State, apply: (message: any) => void, api?: Controller) {
      if (mountEpoch >= Number.MAX_SAFE_INTEGER) { commandConnected = false; return () => {}; }
      cancelParent();cancelPaste();structuralCopy=undefined; mountEpoch++; externalCopyId = undefined; copyEffects.clear(); cancelNavigation();
      state = getter; controller = api; raw.bindRenderer(getter, apply);
      send({source:'webview',protocolVersion:2,documentUri:committed?.documentUri??shellUri,type:'thoughtforge.r7.mount',requestId:`r7-mount:${viewId}:${mountEpoch}`,mountEpoch});
      commandContextChanged();
      // Retire this mount's command work; captured draft autosave retains its
      // existing lifetime until the adapter itself closes.
      const owner = api;
      return () => { if (controller !== owner) return; cancelPaste();structuralCopy=undefined;controller = undefined; externalCopyId = undefined; copyEffects.clear(); cancelNavigation();
        commandContextChanged(); publishCommandState(); queuedFlushes.clear(); deferred.length = 0; };
    },
    beforeModelUpdate: beforeModel, afterModelUpdate: afterModel, reconcileMap, updateUI,
    keepSelectionEmpty: () => selectionCleared && !state().selectedNodeId,
    mount, close() { if(!active)return;cancelPaste();cancelParent();showParentRecovery(true); for(const p of parentPanels)p.panel.remove();parentPanels.length=0;parentInput=undefined;doc.removeEventListener('keydown',pasteEscape,true); active = false; commandContextChanged(); publishCommandState(); state().pendingRenames?.clear(); bindings.clear(); inputBindings = new WeakMap(); copyEffects.clear(); cancelDeleteConfirmation(); cancelNavigation(); if (timer) clearTimeout(timer); if (flushTimer) clearTimeout(flushTimer); if (imeReleaseTimer) clearTimeout(imeReleaseTimer); },
    snapshot: () => ({ committed: committed && structuredClone(committed), drafts: [...locals.values()].map(d => structuredClone(d)), navigation: !!navigation, navFailed }) };
}
