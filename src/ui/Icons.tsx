/**
 * Minimal original React SVG icons for ThoughtForge UI controls and node badges.
 * Rendered strictly via JSX (no raw HTML injection).
 */

export function NoteIcon() {
  return (
    <svg className="ito-svg-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <rect x="2.5" y="2" width="11" height="12" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <line x1="5" y1="5.5" x2="11" y2="5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="5" y1="8.3" x2="11" y2="8.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="5" y1="11.1" x2="8.6" y2="11.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function BlockIcon() {
  return (
    <svg className="ito-svg-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <polyline points="5.5,4.2 2.2,8 5.5,11.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="10.5,4.2 13.8,8 10.5,11.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg className="ito-svg-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M6.5 9.5L12.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="8.3,3.5 12.5,3.5 12.5,7.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 9.5V12A1.5 1.5 0 0 1 9.5 13.5H4A1.5 1.5 0 0 1 2.5 12V6.5A1.5 1.5 0 0 1 4 5H6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function FilterFunnelIcon() {
  return (
    <svg className="ito-svg-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M2 3.2H14L9.4 8.4V12.6L6.6 13.8V8.4L2 3.2Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function StylesPaletteIcon() {
  return (
    <svg className="ito-svg-icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <line x1="2.5" y1="4.5" x2="13.5" y2="4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.7" fill="currentColor" />
      <line x1="2.5" y1="8.5" x2="13.5" y2="8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10.5" cy="8.5" r="1.7" fill="currentColor" />
      <line x1="2.5" y1="12.5" x2="13.5" y2="12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7.5" cy="12.5" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg className="ito-svg-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <polyline points="3.2,8.4 6.6,11.6 12.8,4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
