import type {
  BranchEdgeStyle,
  BranchSide,
  LayoutBounds,
  LayoutEdge,
  LayoutNode,
  LayoutResult,
  MapLayoutMode,
  MindMapDocument,
  TopicNode,
} from '../model';
import { countRenderedTopicTags } from '../view/topicPresentation';
import { assignMainBranchSides } from './balance';
import { resolveLevelStyle } from './theme';

export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

export interface NodeSizeMeasurer {
  measure(node: TopicNode, depth: number, numberLabel?: string): NodeSize;
}

export interface LayoutSpacing {
  readonly horizontalGap: number;
  readonly verticalGap: number;
  readonly rootHorizontalGap: number;
  readonly orgColumnGap: number;
  readonly orgIndentStep: number;
  readonly orgRootVerticalGap: number;
}

export interface LayoutOptions {
  readonly layoutMode?: MapLayoutMode;
  readonly edgeStyle?: BranchEdgeStyle;
  readonly numberingLabels?: ReadonlyMap<string, string>;
}

export const DEFAULT_LAYOUT_SPACING: LayoutSpacing = {
  horizontalGap: 52,
  verticalGap: 16,
  rootHorizontalGap: 72,
  orgColumnGap: 44,
  orgIndentStep: 26,
  orgRootVerticalGap: 56,
};

export interface ViewportRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const MAX_NODE_WIDTH = 280;
const MIN_NODE_WIDTH = 72;

/**
 * Estimates CJK/Latin mixed display width without touching the DOM so layout
 * remains pure, deterministic, and testable in Node.
 */
export function estimateTextUnits(text: string): number {
  let units = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60)
    ) {
      units += 1.05;
    } else {
      units += 0.58;
    }
  }
  return units;
}

export const defaultNodeSizeMeasurer: NodeSizeMeasurer = {
  measure(node: TopicNode, depth: number, numberLabel?: string): NodeSize {
    const style = resolveLevelStyle(depth);
    const title = node.displayTitle.length > 0 ? node.displayTitle : '(untitled)';
    const borderX = style.shape === 'underline' ? 0 : Math.ceil(style.borderWidthPx * 2);
    const borderY =
      style.shape === 'underline'
        ? Math.ceil(style.borderWidthPx)
        : Math.ceil(style.borderWidthPx * 2);

    // Task toggle / preserved prefix sits as a flex sibling before .ito-node-title (+6px flex gap)
    const prefixExtraWidth = node.preservedPrefix.length > 0 ? 28 : 0;

    // Inline badges sit as a flex sibling after .ito-node-title (+6px flex gap when present)
    const badgeCount =
      (node.noteRange !== null ? 1 : 0) +
      (node.unmappedBlocks.length > 0 ? 1 : 0) +
      (node.links.length > 0 ? 1 : 0);
    const badgeExtraWidth =
      badgeCount > 0 ? badgeCount * 20 + Math.max(0, badgeCount - 1) * 3 + 6 : 0;

    // Non-destructive topic numbering badge (.ito-node-number: 0.78em + 8px padding + 6px margin)
    const numberExtraWidth =
      numberLabel !== undefined && numberLabel.length > 0
        ? Math.ceil(estimateTextUnits(numberLabel) * (style.fontSizePx * 0.82)) + 16
        : 0;

    // Inline #tag pills add horizontal pill padding (12px) + margin (4px) per rendered pill
    // (must count duplicates too, unlike deduplicated filter chip extraction).
    const tagCount =
      node.kind === 'central-virtual' ? 0 : countRenderedTopicTags(node.titleRaw);
    const tagExtraWidth = tagCount * 16;

    // Small safety margin for cross-platform font metric variance (macOS/Windows/Linux CJK)
    const horizontalSafetyBuffer = 8;

    const rawTextWidth = Math.ceil(estimateTextUnits(title) * style.fontSizePx);
    const titleInlineWidth = rawTextWidth + numberExtraWidth + tagExtraWidth + horizontalSafetyBuffer;
    const chromeWidth = style.paddingX * 2 + borderX + prefixExtraWidth + badgeExtraWidth;
    const titleMaxWidth = Math.max(80, MAX_NODE_WIDTH - chromeWidth);

    let wrappedLines = 1;
    let width: number;
    if (titleInlineWidth <= titleMaxWidth) {
      width = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, titleInlineWidth + chromeWidth));
    } else {
      // Reserve 14px per wrapped line for ragged word/tag-pill line endings
      const effectiveWrapWidth = Math.max(72, titleMaxWidth - 14);
      wrappedLines = Math.max(2, Math.ceil(titleInlineWidth / effectiveWrapWidth));
      width = MAX_NODE_WIDTH;
    }

    const lineHeight = Math.ceil(style.fontSizePx * 1.45);
    const height = wrappedLines * lineHeight + style.paddingY * 2 + borderY;
    return { width, height };
  },
};

