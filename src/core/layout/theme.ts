import type { ColorStyleMode } from '../model';

export type ResolvedThemeMode = 'light' | 'dark-solarized';

export type NodeShape = 'rounded-pill' | 'rounded-rect' | 'underline';

export interface LevelStyleOverride {
  readonly fontSizePx?: number;
  readonly fontWeight?: number;
  readonly paddingX?: number;
  readonly paddingY?: number;
  readonly borderWidthPx?: number;
  readonly borderRadiusPx?: number;
  readonly shape?: NodeShape;
  readonly edgeWidthPx?: number;
}

export interface ResolvedLevelStyle {
  readonly fontSizePx: number;
  readonly fontWeight: number;
  readonly paddingX: number;
  readonly paddingY: number;
  readonly borderWidthPx: number;
  readonly borderRadiusPx: number;
  readonly shape: NodeShape;
  readonly edgeWidthPx: number;
}

export interface MapThemePalette {
  readonly mode: ResolvedThemeMode;
  readonly canvasBg: string;
  readonly textPrimary: string;
  readonly textMuted: string;
  readonly centralBg: string;
  readonly centralBorder: string;
  readonly centralText: string;
  readonly nodeBg: string;
  readonly defaultBranchColor: string;
  readonly monochromeAccent: string;
  readonly rainbowColors: readonly string[];
}

export interface NodeVisualColors {
  readonly backgroundColor: string;
  readonly borderColor: string;
  readonly textColor: string;
  readonly accentColor: string;
}

export const LIGHT_CLASSIC_PALETTE: MapThemePalette = {
  mode: 'light',
  canvasBg: '#f8f9fb',
  textPrimary: '#1f2937',
  textMuted: '#6b7280',
  centralBg: '#1e3a5f',
  centralBorder: '#152a45',
  centralText: '#ffffff',
  nodeBg: '#ffffff',
  defaultBranchColor: '#3b82f6',
  monochromeAccent: '#475569',
  rainbowColors: [
    '#2563eb', // blue
    '#059669', // emerald
    '#d97706', // amber
    '#dc2626', // red
    '#7c3aed', // violet
    '#0891b2', // cyan
    '#db2777', // pink
    '#4f46e5', // indigo
  ],
};

export const DARK_SOLARIZED_PALETTE: MapThemePalette = {
  mode: 'dark-solarized',
  canvasBg: '#002b36',
  textPrimary: '#eee8d5',
  textMuted: '#93a1a1',
  centralBg: '#073642',
  centralBorder: '#268bd2',
  centralText: '#fdf6e3',
  nodeBg: '#073642',
  defaultBranchColor: '#268bd2',
  monochromeAccent: '#839496',
  rainbowColors: [
    '#268bd2', // blue
    '#859900', // green
    '#b58900', // yellow
    '#cb4b16', // orange
    '#d33682', // magenta
    '#2aa198', // cyan
    '#6c71c4', // violet
    '#dc322f', // red
  ],
};

const BASE_LEVEL_STYLE: ResolvedLevelStyle = {
  fontSizePx: 13,
  fontWeight: 400,
  paddingX: 10,
  paddingY: 5,
  borderWidthPx: 1.5,
  borderRadiusPx: 6,
  shape: 'underline',
  edgeWidthPx: 1.5,
};

/**
 * Depth 0..9 style overrides. Omitted fields inherit from the parent level (AUTO inheritance).
 */
const LEVEL_OVERRIDES: readonly LevelStyleOverride[] = [
  // Depth 0: Central topic
  {
    fontSizePx: 18,
    fontWeight: 700,
    paddingX: 20,
    paddingY: 12,
    borderWidthPx: 2.5,
    borderRadiusPx: 24,
    shape: 'rounded-pill',
    edgeWidthPx: 3,
  },
  // Depth 1: Main branches
  {
    fontSizePx: 15,
    fontWeight: 600,
    paddingX: 14,
    paddingY: 8,
    borderWidthPx: 2,
    borderRadiusPx: 10,
    shape: 'rounded-rect',
    edgeWidthPx: 2.5,
  },
  // Depth 2
  {
    fontSizePx: 14,
    fontWeight: 500,
    paddingX: 12,
    paddingY: 6,
    borderWidthPx: 1.5,
    borderRadiusPx: 8,
    shape: 'rounded-rect',
    edgeWidthPx: 2,
  },
  // Depth 3
  {
    fontSizePx: 13,
    fontWeight: 400,
    paddingX: 10,
    paddingY: 5,
    shape: 'underline',
    edgeWidthPx: 1.5,
  },
  // Depth 4..9 inherit progressively
  { fontSizePx: 12.5 },
  { fontSizePx: 12 },
  {},
  {},
  {},
  {},
];

