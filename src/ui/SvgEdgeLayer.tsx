import type { ColorStyleMode, LayoutEdge, LayoutNode } from '../core/model';
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
  readonly colorStyle: ColorStyleMode;
}

export function SvgEdgeLayer({
  edges,
  allLayoutNodes,
  dimmedNodeIds,
  palette,
  rainbowBranches,
  colorStyle,
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
        const branchColor = getBranchColor(palette, edge.colorIndex, rainbowBranches, colorStyle);
        const isDimmed = dimmedNodeIds.has(edge.toId);

        if (edge.renderMode === 'fill') {
          return (
            <path
              key={`${edge.fromId}->${edge.toId}`}
              d={edge.pathD}
              fill={branchColor}
              stroke="none"
              opacity={isDimmed ? 0.18 : 0.88}
            />
          );
        }

        return (
          <path
            key={`${edge.fromId}->${edge.toId}`}
            d={edge.pathD}
            fill="none"
            stroke={branchColor}
            strokeWidth={levelStyle.edgeWidthPx}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isDimmed ? 0.18 : 0.85}
          />
        );
      })}
    </svg>
  );
}
