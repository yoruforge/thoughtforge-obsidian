export const en = {
  pluginName: 'ThoughtForge',
  commands: {
    openAsMap: 'Open current note as mind map',
    openMarkdownBeside: 'Open Markdown beside mind map',
    undo: 'Undo last mind map edit',
    redo: 'Redo last mind map edit',
    toggleTask: 'Toggle task checkbox on selected topic',
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
    m2EditReady: 'Edit ready (F2: rename / Tab: child / Enter: sibling / Del: delete / ⌘Z: undo)',
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
    noteEditPlaceholder:
      'Direct note editing with draft protection will be enabled in M2-c (Cmd/Ctrl+Enter to save).',
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
    imeGuardDesc: 'Suppress Enter/Tab commit and structural commands briefly after compositionend.',
  },
  edit: {
    newTopicTitle: 'New topic',
    inlineEditorLabel: 'Edit topic title',
    toggleTaskAriaLabel: 'Toggle task checkbox',
    readOnlyRejected: 'This note is read-only and cannot be edited from the map.',
    staleTarget: 'The note changed externally. Reloaded the latest content — please retry.',
    newlineRejected: 'Topic titles must be a single line.',
    emptyTitleRejected: 'Topic title cannot be empty.',
    blockSyntaxInTitleRejected:
      'A list topic title cannot start with Markdown block syntax such as #, -, 1., >, or ```.',
    unsavedInputDiscarded:
      'The note changed while you were typing, so the title was not saved. Your input: ',
    rootSiblingRejected: 'Cannot add a sibling to the central topic. Press Tab to add a child.',
    cannotModifyRoot: 'This structural operation cannot be applied to the central topic.',
    notATask: 'Only standard Markdown task list items ([ ] / [x]) can be toggled.',
    headingLevelOutOfRange: 'Cannot apply edit because heading depth would exceed Markdown H1–H6 limits.',
    mixedHeadingListRejected:
      'Cannot move or convert across heading and list item boundaries.',
    indentSensitiveRejected:
      'Edit cancelled because shifting indentation could alter a preserved block (code, table, callout, etc.).',
    cannotPromoteWithNoteOrUnmapped:
      'Cannot delete only this topic while promoting children because it contains a note or preserved block.',
    unmappedDeleteConfirmTitle: 'Delete branch with preserved blocks?',
    unmappedDeleteConfirmBody:
      'This branch contains preserved Markdown blocks (such as code blocks, tables, or callouts). Delete the entire branch? You can undo this with Cmd/Ctrl+Z.',
    unmappedDeleteConfirmCancel: 'Cancel',
    unmappedDeleteConfirmDelete: 'Delete branch',
    undoStale: 'Cannot undo/redo because the note was modified outside the mind map.',
    editorDirty: 'Save unsaved changes in the open Markdown editor before editing on the map.',
    editorUnknown: 'Could not verify the open Markdown editor state. Save the note and retry.',
    invariantRejected: 'Edit cancelled to protect Markdown structure and preserved blocks.',
    blockedDocument: 'This note cannot be edited because it exceeds map safety limits.',
    unsupportedCommand: 'This edit action is not enabled yet.',
    ioError: 'Failed to save changes to the Markdown file.',
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
