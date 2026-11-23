import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { getThemePalette, type ResolvedThemeMode } from '../core/layout/theme';
import { computeLayout } from '../core/layout/treeLayout';
import type {
  CameraState,
  DraftEntry,
  FocusMode,
  LayoutBounds,
  MindMapDocument,
  ParseResult,
  PluginSettings,
  StructuredFilterCriteria,
  TopicLink,
  TopicNode,
} from '../core/model';
import type { SemanticCommand } from '../core/patch/commands';
import {
  computeDepthCollapsedIds,
  computeVisibilityAndEmphasis,
  hasActiveStructuredFilter,
} from '../core/view/filterFocus';
import { resolveArrowNavigation, type ArrowDirection } from '../core/view/navigation';
import {
  collectDocumentTags,
  computeDocumentTextStats,
  computeSubtreeBounds,
  computeTopicNumbering,
} from '../core/view/topicPresentation';
import {
  createDocumentRemapIndex,
  type DocumentRemapIndex,
} from '../core/view/viewStateRemap';
import type { Messages } from '../i18n';
import {
  resolveDraftTarget,
  type DraftResolution,
  type SaveDraftInput,
  type SaveDraftResult,
} from '../sync/DraftStore';
import type { CommandDispatchOutcome } from '../sync/ports';
import {
  buildCommitRenameCommand,
  buildPatchGuard,
  buildSplitSiblingCommand,
  buildUpdateNoteCommand,
  createEditingSession,
  isEditingSessionValid,
  isNoteEditingSessionValid,
  type EditingSession,
  type NoteEditingSession,
} from './editSession';
import type { GuardableKeyEvent } from './imeGuard';
import { shouldIgnoreCanvasKeyEvent } from './keyboardGuard';
import { NodePopover } from './NodePopover';
import { QuickStylePopover } from './QuickStylePopover';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import {
  clampZoom,
  ViewportCanvas,
  type ViewportSize,
} from './ViewportCanvas';

export interface MindMapActionTriggers {
  readonly editSelected: () => boolean;
  readonly splitEditing: (event: GuardableKeyEvent) => boolean;
  readonly commitNoteEdit: (event: GuardableKeyEvent) => boolean;
  readonly editSelectedNote: () => boolean;
  readonly copySelectedBranch: () => boolean;
  readonly cutSelectedBranch: () => boolean;
  readonly pasteBranch: () => boolean;
  readonly undo: () => boolean;
  readonly redo: () => boolean;
  readonly toggleSelectedTask: () => boolean;
  readonly fitSelection: () => boolean;
}

export interface MindMapAppProps {
  readonly filePath: string;
  readonly parseResult: ParseResult;
  readonly themeMode: ResolvedThemeMode;
  readonly settings: PluginSettings;
  readonly messages: Messages;
  readonly drafts?: readonly DraftEntry[];
  readonly unpersistedDraftIds?: ReadonlySet<string>;
  readonly onSaveDraft?: (input: SaveDraftInput) => Promise<SaveDraftResult>;
  readonly onDeleteDraft?: (draftId: string) => Promise<void>;
  readonly onDeleteMatchingDraft?: (
    filePath: string,
    field: 'title' | 'note',
    targetTitleRaw: string,
    targetHeaderLine: number,
    targetAncestorPath?: readonly string[],
    targetOwnRangeHash?: string,
    baseContentHash?: string,
    targetHadIdenticalSibling?: boolean,
  ) => Promise<void>;
  readonly onCopyBranchSubtree?: (node: TopicNode) => Promise<boolean>;
  readonly onReadBranchClipboard?: () => Promise<string | null>;
  readonly onOpenMarkdown: (line?: number) => void;
  readonly onOpenLink: (link: TopicLink, newTab: boolean) => void;
  readonly onUpdateSettings?: (patch: Partial<PluginSettings>) => void;
  readonly onDispatchCommand?: (
    command: SemanticCommand,
    expectedFilePath?: string,
  ) => Promise<CommandDispatchOutcome>;
  readonly onUndo?: () => Promise<CommandDispatchOutcome>;
  readonly onRedo?: () => Promise<CommandDispatchOutcome>;
  readonly onRegisterActionTriggers?: (triggers: MindMapActionTriggers | null) => void;
  readonly onNotify?: (message: string) => void;
}

function computeFitCamera(bounds: LayoutBounds, size: ViewportSize): CameraState {
  const padding = Math.max(16, Math.min(40, Math.round(Math.min(size.width, size.height) * 0.06)));
  const contentW = Math.max(1, bounds.maxX - bounds.minX);
  const contentH = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(80, size.width - padding * 2);
  const availH = Math.max(80, size.height - padding * 2);
  const zoom = clampZoom(Math.min(availW / contentW, availH / contentH, 1.15));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: size.width / 2 - centerX * zoom,
    y: size.height / 2 - centerY * zoom,
    zoom,
  };
}

