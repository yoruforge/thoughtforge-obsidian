import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  BranchEdgeStyle,
  CanvasPattern,
  ColorStyleMode,
  MapLayoutMode,
  PluginSettings,
  TopicNumberingMode,
} from '../core/model';
import type { Messages } from '../i18n';
import { shouldHandlePopoverDocumentEscape } from './keyboardGuard';

export interface QuickStylePopoverProps {
  readonly settings: PluginSettings;
  readonly messages: Messages;
  readonly onUpdateSettings: (patch: Partial<PluginSettings>) => void;
  readonly onClose: () => void;
}

interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

function SegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly SegmentedOption<T>[];
  readonly onChange: (next: T) => void;
}) {
  return (
    <div className="ito-style-row">
      <span className="ito-style-label">{label}</span>
      <div className="ito-segmented" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`ito-seg-btn ${value === opt.value ? 'ito-seg-btn-active' : ''}`}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuickStylePopover({
  settings,
  messages,
  onUpdateSettings,
  onClose,
}: QuickStylePopoverProps) {
  const popoverRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const s = messages.styles;
  const setMsg = messages.settings;

  // Move focus into the dialog once on open only (never steal focus on parent re-renders).
  useEffect(() => {
    popoverRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const ownerDoc = el.ownerDocument;
    const rootEl = el.closest('.ito-root');
    const handleDocKeyDown = (event: KeyboardEvent): void => {
      if (!shouldHandlePopoverDocumentEscape(ownerDoc, rootEl, event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    ownerDoc.addEventListener('keydown', handleDocKeyDown, true);
    return () => ownerDoc.removeEventListener('keydown', handleDocKeyDown, true);
  }, []);

  const handlePopoverKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    // Keep Tab/Shift+Tab/Enter/Space/Arrow keys strictly inside the dialog so
    // they never bubble to .ito-root and trigger map editing commands.
    event.stopPropagation();
  };

  const themeOptions: readonly SegmentedOption<PluginSettings['themeMode']>[] = [
    { value: 'auto', label: setMsg.themeAuto },
    { value: 'light', label: setMsg.themeLight },
    { value: 'dark-solarized', label: setMsg.themeDark },
  ];

  const colorOptions: readonly SegmentedOption<ColorStyleMode>[] = [
    { value: 'pastel-fill', label: s.colorPastel },
    { value: 'wireframe', label: s.colorWireframe },
    { value: 'monochrome', label: s.colorMonochrome },
  ];

  const layoutOptions: readonly SegmentedOption<MapLayoutMode>[] = [
    { value: 'balanced', label: s.layoutBalanced },
    { value: 'right', label: s.layoutRight },
    { value: 'org-chart', label: s.layoutOrgChart },
  ];

  const edgeOptions: readonly SegmentedOption<BranchEdgeStyle>[] = [
    { value: 'tapered', label: s.edgeTapered },
    { value: 'curved', label: s.edgeCurved },
    { value: 'orthogonal', label: s.edgeOrthogonal },
  ];

  const patternOptions: readonly SegmentedOption<CanvasPattern>[] = [
    { value: 'none', label: s.patternNone },
    { value: 'dots', label: s.patternDots },
    { value: 'grid', label: s.patternGrid },
  ];

  const numberingOptions: readonly SegmentedOption<TopicNumberingMode>[] = [
    { value: 'off', label: s.numberingOff },
    { value: 'decimal', label: s.numberingDecimal },
    { value: 'alpha', label: s.numberingAlpha },
  ];

  return (
    <aside
      ref={popoverRef}
      tabIndex={-1}
      className="ito-style-popover"
      role="dialog"
      aria-label={s.title}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handlePopoverKeyDown}
    >
      <div className="ito-style-header">
        <strong className="ito-style-title">{s.title}</strong>
        <button
          type="button"
          className="ito-btn ito-btn-icon"
          aria-label={s.close}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="ito-style-body">
        <SegmentedRow
          label={s.themeLabel}
          value={settings.themeMode}
          options={themeOptions}
          onChange={(themeMode) => onUpdateSettings({ themeMode })}
        />
        <SegmentedRow
          label={s.colorStyleLabel}
          value={settings.colorStyle}
          options={colorOptions}
          onChange={(colorStyle) => onUpdateSettings({ colorStyle })}
        />

        <label className="ito-style-toggle-row">
          <span className="ito-style-label">{s.rainbowLabel}</span>
          <input
            type="checkbox"
            checked={settings.rainbowBranches}
            onChange={(event) => onUpdateSettings({ rainbowBranches: event.target.checked })}
          />
        </label>

        <SegmentedRow
          label={s.layoutLabel}
          value={settings.layoutMode}
          options={layoutOptions}
          onChange={(layoutMode) => onUpdateSettings({ layoutMode })}
        />
        <SegmentedRow
          label={s.edgeStyleLabel}
          value={settings.edgeStyle}
          options={edgeOptions}
          onChange={(edgeStyle) => onUpdateSettings({ edgeStyle })}
        />
        <SegmentedRow
          label={s.canvasPatternLabel}
          value={settings.canvasPattern}
          options={patternOptions}
          onChange={(canvasPattern) => onUpdateSettings({ canvasPattern })}
        />
        <SegmentedRow
          label={s.numberingLabel}
          value={settings.topicNumbering}
          options={numberingOptions}
          onChange={(topicNumbering) => onUpdateSettings({ topicNumbering })}
        />
      </div>
    </aside>
  );
}
