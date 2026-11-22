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
  FocusMode,
  LayoutBounds,
  ParseResult,
  TopicLink,
} from '../core/model';
import type { SemanticCommand } from '../core/patch/commands';
import {
  computeDepthCollapsedIds,
  computeVisibilityAndEmphasis,
} from '../core/view/filterFocus';
import { resolveArrowNavigation, type ArrowDirection } from '../core/view/navigation';
import type { Messages } from '../i18n';
import type { CommandDispatchOutcome } from '../sync/ports';
import {
  buildCommitRenameCommand,
  buildPatchGuard,
  createEditingSession,
  isEditingSessionValid,
  type EditingSession,
} from './editSession';
import { NodePopover } from './NodePopover';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import {
  clampZoom,
  ViewportCanvas,
  type ViewportSize,
} from './ViewportCanvas';

export interface MindMapAppProps {
  readonly filePath: string;
  readonly parseResult: ParseResult;
  readonly themeMode: ResolvedThemeMode;
  readonly rainbowBranches: boolean;
  readonly imeGuardWindowMs: number;
  readonly messages: Messages;
  readonly onOpenMarkdown: (line?: number) => void;
  readonly onOpenLink: (link: TopicLink, newTab: boolean) => void;
  readonly onDispatchCommand?: (command: SemanticCommand) => Promise<CommandDispatchOutcome>;
  readonly onRegisterEditSelectedTrigger?: (trigger: (() => boolean) | null) => void;
  readonly onNotify?: (message: string) => void;
}

