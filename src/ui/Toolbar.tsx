import type { RefObject } from 'react';
import type { FocusMode } from '../core/model';
import type { Messages } from '../i18n';

export interface ToolbarProps {
  readonly messages: Messages;
  readonly zoomPercent: number;
  readonly focusMode: FocusMode;
  readonly filterQuery: string;
  readonly filterInputRef: RefObject<HTMLInputElement | null>;
  readonly popoverOpen: boolean;
  readonly onZoomOut: () => void;
  readonly onZoomReset: () => void;
  readonly onZoomIn: () => void;
  readonly onFitView: () => void;
  readonly onCycleFocus: () => void;
  readonly onApplyDepth: (depth: number) => void;
  readonly onFilterChange: (query: string) => void;
  readonly onTogglePopover: () => void;
  readonly onOpenMarkdown: () => void;
}

export function Toolbar({
  messages,
  zoomPercent,
  focusMode,
  filterQuery,
  filterInputRef,
  popoverOpen,
  onZoomOut,
  onZoomReset,
  onZoomIn,
  onFitView,
  onCycleFocus,
  onApplyDepth,
  onFilterChange,
  onTogglePopover,
  onOpenMarkdown,
}: ToolbarProps) {
  const focusLabel =
    focusMode.kind === 'fixed'
      ? messages.toolbar.focusFixed
      : focusMode.kind === 'follow'
        ? messages.toolbar.focusFollow
        : messages.toolbar.focusOff;

  return (
    <header className="ito-toolbar" role="toolbar" aria-label="Mind map controls">
      <div className="ito-toolbar-group">
        <button type="button" className="ito-btn" title={messages.toolbar.zoomOut} onClick={onZoomOut}>
          −
        </button>
        <button type="button" className="ito-btn ito-btn-mono" title={messages.toolbar.zoomReset} onClick={onZoomReset}>
          {zoomPercent}%
        </button>
        <button type="button" className="ito-btn" title={messages.toolbar.zoomIn} onClick={onZoomIn}>
          +
        </button>
        <button type="button" className="ito-btn" onClick={onFitView}>
          {messages.toolbar.fitView}
        </button>
      </div>

      <div className="ito-toolbar-group">
        <button
          type="button"
          className={`ito-btn ${focusMode.kind !== 'off' ? 'ito-btn-active' : ''}`}
          onClick={onCycleFocus}
        >
          {focusLabel}
        </button>

        <select
          className="ito-select"
          aria-label={messages.toolbar.depthLabel}
          defaultValue=""
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            if (!Number.isNaN(parsed)) {
              onApplyDepth(parsed);
            }
            event.target.value = '';
          }}
        >
          <option value="" disabled>
            {messages.toolbar.depthLabel}
          </option>
          <option value="0">{messages.toolbar.depthAll}</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
      </div>

      <div className="ito-toolbar-group ito-toolbar-filter">
        <input
          ref={filterInputRef}
          type="search"
          className="ito-filter-input"
          value={filterQuery}
          placeholder={messages.toolbar.filterPlaceholder}
          aria-label={messages.toolbar.filterPlaceholder}
          onChange={(event) => onFilterChange(event.target.value)}
        />
        {filterQuery.length > 0 && (
          <button
            type="button"
            className="ito-btn ito-btn-icon"
            title={messages.toolbar.clearFilter}
            aria-label={messages.toolbar.clearFilter}
            onClick={() => onFilterChange('')}
          >
            ×
          </button>
        )}
      </div>

      <div className="ito-toolbar-group">
        <button
          type="button"
          className={`ito-btn ${popoverOpen ? 'ito-btn-active' : ''}`}
          onClick={onTogglePopover}
        >
          {messages.toolbar.togglePopover}
        </button>
        <button type="button" className="ito-btn" onClick={onOpenMarkdown}>
          {messages.toolbar.openMarkdown}
        </button>
      </div>
    </header>
  );
}