function anchorYForNode(node: LayoutNode): number {
  const shape = resolveLevelStyle(node.depth).shape;
  // Attach branch curves to the bottom baseline of underline-shaped leaves so
  // the incoming curve flows continuously into the underline.
  if (shape === 'underline') {
    return node.y + node.height;
  }
  return node.y + node.height / 2;
}

function buildRadialEdge(
  parent: LayoutNode,
  child: LayoutNode,
  side: Exclude<BranchSide, 'center' | 'down'>,
  edgeStyle: BranchEdgeStyle,
): LayoutEdge {
  const startX = side === 'right' ? parent.x + parent.width : parent.x;
  const startY = anchorYForNode(parent);

  const endX = side === 'right' ? child.x : child.x + child.width;
  const endY = anchorYForNode(child);

  if (edgeStyle === 'orthogonal') {
    const midX = (startX + endX) / 2;
    const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} L ${midX.toFixed(1)} ${startY.toFixed(1)} L ${midX.toFixed(1)} ${endY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    return {
      fromId: parent.id,
      toId: child.id,
      side,
      pathD,
      colorIndex: child.branchColorIndex,
      renderMode: 'stroke',
    };
  }

  const dx = Math.abs(endX - startX);
  const cpOffset = Math.max(20, dx * 0.52);
  const cp1x = side === 'right' ? startX + cpOffset : startX - cpOffset;
  const cp2x = side === 'right' ? endX - cpOffset : endX + cpOffset;

  // Level 0 -> Level 1 tapered organic ribbon
  if (edgeStyle === 'tapered' && parent.depth === 0 && child.depth === 1) {
    const rStart = 4.6;
    const rEnd = 1.25;
    const pathD = [
      `M ${startX.toFixed(1)} ${(startY - rStart).toFixed(1)}`,
      `C ${cp1x.toFixed(1)} ${(startY - rStart * 0.85).toFixed(1)}, ${cp2x.toFixed(1)} ${(endY - rEnd).toFixed(1)}, ${endX.toFixed(1)} ${(endY - rEnd).toFixed(1)}`,
      `L ${endX.toFixed(1)} ${(endY + rEnd).toFixed(1)}`,
      `C ${cp2x.toFixed(1)} ${(endY + rEnd).toFixed(1)}, ${cp1x.toFixed(1)} ${(startY + rStart * 0.85).toFixed(1)}, ${startX.toFixed(1)} ${(startY + rStart).toFixed(1)}`,
      'Z',
    ].join(' ');
    return {
      fromId: parent.id,
      toId: child.id,
      side,
      pathD,
      colorIndex: child.branchColorIndex,
      renderMode: 'fill',
    };
  }

  const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${cp1x.toFixed(1)} ${startY.toFixed(1)}, ${cp2x.toFixed(1)} ${endY.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;

  return {
    fromId: parent.id,
    toId: child.id,
    side,
    pathD,
    colorIndex: child.branchColorIndex,
    renderMode: 'stroke',
  };
}

function buildOrgRootEdge(
  rootLayout: LayoutNode,
  branchLayout: LayoutNode,
  edgeStyle: BranchEdgeStyle,
): LayoutEdge {
  const startX = rootLayout.x + rootLayout.width / 2;
  const startY = rootLayout.y + rootLayout.height;
  const endX = branchLayout.x + branchLayout.width / 2;
  const endY = branchLayout.y;
  const midY = startY + (endY - startY) * 0.5;

  if (edgeStyle === 'curved' || edgeStyle === 'tapered') {
    const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${startX.toFixed(1)} ${midY.toFixed(1)}, ${endX.toFixed(1)} ${midY.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
    return {
      fromId: rootLayout.id,
      toId: branchLayout.id,
      side: 'down',
      pathD,
      colorIndex: branchLayout.branchColorIndex,
      renderMode: 'stroke',
    };
  }

  const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} L ${startX.toFixed(1)} ${midY.toFixed(1)} L ${endX.toFixed(1)} ${midY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`;
  return {
    fromId: rootLayout.id,
    toId: branchLayout.id,
    side: 'down',
    pathD,
    colorIndex: branchLayout.branchColorIndex,
    renderMode: 'stroke',
  };
}

function buildOrgChildElbowEdge(
  parent: LayoutNode,
  child: LayoutNode,
  stemInset: number,
): LayoutEdge {
  const stemX = parent.x + stemInset;
  const startY = parent.y + parent.height;
  const endX = child.x;
  const endY = anchorYForNode(child);
  const pathD = `M ${stemX.toFixed(1)} ${startY.toFixed(1)} L ${stemX.toFixed(1)} ${endY.toFixed(1)} L ${endX.toFixed(1)} ${endY.toFixed(1)}`;
  return {
    fromId: parent.id,
    toId: child.id,
    side: 'down',
    pathD,
    colorIndex: child.branchColorIndex,
    renderMode: 'stroke',
  };
}

function computeBounds(layoutNodes: ReadonlyMap<string, LayoutNode>): LayoutBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of layoutNodes.values()) {
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.x + node.width > maxX) maxX = node.x + node.width;
    if (node.y + node.height > maxY) maxY = node.y + node.height;
  }

  return layoutNodes.size > 0
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function computeOrgChartLayout(
  doc: MindMapDocument,
  root: TopicNode,
  visibleChildrenOf: (nodeId: string) => readonly string[],
  measurer: NodeSizeMeasurer,
  spacing: LayoutSpacing,
  edgeStyle: BranchEdgeStyle,
  numberingLabels?: ReadonlyMap<string, string>,
): LayoutResult {
  const sizes = new Map<string, NodeSize>();
  const columnWidths = new Map<string, number>();

  const measureOrgColumn = (nodeId: string, depth: number, indentOffset: number): number => {
    const node = doc.nodes.get(nodeId);
    if (!node) return 0;
    const size = measurer.measure(node, depth, numberingLabels?.get(nodeId));
    sizes.set(nodeId, size);

    let maxWidth = indentOffset + size.width;
    for (const childId of visibleChildrenOf(nodeId)) {
      const childMax = measureOrgColumn(childId, depth + 1, indentOffset + spacing.orgIndentStep);
      if (childMax > maxWidth) {
        maxWidth = childMax;
      }
    }
    columnWidths.set(nodeId, maxWidth);
    return maxWidth;
  };

  const rootSize = measurer.measure(root, 0, numberingLabels?.get(root.id));
  sizes.set(root.id, rootSize);

  const visibleMainBranches = visibleChildrenOf(root.id);
  let totalColumnsWidth = 0;
  for (let i = 0; i < visibleMainBranches.length; i += 1) {
    const branchId = visibleMainBranches[i];
    if (branchId === undefined) continue;
    const colW = measureOrgColumn(branchId, 1, 0);
    if (i > 0) totalColumnsWidth += spacing.orgColumnGap;
    totalColumnsWidth += colW;
  }

  const layoutNodes = new Map<string, LayoutNode>();
  const layoutEdges: LayoutEdge[] = [];

  const rootLayout: LayoutNode = {
    id: root.id,
    side: 'center',
    depth: 0,
    x: -rootSize.width / 2,
    y: -rootSize.height / 2,
    width: rootSize.width,
    height: rootSize.height,
    branchColorIndex: 0,
  };
  layoutNodes.set(root.id, rootLayout);

  const branchTopY = rootLayout.y + rootLayout.height + spacing.orgRootVerticalGap;
  let cursorX = -totalColumnsWidth / 2;

  const placeOrgDescendants = (
    nodeId: string,
    depth: number,
    x: number,
    startY: number,
    parentLayout: LayoutNode,
    branchColorIndex: number,
  ): number => {
    const size = sizes.get(nodeId);
    if (!size) return startY;
    const placed: LayoutNode = {
      id: nodeId,
      side: 'down',
      depth,
      x,
      y: startY,
      width: size.width,
      height: size.height,
      branchColorIndex,
    };
    layoutNodes.set(nodeId, placed);
    layoutEdges.push(buildOrgChildElbowEdge(parentLayout, placed, Math.min(14, spacing.orgIndentStep * 0.5)));

    let nextY = startY + size.height + spacing.verticalGap;
    for (const childId of visibleChildrenOf(nodeId)) {
      nextY = placeOrgDescendants(
        childId,
        depth + 1,
        x + spacing.orgIndentStep,
        nextY,
        placed,
        branchColorIndex,
      );
    }
    return nextY;
  };

  for (let i = 0; i < visibleMainBranches.length; i += 1) {
    const branchId = visibleMainBranches[i];
    if (branchId === undefined) continue;
    const colW = columnWidths.get(branchId) ?? 0;
    const size = sizes.get(branchId);
    if (!size) continue;

    const branchLayout: LayoutNode = {
      id: branchId,
      side: 'down',
      depth: 1,
      x: cursorX,
      y: branchTopY,
      width: size.width,
      height: size.height,
      branchColorIndex: i,
    };
    layoutNodes.set(branchId, branchLayout);
    layoutEdges.push(buildOrgRootEdge(rootLayout, branchLayout, edgeStyle));

    let childY = branchTopY + size.height + spacing.verticalGap;
    for (const childId of visibleChildrenOf(branchId)) {
      childY = placeOrgDescendants(
        childId,
        2,
        cursorX + spacing.orgIndentStep,
        childY,
        branchLayout,
        i,
      );
    }

    cursorX += colW + spacing.orgColumnGap;
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    bounds: computeBounds(layoutNodes),
  };
}

export function computeLayout(
  doc: MindMapDocument,
  visibleNodeIds: ReadonlySet<string>,
  measurer: NodeSizeMeasurer = defaultNodeSizeMeasurer,
  spacing: LayoutSpacing = DEFAULT_LAYOUT_SPACING,
  options?: LayoutOptions,
): LayoutResult {
  const root = doc.nodes.get(doc.rootId);
  if (!root) {
    return {
      nodes: new Map(),
      edges: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  const layoutMode: MapLayoutMode = options?.layoutMode ?? 'balanced';
  const edgeStyle: BranchEdgeStyle = options?.edgeStyle ?? 'tapered';
  const numberingLabels = options?.numberingLabels;

  const visibleChildrenOf = (nodeId: string): readonly string[] => {
    const node = doc.nodes.get(nodeId);
    if (!node) return [];
    return node.childIds.filter((cid) => visibleNodeIds.has(cid));
  };

  if (layoutMode === 'org-chart') {
    return computeOrgChartLayout(
      doc,
      root,
      visibleChildrenOf,
      measurer,
      spacing,
      edgeStyle,
      numberingLabels,
    );
  }

  const sizes = new Map<string, NodeSize>();
  const subtreeHeights = new Map<string, number>();
  const depths = new Map<string, number>();
  const colorIndices = new Map<string, number>();

  // Pass 1: measure sizes and compute subtree heights bottom-up
  const measureSubtree = (nodeId: string, depth: number, branchColorIndex: number): number => {
    const node = doc.nodes.get(nodeId);
    if (!node) return 0;
    depths.set(nodeId, depth);
    colorIndices.set(nodeId, branchColorIndex);

    const size = measurer.measure(node, depth, numberingLabels?.get(nodeId));
    sizes.set(nodeId, size);

    const children = visibleChildrenOf(nodeId);
    if (children.length === 0) {
      subtreeHeights.set(nodeId, size.height);
      return size.height;
    }

    let childrenTotalHeight = 0;
    for (let i = 0; i < children.length; i += 1) {
      const childId = children[i];
      if (childId === undefined) continue;
      if (i > 0) childrenTotalHeight += spacing.verticalGap;
      childrenTotalHeight += measureSubtree(childId, depth + 1, branchColorIndex);
    }

    const totalHeight = Math.max(size.height, childrenTotalHeight);
    subtreeHeights.set(nodeId, totalHeight);
    return totalHeight;
  };

  const rootSize = measurer.measure(root, 0, numberingLabels?.get(root.id));
  sizes.set(root.id, rootSize);
  depths.set(root.id, 0);
  colorIndices.set(root.id, 0);

  const visibleMainBranches = visibleChildrenOf(root.id);
  const sideAssignments =
    layoutMode === 'right'
      ? new Map(visibleMainBranches.map((id) => [id, 'right' as const]))
      : assignMainBranchSides(visibleMainBranches);

  const rightBranches: string[] = [];
  const leftBranches: string[] = [];
  for (let i = 0; i < visibleMainBranches.length; i += 1) {
    const branchId = visibleMainBranches[i];
    if (branchId === undefined) continue;
    measureSubtree(branchId, 1, i);
    if (sideAssignments.get(branchId) === 'left') {
      leftBranches.push(branchId);
    } else {
      rightBranches.push(branchId);
    }
  }

  const layoutNodes = new Map<string, LayoutNode>();
  const layoutEdges: LayoutEdge[] = [];

  const rootLayout: LayoutNode = {
    id: root.id,
    side: 'center',
    depth: 0,
    x: -rootSize.width / 2,
    y: -rootSize.height / 2,
    width: rootSize.width,
    height: rootSize.height,
    branchColorIndex: 0,
  };
  layoutNodes.set(root.id, rootLayout);

  // Pass 2: assign deterministic non-overlapping coordinates top-down
  const placeSubtree = (
    nodeId: string,
    side: Exclude<BranchSide, 'center' | 'down'>,
    edgeAnchorX: number,
    topY: number,
    parentLayout: LayoutNode,
  ): void => {
    const size = sizes.get(nodeId);
    const totalHeight = subtreeHeights.get(nodeId);
    const depth = depths.get(nodeId) ?? 1;
    const branchColorIndex = colorIndices.get(nodeId) ?? 0;
    if (!size || totalHeight === undefined) return;

    const x = side === 'right' ? edgeAnchorX : edgeAnchorX - size.width;
    const y = topY + (totalHeight - size.height) / 2;

    const placed: LayoutNode = {
      id: nodeId,
      side,
      depth,
      x,
      y,
      width: size.width,
      height: size.height,
      branchColorIndex,
    };
    layoutNodes.set(nodeId, placed);
    layoutEdges.push(buildRadialEdge(parentLayout, placed, side, edgeStyle));

    const children = visibleChildrenOf(nodeId);
    if (children.length === 0) return;

    let childrenBlockHeight = 0;
    for (let i = 0; i < children.length; i += 1) {
      const childId = children[i];
      if (childId === undefined) continue;
      if (i > 0) childrenBlockHeight += spacing.verticalGap;
      childrenBlockHeight += subtreeHeights.get(childId) ?? 0;
    }

    let cursorY = topY + (totalHeight - childrenBlockHeight) / 2;
    const nextAnchorX =
      side === 'right'
        ? x + size.width + spacing.horizontalGap
        : x - spacing.horizontalGap;

    for (const childId of children) {
      const childHeight = subtreeHeights.get(childId) ?? 0;
      placeSubtree(childId, side, nextAnchorX, cursorY, placed);
      cursorY += childHeight + spacing.verticalGap;
    }
  };

  const placeSideBranches = (
    branchIds: readonly string[],
    side: Exclude<BranchSide, 'center' | 'down'>,
  ): void => {
    if (branchIds.length === 0) return;
    let totalSideHeight = 0;
    for (let i = 0; i < branchIds.length; i += 1) {
      const id = branchIds[i];
      if (id === undefined) continue;
      if (i > 0) totalSideHeight += spacing.verticalGap * 1.4;
      totalSideHeight += subtreeHeights.get(id) ?? 0;
    }

    let cursorY = -totalSideHeight / 2;
    const anchorX =
      side === 'right'
        ? rootLayout.x + rootLayout.width + spacing.rootHorizontalGap
        : rootLayout.x - spacing.rootHorizontalGap;

    for (const id of branchIds) {
      const h = subtreeHeights.get(id) ?? 0;
      placeSubtree(id, side, anchorX, cursorY, rootLayout);
      cursorY += h + spacing.verticalGap * 1.4;
    }
  };

  placeSideBranches(rightBranches, 'right');
  placeSideBranches(leftBranches, 'left');

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    bounds: computeBounds(layoutNodes),
  };
}

/**
 * Viewport culling to keep DOM/SVG element counts bounded on large maps (3,000+ nodes).
 */
export function cullLayoutToViewport(
  layout: LayoutResult,
  viewport: ViewportRect,
  margin = 300,
): {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
} {
  const minX = viewport.minX - margin;
  const minY = viewport.minY - margin;
  const maxX = viewport.maxX + margin;
  const maxY = viewport.maxY + margin;

  const visibleNodes: LayoutNode[] = [];
  const visibleNodeIds = new Set<string>();

  for (const node of layout.nodes.values()) {
    const intersects =
      node.x + node.width >= minX &&
      node.x <= maxX &&
      node.y + node.height >= minY &&
      node.y <= maxY;
    if (intersects) {
      visibleNodes.push(node);
      visibleNodeIds.add(node.id);
    }
  }

  const visibleEdges: LayoutEdge[] = [];
  for (const edge of layout.edges) {
    if (visibleNodeIds.has(edge.fromId) || visibleNodeIds.has(edge.toId)) {
      visibleEdges.push(edge);
      continue;
    }
    const from = layout.nodes.get(edge.fromId);
    const to = layout.nodes.get(edge.toId);
    if (!from || !to) continue;
    const edgeMinX = Math.min(from.x, to.x);
    const edgeMaxX = Math.max(from.x + from.width, to.x + to.width);
    const edgeMinY = Math.min(from.y, to.y);
    const edgeMaxY = Math.max(from.y + from.height, to.y + to.height);
    if (edgeMaxX >= minX && edgeMinX <= maxX && edgeMaxY >= minY && edgeMinY <= maxY) {
      visibleEdges.push(edge);
    }
  }

  return { nodes: visibleNodes, edges: visibleEdges };
}
