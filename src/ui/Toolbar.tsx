import { useEffect, useRef, useState, type RefObject } from 'react';
import type { FocusMode, StructuredFilterCriteria } from '../core/model';
import { hasActiveStructuredFilter } from '../core/view/filterFocus';
import type { Messages } from '../i18n';
import { FilterFunnelIcon, StylesPaletteIcon } from './Icons';
import { shouldHandlePopoverDocumentEscape } from './keyboardGuard';

export interface ToolbarProps {
  readonly messages: Messages;
  readonly zoomPercent: number;
  readonly focusMode: FocusMode;
  readonly filterQuery: string;
  readonly structuredFilter: StructuredFilterCriteria;
  readonly availableTags: readonly string[];
  readonly filterInputRef: RefObject<HTMLInputElement | null>;
  readonly popoverOpen: boolean;
  readonly stylesOpen: boolean;
  readonly canEditStyles: boolean;
  readonly onZoomOut: () => void;
  readonly onZoomReset: () => void;
  readonly onZoomIn: () => void;
  readonly onFitView: () => void;
  readonly onCycleFocus: () => void;
  readonly onApplyDepth: (depth: number) => void;
  readonly onFilterChange: (query: string) => void;
  readonly onStructuredFilterChange: (next: StructuredFilterCriteria) => void;
  readonly onTogglePopover: () => void;
  readonly onToggleStyles: () => void;
  readonly onOpenMarkdown: () => void;
}

