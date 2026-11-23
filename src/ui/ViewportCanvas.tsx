import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
} from 'react';
import {
  cullLayoutToViewport,
  type ViewportRect,
} from '../core/layout/treeLayout';
import type { MapThemePalette } from '../core/layout/theme';
import type {
  CameraState,
  CanvasPattern,
  ColorStyleMode,
  LayoutResult,
  MindMapDocument,
  TopicLink,
} from '../core/model';
import { DomNodeLayer } from './DomNodeLayer';
import type { EditingSession } from './editSession';
import type { GuardableKeyEvent } from './imeGuard';
import { SvgEdgeLayer } from './SvgEdgeLayer';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface ViewportCanvasProps {
  readonly document: MindMapDocument;
  readonly layout: LayoutResult;
  readonly camera: CameraState;
  readonly selectedId: string | null;
  readonly editingSession: EditingSession | null;
  readonly imeGuardWindowMs: number;
  readonly inlineEditorLabel: string;
  readonly toggleTaskAriaLabel: string;
  readonly canEdit: boolean;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly matchedNodeIds: ReadonlySet<string>;
  readonly effectiveCollapsedIds: ReadonlySet<string>;
  readonly numberingLabels: ReadonlyMap<string, string>;
  readonly palette: MapThemePalette;
  readonly rainbowBranches: boolean;
  readonly colorStyle: ColorStyleMode;
  readonly canvasPattern: CanvasPattern;
  readonly onCameraChange: (next: CameraState) => void;
  readonly onViewportResize: (size: ViewportSize) => void;
  readonly onSelectNode: (nodeId: string | null) => void;
  readonly onToggleCollapse: (nodeId: string) => void;
  readonly onOpenPopover: (nodeId: string) => void;
  readonly onOpenLink: (link: TopicLink, newTab: boolean) => void;
  readonly onStartEdit: (nodeId: string) => void;
  readonly onCommitEdit: (session: EditingSession, nextTitle: string) => void;
  readonly onSplitEdit: (session: EditingSession, leftTitle: string, rightTitle: string) => void;
  readonly inlineSplitTriggerRef?: MutableRefObject<((event: GuardableKeyEvent) => boolean) | null>;
  readonly onCancelEdit: () => void;
  readonly onDiscardEdit: (unsavedValue: string) => void;
  readonly onToggleTask: (nodeId: string) => void;
}

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function ViewportCanvas({
  document,
  layout,
  camera,
  selectedId,
  editingSession,
  imeGuardWindowMs,
  inlineEditorLabel,
  toggleTaskAriaLabel,
  canEdit,
  dimmedNodeIds,
  matchedNodeIds,
  effectiveCollapsedIds,
  numberingLabels,
  palette,
  rainbowBranches,
  colorStyle,
  canvasPattern,
  onCameraChange,
  onViewportResize,
  onSelectNode,
  onToggleCollapse,
  onOpenPopover,
  onOpenLink,
  onStartEdit,
  onCommitEdit,
  onSplitEdit,
  inlineSplitTriggerRef,
  onCancelEdit,
  onDiscardEdit,
  onToggleTask,
}: ViewportCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 960, height: 640 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  const dragStateRef = useRef<{
    readonly pointerId: number;
    readonly startClientX: number;
    readonly startClientY: number;
    readonly originCameraX: number;
    readonly originCameraY: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleNativeWheel = (event: globalThis.WheelEvent): void => {
      event.preventDefault();
      const current = cameraRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.1 : 0.9;
        const nextZoom = clampZoom(current.zoom * factor);
        const scaleRatio = nextZoom / current.zoom;
        onCameraChangeRef.current({
          x: pointerX - (pointerX - current.x) * scaleRatio,
          y: pointerY - (pointerY - current.y) * scaleRatio,
          zoom: nextZoom,
        });
      } else {
        onCameraChangeRef.current({
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
          zoom: current.zoom,
        });
      }
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleNativeWheel);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nextSize: ViewportSize = { width: rect.width, height: rect.height };
        setViewportSize(nextSize);
        onViewportResize(nextSize);
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onViewportResize]);

  const culled = useMemo(() => {
    const worldRect: ViewportRect = {
      minX: -camera.x / camera.zoom,
      minY: -camera.y / camera.zoom,
      maxX: (viewportSize.width - camera.x) / camera.zoom,
      maxY: (viewportSize.height - camera.y) / camera.zoom,
    };
    return cullLayoutToViewport(layout, worldRect, 300);
  }, [layout, camera, viewportSize]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    onSelectNode(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originCameraX: camera.x,
      originCameraY: camera.y,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onCameraChange({
      x: drag.originCameraX + (event.clientX - drag.startClientX),
      y: drag.originCameraY + (event.clientY - drag.startClientY),
      zoom: camera.zoom,
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  };

  const canvasClassName = [
    'ito-canvas-viewport',
    `ito-canvas-pattern-${canvasPattern}`,
  ].join(' ');

  return (
    <div
      ref={containerRef}
      className={canvasClassName}
      style={{ backgroundColor: palette.canvasBg }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="ito-world"
        style={{
          transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
        }}
      >
        <SvgEdgeLayer
          edges={culled.edges}
          allLayoutNodes={layout.nodes}
          dimmedNodeIds={dimmedNodeIds}
          palette={palette}
          rainbowBranches={rainbowBranches}
          colorStyle={colorStyle}
        />
        <DomNodeLayer
          document={document}
          visibleLayoutNodes={culled.nodes}
          selectedId={selectedId}
          editingSession={editingSession}
          imeGuardWindowMs={imeGuardWindowMs}
          inlineEditorLabel={inlineEditorLabel}
          toggleTaskAriaLabel={toggleTaskAriaLabel}
          canEdit={canEdit}
          dimmedNodeIds={dimmedNodeIds}
          matchedNodeIds={matchedNodeIds}
          effectiveCollapsedIds={effectiveCollapsedIds}
          numberingLabels={numberingLabels}
          palette={palette}
          rainbowBranches={rainbowBranches}
          colorStyle={colorStyle}
          onSelectNode={(id) => onSelectNode(id)}
          onToggleCollapse={onToggleCollapse}
          onOpenPopover={onOpenPopover}
          onOpenLink={onOpenLink}
          onStartEdit={onStartEdit}
          onCommitEdit={onCommitEdit}
          onSplitEdit={onSplitEdit}
          inlineSplitTriggerRef={inlineSplitTriggerRef}
          onCancelEdit={onCancelEdit}
          onDiscardEdit={onDiscardEdit}
          onToggleTask={onToggleTask}
        />
      </div>
    </div>
  );
}
