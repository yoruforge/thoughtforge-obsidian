export type LineEnding = '\n' | '\r\n';

/** 0-based line range [startLine, endLine). */
export interface LineRange {
  readonly startLine: number;
  readonly endLine: number;
}

/** 0-based UTF-16 code unit offset range [start, end) in LF-normalized text. */
export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

export type LineKind =
  | 'frontmatter'
  | 'heading'
  | 'list-item'
  | 'topic-note'
  | 'unmapped'
  | 'blank';

export type UnmappedKind =
  | 'frontmatter'
  | 'fenced-code'
  | 'indented-code'
  | 'table'
  | 'blockquote'
  | 'callout'
  | 'math-block'
  | 'html-block'
  | 'thematic-break'
  | 'footnote-def'
  | 'link-ref-def'
  | 'comment'
  | 'trailing-paragraph'
  | 'heading-in-list';

export interface UnmappedBlock {
  readonly kind: UnmappedKind;
  readonly range: LineRange;
  /** True when changing indentation alters block semantics (code, table, quote, etc.). */
  readonly indentSensitive: boolean;
}

export type TopicKind = 'central-virtual' | 'heading' | 'list-item';

export interface TopicLink {
  readonly kind: 'wikilink' | 'markdown' | 'url';
  readonly target: string;
  readonly label: string;
}

export interface TopicNode {
  readonly id: string;
  readonly kind: TopicKind;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly headingLevel: number | null;
  readonly listMarker: string | null;
  readonly indentColumns: number;
  /** 0-based source line index. Virtual central topics point to line 0. */
  readonly headerLine: number;
  readonly titleRange: OffsetRange | null;
  readonly titleRaw: string;
  readonly displayTitle: string;
  readonly links: readonly TopicLink[];
  readonly noteRange: LineRange | null;
  readonly noteText: string | null;
  readonly subtreeRange: LineRange;
  readonly ownRangeHash: string;
  readonly unmappedBlocks: readonly UnmappedBlock[];
  readonly preservedPrefix: string;
  readonly preservedBlockId: string | null;
}

export type BlockedReason =
  | 'file-too-large'
  | 'too-many-topics'
  | 'unclosed-frontmatter';

export type ReadOnlyReason =
  | 'mixed-line-endings'
  | 'bare-cr-line-endings'
  | 'mixed-list-indent'
  | 'heading-inside-list'
  | 'malformed-frontmatter'
  | 'overlapping-ranges'
  | 'unclassified-lines';

export interface MindMapDocument {
  readonly contentHash: string;
  readonly lineEnding: LineEnding;
  readonly lineCount: number;
  readonly lineKinds: readonly LineKind[];
  readonly rootId: string;
  readonly nodes: ReadonlyMap<string, TopicNode>;
  /** Count of topics excluding the central root node. */
  readonly topicCount: number;
  readonly readOnlyReasons: readonly ReadOnlyReason[];
  readonly largeMapWarning: boolean;
}

export type ParseResult =
  | {
      readonly status: 'blocked';
      readonly reason: BlockedReason;
      readonly detail: string;
    }
  | {
      readonly status: 'ok';
      readonly document: MindMapDocument;
    };

export type BranchSide = 'center' | 'right' | 'left';

export interface LayoutNode {
  readonly id: string;
  readonly side: BranchSide;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly branchColorIndex: number;
}

export interface LayoutEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly side: BranchSide;
  readonly pathD: string;
  readonly colorIndex: number;
}

export interface LayoutBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface LayoutResult {
  readonly nodes: ReadonlyMap<string, LayoutNode>;
  readonly edges: readonly LayoutEdge[];
  readonly bounds: LayoutBounds;
}

export type FocusMode =
  | { readonly kind: 'off' }
  | { readonly kind: 'fixed'; readonly anchorId: string }
  | { readonly kind: 'follow' };

export interface QuickFilterState {
  readonly query: string;
  readonly matchedIds: ReadonlySet<string>;
  readonly tempExpandedIds: ReadonlySet<string>;
  readonly userOpenedDuringFilterIds: ReadonlySet<string>;
}

export interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface PluginSettings {
  readonly themeMode: 'auto' | 'light' | 'dark-solarized';
  readonly rainbowBranches: boolean;
  readonly imeGuardWindowMs: number;
  readonly defaultOpenMode: 'split' | 'new-tab';
}

export interface DraftEntry {
  readonly draftId: string;
  readonly deviceId: string;
  readonly filePath: string;
  readonly field: 'title' | 'note';
  readonly targetTitleRaw: string;
  readonly baseContentHash: string;
  readonly text: string;
  readonly savedAt: number;
}

export interface PluginDataV1 {
  readonly schemaVersion: 1;
  readonly settings: PluginSettings;
  readonly drafts: readonly DraftEntry[];
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  themeMode: 'auto',
  rainbowBranches: true,
  imeGuardWindowMs: 300,
  defaultOpenMode: 'split',
};

export const DEFAULT_PLUGIN_DATA: PluginDataV1 = {
  schemaVersion: 1,
  settings: DEFAULT_PLUGIN_SETTINGS,
  drafts: [],
};
