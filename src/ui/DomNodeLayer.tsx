import {
  useState,
  type CSSProperties,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ColorStyleMode, LayoutNode, MindMapDocument, TopicLink } from '../core/model';
import {
  getBranchColor,
  resolveLevelStyle,
  resolveNodeVisualColors,
  type MapThemePalette,
} from '../core/layout/theme';
import { tokenizeTopicTitle } from '../core/view/topicPresentation';
import type { DropTarget } from './dragDrop';
import type { EditingSession } from './editSession';
import { BlockIcon, CheckIcon, LinkIcon, NoteIcon } from './Icons';
import type { GuardableKeyEvent } from './imeGuard';
import { InlineEditor } from './InlineEditor';

const STANDARD_TASK_PREFIX_RE = /^\[([ xX])\][ \t]+$/;

function formatNoteHoverPreview(noteText: string): string {
  const lines = noteText.trim().split('\n').slice(0, 4);
  const joined = lines.join('\n');
  if (joined.length > 220) {
    return `${joined.slice(0, 217)}…`;
  }
  return noteText.trim().split('\n').length > 4 ? `${joined}…` : joined;
}

function renderTitleWithTagPills(
  titleRaw: string,
  displayTitle: string,
  isVirtualRoot: boolean,
  isTaskDone: boolean,
  activeTagFilter: string | undefined,
  tagFilterTooltip: string,
  onToggleTagFilter?: (tag: string) => void,
) {
  if (isVirtualRoot) {
    const label = displayTitle.length > 0 ? displayTitle : '(untitled)';
    return <span className={isTaskDone ? 'ito-node-title-done' : undefined}>{label}</span>;
  }

  const segments = tokenizeTopicTitle(titleRaw);
  if (segments.length === 0) {
    const fallback = displayTitle.length > 0 ? displayTitle : '(untitled)';
    return <span className={isTaskDone ? 'ito-node-title-done' : undefined}>{fallback}</span>;
  }

  const hasAnyTag = segments.some((seg) => seg.kind === 'tag');
  if (!hasAnyTag) {
    const label = displayTitle.length > 0 ? displayTitle : '(untitled)';
    return <span className={isTaskDone ? 'ito-node-title-done' : undefined}>{label}</span>;
  }

  const normalizedActiveTag = activeTagFilter?.toLowerCase();

  return (
    <span className={isTaskDone ? 'ito-node-title-done' : undefined}>
      {segments.map((seg, index) => {
        if (seg.kind !== 'tag') {
          return <span key={`${index}-txt`}>{seg.text}</span>;
        }
        const isActive =
          normalizedActiveTag !== undefined && seg.text.toLowerCase() === normalizedActiveTag;
        if (onToggleTagFilter) {
          return (
            <button
              key={`${index}-${seg.text}`}
              type="button"
              className={`ito-node-tag-pill ${isActive ? 'ito-node-tag-pill-active' : ''}`}
              title={`${tagFilterTooltip}: ${seg.text}`}
              aria-pressed={isActive}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onToggleTagFilter(seg.text);
              }}
            >
              {seg.text}
            </button>
          );
        }
        return (
          <span
            key={`${index}-${seg.text}`}
            className={`ito-node-tag-pill ${isActive ? 'ito-node-tag-pill-active' : ''}`}
          >
            {seg.text}
          </span>
        );
      })}
    </span>
  );
}

export interface NodeThumbnailInfo {
  readonly src: string;
  readonly alt: string;
}

