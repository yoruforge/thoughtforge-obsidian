import type { KeyboardEvent } from 'react';
import type { TopicLink, TopicNode } from '../core/model';
import type { Messages } from '../i18n';

export interface NodePopoverProps {
  readonly node: TopicNode;
  readonly messages: Messages;
  readonly isReadOnly: boolean;
  readonly onClose: () => void;
  readonly onJumpToSource: (line: number) => void;
  readonly onOpenLink: (link: TopicLink, newTab: boolean) => void;
}

export function NodePopover({
  node,
  messages,
  isReadOnly,
  onClose,
  onJumpToSource,
  onOpenLink,
}: NodePopoverProps) {
  const handlePopoverKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    event.stopPropagation();
  };

  return (
    <aside
      className="ito-popover"
      role="dialog"
      aria-label={messages.popover.title}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handlePopoverKeyDown}
    >
      <div className="ito-popover-header">
        <div className="ito-popover-title-wrap">
          <strong className="ito-popover-title">
            {node.displayTitle.length > 0 ? node.displayTitle : '(untitled)'}
          </strong>
          <span className="ito-popover-meta">
            {messages.popover.sourceLine} {node.headerLine + 1}
          </span>
        </div>
        <button
          type="button"
          className="ito-btn ito-btn-icon"
          aria-label={messages.popover.close}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="ito-popover-section">
        <div className="ito-popover-section-title">{messages.popover.noteHeading}</div>
        {node.noteText !== null ? (
          <pre className="ito-popover-note-preview">{node.noteText}</pre>
        ) : (
          <p className="ito-popover-empty">{messages.popover.noteEmpty}</p>
        )}
        {/* TODO: [M2 トピックノート直接編集] - textarea と Cmd/Ctrl+Enter 確定・Esc 取消・ブロック構文検査・field:'note' 下書き保存を接続する */}
        {!isReadOnly && (
          <p className="ito-popover-hint">{messages.popover.noteEditPlaceholder}</p>
        )}
      </div>

      {node.links.length > 0 && (
        <div className="ito-popover-section">
          <div className="ito-popover-section-title">{messages.popover.linksHeading}</div>
          <ul className="ito-popover-list">
            {node.links.map((link, index) => (
              <li key={`${link.kind}-${link.target}-${index}`}>
                <button
                  type="button"
                  className="ito-link-button"
                  onClick={(event) => onOpenLink(link, event.metaKey || event.ctrlKey)}
                >
                  {link.label} ({link.target})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.unmappedBlocks.length > 0 && (
        <div className="ito-popover-section">
          <div className="ito-popover-section-title">{messages.popover.unmappedHeading}</div>
          <ul className="ito-popover-list">
            {node.unmappedBlocks.map((block, index) => {
              const count = block.range.endLine - block.range.startLine;
              return (
                <li key={`${block.kind}-${block.range.startLine}-${index}`} className="ito-unmapped-item">
                  <span>
                    {block.kind} ({count} {messages.popover.lineUnit}, L{block.range.startLine + 1})
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="ito-popover-footer">
        <button
          type="button"
          className="ito-btn"
          onClick={() => onJumpToSource(node.headerLine)}
        >
          {messages.popover.jumpToSource}
        </button>
      </div>
    </aside>
  );
}
