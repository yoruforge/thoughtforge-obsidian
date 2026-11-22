import type {
  BranchSide,
  LayoutBounds,
  LayoutEdge,
  LayoutNode,
  LayoutResult,
  MindMapDocument,
  TopicNode,
} from '../model';
import { assignMainBranchSides } from './balance';
import { resolveLevelStyle } from './theme';

export interface NodeSize {
  readonly width: number;
  readonly height: number;
}

export interface NodeSizeMeasurer {
  measure(node: TopicNode, depth: number): NodeSize;
}

export interface LayoutSpacing {
  readonly horizontalGap: number;
  readonly verticalGap: number;
  readonly rootHorizontalGap: number;
}

export const DEFAULT_LAYOUT_SPACING: LayoutSpacing = {
  horizontalGap: 52,
  verticalGap: 16,
  rootHorizontalGap: 72,
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
    // Rough CJK / fullwidth detection
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
  measure(node: TopicNode, depth: number): NodeSize {
    const style = resolveLevelStyle(depth);
    const title = node.displayTitle.length > 0 ? node.displayTitle : '(untitled)';
    const badgeExtraWidth =
      (node.noteRange !== null ? 20 : 0) +
      (node.unmappedBlocks.length > 0 ? 20 : 0) +
      (node.links.length > 0 ? 18 : 0);

    const rawTextWidth = Math.ceil(estimateTextUnits(title) * style.fontSizePx);
    const contentMaxWidth = MAX_NODE_WIDTH - style.paddingX * 2;
    const wrappedLines = Math.max(1, Math.ceil((rawTextWidth + badgeExtraWidth) / contentMaxWidth));
    const singleLineWidth = rawTextWidth + badgeExtraWidth + style.paddingX * 2;
    const width = Math.max(
      MIN_NODE_WIDTH,
      Math.min(MAX_NODE_WIDTH, wrappedLines > 1 ? MAX_NODE_WIDTH : singleLineWidth),
    );
    const lineHeight = Math.ceil(style.fontSizePx * 1.4);
    const height = wrappedLines * lineHeight + style.paddingY * 2;
    return { width, height };
  },
};

function buildBezierEdge(
  parent: LayoutNode,
  child: LayoutNode,
  side: Exclude<BranchSide, 'center'>,
): LayoutEdge {
  const startX = side === 'right' ? parent.x + parent.width : parent.x;
  const startY = parent.y + parent.height / 2;

  const endX = side === 'right' ? child.x : child.x + child.width;
  const endY = child.y + child.height / 2;

  const dx = Math.abs(endX - startX);
  const cpOffset = Math.max(20, dx * 0.52);
  const cp1x = side === 'right' ? startX + cpOffset : startX - cpOffset;
  const cp2x = side === 'right' ? endX - cpOffset : endX + cpOffset;

  const pathD = `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${cp1x.toFixed(1)} ${startY.toFixed(1)}, ${cp2x.toFixed(1)} ${endY.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;

  return {
    fromId: parent.id,
    toId: child.id,
    side,
    pathD,
    colorIndex: child.branchColorIndex,
  };
}

export function computeLayout(
  doc: MindMapDocument,
  visibleNodeIds: ReadonlySet<string>,
  measurer: NodeSizeMeasurer = defaultNodeSizeMeasurer,
  spacing: LayoutSpacing = DEFAULT_LAYOUT_SPACING,
): LayoutResult {
  const root = doc.nodes.get(doc.rootId);
  if (!root) {
    return {
      nodes: new Map(),
      edges: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  const sizes = new Map<string, NodeSize>();
  const subtreeHeights = new Map<string, number>();
  const depths = new Map<string, number>();
  const colorIndices = new Map<string, number>();

  const visibleChildrenOf = (nodeId: string): readonly string[] => {
    const node = doc.nodes.get(nodeId);
    if (!node) return [];
    return node.childIds.filter((cid) => visibleNodeIds.has(cid));
  };

  // Pass 1: measure sizes and compute subtree heights bottom-up
  const measureSubtree = (nodeId: string, depth: number, branchColorIndex: number): number => {
    const node = doc.nodes.get(nodeId);
    if (!node) return 0;
    depths.set(nodeId, depth);
    colorIndices.set(nodeId, branchColorIndex);

    const size = measurer.measure(node, depth);
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

  const rootSize = measurer.measure(root, 0);
  sizes.set(root.id, rootSize);
  depths.set(root.id, 0);
  colorIndices.set(root.id, 0);

  const visibleMainBranches = visibleChildrenOf(root.id);
  const sideAssignments = assignMainBranchSides(visibleMainBranches);

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
    side: Exclude<BranchSide, 'center'>,
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
    layoutEdges.push(buildBezierEdge(parentLayout, placed, side));

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
    side: Exclude<BranchSide, 'center'>,
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

  // Pass 3: compute overall bounding box
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

  const bounds: LayoutBounds =
    layoutNodes.size > 0
      ? { minX, minY, maxX, maxY }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    bounds,
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
