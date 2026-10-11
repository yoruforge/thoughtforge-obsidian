// The shared map styles every color through --vscode-* variables with light fallbacks. Obsidian has no such
// variables, so the map stayed white in a dark theme. Map Obsidian's theme variables onto them.
// Each target takes the first Obsidian variable that has a usable value, so a missing one never falls back to the
// light default (an input on a white background with light text was unreadable in a dark theme).
const THEME_VARS: ReadonlyArray<readonly [string, ...string[]]> = [
  ['--vscode-editor-background', '--background-primary'],
  ['--vscode-foreground', '--text-normal'],
  ['--vscode-editor-foreground', '--text-normal'],
  ['--vscode-descriptionForeground', '--text-muted', '--text-normal'],
  ['--vscode-focusBorder', '--interactive-accent', '--text-accent'],
  ['--vscode-panel-border', '--background-modifier-border', '--text-faint'],
  ['--vscode-sideBar-background', '--background-secondary', '--background-primary'],
  ['--vscode-list-activeSelectionBackground', '--interactive-accent', '--text-accent'],
  ['--vscode-list-activeSelectionForeground', '--text-on-accent', '--background-primary'],
  ['--vscode-list-hoverBackground', '--background-modifier-hover', '--background-secondary'],
  ['--vscode-input-background', '--background-modifier-form-field', '--background-primary-alt', '--background-primary'],
  ['--vscode-input-foreground', '--text-normal'],
  ['--vscode-input-border', '--background-modifier-border', '--text-faint'],
  ['--vscode-button-secondaryBackground', '--interactive-normal', '--background-secondary'],
  ['--vscode-button-secondaryForeground', '--text-normal'],
  ['--vscode-button-border', '--background-modifier-border', '--text-faint'],
  ['--vscode-toolbar-hoverBackground', '--interactive-hover', '--background-modifier-hover'],
  ['--vscode-editorWarning-foreground', '--text-warning', '--color-yellow'],
  ['--vscode-errorForeground', '--text-error', '--color-red'],
  ['--vscode-textLink-foreground', '--text-accent', '--interactive-accent'],
  ['--vscode-textCodeBlock-background', '--code-background', '--background-secondary'],
  ['--vscode-textPreformat-foreground', '--code-normal', '--text-normal'],
  ['--vscode-menu-background', '--background-primary'],
  ['--vscode-menu-foreground', '--text-normal'],
  ['--vscode-menu-border', '--background-modifier-border', '--text-faint'],
  ['--vscode-menu-selectionBackground', '--interactive-accent', '--text-accent'],
  ['--vscode-menu-selectionForeground', '--text-on-accent', '--background-primary'],
  ['--vscode-menu-separatorBackground', '--background-modifier-border', '--text-faint'],
  ['--vscode-badge-background', '--interactive-accent', '--text-accent'],
  ['--vscode-badge-foreground', '--text-on-accent', '--background-primary'],
  ['--vscode-testing-iconPassed', '--color-green', '--text-success'],
  ['--vscode-font-family', '--font-interface'],
  ['--vscode-editor-font-family', '--font-monospace'],
];

/** Functions a color may use: color notations and color arithmetic. Anything else (url(), image-set(), gradients,
 * attr(), env() …) is refused, as are declarations, blocks and markup. */
const COLOR_FUNCTIONS = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|calc|min|max|clamp)$/i;

/** A value the frame may set for a variable: a color for color variables, a font list for fonts, light/dark for the
 * scheme. The frame applies the same rule (bootstrap.ts). */
export function safeThemeValue(name: string, value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 300) return false;
  if (name === 'color-scheme') return value === 'light' || value === 'dark';
  if (name.endsWith('font-family')) return /^[\p{L}\p{N}\s"',._-]+$/u.test(value); // localized names (e.g. 游ゴシック) too
  return /^[\w\s#.,%\/()*+-]+$/.test(value) && [...value.matchAll(/([a-z-]+)\s*\(/gi)].every(m => COLOR_FUNCTIONS.test(m[1]!));
}

export function obsidianThemeVars(doc: Document): Record<string, string> {
  if (!doc?.body) return {}; // no themed document (e.g. a detached view): keep the light fallbacks
  const style = doc.defaultView?.getComputedStyle(doc.body);
  const vars: Record<string, string> = { 'color-scheme': doc.body.classList.contains('theme-dark') ? 'dark' : 'light' };
  if (!style) return vars;
  for (const [target, ...sources] of THEME_VARS) {
    for (const source of sources) {
      const value = style.getPropertyValue(source).trim();
      if (safeThemeValue(target, value)) { vars[target] = value; break; }
    }
  }
  return vars;
}