export function resolveLevelStyle(depth: number): ResolvedLevelStyle {
  const clamped = Math.max(0, Math.min(9, depth));
  let resolved: ResolvedLevelStyle = { ...BASE_LEVEL_STYLE };
  for (let d = 0; d <= clamped; d += 1) {
    const override = LEVEL_OVERRIDES[d];
    if (!override) continue;
    resolved = {
      fontSizePx: override.fontSizePx ?? resolved.fontSizePx,
      fontWeight: override.fontWeight ?? resolved.fontWeight,
      paddingX: override.paddingX ?? resolved.paddingX,
      paddingY: override.paddingY ?? resolved.paddingY,
      borderWidthPx: override.borderWidthPx ?? resolved.borderWidthPx,
      borderRadiusPx: override.borderRadiusPx ?? resolved.borderRadiusPx,
      shape: override.shape ?? resolved.shape,
      edgeWidthPx: override.edgeWidthPx ?? resolved.edgeWidthPx,
    };
  }
  return resolved;
}

export function getThemePalette(mode: ResolvedThemeMode): MapThemePalette {
  return mode === 'dark-solarized' ? DARK_SOLARIZED_PALETTE : LIGHT_CLASSIC_PALETTE;
}

export function getBranchColor(
  palette: MapThemePalette,
  branchColorIndex: number,
  rainbowBranches: boolean,
  colorStyle: ColorStyleMode = 'pastel-fill',
): string {
  if (colorStyle === 'monochrome') {
    return palette.monochromeAccent;
  }
  if (!rainbowBranches) {
    return palette.defaultBranchColor;
  }
  const len = palette.rainbowColors.length;
  if (len === 0) return palette.defaultBranchColor;
  const idx = ((branchColorIndex % len) + len) % len;
  return palette.rainbowColors[idx] ?? palette.defaultBranchColor;
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return hex;
  }
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Resolves surface, border, and text colors for a topic node according to
 * depth shape, theme mode, and active colorStyle ('pastel-fill' | 'wireframe' | 'monochrome').
 */
export function resolveNodeVisualColors(
  palette: MapThemePalette,
  branchColor: string,
  shape: NodeShape,
  colorStyle: ColorStyleMode,
  isCenter: boolean,
): NodeVisualColors {
  if (isCenter) {
    if (colorStyle === 'monochrome') {
      return {
        backgroundColor: palette.mode === 'dark-solarized' ? '#073642' : '#334155',
        borderColor: palette.monochromeAccent,
        textColor: palette.centralText,
        accentColor: palette.monochromeAccent,
      };
    }
    return {
      backgroundColor: palette.centralBg,
      borderColor: palette.centralBorder,
      textColor: palette.centralText,
      accentColor: palette.centralBorder,
    };
  }

  if (shape === 'underline') {
    return {
      backgroundColor: 'transparent',
      borderColor: branchColor,
      textColor: palette.textPrimary,
      accentColor: branchColor,
    };
  }

  if (colorStyle === 'wireframe') {
    return {
      backgroundColor: palette.nodeBg,
      borderColor: branchColor,
      textColor: palette.textPrimary,
      accentColor: branchColor,
    };
  }

  const tintAlpha =
    colorStyle === 'monochrome'
      ? palette.mode === 'dark-solarized'
        ? 0.16
        : 0.08
      : palette.mode === 'dark-solarized'
        ? 0.2
        : 0.11;

  return {
    backgroundColor: hexToRgba(branchColor, tintAlpha),
    borderColor: branchColor,
    textColor: palette.textPrimary,
    accentColor: branchColor,
  };
}