export interface DomNodeLayerProps {
  readonly document: MindMapDocument;
  readonly visibleLayoutNodes: readonly LayoutNode[];
  readonly selectedId: string | null;
  readonly editingSession: EditingSession | null;
  readonly imeGuardWindowMs: number;
  readonly inlineEditorLabel: string;
  readonly toggleTaskAriaLabel: string;
  readonly tagFilterTooltip: string;
  readonly activeTagFilter?: string;
  readonly canEdit: boolean;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly matchedNodeIds: ReadonlySet<string>;
  readonly effectiveCollapsedIds: ReadonlySet<string>;
  readonly numberingLabels: ReadonlyMap<string, string>;
  readonly nodeThumbnails?: ReadonlyMap<string, NodeThumbnailInfo>;
  readonly palette: MapThemePalette;
  readonly rainbowBranches: boolean;
  readonly colorStyle: ColorStyleMode;
  readonly draggedNodeId?: string | null;
  readonly dropTarget?: DropTarget | null;
  readonly onSelectNode: (nodeId: string) => void;
  readonly onToggleCollapse: (nodeId: string) => void;
  readonly onOpenPopover: (nodeId: string) => void;
  readonly onOpenLink: (link: TopicLink, newTab: boolean) => void;
  readonly onStartEdit: (nodeId: string) => void;
  readonly onCommitEdit: (session: EditingSession, nextTitle: string) => void;
  readonly onSplitEdit: (
    session: EditingSession,
    leftTitle: string,
    rightTitle: string,
    fullValue: string,
  ) => void;
  readonly inlineSplitTriggerRef?: MutableRefObject<((event: GuardableKeyEvent) => boolean) | null>;
  readonly onCancelEdit: () => void;
  readonly onDiscardEdit: (unsavedValue: string) => void;
  readonly onToggleTask: (nodeId: string) => void;
  readonly onToggleTagFilter?: (tag: string) => void;
  readonly onStartNodeDrag?: (
    nodeId: string,
    label: string,
    pointerId: number,
    clientX: number,
    clientY: number,
  ) => void;
}

