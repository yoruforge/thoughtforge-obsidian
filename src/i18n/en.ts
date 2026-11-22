export const en = {
  pluginName: 'ThoughtForge',
  commands: {
    openAsMap: 'Open current note as mind map',
    openMarkdownBeside: 'Open Markdown beside mind map',
  },
  toolbar: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Reset zoom (100%)',
    fitView: 'Fit map to view',
    focusOff: 'Focus: Off',
    focusFixed: 'Focus: Fixed',
    focusFollow: 'Focus: Follow',
    depthAll: 'Depth: All',
    depthLabel: 'Depth',
    filterPlaceholder: 'Quick Filter...',
    clearFilter: 'Clear filter',
    openMarkdown: 'Open Markdown',
    togglePopover: 'Node details',
  },
  status: {
    topicsCount: 'Topics',
    readOnlyBadge: 'Read-only',
    m1PreviewMode: 'Preview mode (M1 — editing arrives in M2)',
    largeMapWarning: 'Large map (3,001–5,000 topics): performance not guaranteed',
    filterMatches: 'Matches',
    noMatches: 'No matching topics',
  },
  blocked: {
    title: 'Cannot open this note as a mind map',
    openInMarkdown: 'Open in Markdown',
    reasons: {
      'file-too-large': 'The note exceeds the 2 MB size limit.',
      'too-many-topics': 'The note exceeds the 5,000-topic limit.',
      'unclosed-frontmatter': 'YAML frontmatter is missing a closing "---" delimiter.',
    },
  },
  readOnlyReasons: {
    'mixed-line-endings': 'Mixed line endings (CRLF and LF)',
    'bare-cr-line-endings': 'Bare CR line endings detected',
    'mixed-list-indent': 'Mixed tabs and spaces inside a list',
    'heading-inside-list': 'Heading found inside a list item',
    'malformed-frontmatter': 'Malformed YAML frontmatter',
    'overlapping-ranges': 'Overlapping topic source ranges',
    'unclassified-lines': 'Unclassified lines detected',
  },
  popover: {
    title: 'Topic details',
    close: 'Close',
    noteHeading: 'Topic note',
    noteEmpty: 'No topic note attached.',
    noteEditPlaceholder: 'Direct note editing will be enabled in M2 (Cmd/Ctrl+Enter to save).',
    unmappedHeading: 'Preserved non-map blocks',
    linksHeading: 'Links in title',
    jumpToSource: 'Jump to Markdown line',
    lineUnit: 'lines',
    sourceLine: 'Line',
    openExternalFailed: 'Blocked unsafe or unsupported link.',
    unresolvedLink: 'Target note not found in vault.',
  },
  settings: {
    heading: 'ThoughtForge settings',
    themeModeName: 'Map theme',
    themeModeDesc: 'Follow Obsidian light/dark mode or pin a map theme.',
    themeAuto: 'Follow Obsidian',
    themeLight: 'Light (Classic)',
    themeDark: 'Dark Solarized',
    rainbowName: 'Rainbow branches',
    rainbowDesc: 'Assign distinct colors to each main branch.',
    openModeName: 'Default open layout',
    openModeDesc: 'Choose where a mind map opens when triggered from a note.',
    openSplit: 'Split pane',
    openNewTab: 'New tab',
    imeGuardName: 'Japanese IME guard window (ms)',
    imeGuardDesc: 'Suppress Enter/Tab structural commands briefly after compositionend (used in M2).',
  },
  notices: {
    selectMarkdownNote: 'Please select a Markdown (.md) note first.',
    openMapFailed: 'Could not open mind map view.',
    unsafeLinkBlocked: 'Blocked opening an unsafe link.',
    noteNotFound: 'Linked note was not found in this vault.',
  },
} as const;

export type Messages = {
  readonly [K in keyof typeof en]: (typeof en)[K] extends string
    ? string
    : {
        readonly [P in keyof (typeof en)[K]]: (typeof en)[K][P] extends string
          ? string
          : { readonly [Q in keyof (typeof en)[K][P]]: string };
      };
};
