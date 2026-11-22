import type { CSSProperties, MouseEvent } from 'react';
import type { LayoutNode, MindMapDocument, TopicLink } from '../core/model';
import {
  getBranchColor,
  resolveLevelStyle,
  type MapThemePalette,
} from '../core/layout/theme';
import type { EditingSession } from './editSession';
import { InlineEditor } from './InlineEditor';

export interface DomNodeLayerProps {
  readonly document: MindMapDocument;
  readonly visibleLayoutNodes: readonly LayoutNode[];
  readonly selectedId: string | null;
  readonly editingSession: EditingSession | null;
  readonly imeGuardWindowMs: number;
  readonly inlineEditorLabel: string;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly matchedNodeIds: ReadonlySet<string>;
  readonly effectiveCollapsedIds: ReadonlySet<string>;
  readonly palette: MapThemePalette;
  readonly rainbowBranches: boolean;
  readonly onSelectNode: (nodeId: string) => void;
  readonly onToggleCollapse: (nodeId: string) => void;
  readonly onOpenPopover: (nodeId: string) => void;
  readonly onOpenLink: (link: TopicLink, newTab: boolean) => void;
  readonly onStartEdit: (nodeId: string) => void;
  readonly onCommitEdit: (session: EditingSession, nextTitle: string) => void;
  readonly onCancelEdit: () => void;
  readonly onDiscardEdit: (unsavedValue: string) => void;
}

export function DomNodeLayer({
  document,
  visibleLayoutNodes,
  selectedId,
  editingSession,
  imeGuardWindowMs,
  inlineEditorLabel,
  dimmedNodeIds,
  matchedNodeIds,
  effectiveCollapsedIds,
  palette,
  rainbowBranches,
  onSelectNode,
  onToggleCollapse,
  onOpenPopover,
  onOpenLink,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onDiscardEdit,
}: DomNodeLayerProps) {
  return (
    <div className="ito-node-layer" role="tree" aria-label="Mind map topics">
      {visibleLayoutNodes.map((ln) => {
        const topic = document.nodes.get(ln.id);
        if (!topic) return null;

        const levelStyle = resolveLevelStyle(ln.depth);
        const branchColor = getBranchColor(palette, ln.branchColorIndex, rainbowBranches);
        const isCenter = ln.side === 'center';
        const isSelected = selectedId === ln.id;
        const isDimmed = dimmedNodeIds.has(ln.id);
        const isMatched = matchedNodeIds.has(ln.id);
        const hasChildren = topic.childIds.length > 0;
        const isCollapsed = effectiveCollapsedIds.has(ln.id);

        const nodeStyle: CSSProperties = {
          left: `${ln.x}px`,
          top: `${ln.y}px`,
          width: `${ln.width}px`,
          minHeight: `${ln.height}px`,
          fontSize: `${levelStyle.fontSizePx}px`,
          fontWeight: levelStyle.fontWeight,
          padding: `${levelStyle.paddingY}px ${levelStyle.paddingX}px`,
          borderRadius: `${levelStyle.borderRadiusPx}px`,
          opacity: isDimmed && !isSelected ? 0.28 : 1,
          backgroundColor: isCenter
            ? palette.centralBg
            : levelStyle.shape === 'underline'
              ? 'transparent'
              : palette.nodeBg,
          color: isCenter ? palette.centralText : palette.textPrimary,
          borderColor: isCenter ? palette.centralBorder : branchColor,
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

        const activeEditingSession =
          editingSession !== null && editingSession.nodeId === ln.id ? editingSession : null;
        const isEditing = activeEditingSession !== null;
        const classNames = [
          'ito-node',
          isCenter ? 'ito-node-center' : `ito-node-${ln.side}`,
          isSelected ? 'ito-node-selected' : '',
          isEditing ? 'ito-node-editing' : '',
          isMatched ? 'ito-node-matched' : '',
          levelStyle.shape === 'underline' ? 'ito-node-underline' : '',
        ]
          .filter(Boolean)
          .join(' ');

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
                key={`${activeEditingSession.guard.expectedContentHash}:${activeEditingSession.nodeId}`}
                initialValue={activeEditingSession.initialTitleRaw}
                imeGuardWindowMs={imeGuardWindowMs}
                ariaLabel={inlineEditorLabel}
                onCommit={(nextTitle) => onCommitEdit(activeEditingSession, nextTitle)}
                onCancel={onCancelEdit}
                onDiscard={onDiscardEdit}
              />
            ) : (
              <span className="ito-node-title">
                {topic.preservedPrefix.length > 0 && (
                  <span className="ito-node-task-prefix">{topic.preservedPrefix}</span>
                )}
                {topic.displayTitle.length > 0 ? topic.displayTitle : '(untitled)'}
              </span>
            )}

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
                    onClick={handleBadgeClick}
                  >
                    N
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
                    !
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
                    ↗
                  </button>
                )}
              </span>
            )}

            {hasChildren && !isCenter && (
              <button
                type="button"
                className={`ito-collapse-handle ito-collapse-handle-${ln.side}`}
                style={{ borderColor: branchColor, color: palette.textPrimary }}
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
