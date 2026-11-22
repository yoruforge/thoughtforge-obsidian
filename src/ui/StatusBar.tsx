import type { MindMapDocument } from '../core/model';
import type { Messages } from '../i18n';

export interface StatusBarProps {
  readonly document: MindMapDocument;
  readonly messages: Messages;
  readonly canEdit: boolean;
  readonly filterActive: boolean;
  readonly matchCount: number;
}

export function StatusBar({
  document,
  messages,
  canEdit,
  filterActive,
  matchCount,
}: StatusBarProps) {
  const hasReadOnlyReasons = document.readOnlyReasons.length > 0;
  const reasonSummary = document.readOnlyReasons
    .map((reason) => messages.readOnlyReasons[reason])
    .join(' / ');

  return (
    <footer className="ito-statusbar" role="status" aria-live="polite">
      <span className="ito-status-item">
        {messages.status.topicsCount}: {document.topicCount}
      </span>

      {hasReadOnlyReasons ? (
        <span className="ito-status-item ito-status-warning">
          {messages.status.readOnlyBadge}: {reasonSummary}
        </span>
      ) : (
        <span className="ito-status-item ito-status-muted">
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
    </footer>
  );
}
