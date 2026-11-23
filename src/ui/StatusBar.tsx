import type { FocusMode, MindMapDocument } from '../core/model';
import type { Messages } from '../i18n';
import { StylesPaletteIcon } from './Icons';

export interface StatusBarProps {
  readonly document: MindMapDocument;
  readonly wordCount: number;
  readonly zoomPercent: number;
  readonly focusMode: FocusMode;
  readonly stylesOpen: boolean;
  readonly draftCount?: number;
  readonly messages: Messages;
  readonly canEdit: boolean;
  readonly filterActive: boolean;
  readonly matchCount: number;
  readonly onZoomReset: () => void;
  readonly onCycleFocus: () => void;
  readonly onToggleStyles: () => void;
  readonly onInspectDrafts?: () => void;
}

export function StatusBar({
  document,
  wordCount,
  zoomPercent,
  focusMode,
  stylesOpen,
  draftCount = 0,
  messages,
  canEdit,
  filterActive,
  matchCount,
  onZoomReset,
  onCycleFocus,
  onToggleStyles,
  onInspectDrafts,
}: StatusBarProps) {
  const hasReadOnlyReasons = document.readOnlyReasons.length > 0;
  const reasonSummary = document.readOnlyReasons
    .map((reason) => messages.readOnlyReasons[reason])
    .join(' / ');

  const focusLabel =
    focusMode.kind === 'fixed'
      ? messages.toolbar.focusFixed
      : focusMode.kind === 'follow'
        ? messages.toolbar.focusFollow
        : messages.toolbar.focusOff;

  return (
    <footer className="ito-statusbar" role="status" aria-live="polite">
      <div className="ito-statusbar-left">
        <span className="ito-status-item">
          {messages.status.topicsCount}: {document.topicCount}
        </span>
        <span className="ito-status-item ito-status-muted">
          {messages.status.wordsCount}: {wordCount}
        </span>

        {hasReadOnlyReasons ? (
          <span className="ito-status-item ito-status-warning">
            {messages.status.readOnlyBadge}: {reasonSummary}
          </span>
        ) : (
          <span className="ito-status-item ito-status-muted ito-status-hint">
            {canEdit ? messages.status.m2EditReady : messages.status.m1PreviewMode}
          </span>
        )}

        {document.largeMapWarning && (
          <span className="ito-status-item ito-status-warning">
            {messages.status.largeMapWarning}
          </span>
        )}

        {filterActive && (
          <span className="ito-status-item ito-status-accent">
            {matchCount > 0
              ? `${messages.status.filterMatches}: ${matchCount}`
              : messages.status.noMatches}
          </span>
        )}
      </div>

      <div className="ito-statusbar-right">
        {draftCount > 0 && onInspectDrafts && (
          <button
            type="button"
            className="ito-status-btn ito-status-draft-btn"
            title={messages.status.draftsBadgeTooltip}
            onClick={(event) => {
              event.stopPropagation();
              onInspectDrafts();
            }}
          >
            {messages.status.draftsBadge}: {draftCount}
          </button>
        )}
        <button
          type="button"
          className={`ito-status-btn ito-status-focus-btn ${focusMode.kind !== 'off' ? 'ito-status-btn-active' : ''}`}
          title={messages.toolbar.focusTooltip}
          onClick={onCycleFocus}
        >
          {focusLabel}
        </button>
        <button
          type="button"
          className="ito-status-btn ito-btn-mono"
          title={messages.toolbar.zoomReset}
          onClick={onZoomReset}
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          className={`ito-status-btn ito-styles-trigger-btn ${stylesOpen ? 'ito-status-btn-active' : ''}`}
          aria-expanded={stylesOpen}
          onClick={(event) => {
            event.stopPropagation();
            onToggleStyles();
          }}
        >
          <StylesPaletteIcon />
          <span>{messages.toolbar.stylesButton}</span>
        </button>
      </div>
    </footer>
  );
}