export function MindMapApp({
  filePath,
  parseResult,
  themeMode,
  settings,
  messages,
  drafts = [],
  unpersistedDraftIds,
  onSaveDraft,
  onDeleteDraft,
  onDeleteMatchingDraft,
  onCopyBranchSubtree,
  onReadBranchClipboard,
  onOpenMarkdown,
  onOpenLink,
  onUpdateSettings,
  onDispatchCommand,
  onUndo,
  onRedo,
  onRegisterActionTriggers,
  onNotify,
}: MindMapAppProps) {
  const palette = useMemo(() => getThemePalette(themeMode), [themeMode]);

  const doc = parseResult.status === 'ok' ? parseResult.document : null;

  const [selectionState, setSelectionState] = useState<{
    readonly filePath: string;
    readonly doc: MindMapDocument | null;
    readonly nodeId: string | null;
    readonly unresolved: boolean;
  }>(() => ({
    filePath,
    doc,
    nodeId: doc?.rootId ?? null,
    unresolved: false,
  }));
  const [editingSession, setEditingSession] = useState<EditingSession | null>(null);
  const [baseCollapsedIds, setBaseCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [userOpenedDuringFilterIds, setUserOpenedDuringFilterIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [focusMode, setFocusMode] = useState<FocusMode>({ kind: 'off' });
  const [filterQuery, setFilterQuery] = useState('');
  const [structuredFilter, setStructuredFilter] = useState<StructuredFilterCriteria>({});
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [noteEditRequestToken, setNoteEditRequestToken] = useState(0);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [camera, setCamera] = useState<CameraState>({ x: 480, y: 320, zoom: 1 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const docRef = useRef(doc);
  docRef.current = doc;
  const editingSessionRef = useRef(editingSession);
  editingSessionRef.current = editingSession;
  const viewportSizeRef = useRef<ViewportSize>({ width: 960, height: 640 });
  const hasInitialFitRef = useRef(false);
  const prevLayoutModeRef = useRef(settings.layoutMode);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const inlineSplitTriggerRef = useRef<((event: GuardableKeyEvent) => boolean) | null>(null);
  const noteCommitTriggerRef = useRef<((event: GuardableKeyEvent) => boolean) | null>(null);
  const isCommandInFlightRef = useRef(false);
  const prevDocStateRef = useRef<{ readonly filePath: string; readonly doc: MindMapDocument } | null>(
    doc ? { filePath, doc } : null,
  );
  const lastRemapIndexRef = useRef<DocumentRemapIndex | null>(null);

  const getRemapIndex = useCallback(
    (beforeDoc: MindMapDocument, afterDoc: MindMapDocument): DocumentRemapIndex => {
      const cached = lastRemapIndexRef.current;
      if (cached && cached.beforeDoc === beforeDoc && cached.afterDoc === afterDoc) {
        return cached;
      }
      const created = createDocumentRemapIndex(beforeDoc, afterDoc);
      lastRemapIndexRef.current = created;
      return created;
    },
    [],
  );

  const selectNode = useCallback(
    (nodeId: string | null, targetDoc?: MindMapDocument | null, targetFilePath?: string): void => {
      setSelectionState({
        filePath: targetFilePath ?? filePathRef.current,
        doc: targetDoc !== undefined ? targetDoc : docRef.current,
        nodeId,
        unresolved: false,
      });
    },
    [],
  );

  const syncViewStateForNextDoc = useCallback(
    (
      nextFilePath: string,
      nextDoc: MindMapDocument,
      expandNodeId?: string,
      expandBeforeNodeId?: string,
      explicitSelectedNodeId?: string,
    ): void => {
      const prev = prevDocStateRef.current;
      prevDocStateRef.current = { filePath: nextFilePath, doc: nextDoc };

      if (prev !== null && prev.filePath === nextFilePath && prev.doc !== nextDoc) {
        // Build O(N) lookup table ONCE and share across collapsed sets, fixed focus, and selection.
        const remapIndex = getRemapIndex(prev.doc, nextDoc);
        const resolvedExpandId =
          expandNodeId ??
          (expandBeforeNodeId !== undefined
            ? (remapIndex.remapNodeId(expandBeforeNodeId) ?? undefined)
            : undefined);

        setBaseCollapsedIds((prevIds) => {
          const remapped = remapIndex.remapNodeIdSet(prevIds);
          if (resolvedExpandId !== undefined && remapped.has(resolvedExpandId)) {
            const next = new Set(remapped);
            next.delete(resolvedExpandId);
            return next;
          }
          return remapped;
        });
        setUserOpenedDuringFilterIds((prevIds) => remapIndex.remapNodeIdSet(prevIds));
        setFocusMode((prevMode) => remapIndex.remapFocusMode(prevMode));

        if (explicitSelectedNodeId !== undefined) {
          setSelectionState({
            filePath: nextFilePath,
            doc: nextDoc,
            nodeId: explicitSelectedNodeId,
            unresolved: false,
          });
        } else {
          setSelectionState((prevSel) => {
            if (prevSel.filePath !== nextFilePath) {
              return {
                filePath: nextFilePath,
                doc: nextDoc,
                nodeId: nextDoc.rootId,
                unresolved: false,
              };
            }
            if (prevSel.unresolved) {
              return { filePath: nextFilePath, doc: nextDoc, nodeId: null, unresolved: true };
            }
            if (prevSel.nodeId === null) {
              return {
                filePath: nextFilePath,
                doc: nextDoc,
                nodeId: nextDoc.rootId,
                unresolved: false,
              };
            }
            if (prevSel.doc === nextDoc) {
              return prevSel;
            }
            const sourceDoc = prevSel.doc ?? prev.doc;
            const selIndex =
              sourceDoc === prev.doc ? remapIndex : getRemapIndex(sourceDoc, nextDoc);
            const mappedSel = selIndex.remapSelectedNodeId(prevSel.nodeId);
            return {
              filePath: nextFilePath,
              doc: nextDoc,
              nodeId: mappedSel,
              unresolved: mappedSel === null,
            };
          });
        }
        return;
      }

      if (explicitSelectedNodeId !== undefined) {
        setSelectionState({
          filePath: nextFilePath,
          doc: nextDoc,
          nodeId: explicitSelectedNodeId,
          unresolved: false,
        });
      }
      const fallbackExpandId = expandNodeId ?? expandBeforeNodeId;
      if (fallbackExpandId !== undefined) {
        setBaseCollapsedIds((prevIds) => {
          if (!prevIds.has(fallbackExpandId)) return prevIds;
          const next = new Set(prevIds);
          next.delete(fallbackExpandId);
          return next;
        });
      }
    },
    [getRemapIndex],
  );

  // Reset per-note view state when switching to a different Markdown file
  useEffect(() => {
    hasInitialFitRef.current = false;
    prevDocStateRef.current = docRef.current ? { filePath, doc: docRef.current } : null;
    lastRemapIndexRef.current = null;
    setBaseCollapsedIds(new Set());
    setUserOpenedDuringFilterIds(new Set());
    setFocusMode({ kind: 'off' });
    setFilterQuery('');
    setStructuredFilter({});
    setPopoverOpen(false);
    setStylesOpen(false);
    setEditingSession(null);
    setSelectionState({
      filePath,
      doc: docRef.current,
      nodeId: docRef.current?.rootId ?? null,
      unresolved: false,
    });
  }, [filePath]);

  // Remap node-keyed view state (collapse/fixed focus/selection) when the same note reloads externally
  useEffect(() => {
    if (!doc) return;
    syncViewStateForNextDoc(filePath, doc);
  }, [filePath, doc, syncViewStateForNextDoc]);

  // Synchronously resolve selection on the very first render of a reloaded document so
  // destructive keys (Delete) never act on a stale sequential n-* ID.
  const effectiveSelectedId = useMemo(() => {
    if (!doc) return null;
    if (selectionState.filePath !== filePath) {
      return doc.rootId;
    }
    if (selectionState.unresolved) {
      return null;
    }
    if (selectionState.nodeId === null) {
      return doc.rootId;
    }
    if (selectionState.doc === doc) {
      return doc.nodes.has(selectionState.nodeId) ? selectionState.nodeId : null;
    }
    if (selectionState.doc !== null) {
      return getRemapIndex(selectionState.doc, doc).remapSelectedNodeId(selectionState.nodeId);
    }
    return doc.nodes.has(selectionState.nodeId) ? selectionState.nodeId : null;
  }, [doc, filePath, selectionState, getRemapIndex]);

  const effectiveEditingSession = useMemo(() => {
    return isEditingSessionValid(editingSession, filePath, doc) ? editingSession : null;
  }, [editingSession, filePath, doc]);

  // Resolve each draft fail-closed: only uniquely identified drafts auto-attach to a topic;
  // ambiguous or unmatched drafts require explicit user confirmation before restoring.
  const draftResolutions = useMemo(() => {
    const map = new Map<string, DraftResolution>();
    if (!doc) return map;
    for (const draft of drafts) {
      map.set(draft.draftId, resolveDraftTarget(doc, draft));
    }
    return map;
  }, [doc, drafts]);

  const availableTags = useMemo(() => (doc ? collectDocumentTags(doc) : []), [doc]);
  const textStats = useMemo(
    () => (doc ? computeDocumentTextStats(doc) : { wordCount: 0, charCount: 0 }),
    [doc],
  );
  const numberingLabels = useMemo(
    () => (doc ? computeTopicNumbering(doc, settings.topicNumbering) : new Map<string, string>()),
    [doc, settings.topicNumbering],
  );

  const visibility = useMemo(() => {
    if (!doc) return null;
    return computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds,
      focusMode,
      selectedId: effectiveSelectedId,
      filterQuery,
      structuredFilter,
      userOpenedDuringFilterIds,
    });
  }, [
    doc,
    baseCollapsedIds,
    focusMode,
    effectiveSelectedId,
    filterQuery,
    structuredFilter,
    userOpenedDuringFilterIds,
  ]);

  const layout = useMemo(() => {
    if (!doc || !visibility) return null;
    return computeLayout(doc, visibility.visibleNodeIds, undefined, undefined, {
      layoutMode: settings.layoutMode,
      edgeStyle: settings.edgeStyle,
      numberingLabels,
    });
  }, [doc, visibility, settings.layoutMode, settings.edgeStyle, numberingLabels]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const fitView = useCallback(() => {
    const currentLayout = layoutRef.current;
    if (!currentLayout) return;
    setCamera(computeFitCamera(currentLayout.bounds, viewportSizeRef.current));
  }, []);

  const fitSelection = useCallback(() => {
    const currentLayout = layoutRef.current;
    const currentDoc = docRef.current;
    if (!currentLayout || !currentDoc) return;
    if (effectiveSelectedId === null || effectiveSelectedId === currentDoc.rootId) {
      setCamera(computeFitCamera(currentLayout.bounds, viewportSizeRef.current));
      return;
    }
    const subBounds = computeSubtreeBounds(currentDoc, currentLayout, effectiveSelectedId);
    if (subBounds) {
      setCamera(computeFitCamera(subBounds, viewportSizeRef.current));
    }
  }, [effectiveSelectedId]);

  const handleViewportResize = useCallback((size: ViewportSize) => {
    viewportSizeRef.current = size;
    const currentLayout = layoutRef.current;
    if (!hasInitialFitRef.current && currentLayout) {
      hasInitialFitRef.current = true;
      setCamera(computeFitCamera(currentLayout.bounds, size));
    }
  }, []);

  useEffect(() => {
    if (layout && !hasInitialFitRef.current) {
      hasInitialFitRef.current = true;
      setCamera(computeFitCamera(layout.bounds, viewportSizeRef.current));
    }
  }, [layout, filePath]);

  // Re-fit smoothly when switching between Balanced / Right / Org Chart layouts
  useEffect(() => {
    if (prevLayoutModeRef.current !== settings.layoutMode) {
      prevLayoutModeRef.current = settings.layoutMode;
      if (layoutRef.current) {
        setCamera(computeFitCamera(layoutRef.current.bounds, viewportSizeRef.current));
      }
    }
  }, [settings.layoutMode, layout]);

  // Auto-pan camera smoothly by the minimum delta when keyboard navigation or edits
  // select a node outside the safe viewport margin (leaving bottom clearance for floating HUD).
  useEffect(() => {
    if (!effectiveSelectedId || !layoutRef.current || !hasInitialFitRef.current) return;
    const ln = layoutRef.current.nodes.get(effectiveSelectedId);
    if (!ln) return;
    const size = viewportSizeRef.current;
    const margin = 56;
    const bottomMargin = 96;
    setCamera((prev) => {
      const left = prev.x + ln.x * prev.zoom;
      const right = prev.x + (ln.x + ln.width) * prev.zoom;
      const top = prev.y + ln.y * prev.zoom;
      const bottom = prev.y + (ln.y + ln.height) * prev.zoom;
      let dx = 0;
      let dy = 0;
      if (left < margin) {
        dx = margin - left;
      } else if (right > size.width - margin) {
        dx = size.width - margin - right;
      }
      if (top < margin) {
        dy = margin - top;
      } else if (bottom > size.height - bottomMargin) {
        dy = size.height - bottomMargin - bottom;
      }
      if (dx === 0 && dy === 0) return prev;
      return { ...prev, x: prev.x + dx, y: prev.y + dy };
    });
  }, [effectiveSelectedId]);

  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      if (!doc || nodeId === doc.rootId) return;
      const node = doc.nodes.get(nodeId);
      if (!node || node.childIds.length === 0) return;

      const isCurrentlyCollapsed = visibility?.effectiveCollapsedIds.has(nodeId) ?? false;
      if (visibility?.filterActive && isCurrentlyCollapsed) {
        setUserOpenedDuringFilterIds((prev) => {
          const next = new Set(prev);
          next.add(nodeId);
          return next;
        });
      }

      setBaseCollapsedIds((prev) => {
        const next = new Set(prev);
        if (isCurrentlyCollapsed) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [doc, visibility],
  );

  const handleApplyDepth = useCallback(
    (depth: number) => {
      if (!doc) return;
      const anchor = effectiveSelectedId ?? doc.rootId;
      setBaseCollapsedIds((prev) => computeDepthCollapsedIds(doc, anchor, depth, prev));
    },
    [doc, effectiveSelectedId],
  );

  const handleCycleFocus = useCallback(() => {
    if (!doc) return;
    setFocusMode((prev) => {
      if (prev.kind === 'off') {
        if (effectiveSelectedId !== null && effectiveSelectedId !== doc.rootId) {
          return { kind: 'fixed', anchorId: effectiveSelectedId };
        }
        return { kind: 'follow' };
      }
      if (prev.kind === 'fixed') {
        return { kind: 'follow' };
      }
      return { kind: 'off' };
    });
  }, [doc, effectiveSelectedId]);

  const handleFilterChange = useCallback((nextQuery: string) => {
    setFilterQuery(nextQuery);
    if (nextQuery.trim().length === 0) {
      setUserOpenedDuringFilterIds(new Set());
    }
  }, []);

  const handleStructuredFilterChange = useCallback((next: StructuredFilterCriteria) => {
    setStructuredFilter(next);
    if (!hasActiveStructuredFilter(next)) {
      setUserOpenedDuringFilterIds(new Set());
    }
  }, []);

  const handleZoomBy = useCallback((factor: number) => {
    setCamera((prev) => {
      const nextZoom = clampZoom(prev.zoom * factor);
      const centerX = viewportSizeRef.current.width / 2;
      const centerY = viewportSizeRef.current.height / 2;
      const ratio = nextZoom / prev.zoom;
      return {
        x: centerX - (centerX - prev.x) * ratio,
        y: centerY - (centerY - prev.y) * ratio,
        zoom: nextZoom,
      };
    });
  }, []);

  const handleZoomReset = useCallback(() => {
    setCamera((prev) => {
      const centerX = viewportSizeRef.current.width / 2;
      const centerY = viewportSizeRef.current.height / 2;
      const ratio = 1 / prev.zoom;
      return {
        x: centerX - (centerX - prev.x) * ratio,
        y: centerY - (centerY - prev.y) * ratio,
        zoom: 1,
      };
    });
  }, []);

  const dispatchAndFocus = useCallback(
    async (
      command: SemanticCommand,
      openInlineEditorAfter: boolean,
      expandParentId?: string,
      expandFocusedParent = false,
    ): Promise<CommandDispatchOutcome> => {
      if (!onDispatchCommand) {
        return { accepted: false, rejectCode: 'unsupported-command' };
      }
      if (isCommandInFlightRef.current) {
        // Distinct from 'boundary-no-op' so callers keep (or draft) the user's input
        // instead of treating the edit as already applied.
        return { accepted: false, rejectCode: 'command-in-flight' };
      }
      const startedFilePath = filePathRef.current;
      isCommandInFlightRef.current = true;
      try {
        const outcome = await onDispatchCommand(command, startedFilePath);
        if (filePathRef.current !== startedFilePath) {
          return outcome;
        }
        if (outcome.accepted && outcome.focusNodeId !== undefined) {
          if (outcome.nextDocument !== undefined) {
            const actualFocusedParentId = expandFocusedParent
              ? (outcome.nextDocument.nodes.get(outcome.focusNodeId)?.parentId ?? undefined)
              : undefined;
            syncViewStateForNextDoc(
              startedFilePath,
              outcome.nextDocument,
              actualFocusedParentId,
              expandParentId,
              outcome.focusNodeId,
            );
          } else {
            if (expandParentId !== undefined) {
              setBaseCollapsedIds((prev) => {
                if (!prev.has(expandParentId)) return prev;
                const next = new Set(prev);
                next.delete(expandParentId);
                return next;
              });
            }
            selectNode(outcome.focusNodeId, docRef.current, startedFilePath);
          }
          if (openInlineEditorAfter && outcome.nextDocument !== undefined) {
            const focusedNode = outcome.nextDocument.nodes.get(outcome.focusNodeId);
            if (focusedNode) {
              setPopoverOpen(false);
              setEditingSession(
                createEditingSession(startedFilePath, outcome.nextDocument, focusedNode),
              );
            }
          } else if (command.type !== 'updateNote') {
            rootRef.current?.focus({ preventScroll: true });
          }
        } else if (!outcome.accepted && outcome.rejectCode === 'boundary-no-op') {
          if (command.type !== 'updateNote') {
            rootRef.current?.focus({ preventScroll: true });
          }
        }
        return outcome;
      } finally {
        isCommandInFlightRef.current = false;
      }
    },
    [onDispatchCommand, syncViewStateForNextDoc, selectNode],
  );

  const runHistoryStep = useCallback(
    async (direction: 'undo' | 'redo'): Promise<void> => {
      const handler = direction === 'undo' ? onUndo : onRedo;
      if (!handler || isCommandInFlightRef.current) return;
      const startedFilePath = filePathRef.current;
      isCommandInFlightRef.current = true;
      try {
        const outcome = await handler();
        if (filePathRef.current !== startedFilePath) {
          return;
        }
        if (outcome.accepted && outcome.focusNodeId !== undefined) {
          if (outcome.nextDocument !== undefined) {
            syncViewStateForNextDoc(
              startedFilePath,
              outcome.nextDocument,
              undefined,
              undefined,
              outcome.focusNodeId,
            );
          } else {
            selectNode(outcome.focusNodeId, docRef.current, startedFilePath);
          }
          setEditingSession(null);
          rootRef.current?.focus({ preventScroll: true });
        }
      } finally {
        isCommandInFlightRef.current = false;
      }
    },
    [onUndo, onRedo, syncViewStateForNextDoc, selectNode],
  );

  const saveDraftAndNotify = useCallback(
    async (
      input: SaveDraftInput,
      options?: {
        readonly customPersistedNotice?: string;
        readonly reopenInlineText?: string;
        readonly requireReloadedDocForReopen?: boolean;
      },
    ): Promise<SaveDraftResult | null> => {
      if (!onSaveDraft) return null;
      const result = await onSaveDraft(input);
      if (result.persisted) {
        onNotify?.(options?.customPersistedNotice ?? messages.edit.draftSavedNotice);
        return result;
      }

      // Disk persistence failed (e.g. data.json protected or write error):
      // never claim the draft survives restart; warn clearly and reopen the inline editor ONLY
      // when structural identity uniquely proves the original topic in the current document.
      onNotify?.(`${messages.edit.draftPersistFailedNotice}${input.text}`);
      const reopenText = options?.reopenInlineText;
      if (
        reopenText !== undefined &&
        filePathRef.current === input.filePath &&
        editingSessionRef.current === null
      ) {
        const currentDoc = docRef.current;
        const staleNotYetReloaded =
          options?.requireReloadedDocForReopen === true &&
          currentDoc?.contentHash === input.baseContentHash;
        if (currentDoc && !staleNotYetReloaded && currentDoc.readOnlyReasons.length === 0) {
          const resolution = resolveDraftTarget(currentDoc, result.entry);
          if (resolution.status === 'matched') {
            const targetNode = currentDoc.nodes.get(resolution.nodeId);
            if (targetNode) {
              setPopoverOpen(false);
              setStylesOpen(false);
              selectNode(targetNode.id, currentDoc, input.filePath);
              setEditingSession(
                createEditingSession(
                  input.filePath,
                  currentDoc,
                  targetNode,
                  reopenText,
                  result.entry.draftId,
                ),
              );
            }
          }
        }
      }
      return result;
    },
    [onSaveDraft, onNotify, messages, selectNode],
  );

  const handleCopyDraftText = useCallback(
    (draftText: string) => {
      const clipboard = rootRef.current?.ownerDocument.defaultView?.navigator?.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') return;
      void clipboard
        .writeText(draftText)
        .then(() => {
          onNotify?.(messages.edit.draftCopiedNotice);
        })
        .catch(() => {
          // Ignore clipboard denial; user can copy directly from the editor/notice.
        });
    },
    [onNotify, messages],
  );

  const handleStartEdit = useCallback(
    (nodeId: string) => {
      if (!doc) return;
      if (!onDispatchCommand || doc.readOnlyReasons.length > 0) {
        selectNode(nodeId, doc, filePath);
        setPopoverOpen(true);
        return;
      }
      const node = doc.nodes.get(nodeId);
      if (!node) return;
      setPopoverOpen(false);
      setStylesOpen(false);
      selectNode(nodeId, doc, filePath);
      setEditingSession(createEditingSession(filePath, doc, node));
    },
    [doc, filePath, onDispatchCommand, selectNode],
  );

  const handleDiscardEdit = useCallback(
    (unsavedValue: string) => {
      const lastSession = editingSessionRef.current;
      if (lastSession && onSaveDraft && unsavedValue.trim().length > 0) {
        void saveDraftAndNotify(
          {
            filePath: lastSession.filePath,
            field: 'title',
            targetTitleRaw: lastSession.initialTitleRaw,
            targetHeaderLine: lastSession.targetHeaderLine,
            targetOwnRangeHash: lastSession.guard.expectedOwnRangeHash,
            targetAncestorPath: lastSession.targetAncestorPath,
            targetHadIdenticalSibling: lastSession.targetHadIdenticalSibling,
            baseContentHash: lastSession.guard.expectedContentHash,
            text: unsavedValue,
          },
          { customPersistedNotice: `${messages.edit.unsavedInputDiscarded}${unsavedValue}` },
        );
        return;
      }
      onNotify?.(`${messages.edit.unsavedInputDiscarded}${unsavedValue}`);
    },
    [messages, onNotify, onSaveDraft, saveDraftAndNotify],
  );

  const handleCommitEdit = useCallback(
    (session: EditingSession, nextTitle: string) => {
      const {
        filePath: sessionFilePath,
        initialTitleRaw,
        targetHeaderLine,
        targetAncestorPath,
        targetHadIdenticalSibling,
        restoredDraftId,
        guard,
      } = session;
      setEditingSession(null);
      rootRef.current?.focus();
      if (!onDispatchCommand) return;
      const command = buildCommitRenameCommand(session, filePathRef.current, nextTitle);
      if (command === null) {
        return;
      }
      if (!isEditingSessionValid(session, filePathRef.current, docRef.current)) {
        if (onSaveDraft) {
          void saveDraftAndNotify(
            {
              filePath: sessionFilePath,
              field: 'title',
              targetTitleRaw: initialTitleRaw,
              targetHeaderLine,
              targetOwnRangeHash: guard.expectedOwnRangeHash,
              targetAncestorPath,
              targetHadIdenticalSibling,
              baseContentHash: guard.expectedContentHash,
              text: nextTitle,
            },
            { customPersistedNotice: `${messages.edit.unsavedInputDiscarded}${nextTitle}` },
          );
        } else {
          onNotify?.(`${messages.edit.unsavedInputDiscarded}${nextTitle}`);
        }
        return;
      }
      void dispatchAndFocus(command, false).then((outcome) => {
        if (outcome.accepted) {
          void onDeleteMatchingDraft?.(
            sessionFilePath,
            'title',
            initialTitleRaw,
            targetHeaderLine,
            targetAncestorPath,
            guard.expectedOwnRangeHash,
            guard.expectedContentHash,
            targetHadIdenticalSibling,
          );
          if (restoredDraftId !== undefined) {
            void onDeleteDraft?.(restoredDraftId);
          }
        } else if (outcome.rejectCode !== 'boundary-no-op' && onSaveDraft) {
          void saveDraftAndNotify(
            {
              filePath: sessionFilePath,
              field: 'title',
              targetTitleRaw: initialTitleRaw,
              targetHeaderLine,
              targetOwnRangeHash: guard.expectedOwnRangeHash,
              targetAncestorPath,
              targetHadIdenticalSibling,
              baseContentHash: guard.expectedContentHash,
              text: nextTitle,
            },
            {
              reopenInlineText: nextTitle,
              requireReloadedDocForReopen: outcome.rejectCode === 'stale-target',
            },
          );
        }
      });
    },
    [
      onDispatchCommand,
      dispatchAndFocus,
      onSaveDraft,
      saveDraftAndNotify,
      onDeleteMatchingDraft,
      onDeleteDraft,
      onNotify,
      messages,
    ],
  );

  const handleCommitNote = useCallback(
    async (
      session: NoteEditingSession,
      nextNoteBody: string,
    ): Promise<CommandDispatchOutcome> => {
      const {
        filePath: sessionFilePath,
        targetTitleRaw,
        targetHeaderLine,
        targetAncestorPath,
        targetHadIdenticalSibling,
        restoredDraftId,
        guard,
      } = session;
      if (!onDispatchCommand) {
        return { accepted: false, rejectCode: 'unsupported-command' };
      }
      const command = buildUpdateNoteCommand(session, filePathRef.current, nextNoteBody);
      if (command === null || !isNoteEditingSessionValid(session, filePathRef.current, docRef.current)) {
        if (onSaveDraft) {
          await saveDraftAndNotify({
            filePath: sessionFilePath,
            field: 'note',
            targetTitleRaw,
            targetHeaderLine,
            targetOwnRangeHash: guard.expectedOwnRangeHash,
            targetAncestorPath,
            targetHadIdenticalSibling,
            baseContentHash: guard.expectedContentHash,
            text: nextNoteBody,
          });
        } else {
          onNotify?.(`${messages.edit.draftPersistFailedNotice}${nextNoteBody}`);
        }
        return { accepted: false, rejectCode: 'stale-target' };
      }

      const outcome = await dispatchAndFocus(command, false);
      if (outcome.accepted) {
        void onDeleteMatchingDraft?.(
          sessionFilePath,
          'note',
          targetTitleRaw,
          targetHeaderLine,
          targetAncestorPath,
          guard.expectedOwnRangeHash,
          guard.expectedContentHash,
          targetHadIdenticalSibling,
        );
        if (restoredDraftId !== undefined) {
          void onDeleteDraft?.(restoredDraftId);
        }
      } else if (outcome.rejectCode !== 'boundary-no-op' && onSaveDraft) {
        await saveDraftAndNotify({
          filePath: sessionFilePath,
          field: 'note',
          targetTitleRaw,
          targetHeaderLine,
          targetOwnRangeHash: guard.expectedOwnRangeHash,
          targetAncestorPath,
          targetHadIdenticalSibling,
          baseContentHash: guard.expectedContentHash,
          text: nextNoteBody,
        });
      }
      return outcome;
    },
    [
      onDispatchCommand,
      dispatchAndFocus,
      onSaveDraft,
      saveDraftAndNotify,
      onDeleteMatchingDraft,
      onDeleteDraft,
      onNotify,
      messages,
    ],
  );

  const handleRescueNoteDraft = useCallback(
    (session: NoteEditingSession, unsavedBody: string) => {
      if (!onSaveDraft) return;
      void saveDraftAndNotify({
        filePath: session.filePath,
        field: 'note',
        targetTitleRaw: session.targetTitleRaw,
        targetHeaderLine: session.targetHeaderLine,
        targetOwnRangeHash: session.guard.expectedOwnRangeHash,
        targetAncestorPath: session.targetAncestorPath,
        targetHadIdenticalSibling: session.targetHadIdenticalSibling,
        baseContentHash: session.guard.expectedContentHash,
        text: unsavedBody,
      });
    },
    [onSaveDraft, saveDraftAndNotify],
  );

  const handleRestoreTitleDraft = useCallback(
    (nodeId: string, draftText: string, draftId: string) => {
      if (!doc || !onDispatchCommand || doc.readOnlyReasons.length > 0) return;
      const node = doc.nodes.get(nodeId);
      if (!node) return;
      setPopoverOpen(false);
      setStylesOpen(false);
      selectNode(nodeId, doc, filePath);
      setEditingSession(createEditingSession(filePath, doc, node, draftText, draftId));
    },
    [doc, filePath, onDispatchCommand, selectNode],
  );

  const handleInspectDrafts = useCallback(() => {
    if (!doc || drafts.length === 0) return;
    let targetId: string | null = null;
    for (const draft of drafts) {
      const res = draftResolutions.get(draft.draftId);
      if (res?.status === 'matched') {
        targetId = res.nodeId;
        break;
      }
    }
    if (targetId === null) {
      for (const draft of drafts) {
        const res = draftResolutions.get(draft.draftId);
        if (res?.status === 'ambiguous' && res.candidateNodeIds[0] !== undefined) {
          targetId = res.candidateNodeIds[0];
          break;
        }
      }
    }
    selectNode(targetId ?? doc.rootId, doc, filePath);
    setStylesOpen(false);
    setPopoverOpen(true);
  }, [doc, filePath, drafts, draftResolutions, selectNode]);

  const handleReparentNode = useCallback(
    (nodeId: string, targetParentId: string, index: number) => {
      if (!doc || !onDispatchCommand) return;
      const node = doc.nodes.get(nodeId);
      if (!node) return;
      void dispatchAndFocus(
        {
          type: 'reparent',
          guard: buildPatchGuard(doc, node),
          targetParentId,
          index,
        },
        false,
        targetParentId,
        true,
      );
    },
    [doc, onDispatchCommand, dispatchAndFocus],
  );

  const handleCopyBranch = useCallback(async (): Promise<void> => {
    if (!doc || effectiveSelectedId === null || !onCopyBranchSubtree) return;
    const node = doc.nodes.get(effectiveSelectedId);
    if (!node || node.id === doc.rootId || node.kind === 'central-virtual') {
      onNotify?.(messages.edit.cannotModifyRoot);
      return;
    }
    const originFilePath = filePathRef.current;
    const copied = await onCopyBranchSubtree(node);
    if (copied && filePathRef.current === originFilePath) {
      onNotify?.(messages.edit.branchCopiedNotice);
    }
  }, [doc, effectiveSelectedId, onCopyBranchSubtree, onNotify, messages]);

  const handleCutBranch = useCallback(async (): Promise<void> => {
    if (!doc || effectiveSelectedId === null || !onCopyBranchSubtree || !onDispatchCommand) return;
    const node = doc.nodes.get(effectiveSelectedId);
    if (!node || node.id === doc.rootId || node.kind === 'central-virtual') {
      onNotify?.(messages.edit.cannotModifyRoot);
      return;
    }
    const originFilePath = filePathRef.current;
    const originDocHash = doc.contentHash;
    const copied = await onCopyBranchSubtree(node);
    if (!copied) return;
    // Recheck active file & document snapshot after awaiting the OS clipboard (PR #6 P1).
    if (filePathRef.current !== originFilePath || docRef.current?.contentHash !== originDocHash) {
      return;
    }
    const outcome = await dispatchAndFocus(
      {
        type: 'deleteBranch',
        guard: buildPatchGuard(doc, node),
      },
      false,
    );
    if (outcome.accepted && filePathRef.current === originFilePath) {
      onNotify?.(messages.edit.branchCutNotice);
    }
  }, [doc, effectiveSelectedId, onCopyBranchSubtree, onDispatchCommand, dispatchAndFocus, onNotify, messages]);

  const handlePasteBranch = useCallback(async (): Promise<void> => {
    if (!doc || effectiveSelectedId === null || !onReadBranchClipboard || !onDispatchCommand) return;
    const node = doc.nodes.get(effectiveSelectedId);
    if (!node) return;
    const originFilePath = filePathRef.current;
    const originDocHash = doc.contentHash;
    const subtreeMarkdown = await onReadBranchClipboard();
    // Recheck active file & document snapshot after awaiting the OS clipboard (PR #6 P1).
    if (filePathRef.current !== originFilePath || docRef.current?.contentHash !== originDocHash) {
      return;
    }
    if (!subtreeMarkdown || subtreeMarkdown.trim().length === 0) {
      onNotify?.(messages.edit.clipboardEmptyNotice);
      return;
    }
    void dispatchAndFocus(
      {
        type: 'pasteBranch',
        guard: buildPatchGuard(doc, node),
        subtreeMarkdown,
      },
      false,
      node.id,
      true,
    );
  }, [doc, effectiveSelectedId, onReadBranchClipboard, onDispatchCommand, dispatchAndFocus, onNotify, messages]);

  const handleOpenNoteEditor = useCallback((): boolean => {
    if (!doc || effectiveSelectedId === null) return false;
    setStylesOpen(false);
    setEditingSession(null);
    setPopoverOpen(true);
    setNoteEditRequestToken((prev) => prev + 1);
    return true;
  }, [doc, effectiveSelectedId]);

  const handleSplitEdit = useCallback(
    (session: EditingSession, leftTitle: string, rightTitle: string, fullValue: string) => {
      const {
        filePath: sessionFilePath,
        initialTitleRaw,
        targetHeaderLine,
        targetAncestorPath,
        targetHadIdenticalSibling,
        restoredDraftId,
        guard,
      } = session;
      setEditingSession(null);
      rootRef.current?.focus();
      if (!onDispatchCommand) return;

      const rescueFullInput = (
        customPersistedNotice?: string,
        reopenOnPersistFailure = false,
        requireReloadedDocForReopen = false,
      ): void => {
        if (onSaveDraft && fullValue.trim().length > 0) {
          void saveDraftAndNotify(
            {
              filePath: sessionFilePath,
              field: 'title',
              targetTitleRaw: initialTitleRaw,
              targetHeaderLine,
              targetOwnRangeHash: guard.expectedOwnRangeHash,
              targetAncestorPath,
              targetHadIdenticalSibling,
              baseContentHash: guard.expectedContentHash,
              text: fullValue,
            },
            {
              customPersistedNotice,
              reopenInlineText: reopenOnPersistFailure ? fullValue : undefined,
              requireReloadedDocForReopen,
            },
          );
        } else if (customPersistedNotice) {
          onNotify?.(customPersistedNotice);
        }
      };

      const command = buildSplitSiblingCommand(session, filePathRef.current, leftTitle, rightTitle);
      if (command === null) {
        if (fullValue.trim().length > 0 && fullValue.trim() !== initialTitleRaw) {
          rescueFullInput(undefined, true);
        }
        return;
      }
      if (!isEditingSessionValid(session, filePathRef.current, docRef.current)) {
        rescueFullInput(`${messages.edit.unsavedInputDiscarded}${fullValue}`, false);
        return;
      }
      void dispatchAndFocus(command, false).then((outcome) => {
        if (outcome.accepted) {
          void onDeleteMatchingDraft?.(
            sessionFilePath,
            'title',
            initialTitleRaw,
            targetHeaderLine,
            targetAncestorPath,
            guard.expectedOwnRangeHash,
            guard.expectedContentHash,
            targetHadIdenticalSibling,
          );
          if (restoredDraftId !== undefined) {
            void onDeleteDraft?.(restoredDraftId);
          }
        } else if (outcome.rejectCode !== 'boundary-no-op') {
          rescueFullInput(undefined, true, outcome.rejectCode === 'stale-target');
        }
      });
    },
    [
      onDispatchCommand,
      dispatchAndFocus,
      onSaveDraft,
      saveDraftAndNotify,
      onDeleteMatchingDraft,
      onDeleteDraft,
      onNotify,
      messages,
    ],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingSession(null);
    rootRef.current?.focus();
  }, []);

  const handleToggleTask = useCallback(
    (nodeId: string) => {
      if (!doc || !onDispatchCommand) return;
      const node = doc.nodes.get(nodeId);
      if (!node) return;
      void dispatchAndFocus(
        {
          type: 'toggleTask',
          guard: buildPatchGuard(doc, node),
        },
        false,
      );
    },
    [doc, onDispatchCommand, dispatchAndFocus],
  );

  const actionTriggersRef = useRef<MindMapActionTriggers>({
    editSelected: () => false,
    splitEditing: () => false,
    commitNoteEdit: () => false,
    editSelectedNote: () => false,
    copySelectedBranch: () => false,
    cutSelectedBranch: () => false,
    pasteBranch: () => false,
    undo: () => false,
    redo: () => false,
    toggleSelectedTask: () => false,
    fitSelection: () => false,
  });
  actionTriggersRef.current = {
    editSelected: (): boolean => {
      if (!doc || !layout) return false;
      if (effectiveEditingSession !== null) return false;
      if (effectiveSelectedId === null) return false;
      handleStartEdit(effectiveSelectedId);
      return true;
    },
    splitEditing: (event: GuardableKeyEvent): boolean => {
      if (effectiveEditingSession === null) return false;
      return inlineSplitTriggerRef.current?.(event) ?? false;
    },
    commitNoteEdit: (event: GuardableKeyEvent): boolean => {
      return noteCommitTriggerRef.current?.(event) ?? false;
    },
    editSelectedNote: (): boolean => {
      if (!doc || !layout || effectiveEditingSession !== null) return false;
      return handleOpenNoteEditor();
    },
    copySelectedBranch: (): boolean => {
      if (!doc || effectiveEditingSession !== null || !onCopyBranchSubtree) return false;
      void handleCopyBranch();
      return true;
    },
    cutSelectedBranch: (): boolean => {
      if (!doc || effectiveEditingSession !== null || !onCopyBranchSubtree || !onDispatchCommand) {
        return false;
      }
      void handleCutBranch();
      return true;
    },
    pasteBranch: (): boolean => {
      if (!doc || effectiveEditingSession !== null || !onReadBranchClipboard || !onDispatchCommand) {
        return false;
      }
      void handlePasteBranch();
      return true;
    },
    undo: (): boolean => {
      if (!doc || !onUndo || effectiveEditingSession !== null) return false;
      void runHistoryStep('undo');
      return true;
    },
    redo: (): boolean => {
      if (!doc || !onRedo || effectiveEditingSession !== null) return false;
      void runHistoryStep('redo');
      return true;
    },
    toggleSelectedTask: (): boolean => {
      if (!doc || !onDispatchCommand || effectiveEditingSession !== null) return false;
      if (effectiveSelectedId === null) return false;
      handleToggleTask(effectiveSelectedId);
      return true;
    },
    fitSelection: (): boolean => {
      if (!doc || !layout || effectiveEditingSession !== null) return false;
      fitSelection();
      return true;
    },
  };

  useEffect(() => {
    if (!onRegisterActionTriggers) return;
    const triggers: MindMapActionTriggers = {
      editSelected: () => actionTriggersRef.current.editSelected(),
      splitEditing: (event: GuardableKeyEvent) => actionTriggersRef.current.splitEditing(event),
      commitNoteEdit: (event: GuardableKeyEvent) => actionTriggersRef.current.commitNoteEdit(event),
      editSelectedNote: () => actionTriggersRef.current.editSelectedNote(),
      copySelectedBranch: () => actionTriggersRef.current.copySelectedBranch(),
      cutSelectedBranch: () => actionTriggersRef.current.cutSelectedBranch(),
      pasteBranch: () => actionTriggersRef.current.pasteBranch(),
      undo: () => actionTriggersRef.current.undo(),
      redo: () => actionTriggersRef.current.redo(),
      toggleSelectedTask: () => actionTriggersRef.current.toggleSelectedTask(),
      fitSelection: () => actionTriggersRef.current.fitSelection(),
    };
    onRegisterActionTriggers(triggers);
    return () => {
      onRegisterActionTriggers(null);
    };
  }, [onRegisterActionTriggers]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return;
    if (!doc || !layout) return;
    if (effectiveEditingSession !== null) return;

    if (event.key === 'Escape') {
      if (stylesOpen) {
        event.preventDefault();
        setStylesOpen(false);
        return;
      }
      if (popoverOpen) {
        event.preventDefault();
        setPopoverOpen(false);
        return;
      }
      if (filterQuery.length > 0 || hasActiveStructuredFilter(structuredFilter)) {
        event.preventDefault();
        handleFilterChange('');
        handleStructuredFilterChange({});
        return;
      }
      if (focusMode.kind !== 'off') {
        event.preventDefault();
        setFocusMode({ kind: 'off' });
        return;
      }
    }

    if (shouldIgnoreCanvasKeyEvent(event.target)) {
      return;
    }

    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    const modKey = event.metaKey || event.ctrlKey;

    if (modKey && !event.altKey) {
      // Zoom fit shortcut (Cmd/Ctrl + 0) / Fit selection (Cmd/Ctrl + Shift + 0)
      if (event.key === '0' || (event.shiftKey && event.code === 'Digit0')) {
        event.preventDefault();
        if (event.shiftKey) {
          fitSelection();
        } else {
          fitView();
        }
        return;
      }

      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        void runHistoryStep(event.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (event.ctrlKey && !event.metaKey && !event.shiftKey && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        void runHistoryStep('redo');
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey && effectiveSelectedId !== null) {
        event.preventDefault();
        handleStartEdit(effectiveSelectedId);
        return;
      }

      if (
        (event.key === 'Backspace' || event.key === 'Delete') &&
        !event.shiftKey &&
        effectiveSelectedId !== null &&
        onDispatchCommand
      ) {
        const targetNode = doc.nodes.get(effectiveSelectedId);
        if (targetNode) {
          event.preventDefault();
          void dispatchAndFocus(
            {
              type: 'deleteNodeKeepChildren',
              guard: buildPatchGuard(doc, targetNode),
            },
            false,
          );
          return;
        }
      }

      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
        !event.shiftKey &&
        effectiveSelectedId !== null &&
        onDispatchCommand
      ) {
        const targetNode = doc.nodes.get(effectiveSelectedId);
        if (targetNode) {
          event.preventDefault();
          void dispatchAndFocus(
            {
              type: 'moveSibling',
              guard: buildPatchGuard(doc, targetNode),
              direction: event.key === 'ArrowUp' ? 'up' : 'down',
            },
            false,
          );
          return;
        }
      }

      if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        !event.shiftKey &&
        effectiveSelectedId !== null &&
        onDispatchCommand
      ) {
        const targetNode = doc.nodes.get(effectiveSelectedId);
        const targetLayout = layout.nodes.get(effectiveSelectedId);
        if (targetNode && targetLayout && targetLayout.side !== 'center') {
          event.preventDefault();
          const outwardKey = targetLayout.side === 'left' ? 'ArrowLeft' : 'ArrowRight';
          const commandType = event.key === outwardKey ? 'indent' : 'outdent';
          void dispatchAndFocus(
            {
              type: commandType,
              guard: buildPatchGuard(doc, targetNode),
            },
            false,
            undefined,
            commandType === 'indent',
          );
          return;
        }
      }

      if (event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault();
        handleOpenNoteEditor();
        return;
      }

      if (!event.shiftKey && event.key.toLowerCase() === 'c' && onCopyBranchSubtree) {
        event.preventDefault();
        void handleCopyBranch();
        return;
      }

      if (
        !event.shiftKey &&
        event.key.toLowerCase() === 'x' &&
        onCopyBranchSubtree &&
        onDispatchCommand
      ) {
        event.preventDefault();
        void handleCutBranch();
        return;
      }

      if (
        !event.shiftKey &&
        event.key.toLowerCase() === 'v' &&
        onReadBranchClipboard &&
        onDispatchCommand
      ) {
        event.preventDefault();
        void handlePasteBranch();
        return;
      }

      return;
    }

    if (event.key === '/' && !modKey && !event.altKey) {
      event.preventDefault();
      filterInputRef.current?.focus();
      return;
    }

    if (event.altKey) {
      return;
    }

    if (event.key === 'F2' && effectiveSelectedId !== null) {
      event.preventDefault();
      handleStartEdit(effectiveSelectedId);
      return;
    }

    if (event.key === 'Tab' && effectiveSelectedId !== null && onDispatchCommand) {
      const targetNode = doc.nodes.get(effectiveSelectedId);
      if (targetNode) {
        event.preventDefault();
        if (event.shiftKey) {
          void dispatchAndFocus(
            {
              type: 'insertParent',
              guard: buildPatchGuard(doc, targetNode),
              parentTitle: messages.edit.newTopicTitle,
            },
            true,
          );
        } else {
          void dispatchAndFocus(
            {
              type: 'insertChild',
              guard: buildPatchGuard(doc, targetNode),
              title: messages.edit.newTopicTitle,
              position: 'end',
            },
            true,
            targetNode.id,
            true,
          );
        }
        return;
      }
    }

    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      !event.shiftKey &&
      effectiveSelectedId !== null &&
      onDispatchCommand
    ) {
      const targetNode = doc.nodes.get(effectiveSelectedId);
      if (targetNode) {
        event.preventDefault();
        void dispatchAndFocus(
          {
            type: 'deleteBranch',
            guard: buildPatchGuard(doc, targetNode),
          },
          false,
        );
        return;
      }
    }

    if (event.key === 'Enter' && effectiveSelectedId !== null && onDispatchCommand) {
      const targetNode = doc.nodes.get(effectiveSelectedId);
      if (targetNode) {
        event.preventDefault();
        void dispatchAndFocus(
          {
            type: 'insertSibling',
            guard: buildPatchGuard(doc, targetNode),
            title: messages.edit.newTopicTitle,
            placement: event.shiftKey ? 'before' : 'after',
          },
          true,
        );
        return;
      }
    }

    const arrowMap: Record<string, ArrowDirection> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    };
    const arrowDir = arrowMap[event.key];
    if (arrowDir) {
      event.preventDefault();
      if (effectiveSelectedId === null) {
        selectNode(doc.rootId, doc, filePath);
        return;
      }
      const next = resolveArrowNavigation(doc, layout, effectiveSelectedId, arrowDir);
      if (next !== null) {
        selectNode(next, doc, filePath);
      }
      return;
    }

    if (event.key === '.' && effectiveSelectedId !== null) {
      event.preventDefault();
      handleToggleCollapse(effectiveSelectedId);
      return;
    }

    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      handleApplyDepth(Number.parseInt(event.key, 10));
      return;
    }

    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      handleCycleFocus();
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      setPopoverOpen((prev) => !prev);
    }
  };

  const handleToggleStyles = useCallback(() => {
    setStylesOpen((prev) => {
      const next = !prev;
      if (next) setPopoverOpen(false);
      return next;
    });
  }, []);

  const handleCloseStyles = useCallback(() => {
    setStylesOpen(false);
  }, []);

  const handleTogglePopover = useCallback(() => {
    setPopoverOpen((prev) => {
      const next = !prev;
      if (next) setStylesOpen(false);
      return next;
    });
  }, []);

  const handleClosePopover = useCallback(() => {
    setPopoverOpen(false);
  }, []);

  if (parseResult.status === 'blocked') {
    return (
      <div className={`ito-root ito-theme-${themeMode}`}>
        <div className="ito-blocked-state" role="alert">
          <h3 className="ito-blocked-title">{messages.blocked.title}</h3>
          <p className="ito-blocked-reason">{messages.blocked.reasons[parseResult.reason]}</p>
          <button type="button" className="ito-btn ito-btn-primary" onClick={() => onOpenMarkdown()}>
            {messages.blocked.openInMarkdown}
          </button>
        </div>
      </div>
    );
  }

  if (!doc || !visibility || !layout) {
    return null;
  }

  const selectedNode =
    effectiveSelectedId !== null ? (doc.nodes.get(effectiveSelectedId) ?? null) : null;
  const zoomPercent = Math.round(camera.zoom * 100);

  return (
    <div
      ref={rootRef}
      className={`ito-root ito-theme-${themeMode}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <Toolbar
        messages={messages}
        zoomPercent={zoomPercent}
        focusMode={focusMode}
        filterQuery={filterQuery}
        structuredFilter={structuredFilter}
        availableTags={availableTags}
        filterInputRef={filterInputRef}
        popoverOpen={popoverOpen}
        stylesOpen={stylesOpen}
        canEditStyles={onUpdateSettings !== undefined}
        onZoomOut={() => handleZoomBy(0.85)}
        onZoomReset={handleZoomReset}
        onZoomIn={() => handleZoomBy(1.15)}
        onFitView={fitView}
        onCycleFocus={handleCycleFocus}
        onApplyDepth={handleApplyDepth}
        onFilterChange={handleFilterChange}
        onStructuredFilterChange={handleStructuredFilterChange}
        onTogglePopover={handleTogglePopover}
        onToggleStyles={handleToggleStyles}
        onOpenMarkdown={() => onOpenMarkdown(selectedNode?.headerLine)}
      />

      <div className="ito-stage">
        <ViewportCanvas
          document={doc}
          layout={layout}
          camera={camera}
          selectedId={effectiveSelectedId}
          editingSession={effectiveEditingSession}
          imeGuardWindowMs={settings.imeGuardWindowMs}
          inlineEditorLabel={messages.edit.inlineEditorLabel}
          toggleTaskAriaLabel={messages.edit.toggleTaskAriaLabel}
          canEdit={onDispatchCommand !== undefined}
          dimmedNodeIds={visibility.dimmedNodeIds}
          matchedNodeIds={visibility.matchedNodeIds}
          effectiveCollapsedIds={visibility.effectiveCollapsedIds}
          numberingLabels={numberingLabels}
          palette={palette}
          rainbowBranches={settings.rainbowBranches}
          colorStyle={settings.colorStyle}
          canvasPattern={settings.canvasPattern}
          onCameraChange={setCamera}
          onViewportResize={handleViewportResize}
          onSelectNode={(id) => {
            selectNode(id, doc, filePath);
            if (id === null) {
              setPopoverOpen(false);
              setStylesOpen(false);
              setEditingSession(null);
            }
          }}
          onToggleCollapse={handleToggleCollapse}
          onOpenPopover={(id) => {
            selectNode(id, doc, filePath);
            setPopoverOpen(true);
            setStylesOpen(false);
          }}
          onOpenLink={onOpenLink}
          onStartEdit={handleStartEdit}
          onCommitEdit={handleCommitEdit}
          onSplitEdit={handleSplitEdit}
          inlineSplitTriggerRef={inlineSplitTriggerRef}
          onCancelEdit={handleCancelEdit}
          onDiscardEdit={handleDiscardEdit}
          onToggleTask={handleToggleTask}
          onReparentNode={handleReparentNode}
        />

        {popoverOpen && selectedNode !== null && (
          <NodePopover
            filePath={filePath}
            document={doc}
            node={selectedNode}
            messages={messages}
            isReadOnly={doc.readOnlyReasons.length > 0}
            canEdit={onDispatchCommand !== undefined}
            imeGuardWindowMs={settings.imeGuardWindowMs}
            startEditingNoteToken={noteEditRequestToken}
            nodeDrafts={drafts.filter((d) => {
              const res = draftResolutions.get(d.draftId);
              return res?.status === 'matched' && res.nodeId === selectedNode.id;
            })}
            ambiguousDrafts={drafts.filter((d) => {
              // A renamed topic can be the intended manual target even if its old title still exists.
              const status = draftResolutions.get(d.draftId)?.status;
              return status === 'ambiguous' || status === 'unmatched';
            })}
            unpersistedDraftIds={unpersistedDraftIds}
            noteCommitTriggerRef={noteCommitTriggerRef}
            onCommitNote={handleCommitNote}
            onRescueNoteDraft={handleRescueNoteDraft}
            onRestoreTitleDraft={handleRestoreTitleDraft}
            onDeleteDraft={onDeleteDraft ? (id) => void onDeleteDraft(id) : undefined}
            onCopyDraftText={handleCopyDraftText}
            onClose={handleClosePopover}
            onJumpToSource={(line) => onOpenMarkdown(line)}
            onOpenLink={onOpenLink}
          />
        )}

        {stylesOpen && onUpdateSettings && (
          <QuickStylePopover
            settings={settings}
            messages={messages}
            onUpdateSettings={onUpdateSettings}
            onClose={handleCloseStyles}
          />
        )}

        <StatusBar
          document={doc}
          wordCount={textStats.wordCount}
          zoomPercent={zoomPercent}
          focusMode={focusMode}
          stylesOpen={stylesOpen}
          draftCount={drafts.length}
          messages={messages}
          canEdit={onDispatchCommand !== undefined}
          filterActive={visibility.filterActive}
          matchCount={visibility.matchedNodeIds.size}
          onZoomReset={handleZoomReset}
          onCycleFocus={handleCycleFocus}
          onToggleStyles={handleToggleStyles}
          onInspectDrafts={handleInspectDrafts}
        />
      </div>
    </div>
  );
}
