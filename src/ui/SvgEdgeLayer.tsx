import type { LayoutEdge, LayoutNode } from '../core/model';
import {
  getBranchColor,
  resolveLevelStyle,
  type MapThemePalette,
} from '../core/layout/theme';

export interface SvgEdgeLayerProps {
  readonly edges: readonly LayoutEdge[];
  readonly allLayoutNodes: ReadonlyMap<string, LayoutNode>;
  readonly dimmedNodeIds: ReadonlySet<string>;
  readonly palette: MapThemePalette;
  readonly rainbowBranches: boolean;
}

export function SvgEdgeLayer({
  edges,
  allLayoutNodes,
  dimmedNodeIds,
  palette,
  rainbowBranches,
}: SvgEdgeLayerProps) {
  return (
    <svg
      className="ito-edge-layer"
      width="1"
      height="1"
      aria-hidden="true"
    >
      {edges.map((edge) => {
        const targetLayout = allLayoutNodes.get(edge.toId);
        const levelStyle = resolveLevelStyle(targetLayout?.depth ?? 1);
        const strokeColor = getBranchColor(palette, edge.colorIndex, rainbowBranches);
        const isDimmed = dimmedNodeIds.has(edge.toId);

        return (
          <path
            key={`${edge.fromId}->${edge.toId}`}
            d={edge.pathD}
            fill="none"
            stroke={strokeColor}
            strokeWidth={levelStyle.edgeWidthPx}
            strokeLinecap="round"
            opacity={isDimmed ? 0.2 : 0.85}
          />
        );
      })}
    </svg>
  );
}