function computeFitCamera(bounds: LayoutBounds, size: ViewportSize): CameraState {
  const padding = 48;
  const contentW = Math.max(1, bounds.maxX - bounds.minX);
  const contentH = Math.max(1, bounds.maxY - bounds.minY);
  const availW = Math.max(100, size.width - padding * 2);
  const availH = Math.max(100, size.height - padding * 2);
  const zoom = clampZoom(Math.min(availW / contentW, availH / contentH, 1.15));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    x: size.width / 2 - centerX * zoom,
    y: size.height / 2 - centerY * zoom,
    zoom,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function MindMapApp({
  filePath,
  parseResult,
  themeMode,
  rainbowBranches,
  imeGuardWindowMs,
  messages,
  onOpenMarkdown,
  onOpenLink,
  onDispatchCommand,
  onRegisterEditSelectedTrigger,
  onNotify,
}: MindMapAppProps) {
  const palette = useMemo(() => getThemePalette(themeMode), [themeMode]);

  const doc = parseResult.status === 'ok' ? parseResult.document : null;

  const [selectedId, setSelectedId] = useState<string | null>(doc?.rootId ?? null);
  const [editingSession, setEditingSession] = useState<EditingSession | null>(null);
  const [baseCollapsedIds, setBaseCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [userOpenedDuringFilterIds, setUserOpenedDuringFilterIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [focusMode, setFocusMode] = useState<FocusMode>({ kind: 'off' });
  const [filterQuery, setFilterQuery] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [camera, setCamera] = useState<CameraState>({ x: 480, y: 320, zoom: 1 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const docRef = useRef(doc);
  docRef.current = doc;
  const viewportSizeRef = useRef<ViewportSize>({ width: 960, height: 640 });
  const hasInitialFitRef = useRef(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const isCommandInFlightRef = useRef(false);

  // Reset per-note view state when switching to a different Markdown file
  useEffect(() => {
    hasInitialFitRef.current = false;
    setBaseCollapsedIds(new Set());
    setUserOpenedDuringFilterIds(new Set());
    setFocusMode({ kind: 'off' });
    setFilterQuery('');
    setPopoverOpen(false);
    setEditingSession(null);
    setSelectedId(null);
  }, [filePath]);

  // Keep selection valid when the underlying document reloads
  const effectiveSelectedId = useMemo(() => {
    if (!doc) return null;
    if (selectedId !== null && doc.nodes.has(selectedId)) {
      return selectedId;
    }
    return doc.rootId;
  }, [doc, selectedId]);

  const effectiveEditingSession = useMemo(() => {
    return isEditingSessionValid(editingSession, filePath, doc) ? editingSession : null;
  }, [editingSession, filePath, doc]);

  const visibility = useMemo(() => {
    if (!doc) return null;
    return computeVisibilityAndEmphasis(doc, {
      baseCollapsedIds,
      focusMode,
      selectedId: effectiveSelectedId,
      filterQuery,
      userOpenedDuringFilterIds,
    });
  }, [doc, baseCollapsedIds, focusMode, effectiveSelectedId, filterQuery, userOpenedDuringFilterIds]);

  const layout = useMemo(() => {
    if (!doc || !visibility) return null;
    return computeLayout(doc, visibility.visibleNodeIds);
  }, [doc, visibility]);

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const fitView = useCallback(() => {
    const currentLayout = layoutRef.current;
    if (!currentLayout) return;
    setCamera(computeFitCamera(currentLayout.bounds, viewportSizeRef.current));
  }, []);

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
    ): Promise<void> => {
      if (!onDispatchCommand || isCommandInFlightRef.current) return;
      const startedFilePath = filePathRef.current;
      isCommandInFlightRef.current = true;
      try {
        const outcome = await onDispatchCommand(command);
        if (filePathRef.current !== startedFilePath) {
          return;
        }
        if (outcome.accepted && outcome.focusNodeId !== undefined) {
          if (expandParentId !== undefined) {
            setBaseCollapsedIds((prev) => {
              if (!prev.has(expandParentId)) return prev;
              const next = new Set(prev);
              next.delete(expandParentId);
              return next;
            });
          }
          setSelectedId(outcome.focusNodeId);
          if (openInlineEditorAfter && outcome.nextDocument !== undefined) {
            const focusedNode = outcome.nextDocument.nodes.get(outcome.focusNodeId);
            if (focusedNode) {
              setPopoverOpen(false);
              setEditingSession(
                createEditingSession(startedFilePath, outcome.nextDocument, focusedNode),
              );
            }
          }
        }
      } finally {
        isCommandInFlightRef.current = false;
      }
    },
    [onDispatchCommand],
  );

  const handleStartEdit = useCallback(
    (nodeId: string) => {
      if (!doc) return;
      if (!onDispatchCommand || doc.readOnlyReasons.length > 0) {
        setSelectedId(nodeId);
        setPopoverOpen(true);
        return;
      }
      const node = doc.nodes.get(nodeId);
      if (!node) return;
      setPopoverOpen(false);
      setSelectedId(nodeId);
      setEditingSession(createEditingSession(filePath, doc, node));
    },
    [doc, filePath, onDispatchCommand],
  );

  const handleDiscardEdit = useCallback(
    (unsavedValue: string) => {
      onNotify?.(`${messages.edit.unsavedInputDiscarded}${unsavedValue}`);
    },
    [messages, onNotify],
  );

  const handleCommitEdit = useCallback(
    (session: EditingSession, nextTitle: string) => {
      setEditingSession(null);
      rootRef.current?.focus();
      if (!onDispatchCommand) return;
      const command = buildCommitRenameCommand(session, filePathRef.current, nextTitle);
      if (command === null) {
        return;
      }
      // The note changed after editing began (e.g. a blur fired while the editor was being
      // removed): the write would be rejected as stale, so hand the typed text back instead.
      if (!isEditingSessionValid(session, filePathRef.current, docRef.current)) {
        handleDiscardEdit(nextTitle);
        return;
      }
      void dispatchAndFocus(command, false);
    },
    [onDispatchCommand, dispatchAndFocus, handleDiscardEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingSession(null);
    rootRef.current?.focus();
  }, []);

  const editSelectedTriggerRef = useRef<() => boolean>(() => false);
  editSelectedTriggerRef.current = (): boolean => {
    if (!doc || !layout) return false;
    if (effectiveEditingSession !== null) return false;
    if (effectiveSelectedId === null) return false;
    handleStartEdit(effectiveSelectedId);
    return true;
  };

  useEffect(() => {
    if (!onRegisterEditSelectedTrigger) return;
    const trigger = (): boolean => editSelectedTriggerRef.current();
    onRegisterEditSelectedTrigger(trigger);
    return () => {
      onRegisterEditSelectedTrigger(null);
    };
  }, [onRegisterEditSelectedTrigger]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return;
    if (!doc || !layout) return;
    if (effectiveEditingSession !== null) return;

    if (event.key === 'Escape') {
      if (popoverOpen) {
        event.preventDefault();
        setPopoverOpen(false);
        return;
      }
      if (filterQuery.length > 0) {
        event.preventDefault();
        handleFilterChange('');
        return;
      }
      if (focusMode.kind !== 'off') {
        event.preventDefault();
        setFocusMode({ kind: 'off' });
        return;
      }
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    // Zoom fit shortcut (Cmd/Ctrl + 0)
    if ((event.metaKey || event.ctrlKey) && event.key === '0') {
      event.preventDefault();
      fitView();
      return;
    }

    // Quick Filter focus (/)
    if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      filterInputRef.current?.focus();
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === 'F2' && effectiveSelectedId !== null) {
      event.preventDefault();
      handleStartEdit(effectiveSelectedId);
      return;
    }

    if (
      event.key === 'Tab' &&
      !event.shiftKey &&
      effectiveSelectedId !== null &&
      onDispatchCommand
    ) {
      const targetNode = doc.nodes.get(effectiveSelectedId);
      if (targetNode) {
        event.preventDefault();
        void dispatchAndFocus(
          {
            type: 'insertChild',
            guard: buildPatchGuard(doc, targetNode),
            title: messages.edit.newTopicTitle,
            position: 'end',
          },
          true,
          targetNode.id,
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
      const next = resolveArrowNavigation(doc, layout, effectiveSelectedId, arrowDir);
      if (next !== null) {
        setSelectedId(next);
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

    // TODO: [M2-b Classic Keymap 拡張] - Shift+Tab / Delete / Cmd+Arrow / Cmd+Z を FileCoordinator へ接続する
  };

  // Fail-closed blocked screen
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

  return (
    <div
      ref={rootRef}
      className={`ito-root ito-theme-${themeMode}`}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <Toolbar
        messages={messages}
        zoomPercent={Math.round(camera.zoom * 100)}
        focusMode={focusMode}
        filterQuery={filterQuery}
        filterInputRef={filterInputRef}
        popoverOpen={popoverOpen}
        onZoomOut={() => handleZoomBy(0.85)}
        onZoomReset={handleZoomReset}
        onZoomIn={() => handleZoomBy(1.15)}
        onFitView={fitView}
        onCycleFocus={handleCycleFocus}
        onApplyDepth={handleApplyDepth}
        onFilterChange={handleFilterChange}
        onTogglePopover={() => setPopoverOpen((prev) => !prev)}
        onOpenMarkdown={() => onOpenMarkdown(selectedNode?.headerLine)}
      />

      <div className="ito-stage">
        <ViewportCanvas
          document={doc}
          layout={layout}
          camera={camera}
          selectedId={effectiveSelectedId}
          editingSession={effectiveEditingSession}
          imeGuardWindowMs={imeGuardWindowMs}
          inlineEditorLabel={messages.edit.inlineEditorLabel}
          dimmedNodeIds={visibility.dimmedNodeIds}
          matchedNodeIds={visibility.matchedNodeIds}
          effectiveCollapsedIds={visibility.effectiveCollapsedIds}
          palette={palette}
          rainbowBranches={rainbowBranches}
          onCameraChange={setCamera}
          onViewportResize={handleViewportResize}
          onSelectNode={(id) => {
            setSelectedId(id);
            if (id === null) {
              setPopoverOpen(false);
              setEditingSession(null);
            }
          }}
          onToggleCollapse={handleToggleCollapse}
          onOpenPopover={(id) => {
            setSelectedId(id);
            setPopoverOpen(true);
          }}
          onOpenLink={onOpenLink}
          onStartEdit={handleStartEdit}
          onCommitEdit={handleCommitEdit}
          onCancelEdit={handleCancelEdit}
          onDiscardEdit={handleDiscardEdit}
        />

        {popoverOpen && selectedNode !== null && (
          <NodePopover
            node={selectedNode}
            messages={messages}
            isReadOnly={doc.readOnlyReasons.length > 0}
            onClose={() => setPopoverOpen(false)}
            onJumpToSource={(line) => onOpenMarkdown(line)}
            onOpenLink={onOpenLink}
          />
        )}
      </div>

      <StatusBar
        document={doc}
        messages={messages}
        canEdit={onDispatchCommand !== undefined}
        filterActive={visibility.filterActive}
        matchCount={visibility.matchedNodeIds.size}
      />
    </div>
  );
}