export function Toolbar({
  messages,
  zoomPercent,
  focusMode,
  filterQuery,
  structuredFilter,
  availableTags,
  filterInputRef,
  popoverOpen,
  stylesOpen,
  canEditStyles,
  onZoomOut,
  onZoomReset,
  onZoomIn,
  onFitView,
  onCycleFocus,
  onApplyDepth,
  onFilterChange,
  onStructuredFilterChange,
  onTogglePopover,
  onToggleStyles,
  onOpenMarkdown,
}: ToolbarProps) {
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const structuredActive = hasActiveStructuredFilter(structuredFilter);

  useEffect(() => {
    if (!filterMenuOpen) return;
    const popoverEl = filterPopoverRef.current;
    const ownerDoc = popoverEl?.ownerDocument ?? document;
    const rootEl = popoverEl?.closest('.ito-root') ?? null;
    const handleDocKeyDown = (event: KeyboardEvent): void => {
      if (!shouldHandlePopoverDocumentEscape(ownerDoc, rootEl, event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setFilterMenuOpen(false);
    };
    ownerDoc.addEventListener('keydown', handleDocKeyDown, true);
    return () => ownerDoc.removeEventListener('keydown', handleDocKeyDown, true);
  }, [filterMenuOpen]);

  const focusLabel =
    focusMode.kind === 'fixed'
      ? messages.toolbar.focusFixed
      : focusMode.kind === 'follow'
        ? messages.toolbar.focusFollow
        : messages.toolbar.focusOff;

  const toggleFlag = (
    key: 'hasNote' | 'hasOpenTask' | 'hasCompletedTask' | 'hasLink' | 'hasUnmapped',
  ): void => {
    onStructuredFilterChange({
      ...structuredFilter,
      [key]: structuredFilter[key] === true ? undefined : true,
    });
  };

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
        <button
          type="button"
          className="ito-btn"
          title={messages.toolbar.fitViewTooltip}
          onClick={onFitView}
        >
          {messages.toolbar.fitView}
        </button>
      </div>

      <div className="ito-toolbar-group">
        <button
          type="button"
          className={`ito-btn ${focusMode.kind !== 'off' ? 'ito-btn-active' : ''}`}
          title={messages.toolbar.focusTooltip}
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
        <button
          type="button"
          className={`ito-btn ito-btn-icon ito-filter-funnel-btn ${structuredActive ? 'ito-btn-active' : ''}`}
          title={messages.toolbar.filterMenuLabel}
          aria-label={messages.toolbar.filterMenuLabel}
          aria-expanded={filterMenuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setFilterMenuOpen((prev) => !prev);
          }}
        >
          <FilterFunnelIcon />
        </button>

        <input
          ref={filterInputRef}
          type="search"
          className="ito-filter-input"
          value={filterQuery}
          placeholder={messages.toolbar.filterPlaceholder}
          aria-label={messages.toolbar.filterPlaceholder}
          onChange={(event) => onFilterChange(event.target.value)}
        />
        {(filterQuery.length > 0 || structuredActive) && (
          <button
            type="button"
            className="ito-btn ito-btn-icon"
            title={messages.toolbar.clearFilter}
            aria-label={messages.toolbar.clearFilter}
            onClick={() => {
              onFilterChange('');
              onStructuredFilterChange({});
            }}
          >
            ×
          </button>
        )}

        {filterMenuOpen && (
          <div
            ref={filterPopoverRef}
            className="ito-filter-popover"
            role="dialog"
            aria-label={messages.toolbar.filterMenuLabel}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setFilterMenuOpen(false);
                return;
              }
              event.stopPropagation();
            }}
          >
            <label className="ito-filter-check">
              <input
                type="checkbox"
                checked={structuredFilter.hasNote === true}
                onChange={() => toggleFlag('hasNote')}
              />
              <span>{messages.toolbar.filterHasNote}</span>
            </label>
            <label className="ito-filter-check">
              <input
                type="checkbox"
                checked={structuredFilter.hasOpenTask === true}
                onChange={() => toggleFlag('hasOpenTask')}
              />
              <span>{messages.toolbar.filterOpenTask}</span>
            </label>
            <label className="ito-filter-check">
              <input
                type="checkbox"
                checked={structuredFilter.hasCompletedTask === true}
                onChange={() => toggleFlag('hasCompletedTask')}
              />
              <span>{messages.toolbar.filterDoneTask}</span>
            </label>
            <label className="ito-filter-check">
              <input
                type="checkbox"
                checked={structuredFilter.hasLink === true}
                onChange={() => toggleFlag('hasLink')}
              />
              <span>{messages.toolbar.filterHasLink}</span>
            </label>
            <label className="ito-filter-check">
              <input
                type="checkbox"
                checked={structuredFilter.hasUnmapped === true}
                onChange={() => toggleFlag('hasUnmapped')}
              />
              <span>{messages.toolbar.filterHasUnmapped}</span>
            </label>

            {availableTags.length > 0 && (
              <div className="ito-filter-tags-section">
                <div className="ito-filter-tags-title">{messages.toolbar.filterTagsHeading}</div>
                <div className="ito-filter-tags-list">
                  {availableTags.map((tag) => {
                    const isSelected =
                      structuredFilter.tag?.toLowerCase() === tag.toLowerCase();
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`ito-tag-chip ${isSelected ? 'ito-tag-chip-active' : ''}`}
                        onClick={() =>
                          onStructuredFilterChange({
                            ...structuredFilter,
                            tag: isSelected ? undefined : tag,
                          })
                        }
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="ito-filter-popover-footer">
              <button
                type="button"
                className="ito-btn"
                onClick={() => {
                  onStructuredFilterChange({});
                  setFilterMenuOpen(false);
                }}
              >
                {messages.toolbar.filterReset}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="ito-toolbar-group">
        {canEditStyles && (
          <button
            type="button"
            className={`ito-btn ito-toolbar-styles-btn ${stylesOpen ? 'ito-btn-active' : ''}`}
            title={messages.styles.title}
            aria-expanded={stylesOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleStyles();
            }}
          >
            <StylesPaletteIcon />
            <span>{messages.toolbar.stylesButton}</span>
          </button>
        )}
        <button
          type="button"
          className={`ito-btn ${popoverOpen ? 'ito-btn-active' : ''}`}
          title={messages.toolbar.togglePopoverTooltip}
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