export function DomNodeLayer({
  document,
  visibleLayoutNodes,
  selectedId,
  editingSession,
  imeGuardWindowMs,
  inlineEditorLabel,
  toggleTaskAriaLabel,
  tagFilterTooltip,
  activeTagFilter,
  canEdit,
  dimmedNodeIds,
  matchedNodeIds,
  effectiveCollapsedIds,
  numberingLabels,
  nodeThumbnails,
  palette,
  rainbowBranches,
  colorStyle,
  draggedNodeId = null,
  dropTarget = null,
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
  onToggleTagFilter,
  onStartNodeDrag,
}: DomNodeLayerProps) {
  const [hoveredNoteNodeId, setHoveredNoteNodeId] = useState<string | null>(null);
  const isReadOnly = !canEdit || document.readOnlyReasons.length > 0;

  return (
    <div className="ito-node-layer" role="tree" aria-label="Mind map topics">
      {visibleLayoutNodes.map((ln) => {
        const topic = document.nodes.get(ln.id);
        if (!topic) return null;

        const levelStyle = resolveLevelStyle(ln.depth);
        const branchColor = getBranchColor(palette, ln.branchColorIndex, rainbowBranches, colorStyle);
        const isCenter = ln.side === 'center';
        const isSelected = selectedId === ln.id;
        const isDimmed = dimmedNodeIds.has(ln.id);
        const isMatched = matchedNodeIds.has(ln.id);
        const hasChildren = topic.childIds.length > 0;
        const isCollapsed = effectiveCollapsedIds.has(ln.id);
        const visualColors = resolveNodeVisualColors(
          palette,
          branchColor,
          levelStyle.shape,
          colorStyle,
          isCenter,
        );

        const nodeStyle: CSSProperties = {
          left: `${ln.x}px`,
          top: `${ln.y}px`,
          width: `${ln.width}px`,
          minHeight: `${ln.height}px`,
          fontSize: `${levelStyle.fontSizePx}px`,
          fontWeight: levelStyle.fontWeight,
          padding: `${levelStyle.paddingY}px ${levelStyle.paddingX}px`,
          borderRadius: levelStyle.shape === 'underline' ? '2px 2px 0 0' : `${levelStyle.borderRadiusPx}px`,
          opacity: isDimmed && !isSelected ? 0.24 : 1,
          backgroundColor: visualColors.backgroundColor,
          color: visualColors.textColor,
          borderColor: visualColors.borderColor,
          borderWidth:
            levelStyle.shape === 'underline'
              ? `0 0 ${levelStyle.borderWidthPx}px 0`
              : `${levelStyle.borderWidthPx}px`,
          borderStyle: 'solid',
        };

        const handleCollapseClick = (event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation();
          onToggleCollapse(ln.id);
        };

        const handleBadgeClick = (event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation();
          onSelectNode(ln.id);
          onOpenPopover(ln.id);
        };

        const firstLink = topic.links[0];
        const handleLinkClick = (event: MouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation();
          if (firstLink) {
            onOpenLink(firstLink, event.metaKey || event.ctrlKey);
          }
        };

        const taskMatch =
          topic.kind === 'list-item' ? STANDARD_TASK_PREFIX_RE.exec(topic.preservedPrefix) : null;
        const isStandardTask = taskMatch !== null;
        const isTaskDone = taskMatch?.[1] === 'x' || taskMatch?.[1] === 'X';
        const numberLabel = numberingLabels.get(ln.id);

        const activeEditingSession =
          editingSession !== null && editingSession.nodeId === ln.id ? editingSession : null;
        const isEditing = activeEditingSession !== null;
        const isDragged = draggedNodeId === ln.id;
        const dropPlacement =
          dropTarget !== null && dropTarget.hoverNodeId === ln.id ? dropTarget.placement : null;
        const thumbnail = !isEditing ? nodeThumbnails?.get(ln.id) : undefined;
        const classNames = [
          'ito-node',
          isCenter ? 'ito-node-center' : `ito-node-${ln.side}`,
          isSelected ? 'ito-node-selected' : '',
          isEditing ? 'ito-node-editing' : '',
          isMatched ? 'ito-node-matched' : '',
          isDragged ? 'ito-node-dragging' : '',
          dropPlacement !== null ? `ito-node-drop-${dropPlacement}` : '',
          levelStyle.shape === 'underline' ? 'ito-node-underline' : '',
          thumbnail !== undefined ? 'ito-node-has-thumb' : '',
        ]
          .filter(Boolean)
          .join(' ');

        const handleNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
          if (event.button !== 0 || isCenter || isReadOnly || isEditing || !onStartNodeDrag) {
            return;
          }
          const rawTarget = event.target as { readonly closest?: (sel: string) => unknown } | null;
          if (typeof rawTarget?.closest === 'function' && rawTarget.closest('button, input')) {
            return;
          }
          event.stopPropagation();
          const label = topic.displayTitle.length > 0 ? topic.displayTitle : topic.titleRaw;
          onStartNodeDrag(ln.id, label, event.pointerId, event.clientX, event.clientY);
        };

        const showNoteHover = hoveredNoteNodeId === ln.id && topic.noteText !== null && !isEditing;

        const collapseHandleClass = [
          'ito-collapse-handle',
          `ito-collapse-handle-${ln.side}`,
          isCollapsed ? 'ito-collapse-handle-collapsed' : 'ito-collapse-handle-expanded',
        ].join(' ');

        const collapseHandleStyle: CSSProperties = isCollapsed
          ? {
              borderColor: branchColor,
              backgroundColor: branchColor,
              color: '#ffffff',
            }
          : {
              borderColor: branchColor,
              color: palette.textPrimary,
            };

        return (
          <div
            key={ln.id}
            role="treeitem"
            aria-level={ln.depth + 1}
            aria-selected={isSelected}
            aria-expanded={hasChildren ? !isCollapsed : undefined}
            tabIndex={isSelected ? 0 : -1}
            className={classNames}
            style={nodeStyle}
            onPointerDown={handleNodePointerDown}
            onClick={(event) => {
              event.stopPropagation();
              onSelectNode(ln.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              onSelectNode(ln.id);
              onStartEdit(ln.id);
            }}
          >
            {activeEditingSession !== null ? (
              <InlineEditor
                key={`${activeEditingSession.guard.expectedContentHash}:${activeEditingSession.nodeId}:${activeEditingSession.draftPrefillValue ?? ''}`}
                initialValue={
                  activeEditingSession.draftPrefillValue ?? activeEditingSession.initialTitleRaw
                }
                imeGuardWindowMs={imeGuardWindowMs}
                ariaLabel={inlineEditorLabel}
                onCommit={(nextTitle) => onCommitEdit(activeEditingSession, nextTitle)}
                onSplit={
                  !isCenter
                    ? (leftTitle, rightTitle, fullValue) =>
                        onSplitEdit(activeEditingSession, leftTitle, rightTitle, fullValue)
                    : undefined
                }
                splitTriggerRef={inlineSplitTriggerRef}
                onCancel={onCancelEdit}
                onDiscard={onDiscardEdit}
              />
            ) : (
              <div className="ito-node-row">
                {topic.preservedPrefix.length > 0 &&
                  (isStandardTask && !isReadOnly ? (
                    <button
                      type="button"
                      className={`ito-node-task-toggle ${isTaskDone ? 'ito-node-task-done' : ''}`}
                      aria-label={toggleTaskAriaLabel}
                      aria-pressed={isTaskDone}
                      onPointerDown={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectNode(ln.id);
                        onToggleTask(ln.id);
                      }}
                    >
                      {isTaskDone ? <CheckIcon /> : null}
                    </button>
                  ) : (
                    <span className="ito-node-task-prefix">{topic.preservedPrefix}</span>
                  ))}
                <span className="ito-node-title">
                  {numberLabel !== undefined && (
                    <span className="ito-node-number">{numberLabel}</span>
                  )}
                  {renderTitleWithTagPills(
                    topic.titleRaw,
                    topic.displayTitle,
                    topic.kind === 'central-virtual',
                    isTaskDone,
                    activeTagFilter,
                    tagFilterTooltip,
                    onToggleTagFilter,
                  )}
                </span>

                {(topic.noteRange !== null ||
                  topic.unmappedBlocks.length > 0 ||
                  firstLink !== undefined) && (
                  <span className="ito-node-badges">
                    {topic.noteRange !== null && (
                      <button
                        type="button"
                        className="ito-badge ito-badge-note"
                        title="Topic note"
                        aria-label="Open topic note"
                        onMouseEnter={() => setHoveredNoteNodeId(ln.id)}
                        onMouseLeave={() =>
                          setHoveredNoteNodeId((prev) => (prev === ln.id ? null : prev))
                        }
                        onClick={handleBadgeClick}
                      >
                        <NoteIcon />
                      </button>
                    )}
                    {topic.unmappedBlocks.length > 0 && (
                      <button
                        type="button"
                        className="ito-badge ito-badge-unmapped"
                        title="Preserved non-map content"
                        aria-label="Inspect preserved blocks"
                        onClick={handleBadgeClick}
                      >
                        <BlockIcon />
                      </button>
                    )}
                    {firstLink !== undefined && (
                      <button
                        type="button"
                        className="ito-badge ito-badge-link"
                        title={firstLink.target}
                        aria-label={`Open link ${firstLink.label}`}
                        onClick={handleLinkClick}
                      >
                        <LinkIcon />
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}

            {thumbnail !== undefined && (
              <div className="ito-node-thumb-wrap">
                <img
                  className="ito-node-thumb"
                  src={thumbnail.src}
                  alt={thumbnail.alt}
                  loading="lazy"
                  draggable={false}
                />
              </div>
            )}

            {showNoteHover && topic.noteText !== null && (
              <div className="ito-note-hover-preview" role="tooltip">
                {formatNoteHoverPreview(topic.noteText)}
              </div>
            )}

            {hasChildren && !isCenter && (
              <button
                type="button"
                className={collapseHandleClass}
                style={collapseHandleStyle}
                aria-label={isCollapsed ? 'Expand branch' : 'Collapse branch'}
                onClick={handleCollapseClick}
              >
                {isCollapsed ? topic.childIds.length : '−'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
