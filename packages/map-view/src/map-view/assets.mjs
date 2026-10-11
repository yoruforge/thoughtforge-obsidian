import { renderV1MapHostBridgeScript } from "./adapters/v1.mjs";
import { createMapViewI18n } from "./i18n.mjs";
export { getMapViewDocumentTitle, resolveMapViewLocale } from "./i18n.mjs";
// Shared map assets, moved from the VS Code host in M1-X stage 1. Stage 2 keeps
// literal templates and delegates transport to the adapter. Hosts own the HTML
// shell, CSP and nonce; the embedded JS is not regenerated as an IIFE.
import { mountProposalPanel } from "../proposal-panel-runtime.mjs";
import { splitMapMainBranches } from "../map-sides.mjs";

export const mapViewCss = `      :root {
        color-scheme: light dark;
        font-family: var(--tf-font-family, var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif));
        color: var(--tf-foreground, var(--vscode-foreground, #1f2328));
        background: var(--tf-editor-background, var(--vscode-editor-background, #ffffff));
      }

      body {
        margin: 0;
      }

      .thoughtforge-shell {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        height: 100vh;
        overflow: hidden;
      }

      .thoughtforge-map {
        padding: 18px;
        overflow: auto;
        box-sizing: border-box;
      }

      .thoughtforge-map-toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0 0 12px;
        padding: 5px;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 6px;
        background: color-mix(in srgb, var(--tf-editor-background, var(--vscode-editor-background, #ffffff)) 94%, transparent);
      }

      .thoughtforge-map-toolbar button {
        min-width: 28px;
        height: 26px;
        border: 1px solid var(--tf-button-border, var(--vscode-button-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 4px;
        padding: 0 7px;
        color: var(--tf-button-secondaryForeground, var(--vscode-button-secondaryForeground, var(--tf-foreground, var(--vscode-foreground, #1f2328))));
        background: var(--tf-button-secondaryBackground, var(--vscode-button-secondaryBackground, transparent));
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-map-toolbar button:hover,
      .thoughtforge-map-toolbar button:focus-visible {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        outline: none;
      }

      .thoughtforge-map-toolbar button:disabled {
        opacity: 0.48;
        cursor: not-allowed;
      }

      .thoughtforge-map-zoom-value {
        min-width: 44px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        text-align: center;
      }

      .thoughtforge-title {
        margin: 0 0 12px;
        font-size: 16px;
        font-weight: 650;
      }

      .thoughtforge-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        border: 0;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .thoughtforge-hierarchy-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0 0 12px;
      }

      .thoughtforge-hierarchy-controls button {
        border: 1px solid var(--tf-button-border, var(--vscode-button-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 4px;
        padding: 4px 7px;
        color: var(--tf-button-secondaryForeground, var(--vscode-button-secondaryForeground, var(--tf-foreground, var(--vscode-foreground, #1f2328))));
        background: var(--tf-button-secondaryBackground, var(--vscode-button-secondaryBackground, transparent));
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-focus-breadcrumb {
        display: grid;
        gap: 6px;
        margin: 0 0 12px;
        padding: 6px;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 6px;
        background: var(--tf-sideBar-background, var(--vscode-sideBar-background, transparent));
        min-height: 26px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-size: 12px;
      }

      .thoughtforge-focus-breadcrumb-row,
      .thoughtforge-focus-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
      }

      .thoughtforge-focus-toolbar {
        padding-top: 5px;
        border-top: 1px solid color-mix(in srgb, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de)) 70%, transparent);
      }

      .thoughtforge-focus-breadcrumb[hidden] {
        display: none;
      }

      .thoughtforge-focus-breadcrumb button {
        border: 1px solid var(--tf-button-border, var(--vscode-button-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 4px;
        padding: 3px 6px;
        color: var(--tf-button-secondaryForeground, var(--vscode-button-secondaryForeground, var(--tf-foreground, var(--vscode-foreground, #1f2328))));
        background: var(--tf-button-secondaryBackground, var(--vscode-button-secondaryBackground, transparent));
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-focus-breadcrumb button:disabled {
        opacity: 0.48;
        cursor: not-allowed;
      }

      .thoughtforge-focus-breadcrumb button:hover,
      .thoughtforge-focus-breadcrumb button:focus-visible {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        outline: none;
      }

      .thoughtforge-focus-breadcrumb [data-current-focus="true"] {
        color: var(--tf-foreground, var(--vscode-foreground, #24292f));
        font-weight: 650;
      }

      .thoughtforge-focus-status {
        border-radius: 999px;
        padding: 2px 7px;
        color: var(--tf-badge-foreground, var(--vscode-badge-foreground, #ffffff));
        background: var(--tf-badge-background, var(--vscode-badge-background, #0969da));
        font-weight: 650;
      }

      .thoughtforge-focus-separator {
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
      }

      .thoughtforge-search-panel {
        display: grid;
        gap: 8px;
        margin: 0 0 12px;
        padding: 8px;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 6px;
        background: var(--tf-sideBar-background, var(--vscode-sideBar-background, transparent));
      }

      .thoughtforge-search-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto auto;
        gap: 6px;
        align-items: center;
      }

      .thoughtforge-search-input {
        min-width: 0;
        border: 1px solid var(--tf-input-border, var(--vscode-input-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 4px;
        padding: 4px 6px;
        color: var(--tf-input-foreground, var(--vscode-input-foreground, inherit));
        background: var(--tf-input-background, var(--vscode-input-background, transparent));
        font: inherit;
      }

      .thoughtforge-search-row button {
        border: 1px solid var(--tf-button-border, var(--vscode-button-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 4px;
        padding: 4px 7px;
        color: var(--tf-button-secondaryForeground, var(--vscode-button-secondaryForeground, var(--tf-foreground, var(--vscode-foreground, #1f2328))));
        background: var(--tf-button-secondaryBackground, var(--vscode-button-secondaryBackground, transparent));
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-search-row button:disabled {
        cursor: default;
        opacity: 0.55;
      }

      .thoughtforge-search-status,
      .thoughtforge-search-scope {
        min-height: 16px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-size: 12px;
      }

      .thoughtforge-search-results {
        display: grid;
        gap: 4px;
        max-height: 210px;
        margin: 0;
        padding: 0;
        overflow: auto;
        list-style: none;
      }

      .thoughtforge-search-results[hidden] {
        display: none;
      }

      .thoughtforge-search-result {
        display: grid;
        gap: 2px;
        width: 100%;
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 5px 6px;
        text-align: left;
        color: inherit;
        background: transparent;
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-search-result:hover,
      .thoughtforge-search-result:focus-visible,
      .thoughtforge-search-result[data-active="true"] {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        background: color-mix(in srgb, var(--tf-list-hoverBackground, var(--vscode-list-hoverBackground, #f0f3f6)) 86%, transparent);
        outline: none;
      }

      .thoughtforge-search-result-title {
        font-weight: 650;
      }

      .thoughtforge-search-result-meta {
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-size: 11px;
      }

      .thoughtforge-sync-status {
        min-height: 18px;
        margin: 0 0 12px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-size: 12px;
      }

      .thoughtforge-sync-status[data-sync-state="external-update"] {
        color: var(--tf-testing-iconPassed, var(--vscode-testing-iconPassed, #1a7f37));
      }

      .thoughtforge-sync-status[data-sync-state="parse-recovery"] {
        color: var(--tf-editorWarning-foreground, var(--vscode-editorWarning-foreground, #9a6700));
      }

      .thoughtforge-diagnostics {
        display: grid;
        gap: 6px;
        margin: 0 0 12px;
        padding: 8px;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 6px;
        background: var(--tf-sideBar-background, var(--vscode-sideBar-background, transparent));
      }

      .thoughtforge-diagnostics[hidden] {
        display: none;
      }

      .thoughtforge-diagnostics-title {
        margin: 0;
        font-size: 12px;
        font-weight: 650;
      }

      .thoughtforge-diagnostics-list {
        display: grid;
        gap: 6px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .thoughtforge-diagnostic {
        display: grid;
        gap: 2px;
        padding-left: 8px;
        border-left: 3px solid var(--tf-editorWarning-foreground, var(--vscode-editorWarning-foreground, #9a6700));
        font-size: 12px;
      }

      .thoughtforge-diagnostic[data-severity="error"] {
        border-left-color: var(--tf-errorForeground, var(--vscode-errorForeground, #d1242f));
      }

      .thoughtforge-diagnostic-code {
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
      }

      .thoughtforge-source-preview {
        margin: 0;
        overflow-x: auto;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 4px;
        padding: 6px;
        color: var(--tf-editor-foreground, var(--vscode-editor-foreground, inherit));
        background: var(--tf-editor-background, var(--vscode-editor-background, transparent));
        font: 11px var(--tf-editor-font-family, var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace));
        white-space: pre;
      }

      .thoughtforge-outline {
        display: block;
        padding: 0;
        margin: 0;
        list-style: none;
        font-size: 14px;
        line-height: 1.62;
      }

      .thoughtforge-outline-heading {
        margin: 10px 0 14px;
        padding: 0 0 10px;
        border-bottom: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        color: var(--tf-foreground, var(--vscode-foreground, #24292f));
        font-size: 22px;
        font-weight: 700;
        line-height: 1.25;
      }

      .thoughtforge-outline ul {
        list-style: none;
        margin: 3px 0 3px 18px;
        padding: 0;
        border-left: 1px solid color-mix(in srgb, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de)) 72%, transparent);
      }

      .thoughtforge-outline-children[data-collapsed="true"] {
        display: none;
      }

      .thoughtforge-outline li {
        position: relative;
      }

      .thoughtforge-node-row {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        align-items: start;
        gap: 5px;
        margin: 1px 0;
        min-height: 28px;
        position: relative;
      }

      .thoughtforge-collapse-toggle {
        appearance: none;
        width: 18px;
        height: 26px;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        background: transparent;
        font: inherit;
        font-size: 12px;
        line-height: 24px;
        cursor: pointer;
      }

      .thoughtforge-collapse-toggle:hover,
      .thoughtforge-collapse-toggle:focus-visible {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        color: var(--tf-foreground, var(--vscode-foreground, #1f2328));
      }

      .thoughtforge-collapse-toggle[data-has-children="false"] {
        cursor: default;
        pointer-events: none;
      }

      .thoughtforge-node {
        appearance: none;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 0;
        border-radius: 4px;
        padding: 3px 8px;
        text-align: left;
        color: inherit;
        background: transparent;
        font: inherit;
        cursor: pointer;
        position: relative;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .thoughtforge-node:hover,
      .thoughtforge-node[data-selected="true"] {
        background: color-mix(in srgb, var(--tf-list-hoverBackground, var(--vscode-list-hoverBackground, #f0f3f6)) 86%, transparent);
      }

      .thoughtforge-node[data-selected="true"] {
        outline: 1px solid color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 78%, transparent);
        box-shadow: inset 3px 0 0 var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
      }

      .thoughtforge-node[data-placeholder="true"] {
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-style: italic;
        opacity: 0.78;
      }

      .thoughtforge-node[data-markdown-block="heading1"],
      .thoughtforge-node[data-markdown-block="heading2"] {
        font-weight: 700;
        line-height: 1.25;
        padding-top: 7px;
        padding-bottom: 5px;
      }

      .thoughtforge-node[data-markdown-block="heading1"] {
        font-size: 1.42em;
      }

      .thoughtforge-node[data-markdown-block="heading2"] {
        font-size: 1.22em;
      }

      .thoughtforge-node[data-markdown-block="heading3"] {
        font-weight: 650;
        color: color-mix(in srgb, var(--tf-foreground, var(--vscode-foreground, #24292f)) 92%, var(--tf-textLink-foreground, var(--vscode-textLink-foreground, #0969da)));
      }

      .thoughtforge-node strong {
        font-weight: 700;
      }

      .thoughtforge-node em {
        font-style: italic;
      }

      .thoughtforge-node code {
        border-radius: 3px;
        padding: 0 3px;
        background: var(--tf-textCodeBlock-background, var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.16)));
        font-family: var(--tf-editor-font-family, var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace));
        font-size: 0.92em;
      }

      .thoughtforge-node[data-search-match="true"] {
        box-shadow: inset 3px 0 0 var(--tf-editorWarning-foreground, var(--vscode-editorWarning-foreground, #9a6700));
      }

      .thoughtforge-node[data-active-search-match="true"] {
        background: var(--tf-list-activeSelectionBackground, var(--vscode-list-activeSelectionBackground, #0969da));
        color: var(--tf-list-activeSelectionForeground, var(--vscode-list-activeSelectionForeground, #ffffff));
      }

      .thoughtforge-node-note-indicator {
        margin-left: 6px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-size: 0.84em;
        font-weight: 650;
      }

      .thoughtforge-outline-title-editor {
        margin: 0;
      }

      .thoughtforge-outline-title-editor input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        border-radius: 4px;
        padding: 2px 6px 2px 18px;
        color: var(--tf-input-foreground, var(--vscode-input-foreground, inherit));
        background: var(--tf-input-background, var(--vscode-input-background, #ffffff));
        font: inherit;
        line-height: inherit;
      }

      .thoughtforge-shell[data-reparent-pick="true"] .thoughtforge-node[data-reparent-target="true"] {
        outline: 1px dashed var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        cursor: copy;
      }

      .thoughtforge-shell[data-reparent-pick="true"] .thoughtforge-node[data-reparent-target="false"] {
        opacity: 0.72;
      }

      .thoughtforge-canvas {
        --thoughtforge-map-connector-color: color-mix(in srgb, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de)) 82%, var(--tf-editor-foreground, var(--vscode-editor-foreground, #24292f)) 18%);
        --thoughtforge-map-branch-gap: 12px;
        --thoughtforge-map-connector-width: 30px;
        --thoughtforge-map-connector-thickness: 1.5px;
        zoom: var(--thoughtforge-map-zoom, 1);
        display: flex;
        align-items: flex-start;
        gap: 16px;
        min-width: max-content;
      }

      .thoughtforge-map-column {
        display: grid;
        gap: var(--thoughtforge-map-branch-gap);
        position: relative;
      }

      .thoughtforge-map-column[data-has-parent="true"] {
        padding-left: 0;
      }

      .thoughtforge-map-column[data-has-parent="true"]:not([data-child-count="1"]) > .thoughtforge-map-branch::before {
        content: "";
        position: absolute;
        left: 0;
        top: calc(var(--thoughtforge-map-branch-gap) * -0.5);
        bottom: calc(var(--thoughtforge-map-branch-gap) * -0.5);
        border-left: var(--thoughtforge-map-connector-thickness) solid
          var(--thoughtforge-map-connector-color);
        opacity: 0.92;
      }

      .thoughtforge-map-column[data-has-parent="true"]:not([data-child-count="1"]) > .thoughtforge-map-branch:first-child::before {
        top: 50%;
      }

      .thoughtforge-map-column[data-has-parent="true"]:not([data-child-count="1"]) > .thoughtforge-map-branch:last-child::before {
        bottom: 50%;
      }

      .thoughtforge-map-branch {
        display: flex;
        align-items: center;
        gap: 0;
        position: relative;
      }

      .thoughtforge-map-connector {
        display: none;
        width: var(--thoughtforge-map-connector-width);
        height: var(--thoughtforge-map-connector-thickness);
        flex: 0 0 var(--thoughtforge-map-connector-width);
        background: var(--thoughtforge-map-connector-color);
        position: relative;
        margin-right: -1px;
        opacity: 0;
      }

      .thoughtforge-map-branch[data-has-parent="true"] > .thoughtforge-map-connector {
        display: block;
        opacity: 0.92;
      }

      .thoughtforge-map-branch[data-selected-path="true"] > .thoughtforge-map-connector {
        background: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        opacity: 1;
      }

      .thoughtforge-map-node {
        display: block;
        min-width: 150px;
        max-width: 240px;
        box-sizing: border-box;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 8px;
        padding: 9px 10px;
        background: var(--tf-sideBar-background, var(--vscode-sideBar-background, #f6f8fa));
        box-shadow: 0 1px 2px rgba(31, 35, 40, 0.08);
        margin-right: 14px;
        position: relative;
        overflow-wrap: anywhere;
        word-break: break-word;
        transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease, border-color 120ms ease;
      }

      .thoughtforge-map-branch[data-has-visible-children="true"] > .thoughtforge-map-node::before {
        content: "";
        position: absolute;
        right: -15px;
        top: 50%;
        width: 16px;
        height: var(--thoughtforge-map-connector-thickness);
        background: var(--thoughtforge-map-connector-color);
        opacity: 0.92;
        transform: translateY(-50%);
      }

      .thoughtforge-map-column[data-side="left"] {
        justify-items: end;
      }
      .thoughtforge-map-branch[data-side="left"] {
        flex-direction: row-reverse;
      }
      .thoughtforge-map-branch[data-side="left"] > .thoughtforge-map-connector {
        margin-right: 0;
        margin-left: -1px;
      }
      .thoughtforge-map-branch[data-side="left"] > .thoughtforge-map-node {
        margin-right: 0;
        margin-left: 14px;
      }
      .thoughtforge-map-branch[data-side="left"][data-has-visible-children="true"] > .thoughtforge-map-node::before {
        right: auto;
        left: -15px;
      }
      .thoughtforge-map-column[data-side="left"][data-has-parent="true"]:not([data-child-count="1"]) > .thoughtforge-map-branch::before {
        left: auto;
        right: 0;
        border-left: 0;
        border-right: var(--thoughtforge-map-connector-thickness) solid
          var(--thoughtforge-map-connector-color);
      }
      .thoughtforge-map-branch[data-title-root="true"][data-has-left-children="true"] > .thoughtforge-map-node {
        margin-left: 14px;
      }
      .thoughtforge-map-branch[data-title-root="true"][data-has-left-children="true"] > .thoughtforge-map-node::after {
        content: "";
        position: absolute;
        left: -15px;
        top: 50%;
        width: 16px;
        height: var(--thoughtforge-map-connector-thickness);
        background: var(--thoughtforge-map-connector-color);
        opacity: 0.92;
        transform: translateY(-50%);
      }
      .thoughtforge-map-node[data-selected="true"] {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        background: color-mix(in srgb, var(--tf-list-activeSelectionBackground, var(--vscode-list-activeSelectionBackground, #0969da)) 18%, var(--tf-sideBar-background, var(--vscode-sideBar-background, #f6f8fa)));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 72%, transparent);
      }

      .thoughtforge-map-node[data-selected-path="true"][data-selected="false"] {
        border-color: var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        background: var(--tf-sideBar-background, var(--vscode-sideBar-background, #f6f8fa));
      }

      .thoughtforge-map-drag-handle {
        appearance: none;
        position: absolute;
        left: -8px;
        top: 7px;
        bottom: 7px;
        width: 11px;
        min-height: 0;
        padding: 0;
        border: 0;
        border-radius: 999px;
        color: color-mix(in srgb, var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76)) 68%, transparent);
        background: transparent;
        font: inherit;
        line-height: 1;
        cursor: grab;
        opacity: 0.58;
        transition:
          background-color 120ms ease,
          color 120ms ease,
          opacity 120ms ease,
          box-shadow 120ms ease;
      }

      .thoughtforge-map-branch[data-side="left"] .thoughtforge-map-drag-handle {
        left: auto;
        right: -8px;
      }
      .thoughtforge-map-drag-handle::before {
        content: "";
        position: absolute;
        left: 4px;
        top: 3px;
        bottom: 3px;
        width: 2px;
        border-radius: 999px;
        background: currentColor;
      }

      .thoughtforge-map-drag-handle::after {
        content: "";
        position: absolute;
        left: 2px;
        top: 50%;
        width: 6px;
        height: 16px;
        transform: translateY(-50%);
        background-image: radial-gradient(currentColor 1px, transparent 1.5px);
        background-size: 6px 6px;
        background-position: center;
        opacity: 0;
      }

      .thoughtforge-map-node:hover > .thoughtforge-map-drag-handle,
      .thoughtforge-map-node[data-selected="true"] > .thoughtforge-map-drag-handle,
      .thoughtforge-map-drag-handle:hover,
      .thoughtforge-map-drag-handle:focus-visible {
        color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        background: var(--tf-toolbar-hoverBackground, var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.16)));
        opacity: 1;
      }

      .thoughtforge-map-node:hover > .thoughtforge-map-drag-handle::after,
      .thoughtforge-map-node[data-selected="true"] > .thoughtforge-map-drag-handle::after,
      .thoughtforge-map-drag-handle:hover::after,
      .thoughtforge-map-drag-handle:focus-visible::after {
        opacity: 0.9;
      }

      .thoughtforge-map-drag-handle:focus-visible {
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 70%, transparent);
        outline: none;
      }

      .thoughtforge-map-drag-handle[data-dragging="true"] {
        cursor: grabbing; color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)); opacity: 1;
        background: color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 14%, var(--tf-toolbar-hoverBackground, var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.16))));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 30%, transparent);
      }

      .thoughtforge-map-node[data-dragging="true"] {
        z-index: 1; pointer-events: none; cursor: grabbing; opacity: 0.42; transform: none; border-color: color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 62%, transparent); border-style: dashed; background: color-mix(in srgb, var(--tf-editor-background, var(--vscode-editor-background, #ffffff)) 82%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 34%, transparent);
      }

      .thoughtforge-map-drag-preview {
        position: fixed; left: 0; top: 0; width: var(--tf-dpw, 180px); max-width: min(280px, calc(100vw - 24px)); box-sizing: border-box; border: 1px solid var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)); border-radius: 8px; padding: 10px 12px; color: var(--tf-foreground, var(--vscode-foreground, #24292f)); background: color-mix(in srgb, var(--tf-sideBar-background, var(--vscode-sideBar-background, #f6f8fa)) 88%, var(--tf-list-activeSelectionBackground, var(--vscode-list-activeSelectionBackground, #0969da))); box-shadow: 0 24px 58px rgba(31, 35, 40, 0.42), 0 0 0 3px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 36%, transparent); opacity: 0.78; pointer-events: none; transform: translate3d(var(--tf-dpx, -9999px), var(--tf-dpy, -9999px), 0) scale(1.045) rotate(-0.6deg); transform-origin: var(--tf-dgx, 50%) var(--tf-dgy, 50%); z-index: 2147483647; overflow-wrap: anywhere; word-break: break-word; will-change: transform; font-weight: 650;
      }

      .thoughtforge-map-drag-preview::before {
        content: ""; position: absolute; left: var(--tf-dgx, 14px); top: var(--tf-dgy, 14px); width: 11px; height: 11px; border-radius: 999px; background: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)); box-shadow: 0 0 0 5px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 22%, transparent), 0 8px 18px rgba(31, 35, 40, 0.32); transform: translate(-50%, -50%);
      }

      .thoughtforge-map-node[data-drag-target="true"] {
        border-color: color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 42%, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de)));
      }

      .thoughtforge-map-node[data-drop-position="before"] {
        box-shadow:
          0 -5px 0 -2px var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)),
          0 1px 2px rgba(31, 35, 40, 0.08);
      }

      .thoughtforge-map-node[data-drop-position="after"] {
        box-shadow:
          0 5px 0 -2px var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)),
          0 1px 2px rgba(31, 35, 40, 0.08);
      }

      .thoughtforge-map-node[data-drop-position="inside"] {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        background: color-mix(in srgb, var(--tf-list-activeSelectionBackground, var(--vscode-list-activeSelectionBackground, #0969da)) 24%, var(--tf-sideBar-background, var(--vscode-sideBar-background, #f6f8fa)));
        box-shadow:
          inset 0 0 0 999px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 8%, transparent),
          0 0 0 2px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 52%, transparent);
      }

      .thoughtforge-map-branch[data-column-drop-before="true"]::after,
      .thoughtforge-map-branch[data-column-drop-after="true"]::after {
        content: "";
        position: absolute;
        left: var(--thoughtforge-map-connector-width);
        width: 148px;
        height: 3px;
        border-radius: 999px;
        background: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 18%, transparent);
        pointer-events: none;
        z-index: 4;
      }

      .thoughtforge-map-branch[data-column-drop-before="true"]::after {
        top: calc(var(--thoughtforge-map-branch-gap) * -0.5);
      }

      .thoughtforge-map-branch[data-column-drop-after="true"]::after {
        bottom: calc(var(--thoughtforge-map-branch-gap) * -0.5);
      }

      .thoughtforge-map-branch[data-side="left"][data-column-drop-before="true"]::after,
      .thoughtforge-map-branch[data-side="left"][data-column-drop-after="true"]::after {
        left: auto;
        right: var(--thoughtforge-map-connector-width);
      }

      .thoughtforge-map-node[data-drop-disabled="true"] {
        opacity: 0.68;
        border-style: dashed;
        cursor: not-allowed;
      }

      [data-thoughtforge-concentration-controls] { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
      [data-thoughtforge-concentration-controls] .thoughtforge-search-input { width: 140px; min-width: 0; }
      [data-thoughtforge-concentration-status] { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      /* Filter may change thousands of borders at once. Keep hover effects,
         but apply search/selection border colors immediately in this view. */
      [data-concentration-view="true"] .thoughtforge-map-node { transition-property: transform, box-shadow, opacity; }

      .thoughtforge-map-node[data-dimmed="true"] > :is(button, form),
      .thoughtforge-node-row[data-dimmed="true"] > :is(button, form),
      .thoughtforge-map-branch > .thoughtforge-map-connector[data-dimmed="true"],
      .thoughtforge-map-branch[data-has-visible-children="true"] > .thoughtforge-map-node[data-dimmed="true"]::before,
      .thoughtforge-map-branch[data-title-root="true"][data-has-left-children="true"] > .thoughtforge-map-node[data-dimmed="true"]::after { opacity: 0.35; }
      .thoughtforge-map-branch[data-dimmed="true"]::before { opacity: 0.35 !important; }

      .thoughtforge-map-node[data-search-match="true"] {
        border-color: var(--tf-editorWarning-foreground, var(--vscode-editorWarning-foreground, #9a6700));
      }

      .thoughtforge-map-node[data-active-search-match="true"] {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        box-shadow: 0 0 0 2px var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
      }

      .thoughtforge-map-branch-toggle {
        appearance: none; position: absolute; right: -27px; top: 50%; z-index: 2;
        width: 19px; height: 19px; transform: translateY(-50%); border: 1px solid color-mix(in srgb, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de)) 74%, transparent); border-radius: 999px; padding: 0;
        color: color-mix(in srgb, var(--tf-foreground, var(--vscode-foreground, inherit)) 72%, transparent); background: color-mix(in srgb, var(--tf-sideBar-background, var(--vscode-sideBar-background, #f6f8fa)) 88%, var(--tf-editor-background, var(--vscode-editor-background, #ffffff)));
        box-shadow: 0 1px 2px rgba(31, 35, 40, 0.1), inset 0 1px 0 color-mix(in srgb, var(--tf-editor-background, var(--vscode-editor-background, #ffffff)) 72%, transparent);
        cursor: pointer; font-size: 0; transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
      }

      .thoughtforge-map-branch[data-side="left"] > .thoughtforge-map-node > .thoughtforge-map-branch-toggle {
        right: auto;
        left: -27px;
      }

      .thoughtforge-map-branch-toggle::before,
      .thoughtforge-map-branch-toggle::after {
        content: ""; position: absolute; left: 5px; right: 5px; top: 50%; height: 1.5px; border-radius: 999px; background: currentColor; transform: translateY(-50%);
      }

      .thoughtforge-map-branch-toggle[data-collapsed="true"]::after {
        left: 50%; right: auto; top: 5px; bottom: 5px; width: 1.5px; height: auto; transform: translateX(-50%);
      }

      .thoughtforge-map-branch-toggle:hover,
      .thoughtforge-map-branch-toggle:focus-visible {
        border-color: color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 62%, transparent); color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)); background: color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 10%, var(--tf-sideBar-background, var(--vscode-sideBar-background, #f6f8fa))); box-shadow: 0 2px 5px rgba(31, 35, 40, 0.16), 0 0 0 3px color-mix(in srgb, var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)) 12%, transparent); outline: none;
      }

      .thoughtforge-map-title-editor {
        margin: 0;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
      }

      .thoughtforge-map-title-editor input {
        min-width: 0;
        max-width: 100%;
        width: 100%;
        box-sizing: border-box;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 6px 7px;
        color: var(--tf-input-foreground, var(--vscode-input-foreground, inherit));
        background: transparent;
        font: inherit;
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .thoughtforge-map-title-editor input:hover,
      .thoughtforge-map-title-editor input:focus {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        background: var(--tf-input-background, var(--vscode-input-background, #ffffff));
        outline: none;
      }

      .thoughtforge-empty {
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
      }

      .thoughtforge-node-note-panel {
        display: grid;
        gap: 8px;
        margin: 0 0 14px;
        padding: 8px;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 6px;
        background: var(--tf-sideBar-background, var(--vscode-sideBar-background, transparent));
      }

      .thoughtforge-node-note-panel[hidden] {
        display: none;
      }

      .thoughtforge-node-note-title {
        margin: 0;
        font-size: 12px;
        font-weight: 650;
      }

      .thoughtforge-node-note-editor {
        min-height: 96px;
        width: 100%;
        box-sizing: border-box;
        resize: vertical;
        border: 1px solid var(--tf-input-border, var(--vscode-input-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 4px;
        padding: 6px;
        color: var(--tf-input-foreground, var(--vscode-input-foreground, inherit));
        background: var(--tf-input-background, var(--vscode-input-background, transparent));
        font: inherit;
        line-height: 1.45;
      }

      .thoughtforge-node-note-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .thoughtforge-wiki-links {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .thoughtforge-wiki-links[hidden] {
        display: none;
      }

      .thoughtforge-wiki-link-button {
        max-width: 100%;
        overflow-wrap: anywhere;
      }

      .thoughtforge-node-context-menu {
        position: fixed;
        z-index: 30;
        display: grid;
        gap: 4px;
        box-sizing: border-box;
        min-width: 220px;
        max-width: min(320px, calc(100vw - 16px));
        padding: 8px;
        border: 1px solid var(--tf-menu-border, var(--vscode-menu-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 6px;
        background: var(--tf-menu-background, var(--vscode-menu-background, var(--tf-editor-background, var(--vscode-editor-background, #ffffff))));
        color: var(--tf-menu-foreground, var(--vscode-menu-foreground, var(--tf-editor-foreground, var(--vscode-editor-foreground, inherit))));
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
      }

      .thoughtforge-node-context-menu[hidden] {
        display: none;
      }

      .thoughtforge-node-context-title {
        overflow: hidden;
        color: var(--tf-foreground, var(--vscode-foreground, inherit));
        font-size: 12px;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .thoughtforge-node-context-path {
        overflow: hidden;
        margin-bottom: 4px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .thoughtforge-node-context-menu button {
        width: 100%;
        border: 0;
        border-radius: 4px;
        padding: 6px 8px;
        color: inherit;
        background: transparent;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-node-context-menu button:hover,
      .thoughtforge-node-context-menu button:focus-visible {
        outline: none;
        background: var(--tf-menu-selectionBackground, var(--vscode-menu-selectionBackground, var(--tf-list-hoverBackground, var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.16)))));
        color: var(--tf-menu-selectionForeground, var(--vscode-menu-selectionForeground, inherit));
      }

      .thoughtforge-node-context-menu button:disabled {
        cursor: default;
        opacity: 0.5;
      }

      .thoughtforge-node-context-divider {
        height: 1px;
        margin: 4px 0;
        background: var(--tf-menu-separatorBackground, var(--vscode-menu-separatorBackground, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
      }

      .thoughtforge-command-surface[hidden] {
        display: none;
      }

      .thoughtforge-command-surface {
        position: fixed;
        inset: 0;
        z-index: 30;
        display: grid;
        place-items: start center;
        padding: 9vh 16px 16px;
        background: rgba(0, 0, 0, 0.34);
      }

      .thoughtforge-command-dialog {
        width: min(680px, 100%);
        max-height: min(760px, 82vh);
        overflow: auto;
        border: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
        border-radius: 8px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
        background: var(--tf-editor-background, var(--vscode-editor-background, #ffffff));
        color: var(--tf-foreground, var(--vscode-foreground, #1f2328));
      }

      .thoughtforge-command-dialog header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #d0d7de));
      }

      .thoughtforge-command-dialog h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 650;
      }

      .thoughtforge-command-close {
        border: 1px solid var(--tf-button-border, var(--vscode-button-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 4px;
        padding: 3px 8px;
        color: var(--tf-button-secondaryForeground, var(--vscode-button-secondaryForeground, var(--tf-foreground, var(--vscode-foreground, #1f2328))));
        background: var(--tf-button-secondaryBackground, var(--vscode-button-secondaryBackground, transparent));
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-shortcut-grid {
        display: grid;
        grid-template-columns: minmax(110px, auto) minmax(0, 1fr);
        gap: 8px 12px;
        margin: 0;
        padding: 14px;
      }

      .thoughtforge-shortcut-grid dt {
        font: 12px var(--tf-editor-font-family, var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace));
        color: var(--tf-textPreformat-foreground, var(--vscode-textPreformat-foreground, var(--tf-foreground, var(--vscode-foreground, #1f2328))));
      }

      .thoughtforge-shortcut-grid dd {
        margin: 0;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
      }

      .thoughtforge-command-search {
        width: calc(100% - 28px);
        box-sizing: border-box;
        margin: 14px 14px 8px;
        border: 1px solid var(--tf-input-border, var(--vscode-input-border, var(--tf-panel-border, var(--vscode-panel-border, #d0d7de))));
        border-radius: 6px;
        padding: 8px 10px;
        color: var(--tf-input-foreground, var(--vscode-input-foreground, inherit));
        background: var(--tf-input-background, var(--vscode-input-background, #ffffff));
        font: inherit;
      }

      .thoughtforge-command-list {
        display: grid;
        gap: 4px;
        margin: 0;
        padding: 0 8px 12px;
        list-style: none;
      }

      .thoughtforge-command-option {
        width: 100%;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 8px 10px;
        color: inherit;
        background: transparent;
        text-align: left;
        font: inherit;
        cursor: pointer;
      }

      .thoughtforge-command-option[data-active="true"] {
        border-color: var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        background: var(--tf-list-activeSelectionBackground, var(--vscode-list-activeSelectionBackground, #0969da));
        color: var(--tf-list-activeSelectionForeground, var(--vscode-list-activeSelectionForeground, #ffffff));
      }

      .thoughtforge-command-option:disabled {
        cursor: default;
        opacity: 0.56;
      }

      .thoughtforge-command-description {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        color: var(--tf-descriptionForeground, var(--vscode-descriptionForeground, #656d76));
      }

      .thoughtforge-command-option[data-active="true"] .thoughtforge-command-description {
        color: inherit;
      }

      .thoughtforge-shell button:focus-visible,
      .thoughtforge-node-context-menu button:focus-visible,
      .thoughtforge-command-surface button:focus-visible,
      .thoughtforge-command-search:focus-visible,
      .thoughtforge-search-input:focus-visible,
      .thoughtforge-node-note-editor:focus-visible,
      .thoughtforge-outline-title-editor input:focus-visible,
      .thoughtforge-map-title-editor input:focus-visible {
        outline: 2px solid var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        outline-offset: 2px;
      }

      .thoughtforge-node:focus-visible,
      .thoughtforge-map-node:focus-within {
        outline: 2px solid var(--tf-focusBorder, var(--vscode-focusBorder, #0969da));
        outline-offset: 2px;
      }

      .tf-ime input {
        border-color: transparent;
        background: transparent;
        caret-color: transparent;
      }

      @media (prefers-reduced-motion: reduce) {
        .thoughtforge-map-node,
        .thoughtforge-map-drag-handle,
        .thoughtforge-map-branch-toggle {
          transition: none;
        }
      }

      @media (forced-colors: active) {
        .thoughtforge-node,
        .thoughtforge-map-node,
        .thoughtforge-command-dialog,
        .thoughtforge-node-context-menu,
        .thoughtforge-search-panel,
        .thoughtforge-focus-breadcrumb,
        .thoughtforge-diagnostics {
          border-color: CanvasText;
        }

        .thoughtforge-node[data-selected="true"],
        .thoughtforge-map-node[data-selected="true"],
        .thoughtforge-command-option[data-active="true"],
        .thoughtforge-search-result[data-active="true"] {
          color: HighlightText;
          background: Highlight;
          outline: 2px solid Highlight;
          box-shadow: none;
        }

        .thoughtforge-map-connector,
        .thoughtforge-map-branch[data-has-visible-children="true"] > .thoughtforge-map-node::before {
          background: CanvasText;
        }

        .thoughtforge-node[data-drop-position],
        .thoughtforge-map-node[data-drop-position],
        .thoughtforge-map-node[data-drop-disabled="true"] {
          outline: 2px dashed Highlight;
          box-shadow: none;
        }
      }

      @media (max-width: 760px) {
        .thoughtforge-shell {
          grid-template-columns: 1fr;
        }

      }
      .thoughtforge-shell[data-proposal-open="true"] { grid-template-columns: minmax(0, 1fr) minmax(260px, 36%); }
      [data-thoughtforge-proposal-panel] { min-width: 0; overflow: auto; padding: 12px; border-left: 1px solid var(--tf-panel-border, var(--vscode-panel-border, #ccc)); }
      [data-thoughtforge-proposal-panel][hidden] { display: none; }
      .thoughtforge-map-node[data-proposal-target="true"] { outline: 3px solid var(--tf-focusBorder, var(--vscode-focusBorder, #0969da)); outline-offset: 2px; }`;

/**
 * @param {string | undefined} locale
 * @param {string} escapedUri
 */
export function renderMapViewMarkup(locale, escapedUri) {
  const webviewLocale = createMapViewI18n(locale);
  return `    <main class="thoughtforge-shell" data-thoughtforge-view="map" data-document-uri="${escapedUri}">
      <section class="thoughtforge-map" aria-label="${webviewLocale["ui.map"]}">
        <div class="thoughtforge-map-toolbar" data-thoughtforge-map-zoom-toolbar role="toolbar" aria-label="${webviewLocale["ui.zoom"]}">
          <button type="button" data-thoughtforge-map-zoom-out aria-label="${webviewLocale["ui.zoomOut"]}" title="${webviewLocale["ui.zoomOut"]}">-</button>
          <output class="thoughtforge-map-zoom-value" data-thoughtforge-map-zoom-value aria-live="polite">100%</output>
          <button type="button" data-thoughtforge-map-zoom-in aria-label="${webviewLocale["ui.zoomIn"]}" title="${webviewLocale["ui.zoomIn"]}">+</button>
          <button type="button" data-thoughtforge-map-zoom-reset aria-label="${webviewLocale["ui.zoomReset"]}" title="${webviewLocale["ui.zoomReset"]}">${webviewLocale["ui.zoomValue"]}</button>
          <button type="button" data-thoughtforge-proposal-toggle aria-controls="thoughtforge-proposal-panel" aria-expanded="false">整理案</button>
        </div>
        <div class="thoughtforge-canvas" data-thoughtforge-mind-map>
          <p class="thoughtforge-empty">${webviewLocale["ui.mapDataWaiting"]}</p>
        </div>
      </section>
      <aside id="thoughtforge-proposal-panel" data-thoughtforge-proposal-panel aria-label="整理案" hidden></aside>
    </main>
    <section class="thoughtforge-node-context-menu" data-thoughtforge-node-context-menu hidden role="menu" aria-label="${webviewLocale["ui.nodeContextMenu"]}" aria-describedby="thoughtforge-node-context-help">
      <p id="thoughtforge-node-context-help" class="thoughtforge-sr-only">${webviewLocale["ui.nodeContextHelp"]}</p>
      <div class="thoughtforge-node-context-title" data-thoughtforge-node-context-title></div>
      <div class="thoughtforge-node-context-path" data-thoughtforge-node-context-path></div>
      <button type="button" role="menuitem" data-thoughtforge-node-context-action="copy-subtree" title="${webviewLocale["ui.copySubtreeTitle"]}">${webviewLocale["ui.copySubtree"]}</button>
      <button type="button" role="menuitem" data-thoughtforge-node-context-action="reveal-source" title="${webviewLocale["ui.revealSourceTitle"]}">${webviewLocale["ui.revealSourceAction"]}</button>
    </section>
    <section class="thoughtforge-command-surface" data-thoughtforge-shortcut-overlay hidden role="dialog" aria-modal="true" aria-label="${webviewLocale["ui.shortcutOverlay"]}" aria-describedby="thoughtforge-shortcut-overlay-help">
      <div class="thoughtforge-command-dialog">
        <header>
          <h2>${webviewLocale["ui.shortcutPanelTitle"]}</h2>
          <button type="button" class="thoughtforge-command-close" data-thoughtforge-shortcut-close title="${webviewLocale["ui.shortcutClose"]}" aria-label="${webviewLocale["ui.shortcutClose"]}">${webviewLocale["ui.shortcutClose"]}</button>
        </header>
        <p id="thoughtforge-shortcut-overlay-help" class="thoughtforge-sr-only">${webviewLocale["ui.shortcutCloseLabel"]}</p>
        <dl class="thoughtforge-shortcut-grid">
          <dt>Enter</dt><dd>${webviewLocale["shortcut.enter"]}</dd>
          <dt>Shift+Enter</dt><dd>${webviewLocale["shortcut.shiftEnter"]}</dd>
          <dt>Cmd/Ctrl+Enter</dt><dd>${webviewLocale["shortcut.modEnter"]}</dd>
          <dt>Tab</dt><dd>${webviewLocale["shortcut.tab"]}</dd>
          <dt>Shift+Tab</dt><dd>${webviewLocale["shortcut.shiftTab"]}</dd>
          <dt>Delete</dt><dd>${webviewLocale["shortcut.delete"]}</dd>
          <dt>F</dt><dd>${webviewLocale["shortcut.focus"]}</dd>
          <dt>Esc</dt><dd>${webviewLocale["shortcut.escape"]}</dd>
          <dt>?</dt><dd>${webviewLocale["shortcut.help"]}</dd>
          <dt>Cmd/Ctrl+/</dt><dd>${webviewLocale["shortcut.commandPalette"]}</dd>
        </dl>
      </div>
    </section>
    <section class="thoughtforge-command-surface" data-thoughtforge-command-palette hidden role="dialog" aria-modal="true" aria-label="${webviewLocale["ui.commandPalette"]}" aria-describedby="thoughtforge-command-palette-help">
      <div class="thoughtforge-command-dialog">
        <header>
          <h2>${webviewLocale["ui.commandPaletteTitle"]}</h2>
          <button type="button" class="thoughtforge-command-close" data-thoughtforge-command-palette-close title="${webviewLocale["ui.commandPaletteClose"]}" aria-label="${webviewLocale["ui.commandPaletteClose"]}">${webviewLocale["ui.shortcutClose"]}</button>
        </header>
        <p id="thoughtforge-command-palette-help" class="thoughtforge-sr-only">${webviewLocale["ui.commandPaletteCloseLabel"]}</p>
        <input class="thoughtforge-command-search" data-thoughtforge-command-palette-input role="combobox" aria-label="${webviewLocale["ui.filterCommand"]}" aria-controls="thoughtforge-command-palette-list" aria-haspopup="listbox" aria-expanded="false" autocomplete="off" spellcheck="false">
        <ol id="thoughtforge-command-palette-list" class="thoughtforge-command-list" data-thoughtforge-command-palette-list role="listbox" aria-label="${webviewLocale["ui.commandCandidates"]}"></ol>
      </div>
    </section>`;
}

/**
 * @param {import("./assets.d.mts").MapViewScriptOptions} options
 */
export function renderMapViewScript({
  THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION,
  THOUGHTFORGE_MAP_DROP_BEFORE_RATIO,
  THOUGHTFORGE_MAP_DROP_AFTER_RATIO,
  readyMessage,
  initialSettings,
  documentUri
}) {
  // Host-provided wire JSON remains accepted by the assets entrypoint. Only
  // version-independent settings/ready payloads enter the map body.
  const readyIntent = JSON.stringify({ type: JSON.parse(readyMessage).type }).replaceAll("<", "\\u003c");
  const settings = JSON.stringify({ settings: JSON.parse(initialSettings).settings }).replaceAll("<", "\\u003c");
  return renderV1MapHostBridgeScript(THOUGHTFORGE_WEBVIEW_PROTOCOL_VERSION) + `
      function mountThoughtForgeMap() {
      window.__thoughtforgeMapView?.dispose();
      let disposed = false;
      const cleanup = new Set(), events = new AbortController(), eventListeners = new WeakMap();
      let releaseRenderer;
      function own(fn) { if (typeof fn === "function") disposed ? fn() : cleanup.add(fn); }
      function guard(fn, fallback) { return (...args) => disposed ? fallback : fn(...args); }
      function dispose() {
        if (disposed) return;
        disposed = true;
        // Retire the host binding first, exactly once, even if cleanup throws.
        cleanup.delete(releaseRenderer);
        let error;
        try { releaseRenderer?.(); } catch (e) { error = { value: e }; }
        thoughtforgeState.pendingRenames.clear();
        events.abort();
        for (const element of [outlineElement, mindMapElement]) if (element) clearChildren(element);
        for (const fn of [...cleanup].reverse()) { try { fn(); } catch (e) { error ??= { value: e }; } }
        cleanup.clear();
        if (error) throw error.value;
      }
      function listen(target, type, fn, options) {
        if (!eventListeners.has(fn)) eventListeners.set(fn, guard(fn));
        target?.addEventListener(type, eventListeners.get(fn), { ...(typeof options === "boolean" ? { capture: options } : options), signal: events.signal });
      }
      function unlisten(target, type, fn) {
        target?.removeEventListener(type, eventListeners.get(fn));
      }
      function schedule(run, cancel) {
        if (!run) return [];
        const pending = new Map();
        function clear(id) { const fn = pending.get(id); cleanup.delete(fn); pending.delete(id); cancel(id); }
        return [(fn, ...args) => {
          if (disposed) return;
          const id = run((...values) => { cleanup.delete(release); pending.delete(id); if (!disposed) fn(...values); }, ...args);
          const release = () => clear(id);
          pending.set(id, release); own(release); return id;
        }, clear];
      }
      const [setTimeout] = schedule(window.setTimeout.bind(window), window.clearTimeout.bind(window));
      const [requestAnimationFrame, cancelAnimationFrame] = schedule(window.requestAnimationFrame?.bind(window), window.cancelAnimationFrame?.bind(window));
      window.__thoughtforgeMapView = { mount: mountThoughtForgeMap, dispose };
      let pendingTitleClick, copiedBranch, pendingCopy, pendingPaste;
      let copySequence = 0;
      window.thoughtforgeInitialSettings = ${settings};
      const thoughtforgeDocumentUri = ${documentUri};
      const host = window.__thoughtforgeHost ??= createV1MapHostBridge(thoughtforgeDocumentUri);
      const bridge = {
        policy: host.policy, post: guard(host.post.bind(host)),
        subscribe(fn, observe) { if (disposed) return; own(host.subscribe(guard(fn), observe && guard(observe))); },
        subscribeClipboardResult(fn) { if (disposed) return; own(host.subscribeClipboardResult?.(guard(fn))); }
      };
      const hostPolicy = bridge.policy;
      const titleCommandInputs = new WeakMap();
      let commandTarget, commandInputOwner, commandMoveSource, commandMoveHash, commandMoveEpoch, commandHandling = false;
      const localEditCommandIds = { 'node.rename':'confirm-input', 'node.insertChild':'insert-child', 'node.insertSibling':'insert-sibling-after', 'node.renameAndInsertChild':'insert-child', 'node.renameAndInsertSibling':'insert-sibling-after', 'node.indent':'indent', 'node.outdent':'outdent', 'node.delete':'delete-branch', 'node.deleteKeepChildren':'delete-node-keep-children', 'node.move':'confirm-move-child' };
      const contextCommandIds = { 'copy-subtree':'copy-subtree-markdown', 'copy-prompt':'copy-subtree-ai-worker', 'copy-ai-chat':'copy-subtree-ai-chat', 'copy-ai-issue':'copy-subtree-ai-issue', 'copy-issue':'copy-subtree-issue-draft', 'copy-design':'copy-subtree-design-doc', 'copy-test-matrix':'copy-subtree-test-matrix', 'reveal-source':'reveal-source' };
      function localMapCommand(id, fallback, options = {}) {
        return concentrationView && hostPolicy?.mapCommandGate ? dispatchMapCommand(id, false, options) : fallback();
      }
      function localCommandBlocked(id, nodeId) {
        return concentrationView && hostPolicy?.mapCommandGate?.(id, false, mapCommandContext(nodeId));
      }
      function mapCommandContext(targetId) {
        const s=thoughtforgeState,previousIndex=renderParentIdIndex;
        if (!previousIndex && s.map) renderParentIdIndex=createRenderParentIdIndex(s.map);
        try {
        const id=targetId ?? s.selectedNodeId,node=s.map?.nodesById?.[id],parent=parentIdForNode(id),siblings=childrenForParent(parent),at=siblings.indexOf(id),target=copyTargetForNodeId(id);
        const titleInput=s.editingNodeId ? Array.from(document.querySelectorAll('input[data-node-id]')).find(e=>e.dataset.nodeId===s.editingNodeId && titleCommandInputs.has(e)) : undefined;
        const moveValid={};
        for(const where of ['before','after','child']) moveValid[where]=Boolean(commandMoveSource && commandMoveHash===s.commandModelHash && node && commandMoveSource!==id && canOperateOnVisibleNode(commandMoveSource) && isValidReparentTarget(commandMoveSource,where==='child'?id:parent) && (where==='child' || nextSiblingDropIndex(commandMoveSource,id,where)!==-1));
        return {nodeId:id, promptPreset:promptTemplateSelect?.value, includeNotes:promptPackIncludeNotesCheckbox?.checked, inert:shellElement?.hasAttribute('inert'),center:isMapTitleRootNodeId(id),visible:canOperateOnVisibleNode(id),titleInput,
          pristineCenterInput:isMapTitleRootNodeId(id) && titleInput && isFirstInputMap() && titleInput.value===(isEmptyDocumentDraftMap()?'':mapTitleRootText()),
          inputOwner:commandInputOwner,paletteInput:commandInputOwner===commandPaletteInput,nativeInput:commandInputOwner?.isConnected && commandInputOwner!==commandPaletteInput && isTextEditingTarget(commandInputOwner) && !titleCommandInputs.has(commandInputOwner) && !isImeCap(commandInputOwner),
          canIndent:at>0,canOutdent:Boolean(parent),before:at>0,after:at>=0 && at<siblings.length-1,
          source:Boolean(target?.source?.range),links:wikiLinkTitlesForNode(target).length,
          focusSibling:siblingFocusNodeIds().length>1,moving:Boolean(commandMoveSource),moveValid};
        } finally { renderParentIdIndex=previousIndex; }
      }
      function commandAvailability() { return hostPolicy?.mapCommandAvailability?.(); }
      function dispatchMapCommand(id,external=true,options={}) {
        const c=mapCommandContext(external ? undefined : options.nodeId);
        if (!external && options.commandType === 'node.move') c.moveValid.child = isValidReparentTarget(c.nodeId, reparentSelect?.value || null);
        const reason=hostPolicy?.mapCommandGate?.(id,external,c);
        if(reason)return {status:'rejected',reason};
        const action=id.slice(4),s=thoughtforgeState,selected=c.nodeId;
        let route='ui',run;
        const edit={'indent':'node.indent','outdent':'node.outdent','delete-branch':'node.delete','delete-node-keep-children':'node.deleteKeepChildren'};
        if(!external && options.commandType){route='semantic';run=()=>handleThoughtForgeEditCommand(options.commandType, options);}
        else if(edit[action]){route='semantic';run=()=>handleThoughtForgeEditCommand(edit[action],{nodeId:selected});}
        else if(action==='edit-title' || action==='edit-central-title'){route='interaction';run=()=>isMapTitleRootNodeId(action==='edit-central-title'?THOUGHTFORGE_MAP_TITLE_ROOT_ID:selected)?selectMapTitleRootNode({edit:true,surface:options.surface??'map'}):beginDirectNodeEdit(selected,options.surface??'map');}
        else if(action==='insert-child'){route='interaction';run=()=>{if(isMapTitleRootNodeId(selected)){const anchor=s.map.roots.at(-1);if(anchor)handleThoughtForgeEditCommand('node.insertSibling',{nodeId:anchor});else postThoughtForgeCommand({type:'node.insertChild',parentId:null,index:0,nodeId:nextGeneratedNodeId(),text:''});}else handleThoughtForgeEditCommand('node.insertChild',{nodeId:selected});};}
        else if(action.startsWith('insert-sibling-')){route='interaction';run=()=>handleThoughtForgeEditCommand('node.insertSibling',{nodeId:selected,where:action.endsWith('before')?'before':'after'});}
        else if(action==='paste-branch' && hostPolicy?.pasteBranch){route='interaction';run=()=>hostPolicy?.pasteBranch?.(selected,options.pasteText);}
        else if(action==='insert-parent'){route='interaction';run=()=>hostPolicy?.insertParent ? hostPolicy.insertParent(selected) : postThoughtForgeCommand({type:'node.wrapInNewParent',nodeId:selected,nextNodeId:nextGeneratedNodeId(),text:'新しい親'});}
        else if(action==='confirm-input' || action==='cancel-input'){route=action==='confirm-input'?'semantic':'interaction';run=()=>hostPolicy?.parentCommand?.(action==='confirm-input') || titleCommandInputs.get(c.titleInput)?.(action==='confirm-input');}
        else if(action==='undo' || action==='redo'){route='history';run=()=>hostPolicy?.mapCommandHistory?.(action);}
        else if(action.startsWith('move-sibling-')){route='semantic';run=()=>moveSelectedNodeWithinSiblings(action.endsWith('before')?-1:1);}
        else if(action==='move-branch'){route='interaction';run=()=>{commandMoveSource=selected;commandMoveHash=s.commandModelHash;commandMoveEpoch=s.commandModelEpoch;};}
        else if(action==='cancel-move'){route='interaction';run=()=>{commandMoveSource=undefined;};}
        else if(action.startsWith('confirm-move-')){route='semantic';run=()=>{const where=action.slice(13),parent=where==='child'?selected:parentIdForNode(selected);postThoughtForgeCommand({type:'node.move',nodeId:commandMoveSource,nextParentId:parent??null,nextIndex:where==='child'?nextMoveIndex(commandMoveSource,parent):nextSiblingDropIndex(commandMoveSource,selected,where)});commandMoveSource=undefined;};}
        else if(action.startsWith('copy-')){route='clipboard';const copy=/^copy-(node|subtree)-(.+)$/.exec(action);const formats={markdown:postClipboardWrite,opml:postClipboardOpmlWrite,context:postClipboardContextWrite,'issue-draft':postClipboardIssueDraftWrite,'design-doc':postClipboardDesignDocWrite,'test-matrix':postClipboardTestMatrixWrite,'prompt-template':postClipboardPromptTemplateWrite};run=()=>{commandTarget=selected??THOUGHTFORGE_MAP_TITLE_ROOT_ID;try{if(!external && options.copyEvent){const markdown=selectedNodeMarkdown('subtree');if(markdown){options.copyEvent.preventDefault();clearBranchCopy();options.copyEvent.clipboardData?.setData('text/plain',markdown);if(hostPolicy?.pasteBranch)postClipboardWrite('subtree');if(copyStatusElement)copyStatusElement.textContent='サブツリーMarkdownをコピーしました。';}}else if(action==='copy-visible-svg')postClipboardSvgWrite();else if(copy?.[2].startsWith('ai-')){const preset=copy[2].slice(3);postClipboardAiContextPackWrite('subtree',preset==='worker'?'codex-worker':preset==='chat'?'chatgpt-claude':'github-issue-fragment',preset==='worker'?'full':preset==='chat'?'compact':'checklist-only');}else formats[copy?.[2]]?.(copy[1]);}finally{commandTarget=undefined;}};}
        else if(action==='select-previous' || action==='select-next')run=()=>moveSelectedNode(action.slice(7));
        else if(action==='select-left' || action==='select-right')run=()=>moveSelectedNodeHorizontally(action.slice(7));
        else if(action==='select-central')run=()=>selectMapTitleRootNode();
        else if(action==='clear-selection')run=()=>{s.selectedNodeId=undefined;s.editingNodeId=undefined;s.editingSurface=undefined;s.directEditSession=undefined;renderThoughtForgeSelection();};
        else if(action==='toggle-collapse')run=()=>toggleNodeCollapse(selected);
        else if(action.startsWith('depth-'))run=()=>setSubtreeDepth(action==='depth-all'?0:Number(action.slice(6)));
        else if(action==='zoom-in' || action==='zoom-out')run=()=>stepMapZoom(action==='zoom-in'?1:-1);
        else if(action==='zoom-reset')run=()=>setMapZoom(MAP_ZOOM_DEFAULT);
        else if(action==='fit')run=()=>{if(mindMapElement){const e=mindMapElement;setMapZoom(s.mapZoom*Math.min(e.clientWidth/e.scrollWidth,e.clientHeight/e.scrollHeight,1));e.scrollTo({left:(e.scrollWidth-e.clientWidth)/2,top:0});}};
        else if(action==='focus-selected')run=()=>{options.nodeId ? setFocusRootNodeId(selected) : focusSelectedBranch();renderThoughtForgeSelection();};
        else if(action==='focus-follow-selection')run=()=>{setFocusFollowingSelection();renderThoughtForgeSelection();};
        else if(action==='focus-back' || action==='focus-forward')run=()=>{(action==='focus-back'?restorePreviousFocusRoot:restoreNextFocusRoot)();renderThoughtForgeSelection();};
        else if(action.startsWith('focus-sibling-'))run=()=>{focusSiblingBranch(action.endsWith('previous')?'previous':'next');renderThoughtForgeSelection();};
        else if(action==='clear-focus')run=()=>{clearFocusMode();renderThoughtForgeSelection();};
        else if(action==='filter-start')run=()=>searchInput?.focus();
        else if(action==='filter-previous' || action==='filter-next')run=()=>moveSearchResult(action==='filter-previous'?-1:1);
        else if(action==='filter-clear')run=clearSearchQuery;
        else if(action==='reveal-source'){route='host-navigation';run=()=>{commandTarget=selected;try{requestSelectedNodeRevealInSource();}finally{commandTarget=undefined;}};}
        else if(action==='open-selected-link'){route=c.links>1&&!options.linkTitle?'interaction':'host-navigation';run=()=>options.linkTitle&&hostPolicy?.mapCommandLink ? hostPolicy.mapCommandLink(options.linkTitle,selected,options.openIn??'same-tab') : openCommandLinks(selected);}
        else if(action==='focus-toolbar')run=()=>document.querySelector('[data-thoughtforge-map-zoom-toolbar] button')?.focus();
        else if(action==='focus-notice')run=()=>document.querySelector('#thoughtforge-status')?.focus();
        else if(action==='return-to-map')run=focusSelectionCap;
        else if(action==='open-shortcut-help')run=showShortcutOverlay;
        else if(action==='close-shortcut-help')run=()=>{closeShortcutOverlay();focusSelectionCap();};
        else if(action==='open-command-palette')run=showThoughtForgeCommandPalette;
        else if(action==='close-command-palette')run=()=>{closeThoughtForgeCommandPalette();focusSelectionCap();};
        else if(action==='open-context-menu')run=()=>{const rect=selectedNodeElementForSurface(selected,'map')?.getBoundingClientRect();if(rect)showNodeContextMenu(selected,rect.left,rect.bottom);};
        else if(action==='close-context-menu')run=()=>{hideNodeContextMenu();focusSelectionCap();};
        if(!run)return {status:'rejected',reason:'unsupported-command'};
        const previous=commandHandling;commandHandling=true;
        try{run();hostPolicy?.commandContextChanged?.();return {status:'admitted',route};}catch{return {status:'outcome-unknown',reason:'dispatch-interrupted'};}finally{commandHandling=previous;}
      }
      function openCommandLinks(nodeId) {
        const links=wikiLinkTitlesForNode(copyTargetForNodeId(nodeId)),hash=thoughtforgeState.commandModelHash;
        nodeContextMenuElement?.querySelector('[data-thoughtforge-link-chooser]')?.remove();
        if(links.length===1){requestMarkdownLinkOpen(links[0]);return;}
        hideNodeContextMenu();thoughtforgeState.contextMenuNodeId=nodeId;nodeContextMenuElement.hidden=false;
        const list=document.createElement('div');list.setAttribute('data-thoughtforge-link-chooser','');
        for(const title of links){const b=document.createElement('button');b.textContent=title;listen(b,'click',()=>{if(thoughtforgeState.selectedNodeId===nodeId && thoughtforgeState.contextMenuNodeId===nodeId && thoughtforgeState.commandModelHash===hash && !localCommandBlocked('map-open-selected-link',nodeId)){requestMarkdownLinkOpen(title);hideNodeContextMenu();}});list.appendChild(b);}
        nodeContextMenuElement.appendChild(list);own(()=>list.remove());list.querySelector('button')?.focus();
      }
      // Obsidian v2 explicitly supplies orderedIntents; absent/legacy policies
      // retain VS Code's root-switching Focus and search behavior.
      const concentrationView = hostPolicy?.orderedIntents === true;
      const THOUGHTFORGE_MAP_DRAG_MIME = "application/x-thoughtforge-node-id";
      const THOUGHTFORGE_MAP_TITLE_ROOT_ID = "__thoughtforge_map_title__";
      const NEW_NODE_PLACEHOLDER = "新規ノード";
      const IME_COMMIT_MS = 350;
      const OPTIMISTIC_DRAFT_EXPIRY_MS = 5000;
      const COMMAND_REQUEST_RETENTION_MS = 30000;
      const CANCELLED_COMMAND_NODE_RETENTION_MS = 5000;
      const CANCELLED_COMMAND_NODE_EVENT_GRACE_MS = 250;
      const MAP_ZOOM_MIN = 0.5;
      const MAP_ZOOM_MAX = 2;
      const MAP_ZOOM_STEP = 0.1;
      const MAP_ZOOM_DEFAULT = 1;
      const thoughtforgeState = {
        isComposingText: false,
        map: undefined,
        documentText: "",
        deferredModelUpdate: undefined,
        selectedNodeId: undefined,
        contextMenuNodeId: undefined,
        focusRootNodeId: undefined,
        focusFollowingSelection: false,
        concentrationFocusIds: new Set(),
        filterVisibleIds: new Set(),
        temporaryExpandedNodeIds: new Set(),
        filterFoldedNodeIds: new Set(),
        focusHistoryNodeIds: [],
        focusForwardNodeIds: [],
        editingNodeId: undefined,
        editingSurface: undefined,
        pendingFocusNodeId: undefined,
        pendingFocusTarget: undefined,
        pendingFocusSurface: undefined,
        pendingEditingRefocusNodeId: undefined,
        pendingSelectionCounterpartReveal: undefined,
        pendingMoveSelection: undefined,
        lastPointerDownAt: -Infinity,
        lastCompositionEndAt: -Infinity,
        activeFocusRetryToken: undefined,
        focusRetryEpoch: 0,
        generatedNodeCounter: 0,
        commandRequestCounter: 0,
        pendingRenames: new Map(),
        preferredEditSurface: "map",
        draftNodeIds: new Set(),
        pendingOptimisticNodes: new Map(),
        queuedOptimisticCommands: new Map(),
        optimisticDraftInputValues: new Map(),
        pendingCommandRequests: new Map(),
        cancelledCommandNodeIds: new Set(),
        cancelledCommandNodeTokens: new Map(),
        directEditSession: undefined,
        imeDebugTrace: [],
        directKeyQueue: [],
        activeMapPointerDragId: undefined,
        suppressedMapNodeActivation: undefined,
        draggedMapNodeId: undefined,
        dragOverMapNodeId: undefined,
        dragOverMapDropPosition: undefined,
        dragOverMapColumnParentId: undefined,
        dragOverMapColumnRawIndex: undefined,
        dragOverMapColumnSide: undefined,
        mapColumnBoundsCache: undefined,
        mapZoom: MAP_ZOOM_DEFAULT,
        collapsedNodeIds: new Set(),
        searchQuery: "",
        searchMatchNodeIds: [],
        activeSearchMatchIndex: -1,
        isPickingReparentTarget: false,
        lastDocumentVersion: undefined,
        syncStatus: {
          state: "idle",
          message: ""
        },
        diagnostics: [],
        pendingParseRecoveryModelUpdate: false
      };
      thoughtforgeState.commandPaletteOpen = false;
      thoughtforgeState.shortcutOverlayOpen = false;
      thoughtforgeState.commandPaletteQuery = "";
      thoughtforgeState.commandPaletteActiveIndex = 0;
      thoughtforgeState.debugTraceEnabled = window.thoughtforgeInitialSettings?.settings?.debugTrace === true;
      const THOUGHTFORGE_TRACE_PREFIX = "[thoughtforge.trace]";
      function postDebugTraceRecordToExtension(record) {
        bridge.post({
          type: "thoughtforge.debug.trace",
          record
        });
      }
      function traceDebugEvent(event) {
        if (!thoughtforgeState.debugTraceEnabled) {
          return;
        }
        const seen = new WeakSet();
        const sanitize = (value, key = "") => {
          if (/(?:secret|token|password|authorization|api[_-]?key|private[_-]?key|access[_-]?key|refresh[_-]?key)/i.test(key)) return "[redacted]";
          if (typeof value === "string") return /^(?:markdown|body|content|fallbackText|text|note)$/i.test(key) || value.length > 120 ? { length: value.length } : value;
          if (!value || typeof value !== "object") return typeof value === "bigint" ? value.toString() : value;
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
          if (Array.isArray(value)) return value.map((item) => sanitize(item));
          return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
        };
        const record = {
          ts: new Date().toISOString(),
          source: "webview",
          ...event,
          payload: sanitize(event.payload)
        };
        console.debug(THOUGHTFORGE_TRACE_PREFIX, JSON.stringify(record));
        postDebugTraceRecordToExtension(record);
      }
      function summarizeWebviewMessage(message) {
        if (message?.type === "thoughtforge.command") return { type: message.type, requestId: message.requestId, command: message.command?.type, nodeId: message.command?.nodeId, siblingId: message.command?.siblingId, parentId: message.command?.parentId };
        if (message?.type === "thoughtforge.command.result") return { type: message.type, requestId: message.requestId, status: message.status, reason: message.reason };
        if (message?.type === "thoughtforge.clipboard.write") return { type: message.type, scope: message.scope, nodeId: message.nodeId, textLength: String(message.text ?? "").length };
        if (message?.type === "thoughtforge.debug.trace") return { type: message.type, scope: message.record?.scope, event: message.record?.event, nodeId: message.record?.nodeId };
        if (message?.type === "thoughtforge.markdown-link.open") return { type: message.type, titleLength: String(message.title ?? "").length };
        if (message?.type === "thoughtforge.source.reveal") return { type: message.type, nodeId: message.nodeId, line: message.range?.start?.line };
        if (message?.type === "thoughtforge.model.update") return { type: message.type, version: message.document?.version, markdownLength: String(message.document?.text ?? "").length, nodeCount: message.map?.nodesById ? Object.keys(message.map.nodesById).length : undefined };
        if (message?.type === "thoughtforge.parse.error") return { type: message.type, issueCount: Array.isArray(message.issues) ? message.issues.length : undefined, fallbackLength: String(message.fallbackText ?? "").length };
        if (message?.type === "thoughtforge.settings.update") return { type: message.type, settings: message.settings };
        return { type: message?.type };
      }
      function postThoughtForgeWebviewMessage(message, clipboardRequestId) {
        if (message?.type === "thoughtforge.clipboard.write" && !clipboardRequestId) clearBranchCopy();
        if (message?.type === 'thoughtforge.clipboard.write' && hostPolicy?.allocateCopyEffect) {
          clipboardRequestId ??= hostPolicy.allocateCopyEffect();
          if (!clipboardRequestId) return;
        }
        traceDebugEvent({
          scope: "webview",
          event: "postMessage",
          payload: summarizeWebviewMessage(message)
        });
        bridge.post(message, { clipboardRequestId });
      }
      const titleElement = document.querySelector("[data-thoughtforge-title]");
      const outlineElement = document.querySelector("[data-thoughtforge-outline]");
      const outlineTitleElement = document.querySelector("[data-thoughtforge-outline-title]");
      const mindMapElement = document.querySelector("[data-thoughtforge-mind-map]");
      if (concentrationView) {
        mindMapElement?.setAttribute('data-concentration-view', 'true');
        own(() => mindMapElement?.removeAttribute('data-concentration-view'));
      }
      const mapZoomOutButton = document.querySelector("[data-thoughtforge-map-zoom-out]");
      const mapZoomInButton = document.querySelector("[data-thoughtforge-map-zoom-in]");
      const mapZoomResetButton = document.querySelector("[data-thoughtforge-map-zoom-reset]");
      const mapZoomValueElement = document.querySelector("[data-thoughtforge-map-zoom-value]");
      function createConcentrationControls() {
        if (!concentrationView) return;
        const toolbar = document.querySelector('[data-thoughtforge-map-zoom-toolbar]');
        if (!toolbar) return;
        toolbar.querySelector('[data-thoughtforge-concentration-controls]')?.remove();
        const controls = document.createElement('span');
        controls.dataset.thoughtforgeConcentrationControls = 'true';
        const ja = document.documentElement.lang === 'ja';
        const button = (attr, title, run) => {
          const e = document.createElement('button'); e.type = 'button';
          e.setAttribute(attr, ''); e.textContent = title; e.setAttribute('aria-label', title);
          if (run) listen(e, 'click', run);
          controls.appendChild(e); return e;
        };
        button('data-thoughtforge-focus-toggle', 'Focus', () => localMapCommand(isConcentrationFocusActive() ? 'map-clear-focus' : 'map-focus-selected', () => {}));
        button('data-thoughtforge-focus-follow', ja ? '選択追従' : 'Follow selection', () => localMapCommand('map-focus-follow-selection', () => {}));
        const status = document.createElement('output');
        status.dataset.thoughtforgeConcentrationStatus = 'true'; status.setAttribute('aria-live', 'polite'); controls.appendChild(status);
        const input = document.createElement('input'); input.type = 'search'; input.className = 'thoughtforge-search-input';
        input.dataset.thoughtforgeSearchInput = 'true'; input.placeholder = 'Quick Filter'; input.setAttribute('aria-label', 'Quick Filter'); controls.appendChild(input);
        button('data-thoughtforge-search-previous', ja ? '前' : 'Previous');
        button('data-thoughtforge-search-next', ja ? '次' : 'Next');
        button('data-thoughtforge-search-clear', ja ? '解除' : 'Clear');
        const search = document.createElement('output'); search.dataset.thoughtforgeSearchStatus = 'true'; search.setAttribute('aria-live', 'polite'); controls.appendChild(search);
        const depth = document.createElement('select'); depth.dataset.thoughtforgeViewDepth = 'true'; depth.setAttribute('aria-label', ja ? '表示深度' : 'Display depth');
        const initial = document.createElement('option'); initial.value = ''; initial.textContent = ja ? '深度' : 'Depth'; depth.appendChild(initial);
        for (let n = 0; n <= 9; n++) { const o = document.createElement('option'); o.value = String(n); o.textContent = n ? String(n) : (ja ? '全階層' : 'All'); depth.appendChild(o); }
        listen(depth, 'change', () => { if (depth.value !== '') localMapCommand(depth.value === '0' ? 'map-depth-all' : 'map-depth-'+depth.value, () => setSubtreeDepth(Number(depth.value))); depth.value = ''; }); controls.appendChild(depth);
        listen(controls, 'keydown', event => { if (event.key === 'Escape' && !isImeCompositionShortcutEvent(event) && thoughtforgeState.searchQuery) { event.preventDefault(); localMapCommand('map-filter-clear',clearSearchQuery); } event.stopPropagation(); });
        toolbar.appendChild(controls); own(() => controls.remove());
      }
      createConcentrationControls();
      const focusBreadcrumbElement = document.querySelector("[data-thoughtforge-focus-breadcrumb]");
      const nodeNotePanel = document.querySelector("[data-thoughtforge-node-note-panel]");
      const nodeNoteTitle = document.querySelector("[data-thoughtforge-node-note-title]");
      const nodeNoteEditor = document.querySelector("[data-thoughtforge-node-note-editor]");
      const nodeNoteSaveButton = document.querySelector("[data-thoughtforge-node-note-save]");
      const nodeNoteClearButton = document.querySelector("[data-thoughtforge-node-note-clear]");
      const revealSourceButton = document.querySelector("[data-thoughtforge-reveal-source]");
      const sourcePanel = document.querySelector("[data-thoughtforge-source-panel]");
      const sourceRangeElement = document.querySelector("[data-thoughtforge-source-range]");
      const sourcePreviewElement = document.querySelector("[data-thoughtforge-source-preview]");
      const wikiLinksElement = document.querySelector("[data-thoughtforge-wiki-links]");
      const renameForm = document.querySelector("[data-thoughtforge-rename-form]");
      const renameInput = document.querySelector("[data-thoughtforge-rename-input]");
      const editButtons = document.querySelectorAll("[data-thoughtforge-command]");
      const commandButtons = document.querySelectorAll("button[type='button'][data-thoughtforge-command]");
      const reparentSelect = document.querySelector("[data-thoughtforge-reparent-select]");
      const reparentApplyButton = document.querySelector("[data-thoughtforge-reparent-apply]");
      const collapseDepthButtons = document.querySelectorAll("[data-thoughtforge-collapse-depth]");
      const expandAllButton = document.querySelector("[data-thoughtforge-expand-all]");
      const searchInput = document.querySelector("[data-thoughtforge-search-input]");
      const searchStatus = document.querySelector("[data-thoughtforge-search-status]");
      const searchPreviousButton = document.querySelector("[data-thoughtforge-search-previous]");
      const searchNextButton = document.querySelector("[data-thoughtforge-search-next]");
      const searchClearButton = document.querySelector("[data-thoughtforge-search-clear]");
      const searchScopeElement = document.querySelector("[data-thoughtforge-search-scope]");
      const searchResultsElement = document.querySelector("[data-thoughtforge-search-results]");
      const syncStatusElement = document.querySelector("[data-thoughtforge-sync-status]");
      const diagnosticsPanel = document.querySelector("[data-thoughtforge-diagnostics]");
      const diagnosticsList = document.querySelector("[data-thoughtforge-diagnostics-list]");
      const shellElement = document.querySelector("[data-thoughtforge-view]");
      const reparentPickButton = document.querySelector("[data-thoughtforge-reparent-pick]");
      const copyButtons = document.querySelectorAll("[data-thoughtforge-copy]");
      const copyContextButtons = document.querySelectorAll("[data-thoughtforge-copy-context]");
      const copyIssueDraftButtons = document.querySelectorAll("[data-thoughtforge-copy-issue]");
      const copyDesignDocButtons = document.querySelectorAll("[data-thoughtforge-copy-design]");
      const copyTestMatrixButtons = document.querySelectorAll("[data-thoughtforge-copy-test-matrix]");
      const promptTemplateSelect = document.querySelector("[data-thoughtforge-prompt-template]");
      const promptPackIncludeNotesCheckbox = document.querySelector("[data-thoughtforge-prompt-pack-include-notes]");
      const copyPromptTemplateButtons = document.querySelectorAll("[data-thoughtforge-copy-prompt-template]");
      const copySvgButtons = document.querySelectorAll("[data-thoughtforge-copy-svg]");
      const copyStatusElement = document.querySelector("[data-thoughtforge-copy-status]");
      const nodeContextMenuElement = document.querySelector("[data-thoughtforge-node-context-menu]");
      const nodeContextMenuTitleElement = document.querySelector("[data-thoughtforge-node-context-title]");
      const nodeContextMenuPathElement = document.querySelector("[data-thoughtforge-node-context-path]");
      const nodeContextMenuActionButtons = document.querySelectorAll("[data-thoughtforge-node-context-action]");
      const shortcutOverlayElement = document.querySelector("[data-thoughtforge-shortcut-overlay]");
      const shortcutOverlayCloseButton = document.querySelector("[data-thoughtforge-shortcut-close]");
      const commandPaletteElement = document.querySelector("[data-thoughtforge-command-palette]");
      const commandPaletteCloseButton = document.querySelector("[data-thoughtforge-command-palette-close]");
      const commandPaletteInput = document.querySelector("[data-thoughtforge-command-palette-input]");
      const commandPaletteList = document.querySelector("[data-thoughtforge-command-palette-list]");

      function clearChildren(element) {
        if (typeof element.replaceChildren === "function") {
          element.replaceChildren();
          return;
        }
        element.textContent = "";
      }

      function nodeText(nodeId) {
        if (isMapTitleRootNodeId(nodeId)) {
          return mapTitleRootText();
        }
        return thoughtforgeState.map?.nodesById?.[nodeId]?.text ?? nodeId;
      }

      function selectedNode() {
        return thoughtforgeState.map?.nodesById?.[thoughtforgeState.selectedNodeId];
      }

      function clampMapZoom(value) {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          return MAP_ZOOM_DEFAULT;
        }
        return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, numericValue));
      }

      function formatMapZoom(value) {
        return Math.round(clampMapZoom(value) * 100) + "%";
      }

      function setMapZoom(nextZoom) {
        hostPolicy?.commandContextChanged?.();
        thoughtforgeState.mapZoom = clampMapZoom(nextZoom);
        updateMapZoomControls();
      }

      function stepMapZoom(direction) {
        setMapZoom(thoughtforgeState.mapZoom + (direction < 0 ? -MAP_ZOOM_STEP : MAP_ZOOM_STEP));
      }

      function handleMapZoomWheel(event) {
        if (!isPrimaryShortcut(event) || event.altKey || event.shiftKey || event.deltaY === 0) {
          return;
        }
        event.preventDefault();
        stepMapZoom(event.deltaY > 0 ? -1 : 1);
      }

      function updateMapZoomControls() {
        const zoom = clampMapZoom(thoughtforgeState.mapZoom);
        thoughtforgeState.mapZoom = zoom;
        mindMapElement?.style.setProperty("--thoughtforge-map-zoom", String(zoom));
        if (mapZoomValueElement) {
          mapZoomValueElement.textContent = formatMapZoom(zoom);
        }
        if (mapZoomOutButton) {
          mapZoomOutButton.disabled = zoom <= MAP_ZOOM_MIN;
        }
        if (mapZoomInButton) {
          mapZoomInButton.disabled = zoom >= MAP_ZOOM_MAX;
        }
        if (mapZoomResetButton) {
          mapZoomResetButton.disabled = zoom === MAP_ZOOM_DEFAULT;
        }
      }

      const splitMapMainBranches = (${splitMapMainBranches.toString()});

      function mapSideForNode(nodeId) {
        const map = thoughtforgeState.map;
        if (!map || !nodeId || isMapTitleRootNodeId(nodeId)) {
          return "center";
        }
        let topLevelId = nodeId;
        let parentId = parentIdForNode(topLevelId);
        while (parentId) {
          topLevelId = parentId;
          parentId = parentIdForNode(topLevelId);
        }
        return splitMapMainBranches(getVisibleRootIds(map)).left.includes(topLevelId) ? "left" : "right";
      }

      function isMapTitleRootNodeId(nodeId) {
        return nodeId === THOUGHTFORGE_MAP_TITLE_ROOT_ID;
      }

      function isMapTitleRootSelected() {
        return isMapTitleRootNodeId(thoughtforgeState.selectedNodeId);
      }

      function selectedCopyTarget() {
        if (commandTarget !== undefined) return copyTargetForNodeId(commandTarget);
        const contextMenuTarget = copyTargetForNodeId(thoughtforgeState.contextMenuNodeId);
        if (contextMenuTarget) {
          return contextMenuTarget;
        }
        return copyTargetForNodeId(thoughtforgeState.selectedNodeId);
      }

      function copyTargetForNodeId(nodeId) {
        if (!nodeId) {
          return undefined;
        }
        if (isMapTitleRootNodeId(nodeId)) {
          return { id: THOUGHTFORGE_MAP_TITLE_ROOT_ID, text: mapTitleRootText(), virtual: true };
        }
        return thoughtforgeState.map?.nodesById?.[nodeId];
      }

      function documentFileNameLabel() {
        try {
          const url = new URL(thoughtforgeDocumentUri);
          const path = url.protocol === "file:" ? url.pathname : url.href;
          const fileName = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
          return fileName || "Untitled map";
        } catch {
          const fileName = String(thoughtforgeDocumentUri ?? "").split("/").filter(Boolean).pop() ?? "";
          return fileName || "Untitled map";
        }
      }

      function mapTitleRootText() {
        return String(thoughtforgeState.map?.title ?? "").trim() || documentFileNameLabel();
      }

      function isEmptyDocumentDraftMap() {
        const map = thoughtforgeState.map;
        return !!(map&&!String(thoughtforgeState.document?.text??"").trim()&&!String(map.title??"").trim()&&map.roots?.length===0);
      }

      function isRootlessMap() {
        const map = thoughtforgeState.map;
        return !!(map && String(map.title ?? "").trim() && map.roots?.length === 0);
      }

      function isFirstInputMap() {
        return isEmptyDocumentDraftMap() || isRootlessMap();
      }

      function isThoughtForgeCommandPaletteEditingMode() {
        return Boolean(
          thoughtforgeState.editingNodeId ||
          document.activeElement?.hasAttribute?.("data-thoughtforge-map-direct-rename-input") ||
          document.activeElement?.hasAttribute?.("data-thoughtforge-outline-direct-rename-input") ||
          document.activeElement === nodeNoteEditor
        );
      }

      function focusableElementsWithin(container) {
        if (!container) {
          return [];
        }
        return Array.from(container.querySelectorAll(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
        )).filter((element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }
          const style = window.getComputedStyle(element);
          return !element.hidden && style.visibility !== "hidden" && style.display !== "none";
        });
      }

      function trapFocusWithin(container, event) {
        if (event.key !== "Tab") {
          return false;
        }
        const focusableElements = focusableElementsWithin(container);
        if (!focusableElements.length) {
          return false;
        }
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement;
        if (!container.contains(activeElement)) {
          event.preventDefault();
          first.focus();
          return true;
        }
        if (event.shiftKey && activeElement === first) {
          event.preventDefault();
          last.focus();
          return true;
        }
        if (!event.shiftKey && activeElement === last) {
          event.preventDefault();
          first.focus();
          return true;
        }
        return false;
      }

      function handleThoughtForgeModalFocusTrap(event) {
        if (!(event.currentTarget instanceof HTMLElement)) {
          return;
        }
        trapFocusWithin(event.currentTarget, event);
      }

      function thoughtForgeCommandPaletteContext() {
        return {
          hasMap: Boolean(thoughtforgeState.map),
          hasSelection: Boolean(selectedNode()),
          focusActive: isConcentrationFocusActive(),
          editing: isThoughtForgeCommandPaletteEditingMode(),
          hasParseErrors: Array.isArray(thoughtforgeState.diagnostics) && thoughtforgeState.diagnostics.length > 0
        };
      }

      function showShortcutOverlay() {
        hostPolicy?.commandContextChanged?.();
        thoughtforgeState.shortcutOverlayOpen = true;
        if (shortcutOverlayElement) {
          shortcutOverlayElement.hidden = false;
        }
        shortcutOverlayCloseButton?.focus();
      }

      function closeShortcutOverlay() {
        hostPolicy?.commandContextChanged?.();
        thoughtforgeState.shortcutOverlayOpen = false;
        if (shortcutOverlayElement) {
          shortcutOverlayElement.hidden = true;
        }
      }

      function closeThoughtForgeCommandPalette() {
        hostPolicy?.commandContextChanged?.();
        thoughtforgeState.commandPaletteOpen = false;
        thoughtforgeState.commandPaletteQuery = "";
        thoughtforgeState.commandPaletteActiveIndex = 0;
        if (commandPaletteElement) {
          commandPaletteElement.hidden = true;
        }
        if (commandPaletteInput) {
          commandPaletteInput.value = "";
          commandPaletteInput.setAttribute("aria-expanded", "false");
          commandPaletteInput.removeAttribute("aria-activedescendant");
        }
      }

      // The legacy palette metadata and transport IDs share one row per action.
      const thoughtForgeCommandPaletteCommands = [
        ['add-sibling','insert-sibling-after','兄弟ノードを追加','選択中ノードの後ろに兄弟を追加します。','enter sibling node',c=>c.hasSelection&&!c.editing,()=>handleThoughtForgeEditCommand('node.insertSibling')],
        ['add-child','insert-child','子ノードを追加','選択中ノードの下に子を追加します。','command enter tab child node',c=>c.hasSelection&&!c.editing,()=>handleThoughtForgeEditCommand('node.insertChild')],
        ['rename-selected-node','edit-title','選択中ノードの名前を変更','タイトル直接編集欄へフォーカスします。','f2 rename edit title',c=>c.hasSelection,focusRenameInput],
        ['delete-selected-node','delete-branch','選択中ノードを削除','選択中ノードをマップから削除します。','delete backspace remove',c=>c.hasSelection&&!c.editing,()=>handleThoughtForgeEditCommand('node.delete')],
        ['focus-selected-branch','focus-selected','選択中の枝にフォーカス',concentrationView?'選択中の枝を通常の濃さにし、枝外を減光します。':'選択中の枝だけを表示します。','f focus branch',c=>(c.hasSelection||concentrationView&&c.hasMap)&&!c.focusActive,()=>{if(focusSelectedBranch())renderThoughtForgeMap();}],
        ...(concentrationView?[['focus-follow-selection','focus-follow-selection','Focus:選択追従','選択中のトピックと子孫を通常の濃さにします。無選択では全体が通常の濃さです。','focus follow selection',c=>concentrationView&&c.hasMap,()=>{setFocusFollowingSelection();renderThoughtForgeSelection();}]]:[]),
        ['clear-focus','clear-focus','フォーカスを解除','マップ全体の表示へ戻します。','escape all focus',c=>c.focusActive,()=>{if(clearFocusMode())renderThoughtForgeMap();}],
        ['reveal-markdown-source','reveal-source','Markdownソースを表示','選択中ノードのMarkdown位置を開きます。','source markdown reveal',c=>c.hasSelection,requestSelectedNodeRevealInSource],
        ['copy-selected-subtree-markdown','copy-subtree-markdown','選択サブツリーをMarkdownでコピー','選択中サブツリーのMarkdownをコピーします。','copy subtree markdown',c=>c.hasSelection,()=>postClipboardWrite('subtree')],
        ['copy-for-codex-claude','copy-subtree-ai-worker','AI Context Packをコピー','選択中サブツリーの構造化AI文脈をコピーします。','copy codex claude chatgpt ai context pack',c=>c.hasSelection,()=>postClipboardAiContextPackWrite('subtree','codex-worker','full')],
        ['export-issue-draft','copy-subtree-issue-draft','Issue下書きを出力','選択中ノードからGitHub Issue下書きをコピーします。','github issue export draft',c=>c.hasSelection,()=>postClipboardIssueDraftWrite('subtree')]
      ].map(([id,operation,title,description,keywords,isEnabled,run])=>({id,title,description,keywords,
        isEnabled:concentrationView?()=>!localCommandBlocked('map-'+operation):isEnabled,
        run:concentrationView?()=>dispatchMapCommand('map-'+operation,false):run}));

      function filteredThoughtForgeCommandPaletteCommands() {
        const query = normalizeSearchText(thoughtforgeState.commandPaletteQuery);
        return thoughtForgeCommandPaletteCommands.filter((command) => {
          if (!query) {
            return true;
          }
          return normalizeSearchText(command.title + " " + command.description + " " + command.keywords).includes(query);
        });
      }

      function renderThoughtForgeCommandPalette() {
        if (!commandPaletteList) {
          return;
        }
        const context = thoughtForgeCommandPaletteContext();
        const commands = filteredThoughtForgeCommandPaletteCommands();
        thoughtforgeState.commandPaletteActiveIndex = Math.max(
          0,
          Math.min(thoughtforgeState.commandPaletteActiveIndex, Math.max(0, commands.length - 1))
        );
        clearChildren(commandPaletteList);
        commands.forEach((command, index) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          const enabled = command.isEnabled(context);
          button.type = "button";
          button.className = "thoughtforge-command-option";
          button.id = "thoughtforge-command-option-" + command.id;
          button.setAttribute("role", "option");
          button.dataset.thoughtforgeCommandPaletteCommand = command.id;
          button.dataset.active = index === thoughtforgeState.commandPaletteActiveIndex ? "true" : "false";
          button.disabled = !enabled;
          button.title = command.description;
          button.setAttribute("aria-selected", index === thoughtforgeState.commandPaletteActiveIndex ? "true" : "false");
          button.setAttribute(
            "aria-label",
            command.title + ". " + command.description + (enabled ? "" : " Unavailable in current state.")
          );
          button.textContent = command.title;
          const description = document.createElement("span");
          description.className = "thoughtforge-command-description";
          description.textContent = enabled ? command.description : command.description + " Unavailable in current state.";
          button.appendChild(description);
          listen(button, "mouseenter", () => {
            thoughtforgeState.commandPaletteActiveIndex = index;
            renderThoughtForgeCommandPalette();
          });
          listen(button, "click", () => {
            executeThoughtForgeCommandPaletteCommand(index);
          });
          item.appendChild(button);
          commandPaletteList.appendChild(item);
        });
        commandPaletteInput?.setAttribute(
          "aria-activedescendant",
          commands[thoughtforgeState.commandPaletteActiveIndex]?.id
            ? "thoughtforge-command-option-" + commands[thoughtforgeState.commandPaletteActiveIndex].id
            : ""
        );
      }

      function showThoughtForgeCommandPalette() {
        hostPolicy?.commandContextChanged?.();
        thoughtforgeState.commandPaletteOpen = true;
        thoughtforgeState.commandPaletteQuery = "";
        thoughtforgeState.commandPaletteActiveIndex = 0;
        if (commandPaletteElement) {
          commandPaletteElement.hidden = false;
        }
        if (commandPaletteInput) {
          commandPaletteInput.value = "";
          commandPaletteInput.setAttribute("aria-expanded", "true");
          commandPaletteInput.focus();
          commandPaletteInput.select();
        }
        renderThoughtForgeCommandPalette();
      }

      function executeThoughtForgeCommandPaletteCommand(index = thoughtforgeState.commandPaletteActiveIndex) {
        const context = thoughtForgeCommandPaletteContext();
        const commands = filteredThoughtForgeCommandPaletteCommands();
        const command = commands[index];
        if (!command || !command.isEnabled(context)) {
          return false;
        }
        closeThoughtForgeCommandPalette();
        command.run();
        return true;
      }

      function handleThoughtForgeCommandPaletteKeydown(event) {
        const commands = filteredThoughtForgeCommandPaletteCommands();
        if (event.key === "Escape") {
          event.preventDefault();
          closeThoughtForgeCommandPalette();
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          thoughtforgeState.commandPaletteActiveIndex = Math.min(
            commands.length - 1,
            thoughtforgeState.commandPaletteActiveIndex + 1
          );
          renderThoughtForgeCommandPalette();
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          thoughtforgeState.commandPaletteActiveIndex = Math.max(0, thoughtforgeState.commandPaletteActiveIndex - 1);
          renderThoughtForgeCommandPalette();
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          executeThoughtForgeCommandPaletteCommand();
        }
      }

      function closeThoughtForgeCommandSurfaces() {
        if (thoughtforgeState.shortcutOverlayOpen) {
          closeShortcutOverlay();
          return true;
        }
        if (thoughtforgeState.commandPaletteOpen) {
          closeThoughtForgeCommandPalette();
          return true;
        }
        return false;
      }

      function wikiLinkTitlesFromText(value) {
        const titles = [];
        const seen = new Set();
        const pattern = /\\[\\[([^\\]\\n]+)\\]\\]/g;
        let match;
        while ((match = pattern.exec(String(value ?? "")))) {
          const title = match[1].replace(/\\s+/g, " ").trim();
          if (title && !seen.has(title)) {
            seen.add(title);
            titles.push(title);
          }
        }
        return titles;
      }

      function wikiLinkTitlesForNode(node) {
        const titles = [];
        const seen = new Set();
        for (const title of [
          ...wikiLinkTitlesFromText(node ? nodeText(node.id) : ""),
          ...wikiLinkTitlesFromText(node?.note ?? "")
        ]) {
          if (!seen.has(title)) {
            seen.add(title);
            titles.push(title);
          }
        }
        return titles;
      }

      function requestMarkdownLinkOpen(title) {
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.markdown-link.open",
          title
        });
        if (copyStatusElement) {
          copyStatusElement.textContent = "Markdown link open requested.";
        }
      }

      function syncWikiLinkActions(node) {
        if (!wikiLinksElement) {
          return;
        }
        clearChildren(wikiLinksElement);
        const titles = node ? wikiLinkTitlesForNode(node) : [];
        wikiLinksElement.hidden = titles.length === 0;
        for (const title of titles) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "thoughtforge-wiki-link-button";
          button.dataset.thoughtforgeWikiLinkTitle = title;
          button.textContent = "[[" + title + "]]";
          listen(button, "click", () => {
            requestMarkdownLinkOpen(title);
          });
          wikiLinksElement.appendChild(button);
        }
      }

      function normalizeSearchText(value) {
        return String(value ?? "").trim().toLowerCase();
      }

      function searchNodeOrder(map) {
        const result = [];
        const nodesById = map?.nodesById ?? {};
        const visit = (nodeId) => {
          const node = nodesById[nodeId];
          if (!node) {
            return;
          }
          result.push(nodeId);
          for (const childId of node.children ?? []) {
            visit(childId);
          }
        };
        for (const rootId of Array.isArray(map?.roots) ? map.roots : []) {
          visit(rootId);
        }
        return result;
      }

      function getVisibleRootIds(map, focusRootNodeId = thoughtforgeState.focusRootNodeId) {
        if (concentrationView || !focusRootNodeId || !map?.nodesById?.[focusRootNodeId]) {
          return Array.isArray(map?.roots) ? map.roots : [];
        }
        return [focusRootNodeId];
      }

      function isNodeInFocusSubtree(nodeId) {
        if (concentrationView) return true;
        const focusRootNodeId = thoughtforgeState.focusRootNodeId;
        if (!focusRootNodeId) {
          return true;
        }
        return nodeId === focusRootNodeId || isDescendantOf(nodeId, focusRootNodeId);
      }

      function searchNodeOrderWithinFocus(map) {
        if (concentrationView) return [THOUGHTFORGE_MAP_TITLE_ROOT_ID, ...searchNodeOrder(map)];
        return searchNodeOrder(map).filter(isNodeInFocusSubtree);
      }

      function getAncestors(map, nodeId) {
        const ancestors = [];
        let current = map?.nodesById?.[nodeId];
        while (current?.parentId || parentIdForNode(current?.id)) {
          const parentId = current.parentId ?? parentIdForNode(current.id);
          const parent = map?.nodesById?.[parentId];
          if (!parent) {
            break;
          }
          ancestors.unshift(parent);
          current = parent;
        }
        return ancestors;
      }

      function clearFocusMode() {
        if (!thoughtforgeState.focusRootNodeId && !thoughtforgeState.focusFollowingSelection) {
          return false;
        }
        thoughtforgeState.focusRootNodeId = undefined;
        thoughtforgeState.focusFollowingSelection = false;
        recomputeSearchMatches();
        return true;
      }

      function isConcentrationFocusActive() {
        return Boolean(thoughtforgeState.focusRootNodeId || thoughtforgeState.focusFollowingSelection);
      }

      function setFocusFollowingSelection() {
        if (!concentrationView) return false;
        thoughtforgeState.focusRootNodeId = undefined;
        thoughtforgeState.focusFollowingSelection = true;
        return true;
      }

      function focusSelectedBranch() {
        if (concentrationView && !thoughtforgeState.selectedNodeId) return setFocusFollowingSelection();
        if (concentrationView && isMapTitleRootSelected()) return setFocusRootNodeId(THOUGHTFORGE_MAP_TITLE_ROOT_ID);
        const node = selectedNode();
        if (!node) {
          return false;
        }
        return setFocusRootNodeId(node.id);
      }

      function rememberFocusRoot(nextNodeId) {
        const currentFocusRootNodeId = thoughtforgeState.focusRootNodeId;
        if (
          currentFocusRootNodeId &&
          currentFocusRootNodeId !== nextNodeId &&
          thoughtforgeState.map?.nodesById?.[currentFocusRootNodeId]
        ) {
          thoughtforgeState.focusHistoryNodeIds = [
            currentFocusRootNodeId,
            ...thoughtforgeState.focusHistoryNodeIds.filter((historyNodeId) => historyNodeId !== currentFocusRootNodeId)
          ].slice(0, 20);
          thoughtforgeState.focusForwardNodeIds = [];
        }
      }

      function pruneFocusHistory(map = thoughtforgeState.map) {
        thoughtforgeState.focusHistoryNodeIds = thoughtforgeState.focusHistoryNodeIds.filter(
          (nodeId) => nodeId !== thoughtforgeState.focusRootNodeId && Boolean(map?.nodesById?.[nodeId])
        );
        thoughtforgeState.focusForwardNodeIds = thoughtforgeState.focusForwardNodeIds.filter(
          (nodeId) => nodeId !== thoughtforgeState.focusRootNodeId && Boolean(map?.nodesById?.[nodeId])
        );
      }

      function setFocusRootNodeId(nodeId, options = {}) {
        if (!nodeId) {
          return clearFocusMode();
        }
        if (!thoughtforgeState.map?.nodesById?.[nodeId] && !(concentrationView && isMapTitleRootNodeId(nodeId))) {
          return false;
        }
        if (concentrationView) {
          if (options.recordHistory !== false) rememberFocusRoot(nodeId);
          thoughtforgeState.focusRootNodeId = nodeId;
          thoughtforgeState.focusFollowingSelection = false;
          return true;
        }
        if (options.recordHistory !== false) {
          rememberFocusRoot(nodeId);
        }
        thoughtforgeState.focusRootNodeId = nodeId;
        if (thoughtforgeState.selectedNodeId && !isNodeInFocusSubtree(thoughtforgeState.selectedNodeId)) {
          thoughtforgeState.selectedNodeId = nodeId;
        }
        if (!thoughtforgeState.selectedNodeId) {
          thoughtforgeState.selectedNodeId = nodeId;
        }
        pruneFocusHistory();
        revealNodeAncestors(nodeId);
        recomputeSearchMatches();
        return true;
      }

      function restorePreviousFocusRoot() {
        pruneFocusHistory();
        const previousNodeId = thoughtforgeState.focusHistoryNodeIds.shift();
        if (!previousNodeId) {
          return false;
        }
        if (thoughtforgeState.focusRootNodeId) {
          thoughtforgeState.focusForwardNodeIds = [
            thoughtforgeState.focusRootNodeId,
            ...thoughtforgeState.focusForwardNodeIds.filter((nodeId) => nodeId !== thoughtforgeState.focusRootNodeId)
          ].slice(0, 20);
        }
        return setFocusRootNodeId(previousNodeId, { recordHistory: false });
      }

      function restoreNextFocusRoot() {
        pruneFocusHistory();
        const nextNodeId = thoughtforgeState.focusForwardNodeIds.shift();
        if (!nextNodeId) {
          return false;
        }
        if (thoughtforgeState.focusRootNodeId) {
          thoughtforgeState.focusHistoryNodeIds = [
            thoughtforgeState.focusRootNodeId,
            ...thoughtforgeState.focusHistoryNodeIds.filter((nodeId) => nodeId !== thoughtforgeState.focusRootNodeId)
          ].slice(0, 20);
        }
        return setFocusRootNodeId(nextNodeId, { recordHistory: false });
      }

      function siblingFocusNodeIds(map = thoughtforgeState.map, focusRootNodeId = thoughtforgeState.focusRootNodeId) {
        const focusRootNode = map?.nodesById?.[focusRootNodeId];
        if (!focusRootNode) {
          return [];
        }
        const parentId = focusRootNode.parentId ?? parentIdForNode(focusRootNode.id);
        if (!parentId) {
          return Array.isArray(map?.roots) ? map.roots.filter((nodeId) => Boolean(map?.nodesById?.[nodeId])) : [];
        }
        const parentNode = map?.nodesById?.[parentId];
        return Array.isArray(parentNode?.children)
          ? parentNode.children.filter((nodeId) => Boolean(map?.nodesById?.[nodeId]))
          : [];
      }

      function adjacentSiblingFocusNodeId(direction) {
        const focusRootNodeId = thoughtforgeState.focusRootNodeId;
        const siblings = siblingFocusNodeIds();
        const currentIndex = siblings.indexOf(focusRootNodeId);
        if (currentIndex === -1 || siblings.length < 2) {
          return undefined;
        }
        const offset = direction === "previous" ? -1 : 1;
        return siblings[(currentIndex + offset + siblings.length) % siblings.length];
      }

      function focusSiblingBranch(direction) {
        const nextNodeId = adjacentSiblingFocusNodeId(direction);
        if (!nextNodeId) {
          return false;
        }
        return setFocusRootNodeId(nextNodeId);
      }

      function syncFocusRootWithMap(map) {
        const focusRootNodeId = thoughtforgeState.focusRootNodeId;
        pruneFocusHistory(map);
        if (focusRootNodeId && !map?.nodesById?.[focusRootNodeId] && !(concentrationView && isMapTitleRootNodeId(focusRootNodeId))) {
          clearFocusMode();
          return;
        }
        if (
          focusRootNodeId &&
          thoughtforgeState.selectedNodeId &&
          !isNodeInFocusSubtree(thoughtforgeState.selectedNodeId)
        ) {
          thoughtforgeState.selectedNodeId = focusRootNodeId;
        }
      }

      function activeSearchNodeId() {
        return thoughtforgeState.searchMatchNodeIds[thoughtforgeState.activeSearchMatchIndex];
      }

      function prepareConcentrationFocus() {
        if (!concentrationView) return;
        const ids = thoughtforgeState.concentrationFocusIds;
        ids.clear();
        const root = thoughtforgeState.focusFollowingSelection ? thoughtforgeState.selectedNodeId : thoughtforgeState.focusRootNodeId;
        if (!root || isMapTitleRootNodeId(root)) return;
        const pending = [root];
        while (pending.length) {
          const id = pending.pop();
          if (ids.has(id)) continue;
          ids.add(id); pending.push(...(thoughtforgeState.map?.nodesById?.[id]?.children ?? []));
        }
      }

      function syncConcentrationAppearance(syncSearch = false) {
        if (!concentrationView && !syncSearch) return;
        if (concentrationView) prepareConcentrationFocus();
        const focusRoot = thoughtforgeState.focusFollowingSelection ? thoughtforgeState.selectedNodeId : thoughtforgeState.focusRootNodeId;
        const filter = Boolean(normalizeSearchText(thoughtforgeState.searchQuery));
        const matches = syncSearch ? new Set(thoughtforgeState.searchMatchNodeIds) : undefined;
        const active = syncSearch ? activeSearchNodeId() : undefined;
        const dimmed = id => Boolean((focusRoot && !isMapTitleRootNodeId(focusRoot) && !thoughtforgeState.concentrationFocusIds.has(id)) ||
          (filter && !thoughtforgeState.filterVisibleIds.has(id)));
        // Filter attributes and dimming share one traversal. Use direct DOM
        // relationships, so a branch's entire subtree is never searched per row.
        for (const root of [mindMapElement, outlineElement]) for (const row of root?.querySelectorAll(root === mindMapElement ? '.thoughtforge-map-node' : '.thoughtforge-node-row') ?? []) {
          const id = row.dataset.nodeId ?? row.parentElement.dataset.nodeId;
          if (syncSearch) {
            const match = !isMapTitleRootNodeId(id) && matches.has(id) ? 'true' : 'false';
            const current = !isMapTitleRootNodeId(id) && active === id ? 'true' : 'false';
            const set = element => {
              if (element.dataset.searchMatch !== match) element.dataset.searchMatch = match;
              if (element.dataset.activeSearchMatch !== current) element.dataset.activeSearchMatch = current;
            };
            if (root === mindMapElement) set(row);
            for (const child of row.children) {
              if (child.tagName === 'BUTTON' && child.classList.contains('thoughtforge-node')) { set(child); break; }
            }
          }
          if (!concentrationView) continue;
          const value = dimmed(id) ? 'true' : 'false';
          if (row.dataset.dimmed !== value) row.dataset.dimmed = value;
          if (row.parentElement.dataset.dimmed !== value) row.parentElement.dataset.dimmed = value;
          const line = row.parentElement.firstElementChild;
          if (line?.classList.contains('thoughtforge-map-connector') && line.dataset.dimmed !== value) line.dataset.dimmed = value;
        }
      }

      const normalizedNodeTextCache = new Map();

      function normalizedNodeText(nodeId) {
        const text = nodeText(nodeId);
        if (!concentrationView) return normalizeSearchText(text);
        const cached = normalizedNodeTextCache.get(nodeId);
        if (cached?.text === text) return cached.normalized;
        const normalized = normalizeSearchText(text);
        normalizedNodeTextCache.set(nodeId, {text, normalized});
        return normalized;
      }

      function recomputeSearchMatches() {
        thoughtforgeState.filterVisibleIds.clear();
        thoughtforgeState.temporaryExpandedNodeIds.clear();
        const query = normalizeSearchText(thoughtforgeState.searchQuery);
        const map = thoughtforgeState.map;
        if (!query || !map) {
          thoughtforgeState.searchMatchNodeIds = [];
          thoughtforgeState.activeSearchMatchIndex = -1;
          return;
        }

        thoughtforgeState.searchMatchNodeIds = searchNodeOrderWithinFocus(map).filter((nodeId) =>
          normalizedNodeText(nodeId).includes(query)
        );
        if (concentrationView) {
          const parents = renderParentIdIndex ?? createRenderParentIdIndex(map);
          for (const id of thoughtforgeState.searchMatchNodeIds) {
            thoughtforgeState.filterVisibleIds.add(id);
            let parent = parents.get(id);
            while (parent && !thoughtforgeState.temporaryExpandedNodeIds.has(parent)) {
              thoughtforgeState.filterVisibleIds.add(parent);
              thoughtforgeState.temporaryExpandedNodeIds.add(parent);
              parent = parents.get(parent);
            }
            thoughtforgeState.filterVisibleIds.add(THOUGHTFORGE_MAP_TITLE_ROOT_ID);
          }
          for (const id of thoughtforgeState.filterFoldedNodeIds) thoughtforgeState.temporaryExpandedNodeIds.delete(id);
        }
        const selectedMatchIndex = thoughtforgeState.searchMatchNodeIds.indexOf(thoughtforgeState.selectedNodeId);
        thoughtforgeState.activeSearchMatchIndex = selectedMatchIndex !== -1
          ? selectedMatchIndex
          : !concentrationView && thoughtforgeState.searchMatchNodeIds.length > 0 ? 0 : -1;
      }

      function syncActiveSearchMatchWithSelection() {
        if (!thoughtforgeState.selectedNodeId) {
          return;
        }
        const nextIndex = thoughtforgeState.searchMatchNodeIds.indexOf(thoughtforgeState.selectedNodeId);
        if (nextIndex !== -1) {
          thoughtforgeState.activeSearchMatchIndex = nextIndex;
        } else if (concentrationView) {
          thoughtforgeState.activeSearchMatchIndex = -1;
        }
      }

      function updateSearchControls() {
        if (concentrationView) {
          const status = document.querySelector('[data-thoughtforge-concentration-status]');
          const ja = document.documentElement.lang === 'ja';
          const text = thoughtforgeState.focusFollowingSelection ? (ja ? '選択追従' : 'Following selection') : thoughtforgeState.focusRootNodeId ? (ja ? '固定: ' : 'Fixed: ') + nodeText(thoughtforgeState.focusRootNodeId) : '';
          if (status && status.textContent !== text) status.textContent = text;
          const toggle = document.querySelector('[data-thoughtforge-focus-toggle]');
          const pressed = isConcentrationFocusActive() ? 'true' : 'false';
          if (toggle && toggle.getAttribute('aria-pressed') !== pressed) toggle.setAttribute('aria-pressed', pressed);
        }
        const matchCount = thoughtforgeState.searchMatchNodeIds.length;
        const hasQuery = normalizeSearchText(thoughtforgeState.searchQuery).length > 0;
        const hasMatches = matchCount > 0;
        if (searchInput && searchInput.value !== thoughtforgeState.searchQuery) {
          searchInput.value = thoughtforgeState.searchQuery;
        }
        if (searchStatus) {
          const text = concentrationView && hasQuery
            ? String(matchCount) + (document.documentElement.lang === "ja" ? "件" : " matches") + (thoughtforgeState.temporaryExpandedNodeIds.size ? (document.documentElement.lang === "ja" ? "・一時展開中" : " · temporarily expanded") : "")
            : !hasQuery ? "" : hasMatches
              ? "検索結果 " + (thoughtforgeState.activeSearchMatchIndex + 1) + " / " + matchCount
              : "該当なし";
          if (searchStatus.textContent !== text) searchStatus.textContent = text;
        }
        [searchPreviousButton, searchNextButton].forEach((button) => {
          if (button && button.disabled !== !hasMatches) {
            button.disabled = !hasMatches;
          }
        });
        if (searchClearButton && searchClearButton.disabled !== !hasQuery) {
          searchClearButton.disabled = !hasQuery;
        }
        if (searchScopeElement && searchScopeElement.hidden !== (!thoughtforgeState.focusRootNodeId || !hasQuery)) {
          searchScopeElement.hidden = !thoughtforgeState.focusRootNodeId || !hasQuery;
        }
      }

      function searchResultAncestorPath(nodeId) {
        const map = thoughtforgeState.map;
        const ancestors = getAncestors(map, nodeId).map((ancestor) => shownTitle(ancestor.id) || ancestor.id);
        return ancestors.length > 0 ? ancestors.join(" > ") : "トップレベル";
      }

      function searchResultSourceLine(nodeId) {
        const range = thoughtforgeState.map?.nodesById?.[nodeId]?.source?.range;
        if (!hasSourceRange(range)) {
          return "ソース行を取得できません";
        }
        return "行 " + range.start.line;
      }

      function selectSearchResultNode(nodeId) {
        const nextIndex = thoughtforgeState.searchMatchNodeIds.indexOf(nodeId);
        if (nextIndex !== -1) {
          thoughtforgeState.activeSearchMatchIndex = nextIndex;
        }
        selectThoughtForgeNode(nodeId, { syncSearch: false });
      }

      function renderSearchResultsPanel() {
        if (!searchResultsElement) {
          return;
        }
        clearChildren(searchResultsElement);
        const hasQuery = normalizeSearchText(thoughtforgeState.searchQuery).length > 0;
        const matchIds = thoughtforgeState.searchMatchNodeIds;
        searchResultsElement.hidden = !hasQuery || matchIds.length === 0;
        if (!hasQuery || matchIds.length === 0) {
          return;
        }
        matchIds.forEach((nodeId, index) => {
          const item = document.createElement("li");
          const button = document.createElement("button");
          button.type = "button";
          button.className = "thoughtforge-search-result";
          button.dataset.thoughtforgeSearchResult = nodeId;
          button.dataset.active = index === thoughtforgeState.activeSearchMatchIndex ? "true" : "false";
          button.setAttribute("aria-current", index === thoughtforgeState.activeSearchMatchIndex ? "true" : "false");

          const title = document.createElement("span");
          title.className = "thoughtforge-search-result-title";
          title.textContent = shownTitle(nodeId) || NEW_NODE_PLACEHOLDER;

          const path = document.createElement("span");
          path.className = "thoughtforge-search-result-meta";
          path.textContent = searchResultAncestorPath(nodeId);

          const source = document.createElement("span");
          source.className = "thoughtforge-search-result-meta";
          source.textContent = searchResultSourceLine(nodeId);

          button.append(title, path, source);
          listen(button, "click", () => selectSearchResultNode(nodeId));
          listen(button, "keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectSearchResultNode(nodeId);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSearchResult(1);
              focusActiveSearchResult();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSearchResult(-1);
              focusActiveSearchResult();
            }
          });
          item.appendChild(button);
          searchResultsElement.appendChild(item);
        });
      }

      function focusActiveSearchResult() {
        const nodeId = activeSearchNodeId();
        const button = nodeId
          ? searchResultsElement?.querySelector("[data-thoughtforge-search-result='" + CSS.escape(nodeId) + "']")
          : undefined;
        button?.focus?.();
      }

      function syncNodeNotePanel() {
        const node = selectedNode();
        if (!nodeNotePanel || !nodeNoteEditor || !nodeNoteTitle) {
          return;
        }
        const hasNote = Boolean(String(node?.note ?? "").trim());
        nodeNotePanel.hidden = !node || !hasNote;
        if (!node) {
          nodeNoteEditor.value = "";
          nodeNoteTitle.textContent = "Node note";
          syncSelectedSourcePanel(undefined);
          syncWikiLinkActions(undefined);
          return;
        }
        nodeNoteTitle.textContent = "Node note: " + nodeText(node.id);
        if (nodeNoteEditor.value !== (node.note ?? "")) {
          nodeNoteEditor.value = node.note ?? "";
        }
        syncSelectedSourcePanel(node);
        syncWikiLinkActions(node);
      }

      function updateSyncStatusControls() {
        if (!syncStatusElement) {
          return;
        }
        syncStatusElement.dataset.syncState = thoughtforgeState.syncStatus.state;
        syncStatusElement.textContent = thoughtforgeState.syncStatus.message;
      }

      function diagnosticSeverity(issue) {
        return String(issue?.severity ?? "error");
      }

      function diagnosticCode(issue) {
        return String(issue?.code ?? "parse-error");
      }

      function diagnosticMessage(issue) {
        return String(issue?.message ?? "Unknown parse error");
      }

      function hasSourceRange(range) {
        const valid = (position) =>
          Number.isInteger(position?.line) &&
          position.line >= 1 &&
          Number.isInteger(position?.column) &&
          position.column >= 1;
        return valid(range?.start) && valid(range?.end);
      }

      function sourceRangeLabel(range) {
        if (!hasSourceRange(range)) {
          return "ソース位置なし";
        }
        const start = "L" + range.start.line + ":C" + range.start.column;
        const end = "L" + range.end.line + ":C" + range.end.column;
        return start === end ? start : start + "-" + end;
      }

      function sourceLinePreview(range) {
        if (!hasSourceRange(range)) {
          return "";
        }
        const lines = String(thoughtforgeState.documentText ?? "")
          .replace(/\\r\\n/g, "\\n")
          .replace(/\\r/g, "\\n")
          .split("\\n");
        const line = lines[range.start.line - 1];
        if (line === undefined) {
          return "ソース行を取得できません。";
        }
        const normalized = String(line).trimEnd();
        if (normalized.length === 0) {
          return "(空行)";
        }
        return normalized.length > 180 ? normalized.slice(0, 177) + "..." : normalized;
      }

      function requestSourceRangeReveal(range, nodeId) {
        if (!hasSourceRange(range)) {
          return false;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.source.reveal",
          nodeId: nodeId || "source-range", range });
        return true;
      }

      function syncSelectedSourcePanel(node) {
        if (!sourcePanel || !sourceRangeElement || !sourcePreviewElement) {
          return;
        }
        sourcePanel.hidden = !node;
        const range = node?.source?.range;
        const canReveal = hasSourceRange(range);
        sourceRangeElement.textContent = node ? sourceRangeLabel(range) : "ソース位置なし";
        sourcePreviewElement.textContent = node ? (canReveal ? sourceLinePreview(range) : "ソース位置を取得できません。") : "";
      }

      function updateDiagnosticsPanel() {
        if (!diagnosticsPanel || !diagnosticsList) {
          return;
        }

        clearChildren(diagnosticsList);
        const diagnostics = Array.isArray(thoughtforgeState.diagnostics)
          ? thoughtforgeState.diagnostics
          : [];
        diagnosticsPanel.hidden = diagnostics.length === 0;

        for (const issue of diagnostics) {
          const item = document.createElement("li");
          item.className = "thoughtforge-diagnostic";
          item.dataset.severity = diagnosticSeverity(issue);

          const message = document.createElement("span");
          message.textContent = diagnosticMessage(issue);
          item.appendChild(message);

          const code = document.createElement("span");
          code.className = "thoughtforge-diagnostic-code";
          code.textContent = diagnosticSeverity(issue) + " / " + diagnosticCode(issue);
          item.appendChild(code);

          const range = issue?.range;
          const source = document.createElement("span");
          source.className = "thoughtforge-diagnostic-code";
          source.textContent = sourceRangeLabel(range);
          item.appendChild(source);

          const revealButton = document.createElement("button");
          revealButton.type = "button";
          revealButton.dataset.thoughtforgeDiagnosticRevealSource = "true";
          revealButton.textContent = "Markdownで表示";
          revealButton.title = "診断位置をMarkdownソースで表示";
          revealButton.setAttribute("aria-label", "診断位置をMarkdownソースで表示");
          revealButton.disabled = !hasSourceRange(range);
          listen(revealButton, "click", () => {
            if (requestSourceRangeReveal(range, "diagnostic:" + diagnosticCode(issue)) && copyStatusElement) {
              copyStatusElement.textContent = "診断位置のMarkdown表示を要求しました。";
            }
          });
          item.appendChild(revealButton);

          diagnosticsList.appendChild(item);
        }
      }

      function recordParseDiagnostics(issues) {
        thoughtforgeState.diagnostics = Array.isArray(issues) ? issues : [];
        updateDiagnosticsPanel();
      }

      function clearParseDiagnostics() {
        if (thoughtforgeState.diagnostics.length === 0) {
          return;
        }
        thoughtforgeState.diagnostics = [];
        updateDiagnosticsPanel();
      }

      function recordModelUpdateSyncStatus(documentVersion) {
        const previousVersion = thoughtforgeState.lastDocumentVersion;
        thoughtforgeState.lastDocumentVersion = documentVersion ?? previousVersion;

        if (documentVersion === null || documentVersion === undefined) {
          thoughtforgeState.syncStatus = {
            state: "idle",
            message: ""
          };
          return;
        }

        if (thoughtforgeState.pendingParseRecoveryModelUpdate) {
          thoughtforgeState.pendingParseRecoveryModelUpdate = false;
          return;
        }

        if (previousVersion !== undefined && documentVersion !== previousVersion) {
          thoughtforgeState.syncStatus = {
            state: "external-update",
            message: "ドキュメントを更新しました。version " + documentVersion + " から再読み込みしました。"
          };
          return;
        }

        if (thoughtforgeState.syncStatus.state === "parse-recovery") {
          thoughtforgeState.syncStatus = {
            state: "external-update",
            message: "ドキュメントを復旧し、version " + documentVersion + " から再読み込みしました。"
          };
        }
      }

      function recordParseErrorSyncStatus(issueCount) {
        thoughtforgeState.pendingParseRecoveryModelUpdate = true;
        thoughtforgeState.syncStatus = {
          state: "parse-recovery",
          message:
            "解析エラーを検出しました。" +
            issueCount +
            "件の問題を復旧するまで最後に有効だったマップを表示します。"
        };
        updateSyncStatusControls();
      }

      let renderParentIdIndex;
      let renderNodeIndex;
      let selectionBeforeCapFocus;

      function createRenderParentIdIndex(map) {
        const index = new Map();
        for (const parent of Object.values(map.nodesById)) {
          for (const childId of parent.children ?? []) {
            if (!index.has(childId)) index.set(childId, parent.id);
          }
        }
        return index;
      }

      function createRenderNodeIndex(map) {
        const depths = new Map();
        const visit = (id, depth) => {
          if (depths.has(id) || !map.nodesById[id]) return;
          depths.set(id, depth);
          for (const child of map.nodesById[id].children ?? []) visit(child, depth + 1);
        };
        for (const root of map.roots ?? []) visit(root, 0);
        const selectedId = thoughtforgeState.selectedNodeId;
        const path = new Set();
        for (let id = selectedId; id && !path.has(id); id = parentIdForNode(id)) path.add(id);
        return { depths, path, selectedId, subtree: subtreeNodeIds(selectedId) };
      }

      function parentIdForNode(nodeId) {
        if (renderParentIdIndex) return renderParentIdIndex.get(nodeId);
        const nodesById = thoughtforgeState.map?.nodesById ?? {};
        for (const candidate of Object.values(nodesById)) {
          if (candidate.children?.includes(nodeId)) {
            return candidate.id;
          }
        }
        return undefined;
      }

      function nodeHasChildren(nodeId) {
        if (isMapTitleRootNodeId(nodeId)) {
          return (thoughtforgeState.map?.roots?.length ?? 0) > 0;
        }
        return (thoughtforgeState.map?.nodesById?.[nodeId]?.children?.length ?? 0) > 0;
      }

      function hiddenDescendantCount(nodeId) {
        const map = thoughtforgeState.map;
        if (map && isMapTitleRootNodeId(nodeId)) {
          let count = 0;
          const visitRoot = (candidateId) => {
            const candidate = map.nodesById?.[candidateId];
            if (!candidate) {
              return;
            }
            count += 1;
            for (const childId of candidate.children ?? []) {
              visitRoot(childId);
            }
          };
          for (const rootId of map.roots ?? []) {
            visitRoot(rootId);
          }
          return count;
        }
        const node = map?.nodesById?.[nodeId];
        if (!node) {
          return 0;
        }
        let count = 0;
        const visit = (candidateId) => {
          const candidate = map.nodesById?.[candidateId];
          if (!candidate) {
            return;
          }
          count += 1;
          for (const childId of candidate.children ?? []) {
            visit(childId);
          }
        };
        for (const childId of node.children ?? []) {
          visit(childId);
        }
        return count;
      }

      function isNodeCollapsed(nodeId) {
        return thoughtforgeState.collapsedNodeIds.has(nodeId) && !(concentrationView && thoughtforgeState.temporaryExpandedNodeIds.has(nodeId));
      }

      function isDescendantOf(nodeId, ancestorId) {
        if (isMapTitleRootNodeId(ancestorId)) {
          return Boolean(nodeId && !isMapTitleRootNodeId(nodeId) && thoughtforgeState.map?.nodesById?.[nodeId]);
        }
        if (renderNodeIndex?.selectedId === nodeId) return nodeId !== ancestorId && renderNodeIndex.path.has(ancestorId);
        let currentParentId = parentIdForNode(nodeId);
        while (currentParentId) {
          if (currentParentId === ancestorId) {
            return true;
          }
          currentParentId = parentIdForNode(currentParentId);
        }
        return false;
      }

      function subtreeNodeIds(nodeId) {
        const result = new Set();
        const nodesById = thoughtforgeState.map?.nodesById ?? {};
        const visit = (candidateId) => {
          const node = nodesById[candidateId];
          if (!node || result.has(candidateId)) {
            return;
          }
          result.add(candidateId);
          for (const childId of node.children ?? []) {
            visit(childId);
          }
        };
        visit(nodeId);
        return result;
      }

      function markdownListText(value) {
        const markdownListLeadingPunctuationPattern = new RegExp("^([#>+*\\\\[\\\\]-])", "u");
        return String(value ?? "")
          .replace(/\\r?\\n/g, " ")
          .replace(/\\s+/g, " ")
          .trim()
          .replace(markdownListLeadingPunctuationPattern, "\\\\$1");
      }

      function selectedNodeMarkdown(scope) {
        const map = thoughtforgeState.map;
        const node = selectedCopyTarget();
        if (!map || !node) {
          return "";
        }

        const lines = [];
        const visit = (nodeId, depth) => {
          const current = map.nodesById?.[nodeId];
          if (!current) {
            return;
          }
          lines.push("  ".repeat(depth) + "- " + markdownListText(current.text || current.id));
          if (scope !== "subtree") {
            return;
          }
          for (const childId of current.children ?? []) {
            visit(childId, depth + 1);
          }
        };
        if (isMapTitleRootNodeId(node.id)) {
          lines.push("- " + markdownListText(mapTitleRootText()));
          if (scope === "subtree") {
            for (const rootId of Array.isArray(map.roots) ? map.roots : []) {
              visit(rootId, 1);
            }
          }
        } else {
          visit(node.id, 0);
        }
        return lines.join("\\n");
      }

      function selectedNodeNoteEntries(scope) {
        const map = thoughtforgeState.map;
        const node = selectedCopyTarget();
        if (!map || !node) {
          return [];
        }
        if (isMapTitleRootNodeId(node.id)) {
          return [];
        }

        const entries = [];
        const visit = (nodeId) => {
          const current = map.nodesById?.[nodeId];
          if (!current) {
            return;
          }
          const note = String(current.note ?? "").trim();
          if (note.length > 0) {
            entries.push({
              nodeId: current.id,
              title: markdownListText(current.text || current.id),
              note
            });
          }
          if (scope !== "subtree") {
            return;
          }
          for (const childId of current.children ?? []) {
            visit(childId);
          }
        };
        visit(node.id);
        return entries;
      }

      function selectedNodeNotesMarkdown(scope) {
        const entries = selectedNodeNoteEntries(scope);
        if (entries.length === 0) {
          return "";
        }

        const lines = [];
        for (const entry of entries) {
          if (lines.length > 0) {
            lines.push("");
          }
          lines.push("### " + entry.title);
          lines.push("");
          lines.push(entry.note);
        }
        return lines.join("\\n");
      }

      function selectedNodeContextPath() {
        const node = selectedCopyTarget();
        if (!node || !thoughtforgeState.map) {
          return "";
        }
        if (isMapTitleRootNodeId(node.id)) {
          return markdownListText(mapTitleRootText());
        }

        const path = [];
        let currentNode = node;
        while (currentNode) {
          path.unshift(markdownListText(shownTitle(currentNode.id) || currentNode.id));
          currentNode = thoughtforgeState.map.nodesById?.[parentIdForNode(currentNode.id)] ?? null;
        }
        return path.join(" > ");
      }

      function canRevealSelectedNodeSource() {
        const node = selectedCopyTarget();
        return Boolean(node && hasSourceRange(node.source?.range));
      }

      function hideNodeContextMenu() {
        hostPolicy?.commandContextChanged?.();
        if (!nodeContextMenuElement) {
          return;
        }
        nodeContextMenuElement.hidden = true;
        nodeContextMenuElement.style.left = "";
        nodeContextMenuElement.style.top = "";
        nodeContextMenuElement.style.visibility = "";
        delete nodeContextMenuElement.dataset.nodeId;
        thoughtforgeState.contextMenuNodeId = undefined;
      }

      function positionNodeContextMenu(clientX, clientY) {
        if (!(nodeContextMenuElement instanceof HTMLElement)) {
          return;
        }
        const margin = 8;
        const rect = nodeContextMenuElement.getBoundingClientRect();
        const left = Math.max(
          margin,
          Math.min(clientX, window.innerWidth - rect.width - margin)
        );
        const top = Math.max(
          margin,
          Math.min(clientY, window.innerHeight - rect.height - margin)
        );
        nodeContextMenuElement.style.left = left + "px";
        nodeContextMenuElement.style.top = top + "px";
        nodeContextMenuElement.style.visibility = "";
      }

      function showNodeContextMenu(nodeId, clientX, clientY) {
        hostPolicy?.commandContextChanged?.();
        if (!(nodeContextMenuElement instanceof HTMLElement) || !selectedCopyTarget()) {
          return;
        }
        thoughtforgeState.contextMenuNodeId = nodeId;
        nodeContextMenuElement.dataset.nodeId = nodeId;
        if (nodeContextMenuTitleElement) {
          nodeContextMenuTitleElement.textContent = shownTitle(nodeId) || NEW_NODE_PLACEHOLDER;
        }
        if (nodeContextMenuPathElement) {
          nodeContextMenuPathElement.textContent = selectedNodeContextPath();
        }
        nodeContextMenuElement.setAttribute(
          "aria-label",
          "ノード操作: " + (shownTitle(nodeId) || NEW_NODE_PLACEHOLDER)
        );
        nodeContextMenuActionButtons.forEach((button) => {
          const action = button.dataset.thoughtforgeNodeContextAction;
          button.disabled = concentrationView ? Boolean(localCommandBlocked("map-" + contextCommandIds[action], nodeId)) : action === "reveal-source" && !canRevealSelectedNodeSource();
        });
        nodeContextMenuElement.hidden = false;
        nodeContextMenuElement.style.visibility = "hidden";
        nodeContextMenuElement.style.left = clientX + "px";
        nodeContextMenuElement.style.top = clientY + "px";
        const schedulePosition =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (listener) => setTimeout(listener, 0);
        schedulePosition(() => {
          positionNodeContextMenu(clientX, clientY);
          nodeContextMenuElement.querySelector("button:not(:disabled)")?.focus?.();
        });
      }

      function openNodeContextMenu(event, nodeId, surface) {
        if (isTextEditingTarget(event.target)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        hideNodeContextMenu();
        thoughtforgeState.contextMenuNodeId = nodeId;
        showNodeContextMenu(nodeId, event.clientX, event.clientY);
      }

      function enabledNodeContextMenuButtons() {
        return Array.from(nodeContextMenuActionButtons).filter((button) => !button.disabled);
      }

      function focusNodeContextMenuButton(offset, fallbackIndex = 0) {
        const buttons = enabledNodeContextMenuButtons();
        if (!buttons.length) {
          return;
        }
        const currentIndex = buttons.indexOf(document.activeElement);
        const nextIndex =
          currentIndex === -1
            ? fallbackIndex
            : (currentIndex + offset + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus?.();
      }

      function handleNodeContextMenuKeydown(event) {
        if (!nodeContextMenuElement || nodeContextMenuElement.hidden) {
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          focusNodeContextMenuButton(1);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          focusNodeContextMenuButton(-1, enabledNodeContextMenuButtons().length - 1);
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          focusNodeContextMenuButton(0, 0);
          return;
        }
        if (event.key === "End") {
          event.preventDefault();
          focusNodeContextMenuButton(0, enabledNodeContextMenuButtons().length - 1);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          hideNodeContextMenu();
        }
      }

      function runNodeContextMenuAction(action) {
        if (concentrationView && contextCommandIds[action]) {
          const result=dispatchMapCommand('map-'+contextCommandIds[action],false,{nodeId:thoughtforgeState.contextMenuNodeId});
          if(result.status==='admitted')hideNodeContextMenu();
          return;
        }
        if (!action || !selectedCopyTarget()) {
          hideNodeContextMenu();
          return;
        }
        if (action === "copy-subtree") {
          postClipboardWrite("subtree");
          hideNodeContextMenu();
          return;
        }
        if (action === "copy-prompt") {
          postClipboardAiContextPackWrite("subtree", "codex-worker", "full");
          hideNodeContextMenu();
          return;
        }
        if (action === "copy-ai-chat") {
          postClipboardAiContextPackWrite("subtree", "chatgpt-claude", "compact");
          hideNodeContextMenu();
          return;
        }
        if (action === "copy-ai-issue") {
          postClipboardAiContextPackWrite("subtree", "github-issue-fragment", "checklist-only");
          hideNodeContextMenu();
          return;
        }
        if (action === "copy-issue") {
          postClipboardIssueDraftWrite("subtree");
          hideNodeContextMenu();
          return;
        }
        if (action === "copy-design") {
          postClipboardDesignDocWrite("subtree");
          hideNodeContextMenu();
          return;
        }
        if (action === "copy-test-matrix") {
          postClipboardTestMatrixWrite("subtree");
          hideNodeContextMenu();
          return;
        }
        if (action === "reveal-source") {
          requestSelectedNodeRevealInSource();
          hideNodeContextMenu();
        }
      }

      function selectedNodeContextMarkdown(scope) {
        const node = selectedCopyTarget();
        const selectedText = selectedNodeMarkdown(scope);
        const contextPath = selectedNodeContextPath() || "Unknown";
        const warnings = [];
        const status = thoughtforgeState.syncStatus;
        if (status.state === "parse-recovery") {
          warnings.push("- Parse warning: " + status.message);
        }
        if (status.state === "external-update") {
          warnings.push("- Sync warning: " + status.message);
        }

        if (!node) {
          return selectedText;
        }

        const lines = [
          "# ThoughtForge Agent Context",
          "",
          "## Context",
          "- Document: " + thoughtforgeDocumentUri,
          "- Scope: " + (scope === "subtree" ? "subtree" : "node"),
          "- Target node: " + markdownListText(node.text || node.id) + " (" + node.id + ")",
          "- Context path: " + contextPath,
          "",
          "## Target markdown"
        ];
        if (warnings.length > 0) {
          lines.push("");
          lines.push("## 警告");
          lines.push(...warnings);
        }
        lines.push("");
        const markdownFence = String.fromCharCode(96, 96, 96);
        lines.push(markdownFence + "markdown");
        lines.push(selectedText);
        lines.push(markdownFence);
        lines.push("");
        lines.push("## Scope");
        lines.push("- Editable: only the Target markdown block.");
        lines.push("- Not in scope: siblings and ancestor subtrees not listed above.");
        lines.push("");
        lines.push("## Confirm before applying");
        lines.push(
          "- Validate the context/path and edit only listed scope in ThoughtForge or Claude Code workflows."
        );
        return lines.join("\\n");
      }

      function issueDraftRequiredSectionSpecs() {
        return [
          { label: "変更対象", pattern: /変更対象|change targets?/i, hint: "変更する file/module/surface を列挙する" },
          { label: "変更禁止/触らない範囲", pattern: /変更禁止|触らない|do not touch|forbidden/i, hint: "触らない file/module/scope を列挙する" },
          { label: "テスト方針", pattern: /テスト方針|test plan|verification/i, hint: "追加/更新する test と手動確認を列挙する" },
          { label: "リスクと戻し方", pattern: /リスク|戻し方|rollback/i, hint: "主なリスクと revert/disable 方法を書く" }
        ];
      }

      function issueDraftMissingSectionWarnings(markdown) {
        return issueDraftRequiredSectionSpecs()
          .filter((section) => !section.pattern.test(markdown))
          .map((section) => "- Missing required section: " + section.label + "（TBD を残して人間が確認）");
      }

      function issueDraftSectionPlaceholder(markdown, label) {
        const section = issueDraftRequiredSectionSpecs().find((candidate) => candidate.label === label);
        if (section?.pattern.test(markdown)) {
          return "- 選択Markdown内の「" + label + "」に該当する記述を転記・整理してください。";
        }
        return "- TBD: " + (section?.hint ?? "人間が確認して追記する");
      }

      function selectedNodeIssueDraftMarkdown(scope) {
        const node = selectedCopyTarget();
        const selectedText = redactAiContextText(selectedNodeMarkdown(scope));
        const contextPath = selectedNodeContextPath() || "Unknown";
        const warnings = [];
        const status = thoughtforgeState.syncStatus;
        if (status.state === "parse-recovery") {
          warnings.push("- Parse warning: " + status.message);
        }
        if (status.state === "external-update") {
          warnings.push("- Sync warning: " + status.message);
        }

        if (!node) {
          return "";
        }

        const scopeLabel = scope === "subtree" ? "サブツリー" : "ノード";
        const sourceReference = selectedNodeSourceReference(node);
        const safeNodeTitle = redactAiContextText(markdownListText(node.text || node.id));
        const markdownFence = String.fromCharCode(96, 96, 96);
        warnings.push(...issueDraftMissingSectionWarnings(selectedText));
        const lines = [
          "# GitHub Issue 下書き",
          "",
          "## タイトル",
          "Issue下書き（" + scopeLabel + "）: " + safeNodeTitle,
          "",
          "## 本文",
          "親Issue: #TBD",
          "関連: #TBD",
          "",
          "## 目的",
          "",
          "- TBD: " + safeNodeTitle + " の目的を1-3行で記述する。",
          "",
          "## 設計メモ",
          "",
          "### 目的",
          "",
          "- TBD: この Issue で達成することを明確にする。",
          "",
          "### 現状",
          "",
          "- Source path: " + sourceReference.sourcePath,
          "- Source line: " + sourceReference.sourceLine,
          "- Selected node: " + sourceReference.selectedNode,
          "- Selected node path: " + sourceReference.selectedNodePath,
          "- Context path: " + contextPath,
          "",
          "### 変更方針",
          "",
          "- TBD: 選択Markdownを実装可能な手順へ分解する。",
          "",
          "### 公開契約への影響",
          "",
          "- TBD: 影響なし / 影響あり（対象 contract と review 要否）を明記する。",
          "",
          "### 変更対象",
          "",
          issueDraftSectionPlaceholder(selectedText, "変更対象"),
          "",
          "### 変更禁止/触らない範囲",
          "",
          issueDraftSectionPlaceholder(selectedText, "変更禁止/触らない範囲"),
          "",
          "### テスト方針",
          "",
          issueDraftSectionPlaceholder(selectedText, "テスト方針"),
          "",
          "### スコープ外",
          "",
          "- GitHub Issue の自動作成。",
          "- 親Issue本文の自動編集。",
          "- 選択Markdown外の作業。",
          "",
          "### リスクと戻し方",
          "",
          issueDraftSectionPlaceholder(selectedText, "リスクと戻し方"),
          "",
          "### 実装中の設計更新",
          "",
          "- 実装中に設計判断を変えた場合はここへ追記する。",
          "",
          "## WBS",
          "",
          "- [ ] TBD: 実装単位に分解する",
          "- [ ] TBD: contract / regression test を追加する",
          "- [ ] TBD: local verification を記録する",
          "",
          "## 受け入れ条件",
          "",
          "- [ ] 変更対象 / 変更禁止 / テスト方針が埋まっている",
          "- [ ] direct GitHub write ではなく draft として確認済み",
          "- [ ] ./scripts/verify.sh が PASS する",
          "",
          "## PR要件",
          "",
          markdownFence + "md",
          "Closes #<this-issue>",
          "Part of #<parent-issue>",
          markdownFence
        ];
        if (warnings.length > 0) {
          lines.push("");
          lines.push("## 警告");
          lines.push(...warnings);
        }
        lines.push("");
        lines.push("## 対象Markdown");
        lines.push("");
        lines.push(markdownFence + "markdown");
        lines.push(selectedText);
        lines.push(markdownFence);
        lines.push("");
        lines.push("## チェックリスト");
        lines.push("- [ ] スコープと前提を確認する");
        lines.push("- [ ] 対象ブロック内だけを変更する");
        lines.push("- [ ] ラベルと受け入れ条件を追加する");
        lines.push("- [ ] 最終版の Issue 本文を作成して保存する");
        lines.push("");
        lines.push("## メモ");
        lines.push("- これは下書きです。Issue を作成する前に、タイトル・本文・ラベルを更新してください。");
        return lines.join("\\n");
      }

      function selectedNodeDesignDocMarkdown(scope) {
        const node = selectedCopyTarget();
        const selectedText = selectedNodeMarkdown(scope);
        const contextPath = selectedNodeContextPath() || "Unknown";
        const warnings = [];
        const status = thoughtforgeState.syncStatus;
        if (status.state === "parse-recovery") {
          warnings.push("- Parse warning: " + status.message);
        }
        if (status.state === "external-update") {
          warnings.push("- Sync warning: " + status.message);
        }

        if (!node) {
          return "";
        }

        const scopeLabel = scope === "subtree" ? "subtree" : "node";
        const markdownFence = String.fromCharCode(96, 96, 96);
        const lines = [
          "# Design Document",
          "",
          "## Purpose",
          "- Describe the change for " + markdownListText(node.text || node.id) + ".",
          "",
          "## Background",
          "- Document: " + thoughtforgeDocumentUri,
          "- Scope: " + scopeLabel,
          "- Target node: " + markdownListText(node.text || node.id) + " (" + node.id + ")",
          "- Context path: " + contextPath,
          "",
          "## Current State",
          "- Summarize the current behavior and constraints.",
          "",
          "## Proposed Changes",
          "- List the intended implementation approach.",
          "",
          "## Impact",
          "- Public contracts:",
          "- Files/modules:",
          "- User-facing behavior:",
          "",
          "## Test Plan",
          "- Unit/contract tests:",
          "- Manual or dogfood checks:",
          "",
          "## Open Questions",
          "- [ ] Confirm assumptions before implementation.",
          "",
          "## Source Markdown"
        ];
        if (warnings.length > 0) {
          lines.push("");
          lines.push("## Warnings");
          lines.push(...warnings);
        }
        lines.push("");
        lines.push(markdownFence + "markdown");
        lines.push(selectedText);
        lines.push(markdownFence);
        return lines.join("\\n");
      }

      function selectedNodeTestMatrixMarkdown(scope) {
        const node = selectedCopyTarget();
        const selectedText = selectedNodeMarkdown(scope);
        const contextPath = selectedNodeContextPath() || "Unknown";
        const warnings = [];
        const status = thoughtforgeState.syncStatus;
        if (status.state === "parse-recovery") {
          warnings.push("- Parse warning: " + status.message);
        }
        if (status.state === "external-update") {
          warnings.push("- Sync warning: " + status.message);
        }

        if (!node) {
          return "";
        }

        const scopeLabel = scope === "subtree" ? "subtree" : "node";
        const markdownFence = String.fromCharCode(96, 96, 96);
        const lines = [
          "# Test Matrix",
          "",
          "## Context",
          "- Document: " + thoughtforgeDocumentUri,
          "- Scope: " + scopeLabel,
          "- Target node: " + markdownListText(node.text || node.id) + " (" + node.id + ")",
          "- Context path: " + contextPath,
          "",
          "## Matrix",
          "| Area | Scenario | Input / Setup | Expected Result | Verification |",
          "|---|---|---|---|---|",
          "| " + markdownListText(node.text || node.id) + " | Main behavior | Target markdown below | Behavior matches intent | Add focused contract test |",
          "| Regression | Existing behavior | Related copy/export actions | No existing output changes unexpectedly | Run package contracts |",
          "| Japanese text | 日本語入力/出力 | Japanese node labels and body text | Text is preserved without corruption | Include Japanese fixture/assertion |",
          "",
          "## Source Markdown"
        ];
        if (warnings.length > 0) {
          lines.push("");
          lines.push("## Warnings");
          lines.push(...warnings);
        }
        lines.push("");
        lines.push(markdownFence + "markdown");
        lines.push(selectedText);
        lines.push(markdownFence);
        return lines.join("\\n");
      }

      function sourcePathLabel() {
        try {
          const url = new URL(thoughtforgeDocumentUri);
          if (url.protocol === "file:") {
            return decodeURIComponent(url.pathname);
          }
        } catch {
        }
        return String(thoughtforgeDocumentUri ?? "");
      }

      function selectedNodeSourceRange(node) {
        if (!node) {
          return undefined;
        }
        if (isMapTitleRootNodeId(node.id)) {
          return thoughtforgeState.map?.source?.range;
        }
        return node.source?.range;
      }

      function selectedNodeSourceReference(node) {
        const range = selectedNodeSourceRange(node);
        return {
          document: thoughtforgeDocumentUri,
          sourcePath: sourcePathLabel(),
          sourceLine: hasSourceRange(range) ? "L" + range.start.line : "unknown",
          sourceRange: sourceRangeLabel(range),
          selectedNode: redactAiContextText(markdownListText(node?.text || node?.id || "Unknown")) + " (" + (node?.id || "unknown") + ")",
          selectedNodePath: selectedNodeContextPath() || "Unknown"
        };
      }

      function normalizeAiContextTargetPreset(preset) {
        if (preset === "chatgpt-claude" || preset === "github-issue-fragment") {
          return preset;
        }
        return "codex-worker";
      }

      function normalizeAiContextBudgetMode(mode) {
        if (mode === "compact" || mode === "checklist-only") {
          return mode;
        }
        return "full";
      }

      function aiContextTargetPresetDetails(preset) {
        if (preset === "chatgpt-claude") {
          return {
            label: "ChatGPT / Claude 向けプロンプト",
            goal: "選択した ThoughtForge サブツリーを、設計・実装・レビュー計画の文脈として使う。",
            instructions: [
              "- このパックは下書き・提案として扱い、スコープを広げる前に確認する。",
              "- 修正提案では選択元の source reference を保持する。",
              "- 次に行う具体的な編集、テスト、未解決の質問を返す。"
            ],
            checklist: [
              "- [ ] 回答が選択サブツリーの範囲内に収まっている。",
              "- [ ] 前提と不足情報が明示されている。",
              "- [ ] 提案する編集に検証手順が含まれている。"
            ]
          };
        }
        if (preset === "github-issue-fragment") {
          return {
            label: "GitHub Issue 下書き断片",
            goal: "選択した ThoughtForge サブツリーを、人間が確認する Issue 本文断片へ変換する。",
            instructions: [
              "- これは断片として扱い、GitHub を直接作成・更新しない。",
              "- スコープ、受け入れ条件、テスト、戻し方を含める。",
              "- レビュー担当が追跡できるよう source reference を保持する。"
            ],
            checklist: [
              "- [ ] タイトルと要約は人間レビュー前提になっている。",
              "- [ ] labels / assignee / milestone を推測していない。",
              "- [ ] 外部 write を行わない下書きであることが明記されている。"
            ]
          };
        }
        return {
          label: "Codex worker 向けプロンプト",
          goal: "Codex worker が小さな Issue scope で実装できる文脈を準備する。",
          instructions: [
            "- 編集前に source reference と選択 Markdown を読む。",
            "- 変更対象と触らない範囲の内側だけを変更する。",
            "- focused test を追加し、検証コマンドを報告する。"
          ],
          checklist: [
            "- [ ] 編集前に scope と source reference を確認している。",
            "- [ ] 公開契約への影響が記載されている。",
            "- [ ] local verification evidence が記録されている。"
          ]
        };
      }

      function redactAiContextText(value) {
        return String(value ?? "")
          .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
          .replace(/\\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\\b/g, "[REDACTED_GITHUB_TOKEN]")
          .replace(/\\bsk-[A-Za-z0-9_-]{20,}\\b/g, "[REDACTED_SECRET_KEY]")
          .replace(/\\b((?:api[_-]?key|token|password|secret))\\b\\s*[:=]\\s*("[^"]+"|'[^']+'|[^\\s,;]+)/gi, "$1=[REDACTED_SECRET]")
          .replace(/(^|\\n).*thoughtforge\\.debug\\.trace.*(?=\\n|$)/gi, "$1[REDACTED_DEBUG_TRACE]")
          .replace(/window\\.__thoughtforge[A-Za-z0-9_]*(?:\\s*=\\s*)?[^\\n]*/g, "window.__thoughtforgeDebugTrace=[REDACTED_DEBUG_TRACE]");
      }

      function selectedNodeAiContextPackMarkdown(scope, targetPreset, budgetMode) {
        const node = selectedCopyTarget();
        if (!node) {
          return "";
        }

        const preset = normalizeAiContextTargetPreset(targetPreset);
        const mode = normalizeAiContextBudgetMode(budgetMode);
        const details = aiContextTargetPresetDetails(preset);
        const selectedText = redactAiContextText(selectedNodeMarkdown(scope));
        const notesText = mode === "full" ? redactAiContextText(selectedNodeNotesMarkdown(scope)) : "";
        const contextPath = selectedNodeContextPath() || "Unknown";
        const sourceReference = selectedNodeSourceReference(node);
        const warnings = [];
        const status = thoughtforgeState.syncStatus;
        if (status.state === "parse-recovery") {
          warnings.push("- Parse warning: " + status.message);
        }
        if (status.state === "external-update") {
          warnings.push("- Sync warning: " + status.message);
        }

        const scopeLabel = scope === "subtree" ? "サブツリー" : "ノード";
        const markdownFence = String.fromCharCode(96, 96, 96);
        const lines = [
          "# ThoughtForge AI コンテキストパック",
          "",
          "## 対象",
          "- Preset: " + details.label,
          "- Budget mode: " + mode,
          "- 外部書き込み: なし。クリップボード用の下書きのみ。",
          "",
          "## 参照元",
          "- Document: " + sourceReference.document,
          "- Source path: " + sourceReference.sourcePath,
          "- Source line: " + sourceReference.sourceLine,
          "- Source range: " + sourceReference.sourceRange,
          "- Selected node: " + sourceReference.selectedNode,
          "- Selected node path: " + sourceReference.selectedNodePath,
          "- Scope: " + scopeLabel,
          "",
          "## 構成",
          "- 背景",
          "- 目的",
          "- 現状",
          "- 変更対象",
          "- 変更禁止/触らない範囲",
          "- 制約",
          "- テスト観点",
          "- 未解決の質問"
        ];
        if (warnings.length > 0) {
          lines.push("");
          lines.push("## 警告");
          lines.push(...warnings);
        }
        lines.push("");
        lines.push("## 背景");
        lines.push("- " + details.goal);
        lines.push("- Context path: " + contextPath);
        lines.push("- 秘密情報の redaction: 適用済み。");
        lines.push("");
        lines.push("## 目的");
        lines.push("- 選択した ThoughtForge " + scopeLabel + " を AI が扱える作業文脈へ変換する。");
        lines.push("");
        lines.push("## 現状");
        lines.push("- 正本は上記の .map.md document のまま。");
        lines.push("- このパックは派生文脈であり、選択範囲外の編集指示ではない。");
        lines.push("");
        lines.push("## 変更対象");
        lines.push("- 選択した " + scopeLabel + " の Markdown と、そこに直接書かれた子作業のみ。");
        lines.push("");
        lines.push("## 変更禁止/触らない範囲");
        lines.push("- 選択 Markdown に含まれない sibling / ancestor / external systems。");
        lines.push("- GitHub、Obsidian、AI API への直接 write。必要ならレビュー用下書きを作る。");
        lines.push("");
        lines.push("## 制約");
        lines.push("- 生成結果はレビューされるまで下書き・提案として扱う。");
        lines.push("- 後続作業でも source reference を保持する。");
        lines.push("- raw debug trace、private key、access token を含めない。");
        lines.push("");
        lines.push("## テスト観点");
        lines.push("- この context pack の contract/schema stability。");
        lines.push("- secret-like text の redaction coverage。");
        lines.push("- selection variants: selected node / subtree / map root / empty selection。");
        lines.push("");
        lines.push("## 未解決の質問");
        lines.push("- [ ] 選択 scope が十分か確認する。");
        lines.push("- [ ] 実装前に公開契約変更の有無を確認する。");
        lines.push("");
        lines.push("## 依頼内容");
        lines.push(...details.instructions);
        lines.push("");
        lines.push("## 完了チェックリスト");
        lines.push(...details.checklist);

        if (mode === "checklist-only") {
          lines.push("");
          lines.push("## チェックリストのみの文脈");
          lines.push("- budget mode により Source Markdown は省略。");
          lines.push("- 具体的な編集前に上記 source reference を確認する。");
          return lines.join("\\n");
        }

        lines.push("");
        lines.push("## 対象Markdown");
        lines.push(markdownFence + "markdown");
        lines.push(selectedText);
        lines.push(markdownFence);

        if (mode === "full" && notesText) {
          lines.push("");
          lines.push("## ノート");
          lines.push(notesText);
        }

        if (mode === "compact") {
          lines.push("");
          lines.push("## compact mode の注意");
          lines.push("- ノートは省略。詳細が必要な場合は source reference を確認する。");
        }

        return lines.join("\\n");
      }

      function selectedPromptTemplatePreset() {
        const value = promptTemplateSelect?.value;
        if (value === "prompt-pack") {
          return value;
        }
        if (value === "review" || value === "test-plan") {
          return value;
        }
        if (!promptTemplateSelect) {
          return "prompt-pack";
        }
        return "implementation";
      }

      function selectedPromptPackIncludeNotes() {
        return promptPackIncludeNotesCheckbox?.checked !== false;
      }

      function promptTemplatePresetDetails(preset) {
        if (preset === "review") {
          return {
            title: "レビュープロンプト",
            goal: "選択した ThoughtForge Markdown をレビューし、正しさ・スコープ・回帰リスクを洗い出す。",
            instructions: [
              "- 具体的なバグ、テスト不足、contract drift、不明確な受け入れ条件を優先する。",
              "- 各指摘では対象 Markdown を参照する。",
              "- blocker と follow-up 提案を分ける。"
            ],
            checklist: [
              "- [ ] 指摘は重要度順に並んでいる。",
              "- [ ] 各指摘に修正案または判断事項がある。",
              "- [ ] non-blocking follow-up が明示されている。"
            ]
          };
        }
        if (preset === "test-plan") {
          return {
            title: "テスト計画プロンプト",
            goal: "選択した ThoughtForge Markdown を focused verification coverage に変換する。",
            instructions: [
              "- coverage が必要な user-visible behavior と public contract を抽出する。",
              "- real risk を下げる場合だけ unit / contract / integration check を提案する。",
              "- 必要に応じて日本語テキスト、edge case、rollback verification を含める。"
            ],
            checklist: [
              "- [ ] test scope が選択 node / subtree に対応している。",
              "- [ ] 再利用できる既存 regression test が特定されている。",
              "- [ ] automation が現実的でない場合だけ manual check が列挙されている。"
            ]
          };
        }
        return {
          title: "実装プロンプト",
          goal: "選択した ThoughtForge Markdown を小さな Issue scope の変更として実装する。",
          instructions: [
            "- 対象 Markdown を読み、記載された scope を守る。",
            "- 既存の project pattern を優先し、contract change は明示する。",
            "- scope を広げる前に focused test を更新し、blocker を記録する。"
          ],
          checklist: [
            "- [ ] scope が選択 node / subtree と一致している。",
            "- [ ] public contract impact が記載されている。",
            "- [ ] verification command が記録されている。"
          ]
        };
      }

      function selectedNodePromptTemplateMarkdown(scope, preset) {
        const node = selectedCopyTarget();
        const selectedText = selectedNodeMarkdown(scope);
        const contextPath = selectedNodeContextPath() || "Unknown";
        const warnings = [];
        const status = thoughtforgeState.syncStatus;
        if (status.state === "parse-recovery") {
          warnings.push("- Parse warning: " + status.message);
        }
        if (status.state === "external-update") {
          warnings.push("- Sync warning: " + status.message);
        }

        if (!node) {
          return "";
        }

        const scopeLabel = scope === "subtree" ? "サブツリー" : "ノード";
        const details = promptTemplatePresetDetails(preset);
        const markdownFence = String.fromCharCode(96, 96, 96);
        const lines = [
          "# " + details.title,
          "",
          "## 目的",
          details.goal,
          "",
          "## 文脈",
          "- Document: " + thoughtforgeDocumentUri,
          "- Scope: " + scopeLabel,
          "- Target node: " + markdownListText(node.text || node.id) + " (" + node.id + ")",
          "- Context path: " + contextPath,
          "",
          "## 依頼内容",
          ...details.instructions,
          "",
          "## チェックリスト",
          ...details.checklist,
          "",
          "## 対象Markdown"
        ];
        if (warnings.length > 0) {
          lines.push("");
          lines.push("## 警告");
          lines.push(...warnings);
        }
        lines.push("");
        lines.push(markdownFence + "markdown");
        lines.push(selectedText);
        lines.push(markdownFence);
        return lines.join("\\n");
      }

      function selectedNodePromptPackMarkdown(scope, includeNotes) {
        const node = selectedCopyTarget();
        const selectedText = selectedNodeMarkdown(scope);
        const notesText = includeNotes ? selectedNodeNotesMarkdown(scope) : "";
        const contextPath = selectedNodeContextPath() || "Unknown";
        const warnings = [];
        const status = thoughtforgeState.syncStatus;
        if (status.state === "parse-recovery") {
          warnings.push("- Parse warning: " + status.message);
        }
        if (status.state === "external-update") {
          warnings.push("- Sync warning: " + status.message);
        }

        if (!node) {
          return "";
        }

        const scopeLabel = scope === "subtree" ? "サブツリー" : "ノード";
        const lines = [
          "# プロンプトパック",
          "",
          "## 選択トピック",
          markdownListText(node.text || node.id),
          "",
          "## メタデータ",
          "- Document: " + thoughtforgeDocumentUri,
          "- Scope: " + scopeLabel,
          "- Target node: " + markdownListText(node.text || node.id) + " (" + node.id + ")",
          "- Context path: " + contextPath,
          "- ノート: " + (includeNotes ? "含める" : "含めない"),
          "",
          "## アウトライン",
          "",
          selectedText
        ];
        if (includeNotes && notesText) {
          lines.push("");
          lines.push("## ノート");
          lines.push("");
          lines.push(notesText);
        }
        if (warnings.length > 0) {
          lines.push("");
          lines.push("## 警告");
          lines.push(...warnings);
        }
        lines.push("");
        lines.push("## 依頼内容");
        lines.push("");
        lines.push("この内容をもとに、設計リスク、実装タスク、テスト観点を整理してください。");
        return lines.join("\\n");
      }

      function escapeSvgText(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function visibleMapSvgText() {
        const map = thoughtforgeState.map;
        if (!map) {
          return "";
        }

        const rows = [];
        const rowByNodeId = new Map();
        const visit = (nodeId, depth) => {
          const node = map.nodesById[nodeId];
          if (!node) {
            return;
          }
          rowByNodeId.set(nodeId, rows.length);
          rows.push({ node, depth });
          if (isNodeCollapsed(nodeId)) {
            return;
          }
          for (const childId of node.children ?? []) {
            visit(childId, depth + 1);
          }
        };

        for (const rootId of Array.isArray(map.roots) ? map.roots : []) {
          visit(rootId, 0);
        }
        if (rows.length === 0) {
          return "";
        }

        const nodeWidth = 210;
        const nodeHeight = 46;
        const horizontalGap = 52;
        const rowGap = 22;
        const margin = 18;
        const topMargin = 50;
        const maxDepth = rows.reduce((current, row) => Math.max(current, row.depth), 0);
        const width = margin * 2 + (maxDepth + 1) * nodeWidth + maxDepth * horizontalGap;
        const height = topMargin + margin + rows.length * nodeHeight + Math.max(0, rows.length - 1) * rowGap;
        const nodeCenterY = (rowIndex) => topMargin + rowIndex * (nodeHeight + rowGap) + nodeHeight / 2;
        const nodeX = (depth) => margin + depth * (nodeWidth + horizontalGap);
        const svg = [
          '<svg xmlns="http://www.w3.org/2000/svg" class="thoughtforge-export-svg" viewBox="0 0 ' +
            width +
            " " +
            height +
            '" role="img" aria-label="ThoughtForge map export">',
          "<style>",
          ".thoughtforge-export-svg{font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;background:#ffffff;color:#24292f}",
          ".thoughtforge-export-title{font-size:18px;font-weight:700;fill:#24292f}",
          ".thoughtforge-export-node{fill:#f6f8fa;stroke:#d0d7de;stroke-width:1.2}",
          ".thoughtforge-export-node-selected{fill:#eef5ff;stroke:#0969da;stroke-width:2}",
          ".thoughtforge-export-label{font-size:13px;fill:#24292f}",
          ".thoughtforge-export-connector{stroke:#d0d7de;stroke-width:1.4;fill:none}",
          "</style>",
          '<rect width="100%" height="100%" fill="#ffffff"/>',
          '<text class="thoughtforge-export-title" x="' +
            margin +
            '" y="24">' +
            escapeSvgText(map.title || "Untitled map") +
            "</text>"
        ];

        for (const { node, depth } of rows) {
          const parentId = parentIdForNode(node.id);
          const parentRow = parentId ? rowByNodeId.get(parentId) : undefined;
          if (parentRow !== undefined) {
            const x1 = nodeX(depth - 1) + nodeWidth;
            const y1 = nodeCenterY(parentRow);
            const x2 = nodeX(depth);
            const y2 = nodeCenterY(rowByNodeId.get(node.id));
            svg.push(
              '<path class="thoughtforge-export-connector" d="M ' +
                x1 +
                " " +
                y1 +
                " C " +
                (x1 + horizontalGap / 2) +
                " " +
                y1 +
                ", " +
                (x2 - horizontalGap / 2) +
                " " +
                y2 +
                ", " +
                x2 +
                " " +
                y2 +
                '"/>'
            );
          }
        }

        for (const { node, depth } of rows) {
          const rowIndex = rowByNodeId.get(node.id);
          const x = nodeX(depth);
          const y = topMargin + rowIndex * (nodeHeight + rowGap);
          const selectedClass =
            node.id === thoughtforgeState.selectedNodeId
              ? " thoughtforge-export-node-selected"
              : "";
          const label = escapeSvgText(node.text || node.id);
          svg.push(
            '<g data-thoughtforge-node-id="' + escapeSvgText(node.id) + '">',
            '<rect class="thoughtforge-export-node' +
              selectedClass +
              '" x="' +
              x +
              '" y="' +
              y +
              '" width="' +
              nodeWidth +
              '" height="' +
              nodeHeight +
              '" rx="8"/>',
            '<text class="thoughtforge-export-label" x="' +
              (x + 12) +
              '" y="' +
              (y + 28) +
              '">' +
              label +
              "</text>",
            "</g>"
          );
        }

        svg.push("</svg>");
        return svg.join("\\n");
      }

      function postClipboardWrite(scope) {
        const node = selectedCopyTarget();
        const markdown = selectedNodeMarkdown(scope);
        if (!node || !markdown) {
          return;
        }
        const clipboardRequestId = stageCopiedSubtree(node, markdown, scope);
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: markdown,
          format: "markdown",
          scope,
          nodeId: node.id
        }, clipboardRequestId);
        if (copyStatusElement) {
          copyStatusElement.textContent =
            scope === "subtree" ? "サブツリーMarkdownのコピーを要求しました。" : "ノードMarkdownのコピーを要求しました。";
        }
      }

      const x = (v) => new Option(String(v ?? "")).innerHTML.replaceAll('"', "&quot;");
      function o(id, deep, depth) { const n = thoughtforgeState.map?.nodesById?.[id]; if (!n) return []; const i = "  ".repeat(depth); return [i + '<outline text="' + x(n.text) + '">', ...(deep ? (n.children ?? []).flatMap((c) => o(c, true, depth + 1)) : []), i + "</outline>"]; }
      function postClipboardOpmlWrite(scope) { const m = thoughtforgeState.map, n = selectedCopyTarget(); if (!m || !n) return; const outlines = isMapTitleRootNodeId(n.id) ? scope === "subtree" ? (m.roots ?? []).flatMap((id) => o(id, true, 2)) : ['    <outline text="' + x(mapTitleRootText()) + '"></outline>'] : o(n.id, scope === "subtree", 2); const markdown = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', '  <head>', '    <title>' + x(mapTitleRootText()) + '</title>', '  </head>', '  <body>', ...outlines, "  </body>", "</opml>"].join("\\n"); postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: markdown, format: "opml", scope, nodeId: n.id }); if (copyStatusElement) copyStatusElement.textContent = "OPML copy requested."; }

      function postClipboardContextWrite(scope) {
        const node = selectedCopyTarget();
        const context = selectedNodeContextMarkdown(scope);
        if (!node || !context) {
          return;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: context,
          format: "markdown",
          scope,
          nodeId: node.id
        });
        if (copyStatusElement) {
          copyStatusElement.textContent =
            scope === "subtree"
              ? "サブツリー文脈のコピーを要求しました。"
              : "ノード文脈のコピーを要求しました。";
        }
      }

      function postClipboardIssueDraftWrite(scope) {
        const node = selectedCopyTarget();
        const issueDraft = selectedNodeIssueDraftMarkdown(scope);
        if (!node || !issueDraft) {
          return;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: issueDraft,
          format: "markdown",
          scope,
          nodeId: node.id
        });
        if (copyStatusElement) {
          copyStatusElement.textContent =
            scope === "subtree"
              ? "サブツリーIssue下書きのコピーを要求しました。"
              : "ノードIssue下書きのコピーを要求しました。";
        }
      }

      function postClipboardDesignDocWrite(scope) {
        const node = selectedCopyTarget();
        const designDoc = selectedNodeDesignDocMarkdown(scope);
        if (!node || !designDoc) {
          return;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: designDoc,
          format: "markdown",
          scope,
          nodeId: node.id
        });
        if (copyStatusElement) {
          copyStatusElement.textContent =
            scope === "subtree"
              ? "サブツリー設計メモのコピーを要求しました。"
              : "ノード設計メモのコピーを要求しました。";
        }
      }

      function postClipboardTestMatrixWrite(scope) {
        const node = selectedCopyTarget();
        const testMatrix = selectedNodeTestMatrixMarkdown(scope);
        if (!node || !testMatrix) {
          return;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: testMatrix,
          format: "markdown",
          scope,
          nodeId: node.id
        });
        if (copyStatusElement) {
          copyStatusElement.textContent =
            scope === "subtree"
              ? "サブツリーテスト観点のコピーを要求しました。"
              : "ノードテスト観点のコピーを要求しました。";
        }
      }

      function postClipboardAiContextPackWrite(scope, targetPreset, budgetMode) {
        const node = selectedCopyTarget();
        const contextPack = selectedNodeAiContextPackMarkdown(scope, targetPreset, budgetMode);
        if (!node || !contextPack) {
          return;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: contextPack,
          format: "markdown",
          scope,
          nodeId: node.id
        });
        if (copyStatusElement) {
          copyStatusElement.textContent =
            scope === "subtree"
              ? "サブツリーAI Context Packのコピーを要求しました。"
              : "ノードAI Context Packのコピーを要求しました。";
        }
      }

      function postClipboardPromptTemplateWrite(scope) {
        const node = selectedCopyTarget();
        const preset = selectedPromptTemplatePreset();
        const text =
          preset === "prompt-pack"
            ? selectedNodePromptPackMarkdown(scope, selectedPromptPackIncludeNotes())
            : selectedNodePromptTemplateMarkdown(scope, preset);
        if (!node || !text) {
          return;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text,
          format: "markdown",
          scope,
          nodeId: node.id
        });
        if (copyStatusElement) {
          if (preset === "prompt-pack") {
            copyStatusElement.textContent =
              scope === "subtree"
                ? "サブツリーPrompt Packのコピーを要求しました。"
                : "ノードPrompt Packのコピーを要求しました。";
          } else {
            copyStatusElement.textContent =
              scope === "subtree"
                ? "サブツリープロンプトのコピーを要求しました。"
                : "ノードプロンプトのコピーを要求しました。";
          }
        }
      }

      function postClipboardSvgWrite() {
        const node = selectedCopyTarget();
        const svgText = visibleMapSvgText();
        if (!node || !svgText) {
          return;
        }
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: svgText,
          format: "markdown",
          scope: "subtree",
          nodeId: node.id
        });
        if (copyStatusElement) {
          copyStatusElement.textContent = "表示中SVGのコピーを要求しました。";
        }
      }

      function isValidReparentTarget(nodeId, nextParentId) {
        if (!nodeId) {
          return false;
        }
        if (!nextParentId) {
          return true;
        }
        return !(renderNodeIndex?.selectedId === nodeId ? renderNodeIndex.subtree : subtreeNodeIds(nodeId)).has(nextParentId);
      }

      function normalizedParentId(parentId) {
        return parentId || null;
      }

      function isMeaningfulReparentTarget(nodeId, nextParentId) {
        if (!isValidReparentTarget(nodeId, nextParentId)) {
          return false;
        }
        return normalizedParentId(parentIdForNode(nodeId)) !== normalizedParentId(nextParentId);
      }

      function isFocusSafeReparentTarget(nodeId, nextParentId) {
        if (concentrationView) return canOperateOnVisibleNode(nodeId);
        if (!thoughtforgeState.focusRootNodeId) {
          return true;
        }
        return Boolean(
          nodeId &&
          isNodeInFocusSubtree(nodeId) &&
          nextParentId &&
          isNodeInFocusSubtree(nextParentId)
        );
      }

      function childrenForParent(parentId) {
        if (!thoughtforgeState.map) {
          return [];
        }
        if (!parentId) {
          return Array.isArray(thoughtforgeState.map.roots) ? thoughtforgeState.map.roots : [];
        }
        return thoughtforgeState.map.nodesById?.[parentId]?.children ?? [];
      }

      function nextMoveIndex(nodeId, nextParentId) {
        return childrenForParent(nextParentId).filter((childId) => childId !== nodeId).length;
      }

      function hasMeaningfulReparentTargets(nodeId) {
        const map = thoughtforgeState.map;
        if (!map || !nodeId) {
          return false;
        }
        if (isMeaningfulReparentTarget(nodeId, null) && isFocusSafeReparentTarget(nodeId, null)) {
          return true;
        }
        return searchNodeOrderWithinFocus(map).some(
          (candidateId) => isMeaningfulReparentTarget(nodeId, candidateId) && isFocusSafeReparentTarget(nodeId, candidateId)
        );
      }

      function setReparentPickMode(enabled) {
        thoughtforgeState.isPickingReparentTarget = Boolean(enabled && selectedNode());
        renderThoughtForgeMap();
      }

      function startReparentPickModeForNode(nodeId) {
        if (!canOperateOnVisibleNode(nodeId)) return;
        if (!thoughtforgeState.map?.nodesById?.[nodeId]) {
          return;
        }
        thoughtforgeState.selectedNodeId = nodeId;
        if (renameInput) {
          renameInput.value = nodeText(nodeId);
        }
        thoughtforgeState.isPickingReparentTarget = hasMeaningfulReparentTargets(nodeId);
        renderThoughtForgeMap();
      }

      function updateReparentPickControls() {
        const node = selectedNode();
        const enabled = Boolean(node && hasMeaningfulReparentTargets(node.id));
        if (shellElement) {
          shellElement.dataset.reparentPick = thoughtforgeState.isPickingReparentTarget ? "true" : "false";
        }
        if (reparentPickButton) {
          reparentPickButton.disabled = !enabled;
          reparentPickButton.textContent = thoughtforgeState.isPickingReparentTarget ? "Cancel pick" : "Pick parent";
        }
      }

      function updateReparentControls() {
        if (!reparentSelect || !reparentApplyButton) {
          return;
        }

        clearChildren(reparentSelect);
        const node = selectedNode();
        const hasNode = Boolean(node);
        reparentSelect.disabled = !hasNode;
        reparentApplyButton.disabled = !hasNode;

        if (!node || !thoughtforgeState.map) {
          const option = document.createElement("option");
          option.value = "";
          option.textContent = "Move under...";
          reparentSelect.appendChild(option);
          return;
        }

        const currentParentId = parentIdForNode(node.id) ?? "";
        const rootOption = document.createElement("option");
        rootOption.value = "";
        rootOption.textContent = "Map root";
        rootOption.selected = currentParentId === "";
        reparentSelect.appendChild(rootOption);

        for (const candidateId of searchNodeOrderWithinFocus(thoughtforgeState.map)) {
          if (!isValidReparentTarget(node.id, candidateId) || !isFocusSafeReparentTarget(node.id, candidateId)) {
            continue;
          }
          const option = document.createElement("option");
          option.value = candidateId;
          option.textContent = nodeText(candidateId);
          option.selected = candidateId === currentParentId;
          reparentSelect.appendChild(option);
        }
        updateReparentPickControls();
      }

      function nodeDepth(nodeId) {
        if (renderNodeIndex?.depths.has(nodeId)) return renderNodeIndex.depths.get(nodeId);
        let depth = 0;
        let currentParentId = parentIdForNode(nodeId);
        while (currentParentId) {
          depth += 1;
          currentParentId = parentIdForNode(currentParentId);
        }
        return depth;
      }

      function highestCollapsedAncestor(nodeId) {
        let highestCollapsedId = undefined;
        let currentParentId = parentIdForNode(nodeId);
        while (currentParentId) {
          if (isNodeCollapsed(currentParentId)) {
            highestCollapsedId = currentParentId;
          }
          currentParentId = parentIdForNode(currentParentId);
        }
        return highestCollapsedId;
      }

      // Operation reveal changes base folding. Filter expansion is derived only
      // by recomputeSearchMatches and never uses this operation path.
      function revealNodeAncestors(nodeId) {
        let currentParentId = parentIdForNode(nodeId);
        while (currentParentId) {
          thoughtforgeState.collapsedNodeIds.delete(currentParentId);
          thoughtforgeState.filterFoldedNodeIds.delete(currentParentId);
          currentParentId = parentIdForNode(currentParentId);
        }
      }

      function pruneCollapsedNodeIds(map) {
        const nodesById = map?.nodesById ?? {};
        for (const nodeId of [...thoughtforgeState.collapsedNodeIds]) {
          if (!nodesById[nodeId] || !nodesById[nodeId].children?.length) {
            thoughtforgeState.collapsedNodeIds.delete(nodeId);
          }
        }
      }

      function setSubtreeDepth(maxDepth) {
        const start = thoughtforgeState.selectedNodeId ?? THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        const pending = isMapTitleRootNodeId(start) ? getVisibleRootIds(thoughtforgeState.map).map(id => [id, 1]) : [[start, 0]];
        while (pending.length) {
          const [id, depth] = pending.pop();
          const children = thoughtforgeState.map?.nodesById?.[id]?.children ?? [];
          if (maxDepth && depth >= maxDepth && children.length) thoughtforgeState.collapsedNodeIds.add(id);
          else thoughtforgeState.collapsedNodeIds.delete(id);
          for (const child of children) pending.push([child, depth + 1]);
        }
        renderThoughtForgeMap();
        focusVisibleSelection();
      }

      function canOperateOnVisibleNode(nodeId = thoughtforgeState.selectedNodeId) {
        return !concentrationView || !nodeId || !highestCollapsedAncestor(nodeId);
      }

      function visibleSelectionFocusId() {
        return highestCollapsedAncestor(thoughtforgeState.selectedNodeId) ?? thoughtforgeState.selectedNodeId;
      }

      function focusVisibleSelection() {
        if (!concentrationView || canOperateOnVisibleNode()) return;
        const id = visibleSelectionFocusId();
        thoughtforgeState.selectedNodeId = id;
        syncActiveSearchMatchWithSelection();
        if (renameInput) renameInput.value = nodeText(id);
        renderThoughtForgeSelection(true);
        const button = selectedNodeElementForSurface(id, 'map')?.querySelector('button.thoughtforge-node');
        if (button) button.focus({preventScroll:true});
        else focusDirectRenameInput(id, {surface:'map', force:true});
      }

      function syncSelectionFromVisibleFocus() {
        if (!concentrationView || canOperateOnVisibleNode()) return;
        selectThoughtForgeNode(visibleSelectionFocusId(), {reveal:false, surface:'map'});
      }

      function collapseToDepth(maxDepth) {
        if (concentrationView) { setSubtreeDepth(maxDepth); return; }
        const nodesById = thoughtforgeState.map?.nodesById ?? {};
        thoughtforgeState.collapsedNodeIds.clear();
        for (const nodeId of Object.keys(nodesById)) {
          if (nodeDepth(nodeId) >= maxDepth && nodeHasChildren(nodeId)) {
            thoughtforgeState.collapsedNodeIds.add(nodeId);
          }
        }
        const visibleSelectedAncestor = thoughtforgeState.selectedNodeId
          ? highestCollapsedAncestor(thoughtforgeState.selectedNodeId)
          : undefined;
        if (visibleSelectedAncestor) {
          thoughtforgeState.selectedNodeId = visibleSelectedAncestor;
          if (renameInput) {
            renameInput.value = nodeText(visibleSelectedAncestor);
          }
        }
        renderThoughtForgeMap();
      }

      function expandAllNodes() {
        if (concentrationView) { setSubtreeDepth(0); return; }
        thoughtforgeState.collapsedNodeIds.clear();
        renderThoughtForgeMap();
      }

      function visibleNodeIds() {
        const map = thoughtforgeState.map;
        if (!map) {
          return [];
        }

        const result = !concentrationView && thoughtforgeState.focusRootNodeId ? [] : [THOUGHTFORGE_MAP_TITLE_ROOT_ID];
        const visit = (nodeId) => {
          const node = map.nodesById[nodeId];
          if (!node) {
            return;
          }
          result.push(nodeId);
          if (isNodeCollapsed(nodeId)) {
            return;
          }
          for (const childId of node.children) {
            visit(childId);
          }
        };
        for (const rootId of getVisibleRootIds(map)) {
          visit(rootId);
        }
        return result;
      }

      function nextGeneratedNodeId() {
        thoughtforgeState.generatedNodeCounter += 1;
        return "webview-node-" + Date.now().toString(36) + "-" + thoughtforgeState.generatedNodeCounter.toString(36);
      }

      function firstSelectableNodeId(map) {
        if (map) {
          return THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        }
        const nodesById = map?.nodesById ?? {};
        const rootIds = getVisibleRootIds(map);
        return rootIds.find((nodeId) => nodesById[nodeId]) ?? Object.keys(nodesById)[0];
      }

      function childrenForParentInMap(map, parentId) {
        if (!parentId) {
          return Array.isArray(map?.roots) ? map.roots : [];
        }
        return map?.nodesById?.[parentId]?.children ?? [];
      }

      function nodeTextInMap(map, nodeId) {
        return map?.nodesById?.[nodeId]?.text ?? nodeId;
      }

      function cloneMapForOptimisticDrafts(map) {
        if (!map) {
          return map;
        }
        const nodesById = {};
        for (const [nodeId, node] of Object.entries(map.nodesById ?? {})) {
          nodesById[nodeId] = {
            ...node,
            children: Array.isArray(node.children) ? [...node.children] : []
          };
        }
        return {
          ...map,
          roots: Array.isArray(map.roots) ? [...map.roots] : [],
          nodesById
        };
      }

      function currentDirectRenameInputValue(nodeId, surface) {
        const directInput = directRenameInputForNode(nodeId, surface);
        return directInput instanceof HTMLInputElement ? directInput.value : undefined;
      }

      function elementDebugSummary(element) {
        if (!(element instanceof Element)) {
          return { tag: element ? typeof element : "none" };
        }
        const summary = {
          tag: element.tagName.toLowerCase(),
          nodeId: element.dataset?.nodeId,
          surface: element.dataset?.editSurface,
          directMapInput: element.hasAttribute("data-thoughtforge-map-direct-rename-input"),
          directOutlineInput: element.hasAttribute("data-thoughtforge-outline-direct-rename-input")
        };
        if (element instanceof HTMLInputElement) {
          summary.value = element.value;
          summary.selectionStart = element.selectionStart;
          summary.selectionEnd = element.selectionEnd;
        }
        return summary;
      }

      function eventDebugSummary(event) {
        if (!event) {
          return {};
        }
        return {
          key: event.key,
          code: event.code,
          keyCode: event.keyCode,
          inputType: event.inputType,
          data: event.data,
          isComposing: event.isComposing,
          defaultPrevented: event.defaultPrevented,
          target: elementDebugSummary(event.target)
        };
      }

      function imeDebugStateSnapshot(extra = {}) {
        return {
          selectedNodeId: thoughtforgeState.selectedNodeId,
          editingNodeId: thoughtforgeState.editingNodeId,
          editingSurface: thoughtforgeState.editingSurface,
          pendingFocusNodeId: thoughtforgeState.pendingFocusNodeId,
          pendingFocusSurface: thoughtforgeState.pendingFocusSurface,
          activeFocusRetryToken: thoughtforgeState.activeFocusRetryToken
            ? {
                nodeId: thoughtforgeState.activeFocusRetryToken.nodeId,
                surface: thoughtforgeState.activeFocusRetryToken.surface,
                cancelled: thoughtforgeState.activeFocusRetryToken.cancelled
              }
            : undefined,
          isComposingText: thoughtforgeState.isComposingText,
          activeElement: elementDebugSummary(document.activeElement),
          directEditSession: thoughtforgeState.directEditSession
            ? {
                nodeId: thoughtforgeState.directEditSession.nodeId,
                surface: thoughtforgeState.directEditSession.surface,
                phase: thoughtforgeState.directEditSession.phase,
                latestText: thoughtforgeState.directEditSession.latestText
              }
            : undefined,
          ...extra
        };
      }

      function directInputPipelineSnapshot(nodeId, surface, input) {
        const session = directEditSessionFor(nodeId, surface);
        return {
          nodeId,
          surface,
          inputValue: input instanceof HTMLInputElement ? input.value : currentDirectRenameInputValue(nodeId, surface),
          nodeText: nodeText(nodeId),
          optimisticDraftValue: thoughtforgeState.optimisticDraftInputValues.get(nodeId),
          isDraftNode: thoughtforgeState.draftNodeIds.has(nodeId),
          isPendingOptimisticNode: thoughtforgeState.pendingOptimisticNodes.has(nodeId),
          directEditSession: session
            ? {
                phase: session.phase,
                latestText: session.latestText
              }
            : undefined
        };
      }

      function imeDebugTraceText() {
        return JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            documentUri: thoughtforgeDocumentUri,
            trace: thoughtforgeState.imeDebugTrace
          },
          null,
          2
        );
      }

      function postImeDebugTraceClipboardWrite(reason = "manual") {
        recordImeDebugTrace("ime-debug-copy", { reason });
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.clipboard.write",
          text: imeDebugTraceText(),
          format: "markdown",
          scope: "node",
          nodeId: thoughtforgeState.selectedNodeId ?? "ime-debug"
        });
        if (copyStatusElement) {
          copyStatusElement.textContent = "IMEデバッグトレースをコピーしました。";
        }
        return imeDebugTraceText();
      }

      function recordImeDebugTrace(eventName, details = {}) {
        thoughtforgeState.imeDebugTrace.push({
          eventName,
          at: Date.now(),
          ...imeDebugStateSnapshot(details)
        });
        if (thoughtforgeState.imeDebugTrace.length > 160) thoughtforgeState.imeDebugTrace.shift();
        window.__thoughtforgeImeDebug = thoughtforgeState.imeDebugTrace;
        window.__thoughtforgeImeDebugText = imeDebugTraceText;
        window.__thoughtforgeImeDebugCopy = guard(() => postImeDebugTraceClipboardWrite("manual"));
      }

      function directEditSessionFor(nodeId, surface) {
        const session = thoughtforgeState.directEditSession;
        if (!session || session.nodeId !== nodeId || (surface && session.surface !== surface)) {
          return undefined;
        }
        return session;
      }

      function startDirectEditSession(nodeId, surface, options = {}) {
        if (!canOperateOnVisibleNode(nodeId)) return ;
        const nextSurface = normalizeEditSurface(surface) ?? activeDirectEditSurface();
        const latestText = normalizeMarkdownNodeInputText(options.latestText ?? currentDirectRenameInputValue(nodeId, nextSurface) ?? thoughtforgeState.optimisticDraftInputValues.get(nodeId) ?? nodeText(nodeId));
        thoughtforgeState.directEditSession = { nodeId, surface: nextSurface, phase: options.phase ?? "idle", latestText, bufferedModelUpdate: undefined };
        pruneSettledCommandRequests();
        thoughtforgeState.optimisticDraftInputValues.set(nodeId, latestText);
        recordImeDebugTrace("direct-session-start", {
          reason: "startDirectEditSession",
          latestText,
          ...directInputPipelineSnapshot(nodeId, nextSurface)
        });
        return thoughtforgeState.directEditSession;
      }

      function ensureDirectEditSession(nodeId, surface, options = {}) {
        const session = directEditSessionFor(nodeId, surface);
        if (!session) {
          return startDirectEditSession(nodeId, surface, options);
        }
        if (options.phase) session.phase = options.phase;
        if (Object.prototype.hasOwnProperty.call(options, "latestText")) {
          session.latestText = normalizeMarkdownNodeInputText(options.latestText);
          thoughtforgeState.optimisticDraftInputValues.set(nodeId, session.latestText);
          recordImeDebugTrace("direct-session-latest-text-updated", {
            reason: "ensureDirectEditSession",
            latestText: session.latestText,
            ...directInputPipelineSnapshot(nodeId, surface)
          });
        }
        return session;
      }

      function retargetDirectEditSession(previousNodeId, resolvedNodeId, surface) {
        const session = directEditSessionFor(previousNodeId, surface);
        if (!session) {
          return;
        }
        session.nodeId = resolvedNodeId;
        thoughtforgeState.optimisticDraftInputValues.set(resolvedNodeId, session.latestText);
      }

      function finishDirectEditSession() {
        const session = thoughtforgeState.directEditSession;
        if (!session) {
          return;
        }
        hostPolicy?.stageModel?.(session.bufferedModelUpdate);
        if (!thoughtforgeState.pendingOptimisticNodes.has(session.nodeId) && !thoughtforgeState.draftNodeIds.has(session.nodeId)) thoughtforgeState.optimisticDraftInputValues.delete(session.nodeId);
        thoughtforgeState.directEditSession = undefined;
        pruneSettledCommandRequests();
      }

      function shouldBufferModelUpdateForDirectEdit() {
        const session = thoughtforgeState.directEditSession;
        return Boolean(session && (session.phase === "composing" || session.phase === "committing"));
      }

      function bufferModelUpdateForDirectEdit(message) {
        const session = thoughtforgeState.directEditSession;
        if (!session) {
          return false;
        }
        session.bufferedModelUpdate = message;
        return true;
      }

      function takeBufferedDirectEditModelUpdate() {
        const session = thoughtforgeState.directEditSession;
        if (!session?.bufferedModelUpdate) {
          return undefined;
        }
        const message = session.bufferedModelUpdate;
        session.bufferedModelUpdate = undefined;
        return message;
      }

      function directEditSessionInputValue(nodeId, surface) {
        return directEditSessionFor(nodeId, surface)?.latestText;
      }

      function syncOptimisticDraftInputValue(nodeId, value) {
        const normalizedValue = normalizeMarkdownNodeInputText(value);
        const session = directEditSessionFor(nodeId);
        if (session) {
          session.latestText = normalizedValue;
        }
        if (!session && !thoughtforgeState.pendingOptimisticNodes.has(nodeId) && !thoughtforgeState.draftNodeIds.has(nodeId)) {
          recordImeDebugTrace("direct-input-sync-skipped", {
            reason: "not direct session or optimistic draft",
            attemptedText: normalizedValue,
            ...directInputPipelineSnapshot(nodeId, activeDirectEditSurface())
          });
          return;
        }
        thoughtforgeState.optimisticDraftInputValues.set(nodeId, normalizedValue);
        recordImeDebugTrace("direct-input-sync-optimistic-draft", {
          reason: "syncOptimisticDraftInputValue",
          latestText: normalizedValue,
          ...directInputPipelineSnapshot(nodeId, session?.surface ?? activeDirectEditSurface())
        });
      }

      function insertNodeIdAtIndex(nodeIds, nodeId, index) {
        if (!Array.isArray(nodeIds) || nodeIds.includes(nodeId)) {
          return;
        }
        const nextIndex = Math.max(0, Math.min(index, nodeIds.length));
        nodeIds.splice(nextIndex, 0, nodeId);
      }

      function removeNodeId(nodeIds, nodeId) {
        if (!Array.isArray(nodeIds)) {
          return;
        }
        const index = nodeIds.indexOf(nodeId);
        if (index !== -1) {
          nodeIds.splice(index, 1);
        }
      }

      function removeOptimisticNodeFromMap(map, nodeId, parentId) {
        if (!map?.nodesById?.[nodeId]) {
          return;
        }
        const siblings = parentId ? map.nodesById?.[parentId]?.children : map.roots;
        removeNodeId(siblings, nodeId);
        delete map.nodesById[nodeId];
      }

      function moveNodeIdInMap(map, nodeId, nextParentId, nextIndex) {
        if (!map?.nodesById?.[nodeId]) {
          return false;
        }
        const currentParentId = parentIdForNodeInMap(map, nodeId) ?? null;
        const currentSiblings = currentParentId ? map.nodesById?.[currentParentId]?.children : map.roots;
        const nextSiblings = nextParentId ? map.nodesById?.[nextParentId]?.children : map.roots;
        if (!Array.isArray(currentSiblings) || !Array.isArray(nextSiblings)) {
          return false;
        }
        const currentIndex = currentSiblings.indexOf(nodeId);
        if (currentIndex === -1) {
          return false;
        }
        currentSiblings.splice(currentIndex, 1);
        const adjustedIndex = Math.max(0, Math.min(nextIndex, nextSiblings.length));
        nextSiblings.splice(adjustedIndex, 0, nodeId);
        return true;
      }

      function nodeMoveFingerprintInMap(map, nodeId) {
        const node = map?.nodesById?.[nodeId];
        if (!node) {
          return undefined;
        }
        return JSON.stringify({
          text: node.text ?? "",
          note: node.note ?? "",
          children: (node.children ?? []).map((childId) => nodeMoveFingerprintInMap(map, childId) ?? "")
        });
      }

      function nodeSiblingTextOccurrenceInMap(map, nodeId, parentId) {
        const node = map?.nodesById?.[nodeId];
        if (!node) {
          return 0;
        }
        let occurrence = 0;
        for (const siblingId of childrenForParentInMap(map, parentId)) {
          if (siblingId === nodeId) {
            return occurrence;
          }
          if (map?.nodesById?.[siblingId]?.text === node.text) {
            occurrence += 1;
          }
        }
        return occurrence;
      }

      function nodePathSignatureInMap(map, nodeId) {
        if (!map?.nodesById?.[nodeId]) {
          return undefined;
        }
        const path = [];
        let currentId = nodeId;
        while (currentId && map.nodesById?.[currentId]) {
          const parentId = parentIdForNodeInMap(map, currentId) ?? null;
          path.unshift({
            text: map.nodesById[currentId].text ?? "",
            occurrence: nodeSiblingTextOccurrenceInMap(map, currentId, parentId)
          });
          currentId = parentId;
        }
        return path;
      }

      function resolveNodePathSignatureInMap(map, path) {
        if (!Array.isArray(path)) {
          return undefined;
        }
        let parentId = null;
        let resolvedId = undefined;
        for (const step of path) {
          let occurrence = 0;
          resolvedId = undefined;
          for (const candidateId of childrenForParentInMap(map, parentId)) {
            const candidate = map?.nodesById?.[candidateId];
            if (!candidate || candidate.text !== step.text) {
              continue;
            }
            if (occurrence === step.occurrence) {
              resolvedId = candidateId;
              break;
            }
            occurrence += 1;
          }
          if (!resolvedId) {
            return undefined;
          }
          parentId = resolvedId;
        }
        return resolvedId;
      }

      function pendingMoveSelectionForMove(map, nodeId, nextParentId, nextIndex) {
        const fingerprint = nodeMoveFingerprintInMap(map, nodeId);
        if (!fingerprint) {
          return undefined;
        }
        const previousParentId = parentIdForNodeInMap(map, nodeId) ?? null;
        const previousIndex = childrenForParentInMap(map, previousParentId).indexOf(nodeId);
        if (previousIndex < 0) {
          return undefined;
        }
        const nextParentPath = nextParentId ? nodePathSignatureInMap(map, nextParentId) : [];
        if (nextParentId && !nextParentPath) {
          return undefined;
        }
        return {
          nodeId,
          fingerprint,
          previousParentId,
          previousIndex,
          nextParentPath,
          nextIndex,
          createdAt: performance.now()
        };
      }

      function nodeMatchesMoveFingerprint(map, nodeId, fingerprint) {
        return nodeMoveFingerprintInMap(map, nodeId) === fingerprint;
      }

      function resolvePendingMoveSelectionInMap(map, pending) {
        if (!map || !pending) {
          return undefined;
        }
        const hasParentPath = pending.nextParentPath.length > 0;
        const parentId = hasParentPath
          ? resolveNodePathSignatureInMap(map, pending.nextParentPath)
          : null;
        if (!hasParentPath || parentId) {
          const siblings = childrenForParentInMap(map, parentId);
          const indexedCandidateId = siblings[pending.nextIndex];
          if (indexedCandidateId && nodeMatchesMoveFingerprint(map, indexedCandidateId, pending.fingerprint)) {
            return indexedCandidateId;
          }
          const siblingMatch = siblings.find((candidateId) =>
            nodeMatchesMoveFingerprint(map, candidateId, pending.fingerprint)
          );
          if (siblingMatch) {
            return siblingMatch;
          }
        }
        const globalMatches = Object.keys(map.nodesById ?? {}).filter((candidateId) =>
          nodeMatchesMoveFingerprint(map, candidateId, pending.fingerprint)
        );
        return globalMatches.length === 1 ? globalMatches[0] : undefined;
      }

      function restorePendingMoveSelectionAfterModelUpdate(map) {
        const pending = thoughtforgeState.pendingMoveSelection;
        if (!pending) {
          return;
        }
        if (performance.now() - pending.createdAt > OPTIMISTIC_DRAFT_EXPIRY_MS) {
          thoughtforgeState.pendingMoveSelection = undefined;
          pruneSettledCommandRequests();
          return;
        }
        const resolvedNodeId = resolvePendingMoveSelectionInMap(map, pending);
        if (!resolvedNodeId) {
          return;
        }
        thoughtforgeState.pendingMoveSelection = undefined;
        pruneSettledCommandRequests();
        thoughtforgeState.selectedNodeId = resolvedNodeId;
        thoughtforgeState.editingNodeId = undefined;
        thoughtforgeState.editingSurface = undefined;
        thoughtforgeState.pendingFocusNodeId = undefined;
        thoughtforgeState.pendingFocusTarget = undefined;
        thoughtforgeState.pendingFocusSurface = undefined;
        thoughtforgeState.pendingEditingRefocusNodeId = undefined;
        revealNodeAncestors(resolvedNodeId);
        if (renameInput) {
          renameInput.value = nodeTextInMap(map, resolvedNodeId);
        }
      }

      function selectMovedMapNodeAfterDrop(nodeId) {
        if (!thoughtforgeState.map?.nodesById?.[nodeId]) {
          return;
        }
        thoughtforgeState.selectedNodeId = nodeId;
        thoughtforgeState.editingNodeId = undefined;
        thoughtforgeState.editingSurface = undefined;
        thoughtforgeState.pendingFocusNodeId = undefined;
        thoughtforgeState.pendingFocusTarget = undefined;
        thoughtforgeState.pendingFocusSurface = undefined;
        thoughtforgeState.pendingEditingRefocusNodeId = undefined;
        revealNodeAncestors(nodeId);
        if (renameInput) {
          renameInput.value = nodeText(nodeId);
        }
      }

      function applyOptimisticMove(nodeId, nextParentId, nextIndex) {
        if (!canOperateOnVisibleNode(nodeId)) return false;
        const pendingMoveSelection = pendingMoveSelectionForMove(thoughtforgeState.map, nodeId, nextParentId, nextIndex);
        if (!moveNodeIdInMap(thoughtforgeState.map, nodeId, nextParentId, nextIndex)) {
          return false;
        }
        thoughtforgeState.pendingMoveSelection = pendingMoveSelection;
        pruneSettledCommandRequests();
        selectMovedMapNodeAfterDrop(nodeId);
        renderThoughtForgeMap();
        return true;
      }

      function pendingOptimisticCommandReference(command) {
        const candidates = [];
        if (
          command?.type === "node.rename" ||
          command?.type === "node.renameAndInsertSibling" ||
          command?.type === "node.renameAndInsertChild" ||
          command?.type === "node.delete" ||
          command?.type === "node.indent" ||
          command?.type === "node.outdent" ||
          command?.type === "node.move" ||
          command?.type === "node.updateNote" ||
          command?.type === "node.clearNote"
        ) {
          candidates.push(command.nodeId);
        }
        if (command?.type === "node.insertSibling") {
          candidates.push(command.siblingId);
        }
        if (command?.type === "node.insertChild") {
          candidates.push(command.parentId);
        }
        if (command?.type === "node.move") {
          candidates.push(command.nextParentId);
        }
        return candidates.find((candidate) => typeof candidate === "string" && thoughtforgeState.pendingOptimisticNodes.has(candidate));
      }

      function queueOptimisticCommand(nodeId, command, requestId) {
        const queued = thoughtforgeState.queuedOptimisticCommands.get(nodeId) ?? [];
        queued.push({ requestId, command: { ...command } });
        thoughtforgeState.queuedOptimisticCommands.set(nodeId, queued);
      }

      function translateOptimisticCommand(command, previousNodeId, resolvedNodeId) {
        const translated = { ...command };
        for (const key of ["nodeId", "siblingId", "parentId", "nextParentId"]) {
          if (translated[key] === previousNodeId) {
            translated[key] = resolvedNodeId;
          }
        }
        return translated;
      }

      function retargetDependentOptimisticNodes(previousNodeId, resolvedNodeId) {
        for (const meta of thoughtforgeState.pendingOptimisticNodes.values()) {
          if (meta.nodeId === previousNodeId) {
            continue;
          }
          if (meta.siblingId === previousNodeId) {
            meta.siblingId = resolvedNodeId;
          }
          if (meta.parentId === previousNodeId) {
            meta.parentId = resolvedNodeId;
          }
          if (meta.dependsOnNodeId === previousNodeId) {
            meta.dependsOnNodeId = undefined;
          }
        }
      }

      function flushQueuedOptimisticCommands(previousNodeId, resolvedNodeId) {
        const queued = thoughtforgeState.queuedOptimisticCommands.get(previousNodeId);
        if (!queued?.length) {
          return;
        }
        thoughtforgeState.queuedOptimisticCommands.delete(previousNodeId);
        for (const { requestId, command } of queued) {
          const optimisticNodeId = optimisticNodeIdForCommand(command);
          const optimisticMeta = optimisticNodeId
            ? thoughtforgeState.pendingOptimisticNodes.get(optimisticNodeId)
            : undefined;
          if (optimisticNodeId && !optimisticMeta) {
            finishRenameRequest(requestId);
            continue;
          }
          if (optimisticMeta) {
            optimisticMeta.commandQueued = false;
            optimisticMeta.commandPosted = true;
          }
          postThoughtForgeCommand(translateOptimisticCommand(command, previousNodeId, resolvedNodeId), requestId);
        }
      }

      function optimisticDraftNodeText(meta) {
        const directValue = currentDirectRenameInputValue(meta.nodeId, meta.surface);
        if (directValue !== undefined) {
          syncOptimisticDraftInputValue(meta.nodeId, directValue);
        }
        return "";
      }

      function overlayOptimisticNode(map, meta) {
        if (!map || map.nodesById?.[meta.nodeId]) {
          return false;
        }
        const parentId = meta.parentId ?? null;
        const siblings = parentId ? map.nodesById?.[parentId]?.children : map.roots;
        if (!Array.isArray(siblings)) {
          return false;
        }
        map.nodesById[meta.nodeId] = {
          id: meta.nodeId,
          text: optimisticDraftNodeText(meta),
          children: []
        };
        insertNodeIdAtIndex(siblings, meta.nodeId, meta.index);
        return true;
      }

      function optimisticDraftAnchorExistsInMap(map, meta) {
        const anchorId = meta.createdBy === "enter" ? meta.siblingId : meta.parentId;
        return Boolean(
          anchorId &&
          (map?.nodesById?.[anchorId] || thoughtforgeState.pendingOptimisticNodes.has(anchorId))
        );
      }

      function resolveOptimisticNodeIdInMap(map, meta) {
        if (!map) {
          return undefined;
        }
        if (map.nodesById?.[meta.nodeId]) {
          return meta.nodeId;
        }
        const siblings = childrenForParentInMap(map, meta.parentId ?? null);
        if (typeof meta.previousSiblingCount === "number" && siblings.length <= meta.previousSiblingCount) {
          return undefined;
        }
        const candidateId = siblings[meta.index];
        const expectedText = typeof meta.expectedText === "string" ? meta.expectedText : "";
        return candidateId && map.nodesById?.[candidateId] && nodeTextInMap(map, candidateId) === expectedText
          ? candidateId
          : undefined;
      }

      function reconcileOptimisticNodes(nextMap) {
        const map = cloneMapForOptimisticDrafts(nextMap);
        const now = performance.now();
        const targets = new Map([...thoughtforgeState.pendingRenames].map(([id, record]) => [id, record.nodeId]));
        const ids = {}, gone = new Set();
        const rebind = () => rebindRenameTargets(ids, id => !gone.has(id), targets);
        for (const [nodeId, meta] of Array.from(thoughtforgeState.pendingOptimisticNodes.entries())) {
          if (meta.commandPosted !== true) {
            if (!optimisticDraftAnchorExistsInMap(map, meta)) {
              clearDraftNode(nodeId);
              gone.add(nodeId);
              if (thoughtforgeState.directEditSession?.nodeId === nodeId) {
                finishDirectEditSession();
              }
              if (thoughtforgeState.selectedNodeId === nodeId) {
                thoughtforgeState.selectedNodeId = undefined;
              }
              if (thoughtforgeState.editingNodeId === nodeId) {
                thoughtforgeState.editingNodeId = undefined;
                thoughtforgeState.editingSurface = undefined;
              }
              if (thoughtforgeState.pendingFocusNodeId === nodeId) {
                thoughtforgeState.pendingFocusNodeId = undefined;
                thoughtforgeState.pendingFocusSurface = undefined;
              }
              if (thoughtforgeState.pendingEditingRefocusNodeId === nodeId) {
                thoughtforgeState.pendingEditingRefocusNodeId = undefined;
                thoughtforgeState.pendingFocusSurface = undefined;
              }
            } else if (overlayOptimisticNode(map, meta)) {
              thoughtforgeState.draftNodeIds.add(nodeId);
            }
            continue;
          }
          const resolvedNodeId = resolveOptimisticNodeIdInMap(map, meta);
          if (resolvedNodeId) {
            const draftInputValue =
              currentDirectRenameInputValue(nodeId, meta.surface) ??
              thoughtforgeState.optimisticDraftInputValues.get(nodeId);
            const wasDraftNode = thoughtforgeState.draftNodeIds.has(nodeId);
            thoughtforgeState.pendingOptimisticNodes.delete(nodeId);
            thoughtforgeState.draftNodeIds.delete(nodeId);
            if (nodeId !== resolvedNodeId) {
              ids[nodeId] = resolvedNodeId;
              thoughtforgeState.draftNodeIds.delete(resolvedNodeId);
              if (draftInputValue !== undefined) {
                thoughtforgeState.optimisticDraftInputValues.delete(nodeId);
                thoughtforgeState.optimisticDraftInputValues.set(resolvedNodeId, draftInputValue);
              }
              if (thoughtforgeState.selectedNodeId === nodeId) {
                thoughtforgeState.selectedNodeId = resolvedNodeId;
              }
              if (thoughtforgeState.focusRootNodeId === nodeId) {
                thoughtforgeState.focusRootNodeId = resolvedNodeId;
              }
              if (thoughtforgeState.editingNodeId === nodeId) {
                thoughtforgeState.editingNodeId = resolvedNodeId;
                thoughtforgeState.pendingEditingRefocusNodeId = resolvedNodeId;
                thoughtforgeState.pendingFocusSurface = meta.surface;
              }
              retargetDirectEditSession(nodeId, resolvedNodeId, meta.surface);
            }
            if (nodeId === resolvedNodeId && draftInputValue !== undefined) {
              thoughtforgeState.optimisticDraftInputValues.set(resolvedNodeId, draftInputValue);
            }
            if (wasDraftNode && nodeTextInMap(map, resolvedNodeId) === "") {
              thoughtforgeState.draftNodeIds.add(resolvedNodeId);
            }
            retargetDependentOptimisticNodes(nodeId, resolvedNodeId);
            rebind();
            flushQueuedOptimisticCommands(nodeId, resolvedNodeId);
            continue;
          }

          if (now - meta.createdAt > OPTIMISTIC_DRAFT_EXPIRY_MS && !(meta.commandPosted && hasDependents(nodeId))) {
            gone.add(nodeId);
            thoughtforgeState.pendingOptimisticNodes.delete(nodeId);
            thoughtforgeState.draftNodeIds.delete(nodeId);
            thoughtforgeState.queuedOptimisticCommands.delete(nodeId);
            thoughtforgeState.optimisticDraftInputValues.delete(nodeId);
            if (thoughtforgeState.selectedNodeId === nodeId) {
              thoughtforgeState.selectedNodeId = undefined;
            }
            if (thoughtforgeState.editingNodeId === nodeId) {
              thoughtforgeState.editingNodeId = undefined;
              thoughtforgeState.editingSurface = undefined;
            }
            continue;
          }

          if (overlayOptimisticNode(map, meta)) {
            thoughtforgeState.draftNodeIds.add(nodeId);
          }
        }
        rebind();
        pruneSettledCommandRequests();
        return map;
      }

      function applyModelUpdate(message) {
        const fixedFocus = thoughtforgeState.focusRootNodeId;
        hostPolicy?.beforeModelUpdate?.(message);
        if(commandMoveSource && commandMoveEpoch!==thoughtforgeState.commandModelEpoch) commandMoveSource=undefined;
        recordImeDebugTrace("model-update", { version: message.document?.version });
        recordModelUpdateSyncStatus(message.document?.version);
        clearParseDiagnostics();
        const activeDirectInput = document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.nodeId
          ? document.activeElement
          : undefined;
        const activeDirectInputSurface = normalizeEditSurface(activeDirectInput?.dataset.editSurface);
        const activeDirectInputSelection = activeDirectInput
          ? {
              selectionStart: activeDirectInput.selectionStart,
              selectionEnd: activeDirectInput.selectionEnd,
              selectionDirection: activeDirectInput.selectionDirection
            }
          : undefined;
        if (activeDirectInput) {
          suppressNextDirectRenameBlur(activeDirectInput);
        }
        if (!hostPolicy && message.document?.text !== thoughtforgeState.documentText) {
          for (const [id, record] of thoughtforgeState.pendingRenames) if (record.phase !== "queued") finishRenameRequest(id);
        }
        thoughtforgeState.documentText = String(message.document?.text ?? "");
        // Parser IDs may be reallocated. This display-only exclusion has no
        // proven host ID mapping, so it expires rather than attaching elsewhere.
        if (concentrationView) {
          thoughtforgeState.filterFoldedNodeIds.clear();
          normalizedNodeTextCache.clear();
        }
        if (hostPolicy?.reconcileMap) thoughtforgeState.map = hostPolicy.reconcileMap(message.map, message);
        else thoughtforgeState.map = reconcileOptimisticNodes(message.map);
        if (concentrationView && fixedFocus && !thoughtforgeState.focusRootNodeId) thoughtforgeState.focusFollowingSelection = false;
        confirmPastedBranch(message);
        if (
          activeDirectInput &&
          thoughtforgeState.editingNodeId &&
          thoughtforgeState.map?.nodesById?.[thoughtforgeState.editingNodeId]
        ) {
          thoughtforgeState.pendingEditingRefocusNodeId = thoughtforgeState.editingNodeId;
          thoughtforgeState.pendingFocusSurface = activeDirectInputSurface;
        }
        restorePendingMoveSelectionAfterModelUpdate(thoughtforgeState.map);
        recomputeSearchMatches();
        renderThoughtForgeMap();
        const restoredDirectInput = thoughtforgeState.editingNodeId
          ? directRenameInputForNode(thoughtforgeState.editingNodeId, activeDirectInputSurface)
          : undefined;
        if (activeDirectInput && !activeDirectInput.isConnected && !thoughtforgeState.editingNodeId && !isTextEditingTarget(document.activeElement)) focusSelectionCap();
        if (restoredDirectInput instanceof HTMLInputElement && activeDirectInputSelection) {
          const inputLength = restoredDirectInput.value.length;
          const selectionStart = Math.min(activeDirectInputSelection.selectionStart ?? inputLength, inputLength);
          const selectionEnd = Math.min(activeDirectInputSelection.selectionEnd ?? inputLength, inputLength);
          restoredDirectInput.setSelectionRange(
            selectionStart,
            selectionEnd,
            activeDirectInputSelection.selectionDirection ?? "none"
          );
        }
        hostPolicy?.afterModelUpdate?.(message);
      }

      function parentIdForNodeInMap(map, nodeId) {
        const nodesById = map?.nodesById ?? {};
        for (const candidate of Object.values(nodesById)) {
          if (candidate.children?.includes(nodeId)) {
            return candidate.id;
          }
        }
        return undefined;
      }

      function resolvePendingFocusNodeId(map) {
        if (thoughtforgeState.pendingFocusNodeId && map?.nodesById?.[thoughtforgeState.pendingFocusNodeId]) {
          return thoughtforgeState.pendingFocusNodeId;
        }
        const target = thoughtforgeState.pendingFocusTarget;
        if (!target || !map) {
          return undefined;
        }
        if (target.type === "child") {
          const children = childrenForParentInMap(map, target.parentId);
          if (typeof target.childCount === "number" && children.length <= target.childCount) {
            return undefined;
          }
          const candidateId = children[target.index];
          return candidateId && nodeText(candidateId) === "" ? candidateId : undefined;
        }
        const parentId = Object.prototype.hasOwnProperty.call(target, "parentId")
          ? target.parentId
          : parentIdForNodeInMap(map, target.siblingId);
        const siblings = childrenForParentInMap(map, parentId);
        if (typeof target.siblingCount === "number" && siblings.length <= target.siblingCount) {
          return undefined;
        }
        if (typeof target.index === "number") {
          const candidateId = siblings[target.index];
          return candidateId && nodeText(candidateId) === "" ? candidateId : undefined;
        }
        const siblingIndex = siblings.indexOf(target.siblingId);
        if (target.where === "before") {
          return map.nodesById[target.siblingId] ? target.siblingId : undefined;
        }
        return siblingIndex === -1 ? undefined : siblings[siblingIndex + 1];
      }

      function isDraftNode(nodeId) {
        return thoughtforgeState.draftNodeIds.has(nodeId);
      }

      function createEmptyDraft(id, input) {
        if (isCancellableEmptyDraftNode(id) && !normalizeMarkdownNodeInputText(input?.value ?? "")) commitOptimisticDraftNode(id, "", true);
      }

      function isCancellableEmptyDraftNode(nodeId) {
        const optimisticMeta = thoughtforgeState.pendingOptimisticNodes.get(nodeId);
        return (
          optimisticMeta?.commandPosted !== true &&
          !nodeHasChildren(nodeId) && !hasDependents(nodeId) &&
          isDraftNode(nodeId) &&
          nodeText(nodeId) === ""
        );
      }

      function isDraftLikeEmptyNode(nodeId) {
        return isDraftNode(nodeId) || nodeText(nodeId) === "";
      }

      function isEmptyDraftNodeInput(nodeId, input) {
        return isDraftLikeEmptyNode(nodeId) && normalizeMarkdownNodeInputText(input?.value ?? "") === "";
      }

      function commitOptimisticDraftNode(nodeId, nextText, allowEmpty = false) {
        const meta = thoughtforgeState.pendingOptimisticNodes.get(nodeId);
        if (!meta || meta.commandPosted === true || meta.commandQueued === true || (nextText === "" && !allowEmpty)) {
          return false;
        }
        const command = meta.createdBy === "enter"
          ? {
              type: "node.insertSibling",
              siblingId: meta.siblingId,
              where: meta.where,
              nodeId,
              text: nextText
            }
          : meta.createdBy === "tab"
            ? {
                type: "node.insertChild",
                parentId: meta.parentId,
                index: meta.index,
                nodeId,
                text: nextText
              }
            : undefined;
        if (!command) {
          return false;
        }
        meta.expectedText = nextText;
        const dispatch = postThoughtForgeCommand(command);
        meta.commandQueued = dispatch === "queued";
        meta.commandPosted = dispatch === "posted";
        return true;
      }

      function clearQueuedOptimisticDrafts(nodeId) {
        const queued = thoughtforgeState.queuedOptimisticCommands.get(nodeId) ?? [];
        thoughtforgeState.queuedOptimisticCommands.delete(nodeId);
        for (const entry of queued) finishRenameRequest(entry.requestId);
        const dependentNodeIds = new Set(
          queued.map(({ command }) => optimisticNodeIdForCommand(command)).filter(Boolean)
        );
        for (const meta of thoughtforgeState.pendingOptimisticNodes.values()) {
          if (meta.dependsOnNodeId === nodeId) {
            dependentNodeIds.add(meta.nodeId);
          }
        }
        for (const queuedNodeId of dependentNodeIds) {
          if (!queuedNodeId || queuedNodeId === nodeId) {
            continue;
          }
          const queuedMeta = thoughtforgeState.pendingOptimisticNodes.get(queuedNodeId);
          const fallbackNodeId = fallbackSelectionAfterDraftDelete(queuedNodeId);
          clearDraftNode(queuedNodeId);
          removeOptimisticNodeFromMap(
            thoughtforgeState.map,
            queuedNodeId,
            queuedMeta?.parentId ?? null
          );
          rememberCancelledCommandNode(queuedNodeId);
          if (thoughtforgeState.directEditSession?.nodeId === queuedNodeId) {
            finishDirectEditSession();
          }
          if (thoughtforgeState.selectedNodeId === queuedNodeId) {
            thoughtforgeState.selectedNodeId = fallbackNodeId;
          }
          if (thoughtforgeState.editingNodeId === queuedNodeId) {
            thoughtforgeState.editingNodeId = undefined;
            thoughtforgeState.editingSurface = undefined;
          }
          if (thoughtforgeState.pendingFocusNodeId === queuedNodeId) {
            thoughtforgeState.pendingFocusNodeId = undefined;
            thoughtforgeState.pendingFocusSurface = undefined;
          }
          if (thoughtforgeState.pendingEditingRefocusNodeId === queuedNodeId) {
            thoughtforgeState.pendingEditingRefocusNodeId = undefined;
            thoughtforgeState.pendingFocusSurface = undefined;
          }
          clearPendingDirectEditKeys(queuedNodeId);
        }
      }

      function removeQueuedOptimisticCommandsForNode(nodeId) {
        for (const [anchorId, queued] of thoughtforgeState.queuedOptimisticCommands) {
          const remaining = queued.filter(
            ({ requestId, command }) => {
              if (optimisticNodeIdForCommand(command) !== nodeId) return true;
              finishRenameRequest(requestId);
              return false;
            }
          );
          if (remaining.length === 0) {
            thoughtforgeState.queuedOptimisticCommands.delete(anchorId);
          } else if (remaining.length !== queued.length) {
            thoughtforgeState.queuedOptimisticCommands.set(anchorId, remaining);
          }
        }
      }

      function clearDraftNode(nodeId) {
        removeQueuedOptimisticCommandsForNode(nodeId);
        clearQueuedOptimisticDrafts(nodeId);
        thoughtforgeState.draftNodeIds.delete(nodeId);
        thoughtforgeState.pendingOptimisticNodes.delete(nodeId);
        thoughtforgeState.optimisticDraftInputValues.delete(nodeId);
        pruneSettledCommandRequests();
      }

      function clearCommittedDraftNode(nodeId) {
        if (thoughtforgeState.pendingOptimisticNodes.has(nodeId)) {
          return;
        }
        clearDraftNode(nodeId);
      }

      function pruneDraftNodeIds(map) {
        const nodesById = map?.nodesById ?? {};
        for (const draftNodeId of Array.from(thoughtforgeState.draftNodeIds)) {
          if (!nodesById[draftNodeId] || nodeText(draftNodeId) !== "") {
            thoughtforgeState.draftNodeIds.delete(draftNodeId);
          }
        }
      }

      function rememberOptimisticNode(meta) {
        forgetCancelledCommandNode(meta.nodeId);
        thoughtforgeState.draftNodeIds.add(meta.nodeId);
        thoughtforgeState.pendingOptimisticNodes.set(meta.nodeId, meta);
        thoughtforgeState.selectedNodeId = meta.nodeId;
        thoughtforgeState.editingNodeId = meta.nodeId;
        thoughtforgeState.editingSurface = meta.surface;
        thoughtforgeState.pendingFocusNodeId = meta.nodeId;
        thoughtforgeState.pendingFocusSurface = meta.surface;
        startDirectEditSession(meta.nodeId, meta.surface, {
          phase: "idle",
          latestText: ""
        });
        setTimeout(() => {
          const pendingMeta = thoughtforgeState.pendingOptimisticNodes.get(meta.nodeId);
          if (!pendingMeta || pendingMeta.commandPosted !== true) {
            return;
          }
          if (normalizeMarkdownNodeInputText(currentDirectRenameInputValue(meta.nodeId, meta.surface) ?? "") !== "") {
            return;
          }
          if (nodeText(meta.nodeId) || pendingMeta.expectedText || hasDependents(meta.nodeId)) return;
          const fallbackNodeId = fallbackSelectionAfterDraftDelete(meta.nodeId);
          clearDraftNode(meta.nodeId);
          removeOptimisticNodeFromMap(thoughtforgeState.map, meta.nodeId, meta.parentId ?? null);
          if (thoughtforgeState.selectedNodeId === meta.nodeId) {
            thoughtforgeState.selectedNodeId = fallbackNodeId;
          }
          if (thoughtforgeState.editingNodeId === meta.nodeId) {
            thoughtforgeState.editingNodeId = undefined;
            thoughtforgeState.editingSurface = undefined;
          }
          if (directEditSessionFor(meta.nodeId, meta.surface)) {
            finishDirectEditSession();
          }
          pruneSettledCommandRequests();
          renderThoughtForgeMap();
        }, OPTIMISTIC_DRAFT_EXPIRY_MS);
      }

      function focusDirectRenameInputImmediately(nodeId, surface) {
        recordImeDebugTrace("focus-immediate-start", { nodeId, surface });
        traceDebugEvent({
          scope: "focus",
          event: "request",
          nodeId,
          payload: { surface, reason: "immediate" }
        });
        if (focusDirectRenameInput(nodeId, { surface, force: true })) {
          recordImeDebugTrace("focus-immediate-success", { nodeId, surface, sync: true });
        }
        const retryToken = scheduleDirectRenameFocus(nodeId, { surface });
        const scheduleFocus =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (listener) => setTimeout(listener, 0);
        scheduleFocus(() => {
          if (!isCurrentDirectRenameFocusRequest(retryToken)) return;
          const focused = focusDirectRenameInput(nodeId, { surface, force: true });
          recordImeDebugTrace("focus-immediate-retry", { nodeId, surface, focused });
        });
      }

      function insertOptimisticSibling(currentNodeId, nextNodeId, where, surface) {
        if (!canOperateOnVisibleNode(currentNodeId)) return false;
        const map = thoughtforgeState.map;
        const current = map?.nodesById?.[currentNodeId];
        if (!map || !current || map.nodesById?.[nextNodeId]) {
          traceDebugEvent({
            scope: "node",
            event: "createSibling",
            nodeId: nextNodeId,
            payload: { currentNodeId, where, surface },
            result: "failed",
            reason: "invalid optimistic sibling target"
          });
          return false;
        }
        const parentId = parentIdForNode(currentNodeId) ?? null;
        const siblings = childrenForParent(parentId);
        const currentIndex = siblings.indexOf(currentNodeId);
        const nextIndex =
          where === "before"
            ? Math.max(0, currentIndex)
            : currentIndex === -1
              ? siblings.length
              : currentIndex + 1;
        map.nodesById[nextNodeId] = {
          id: nextNodeId,
          text: "",
          children: []
        };
        insertNodeIdAtIndex(siblings, nextNodeId, nextIndex);
        rememberOptimisticNode({
          nodeId: nextNodeId,
          parentId,
          index: nextIndex,
          previousSiblingCount: siblings.length - 1,
          createdBy: "enter",
          siblingId: currentNodeId,
          where,
          dependsOnNodeId: thoughtforgeState.pendingOptimisticNodes.has(currentNodeId)
            ? currentNodeId
            : undefined,
          commandPosted: false,
          surface,
          createdAt: performance.now()
        });
        revealNodeAncestors(nextNodeId);
        renderThoughtForgeMap();
        focusDirectRenameInputImmediately(nextNodeId, surface);
        recordImeDebugTrace("optimistic-sibling-created", { currentNodeId, nextNodeId, surface, where });
        traceDebugEvent({
          scope: "node",
          event: "createSibling",
          nodeId: nextNodeId,
          payload: { after: currentNodeId, where, parentId, surface },
          result: "ok"
        });
        return true;
      }

      function insertOptimisticChild(parentNodeId, childNodeId, surface) {
        if (!canOperateOnVisibleNode(parentNodeId)) return false;
        const map = thoughtforgeState.map;
        const parent = map?.nodesById?.[parentNodeId];
        if (!map || !parent || map.nodesById?.[childNodeId]) {
          traceDebugEvent({
            scope: "node",
            event: "createChild",
            nodeId: childNodeId,
            payload: { parentNodeId, surface },
            result: "failed",
            reason: "invalid optimistic child target"
          });
          return false;
        }
        const children = childrenForParent(parentNodeId);
        const nextIndex = children.length;
        map.nodesById[childNodeId] = {
          id: childNodeId,
          text: "",
          children: []
        };
        insertNodeIdAtIndex(children, childNodeId, nextIndex);
        rememberOptimisticNode({
          nodeId: childNodeId,
          parentId: parentNodeId,
          index: nextIndex,
          previousSiblingCount: children.length - 1,
          createdBy: "tab",
          dependsOnNodeId: thoughtforgeState.pendingOptimisticNodes.has(parentNodeId)
            ? parentNodeId
            : undefined,
          commandPosted: false,
          surface,
          createdAt: performance.now()
        });
        revealNodeAncestors(childNodeId);
        renderThoughtForgeMap();
        focusDirectRenameInputImmediately(childNodeId, surface);
        recordImeDebugTrace("optimistic-child-created", { parentNodeId, childNodeId, surface });
        traceDebugEvent({
          scope: "node",
          event: "createChild",
          nodeId: childNodeId,
          payload: { parentNodeId, surface },
          result: "ok"
        });
        return true;
      }

      function fallbackSelectionAfterDraftDelete(nodeId) {
        const parentId = parentIdForNode(nodeId);
        if (parentId) {
          return parentId;
        }
        const roots = Array.isArray(thoughtforgeState.map?.roots) ? thoughtforgeState.map.roots : [];
        const rootIndex = roots.indexOf(nodeId);
        return roots[rootIndex - 1] ?? roots[rootIndex + 1] ?? undefined;
      }

      function deleteEmptyDraftNode(nodeId) {
        if (!isDraftLikeEmptyNode(nodeId) || nodeText(nodeId) !== "") {
          return false;
        }
        const optimisticMeta = thoughtforgeState.pendingOptimisticNodes.get(nodeId);
        if (nodeHasChildren(nodeId) || hasDependents(nodeId)) return false;
        if (directEditSessionFor(nodeId)) {
          finishDirectEditSession();
        }
        clearDraftNode(nodeId);
        removeOptimisticNodeFromMap(thoughtforgeState.map, nodeId, optimisticMeta?.parentId ?? parentIdForNode(nodeId) ?? null);
        thoughtforgeState.pendingFocusNodeId = undefined;
        thoughtforgeState.pendingFocusTarget = undefined;
        thoughtforgeState.pendingFocusSurface = undefined;
        thoughtforgeState.pendingEditingRefocusNodeId = undefined;
        thoughtforgeState.directKeyQueue = [];
        thoughtforgeState.editingNodeId = undefined;
        thoughtforgeState.editingSurface = undefined;
        thoughtforgeState.selectedNodeId = fallbackSelectionAfterDraftDelete(nodeId);
        if (!optimisticMeta) {
          postThoughtForgeCommand({
            type: "node.delete",
            nodeId
          });
        }
        renderThoughtForgeMap();
        return true;
      }

      function syncSelectedNodeWithMap(map) {
        if (concentrationView && !thoughtforgeState.selectedNodeId) return;
        const nodesById = map?.nodesById ?? {};
        if (hostPolicy?.keepSelectionEmpty?.()) { if (renameInput) renameInput.value = ""; return; }
        if (thoughtforgeState.pendingFocusNodeId) {
          return;
        }
        if (map && isMapTitleRootSelected()) {
          if (renameInput) {
            renameInput.value = mapTitleRootText();
          }
          return;
        }
        if (
          thoughtforgeState.selectedNodeId &&
          nodesById[thoughtforgeState.selectedNodeId] &&
          isNodeInFocusSubtree(thoughtforgeState.selectedNodeId)
        ) {
          if (thoughtforgeState.editingNodeId && !nodesById[thoughtforgeState.editingNodeId]) {
            thoughtforgeState.editingNodeId = undefined;
            thoughtforgeState.editingSurface = undefined;
          }
          if (renameInput) {
            renameInput.value = nodeText(thoughtforgeState.selectedNodeId);
          }
          return;
        }

        thoughtforgeState.selectedNodeId = firstSelectableNodeId(map);
        thoughtforgeState.editingNodeId = undefined;
        thoughtforgeState.editingSurface = undefined;
        if (renameInput) {
          renameInput.value = thoughtforgeState.selectedNodeId
            ? nodeText(thoughtforgeState.selectedNodeId)
            : "";
        }
      }

      function toggleNodeCollapse(nodeId) {
        if (!nodeHasChildren(nodeId)) {
          return;
        }

        if (isNodeCollapsed(nodeId)) {
          thoughtforgeState.collapsedNodeIds.delete(nodeId);
          thoughtforgeState.filterFoldedNodeIds.delete(nodeId);
        } else {
          thoughtforgeState.collapsedNodeIds.add(nodeId);
          if (concentrationView) {
            thoughtforgeState.temporaryExpandedNodeIds.delete(nodeId);
            thoughtforgeState.filterFoldedNodeIds.add(nodeId);
          }
          if (
            !concentrationView && thoughtforgeState.selectedNodeId &&
            isDescendantOf(thoughtforgeState.selectedNodeId, nodeId)
          ) {
            thoughtforgeState.selectedNodeId = nodeId;
            if (renameInput) {
              renameInput.value = nodeText(nodeId);
            }
          }
        }
        renderThoughtForgeBranch(nodeId);
      }

      function renderThoughtForgeBranch(nodeId, searchPrepared = false) {
        const map = thoughtforgeState.map;
        const row = selectedNodeElementForSurface(nodeId, "map");
        const node = map?.nodesById?.[nodeId];
        if (!node || !row || isMapTitleRootNodeId(nodeId) ||
            thoughtforgeState.pendingFocusNodeId || thoughtforgeState.pendingEditingRefocusNodeId) {
          renderThoughtForgeMap(searchPrepared);
          return;
        }
        const previousParent = renderParentIdIndex;
        const previousNodes = renderNodeIndex;
        renderParentIdIndex = createRenderParentIdIndex(map);
        try {
          renderNodeIndex = createRenderNodeIndex(map);
          const collapsed = isNodeCollapsed(nodeId);
          const activeInput = document.activeElement;
          const selection = window.getSelection?.();
          if (isImeCap(activeInput)) {
            activeInput.blur();
            if (selectionBeforeCapFocus?.startContainer.isConnected) {
              selection?.removeAllRanges();
              selection?.addRange(selectionBeforeCapFocus);
            }
          } else if (!isTextEditingTarget(activeInput) && selection?.isCollapsed && mindMapElement.contains(selection.anchorNode)) {
            selection.collapse(mindMapElement, 0);
          }
          const branch = row.parentElement;
          const column = branch.querySelector(":scope > .thoughtforge-map-column");
          branch.dataset.hasVisibleChildren = collapsed ? "false" : "true";
          row.dataset.collapsed = collapsed ? "true" : "false";
          row.querySelector(".thoughtforge-map-branch-toggle")?.replaceWith(
            createMapBranchToggle(nodeId, collapsed ? hiddenDescendantCount(nodeId) : 0)
          );
          if (collapsed) column?.remove();
          else if (!column) branch.appendChild(renderMapColumn(node.children, nodeId, branch.dataset.side));
          const item = outlineElement?.querySelector("li[data-node-id='" + CSS.escape(nodeId) + "']");
          if (item) {
            item.dataset.collapsed = collapsed ? "true" : "false";
            item.querySelector(":scope > .thoughtforge-node-row > .thoughtforge-collapse-toggle")?.replaceWith(createCollapseToggle(nodeId));
            const children = item.querySelector(":scope > .thoughtforge-outline-children");
            if (children) children.dataset.collapsed = collapsed ? "true" : "false";
          }
          clearMapColumnBoundsCache();
        } finally {
          renderParentIdIndex = previousParent;
          renderNodeIndex = previousNodes;
        }
        if (concentrationView && !canOperateOnVisibleNode()) focusVisibleSelection();
        else renderThoughtForgeSelection(searchPrepared);
      }

      function createCollapseToggle(nodeId) {
        const hasChildren = nodeHasChildren(nodeId);
        const isCollapsed = isNodeCollapsed(nodeId);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "thoughtforge-collapse-toggle";
        toggle.dataset.thoughtforgeCollapseToggle = "true";
        toggle.dataset.nodeId = nodeId;
        toggle.dataset.hasChildren = hasChildren ? "true" : "false";
        toggle.dataset.collapsed = isCollapsed ? "true" : "false";
        toggle.setAttribute("aria-label", isCollapsed ? "Expand node" : "Collapse node");
        toggle.setAttribute("aria-expanded", hasChildren && !isCollapsed ? "true" : "false");
        toggle.title = isCollapsed ? "子ノードを展開" : "子ノードを折りたたむ";
        toggle.textContent = hasChildren ? (isCollapsed ? ">" : "v") : "";
        toggle.disabled = !hasChildren;
        listen(toggle, "click", (event) => {
          event.stopPropagation();
          localMapCommand('map-toggle-collapse', () => toggleNodeCollapse(nodeId), {nodeId});
        });
        return toggle;
      }

      function createMapBranchToggle(nodeId, hiddenCount) {
        const isCollapsed = isNodeCollapsed(nodeId);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "thoughtforge-map-branch-toggle";
        button.dataset.thoughtforgeMapBranchToggle = "true";
        button.dataset.collapsed = isCollapsed ? "true" : "false";
        button.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
        button.setAttribute("aria-label", shownTitle(nodeId) + (isCollapsed ? " を展開" : " を折りたたむ"));
        button.title = isCollapsed ? hiddenCount + "件を表示" : "子ノードを折りたたむ";
        button.textContent = isCollapsed ? "+" : "-";
        listen(button, "pointerdown", (event) => event.stopPropagation());
        listen(button, "click", (event) => {
          event.preventDefault(); event.stopPropagation();
          localMapCommand('map-toggle-collapse', () => toggleNodeCollapse(nodeId), {nodeId});
        });
        return button;
      }

      function startMapNodeDrag(event, nodeId, nodeElement) {
        thoughtforgeState.draggedMapNodeId = nodeId;
        thoughtforgeState.dragOverMapNodeId = undefined;
        cacheMapColumnBoundsForDrag();
        thoughtforgeState.selectedNodeId = nodeId;
        if (renameInput) {
          renameInput.value = nodeText(nodeId);
        }
        nodeElement.dataset.dragging = "true";
        event.dataTransfer?.setData(THOUGHTFORGE_MAP_DRAG_MIME, nodeId);
        event.dataTransfer?.setData("text/plain", nodeId);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      }

      function mapNodeElementForId(nodeId) {
        return Array.from(document.querySelectorAll(".thoughtforge-map-node")).find(
          (element) => element instanceof HTMLElement && element.dataset.nodeId === nodeId
        );
      }

      function mapNodeIdFromPoint(clientX, clientY) {
        const element = document.elementFromPoint(clientX, clientY);
        if (!(element instanceof Element)) {
          return undefined;
        }

        const nodeElement = element.closest(".thoughtforge-map-node");
        return nodeElement instanceof HTMLElement ? nodeElement.dataset.nodeId : undefined;
      }

      function mapColumnElementFromPoint(clientX, clientY) {
        const element = document.elementFromPoint(clientX, clientY);
        if (!(element instanceof Element)) {
          return undefined;
        }
        const columnElement = element.closest(".thoughtforge-map-column");
        return columnElement instanceof HTMLElement ? columnElement : undefined;
      }

      function collectMapColumnBounds() {
        const columnBounds = [];
        for (const columnElement of document.querySelectorAll(".thoughtforge-map-column")) {
          if (!(columnElement instanceof HTMLElement)) {
            continue;
          }
          const nodeElements = Array.from(columnElement.querySelectorAll(":scope > .thoughtforge-map-branch > .thoughtforge-map-node"))
            .filter((element) => element instanceof HTMLElement);
          if (nodeElements.length === 0) {
            continue;
          }
          const boundsList = nodeElements.map((element) => element.getBoundingClientRect());
          const left = Math.min(...boundsList.map((bounds) => bounds.left));
          const right = Math.max(...boundsList.map((bounds) => bounds.right));
          const top = Math.min(...boundsList.map((bounds) => bounds.top));
          const bottom = Math.max(...boundsList.map((bounds) => bounds.bottom));
          columnBounds.push({ columnElement, left, right, top, bottom });
        }
        return columnBounds;
      }

      function cacheMapColumnBoundsForDrag() {
        thoughtforgeState.mapColumnBoundsCache = collectMapColumnBounds();
        return thoughtforgeState.mapColumnBoundsCache;
      }

      function clearMapColumnBoundsCache() {
        thoughtforgeState.mapColumnBoundsCache = undefined;
      }

      function mapColumnElementNearPoint(clientX, clientY) {
        let bestMatch;
        const columnBounds = thoughtforgeState.mapColumnBoundsCache ?? collectMapColumnBounds();
        for (const bounds of columnBounds) {
          const { columnElement, left, right, top, bottom } = bounds;
          const horizontalSlack = 18;
          const verticalSlack = 34;
          if (
            clientX < left - horizontalSlack ||
            clientX > right + horizontalSlack ||
            clientY < top - verticalSlack ||
            clientY > bottom + verticalSlack
          ) {
            continue;
          }
          const horizontalDistance = clientX < left ? left - clientX : clientX > right ? clientX - right : 0;
          const verticalDistance = clientY < top ? top - clientY : clientY > bottom ? clientY - bottom : 0;
          const score = horizontalDistance * 2 + verticalDistance + (right - left) * 0.001;
          if (!bestMatch || score < bestMatch.score) {
            bestMatch = { columnElement, score };
          }
        }
        return bestMatch?.columnElement;
      }

      function mapDropTargetFromPoint(clientX, clientY) {
        const targetId = mapNodeIdFromPoint(clientX, clientY);
        const targetElement = targetId ? mapNodeElementForId(targetId) : undefined;
        if (targetId && targetElement instanceof HTMLElement) {
          return { type: "node", targetId, targetElement };
        }
        const columnElement = mapColumnElementFromPoint(clientX, clientY) ?? mapColumnElementNearPoint(clientX, clientY);
        if (columnElement instanceof HTMLElement) {
          return {
            type: "column",
            parentId: columnElement.dataset.parentId || null,
            targetElement: columnElement
          };
        }
        return undefined;
      }

      function updatePointerMapDragTarget(event, draggedNodeId) {
        const target = mapDropTargetFromPoint(event.clientX, event.clientY);
        resetMapDropIndicators();
        if (!target) {
          return undefined;
        }
        if (target.type === "node") {
          const dropIntent = resolveMapDropIntent(event, draggedNodeId, target.targetId, target.targetElement);
          target.targetElement.dataset.dragTarget = dropIntent ? "true" : "false";
          target.targetElement.dataset.dropDisabled = dropIntent ? "false" : "true";
          target.targetElement.dataset.dropPosition = dropIntent?.position ?? "";
          thoughtforgeState.dragOverMapNodeId = dropIntent ? target.targetId : undefined;
          thoughtforgeState.dragOverMapDropPosition = dropIntent?.position;
          thoughtforgeState.dragOverMapColumnParentId = undefined;
          thoughtforgeState.dragOverMapColumnRawIndex = undefined;
          return dropIntent ? { target, dropIntent } : undefined;
        }
        const dropIntent = resolveMapColumnDropIntent(event, draggedNodeId, target.parentId, target.targetElement);
        thoughtforgeState.dragOverMapNodeId = undefined;
        thoughtforgeState.dragOverMapDropPosition = dropIntent ? "between" : undefined;
        thoughtforgeState.dragOverMapColumnParentId = dropIntent ? target.parentId : undefined;
        thoughtforgeState.dragOverMapColumnRawIndex = dropIntent ? dropIntent.rawIndex : undefined;
        thoughtforgeState.dragOverMapColumnSide = dropIntent ? target.targetElement.dataset.side : undefined;
        if (dropIntent) {
          setMapColumnDropMarker(target.targetElement, dropIntent.rawIndex);
        }
        return dropIntent ? { target, dropIntent } : undefined;
      }

      function moveDraggedMapNodeWithPointTarget(event, nodeId) {
        const resolved = updatePointerMapDragTarget(event, nodeId);
        if (!resolved) {
          return false;
        }
        if (resolved.target.type === "node") {
          return moveDraggedMapNodeWithIntent(nodeId, resolved.target.targetId, resolved.dropIntent);
        }
        if (resolved.dropIntent.type === "sibling-column") {
          applyOptimisticMove(nodeId, resolved.dropIntent.nextParentId, resolved.dropIntent.nextIndex);
          postThoughtForgeCommand({
            type: "node.move",
            nodeId,
            nextParentId: resolved.dropIntent.nextParentId,
            nextIndex: resolved.dropIntent.nextIndex
          });
          return true;
        }
        return false;
      }

      function createMapDragHandle(nodeId, nodeElement) {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "thoughtforge-map-drag-handle";
        handle.dataset.thoughtforgeMapDragHandle = "true";
        handle.dataset.nodeId = nodeId;
        handle.setAttribute("aria-label", "ノードをドラッグして移動");
        listen(handle, "pointerdown", (event) => {
          event.stopPropagation();
          startMapNodePointerDrag(event, nodeId, nodeElement);
        });
        return handle;
      }

      function isMapNodePointerDragActivationTarget(event, nodeElement) {
        if (event.button !== 0 || event.isPrimary === false) {
          return false;
        }
        const target = event.target;
        const targetElement =
          target instanceof Element
            ? target
            : target instanceof Text && target.parentElement
              ? target.parentElement
              : undefined;
        if (!targetElement || !nodeElement.contains(targetElement)) {
          return false;
        }
        const dedicatedDragHandle = targetElement.closest(".thoughtforge-map-drag-handle");
        if (dedicatedDragHandle) {
          return true;
        }
        if (isNodeTextEditingActive()) {
          return false;
        }
        if (targetElement.closest("form, input, textarea, select, [contenteditable='true'], [contenteditable='']")) {
          return false;
        }
        const interactiveControl = targetElement.closest("a, button, [role='button']");
        return !interactiveControl || interactiveControl.matches(".thoughtforge-node, .thoughtforge-map-drag-handle");
      }

      function mapPointerCaptureElement(event, nodeElement) {
        const target = event.target;
        if (target instanceof HTMLElement) {
          return target;
        }
        if (target instanceof Text && target.parentElement instanceof HTMLElement) {
          return target.parentElement;
        }
        return event.currentTarget instanceof HTMLElement ? event.currentTarget : nodeElement;
      }

      function armPostDragClickSuppression(nodeId) {
        pendingTitleClick = undefined;
        thoughtforgeState.suppressedMapNodeActivation = { nodeId, until: performance.now() + 500 };
      }

      function suppressPostDragNodeActivation(event, nodeId) {
        const suppression = thoughtforgeState.suppressedMapNodeActivation;
        if (!suppression) {
          return false;
        }
        if (!Number.isFinite(suppression.until) || performance.now() > suppression.until) {
          thoughtforgeState.suppressedMapNodeActivation = undefined;
          return false;
        }
        if (suppression.nodeId !== nodeId) {
          return false;
        }
        thoughtforgeState.suppressedMapNodeActivation = undefined;
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }

      function createMapDragPreview(nodeId, nodeElement, clientX, clientY) {
        const b = nodeElement.getBoundingClientRect();
        const p = document.createElement("div");
        p.className = "thoughtforge-map-drag-preview";
        p.dataset.nodeId = nodeId;
        p.setAttribute("aria-hidden", "true");
        p.style.setProperty("--tf-dpw", b.width.toFixed(1) + "px");
        const grabX = Math.min(Math.max(clientX - b.left, 14), Math.max(b.width - 14, 14));
        const grabY = Math.min(Math.max(clientY - b.top, 14), Math.max(b.height - 14, 14));
        p.style.setProperty("--tf-dgx", grabX.toFixed(1) + "px");
        p.style.setProperty("--tf-dgy", grabY.toFixed(1) + "px");
        renderMarkdownNodeTitle(p, shownTitle(nodeId));
        document.body.appendChild(p);
        return { element: p, grabX, grabY };
      }

      function removeMapDragPreview(previewState) {
        previewState?.element?.remove?.();
      }

      function updateMapDragLift(clientX, clientY, previewState) {
        if (previewState?.element instanceof HTMLElement) {
          previewState.element.style.setProperty("--tf-dpx", (clientX - previewState.grabX).toFixed(1) + "px");
          previewState.element.style.setProperty("--tf-dpy", (clientY - previewState.grabY).toFixed(1) + "px");
        }
      }

      function startMapNodePointerDrag(event, nodeId, nodeElement) {
        let pointerCaptureElement = mapPointerCaptureElement(event, nodeElement);
        const isDedicatedDragHandle = pointerCaptureElement.matches(".thoughtforge-map-drag-handle");
        if (
          event.button !== 0 ||
          event.isPrimary === false ||
          (isNodeTextEditingActive() && !isDedicatedDragHandle) ||
          thoughtforgeState.activeMapPointerDragId !== undefined
        ) {
          return;
        }

        const startX = event.clientX;
        const startY = event.clientY;
        const dragHandle = isDedicatedDragHandle
          ? pointerCaptureElement
          : nodeElement.querySelector(".thoughtforge-map-drag-handle");
        let isDragging = false;
        let isCleanedUp = false;
        let lx = startX;
        let ly = startY;
        let autoScrollFrame;
        let dragPreviewState;
        thoughtforgeState.activeMapPointerDragId = event.pointerId;
        pointerCaptureElement.setPointerCapture?.(event.pointerId);

        const scheduleMapDragAutoScroll = () => {
          if (autoScrollFrame !== undefined) {
            return;
          }
          autoScrollFrame = requestAnimationFrame(() => {
            autoScrollFrame = undefined;
            if (!isDragging) {
              return;
            }
            const c = document.querySelector(".thoughtforge-map");
            if (!(c instanceof HTMLElement)) {
              return;
            }
            const b = c.getBoundingClientRect();
            const edge = 72, step = 28;
            const left = ((Math.max(0, edge - (b.right - lx)) - Math.max(0, edge - (lx - b.left))) / edge) * step;
            const top = ((Math.max(0, edge - (b.bottom - ly)) - Math.max(0, edge - (ly - b.top))) / edge) * step;
            if (Math.abs(left) < 0.5 && Math.abs(top) < 0.5) {
              return;
            }
            c.scrollBy({ left, top });
            cacheMapColumnBoundsForDrag();
            updateMapDragLift(lx, ly, dragPreviewState);
            updatePointerMapDragTarget({ clientX: lx, clientY: ly }, nodeId);
            scheduleMapDragAutoScroll();
          });
        };

        const stopMapDragAutoScroll = () => {
          if (autoScrollFrame !== undefined) {
            cancelAnimationFrame(autoScrollFrame);
            autoScrollFrame = undefined;
          }
        };

        const beginPointerDrag = (moveEvent) => {
          if (isDragging) {
            return;
          }
          const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (distance < 4) {
            return;
          }
          isDragging = true;
          if (!isDedicatedDragHandle && nodeElement.isConnected) { unlisten(pointerCaptureElement, "lostpointercapture", cancelPointerDrag); pointerCaptureElement = nodeElement; listen(pointerCaptureElement, "lostpointercapture", cancelPointerDrag); pointerCaptureElement.setPointerCapture?.(event.pointerId); }
          moveEvent.preventDefault();
          lx = moveEvent.clientX;
          ly = moveEvent.clientY;
          thoughtforgeState.draggedMapNodeId = nodeId;
          thoughtforgeState.dragOverMapNodeId = undefined;
          cacheMapColumnBoundsForDrag();
          thoughtforgeState.selectedNodeId = nodeId;
          thoughtforgeState.editingNodeId = undefined;
          thoughtforgeState.editingSurface = undefined;
          if (renameInput) {
            renameInput.value = nodeText(nodeId);
          }
          nodeElement.dataset.dragging = "true";
          if (dragHandle) {
            dragHandle.dataset.dragging = "true";
          }
          dragPreviewState = createMapDragPreview(nodeId, nodeElement, moveEvent.clientX, moveEvent.clientY);
          updateMapDragLift(moveEvent.clientX, moveEvent.clientY, dragPreviewState);
        };

        const handlePointerMove = (moveEvent) => {
          if (moveEvent.pointerId !== event.pointerId) {
            return;
          }
          beginPointerDrag(moveEvent);
          if (!isDragging) {
            return;
          }
          moveEvent.preventDefault();
          lx = moveEvent.clientX;
          ly = moveEvent.clientY;
          updateMapDragLift(moveEvent.clientX, moveEvent.clientY, dragPreviewState);
          updatePointerMapDragTarget(moveEvent, nodeId);
          scheduleMapDragAutoScroll();
        };

        const cleanupPointerDrag = () => {
          cleanup.delete(cleanupPointerDrag);
          const wasDragging = isDragging;
          if (isCleanedUp) {
            return false;
          }
          isCleanedUp = true;
          unlisten(document, "pointermove", handlePointerMove);
          unlisten(document, "pointerup", finishPointerDrag);
          unlisten(document, "pointercancel", cancelPointerDrag);
          unlisten(pointerCaptureElement, "lostpointercapture", cancelPointerDrag);
          unlisten(window, "blur", cancelPointerDrag);
          stopMapDragAutoScroll();
          if (pointerCaptureElement.hasPointerCapture?.(event.pointerId)) {
            pointerCaptureElement.releasePointerCapture?.(event.pointerId);
          }
          if (dragHandle) {
            dragHandle.dataset.dragging = "false";
          }
          removeMapDragPreview(dragPreviewState);
          resetMapDragState();
          if (thoughtforgeState.activeMapPointerDragId === event.pointerId) {
            thoughtforgeState.activeMapPointerDragId = undefined;
          }
          return wasDragging;
        };

        const finishPointerDrag = (upEvent) => {
          if (upEvent.pointerId !== event.pointerId) {
            return;
          }
          const wasDragging = cleanupPointerDrag();
          if (!wasDragging) {
            return;
          }
          upEvent.preventDefault();
          armPostDragClickSuppression(nodeId);
          moveDraggedMapNodeWithPointTarget(upEvent, nodeId);
        };

        const cancelPointerDrag = (cancelEvent) => {
          if (cancelEvent?.type === "lostpointercapture" && cancelEvent.target !== pointerCaptureElement) return;
          if (typeof cancelEvent?.pointerId === "number" && cancelEvent.pointerId !== event.pointerId) {
            return;
          }
          cleanupPointerDrag();
        };

        own(cleanupPointerDrag);
        listen(document, "pointermove", handlePointerMove);
        listen(document, "pointerup", finishPointerDrag);
        listen(document, "pointercancel", cancelPointerDrag);
        listen(pointerCaptureElement, "lostpointercapture", cancelPointerDrag);
        listen(window, "blur", cancelPointerDrag);
      }

      function optimisticNodeIdForCommand(command) {
        if (command?.type === "node.insertSibling" || command?.type === "node.insertChild") {
          return command.nodeId;
        }
        if (
          command?.type === "node.renameAndInsertSibling" ||
          command?.type === "node.renameAndInsertChild"
        ) {
          return command.nextNodeId;
        }
        return undefined;
      }

      function commandNodeId(command) {
        return typeof command?.nodeId === "string" ? command.nodeId : undefined;
      }

      function createCommandRequestTransaction(command) {
        const optimisticNodeId = optimisticNodeIdForCommand(command);
        const optimisticNodeMeta = optimisticNodeId
          ? thoughtforgeState.pendingOptimisticNodes.get(optimisticNodeId)
          : undefined;
        const directNodeId = optimisticNodeId ?? commandNodeId(command);
        const pendingMoveSelection =
          command?.type === "node.move" &&
          thoughtforgeState.pendingMoveSelection?.nodeId === command.nodeId
            ? thoughtforgeState.pendingMoveSelection
            : undefined;
        const activeFocusRetryToken =
          optimisticNodeId &&
          thoughtforgeState.activeFocusRetryToken?.nodeId === optimisticNodeId
            ? thoughtforgeState.activeFocusRetryToken
            : undefined;
        return {
          commandType: command?.type,
          commandNodeId: commandNodeId(command),
          optimisticNodeId,
          optimisticNodeMeta,
          directEditSession: directNodeId ? directEditSessionFor(directNodeId) : undefined,
          pendingFocusTarget: optimisticNodeId ? thoughtforgeState.pendingFocusTarget : undefined,
          activeFocusRetryToken,
          pendingMoveSelection
        };
      }

      function commandRequestOwnsRollbackState(transaction) {
        return Boolean(
          (transaction.directEditSession &&
            thoughtforgeState.directEditSession === transaction.directEditSession) ||
          (transaction.optimisticNodeId &&
            transaction.optimisticNodeMeta &&
            thoughtforgeState.pendingOptimisticNodes.get(transaction.optimisticNodeId) ===
              transaction.optimisticNodeMeta) ||
          (transaction.pendingMoveSelection &&
            thoughtforgeState.pendingMoveSelection === transaction.pendingMoveSelection)
        );
      }

      function pruneSettledCommandRequests() {
        for (const [requestId, transaction] of thoughtforgeState.pendingCommandRequests) {
          if (!commandRequestOwnsRollbackState(transaction)) {
            thoughtforgeState.pendingCommandRequests.delete(requestId);
          }
        }
      }

      function scheduleCommandRequestRetention(requestId, transaction) {
        setTimeout(() => {
          if (thoughtforgeState.pendingCommandRequests.get(requestId) !== transaction) {
            return;
          }
          if (!commandRequestOwnsRollbackState(transaction)) {
            thoughtforgeState.pendingCommandRequests.delete(requestId);
          }
        }, COMMAND_REQUEST_RETENTION_MS);
      }

      function rememberCommandRequest(requestId, transaction) {
        thoughtforgeState.pendingCommandRequests.set(requestId, transaction);
        scheduleCommandRequestRetention(requestId, transaction);
      }

      function rememberCancelledCommandNode(nodeId) {
        const token = {};
        thoughtforgeState.cancelledCommandNodeIds.add(nodeId);
        thoughtforgeState.cancelledCommandNodeTokens.set(nodeId, token);
        setTimeout(() => {
          if (thoughtforgeState.cancelledCommandNodeTokens.get(nodeId) === token) {
            forgetCancelledCommandNode(nodeId);
          }
        }, CANCELLED_COMMAND_NODE_RETENTION_MS);
      }

      function forgetCancelledCommandNode(nodeId) {
        thoughtforgeState.cancelledCommandNodeIds.delete(nodeId);
        thoughtforgeState.cancelledCommandNodeTokens.delete(nodeId);
      }

      function releaseCancelledCommandNodeAfterEvent(nodeId) {
        const token = thoughtforgeState.cancelledCommandNodeTokens.get(nodeId);
        if (!token) {
          return;
        }
        setTimeout(() => {
          if (thoughtforgeState.cancelledCommandNodeTokens.get(nodeId) === token) {
            forgetCancelledCommandNode(nodeId);
          }
        }, CANCELLED_COMMAND_NODE_EVENT_GRACE_MS);
      }

      function rollbackThoughtForgeCommandRequest(requestId) {
        const transaction = thoughtforgeState.pendingCommandRequests.get(requestId);
        if (!transaction) {
          return false;
        }
        thoughtforgeState.pendingCommandRequests.delete(requestId);
        let changed = false;

        if (
          transaction.directEditSession &&
          thoughtforgeState.directEditSession === transaction.directEditSession
        ) {
          thoughtforgeState.isComposingText = false;
          thoughtforgeState.deferredModelUpdate = undefined;
          finishDirectEditSession();
          if (thoughtforgeState.editingNodeId === transaction.directEditSession.nodeId) {
            thoughtforgeState.editingNodeId = undefined;
            thoughtforgeState.editingSurface = undefined;
          }
          changed = true;
        }

        const optimisticNodeId = transaction.optimisticNodeId;
        if (
          optimisticNodeId &&
          transaction.optimisticNodeMeta &&
          thoughtforgeState.pendingOptimisticNodes.get(optimisticNodeId) ===
            transaction.optimisticNodeMeta
        ) {
          const fallbackNodeId = fallbackSelectionAfterDraftDelete(optimisticNodeId);
          rememberCancelledCommandNode(optimisticNodeId);
          if (
            transaction.activeFocusRetryToken &&
            thoughtforgeState.activeFocusRetryToken === transaction.activeFocusRetryToken
          ) {
            cancelDirectRenameFocusRetry();
          }
          if (thoughtforgeState.directEditSession?.nodeId === optimisticNodeId) {
            thoughtforgeState.isComposingText = false;
            thoughtforgeState.deferredModelUpdate = undefined;
            finishDirectEditSession();
          }
          clearDraftNode(optimisticNodeId);
          removeOptimisticNodeFromMap(
            thoughtforgeState.map,
            optimisticNodeId,
            transaction.optimisticNodeMeta.parentId ?? null
          );
          if (thoughtforgeState.selectedNodeId === optimisticNodeId) {
            thoughtforgeState.selectedNodeId = fallbackNodeId;
          }
          if (thoughtforgeState.editingNodeId === optimisticNodeId) {
            thoughtforgeState.editingNodeId = undefined;
            thoughtforgeState.editingSurface = undefined;
          }
          if (thoughtforgeState.pendingFocusNodeId === optimisticNodeId) {
            thoughtforgeState.pendingFocusNodeId = undefined;
            thoughtforgeState.pendingFocusSurface = undefined;
          }
          if (thoughtforgeState.pendingEditingRefocusNodeId === optimisticNodeId) {
            thoughtforgeState.pendingEditingRefocusNodeId = undefined;
            thoughtforgeState.pendingFocusSurface = undefined;
          }
          if (thoughtforgeState.pendingFocusTarget === transaction.pendingFocusTarget) {
            thoughtforgeState.pendingFocusTarget = undefined;
          }
          clearPendingDirectEditKeys(optimisticNodeId);
          changed = true;
        }

        if (
          transaction.pendingMoveSelection &&
          thoughtforgeState.pendingMoveSelection === transaction.pendingMoveSelection
        ) {
          const pendingMove = transaction.pendingMoveSelection;
          thoughtforgeState.pendingMoveSelection = undefined;
          if (
            moveNodeIdInMap(
              thoughtforgeState.map,
              pendingMove.nodeId,
              pendingMove.previousParentId,
              pendingMove.previousIndex
            )
          ) {
            selectMovedMapNodeAfterDrop(pendingMove.nodeId);
          }
          changed = true;
        }

        if (changed) {
          renderThoughtForgeMap();
        }
        return true;
      }

      function nextThoughtForgeCommandRequestId() {
        thoughtforgeState.commandRequestCounter += 1;
        return (
          "command-" +
          Date.now().toString(36) +
          "-" +
          thoughtforgeState.commandRequestCounter.toString(36)
        );
      }

      function isThoughtForgeCommandResultReason(value) {
        return (
          value === "validation-failed" ||
          value === "apply-rejected" ||
          value === "unexpected-error"
        );
      }

      function registerRenameRequest(command) {
        const requestId = nextThoughtForgeCommandRequestId();
        thoughtforgeState.pendingRenames.set(requestId, { nodeId: command.nodeId, title: command.nextText, ordinal: thoughtforgeState.commandRequestCounter, phase: "queued" });
        return requestId;
      }

      function finishRenameRequest(requestId, saved = false) {
        const record = thoughtforgeState.pendingRenames.get(requestId);
        if (!record) return;
        for (const [id, other] of thoughtforgeState.pendingRenames) {
          if (id === requestId || saved && other.nodeId === record.nodeId && other.ordinal < record.ordinal) thoughtforgeState.pendingRenames.delete(id);
        }
        return record.nodeId;
      }

      // Read every target from the same projection snapshot, including inline
      // flushes. An absent/retired key is never re-created by reconciliation.
      function rebindRenameTargets(ids, keep = () => true, targets = new Map([...thoughtforgeState.pendingRenames].map(([id, record]) => [id, record.nodeId]))) {
        const counts = new Map();
        for (const id of Object.values(ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
        for (const [requestId, old] of targets) {
          const record = thoughtforgeState.pendingRenames.get(requestId);
          if (!record) continue;
          const next = ids[old];
          if (next && counts.get(next) === 1) record.nodeId = next;
          else if (next || !keep(old)) finishRenameRequest(requestId);
        }
      }

      function postThoughtForgeCommand(command, requestId) {
        const target = command.type === 'node.insertChild' || command.type === 'node.insertSubtree' ? command.parentId : command.type === 'node.insertSibling' ? command.siblingId : command.nodeId;
        if (!/^node\\.rename/.test(command.type) && !canOperateOnVisibleNode(target)) return "blocked";
        if (hostPolicy?.inputBlocked?.()) { finishRenameRequest(requestId); return "blocked"; }
        requestId ??= /^node\\.rename/.test(command.type) ? registerRenameRequest(command) : nextThoughtForgeCommandRequestId();
        if (hostPolicy?.orderedIntents) command.intentSeq ??= thoughtforgeState.intentSeq = (thoughtforgeState.intentSeq ?? 0) + 1;
        const pendingNodeId = pendingOptimisticCommandReference(command);
        if (pendingNodeId) {
          queueOptimisticCommand(pendingNodeId, command, requestId);
          return "queued";
        }
        const record = thoughtforgeState.pendingRenames.get(requestId);
        if (record) record.phase = "sent";
        rememberCommandRequest(requestId, createCommandRequestTransaction(command));
        postThoughtForgeWebviewMessage({ type: "thoughtforge.command", requestId, command });
        return "posted";
      }

      function requestSelectedNodeRevealInSource() {
        const node = selectedCopyTarget();
        const range = node?.source?.range;
        if (!node || !hasSourceRange(range)) {
          if (copyStatusElement) {
            copyStatusElement.textContent = "選択中ノードにMarkdownソース位置がありません。";
          }
          return false;
        }
        requestSourceRangeReveal(range, node.id);
        if (copyStatusElement) {
          copyStatusElement.textContent = "Markdown表示を要求しました。";
        }
        return true;
      }

      function setEditControlsEnabled(enabled) {
        const copyEnabled = enabled || Boolean(selectedCopyTarget());
        if (renameInput) {
          renameInput.disabled = !enabled;
        }
        editButtons.forEach((button) => {
          button.disabled = !enabled;
        });
        if (reparentSelect) {
          reparentSelect.disabled = !enabled;
        }
        if (reparentApplyButton) {
          reparentApplyButton.disabled = !enabled;
        }
        if (reparentPickButton) {
          reparentPickButton.disabled = !enabled;
        }
        if (nodeNoteEditor) {
          nodeNoteEditor.disabled = !enabled;
        }
        if (nodeNoteSaveButton) {
          nodeNoteSaveButton.disabled = !enabled;
        }
        if (nodeNoteClearButton) {
          nodeNoteClearButton.disabled = !enabled;
        }
        if (revealSourceButton) {
          revealSourceButton.disabled = !enabled;
        }
        copyButtons.forEach((button) => {
          button.disabled = !copyEnabled;
        });
        copyIssueDraftButtons.forEach((button) => {
          button.disabled = !enabled;
        });
        copyDesignDocButtons.forEach((button) => {
          button.disabled = !enabled;
        });
        copyTestMatrixButtons.forEach((button) => {
          button.disabled = !enabled;
        });
        if (promptTemplateSelect) {
          promptTemplateSelect.disabled = !enabled;
        }
        if (promptPackIncludeNotesCheckbox) {
          promptPackIncludeNotesCheckbox.disabled = !enabled;
        }
        copyPromptTemplateButtons.forEach((button) => {
          button.disabled = !enabled;
        });
        copySvgButtons.forEach((button) => {
          button.disabled = !enabled;
        });
        copyContextButtons.forEach((button) => {
          button.disabled = !copyEnabled;
        });
      }

      function copyCommandControls() {
        return [[copyButtons,'thoughtforgeCopy','markdown',postClipboardWrite],[copyContextButtons,'thoughtforgeCopyContext','context',postClipboardContextWrite],[copyIssueDraftButtons,'thoughtforgeCopyIssue','issue-draft',postClipboardIssueDraftWrite],[copyDesignDocButtons,'thoughtforgeCopyDesign','design-doc',postClipboardDesignDocWrite],[copyTestMatrixButtons,'thoughtforgeCopyTestMatrix','test-matrix',postClipboardTestMatrixWrite],[copyPromptTemplateButtons,'thoughtforgeCopyPromptTemplate','prompt-template',postClipboardPromptTemplateWrite]];
      }

      function updateCommandControls(context = mapCommandContext()) {
        if (!concentrationView || !hostPolicy?.mapCommandGate) return;
        const bind=(elements,id)=>elements.forEach(e=>{const disabled=Boolean(hostPolicy.mapCommandGate(typeof id==='function'?id(e):id,false,context));if(e.disabled!==disabled)e.disabled=disabled;});
        bind([revealSourceButton].filter(Boolean),'map-reveal-source');
        bind(commandButtons,e=>'map-'+localEditCommandIds[e.dataset.thoughtforgeCommand]);
        for(const [elements,data,format] of copyCommandControls()) bind(elements,e=>'map-copy-'+(e.dataset[data]==='subtree'?'subtree':'node')+'-'+format);
        bind(copySvgButtons,'map-copy-visible-svg');
        bind([searchPreviousButton].filter(Boolean),'map-filter-previous');bind([searchNextButton].filter(Boolean),'map-filter-next');bind([searchClearButton].filter(Boolean),'map-filter-clear');
      }

      function selectedNodeElementForSurface(nodeId, surface) {
        const root = surface === "map" ? mindMapElement : outlineElement;
        if (!root || !nodeId) {
          return undefined;
        }
        const escapedNodeId = CSS.escape(nodeId);
        const selector = surface === "map"
          ? ".thoughtforge-map-node[data-node-id='" + escapedNodeId + "']"
          : "button[data-node-id='" + escapedNodeId + "']";
        return root.querySelector(selector);
      }

      function scheduleSelectionCounterpartReveal(nodeId, sourceSurface) {
        const surface = normalizeEditSurface(sourceSurface);
        if (!nodeId || !surface) {
          return;
        }
        thoughtforgeState.pendingSelectionCounterpartReveal = {
          nodeId,
          sourceSurface: surface
        };
      }

      function flushSelectionCounterpartReveal() {
        const pending = thoughtforgeState.pendingSelectionCounterpartReveal;
        thoughtforgeState.pendingSelectionCounterpartReveal = undefined;
        if (!pending) {
          return;
        }
        const targetSurface = pending.sourceSurface === "map" ? "outline" : "map";
        const target = selectedNodeElementForSurface(pending.nodeId, targetSurface);
        if (!target?.scrollIntoView) {
          return;
        }
        const reveal = () => {
          target.scrollIntoView({ block: "center", inline: "nearest" });
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(reveal);
        } else {
          setTimeout(reveal, 0);
        }
      }

      function selectThoughtForgeNode(nodeId, options = {}) {
        if (options.edit === true && !canOperateOnVisibleNode(nodeId)) return;
        if (isMapTitleRootNodeId(nodeId)) {
          selectMapTitleRootNode(options);
          return;
        }
        if (!thoughtforgeState.map?.nodesById?.[nodeId]) {
          return;
        }
        const surface = normalizeEditSurface(options.surface);
        if (surface) {
          thoughtforgeState.preferredEditSurface = surface;
          scheduleSelectionCounterpartReveal(nodeId, surface);
        }
        if (options.reveal !== false) {
          revealNodeAncestors(nodeId);
        }
        thoughtforgeState.selectedNodeId = nodeId;
        if (options.edit !== true) {
          thoughtforgeState.editingNodeId = undefined;
          thoughtforgeState.editingSurface = undefined;
        } else {
          thoughtforgeState.editingNodeId = nodeId;
          thoughtforgeState.editingSurface = surface ?? activeDirectEditSurface();
        }
        if (options.syncSearch !== false) {
          syncActiveSearchMatchWithSelection();
        }
        if (renameInput) {
          renameInput.value = nodeText(nodeId);
        }
        setEditControlsEnabled(true);
        renderThoughtForgeSelection();
        if (options.edit !== true) {
          focusDirectRenameInput(nodeId, { surface: surface ?? activeDirectEditSurface(), force: true });
        }
      }

      // Selection keeps branch/row DOM and pointer owners. Only title controls
      // whose role changes (button / IME cap / editor) may be replaced.
      function prepareMapSelection(map) {
        pruneCollapsedNodeIds(map);
        syncFocusRootWithMap(map);
        syncSelectedNodeWithMap(map);
      }

      function renderThoughtForgeSelection(searchPrepared = false) {
        hostPolicy?.commandContextChanged?.();
        const map = thoughtforgeState.map;
        const requestedId = thoughtforgeState.selectedNodeId;
        if (map) prepareMapSelection(map);
        const selectedId = thoughtforgeState.selectedNodeId;
        if (!map || selectedId !== requestedId ||
            (thoughtforgeState.focusRootNodeId && !isNodeInFocusSubtree(selectedId)) ||
            !selectedNodeElementForSurface(selectedId, "map") ||
            thoughtforgeState.pendingFocusNodeId || thoughtforgeState.pendingEditingRefocusNodeId || isFirstInputMap()) {
          renderThoughtForgeMap(searchPrepared);
          return;
        }
        const previousParent = renderParentIdIndex;
        const previousNodes = renderNodeIndex;
        renderParentIdIndex = createRenderParentIdIndex(map);
        try {
          renderNodeIndex = createRenderNodeIndex(map);
          if (searchPrepared !== true) recomputeSearchMatches();
          const searchMatchNodeIds = new Set(thoughtforgeState.searchMatchNodeIds);
          const activeSearchMatchId = activeSearchNodeId();
          const set = (element, key, value) => {
            const text = value ? "true" : "false";
            if (element.getAttribute(key) !== text) element.setAttribute(key, text);
          };
          for (const [surface, root] of [["map", mindMapElement], ["outline", outlineElement]]) {
            if (!root) continue;
            const rows = root.querySelectorAll(surface === "map" ? ".thoughtforge-map-node" : ".thoughtforge-node-row");
            for (const row of rows) {
              const id = surface === "map" ? row.dataset.nodeId : row.parentElement.dataset.nodeId;
              const titleRoot = isMapTitleRootNodeId(id);
              const selected = selectedId === id;
              const path = titleRoot ? selected : renderNodeIndex.path.has(id);
              const searchMatch = !titleRoot && searchMatchNodeIds.has(id);
              const activeSearchMatch = !titleRoot && activeSearchMatchId === id;
              if (surface === "map") {
                set(row, "data-selected", selected);
                set(row, "data-selected-path", path);
                set(row, "data-dragging", !titleRoot && thoughtforgeState.draggedMapNodeId === id);
                set(row, "data-drag-target", !titleRoot && thoughtforgeState.dragOverMapNodeId === id);
                set(row, "data-drop-disabled", titleRoot || Boolean(thoughtforgeState.draggedMapNodeId && !canDropMapNodeOnTarget(thoughtforgeState.draggedMapNodeId, id)));
                const dropPosition = !titleRoot && thoughtforgeState.dragOverMapNodeId === id ? thoughtforgeState.dragOverMapDropPosition ?? "" : "";
                if (row.getAttribute("data-drop-position") !== dropPosition) row.setAttribute("data-drop-position", dropPosition);
                set(row.parentElement, "data-selected-path", path);
                set(row, "data-search-match", searchMatch);
                set(row, "data-active-search-match", activeSearchMatch);
              }
              const editor = titleRoot ? shouldRenderMapTitleRootEditor(surface) : shouldRenderDirectNodeEditor(id, surface);
              const cap = !titleRoot && shouldImeCap(id, surface);
              let control;
              let handle;
              for (const child of row.children) {
                if (!control && (child.tagName === "FORM" || child.classList.contains("thoughtforge-node"))) control = child;
                if (!handle && child.classList.contains("thoughtforge-map-drag-handle")) handle = child;
              }
              if (!control) continue;
              const isForm = control.tagName === "FORM";
              if ((editor || cap) !== isForm) {
                if (isForm) control.querySelector("input")?.setAttribute("data-suppress-blur-finish", "true");
                const next = editor || cap
                  ? (titleRoot ? renderMapTitleRootTitleEditor(surface) : surface === "map" ? renderMapNodeTitleEditor(id) : renderOutlineNodeTitleEditor(id))
                  : (titleRoot ? createMapTitleRootButton(surface) : createNodeButton(id, "thoughtforge-node"));
                control.replaceWith(next);
                control = next;
              } else if (isForm && !titleRoot) {
                if (editor && control.classList.contains("tf-ime")) promoteImeCap(control.querySelector("input"));
                control.classList.toggle("tf-ime", cap);
              }
              if (surface === "map" && !titleRoot) {
                if (editor && !handle) row.insertBefore(createMapDragHandle(id, row), row.firstChild);
                else if (!editor && handle) handle.remove();
              }
              const button = control.tagName === "BUTTON" ? control : undefined;
              if (!button) continue;
              set(button, "data-selected", selected);
              set(button, "data-search-match", searchMatch);
              set(button, "data-active-search-match", activeSearchMatch);
              set(button, "data-reparent-target", !titleRoot && Boolean(selectedId) && isMeaningfulReparentTarget(selectedId, id));
              const label = (titleRoot ? "マップ全体: " + mapTitleRootText() : shownTitle(id) || NEW_NODE_PLACEHOLDER) + (selected ? "。選択中" : "");
              if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
              const pressed = selected ? "true" : "false";
              if (button.getAttribute("aria-pressed") !== pressed) button.setAttribute("aria-pressed", pressed);
            }
          }
          syncConcentrationAppearance();
          updateSearchControls();
          renderSearchResultsPanel();
          updateReparentControls();
          updateReparentPickControls();
          syncNodeNotePanel();
          renderFocusBreadcrumb(map);
          if (thoughtforgeState.commandPaletteOpen) renderThoughtForgeCommandPalette();
          flushSelectionCounterpartReveal();
        } finally {
          renderParentIdIndex = previousParent;
          renderNodeIndex = previousNodes;
          hostPolicy?.afterRender?.();
        }
      }

      function beginDirectNodeEdit(nodeId, surface) {
        if (concentrationView && hostPolicy?.mapCommandGate && !commandHandling) return dispatchMapCommand('map-edit-title',false,{nodeId,surface});
        if (!canOperateOnVisibleNode(nodeId)) return ;
        selectThoughtForgeNode(nodeId, { edit: true, surface });
        focusDirectRenameInput(nodeId, { surface, force: true, select: true });
        scheduleDirectRenameFocus(nodeId, { surface });
      }

      function selectMapTitleRootNode(options = {}) {
        if (!thoughtforgeState.map) {
          return;
        }
        const surface = normalizeEditSurface(options.surface) ?? activeDirectEditSurface();
        scheduleSelectionCounterpartReveal(THOUGHTFORGE_MAP_TITLE_ROOT_ID, surface);
        thoughtforgeState.selectedNodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        thoughtforgeState.editingNodeId = options.edit === true ? THOUGHTFORGE_MAP_TITLE_ROOT_ID : undefined;
        thoughtforgeState.editingSurface = options.edit === true ? surface : undefined;
        thoughtforgeState.preferredEditSurface = surface;
        thoughtforgeState.isPickingReparentTarget = false;
        if (renameInput) {
          renameInput.value = mapTitleRootText();
        }
        setEditControlsEnabled(false);
        renderThoughtForgeSelection();
        if (options.edit === true) {
          focusDirectRenameInput(THOUGHTFORGE_MAP_TITLE_ROOT_ID, { select: true, surface });
        }
      }

      function titleClickStartsEdit(nodeId, surface) {
        const now = performance.now();
        const edit = pendingTitleClick?.nodeId === nodeId && pendingTitleClick.surface === surface && now - pendingTitleClick.time < 400;
        pendingTitleClick = edit ? undefined : { nodeId, surface, time: now };
        return edit;
      }

      function setPreferredEditSurfaceFromTarget(target) {
        const surface = editSurfaceFromTarget(target);
        thoughtforgeState.preferredEditSurface = surface;
        return thoughtforgeState.preferredEditSurface;
      }

      function editSurfaceFromTarget(target) {
        if (!(target instanceof Element)) {
          return thoughtforgeState.preferredEditSurface;
        }
        if (hostPolicy?.singleClickEditsTitle === false && target.closest("[data-thoughtforge-outline]")) return "outline";
        return "map";
      }

      function normalizeEditSurface(surface) {
        return surface === "map" || surface === "outline" ? surface : undefined;
      }

      function activeDirectEditSurface() {
        return (
          normalizeEditSurface(thoughtforgeState.editingSurface) ??
          normalizeEditSurface(thoughtforgeState.pendingFocusSurface) ??
          normalizeEditSurface(thoughtforgeState.preferredEditSurface) ??
          "map"
        );
      }

      function isPendingDifferentDirectEditSurface(nodeId, surface) {
        const retryToken = thoughtforgeState.activeFocusRetryToken;
        if (retryToken && !retryToken.cancelled && retryToken.nodeId === nodeId && retryToken.surface !== surface) {
          return true;
        }
        if (
          thoughtforgeState.pendingFocusNodeId === nodeId &&
          thoughtforgeState.pendingFocusSurface &&
          thoughtforgeState.pendingFocusSurface !== surface
        ) {
          return true;
        }
        return Boolean(
          thoughtforgeState.pendingEditingRefocusNodeId === nodeId &&
          thoughtforgeState.pendingFocusSurface &&
          thoughtforgeState.pendingFocusSurface !== surface
        );
      }

      function activateDirectEditSurface(nodeId, surface) {
        const nextSurface = normalizeEditSurface(surface);
        if (!nextSurface || isPendingDifferentDirectEditSurface(nodeId, nextSurface)) {
          return false;
        }
        thoughtforgeState.preferredEditSurface = nextSurface;
        if (thoughtforgeState.editingNodeId === nodeId) {
          thoughtforgeState.editingSurface = nextSurface;
        }
        return true;
      }

      function isActiveDirectEditSurface(nodeId, surface) {
        return thoughtforgeState.editingNodeId === nodeId && activeDirectEditSurface() === surface;
      }

      function normalizeMarkdownNodeInputText(rawText) {
        const firstLine = String(rawText ?? "").replace(/\\r\\n?/g, "\\n").split("\\n")[0] ?? "";
        let text = firstLine.trim();
        const listMarkerMatch = text.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
        if (listMarkerMatch) {
          text = listMarkerMatch[1].trimStart();
        }
        return text;
      }

      function markdownTitleView(text) {
        const title = String(text ?? "").trim();
        const headingMatch = title.match(/^(#{1,6})\s+(.+)$/);
        if (!headingMatch) {
          return {
            block: "paragraph",
            text: title
          };
        }
        return {
          block: "heading" + Math.min(3, headingMatch[1].length),
          text: headingMatch[2]
        };
      }

      function appendMarkdownInlineText(parent, text) {
        const pattern = new RegExp("(\\\\*\\\\*([^*]+)\\\\*\\\\*|_([^_]+)_|\\\\*([^*]+)\\\\*|\\\\x60([^\\\\x60]+)\\\\x60)", "g");
        let cursor = 0;
        for (const match of text.matchAll(pattern)) {
          if (match.index > cursor) {
            parent.append(document.createTextNode(text.slice(cursor, match.index)));
          }
          const element = document.createElement(match[5] ? "code" : match[1].startsWith("**") ? "strong" : "em");
          element.textContent = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
          parent.appendChild(element);
          cursor = match.index + match[0].length;
        }
        if (cursor < text.length) {
          parent.append(document.createTextNode(text.slice(cursor)));
        }
      }

      function refreshShownTitle(id) {
        for (const b of document.querySelectorAll(".thoughtforge-node")) if (b.dataset.nodeId === id) b.replaceWith(createNodeButton(id, b.className));
        for (const b of document.querySelectorAll(".thoughtforge-map-branch-toggle")) if (b.parentElement?.dataset.nodeId === id) b.setAttribute("aria-label", shownTitle(id) + (b.dataset.collapsed === "true" ? " を展開" : " を折りたたむ"));
      }

      function refreshTitleOverlays() {
        for (const p of document.querySelectorAll(".thoughtforge-map-drag-preview")) if (isMapTitleRootNodeId(p.dataset.nodeId) || thoughtforgeState.map?.nodesById?.[p.dataset.nodeId]) renderMarkdownNodeTitle(p, shownTitle(p.dataset.nodeId));
        const id = thoughtforgeState.contextMenuNodeId;
        if (!id || !nodeContextMenuElement || nodeContextMenuElement.hidden) return;
        const title = shownTitle(id) || NEW_NODE_PLACEHOLDER;
        if (nodeContextMenuTitleElement) nodeContextMenuTitleElement.textContent = title;
        if (nodeContextMenuPathElement) nodeContextMenuPathElement.textContent = selectedNodeContextPath();
        nodeContextMenuElement.setAttribute("aria-label", "ノード操作: " + title);
      }

      function shownTitle(id) {
        let latest;
        for (const record of thoughtforgeState.pendingRenames.values()) if (record.nodeId === id && (!latest || record.ordinal > latest.ordinal)) latest = record;
        return latest?.title ?? (nodeText(id) || thoughtforgeState.pendingOptimisticNodes.get(id)?.expectedText || "");
      }

      function renderMarkdownNodeTitle(element, rawText) {
        const view = markdownTitleView(rawText);
        element.dataset.markdownBlock = view.block;
        clearChildren(element);
        const titleText = document.createElement("span");
        titleText.className = "thoughtforge-node-title-text";
        titleText.dataset.thoughtforgeNodeTitleText = "true";
        appendMarkdownInlineText(titleText, view.text || NEW_NODE_PLACEHOLDER);
        element.appendChild(titleText);
      }

      function isNodeTitleEditActivationTarget(event) {
        const target = event.target;
        const targetElement =
          target instanceof Element
            ? target
            : target instanceof Text && target.parentElement
              ? target.parentElement
              : undefined;
        return Boolean(targetElement?.closest?.("[data-thoughtforge-node-title-text]"));
      }

      function createNodeButton(nodeId, className) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        renderMarkdownNodeTitle(button, shownTitle(nodeId));
        button.dataset.placeholder = nodeText(nodeId) ? "false" : "true";
        button.dataset.nodeId = nodeId;
        button.dataset.selected = thoughtforgeState.selectedNodeId === nodeId ? "true" : "false";
        button.dataset.hasNote = thoughtforgeState.map?.nodesById?.[nodeId]?.note ? "true" : "false";
        button.dataset.searchMatch = thoughtforgeState.searchMatchNodeIds.includes(nodeId)
          ? "true"
          : "false";
        button.dataset.activeSearchMatch = activeSearchNodeId() === nodeId ? "true" : "false";
        button.title = shownTitle(nodeId) || NEW_NODE_PLACEHOLDER;
        button.setAttribute(
          "aria-label",
          (shownTitle(nodeId) || NEW_NODE_PLACEHOLDER) +
            (thoughtforgeState.selectedNodeId === nodeId ? "。選択中" : "")
        );
        button.setAttribute("aria-pressed", thoughtforgeState.selectedNodeId === nodeId ? "true" : "false");
        const reparentTarget = thoughtforgeState.selectedNodeId
          ? isMeaningfulReparentTarget(thoughtforgeState.selectedNodeId, nodeId)
          : false;
        button.dataset.reparentTarget = reparentTarget ? "true" : "false";
        listen(button, "click", (event) => {
          if (suppressPostDragNodeActivation(event, nodeId)) {
            return;
          }
          event.stopPropagation();
          const surface = setPreferredEditSurfaceFromTarget(event.currentTarget);
          if (thoughtforgeState.isPickingReparentTarget) {
            moveSelectedNodeUnderTarget(nodeId);
            return;
          }
          const eligible = isNodeTitleEditActivationTarget(event);
          if (!eligible) pendingTitleClick = undefined;
          const shouldEdit = eligible && (hostPolicy?.singleClickEditsTitle !== false || titleClickStartsEdit(nodeId, surface));
          if (shouldEdit) {
            event.preventDefault();
            beginDirectNodeEdit(nodeId, surface);
            return;
          }
          selectThoughtForgeNode(nodeId, { edit: false, surface });
        });
        listen(button, "dblclick", (event) => {
          if (suppressPostDragNodeActivation(event, nodeId)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const surface = setPreferredEditSurfaceFromTarget(event.currentTarget);
          if (isNodeTitleEditActivationTarget(event)) {
            beginDirectNodeEdit(nodeId, surface);
            return;
          }
          selectThoughtForgeNode(nodeId, { edit: false, surface });
        });
        listen(button, "contextmenu", (event) => {
          const surface = editSurfaceFromTarget(event.currentTarget);
          openNodeContextMenu(event, nodeId, surface);
        });
        if (thoughtforgeState.map?.nodesById?.[nodeId]?.note) {
          const indicator = document.createElement("span");
          indicator.className = "thoughtforge-node-note-indicator";
          indicator.dataset.thoughtforgeNodeNoteIndicator = "true";
          indicator.textContent = "note";
          button.appendChild(indicator);
        }
        return button;
      }

      function promoteImeCap(input) {
        if (!(input instanceof HTMLInputElement) || !isImeCap(input)) {
          return false;
        }
        const nodeId = input.dataset.nodeId;
        const nextSurface = normalizeEditSurface(input.dataset.editSurface) ?? activeDirectEditSurface();
        const form = input.closest("form");
        if (form instanceof HTMLElement) form.classList.remove("tf-ime");
        Object.assign(thoughtforgeState, { selectedNodeId: nodeId, editingNodeId: nodeId, editingSurface: nextSurface, preferredEditSurface: nextSurface });
        ensureDirectEditSession(nodeId, nextSurface, { phase: thoughtforgeState.isComposingText ? "composing" : "idle", latestText: input.value });
        return true;
      }

      function renderNodeTitleEditor(nodeId, options) {
        const node = thoughtforgeState.map.nodesById[nodeId];
        const form = document.createElement("form");
        form.className = options.formClassName;
        form.dataset.nodeId = nodeId;
        form.dataset[options.editorDatasetName] = "true";
        const isCap = thoughtforgeState.editingNodeId !== nodeId;
        if (isCap) form.classList.add("tf-ime");
        let committedText = node.text;

        const commitRename = () => {
          const input = form.querySelector("input");
          const nextText = normalizeMarkdownNodeInputText(input?.value ?? node.text);
          if (nextText === committedText) {
            if (nextText !== "") {
              clearCommittedDraftNode(node.id);
            }
            return;
          }
          committedText = nextText;
          if (commitOptimisticDraftNode(node.id, nextText)) {
            return;
          }
          if (nextText !== "") {
            clearCommittedDraftNode(node.id);
          }
          postThoughtForgeCommand({
            type: "node.rename",
            nodeId: node.id,
            nextText
          });
        };
        let isFinishingEdit = false;
        let skipBlurFinish = false;
        const finishEditing = (options = {}) => {
          if(hostPolicy?.captureBlockedInput?.(input))return;
          if (isFinishingEdit) {
            return;
          }
          isFinishingEdit = true;
          if (options.commit !== false) {
            const nextText = normalizeMarkdownNodeInputText(input?.value ?? node.text);
            if (isDraftLikeEmptyNode(node.id) && nextText === "") {
              skipBlurFinish = true;
              deleteEmptyDraftNode(node.id);
              return;
            }
            commitRename();
          }
          if (thoughtforgeState.editingNodeId === node.id) {
            thoughtforgeState.editingNodeId = undefined;
            thoughtforgeState.editingSurface = undefined;
          }
          thoughtforgeState.pendingEditingRefocusNodeId = undefined;
          thoughtforgeState.pendingFocusSurface = undefined;
          if (directEditSessionFor(node.id, options.surface)) {
            finishDirectEditSession();
          }
          skipBlurFinish = true;
          input.blur();
          renderThoughtForgeMap();
        };

        listen(form, "submit", (event) => {
          event.preventDefault();
          event.stopPropagation();
          finishEditing();
        });

        const input = document.createElement("input");
        input.type = "text";
        input.value = directEditSessionInputValue(nodeId, options.surface) ?? thoughtforgeState.optimisticDraftInputValues.get(nodeId) ?? shownTitle(nodeId);
        titleCommandInputs.set(input, commit => { if (!commit) input.value = node.text; finishEditing({commit}); });
        input.placeholder = NEW_NODE_PLACEHOLDER;
        input.setAttribute("aria-label", options.ariaLabel);
        input.setAttribute("draggable", "false");
        input.dataset[options.inputDatasetName] = "true";
        input.dataset.nodeId = nodeId;
        input.dataset.editSurface = options.surface;
        listen(input, "focus", () => {
          recordImeDebugTrace("direct-input-focus", { nodeId: node.id, surface: options.surface, value: input.value });
          clearStaleImeState();
          if (isCap && isImeCap(input)) return;
          activateDirectEditSurface(node.id, options.surface);
          ensureDirectEditSession(node.id, options.surface, { phase: thoughtforgeState.isComposingText ? "composing" : "idle", latestText: input.value });
        });
        listen(input, "beforeinput", (event) => {
          if (isCap) promoteImeCap(input);
          recordImeDebugTrace("direct-input-beforeinput", {
            ...eventDebugSummary(event),
            beforeInputValue: input.value,
            ...directInputPipelineSnapshot(node.id, options.surface, input)
          });
          traceDebugEvent({
            scope: "input",
            event: "beforeinput",
            nodeId: node.id,
            payload: {
              surface: options.surface,
              inputType: event.inputType,
              isComposing: event.isComposing === true
            }
          });
          startImeFromInputFallback(event, input, node.id, options.surface);
        });
        listen(input, "input", (event) => {
          if (isCap) promoteImeCap(input);
          recordImeDebugTrace("direct-input-input", {
            ...eventDebugSummary(event),
            afterInputValue: input.value,
            ...directInputPipelineSnapshot(node.id, options.surface, input)
          });
          traceDebugEvent({
            scope: "input",
            event: "input",
            nodeId: node.id,
            payload: {
              surface: options.surface,
              textLength: input.value.length,
              isComposing: event.isComposing === true
            },
            result: "ok"
          });
          startImeFromInputFallback(event, input, node.id, options.surface);
          endImeFromInputFallback(event, input, node.id, options.surface);
          clearStaleImeState(event);
          syncOptimisticDraftInputValue(node.id, input.value);
        });
        listen(input, "click", (event) => {
          recordImeDebugTrace("direct-input-click", { ...eventDebugSummary(event), nodeId: node.id, surface: options.surface, value: input.value });
          if (isCap && isImeCap(input)) {
            if (hostPolicy?.singleClickEditsTitle === false && !titleClickStartsEdit(node.id, options.surface)) {
              event.stopPropagation();
              return;
            }
            promoteImeCap(input);
            if (hostPolicy?.singleClickEditsTitle === false) input.setSelectionRange(0, input.value.length);
            event.stopPropagation();
            return;
          }
          activateDirectEditSurface(node.id, options.surface);
          ensureDirectEditSession(node.id, options.surface, { phase: thoughtforgeState.isComposingText ? "composing" : "idle", latestText: input.value });
          event.stopPropagation();
        });
        listen(input, "dblclick", (event) => {
          if (hostPolicy?.singleClickEditsTitle === false && isImeCap(input)) {
            pendingTitleClick = undefined;
            promoteImeCap(input);
            input.setSelectionRange(0, input.value.length);
            event.preventDefault(); event.stopPropagation();
          }
        });
        listen(input, "dragstart", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        listen(input, "keydown", (event) => {
          recordImeDebugTrace("direct-input-keydown", {
            ...eventDebugSummary(event),
            beforeKeydownValue: input.value,
            ...directInputPipelineSnapshot(node.id, options.surface, input)
          });
          if (isCap && isImeCap(input)) {
            const key = event.key;
            if (key === "Escape" && !isImeCompositionShortcutEvent(event) && isCancellableEmptyDraftNode(node.id)) {
              event.preventDefault();
              event.stopPropagation();
              skipBlurFinish = true;
              deleteEmptyDraftNode(node.id);
              return;
            }
            if ((key === "Enter" || (key === "Tab" && !event.shiftKey)) && shouldHandleDirectEditClassicShortcut(event)) {
              event.preventDefault();
              event.stopPropagation();
              skipBlurFinish = true;
              handleThoughtForgeEditCommand(key === "Enter" ? "node.insertSibling" : "node.insertChild", { nodeId: node.id, surface: options.surface, where: event.shiftKey ? "before" : "after" });
              return;
            }
            if ((event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) || isImeCompositionShortcutEvent(event)) {
              promoteImeCap(input);
              event.stopPropagation();
            }
            return;
          }
          traceDebugEvent({
            scope: "input",
            event: "keydown",
            nodeId: node.id,
            payload: {
              key: event.key,
              code: event.code,
              keyCode: event.keyCode,
              isComposing: event.isComposing === true,
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              shiftKey: event.shiftKey,
              surface: options.surface
            }
          });
          event.stopPropagation();
          clearStaleImeState(event);
          if (!isActiveDirectEditSurface(node.id, options.surface)) {
            activateDirectEditSurface(node.id, options.surface);
            if (!isActiveDirectEditSurface(node.id, options.surface)) {
              if (
                ((event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) && queueDirectEditKey(event)) ||
                event.key === "Enter" ||
                event.key === "Tab" ||
                event.key === "Escape"
              ) {
                event.preventDefault();
              }
              scheduleDirectRenameFocus(node.id, { surface: options.surface });
              return;
            }
          }
          if ((event.key === "Enter" || event.key === "Tab") && isImeCompositionShortcutEvent(event)) {
            traceDebugEvent({
              scope: "input",
              event: "keydown",
              nodeId: node.id,
              payload: { key: event.key, isComposing: event.isComposing === true, keyCode: event.keyCode },
              result: "ignored",
              reason: "IME composing"
            });
            if (!event.isComposing && event.keyCode !== 229) {
              event.preventDefault();
            }
            return;
          }
          if (event.key === "Escape" && !isImeCompositionShortcutEvent(event)) {
            event.preventDefault();
            skipBlurFinish = true;
            if (isCancellableEmptyDraftNode(node.id)) {
              if (directEditSessionFor(node.id, options.surface)) {
                finishDirectEditSession();
              }
              deleteEmptyDraftNode(node.id);
              return;
            }
            const inFlight = thoughtforgeState.pendingOptimisticNodes.get(node.id);
            if (inFlight && !normalizeMarkdownNodeInputText(input.value) && !hasDependents(node.id)) inFlight.deleteWhenCreated = true;
            input.value = node.text;
            finishEditing({ commit: false });
            return;
          }
          if (event.key === "Enter" && shouldHandleDirectEditClassicShortcut(event)) {
            event.preventDefault();
            createEmptyDraft(node.id, input);
            thoughtforgeState.isComposingText = false;
            skipBlurFinish = true;
            handleThoughtForgeEditCommand("node.renameAndInsertSibling", {
              nodeId: node.id,
              nextText: normalizeMarkdownNodeInputText(input.value),
              surface: options.surface,
              where: event.shiftKey ? "before" : "after"
            });
            return;
          }
          if (event.key === "Tab" && event.shiftKey && shouldHandleDirectEditClassicShortcut(event)) {
            event.preventDefault();
            if (isCancellableEmptyDraftNode(node.id) && !normalizeMarkdownNodeInputText(input.value)) return;
            finishEditing();
            if (thoughtforgeState.map?.nodesById?.[node.id]) { handleThoughtForgeEditCommand("node.outdent", { nodeId: node.id, surface: options.surface }); focusSelectionCap(); }
            return;
          }
          if (event.key === "Tab" && !event.shiftKey && shouldHandleDirectEditClassicShortcut(event)) {
            event.preventDefault();
            createEmptyDraft(node.id, input);
            thoughtforgeState.isComposingText = false;
            skipBlurFinish = true;
            handleThoughtForgeEditCommand("node.renameAndInsertChild", {
              nodeId: node.id,
              nextText: normalizeMarkdownNodeInputText(input.value),
              surface: options.surface
            });
          }
        }, { capture: true });
        listen(input, "blur", (event) => {
          if (concentrationView && (event.relatedTarget === commandPaletteInput || !event.relatedTarget && performance.now() - thoughtforgeState.lastPointerDownAt >= 350)) return;
          recordImeDebugTrace("direct-input-blur", { ...eventDebugSummary(event), nodeId: node.id, surface: options.surface, value: input.value });
          if (isCap && isImeCap(input)) return;
          if (skipBlurFinish || input.dataset.suppressBlurFinish) {
            delete input.dataset.suppressBlurFinish;
            return;
          }
          if (shouldPreserveDraftBlur(node.id, event, input)) {
            scheduleDirectRenameFocus(node.id, { surface: options.surface });
            return;
          }
          const pressed = performance.now() - thoughtforgeState.lastPointerDownAt < 350 && thoughtforgeState.pointerDownNodeId;
          finishEditing();
          if (pressed && pressed !== node.id && thoughtforgeState.map?.nodesById?.[pressed]) { thoughtforgeState.selectedNodeId = pressed; renderThoughtForgeMap(); focusSelectionCap(); }
        });
        form.appendChild(input);
        return form;
      }

      function shouldRenderDirectNodeEditor(nodeId, surface) {
        return thoughtforgeState.editingNodeId === nodeId && activeDirectEditSurface() === surface;
      }

      function shouldImeCap(nodeId, surface) {
        return Boolean(thoughtforgeState.selectedNodeId === nodeId && !thoughtforgeState.editingNodeId && activeDirectEditSurface() === surface && !thoughtforgeState.isPickingReparentTarget);
      }

      function renderOutlineNodeTitleEditor(nodeId) {
        return renderNodeTitleEditor(nodeId, { formClassName: "thoughtforge-outline-title-editor", editorDatasetName: "thoughtforgeOutlineDirectEditor", inputDatasetName: "thoughtforgeOutlineDirectRenameInput", surface: "outline", ariaLabel: "Edit Markdown outline node title" });
      }

      function renderOutlineNode(nodeId) {
        const node = thoughtforgeState.map.nodesById[nodeId];
        const item = document.createElement("li");
        item.dataset.nodeId = nodeId;
        item.dataset.collapsed = isNodeCollapsed(nodeId) ? "true" : "false";
        const row = document.createElement("div");
        row.className = "thoughtforge-node-row";
        row.appendChild(createCollapseToggle(nodeId));
        if (shouldRenderDirectNodeEditor(nodeId, "outline")) {
          row.appendChild(renderOutlineNodeTitleEditor(nodeId));
        } else if (shouldImeCap(nodeId, "outline")) {
          row.appendChild(renderOutlineNodeTitleEditor(nodeId));
        } else {
          row.appendChild(createNodeButton(nodeId, "thoughtforge-node"));
        }
        item.appendChild(row);

        if (node.children.length > 0) {
          const children = document.createElement("ul");
          children.className = "thoughtforge-outline-children";
          children.dataset.collapsed = isNodeCollapsed(nodeId) ? "true" : "false";
          for (const childId of node.children) {
            children.appendChild(renderOutlineNode(childId));
          }
          item.appendChild(children);
        }

        return item;
      }

      function renderMapNodeTitleEditor(nodeId) {
        return renderNodeTitleEditor(nodeId, { formClassName: "thoughtforge-map-title-editor", editorDatasetName: "thoughtforgeMapDirectEditor", inputDatasetName: "thoughtforgeMapDirectRenameInput", surface: "map", ariaLabel: "Edit mind map node title" });
      }

      function renderMapTitleRootTitleEditor(surface = "map") {
        const form = document.createElement("form");
        form.className = surface === "outline" ? "thoughtforge-outline-title-editor" : "thoughtforge-map-title-editor";
        form.dataset.nodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        if (surface === "outline") {
          form.dataset.thoughtforgeOutlineDirectEditor = "true";
        } else {
          form.dataset.thoughtforgeMapDirectEditor = "true";
        }
        let committedTitle = isEmptyDocumentDraftMap() ? "" : mapTitleRootText();

        const input = document.createElement("input");
        input.type = "text";
        input.value = committedTitle;
        input.placeholder = documentFileNameLabel();
        input.setAttribute("aria-label", "マップタイトルを編集");
        input.setAttribute("draggable", "false");
        if (surface === "outline") {
          input.dataset.thoughtforgeOutlineDirectRenameInput = "true";
        } else {
          input.dataset.thoughtforgeMapDirectRenameInput = "true";
        }
        input.dataset.nodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        input.dataset.editSurface = surface;

        let isFinishingEdit = false;
        const finishEditing = (options = {}) => {
          if(hostPolicy?.captureBlockedInput?.(input))return;
          if (isFinishingEdit) {
            return;
          }
          isFinishingEdit = true;
          const nextTitle = normalizeMarkdownNodeInputText(input.value);
          const shouldCreateFirstRootNode = isFirstInputMap() && nextTitle !== "";
          if (options.commit !== false && (nextTitle !== committedTitle || shouldCreateFirstRootNode)) {
            committedTitle = nextTitle;
            if (shouldCreateFirstRootNode) {
              thoughtforgeState.selectedNodeId = "node-1";
              thoughtforgeState.editingNodeId = "node-1";
              thoughtforgeState.editingSurface = "map";
              thoughtforgeState.preferredEditSurface = "map";
              thoughtforgeState.pendingFocusNodeId = "node-1";
              thoughtforgeState.pendingFocusSurface = "map";
              thoughtforgeState.draftNodeIds.add("node-1");
            }
            postThoughtForgeCommand({
              type: "map.rename",
              nextTitle
            });
          }
          if (thoughtforgeState.editingNodeId === THOUGHTFORGE_MAP_TITLE_ROOT_ID) {
            thoughtforgeState.editingNodeId = undefined;
            thoughtforgeState.editingSurface = undefined;
          }
          input.blur();
          renderThoughtForgeMap();
        };

        listen(form, "submit", (event) => {
          event.preventDefault();
          event.stopPropagation();
          finishEditing();
        });
        listen(input, "click", (event) => {
          thoughtforgeState.editingNodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
          thoughtforgeState.editingSurface = surface;
          thoughtforgeState.preferredEditSurface = surface;
          event.stopPropagation();
        });
        listen(input, "dragstart", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        listen(input, "keydown", (event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            input.value = committedTitle;
            finishEditing({ commit: false });
          }
        });
        titleCommandInputs.set(input, commit => { if (!commit) input.value = committedTitle; finishEditing({commit}); });
        listen(input, "blur", event => { if (concentrationView && (event.relatedTarget === commandPaletteInput || !event.relatedTarget && performance.now() - thoughtforgeState.lastPointerDownAt >= 350)) return; finishEditing(); });
        form.appendChild(input);
        return form;
      }

      function shouldRenderMapTitleRootEditor(surface = "map") {
        return (isFirstInputMap() && surface === "map" && !thoughtforgeState.pendingFocusNodeId) || (thoughtforgeState.editingNodeId === THOUGHTFORGE_MAP_TITLE_ROOT_ID && activeDirectEditSurface() === surface);
      }

      function createMapTitleRootButton(surface) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = surface === "map"
          ? "thoughtforge-node thoughtforge-map-title-root-button"
          : "thoughtforge-node";
        button.dataset.nodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        button.dataset.thoughtforgeNode = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        button.dataset.titleRoot = "true";
        button.dataset.selected = isMapTitleRootSelected() ? "true" : "false";
        button.dataset.searchMatch = "false";
        button.dataset.activeSearchMatch = "false";
        button.dataset.reparentTarget = "false";
        button.textContent = mapTitleRootText();
        button.title = "マップ全体: " + mapTitleRootText();
        button.setAttribute(
          "aria-label",
          "マップ全体: " + mapTitleRootText() + (isMapTitleRootSelected() ? "。選択中" : "")
        );
        button.setAttribute("aria-pressed", isMapTitleRootSelected() ? "true" : "false");
        listen(button, "click", () => {
          const edit = hostPolicy?.singleClickEditsTitle === false && titleClickStartsEdit(THOUGHTFORGE_MAP_TITLE_ROOT_ID, surface);
          selectMapTitleRootNode({ edit, surface });
        });
        listen(button, "dblclick", () => thoughtforgeState.editingNodeId !== THOUGHTFORGE_MAP_TITLE_ROOT_ID && selectMapTitleRootNode({ edit: true, surface }));
        listen(button, "contextmenu", (event) => openNodeContextMenu(event, THOUGHTFORGE_MAP_TITLE_ROOT_ID, surface));
        return button;
      }

      function renderOutlineTitleRootNode(rootIds) {
        const item = document.createElement("li");
        item.dataset.nodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        item.dataset.titleRoot = "true";
        item.dataset.collapsed = "false";

        const row = document.createElement("div");
        row.className = "thoughtforge-node-row";
        const spacer = document.createElement("span");
        spacer.className = "thoughtforge-collapse-toggle";
        spacer.dataset.thoughtforgeTitleRootSpacer = "true";
        spacer.setAttribute("aria-hidden", "true");
        row.appendChild(spacer);
        if (shouldRenderMapTitleRootEditor("outline")) {
          row.appendChild(renderMapTitleRootTitleEditor("outline"));
        } else {
          row.appendChild(createMapTitleRootButton("outline"));
        }
        item.appendChild(row);

        if (rootIds.length > 0) {
          const children = document.createElement("ul");
          children.className = "thoughtforge-outline-children";
          children.dataset.collapsed = "false";
          for (const rootId of rootIds) {
            children.appendChild(renderOutlineNode(rootId));
          }
          item.appendChild(children);
        }

        return item;
      }

      function renderMapTitleRootBranch(rootIds) {
        const hasVisibleChildren = rootIds.length > 0;
        const isSelectedNode = isMapTitleRootSelected();
        const branch = document.createElement("div");
        branch.className = "thoughtforge-map-branch";
        branch.dataset.nodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        branch.dataset.depth = "0";
        branch.dataset.parentId = "";
        branch.dataset.hasParent = "false";
        branch.dataset.selectedPath = isSelectedNode ? "true" : "false";
        branch.dataset.hasVisibleChildren = hasVisibleChildren ? "true" : "false";
        branch.dataset.titleRoot = "true";

        const connector = document.createElement("span");
        connector.className = "thoughtforge-map-connector";
        connector.dataset.thoughtforgeMapConnector = "true";
        connector.setAttribute("aria-hidden", "true");
        branch.appendChild(connector);

        const nodeElement = document.createElement("div");
        nodeElement.className = "thoughtforge-map-node";
        nodeElement.dataset.nodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
        nodeElement.dataset.titleRoot = "true";
        nodeElement.dataset.selected = isSelectedNode ? "true" : "false";
        nodeElement.dataset.selectedPath = isSelectedNode ? "true" : "false";
        nodeElement.dataset.searchMatch = "false";
        nodeElement.dataset.activeSearchMatch = "false";
        nodeElement.dataset.hasChildren = hasVisibleChildren ? "true" : "false";
        nodeElement.dataset.collapsed = "false";
        nodeElement.dataset.dragging = "false";
        nodeElement.dataset.dragTarget = "false";
        nodeElement.dataset.dropPosition = "";
        nodeElement.dataset.dropDisabled = "true";
        nodeElement.draggable = false;
        nodeElement.setAttribute("aria-label", "マップ全体を選択してコピー");
        listen(nodeElement, "contextmenu", (event) => {
          openNodeContextMenu(event, THOUGHTFORGE_MAP_TITLE_ROOT_ID, "map");
        });

        if (shouldRenderMapTitleRootEditor("map")) {
          nodeElement.appendChild(renderMapTitleRootTitleEditor("map"));
        } else {
          nodeElement.appendChild(createMapTitleRootButton("map"));
        }
        branch.appendChild(nodeElement);

        const { right: rightRootIds, left: leftRootIds } = splitMapMainBranches(rootIds);
        branch.dataset.hasLeftChildren = leftRootIds.length > 0 ? "true" : "false";
        if (leftRootIds.length > 0) {
          branch.insertBefore(
            renderMapColumn(leftRootIds, THOUGHTFORGE_MAP_TITLE_ROOT_ID, "left", rightRootIds.length),
            nodeElement
          );
        }
        if (rightRootIds.length > 0) {
          branch.appendChild(renderMapColumn(rightRootIds, THOUGHTFORGE_MAP_TITLE_ROOT_ID, "right"));
        }

        return branch;
      }

      function renderMapBranch(nodeId, visualParentId, side = "right") {
        const node = thoughtforgeState.map.nodesById[nodeId];
        const parentId = parentIdForNode(nodeId);
        const renderedParentId = visualParentId ?? parentId;
        const selectedNodeId = thoughtforgeState.selectedNodeId;
        const isSelectedNode = selectedNodeId === nodeId;
        const isSelectedPath =
          Boolean(selectedNodeId) && (isSelectedNode || isDescendantOf(selectedNodeId, nodeId));
        const isCollapsed = isNodeCollapsed(nodeId);
        const hiddenCount = isCollapsed ? hiddenDescendantCount(nodeId) : 0;
        const branch = document.createElement("div");
        branch.className = "thoughtforge-map-branch";
        branch.dataset.nodeId = nodeId;
        branch.dataset.depth = String(nodeDepth(nodeId));
        branch.dataset.parentId = renderedParentId ?? "";
        branch.dataset.hasParent = renderedParentId ? "true" : "false";
        branch.dataset.side = side;
        branch.dataset.selectedPath = isSelectedPath ? "true" : "false";
        branch.dataset.hasVisibleChildren =
          node.children.length > 0 && !isCollapsed ? "true" : "false";
        const isEditingNode = shouldRenderDirectNodeEditor(nodeId, "map");
        const isCapNode = shouldImeCap(nodeId, "map");

        const connector = document.createElement("span");
        connector.className = "thoughtforge-map-connector";
        connector.dataset.thoughtforgeMapConnector = "true";
        connector.setAttribute("aria-hidden", "true");
        branch.appendChild(connector);

        const nodeElement = document.createElement("div");
        nodeElement.className = "thoughtforge-map-node";
        nodeElement.dataset.nodeId = nodeId;
        nodeElement.dataset.selected = isSelectedNode ? "true" : "false";
        nodeElement.dataset.selectedPath = isSelectedPath ? "true" : "false";
        nodeElement.dataset.searchMatch = thoughtforgeState.searchMatchNodeIds.includes(nodeId)
          ? "true"
          : "false";
        nodeElement.dataset.activeSearchMatch = activeSearchNodeId() === nodeId ? "true" : "false";
        nodeElement.dataset.hasChildren = node.children.length > 0 ? "true" : "false";
        nodeElement.dataset.collapsed = isCollapsed ? "true" : "false";
        nodeElement.dataset.dragging = thoughtforgeState.draggedMapNodeId === nodeId ? "true" : "false";
        nodeElement.dataset.dragTarget = thoughtforgeState.dragOverMapNodeId === nodeId ? "true" : "false";
        nodeElement.dataset.dropPosition =
          thoughtforgeState.dragOverMapNodeId === nodeId && thoughtforgeState.dragOverMapDropPosition
            ? thoughtforgeState.dragOverMapDropPosition
            : "";
        nodeElement.dataset.dropDisabled =
          thoughtforgeState.draggedMapNodeId && !canDropMapNodeOnTarget(thoughtforgeState.draggedMapNodeId, nodeId)
            ? "true"
            : "false";
        nodeElement.draggable = false;
        nodeElement.setAttribute("aria-label", "マインドマップノードをドラッグして移動");
        listen(nodeElement, "contextmenu", (event) => {
          openNodeContextMenu(event, nodeId, "map");
        });
        listen(nodeElement, "click", (event) => suppressPostDragNodeActivation(event, nodeId), true);
        listen(nodeElement, "dblclick", (event) => suppressPostDragNodeActivation(event, nodeId), true);
        listen(nodeElement, "pointerdown", (event) => {
          if (!isMapNodePointerDragActivationTarget(event, nodeElement)) {
            return;
          }
          startMapNodePointerDrag(event, nodeId, nodeElement);
        });
        listen(nodeElement, "click", (event) => {
          if (isTextEditingTarget(event.target)) {
            return;
          }
          if (event.target instanceof Element && event.target.closest("button, input, textarea, select, form")) {
            return;
          }
          if (thoughtforgeState.isPickingReparentTarget) {
            moveSelectedNodeUnderTarget(nodeId);
            return;
          }
          selectThoughtForgeNode(nodeId, { edit: false, surface: "map" });
        });
        listen(nodeElement, "dragstart", (event) => {
          if (isTextEditingTarget(event.target)) {
            event.preventDefault();
            return;
          }
          startMapNodeDrag(event, nodeId, nodeElement);
        });
        listen(nodeElement, "dragover", (event) => {
          const draggedNodeId = draggedThoughtForgeNodeId(event);
          const dropIntent = resolveMapDropIntent(event, draggedNodeId, nodeId, nodeElement);
          const canDrop = Boolean(dropIntent);
          nodeElement.dataset.dropDisabled = canDrop ? "false" : "true";
          if (!canDrop) {
            return;
          }
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          thoughtforgeState.dragOverMapNodeId = nodeId;
          thoughtforgeState.dragOverMapDropPosition = dropIntent.position;
          nodeElement.dataset.dragTarget = "true";
          nodeElement.dataset.dropPosition = dropIntent.position;
        });
        listen(nodeElement, "dragleave", (event) => {
          if (event.currentTarget instanceof Element && event.relatedTarget instanceof Node) {
            if (event.currentTarget.contains(event.relatedTarget)) {
              return;
            }
          }
          if (thoughtforgeState.dragOverMapNodeId === nodeId) {
            thoughtforgeState.dragOverMapNodeId = undefined;
          }
          thoughtforgeState.dragOverMapDropPosition = undefined;
          nodeElement.dataset.dragTarget = "false";
          nodeElement.dataset.dropPosition = "";
          nodeElement.dataset.dropDisabled = "false";
        });
        listen(nodeElement, "drop", (event) => {
          event.preventDefault();
          const draggedNodeId = draggedThoughtForgeNodeId(event);
          const dropIntent = resolveMapDropIntent(event, draggedNodeId, nodeId, nodeElement);
          if (!moveDraggedMapNodeWithIntent(draggedNodeId, nodeId, dropIntent)) {
            resetMapDragState();
            return;
          }
          resetMapDragState();
        });
        listen(nodeElement, "dragend", () => {
          resetMapDragState();
        });
        if (isEditingNode) {
          nodeElement.appendChild(createMapDragHandle(nodeId, nodeElement));
          nodeElement.appendChild(renderMapNodeTitleEditor(nodeId));
        } else if (isCapNode) {
          nodeElement.appendChild(renderMapNodeTitleEditor(nodeId));
        } else {
          nodeElement.appendChild(createNodeButton(nodeId, "thoughtforge-node"));
        }
        if (node.children.length > 0) {
          nodeElement.appendChild(createMapBranchToggle(nodeId, hiddenCount));
        }
        branch.appendChild(nodeElement);

        if (node.children.length > 0 && !isCollapsed) {
          branch.appendChild(renderMapColumn(node.children, nodeId, side));
        }

        return branch;
      }

      function renderMapColumn(nodeIds, parentId, side = "right", indexOffset = 0) {
        const column = document.createElement("div");
        const columnParentId = parentId ?? "";
        const isColumnDropTarget =
          thoughtforgeState.dragOverMapDropPosition === "between" &&
          thoughtforgeState.dragOverMapColumnParentId === columnParentId &&
          (thoughtforgeState.dragOverMapColumnSide ?? "right") === side &&
          typeof thoughtforgeState.dragOverMapColumnRawIndex === "number";
        column.className = "thoughtforge-map-column";
        column.dataset.side = side;
        column.dataset.indexOffset = String(indexOffset);
        column.dataset.parentId = columnParentId;
        column.dataset.hasParent = parentId ? "true" : "false";
        column.dataset.childCount = String(nodeIds.length);
        column.dataset.dropPosition = "";
        listen(column, "dragover", (event) => {
          if (event.target instanceof Element && event.target.closest(".thoughtforge-map-column") !== column) {
            return;
          }
          if (event.target instanceof Element && event.target.closest(".thoughtforge-map-node")) {
            return;
          }
          const draggedNodeId = draggedThoughtForgeNodeId(event);
          const dropIntent = resolveMapColumnDropIntent(event, draggedNodeId, parentId, column);
          if (!dropIntent) {
            column.dataset.dropPosition = "";
            thoughtforgeState.dragOverMapColumnParentId = undefined;
            thoughtforgeState.dragOverMapColumnRawIndex = undefined;
            thoughtforgeState.dragOverMapColumnSide = undefined;
            clearMapColumnDropMarkers();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          thoughtforgeState.dragOverMapNodeId = undefined;
          thoughtforgeState.dragOverMapDropPosition = "between";
          thoughtforgeState.dragOverMapColumnParentId = columnParentId;
          thoughtforgeState.dragOverMapColumnRawIndex = dropIntent.rawIndex;
          thoughtforgeState.dragOverMapColumnSide = side;
          setMapColumnDropMarker(column, dropIntent.rawIndex);
        });
        listen(column, "dragleave", (event) => {
          if (event.currentTarget instanceof Element && event.relatedTarget instanceof Node) {
            if (event.currentTarget.contains(event.relatedTarget)) {
              return;
            }
          }
          thoughtforgeState.dragOverMapDropPosition = undefined;
          thoughtforgeState.dragOverMapColumnParentId = undefined;
          thoughtforgeState.dragOverMapColumnRawIndex = undefined;
          clearMapColumnDropMarkers();
        });
        listen(column, "drop", (event) => {
          if (event.target instanceof Element && event.target.closest(".thoughtforge-map-column") !== column) {
            return;
          }
          if (event.target instanceof Element && event.target.closest(".thoughtforge-map-node")) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          const draggedNodeId = draggedThoughtForgeNodeId(event);
          const dropIntent = resolveMapColumnDropIntent(event, draggedNodeId, parentId, column);
          if (!dropIntent) {
            resetMapDragState();
            return;
          }
          if (!applyOptimisticMove(draggedNodeId, dropIntent.nextParentId, dropIntent.nextIndex)) {
            resetMapDragState();
            return;
          }
          postThoughtForgeCommand({
            type: "node.move",
            nodeId: draggedNodeId,
            nextParentId: dropIntent.nextParentId,
            nextIndex: dropIntent.nextIndex
          });
          resetMapDragState();
        });
        nodeIds.forEach((nodeId, index) => {
          const branch = renderMapBranch(nodeId, parentId, side);
          if (isColumnDropTarget && thoughtforgeState.dragOverMapColumnRawIndex === index) {
            branch.dataset.columnDropBefore = "true";
          }
          if (
            isColumnDropTarget &&
            index === nodeIds.length - 1 &&
            thoughtforgeState.dragOverMapColumnRawIndex >= nodeIds.length
          ) {
            branch.dataset.columnDropAfter = "true";
          }
          column.appendChild(branch);
        });
        if (nodeIds.length === 0 && isColumnDropTarget) {
          column.dataset.dropPosition = "between";
        }
        return column;
      }

      function moveSelectedNode(direction) {
        syncSelectionFromVisibleFocus();
        const currentId = thoughtforgeState.selectedNodeId;
        if (!currentId) {
          return false;
        }

        const order = visibleNodeIds();
        const currentIndex = order.indexOf(currentId);
        if (currentIndex === -1) {
          return false;
        }

        if (direction === "previous" && currentIndex > 0) {
          selectThoughtForgeNode(order[currentIndex - 1]);
          return true;
        }

        if (direction === "next" && currentIndex < order.length - 1) {
          selectThoughtForgeNode(order[currentIndex + 1]);
          return true;
        }

        if (direction === "parent") {
          if (nodeHasChildren(currentId) && !isNodeCollapsed(currentId)) {
            if (concentrationView) toggleNodeCollapse(currentId);
            else {
              thoughtforgeState.collapsedNodeIds.add(currentId);
              renderThoughtForgeMap();
            }
            return true;
          }
          const parentId = parentIdForNode(currentId);
          if (parentId && isNodeInFocusSubtree(parentId)) {
            selectThoughtForgeNode(parentId);
            return true;
          }
        }

        if (direction === "firstChild") {
          if (nodeHasChildren(currentId) && isNodeCollapsed(currentId)) {
            thoughtforgeState.collapsedNodeIds.delete(currentId);
            renderThoughtForgeBranch(currentId);
            return true;
          }
          const childId = thoughtforgeState.map?.nodesById?.[currentId]?.children?.[0];
          if (childId) {
            selectThoughtForgeNode(childId);
            return true;
          }
        }

        return false;
      }

      function moveSelectedNodeHorizontally(visualDirection) {
        syncSelectionFromVisibleFocus();
        const currentId = thoughtforgeState.selectedNodeId;
        const side = mapSideForNode(currentId);
        if (side === "center") {
          if (!currentId || !thoughtforgeState.map) {
            return false;
          }
          const { right, left } = splitMapMainBranches(getVisibleRootIds(thoughtforgeState.map));
          const targetId = (visualDirection === "left" ? left : right)[0];
          if (!targetId) {
            return false;
          }
          selectThoughtForgeNode(targetId);
          return true;
        }
        if (visualDirection === side) {
          return moveSelectedNode("firstChild");
        }
        if (moveSelectedNode("parent")) {
          return true;
        }
        if ((concentrationView || !thoughtforgeState.focusRootNodeId) && !parentIdForNode(currentId)) {
          selectThoughtForgeNode(THOUGHTFORGE_MAP_TITLE_ROOT_ID);
          return true;
        }
        return false;
      }

      function selectActiveSearchMatch(nextIndex) {
        const matchCount = thoughtforgeState.searchMatchNodeIds.length;
        if (matchCount === 0) {
          updateSearchControls();
          return;
        }

        thoughtforgeState.activeSearchMatchIndex = (nextIndex + matchCount) % matchCount;
        const nodeId = activeSearchNodeId();
        if (nodeId) {
          selectThoughtForgeNode(nodeId, { syncSearch: false });
        } else {
          renderThoughtForgeMap();
        }
      }

      function moveSearchResult(delta) {
        if (thoughtforgeState.searchMatchNodeIds.length === 0) {
          return;
        }
        if (concentrationView && thoughtforgeState.activeSearchMatchIndex === -1) {
          selectActiveSearchMatch(delta < 0 ? thoughtforgeState.searchMatchNodeIds.length - 1 : 0);
          return;
        }
        selectActiveSearchMatch(thoughtforgeState.activeSearchMatchIndex + delta);
      }

      function updateSearchQuery(nextQuery) {
        hostPolicy?.commandContextChanged?.();
        const previousFolds = concentrationView ? new Map([...thoughtforgeState.collapsedNodeIds].map(id => [id, isNodeCollapsed(id)])) : undefined;
        if (normalizeSearchText(nextQuery) !== normalizeSearchText(thoughtforgeState.searchQuery)) thoughtforgeState.filterFoldedNodeIds.clear();
        thoughtforgeState.searchQuery = String(nextQuery ?? "");
        recomputeSearchMatches();
        if (!concentrationView && thoughtforgeState.activeSearchMatchIndex !== -1) {
          selectActiveSearchMatch(thoughtforgeState.activeSearchMatchIndex);
          return;
        }
        if (!concentrationView) { renderThoughtForgeMap(true); return; }
        const changed = [...previousFolds].filter(([id, folded]) => folded !== isNodeCollapsed(id)).map(([id]) => id);
        // A branch update preserves outline descendants. Multiple fold changes,
        // including nested ones, need a full projection for both surfaces.
        if (changed.length > 1) renderThoughtForgeMap(true);
        else if (changed.length) renderThoughtForgeBranch(changed[0], true);
        else {
          focusVisibleSelection();
          syncFilterAppearance();
        }
      }

      function clearSearchQuery() {
        updateSearchQuery("");
      }

      function syncFilterAppearance() {
        syncConcentrationAppearance(true);
        updateSearchControls();
        renderSearchResultsPanel();
      }

      function appendFocusBreadcrumbButton(label, nodeId, current, container = focusBreadcrumbElement) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.thoughtforgeFocusBreadcrumb = nodeId ?? "all";
        button.dataset.currentFocus = current ? "true" : "false";
        button.title = current ? label + " を表示中" : label + " にフォーカス";
        button.setAttribute("aria-current", current ? "page" : "false");
        listen(button, "click", () => {
          localMapCommand(nodeId ? 'map-focus-selected' : 'map-clear-focus', () => {
            if (nodeId) setFocusRootNodeId(nodeId); else clearFocusMode();
            renderThoughtForgeMap();
          }, {nodeId});
        });
        container.appendChild(button);
      }

      function appendFocusActionButton(label, enabled, onClick, container = focusBreadcrumbElement) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = !enabled;
        button.title = label;
        button.setAttribute("aria-label", label);
        listen(button, "click", () => {
          if (!enabled) {
            return;
          }
          onClick();
          renderThoughtForgeMap();
        });
        container.appendChild(button);
      }

      function appendFocusSeparator(label = ">", container = focusBreadcrumbElement) {
        const separator = document.createElement("span");
        separator.className = "thoughtforge-focus-separator";
        separator.textContent = label;
        container.appendChild(separator);
      }

      function renderFocusBreadcrumb(map) {
        if (!focusBreadcrumbElement) {
          return;
        }
        clearChildren(focusBreadcrumbElement);
        const focusRootNodeId = thoughtforgeState.focusRootNodeId;
        focusBreadcrumbElement.hidden = !focusRootNodeId;
        if (!focusRootNodeId || !map?.nodesById?.[focusRootNodeId]) {
          return;
        }
        pruneFocusHistory(map);
        const focusStatus = document.createElement("span");
        focusStatus.className = "thoughtforge-focus-status";
        focusStatus.dataset.thoughtforgeFocusStatus = "active";
        focusStatus.textContent = "フォーカス";
        const breadcrumbRow = document.createElement("div");
        breadcrumbRow.className = "thoughtforge-focus-breadcrumb-row";
        breadcrumbRow.dataset.thoughtforgeFocusBreadcrumbRow = "true";
        const toolbar = document.createElement("div");
        toolbar.className = "thoughtforge-focus-toolbar";
        toolbar.dataset.thoughtforgeFocusToolbar = "true";
        breadcrumbRow.appendChild(focusStatus);
        appendFocusBreadcrumbButton("全体", undefined, false, breadcrumbRow);
        const ancestors = getAncestors(map, focusRootNodeId);
        for (const ancestor of ancestors) {
          appendFocusSeparator(">", breadcrumbRow);
          appendFocusBreadcrumbButton(shownTitle(ancestor.id), ancestor.id, false, breadcrumbRow);
        }
        appendFocusSeparator(">", breadcrumbRow);
        appendFocusBreadcrumbButton(shownTitle(focusRootNodeId), focusRootNodeId, true, breadcrumbRow);
        appendFocusActionButton("戻る", thoughtforgeState.focusHistoryNodeIds.length > 0 && !localCommandBlocked('map-focus-back'), () => localMapCommand('map-focus-back', restorePreviousFocusRoot), toolbar);
        appendFocusActionButton("進む", thoughtforgeState.focusForwardNodeIds.length > 0 && !localCommandBlocked('map-focus-forward'), () => localMapCommand('map-focus-forward', restoreNextFocusRoot), toolbar);
        appendFocusActionButton("前の枝", Boolean(adjacentSiblingFocusNodeId("previous")) && !localCommandBlocked('map-focus-sibling-previous'), () => localMapCommand('map-focus-sibling-previous', () => focusSiblingBranch("previous")), toolbar);
        appendFocusActionButton("次の枝", Boolean(adjacentSiblingFocusNodeId("next")) && !localCommandBlocked('map-focus-sibling-next'), () => localMapCommand('map-focus-sibling-next', () => focusSiblingBranch("next")), toolbar);
        appendFocusActionButton("サブツリーをコピー", Boolean(selectedNode()) && !localCommandBlocked('map-copy-subtree-markdown'), () => localMapCommand('map-copy-subtree-markdown', () => postClipboardWrite("subtree")), toolbar);
        appendFocusActionButton("表示中SVGをコピー", Boolean(selectedNode()) && !localCommandBlocked('map-copy-visible-svg'), () => localMapCommand('map-copy-visible-svg', postClipboardSvgWrite), toolbar);
        focusBreadcrumbElement.append(breadcrumbRow, toolbar);
      }

      function renderThoughtForgeMap(searchPrepared = false) {
        hostPolicy?.commandContextChanged?.();
        if (!mindMapElement) {
          return;
        }

        if (outlineElement) {
          clearChildren(outlineElement);
        }
        clearChildren(mindMapElement);

        const map = thoughtforgeState.map;
        if (!map) {
          if (outlineTitleElement) {
            outlineTitleElement.textContent = "マップデータを待機中";
          }
          outlineElement?.append("マップデータを待機中");
          mindMapElement.append("マップデータを待機中");
          return;
        }

        const previousRenderParentIdIndex = renderParentIdIndex;
        const previousRenderNodeIndex = renderNodeIndex;
        renderParentIdIndex = createRenderParentIdIndex(map);
        try {
        if (titleElement) {
          titleElement.textContent = map.title || "Untitled map";
        }
        if (outlineTitleElement) {
          outlineTitleElement.textContent = map.title || "Untitled map";
        }
        const shouldFocusEmptyDraftTitle = isFirstInputMap() && !thoughtforgeState.pendingFocusNodeId;
        if (shouldFocusEmptyDraftTitle) {
          thoughtforgeState.selectedNodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
          thoughtforgeState.editingNodeId = THOUGHTFORGE_MAP_TITLE_ROOT_ID;
          thoughtforgeState.editingSurface = thoughtforgeState.preferredEditSurface = "map";
        }
        prepareMapSelection(map);
        const rootIds = getVisibleRootIds(map);
        const pendingFocusNodeId = thoughtforgeState.pendingFocusNodeId;
        const pendingFocusSurface = thoughtforgeState.pendingFocusSurface;
        let scheduledFocusSurface = undefined;
        const resolvedPendingFocusNodeId = resolvePendingFocusNodeId(map);
        if (resolvedPendingFocusNodeId && map.nodesById[resolvedPendingFocusNodeId]) {
          // Resolving an operation changes selection and base folding, so the
          // Filter projection prepared before this render is no longer current.
          searchPrepared = false;
          scheduledFocusSurface = pendingFocusSurface ?? activeDirectEditSurface();
          thoughtforgeState.preferredEditSurface = scheduledFocusSurface;
          thoughtforgeState.selectedNodeId = resolvedPendingFocusNodeId;
          thoughtforgeState.editingNodeId = resolvedPendingFocusNodeId;
          thoughtforgeState.editingSurface = scheduledFocusSurface;
          thoughtforgeState.pendingFocusNodeId = undefined;
          thoughtforgeState.pendingFocusTarget = undefined;
          thoughtforgeState.pendingFocusSurface = undefined;
          thoughtforgeState.pendingEditingRefocusNodeId = undefined;
          if (pendingFocusNodeId && pendingFocusNodeId !== resolvedPendingFocusNodeId) {
            thoughtforgeState.draftNodeIds.delete(pendingFocusNodeId);
          }
          if (nodeText(resolvedPendingFocusNodeId) === "") {
            thoughtforgeState.draftNodeIds.add(resolvedPendingFocusNodeId);
          }
          revealNodeAncestors(resolvedPendingFocusNodeId);
        }
        pruneDraftNodeIds(map);
        renderNodeIndex = createRenderNodeIndex(map);
        if (searchPrepared !== true) recomputeSearchMatches();
        setEditControlsEnabled(Boolean(selectedNode()));
        updateSearchControls();
        renderSearchResultsPanel();
        updateSyncStatusControls();
        updateDiagnosticsPanel();
        updateReparentControls();
        updateReparentPickControls();
        syncNodeNotePanel();
        renderFocusBreadcrumb(map);

        outlineElement?.appendChild(renderOutlineTitleRootNode(rootIds));
        mindMapElement.appendChild(renderMapTitleRootBranch(rootIds));
        syncConcentrationAppearance();
        if (shouldFocusEmptyDraftTitle) {
          focusDirectRenameInputImmediately(THOUGHTFORGE_MAP_TITLE_ROOT_ID, "map");
        } else if (resolvedPendingFocusNodeId && map.nodesById[resolvedPendingFocusNodeId]) {
          focusDirectRenameInputImmediately(resolvedPendingFocusNodeId, scheduledFocusSurface);
        } else if (
          thoughtforgeState.pendingEditingRefocusNodeId &&
          thoughtforgeState.editingNodeId === thoughtforgeState.pendingEditingRefocusNodeId &&
          map.nodesById[thoughtforgeState.pendingEditingRefocusNodeId]
        ) {
          const refocusNodeId = thoughtforgeState.pendingEditingRefocusNodeId;
          const refocusSurface = thoughtforgeState.pendingFocusSurface ?? thoughtforgeState.preferredEditSurface;
          thoughtforgeState.preferredEditSurface = refocusSurface;
          thoughtforgeState.editingSurface = refocusSurface;
          thoughtforgeState.pendingEditingRefocusNodeId = undefined;
          thoughtforgeState.pendingFocusSurface = undefined;
          focusDirectRenameInputImmediately(refocusNodeId, refocusSurface);
        } else if (thoughtforgeState.pendingEditingRefocusNodeId) {
          thoughtforgeState.pendingEditingRefocusNodeId = undefined;
          thoughtforgeState.pendingFocusSurface = undefined;
        }
        if (thoughtforgeState.commandPaletteOpen) {
          renderThoughtForgeCommandPalette();
        }
        flushSelectionCounterpartReveal();
        if (concentrationView) focusVisibleSelection();
        } finally {
          renderParentIdIndex = previousRenderParentIdIndex;
          renderNodeIndex = previousRenderNodeIndex;
          hostPolicy?.afterRender?.();
        }
      }

      bridge.subscribe((message) => {
        if (
          message.type === "thoughtforge.command.result"
        ) {
          const isAppliedResult =
            message.status === "applied" && message.reason === undefined;
          const isRejectedResult =
            message.status === "rejected" &&
            isThoughtForgeCommandResultReason(message.reason);
          if (!isAppliedResult && !isRejectedResult) {
            return;
          }
          if (pendingPaste?.requestId === message.requestId) {
            if (isRejectedResult) pendingPaste = undefined;
            else pendingPaste.applied = true;
          }
          if (isRejectedResult) {
            const nodeId = finishRenameRequest(message.requestId);
            rollbackThoughtForgeCommandRequest(message.requestId);
            if (nodeId) { thoughtforgeState.editingNodeId || thoughtforgeState.activeMapPointerDragId !== undefined ? refreshShownTitle(nodeId) : renderThoughtForgeMap(); refreshTitleOverlays(); }
          } else {
            const record = thoughtforgeState.pendingRenames.get(message.requestId);
            if (record) record.phase = "awaiting-model";
            thoughtforgeState.pendingCommandRequests.delete(message.requestId);
          }
          return;
        }
        if (
          message.type === "thoughtforge.model.update"
        ) {
          if (shouldBufferModelUpdateForDirectEdit() || isTextComposing()) {
            if (!bufferModelUpdateForDirectEdit(message)) {
              thoughtforgeState.deferredModelUpdate = message;
            }
            return;
          }
          applyModelUpdate(message);
          return;
        }

        if (
          message.type === "thoughtforge.parse.error"
        ) {
          thoughtforgeState.documentText = String(message.fallbackText ?? "");
          recordParseDiagnostics(message.issues);
          recordParseErrorSyncStatus(message.issues?.length ?? 0);
          return;
        }

        if (
          message.type === "thoughtforge.settings.update"
        ) {
          thoughtforgeState.debugTraceEnabled = message.settings?.debugTrace === true;
          return;
        }

        if (
          message.type === "thoughtforge.focus.action"
        ) {
          if (message.action === "focus-selected") {
            focusSelectedBranch();
          } else if (message.action === "clear-focus") {
            clearFocusMode();
          } else if (message.action === "reveal-source") {
            requestSelectedNodeRevealInSource();
          } else if (message.action === "copy-selected-subtree") {
            postClipboardWrite("subtree");
          } else if (message.action === "export-ai-context-pack") {
            postClipboardAiContextPackWrite("subtree", "codex-worker", "full");
          } else if (message.action === "create-github-issue-draft") {
            postClipboardIssueDraftWrite("subtree");
          } else if (message.action === "export-selected-subtree-opml") {
            postClipboardOpmlWrite("subtree");
          }
          renderThoughtForgeMap();
        }
      }, (message) => traceDebugEvent({ scope: "webview", event: "receiveMessage", payload: summarizeWebviewMessage(message) }));

      function isMacPlatform() {
        return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      }

      function isPrimaryShortcut(event) {
        return isMacPlatform() ? event.metaKey : event.ctrlKey;
      }

      function hasNoShortcutModifier(event) {
        return !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      }

      function hasOnlyPrimaryShortcut(event) {
        return (
          isPrimaryShortcut(event) &&
          !event.altKey &&
          !event.shiftKey &&
          (isMacPlatform() ? !event.ctrlKey : !event.metaKey)
        );
      }

      function hasOnlyShiftShortcut(event) {
        return event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      }

      function hasOnlyPrimaryShiftShortcut(event) {
        return (
          isPrimaryShortcut(event) &&
          event.shiftKey &&
          !event.altKey &&
          (isMacPlatform() ? !event.ctrlKey : !event.metaKey)
        );
      }

      function focusSelectionCap() {
        [...document.querySelectorAll(".tf-ime input[data-node-id]")].find((e) => e.dataset.nodeId === thoughtforgeState.selectedNodeId)?.focus({ preventScroll: true });
      }

      function hasDependents(id) {
        return !!thoughtforgeState.queuedOptimisticCommands.get(id)?.length ||
          [...thoughtforgeState.pendingOptimisticNodes.values()].some((o) => o.nodeId !== id && [o.parentId, o.siblingId, o.dependsOnNodeId].includes(id));
      }

      function isImeCap(target) {
        if (!(target instanceof Element)) {
          return false;
        }
        const input = target.closest("input[data-node-id]");
        return input instanceof HTMLInputElement && input.dataset.nodeId === thoughtforgeState.selectedNodeId && !thoughtforgeState.editingNodeId;
      }

      function isTextEditingTarget(target) {
        if (!(target instanceof Element)) {
          return false;
        }
        if (isImeCap(target)) {
          return false;
        }

        return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
      }

      function isNodeTextEditingActive() {
        return Boolean(
          thoughtforgeState.editingNodeId ||
          thoughtforgeState.directEditSession ||
          isTextEditingTarget(document.activeElement)
        );
      }

      function isMindMapOrOutlineCopyTarget(target) {
        if (!(target instanceof Element)) {
          return false;
        }
        return Boolean(target.closest("[data-thoughtforge-mind-map], [data-thoughtforge-outline]"));
      }

      function hasRegularTextSelection() {
        return String(window.getSelection?.()?.toString?.() ?? "").length > 0;
      }

      function shouldCopyMindMapSelection(event) {
        if (!selectedCopyTarget()) {
          return false;
        }
        if (isTextEditingTarget(event.target) || isTextEditingTarget(document.activeElement)) {
          return false;
        }
        if (hasRegularTextSelection()) {
          return false;
        }
        return true;
      }

      function clearBranchCopy() {
        copiedBranch = undefined;
        pendingCopy = undefined;
      }

      function stageCopiedSubtree(node, markdownText, scope) {
        clearBranchCopy();
        if (!hostPolicy?.structuralPaste || scope !== "subtree" || isMapTitleRootNodeId(node.id)) return undefined;
        const subtree = { text: node.text, children: [] };
        const pending = [{ source: node, target: subtree }], seen = new Set();
        while (pending.length) {
          const { source, target } = pending.pop();
          if (seen.has(source.id)) return undefined;
          seen.add(source.id);
          for (const childId of source.children ?? []) {
            const child = thoughtforgeState.map?.nodesById?.[childId];
            if (!child) return undefined;
            const clone = { text: child.text, children: [] };
            target.children.push(clone); pending.push({ source: child, target: clone });
          }
        }
        const requestId = hostPolicy?.allocateCopyEffect ? hostPolicy.allocateCopyEffect() : "branch-copy-" + (++copySequence);
        if (!requestId) return undefined;
        pendingCopy = { requestId, markdownText, subtree };
        return requestId;
      }

      bridge.subscribeClipboardResult?.((result) => {
        if (!hostPolicy?.structuralPaste || result.clipboardRequestId !== pendingCopy?.requestId) return;
        copiedBranch = result.ok === true ? pendingCopy : undefined;
        pendingCopy = undefined;
      });

      function confirmPastedBranch(message) {
        const paste = pendingPaste;
        if (!paste?.applied || message.document?.uri !== thoughtforgeDocumentUri || message.document?.version <= paste.baseVersion) return;
        pendingPaste = undefined;
        const map = thoughtforgeState.map, parent = map?.nodesById?.[paste.parentId];
        if (!parent || parent.children.length !== paste.index + 1) return;
        const rootId = parent.children[paste.index], pending = [{ id: rootId, expected: paste.subtree }];
        while (pending.length) {
          const { id, expected } = pending.pop(), node = map.nodesById[id];
          if (!node || node.text !== expected.text || node.children.length !== expected.children.length) return;
          for (let i = 0; i < expected.children.length; i++) pending.push({ id: node.children[i], expected: expected.children[i] });
        }
        thoughtforgeState.selectedNodeId = rootId;
        thoughtforgeState.editingNodeId = undefined;
        thoughtforgeState.editingSurface = undefined;
        thoughtforgeState.preferredEditSurface = paste.surface;
        thoughtforgeState.collapsedNodeIds.delete(paste.parentId);
        revealNodeAncestors(rootId);
      }

      function handleThoughtForgePaste(event) {
        if(hostPolicy?.pasteBranch && !isTextEditingTarget(event.target) && isMindMapOrOutlineCopyTarget(event.target) && !hasRegularTextSelection()) {
          if(isNodeTextEditingActive()||isTextComposing()||isImeCompositionShortcutEvent(event)||performance.now()-thoughtforgeState.lastCompositionEndAt<IME_COMMIT_MS)return;
          if(dispatchMapCommand('map-paste-branch',false,{pasteText:event.clipboardData?.getData('text/plain')??''}).status==='admitted')event.preventDefault();return;
        }
        if (concentrationView && !isTextEditingTarget(event.target) && localCommandBlocked('map-paste-branch')) return;
        if (!canOperateOnVisibleNode()) return;
        if (!hostPolicy?.structuralPaste || isNodeTextEditingActive() || isTextEditingTarget(event.target) ||
            !isMindMapOrOutlineCopyTarget(event.target) || hasRegularTextSelection() || isTextComposing() || isImeCompositionShortcutEvent(event) ||
            performance.now() - thoughtforgeState.lastCompositionEndAt < IME_COMMIT_MS) return;
        event.preventDefault();
        const parent = thoughtforgeState.map?.nodesById?.[thoughtforgeState.selectedNodeId];
        if (!parent || !copiedBranch || event.clipboardData?.getData("text/plain") !== copiedBranch.markdownText ||
            pendingPaste || thoughtforgeState.pendingCommandRequests.size || thoughtforgeState.pendingOptimisticNodes.size) return;
        const requestId = nextThoughtForgeCommandRequestId();
        const command = { type: "node.insertSubtree", parentId: parent.id, index: parent.children.length, subtree: copiedBranch.subtree };
        pendingPaste = { requestId, parentId: parent.id, index: parent.children.length, subtree: copiedBranch.subtree,
          baseVersion: thoughtforgeState.lastDocumentVersion, surface: activeDirectEditSurface(), applied: false };
        rememberCommandRequest(requestId, createCommandRequestTransaction(command));
        postThoughtForgeWebviewMessage({
          type: "thoughtforge.command",
          requestId, command });
      }

      function handleThoughtForgeCopy(event) {
        if (!shouldCopyMindMapSelection(event)) {
          clearBranchCopy();
          return;
        }
        if (concentrationView && hostPolicy?.mapCommandGate) { dispatchMapCommand('map-copy-subtree-markdown',false,{copyEvent:event}); return; }
        const markdown = selectedNodeMarkdown("subtree");
        if (!markdown) {
          return;
        }
        event.preventDefault();
        clearBranchCopy();
        event.clipboardData?.setData("text/plain", markdown);
        if (hostPolicy?.structuralPaste) postClipboardWrite("subtree");
        if (copyStatusElement) {
          copyStatusElement.textContent = "サブツリーMarkdownをコピーしました。";
        }
      }

      function handleThoughtForgeCopyShortcut(event) {
        if (event.key?.toLowerCase?.() !== "c" || (!event.metaKey && !event.ctrlKey) || event.altKey) {
          return;
        }
        if (!shouldCopyMindMapSelection(event)) {
          clearBranchCopy();
          return;
        }
        event.preventDefault();
        localMapCommand('map-copy-subtree-markdown', () => postClipboardWrite('subtree'));
      }

      function resetMapDropIndicators() {
        document.querySelectorAll(".thoughtforge-map-node").forEach((element) => {
          element.dataset.dragTarget = "false";
          element.dataset.dropPosition = "";
          element.dataset.dropDisabled = "false";
        });
        document.querySelectorAll(".thoughtforge-map-column").forEach((element) => {
          element.dataset.dropPosition = "";
        });
        clearMapColumnDropMarkers();
      }

      function resetMapDragIndicators() {
        document.querySelectorAll(".thoughtforge-map-node").forEach((element) => {
          element.dataset.dragging = "false";
        });
        document.querySelectorAll(".thoughtforge-map-drag-preview").forEach((element) => {
          element.remove();
        });
        resetMapDropIndicators();
      }

      function clearMapColumnDropMarkers() {
        document.querySelectorAll(".thoughtforge-map-branch").forEach((element) => {
          delete element.dataset.columnDropBefore;
          delete element.dataset.columnDropAfter;
        });
      }

      function setMapColumnDropMarker(columnElement, rawIndex) {
        clearMapColumnDropMarkers();
        if (!(columnElement instanceof Element)) {
          return;
        }
        const branches = Array.from(columnElement.querySelectorAll(":scope > .thoughtforge-map-branch"))
          .filter((element) => element instanceof HTMLElement);
        if (branches.length === 0) {
          return;
        }
        const markerIndex = Math.max(0, Math.min(rawIndex, branches.length));
        if (markerIndex >= branches.length) {
          branches[branches.length - 1].dataset.columnDropAfter = "true";
          return;
        }
        branches[markerIndex].dataset.columnDropBefore = "true";
      }

      function resetMapDragState() {
        thoughtforgeState.draggedMapNodeId = undefined;
        thoughtforgeState.dragOverMapNodeId = undefined;
        thoughtforgeState.dragOverMapDropPosition = undefined;
        thoughtforgeState.dragOverMapColumnSide = undefined;
        thoughtforgeState.dragOverMapColumnParentId = undefined;
        thoughtforgeState.dragOverMapColumnRawIndex = undefined;
        clearMapColumnBoundsCache();
        resetMapDragIndicators();
      }

      function isImeCompositionShortcutEvent(event) {
        return Boolean(
          event.isComposing ||
          thoughtforgeState.isComposingText ||
          event.keyCode === 229 ||
          isRecentImeCommit(event)
        );
      }

      function isRecentImeCommit(event) {
        return (event.key === "Enter" || event.key === "Tab") && performance.now() - thoughtforgeState.lastCompositionEndAt < IME_COMMIT_MS;
      }

      function shouldHandleDirectEditClassicShortcut(event) {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }
        return !isImeCompositionShortcutEvent(event);
      }

      function clearStaleImeState(event) {
        if (event instanceof InputEvent) {
          const inputType = typeof event.inputType === "string" ? event.inputType : "";
          if (event.isComposing || inputType.toLowerCase().includes("composition")) {
            return;
          }
        }
        if (!event?.isComposing && event?.keyCode !== 229 && event?.key !== "Enter") {
          thoughtforgeState.isComposingText = false;
        }
      }

      function isTextComposing() { return thoughtforgeState.isComposingText && isTextEditingTarget(document.activeElement); }
      function isCompositionInputEvent(event) {
        if (!(event instanceof InputEvent)) {
          return false;
        }
        const inputType = typeof event.inputType === "string" ? event.inputType.toLowerCase() : "";
        return event.isComposing === true || inputType.includes("composition");
      }
      function isCancelledCommandNode(nodeId) {
        return (
          typeof nodeId === "string" &&
          thoughtforgeState.cancelledCommandNodeIds.has(nodeId)
        );
      }
      function startImeFromInputFallback(event, input, nodeId, surface) {
        if (!isCompositionInputEvent(event) || isCancelledCommandNode(nodeId)) {
          return;
        }
        if (!thoughtforgeState.isComposingText) {
          recordImeDebugTrace("compositionstart-fallback", { ...eventDebugSummary(event), nodeId, surface, value: input.value });
          traceDebugEvent({
            scope: "ime",
            event: "compositionstart-fallback",
            nodeId,
            payload: { ...eventDebugSummary(event), surface, textLength: input.value.length }
          });
          thoughtforgeState.isComposingText = true;
          thoughtforgeState.directKeyQueue = [];
          cancelDirectRenameFocusRetry();
        }
        ensureDirectEditSession(nodeId, surface, { phase: "composing", latestText: input.value });
      }
      function beginIme(event) {
        const nodeId = event?.target?.dataset?.nodeId;
        if (isCancelledCommandNode(nodeId)) {
          thoughtforgeState.isComposingText = false;
          recordImeDebugTrace("compositionstart-ignored-cancelled-command", {
            ...eventDebugSummary(event),
            nodeId
          });
          return;
        }
        recordImeDebugTrace("compositionstart", eventDebugSummary(event));
        traceDebugEvent({
          scope: "ime",
          event: "compositionstart",
          nodeId: event?.target?.dataset?.nodeId,
          payload: eventDebugSummary(event)
        });
        thoughtforgeState.isComposingText = true;
        thoughtforgeState.directKeyQueue = [];
        if (event?.target instanceof HTMLInputElement && event.target.dataset.nodeId) {
          if (isImeCap(event.target)) {
            promoteImeCap(event.target);
          }
          ensureDirectEditSession(event.target.dataset.nodeId, event.target.dataset.editSurface, { phase: "composing", latestText: event.target.value });
        }
        if (isTextEditingTarget(event?.target)) {
          cancelDirectRenameFocusRetry();
        }
      }
      function endImeForInput(input, nodeId, surface, reason, event) {
        if (isCancelledCommandNode(nodeId)) {
          thoughtforgeState.isComposingText = false;
          thoughtforgeState.deferredModelUpdate = undefined;
          releaseCancelledCommandNodeAfterEvent(nodeId);
          recordImeDebugTrace("compositionend-ignored-cancelled-command", {
            ...eventDebugSummary(event),
            nodeId,
            surface
          });
          return;
        }
        recordImeDebugTrace(reason, { ...eventDebugSummary(event), nodeId, surface, value: input.value });
        traceDebugEvent({
          scope: "ime",
          event: reason,
          nodeId,
          payload: {
            ...eventDebugSummary(event),
            surface,
            textLength: input.value.length
          },
          result: "ok"
        });
        ensureDirectEditSession(nodeId, surface, { phase: "committing", latestText: input.value });
        syncOptimisticDraftInputValue(nodeId, input.value);
        thoughtforgeState.isComposingText = false;
        thoughtforgeState.lastCompositionEndAt = performance.now();
        const bufferedDirectEditModelUpdate = takeBufferedDirectEditModelUpdate();
        const deferredModelUpdate = bufferedDirectEditModelUpdate ?? thoughtforgeState.deferredModelUpdate;
        thoughtforgeState.deferredModelUpdate = undefined;
        if (deferredModelUpdate || thoughtforgeState.directEditSession) {
          scheduleDeferredModelUpdateAfterIme(deferredModelUpdate, input);
        }
      }
      function endImeFromInputFallback(event, input, nodeId, surface) {
        if (!(event instanceof InputEvent) || !thoughtforgeState.isComposingText || event.isComposing) {
          return false;
        }
        const inputType = typeof event.inputType === "string" ? event.inputType.toLowerCase() : "";
        if (!inputType) {
          return false;
        }
        endImeForInput(input, nodeId, surface, "compositionend-fallback", event);
        return true;
      }
      function endIme(event) {
        recordImeDebugTrace("compositionend", eventDebugSummary(event));
        traceDebugEvent({
          scope: "ime",
          event: "compositionend",
          nodeId: event?.target?.dataset?.nodeId,
          payload: {
            ...eventDebugSummary(event),
            textLength: event?.target instanceof HTMLInputElement ? event.target.value.length : undefined
          },
          result: "ok"
        });
        if (event?.target instanceof HTMLInputElement && event.target.dataset.nodeId) {
          endImeForInput(event.target, event.target.dataset.nodeId, event.target.dataset.editSurface, "compositionend-input", event);
          return;
        }
        thoughtforgeState.isComposingText = false;
        thoughtforgeState.lastCompositionEndAt = performance.now();
        const buffered = takeBufferedDirectEditModelUpdate();
        const deferredModelUpdate = buffered ?? thoughtforgeState.deferredModelUpdate ?? hostPolicy?.stageModel?.();
        thoughtforgeState.deferredModelUpdate = undefined;
        if (deferredModelUpdate || thoughtforgeState.directEditSession) {
          scheduleDeferredModelUpdateAfterIme(deferredModelUpdate, event?.target);
        }
      }

      function scheduleDeferredModelUpdateAfterIme(deferred, target) {
        hostPolicy?.stageModel?.(deferred);
        const shouldRestoreImeInputFocus =
          target instanceof HTMLInputElement && Boolean(target.dataset.nodeId);
        const scheduledAt = performance.now();
        const e=hostPolicy?.inputEpoch?.(),s=thoughtforgeState.directEditSession;
        setTimeout(() => {
          if(hostPolicy&&(hostPolicy.inputBlocked?.()||hostPolicy.inputEpoch?.()!==e||thoughtforgeState.isComposingText||thoughtforgeState.directEditSession!==s)){
            hostPolicy.flushModel?.(); return;
          }
          recordImeDebugTrace("deferred-model-update-after-ime", { hasDeferredModelUpdate: Boolean(deferred), target: elementDebugSummary(target) });
          if (target instanceof HTMLInputElement && target.dataset.nodeId) {
            syncOptimisticDraftInputValue(target.dataset.nodeId, target.value);
          }
          const nextModel=hostPolicy?.takeModel?hostPolicy.takeModel():takeBufferedDirectEditModelUpdate()??deferred;
          if (nextModel) {
            applyModelUpdate(nextModel);
          }
          const activeTextTarget = document.activeElement;
          const hasDifferentTextFocus =
            isTextEditingTarget(activeTextTarget) &&
            (!(activeTextTarget instanceof HTMLInputElement) ||
              activeTextTarget.dataset.nodeId !== thoughtforgeState.editingNodeId);
          if (
            shouldRestoreImeInputFocus &&
            thoughtforgeState.editingNodeId &&
            thoughtforgeState.lastPointerDownAt <= scheduledAt &&
            !hasDifferentTextFocus
          ) {
            focusDirectRenameInputImmediately(
              thoughtforgeState.editingNodeId,
              target.dataset.editSurface
            );
          }
          if (thoughtforgeState.directEditSession) {
            thoughtforgeState.directEditSession.phase = "idle";
          }
        }, 0);
      }

      function handleThoughtForgeEditCommand(commandType, options = {}) {
        if (concentrationView && hostPolicy?.mapCommandGate && !commandHandling) {
          const operation = localEditCommandIds[commandType];
          if (operation) return dispatchMapCommand('map-' + operation, false, { ...options, commandType });
        }
        if (!canOperateOnVisibleNode(options.nodeId ?? thoughtforgeState.selectedNodeId)) return;
        if (hostPolicy?.inputBlocked?.()) return;
        const commandSurface = normalizeEditSurface(options.surface) ?? activeDirectEditSurface();
        thoughtforgeState.preferredEditSurface = commandSurface;
        const node = options.nodeId
          ? thoughtforgeState.map?.nodesById?.[options.nodeId]
          : selectedNode();
        if (!node) {
          traceDebugEvent({
            scope: "command",
            event: "ignored",
            command: commandType,
            payload: { commandSurface },
            result: "ignored",
            reason: "no selected node"
          });
          return;
        }
        thoughtforgeState.selectedNodeId = node.id;
        if (Object.prototype.hasOwnProperty.call(options, "nextText")) {
          recordImeDebugTrace("direct-input-command-next-text", {
            reason: "handleThoughtForgeEditCommand",
            commandType,
            nextText: normalizeMarkdownNodeInputText(options.nextText),
            ...directInputPipelineSnapshot(node.id, commandSurface)
          });
        }
        traceDebugEvent({
          scope: "command",
          event: "dispatch",
          command: commandType,
          nodeId: node.id,
          payload: { commandSurface, options }
        });

        if (commandType === "node.rename") {
          postThoughtForgeCommand({
            type: "node.rename",
            nodeId: node.id,
            nextText: renameInput?.value ?? node.text
          });
          return;
        }

        if (commandType === "node.updateNote") {
          const note = String(options.note ?? nodeNoteEditor?.value ?? "");
          postThoughtForgeCommand({
            type: "node.updateNote",
            nodeId: node.id,
            note
          });
          return;
        }

        if (commandType === "node.clearNote") {
          if (nodeNoteEditor) {
            nodeNoteEditor.value = "";
          }
          postThoughtForgeCommand({
            type: "node.clearNote",
            nodeId: node.id
          });
          return;
        }

        if (commandType === "node.insertSibling") {
          const nextNodeId = nextGeneratedNodeId();
          const nextParentId = parentIdForNode(node.id) ?? null;
          const siblings = childrenForParent(nextParentId);
          const siblingIndex = siblings.indexOf(node.id);
          const nextIndex =
            options.where === "before"
              ? Math.max(0, siblingIndex)
              : siblingIndex === -1
                ? siblings.length
                : siblingIndex + 1;
          thoughtforgeState.selectedNodeId = nextNodeId;
          thoughtforgeState.editingNodeId = nextNodeId;
          thoughtforgeState.editingSurface = commandSurface;
          thoughtforgeState.pendingFocusNodeId = nextNodeId;
          thoughtforgeState.pendingFocusSurface = commandSurface;
          thoughtforgeState.pendingFocusTarget = {
            type: "sibling",
            siblingId: node.id,
            where: options.where ?? "after",
            parentId: nextParentId,
            index: nextIndex,
            siblingCount: siblings.length
          };
          if (renameInput) {
            renameInput.value = "";
          }
          insertOptimisticSibling(node.id, nextNodeId, options.where ?? "after", commandSurface);
          return;
        }

        if (commandType === "node.renameAndInsertSibling") {
          const nextNodeId = nextGeneratedNodeId();
          const nextParentId = parentIdForNode(node.id) ?? null;
          const siblings = childrenForParent(nextParentId);
          const siblingIndex = siblings.indexOf(node.id);
          const nextIndex =
            options.where === "before"
              ? Math.max(0, siblingIndex)
              : siblingIndex === -1
                ? siblings.length
                : siblingIndex + 1;
          const nextText = normalizeMarkdownNodeInputText(options.nextText ?? node.text);
          const committedOptimisticDraft = commitOptimisticDraftNode(node.id, nextText);
          const shouldPostAtomicCommand = !committedOptimisticDraft && nextText !== node.text;
          const requestId = shouldPostAtomicCommand ? registerRenameRequest({ nodeId: node.id, nextText }) : undefined;
          if (nextText !== "") {
            if (!committedOptimisticDraft) {
              clearCommittedDraftNode(node.id);
            }
          }
          thoughtforgeState.selectedNodeId = nextNodeId;
          thoughtforgeState.editingNodeId = nextNodeId;
          thoughtforgeState.editingSurface = commandSurface;
          thoughtforgeState.pendingFocusNodeId = nextNodeId;
          thoughtforgeState.pendingFocusSurface = commandSurface;
          thoughtforgeState.pendingFocusTarget = {
            type: "sibling",
            siblingId: node.id,
            where: options.where ?? "after",
            parentId: nextParentId,
            index: nextIndex,
            siblingCount: siblings.length
          };
          if (renameInput) {
            renameInput.value = "";
          }
          insertOptimisticSibling(node.id, nextNodeId, options.where ?? "after", commandSurface);
          if (shouldPostAtomicCommand) {
            const nextMeta = thoughtforgeState.pendingOptimisticNodes.get(nextNodeId);
            const dispatch = postThoughtForgeCommand({
              type: "node.renameAndInsertSibling",
              nodeId: node.id,
              nextText,
              where: options.where ?? "after",
              nextNodeId,
              text: ""
            }, requestId);
            if (nextMeta) {
              nextMeta.commandQueued = dispatch === "queued";
              nextMeta.commandPosted = dispatch === "posted";
              nextMeta.expectedText = "";
            }
          }
          return;
        }

        if (commandType === "node.insertChild") {
          const nextNodeId = nextGeneratedNodeId();
          const children = childrenForParent(node.id);
          thoughtforgeState.selectedNodeId = nextNodeId;
          thoughtforgeState.editingNodeId = nextNodeId;
          thoughtforgeState.editingSurface = commandSurface;
          thoughtforgeState.pendingFocusNodeId = nextNodeId;
          thoughtforgeState.pendingFocusSurface = commandSurface;
          thoughtforgeState.pendingFocusTarget = {
            type: "child",
            parentId: node.id,
            index: children.length,
            childCount: children.length
          };
          if (renameInput) {
            renameInput.value = "";
          }
          insertOptimisticChild(node.id, nextNodeId, commandSurface);
          return;
        }

        if (commandType === "node.renameAndInsertChild") {
          const nextNodeId = nextGeneratedNodeId();
          const children = childrenForParent(node.id);
          const nextText = normalizeMarkdownNodeInputText(options.nextText ?? node.text);
          const committedOptimisticDraft = commitOptimisticDraftNode(node.id, nextText);
          const shouldPostAtomicCommand = !committedOptimisticDraft && nextText !== node.text;
          const requestId = shouldPostAtomicCommand ? registerRenameRequest({ nodeId: node.id, nextText }) : undefined;
          if (nextText !== "") {
            if (!committedOptimisticDraft) {
              clearCommittedDraftNode(node.id);
            }
          }
          thoughtforgeState.selectedNodeId = nextNodeId;
          thoughtforgeState.editingNodeId = nextNodeId;
          thoughtforgeState.editingSurface = commandSurface;
          thoughtforgeState.pendingFocusNodeId = nextNodeId;
          thoughtforgeState.pendingFocusSurface = commandSurface;
          thoughtforgeState.pendingFocusTarget = {
            type: "child",
            parentId: node.id,
            index: children.length,
            childCount: children.length
          };
          if (renameInput) {
            renameInput.value = "";
          }
          insertOptimisticChild(node.id, nextNodeId, commandSurface);
          if (shouldPostAtomicCommand) {
            const nextMeta = thoughtforgeState.pendingOptimisticNodes.get(nextNodeId);
            const dispatch = postThoughtForgeCommand({
              type: "node.renameAndInsertChild",
              nodeId: node.id,
              nextText,
              index: children.length,
              nextNodeId,
              text: ""
            }, requestId);
            if (nextMeta) {
              nextMeta.commandQueued = dispatch === "queued";
              nextMeta.commandPosted = dispatch === "posted";
              nextMeta.expectedText = "";
            }
          }
          return;
        }

        if (commandType === "node.delete" || commandType === "node.deleteKeepChildren") {
          postThoughtForgeCommand({
            type: commandType,
            nodeId: node.id
          });
          return;
        }

        if (commandType === "node.indent") {
          postThoughtForgeCommand({
            type: "node.indent",
            nodeId: node.id
          });
          return;
        }

        if (commandType === "node.outdent") {
          if (options.keepEditing === true && thoughtforgeState.editingNodeId === node.id) {
            thoughtforgeState.editingSurface = commandSurface;
            thoughtforgeState.pendingEditingRefocusNodeId = node.id;
            thoughtforgeState.pendingFocusSurface = commandSurface;
          }
          postThoughtForgeCommand({
            type: "node.outdent",
            nodeId: node.id
          });
          return;
        }

        if (commandType === "node.move") {
          const nextParentId = reparentSelect?.value || null;
          if (!isValidReparentTarget(node.id, nextParentId) || !isFocusSafeReparentTarget(node.id, nextParentId)) {
            return;
          }
          postThoughtForgeCommand({
            type: "node.move",
            nodeId: node.id,
            nextParentId,
            nextIndex: nextMoveIndex(node.id, nextParentId)
          });
        }
      }

      function moveSelectedNodeWithinSiblings(delta) {
        if (!canOperateOnVisibleNode()) return false;
        const node = selectedNode();
        if (!node) {
          return false;
        }

        const parentId = parentIdForNode(node.id) ?? null;
        const siblings = childrenForParent(parentId);
        const currentIndex = siblings.indexOf(node.id);
        const nextIndex = currentIndex + delta;
        if (currentIndex === -1 || nextIndex < 0 || nextIndex >= siblings.length) {
          return false;
        }

        postThoughtForgeCommand({
          type: "node.move",
          nodeId: node.id,
          nextParentId: parentId,
          nextIndex
        });
        return true;
      }

      function moveSelectedNodeUnderTarget(nextParentId) {
        const node = selectedNode();
        if (!node || !isMeaningfulReparentTarget(node.id, nextParentId) || !isFocusSafeReparentTarget(node.id, nextParentId)) {
          return;
        }
        thoughtforgeState.isPickingReparentTarget = false;
        postThoughtForgeCommand({
          type: "node.move",
          nodeId: node.id,
          nextParentId,
          nextIndex: nextMoveIndex(node.id, nextParentId)
        });
      }

      function draggedThoughtForgeNodeId(event) {
        return (
          event.dataTransfer?.getData(THOUGHTFORGE_MAP_DRAG_MIME) ||
          event.dataTransfer?.getData("text/plain") ||
          thoughtforgeState.draggedMapNodeId
        );
      }

      function canDropMapNodeOnTarget(nodeId, nextParentId) {
        return Boolean(
          nodeId &&
          nextParentId &&
          ((isMeaningfulReparentTarget(nodeId, nextParentId) && isFocusSafeReparentTarget(nodeId, nextParentId)) ||
            canDropMapNodeBesideTarget(nodeId, nextParentId))
        );
      }

      function canDropMapNodeBesideTarget(nodeId, targetNodeId) {
        if (!nodeId || !targetNodeId || nodeId === targetNodeId) {
          return false;
        }
        if (!thoughtforgeState.map?.nodesById?.[nodeId] || !thoughtforgeState.map?.nodesById?.[targetNodeId]) {
          return false;
        }
        const currentParentId = normalizedParentId(parentIdForNode(nodeId));
        const targetParentId = normalizedParentId(parentIdForNode(targetNodeId));
        return currentParentId === targetParentId && isFocusSafeReparentTarget(nodeId, targetParentId);
      }

      function mapDropPosition(event, targetElement) {
        const bounds = targetElement.getBoundingClientRect();
        const ratio = bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
        if (ratio < ${THOUGHTFORGE_MAP_DROP_BEFORE_RATIO}) {
          return "before";
        }
        if (ratio > ${THOUGHTFORGE_MAP_DROP_AFTER_RATIO}) {
          return "after";
        }
        return "inside";
      }

      function resolveMapDropIntent(event, nodeId, targetNodeId, targetElement) {
        const dropPosition = mapDropPosition(event, targetElement);
        if (dropPosition !== "inside" && canDropMapNodeBesideTarget(nodeId, targetNodeId)) {
          return {
            type: "sibling",
            nextParentId: normalizedParentId(parentIdForNode(targetNodeId)),
            position: dropPosition
          };
        }
        if (
          nodeId &&
          targetNodeId &&
          isMeaningfulReparentTarget(nodeId, targetNodeId) &&
          isFocusSafeReparentTarget(nodeId, targetNodeId)
        ) {
          return {
            type: "reparent",
            nextParentId: targetNodeId,
            position: "inside"
          };
        }
        return undefined;
      }

      function nextSiblingDropIndex(nodeId, targetNodeId, position) {
        const siblings = childrenForParent(parentIdForNode(targetNodeId) ?? null);
        const currentIndex = siblings.indexOf(nodeId);
        const targetIndex = siblings.indexOf(targetNodeId);
        if (currentIndex === -1 || targetIndex === -1 || nodeId === targetNodeId) {
          return -1;
        }
        const rawIndex = position === "before" ? targetIndex : targetIndex + 1;
        return Math.max(0, Math.min(rawIndex - (currentIndex < rawIndex ? 1 : 0), siblings.length - 1));
      }

      function resolveMapColumnDropIntent(event, nodeId, parentId, columnElement) {
        const nextParentId = parentId === THOUGHTFORGE_MAP_TITLE_ROOT_ID ? null : (parentId || null);
        const siblings = childrenForParent(nextParentId);
        const currentIndex = siblings.indexOf(nodeId);
        if (currentIndex === -1 || normalizedParentId(parentIdForNode(nodeId)) !== normalizedParentId(nextParentId)) {
          return undefined;
        }
        if (!isFocusSafeReparentTarget(nodeId, nextParentId)) {
          return undefined;
        }
        let rawIndex = 0;
        for (const branch of columnElement.querySelectorAll(":scope > .thoughtforge-map-branch")) {
          const nodeElement = branch.querySelector(":scope > .thoughtforge-map-node");
          if (nodeElement instanceof HTMLElement) {
            const bounds = nodeElement.getBoundingClientRect();
            if (event.clientY < bounds.top + bounds.height / 2) {
              break;
            }
          }
          rawIndex += 1;
        }
        const indexOffset = Number(columnElement.dataset?.indexOffset) || 0;
        const siblingIndex = Math.max(0, Math.min(rawIndex + indexOffset, siblings.length));
        const nextIndex = Math.max(0, Math.min(siblingIndex - (currentIndex < siblingIndex ? 1 : 0), siblings.length - 1));
        if (nextIndex === currentIndex) {
          return undefined;
        }
        return {
          type: "sibling-column",
          nextParentId,
          nextIndex,
          rawIndex,
          position: "between"
        };
      }

      function moveDraggedMapNodeWithIntent(nodeId, targetNodeId, intent) {
        if (!intent || !thoughtforgeState.map.nodesById[nodeId]) {
          return false;
        }
        if (intent.type === "sibling") {
          const nextIndex = nextSiblingDropIndex(nodeId, targetNodeId, intent.position);
          const currentIndex = childrenForParent(intent.nextParentId).indexOf(nodeId);
          if (nextIndex === -1 || nextIndex === currentIndex) {
            return false;
          }
          applyOptimisticMove(nodeId, intent.nextParentId, nextIndex);
          postThoughtForgeCommand({
            type: "node.move",
            nodeId,
            nextParentId: intent.nextParentId,
            nextIndex
          });
          return true;
        }
        if (intent.type === "sibling-column") {
          applyOptimisticMove(nodeId, intent.nextParentId, intent.nextIndex);
          postThoughtForgeCommand({
            type: "node.move",
            nodeId,
            nextParentId: intent.nextParentId,
            nextIndex: intent.nextIndex
          });
          return true;
        }
        return moveDraggedMapNodeUnderTarget(nodeId, intent.nextParentId);
      }

      function moveDraggedMapNodeUnderTarget(nodeId, nextParentId) {
        if (!canDropMapNodeOnTarget(nodeId, nextParentId)) {
          return false;
        }
        const nextIndex = nextMoveIndex(nodeId, nextParentId);
        applyOptimisticMove(nodeId, nextParentId, nextIndex);
        postThoughtForgeCommand({
          type: "node.move",
          nodeId,
          nextParentId,
          nextIndex
        });
        return true;
      }

      function focusRenameInput() {
        if (!canOperateOnVisibleNode()) return false;
        if (!thoughtforgeState.selectedNodeId) {
          return false;
        }
        const directInput = directRenameInputForNode(thoughtforgeState.selectedNodeId);
        if (promoteImeCap(directInput)) {
          directInput.focus();
          directInput.select();
          return true;
        }
        thoughtforgeState.editingNodeId = thoughtforgeState.selectedNodeId;
        thoughtforgeState.editingSurface = activeDirectEditSurface();
        renderThoughtForgeMap();
        if (focusDirectRenameInput(thoughtforgeState.selectedNodeId, { select: true, surface: thoughtforgeState.editingSurface })) {
          return true;
        }

        if (!renameInput) {
          return false;
        }

        renameInput.focus();
        renameInput.select();
        return true;
      }

      function directRenameInputForNode(nodeId, surface = activeDirectEditSurface()) {
        const selector =
          surface === "map"
            ? "[data-thoughtforge-map-direct-rename-input]"
            : "[data-thoughtforge-outline-direct-rename-input]";
        return Array.from(document.querySelectorAll(selector))
          .find(
          (input) => input instanceof HTMLInputElement && input.dataset.nodeId === nodeId
        );
      }

      function shouldKeepDirectRenameFocus(nodeId, directInput) {
        if (thoughtforgeState.editingNodeId !== nodeId) {
          return false;
        }
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLInputElement &&
          activeElement.dataset.nodeId === nodeId &&
          (activeElement.hasAttribute("data-thoughtforge-map-direct-rename-input") ||
            activeElement.hasAttribute("data-thoughtforge-outline-direct-rename-input"))
        ) {
          return true;
        }
        return !(
          activeElement instanceof Element &&
          activeElement !== directInput &&
          isTextEditingTarget(activeElement)
        );
      }

      function focusDirectRenameInput(nodeId, options = {}) {
        const surface = normalizeEditSurface(options.surface) ?? activeDirectEditSurface();
        const directInput = directRenameInputForNode(nodeId, surface);
        traceDebugEvent({
          scope: "focus",
          event: "request",
          nodeId,
          payload: { surface, force: options.force === true, select: options.select === true }
        });
        if (directInput instanceof HTMLInputElement) {
          const focused = document.activeElement === directInput;
          const forceFocus = options.force === true;
          if (!forceFocus && isTextComposing() && !focused) {
            recordImeDebugTrace("focus-direct-blocked-composing", { nodeId, surface, forceFocus, focused });
            traceDebugEvent({
              scope: "focus",
              event: "failed",
              nodeId,
              payload: { surface, forceFocus, focused },
              result: "failed",
              reason: "IME composing"
            });
            return false;
          }
          if (!forceFocus && !shouldKeepDirectRenameFocus(nodeId, directInput)) {
            recordImeDebugTrace("focus-direct-blocked-active-text-target", { nodeId, surface, forceFocus, focused });
            traceDebugEvent({
              scope: "focus",
              event: "failed",
              nodeId,
              payload: { surface, forceFocus, focused },
              result: "failed",
              reason: "active text target"
            });
            return false;
          }
          thoughtforgeState.preferredEditSurface = surface;
          thoughtforgeState.editingSurface = surface;
          if (!focused) {
            directInput.focus();
          }
          recordImeDebugTrace("focus-direct-result", { nodeId, surface, forceFocus, wasFocused: focused, nowFocused: document.activeElement === directInput });
          traceDebugEvent({
            scope: "focus",
            event: "applied",
            nodeId,
            payload: { surface, forceFocus, wasFocused: focused },
            result: document.activeElement === directInput ? "ok" : "failed"
          });
          if (isTextComposing()) {
            return true;
          }
          if (options.select === true) {
            directInput.select();
          } else if (!focused) {
            const cursorPosition = directInput.value.length;
            directInput.setSelectionRange(cursorPosition, cursorPosition);
          }
          return true;
        }
        recordImeDebugTrace("focus-direct-missing-input", { nodeId, surface, forceFocus: options.force === true });
        traceDebugEvent({
          scope: "focus",
          event: "failed",
          nodeId,
          payload: { surface, forceFocus: options.force === true },
          result: "failed",
          reason: "missing input"
        });
        return false;
      }

      function isReplayableDirectEditTextKey(event) {
        return Boolean(
          event.key.length === 1 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !isImeCompositionShortcutEvent(event)
        );
      }

      function clearPendingDirectEditKeys(nodeId) {
        const q = thoughtforgeState.directKeyQueue;
        if (!q.length) {
          return;
        }
        thoughtforgeState.directKeyQueue = nodeId
          ? q.filter((queuedKey) => queuedKey.nodeId !== nodeId)
          : [];
      }

      function isCurrentDirectRenameFocusRequest(token) {
        if (token.cancelled || token.epoch !== thoughtforgeState.focusRetryEpoch ||
            token.inputEpoch !== hostPolicy?.inputEpoch?.() || hostPolicy?.inputBlocked?.() ||
            shellElement?.closest('[inert]') || isTextComposing() ||
            thoughtforgeState.editingNodeId !== token.nodeId || activeDirectEditSurface() !== token.surface) return false;
        const active = document.activeElement;
        return active === document.body || active === token.focusOwner ||
          active === directRenameInputForNode(token.nodeId, token.surface);
      }

      function scheduleDirectRenameFocus(nodeId, options = {}) {
        cancelDirectRenameFocusRetry();
        const surface = normalizeEditSurface(options.surface) ?? activeDirectEditSurface();
        thoughtforgeState.preferredEditSurface = surface;
        if (thoughtforgeState.editingNodeId === nodeId) {
          thoughtforgeState.editingSurface = surface;
        }
        const retryToken = { nodeId, surface, cancelled: false, epoch: thoughtforgeState.focusRetryEpoch,
          inputEpoch: hostPolicy?.inputEpoch?.(), focusOwner: document.activeElement };
        thoughtforgeState.activeFocusRetryToken = retryToken;
        const scheduleFocus =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame
            : (listener) => setTimeout(listener, 0);
        const maxAttempts = 16;
        let attempt = 0;
        const settleFocus = () => {
          if (!isCurrentDirectRenameFocusRequest(retryToken)) {
            if (thoughtforgeState.activeFocusRetryToken === retryToken) {
              clearPendingDirectEditKeys(nodeId);
              thoughtforgeState.activeFocusRetryToken = undefined;
            }
            return;
          }
          const directInput = directRenameInputForNode(nodeId, retryToken.surface);
          if (!(directInput instanceof HTMLInputElement) || document.activeElement === directInput || isTextEditingTarget(document.activeElement)) {
            clearPendingDirectEditKeys(nodeId);
            thoughtforgeState.activeFocusRetryToken = undefined;
            return;
          }
          focusDirectRenameInput(nodeId, { surface: retryToken.surface });
          thoughtforgeState.activeFocusRetryToken = undefined;
        };
        const tryFocus = () => {
          if (!isCurrentDirectRenameFocusRequest(retryToken)) {
            if (thoughtforgeState.activeFocusRetryToken === retryToken) {
              clearPendingDirectEditKeys(nodeId);
              thoughtforgeState.activeFocusRetryToken = undefined;
            }
            return;
          }
          if (focusDirectRenameInput(nodeId, { surface: retryToken.surface })) {
            replayPendingDirectEditKeys(nodeId);
            setTimeout(settleFocus, 30);
            return;
          }
          if (attempt < maxAttempts) {
            const delay = attempt < 6 ? 25 : 75;
            attempt += 1;
            setTimeout(tryFocus, delay);
          } else {
            clearPendingDirectEditKeys(nodeId);
            thoughtforgeState.activeFocusRetryToken = undefined;
          }
        };
        scheduleFocus(tryFocus);
        return retryToken;
      }

      function cancelDirectRenameFocusRetry() {
        // The immediate frame may still be pending after the normal token retires.
        thoughtforgeState.focusRetryEpoch += 1;
        if (thoughtforgeState.activeFocusRetryToken) {
          clearPendingDirectEditKeys(thoughtforgeState.activeFocusRetryToken.nodeId);
          thoughtforgeState.activeFocusRetryToken.cancelled = true;
          thoughtforgeState.activeFocusRetryToken = undefined;
        }
      }

      function shouldPreserveDraftBlur(nodeId, event, input) {
        if (!isDraftLikeEmptyNode(nodeId)) {
          return false;
        }
        if (performance.now() - thoughtforgeState.lastPointerDownAt < 350) {
          return false;
        }
        const nextTarget = event.relatedTarget;
        return !(nextTarget instanceof Element && isTextEditingTarget(nextTarget));
      }

      function suppressNextDirectRenameBlur(input) { input.dataset.suppressBlurFinish = "1"; }

      function queueDirectEditKey(event) {
        recordImeDebugTrace("queue-direct-key-check", eventDebugSummary(event));
        const pendingNodeId =
          thoughtforgeState.activeFocusRetryToken?.nodeId ??
          thoughtforgeState.pendingFocusNodeId ??
          thoughtforgeState.editingNodeId;
        if (!pendingNodeId || thoughtforgeState.editingNodeId !== pendingNodeId || event.altKey || event.ctrlKey || event.metaKey || isImeCompositionShortcutEvent(event)) {
          return false;
        }
        const q = thoughtforgeState.directKeyQueue;
        if (isReplayableDirectEditTextKey(event)) {
          return false;
        }
        if (event.key !== "Enter" && event.key !== "Tab") {
          return false;
        }
        q.push({ type: "shortcut", key: event.key, shiftKey: event.shiftKey, nodeId: pendingNodeId });
        return true;
      }

      function renameAndInsertSiblingFromInput(nodeId, input, surface, shiftKey) {
        createEmptyDraft(nodeId, input);
        suppressNextDirectRenameBlur(input);
        handleThoughtForgeEditCommand("node.renameAndInsertSibling", { nodeId, nextText: normalizeMarkdownNodeInputText(input.value), surface, where: shiftKey ? "before" : "after" });
        return true;
      }

      function renameAndInsertChildFromInput(nodeId, input, surface) {
        createEmptyDraft(nodeId, input);
        suppressNextDirectRenameBlur(input);
        handleThoughtForgeEditCommand("node.renameAndInsertChild", { nodeId, nextText: normalizeMarkdownNodeInputText(input.value), surface });
        return true;
      }

      function replayPendingDirectEditKeys(nodeId) {
        const q = thoughtforgeState.directKeyQueue;
        if (!q.length) {
          return;
        }
        const surface =
          thoughtforgeState.activeFocusRetryToken?.surface ??
          thoughtforgeState.pendingFocusSurface ??
          activeDirectEditSurface();
        const directInput = directRenameInputForNode(nodeId, surface);
        if (!(directInput instanceof HTMLInputElement)) {
          return;
        }
        while (q.length && thoughtforgeState.editingNodeId === nodeId) {
          const queuedKey = q.shift();
          if (queuedKey.nodeId !== nodeId) {
            continue;
          }
          const surface = directInput.dataset.editSurface;
          if (queuedKey.key === "Enter") {
            renameAndInsertSiblingFromInput(nodeId, directInput, surface, queuedKey.shiftKey);
            break;
          }
          if (queuedKey.key === "Tab") {
            if (queuedKey.shiftKey) {
              break;
            }
            renameAndInsertChildFromInput(nodeId, directInput, surface);
            break;
          }
        }
      }

      function focusEditingDirectRenameInputForIme(event) {
        const nodeId = thoughtforgeState.editingNodeId;
        if (!nodeId || isTextEditingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }
        const directInput = directRenameInputForNode(nodeId);
        if (!(directInput instanceof HTMLInputElement)) {
          return false;
        }
        const surface = directInput.dataset.editSurface === "map" ? "map" : "outline";
        thoughtforgeState.preferredEditSurface = surface;
        thoughtforgeState.editingSurface = surface;
        return focusDirectRenameInput(nodeId, { surface });
      }

      function routeKeyToDirectRenameInput(event) {
        if (!canOperateOnVisibleNode()) return false;
        recordImeDebugTrace("route-direct-key-start", eventDebugSummary(event));
        const nodeId = thoughtforgeState.editingNodeId;
        if (!nodeId || isTextEditingTarget(event.target) || event.altKey || event.ctrlKey || event.metaKey) {
          return false;
        }
        if (isImeCompositionShortcutEvent(event)) {
          return false;
        }
        const directInput = directRenameInputForNode(nodeId);
        if (!(directInput instanceof HTMLInputElement)) {
          if (isReplayableDirectEditTextKey(event)) {
            const surface = activeDirectEditSurface();
            recordImeDebugTrace("direct-input-printable-focus-miss", {
              ...eventDebugSummary(event),
              nodeId,
              surface
            });
            renderThoughtForgeMap();
            focusDirectRenameInputImmediately(nodeId, surface);
            return true;
          }
          if (queueDirectEditKey(event)) {
            event.preventDefault();
            event.stopPropagation();
            scheduleDirectRenameFocus(nodeId, { surface: activeDirectEditSurface() });
            return true;
          }
          return false;
        }
        const surface = directInput.dataset.editSurface;
        const focusInput = () => {
          const nextSurface = surface === "map" ? "map" : "outline";
          thoughtforgeState.preferredEditSurface = nextSurface;
          thoughtforgeState.editingSurface = nextSurface;
          focusDirectRenameInput(nodeId, { surface: nextSurface });
        };
        const consumeEvent = () => {
          event.preventDefault();
          event.stopPropagation();
        };

        if (isReplayableDirectEditTextKey(event)) {
          focusInput();
          recordImeDebugTrace("direct-input-printable-native-resumed", {
            ...eventDebugSummary(event),
            nodeId,
            surface,
            focused: document.activeElement === directInput
          });
          return true;
        }

        if (event.key === "Enter" && shouldHandleDirectEditClassicShortcut(event)) {
          consumeEvent();
          focusInput();
          renameAndInsertSiblingFromInput(nodeId, directInput, surface, event.shiftKey);
          return true;
        }

        if (event.key === "Tab" && event.shiftKey && shouldHandleDirectEditClassicShortcut(event)) {
          consumeEvent();
          focusInput();
          return true;
        }

        if (event.key === "Tab" && !event.shiftKey && shouldHandleDirectEditClassicShortcut(event)) {
          consumeEvent();
          focusInput();
          renameAndInsertChildFromInput(nodeId, directInput, surface);
          return true;
        }

        if (event.key === "Escape") {
          consumeEvent();
          if (isCancellableEmptyDraftNode(nodeId)) {
            deleteEmptyDraftNode(nodeId);
            return true;
          }
          thoughtforgeState.editingNodeId = undefined;
          thoughtforgeState.editingSurface = undefined;
          thoughtforgeState.pendingEditingRefocusNodeId = undefined;
          thoughtforgeState.pendingFocusSurface = undefined;
          thoughtforgeState.directKeyQueue = [];
          renderThoughtForgeMap();
          return true;
        }

        return false;
      }

      function handleThoughtForgeShortcut(event) {
        recordImeDebugTrace("global-shortcut-keydown", eventDebugSummary(event));
        if (isImeCompositionShortcutEvent(event)) {
          focusEditingDirectRenameInputForIme(event);
          if ((event.key === "Enter" || event.key === "Tab") && !event.isComposing && event.keyCode !== 229) {
            event.preventDefault();
          }
          return;
        }
        if (event.key === 'Escape' && hasNoShortcutModifier(event)) {
          const id = thoughtforgeState.commandPaletteOpen ? 'map-close-command-palette' : thoughtforgeState.shortcutOverlayOpen ? 'map-close-shortcut-help' : undefined;
          if (id && concentrationView) { if(dispatchMapCommand(id,false).status==='admitted')event.preventDefault(); return; }
          if (closeThoughtForgeCommandSurfaces()) { event.preventDefault(); return; }
        }
        if (event.key === "/" && hasOnlyPrimaryShortcut(event)) {
          event.preventDefault();
          localMapCommand('map-open-command-palette',showThoughtForgeCommandPalette);
          return;
        }
        if (isTextEditingTarget(event.target)) {
          return;
        }
        if (event.key === "?" && hasNoShortcutModifier(event)) {
          event.preventDefault();
          localMapCommand('map-open-shortcut-help',showShortcutOverlay);
          return;
        }
        if (routeKeyToDirectRenameInput(event)) {
          return;
        }
        setPreferredEditSurfaceFromTarget(event.target);

        const key = event.key;
        const hasSelection = Boolean(selectedNode());
        if (concentrationView && hostPolicy?.mapCommandGate) {
          let id;
          if (hasNoShortcutModifier(event)) {
            id = {F2:'edit-title',ArrowUp:'select-previous',ArrowDown:'select-next',ArrowLeft:'select-left',ArrowRight:'select-right',f:'focus-selected',F:'focus-selected',Escape:'clear-focus','[':'focus-back',']':'focus-forward','.':'toggle-collapse',Enter:'insert-sibling-after',Tab:'insert-child',Delete:'delete-branch',Backspace:'delete-branch'}[key];
            if (/^[0-9]$/.test(key)) id=key==='0'?'depth-all':'depth-'+key;
          } else if(hasOnlyShiftShortcut(event)) id={F:'clear-focus','[':'focus-sibling-previous',']':'focus-sibling-next',Enter:'insert-sibling-before',Tab:'outdent'}[key];
          else if(hasOnlyPrimaryShortcut(event)) {
            id={ArrowUp:'move-sibling-before',ArrowDown:'move-sibling-after',Enter:'insert-child',Delete:'delete-node-keep-children',Backspace:'delete-node-keep-children'}[key];
            if(key==='ArrowLeft'||key==='ArrowRight') id=key===(mapSideForNode(thoughtforgeState.selectedNodeId)==='left'?'ArrowLeft':'ArrowRight')?'indent':'outdent';
          } else if(hasOnlyPrimaryShiftShortcut(event) && /^(o|O)$/.test(key)) id='reveal-source';
          if(id) { const admission=dispatchMapCommand('map-'+id,false); if(admission.status==='admitted')event.preventDefault(); return; }
        }

        if (key === "F2" && hasNoShortcutModifier(event) && isMapTitleRootSelected()) {
          event.preventDefault();
          selectMapTitleRootNode({ edit: true });
          return;
        }

        if (
          (key === "ArrowLeft" || key === "ArrowRight") &&
          hasNoShortcutModifier(event) &&
          isMapTitleRootSelected() &&
          moveSelectedNodeHorizontally(key === "ArrowLeft" ? "left" : "right")
        ) {
          event.preventDefault();
          return;
        }

        if (concentrationView && !hasSelection) {
          if ((key === "f" || key === "F") && hasNoShortcutModifier(event)) { focusSelectedBranch(); renderThoughtForgeMap(); event.preventDefault(); return; }
          if ((key === "Escape" && hasNoShortcutModifier(event) || key === "F" && hasOnlyShiftShortcut(event)) && clearFocusMode()) { renderThoughtForgeMap(); event.preventDefault(); return; }
          if (/^[0-9]$/.test(key) && hasNoShortcutModifier(event)) { setSubtreeDepth(Number(key)); event.preventDefault(); return; }
        }
        if (!hasSelection) {
          return;
        }

        if (concentrationView && ((key === "f" || key === "F") && hasNoShortcutModifier(event) || key === "F" && hasOnlyShiftShortcut(event) || key === "Escape" && hasNoShortcutModifier(event))) {
          const changed = hasNoShortcutModifier(event) && key !== "Escape" ? focusSelectedBranch() : clearFocusMode();
          if (changed) { event.preventDefault(); renderThoughtForgeSelection(); return; }
        }
        if (key === "F" && hasOnlyShiftShortcut(event) && clearFocusMode()) {
          event.preventDefault();
          renderThoughtForgeMap();
          return;
        }

        if ((key === "f" || key === "F") && hasNoShortcutModifier(event) && focusSelectedBranch()) {
          event.preventDefault();
          renderThoughtForgeMap();
          return;
        }

        if (key === "Escape" && hasNoShortcutModifier(event) && clearFocusMode()) {
          event.preventDefault();
          renderThoughtForgeMap();
          return;
        }

        if (key === "[" && hasNoShortcutModifier(event) && restorePreviousFocusRoot()) {
          event.preventDefault();
          renderThoughtForgeMap();
          return;
        }

        if (key === "]" && hasNoShortcutModifier(event) && restoreNextFocusRoot()) {
          event.preventDefault();
          renderThoughtForgeMap();
          return;
        }

        if (key === "[" && hasOnlyShiftShortcut(event) && focusSiblingBranch("previous")) {
          event.preventDefault();
          renderThoughtForgeMap();
          return;
        }

        if (key === "]" && hasOnlyShiftShortcut(event) && focusSiblingBranch("next")) {
          event.preventDefault();
          renderThoughtForgeMap();
          return;
        }

        if (key === "ArrowUp" && hasNoShortcutModifier(event) && moveSelectedNode("previous")) {
          event.preventDefault();
          return;
        }

        if (key === "ArrowDown" && hasNoShortcutModifier(event) && moveSelectedNode("next")) {
          event.preventDefault();
          return;
        }

        if (
          (key === "ArrowLeft" || key === "ArrowRight") &&
          hasNoShortcutModifier(event) &&
          moveSelectedNodeHorizontally(key === "ArrowLeft" ? "left" : "right")
        ) {
          event.preventDefault();
          return;
        }

        if (key === "F2" && hasNoShortcutModifier(event) && focusRenameInput()) {
          event.preventDefault();
          return;
        }

        if ((key === "N" || key === "n") && hasOnlyPrimaryShiftShortcut(event) && nodeNoteEditor) {
          event.preventDefault();
          nodeNoteEditor.focus();
          nodeNoteEditor.select();
          return;
        }

        if ((key === "O" || key === "o") && hasOnlyPrimaryShiftShortcut(event)) {
          event.preventDefault();
          requestSelectedNodeRevealInSource();
          return;
        }

        if (key === "." && hasNoShortcutModifier(event)) {
          event.preventDefault();
          toggleNodeCollapse(selectedNode().id);
          return;
        }

        if (/^[0-9]$/.test(key) && hasNoShortcutModifier(event)) {
          event.preventDefault();
          if (key === "0") {
            expandAllNodes();
          } else {
            collapseToDepth(Number(key));
          }
          return;
        }

        if (key === "ArrowUp" && hasOnlyPrimaryShortcut(event) && moveSelectedNodeWithinSiblings(-1)) {
          event.preventDefault();
          return;
        }

        if (key === "ArrowDown" && hasOnlyPrimaryShortcut(event) && moveSelectedNodeWithinSiblings(1)) {
          event.preventDefault();
          return;
        }

        if ((key === "ArrowLeft" || key === "ArrowRight") && hasOnlyPrimaryShortcut(event)) {
          event.preventDefault();
          const outwardKey = mapSideForNode(thoughtforgeState.selectedNodeId) === "left" ? "ArrowLeft" : "ArrowRight";
          handleThoughtForgeEditCommand(key === outwardKey ? "node.indent" : "node.outdent");
          return;
        }

        if (key === "Enter" && hasOnlyShiftShortcut(event)) {
          event.preventDefault();
          handleThoughtForgeEditCommand("node.insertSibling", { where: "before" });
          return;
        }

        if (key === "Enter" && hasOnlyPrimaryShortcut(event)) {
          event.preventDefault();
          handleThoughtForgeEditCommand("node.insertChild");
          return;
        }

        if (key === "Enter" && hasNoShortcutModifier(event)) {
          event.preventDefault();
          handleThoughtForgeEditCommand("node.insertSibling");
          return;
        }

        if (key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          handleThoughtForgeEditCommand(event.shiftKey ? "node.outdent" : "node.insertChild");
          return;
        }

        if (
          (key === "Delete" || key === "Backspace") &&
          hasNoShortcutModifier(event) &&
          !isNodeTextEditingActive()
        ) {
          event.preventDefault();
          handleThoughtForgeEditCommand("node.delete");
          return;
        }

        if ((key === "Delete" || key === "Backspace") && hasOnlyPrimaryShortcut(event) && !isNodeTextEditingActive()) {
          event.preventDefault();
          handleThoughtForgeEditCommand("node.deleteKeepChildren");
        }
      }

      listen(renameForm, "submit", (event) => {
        event.preventDefault();
        handleThoughtForgeEditCommand("node.rename");
      });
      commandButtons.forEach((button) => {
        listen(button, "click", () => {
          handleThoughtForgeEditCommand(button.dataset.thoughtforgeCommand);
        });
      });
      listen(reparentSelect, "change", () => {
        if (reparentApplyButton) {
          const node = selectedNode();
          reparentApplyButton.disabled = !node || !isValidReparentTarget(node.id, reparentSelect.value || null);
        }
      });
      listen(reparentApplyButton, "click", () => {
        handleThoughtForgeEditCommand("node.move");
      });
      listen(reparentPickButton, "click", () => {
        setReparentPickMode(!thoughtforgeState.isPickingReparentTarget);
      });
      listen(nodeNoteSaveButton, "click", () => {
        handleThoughtForgeEditCommand("node.updateNote");
      });
      listen(nodeNoteClearButton, "click", () => {
        handleThoughtForgeEditCommand("node.clearNote");
      });
      listen(revealSourceButton, "click", () => {
        localMapCommand('map-reveal-source', requestSelectedNodeRevealInSource);
      });
      listen(nodeNoteEditor, "keydown", (event) => {
        if ((event.key === "Enter" && hasOnlyPrimaryShortcut(event))) {
          event.preventDefault();
          handleThoughtForgeEditCommand("node.updateNote");
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          nodeNoteEditor.blur();
        }
      });
      collapseDepthButtons.forEach((button) => {
        listen(button, "click", () => {
          const depth=button.dataset.thoughtforgeCollapseDepth ?? '1';
          localMapCommand('map-depth-'+depth, () => collapseToDepth(Number(depth)));
        });
      });
      listen(expandAllButton, 'click', () => localMapCommand('map-depth-all',expandAllNodes));
      listen(searchInput, "input", () => {
        updateSearchQuery(searchInput.value);
      });
      listen(searchInput, "keydown", (event) => {
        if (isImeCompositionShortcutEvent(event)) return;
        if (event.key === "Enter") {
          event.preventDefault();
          localMapCommand(event.shiftKey ? 'map-filter-previous' : 'map-filter-next', () => moveSearchResult(event.shiftKey ? -1 : 1));
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          focusActiveSearchResult();
        }
      });
      listen(searchPreviousButton, 'click', () => localMapCommand('map-filter-previous', () => moveSearchResult(-1)));
      listen(searchNextButton, 'click', () => localMapCommand('map-filter-next', () => moveSearchResult(1)));
      listen(searchClearButton, 'click', () => localMapCommand('map-filter-clear', clearSearchQuery));
      listen(mapZoomOutButton, 'click', () => {
        localMapCommand('map-zoom-out', () => setMapZoom(thoughtforgeState.mapZoom - MAP_ZOOM_STEP));
      });
      listen(mapZoomInButton, 'click', () => {
        localMapCommand('map-zoom-in', () => setMapZoom(thoughtforgeState.mapZoom + MAP_ZOOM_STEP));
      });
      listen(mapZoomResetButton, 'click', () => {
        localMapCommand('map-zoom-reset', () => setMapZoom(MAP_ZOOM_DEFAULT));
      });
      listen(mindMapElement, "wheel", handleMapZoomWheel, { passive: false });
      listen(shortcutOverlayCloseButton, 'click', () => localMapCommand('map-close-shortcut-help', closeShortcutOverlay));
      listen(shortcutOverlayElement, "keydown", handleThoughtForgeModalFocusTrap);
      listen(shortcutOverlayElement, "click", (event) => {
        if (event.target === shortcutOverlayElement) {
          localMapCommand('map-close-shortcut-help', closeShortcutOverlay);
        }
      });
      listen(commandPaletteCloseButton, 'click', () => localMapCommand('map-close-command-palette', closeThoughtForgeCommandPalette));
      listen(commandPaletteElement, "keydown", handleThoughtForgeModalFocusTrap);
      listen(commandPaletteElement, "click", (event) => {
        if (event.target === commandPaletteElement) {
          localMapCommand('map-close-command-palette', closeThoughtForgeCommandPalette);
        }
      });
      listen(commandPaletteInput, "input", () => {
        thoughtforgeState.commandPaletteQuery = commandPaletteInput.value;
        thoughtforgeState.commandPaletteActiveIndex = 0;
        renderThoughtForgeCommandPalette();
      });
      listen(commandPaletteInput, "keydown", handleThoughtForgeCommandPaletteKeydown);
      for (const [buttons,data,format,copy] of copyCommandControls()) buttons.forEach(button => {
        listen(button,'click',() => {
          const scope=button.dataset[data]==='subtree'?'subtree':'node';
          localMapCommand('map-copy-'+scope+'-'+format,() => copy(scope));
        });
      });
      copySvgButtons.forEach((button) => {
        listen(button, 'click', () => localMapCommand('map-copy-visible-svg',postClipboardSvgWrite));
      });
      listen(nodeContextMenuElement, "click", (event) => {
        event.stopPropagation();
      });
      listen(nodeContextMenuElement, "keydown", handleNodeContextMenuKeydown);
      nodeContextMenuActionButtons.forEach((button) => {
        listen(button, "click", () => {
          runNodeContextMenuAction(button.dataset.thoughtforgeNodeContextAction);
        });
      });
      listen(document, "compositionstart", beginIme, { capture: true });
      listen(document, "compositionend", endIme, { capture: true });
      listen(document, "keydown", (event) => {
        recordImeDebugTrace("document-keydown-capture", eventDebugSummary(event));
      }, { capture: true });
      listen(document, "copy", handleThoughtForgeCopy);
      listen(document, "keydown", handleThoughtForgeCopyShortcut);
      listen(document, "click", hideNodeContextMenu);
      listen(document, "scroll", hideNodeContextMenu, { capture: true });
      listen(document, "keydown", (event) => {
        if (event.key !== "Escape" || !nodeContextMenuElement || nodeContextMenuElement.hidden) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        hideNodeContextMenu();
      }, { capture: true });
      listen(document, "pointerdown", (event) => {
        if (!isImeCap(document.activeElement)) {
          const selection = window.getSelection?.();
          selectionBeforeCapFocus = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
        }
        thoughtforgeState.lastPointerDownAt = performance.now();
        thoughtforgeState.pointerDownNodeId = event.target?.closest?.("button[data-node-id]")?.dataset.nodeId;
        cancelDirectRenameFocusRetry();
      }, { capture: true });
      listen(window, "resize", hideNodeContextMenu);
      listen(window, "paste", handleThoughtForgePaste);
      listen(window, "pointerdown", (event) => {
        if (!event.target?.closest?.("input[data-node-id], [data-thoughtforge-node-title-text], button[data-title-root]")) pendingTitleClick = undefined;
      }, true);
      listen(window, "compositionstart", () => { pendingTitleClick = undefined; }, true);
      listen(window, "keydown", handleThoughtForgeShortcut);
      window.__thoughtforgeImeDebug = thoughtforgeState.imeDebugTrace;
      window.__thoughtforgeImeDebugText = imeDebugTraceText;
      window.__thoughtforgeImeDebugCopy = guard(() => postImeDebugTraceClipboardWrite("manual"));
      own(() => { for (const key of ["__thoughtforgeImeDebug", "__thoughtforgeImeDebugText", "__thoughtforgeImeDebugCopy"]) delete window[key]; });
      setEditControlsEnabled(false);
      updateMapZoomControls();

      for (const type of ['input','compositionstart','compositionend','change','keydown','pointerdown']) listen(window,type,()=>hostPolicy?.commandContextChanged?.(),true);
      listen(window,'focusin',event=>{if(commandInputOwner!==event.target){commandInputOwner=event.target;hostPolicy?.commandContextChanged?.();}},true);
      own(releaseRenderer = hostPolicy?.bindRenderer?.(() => thoughtforgeState, guard(applyModelUpdate), Object.fromEntries(Object.entries({ render: renderThoughtForgeMap, postCommand: postThoughtForgeCommand, mapCommandContext, dispatchMapCommand, commandAvailability, updateCommandControls, retarget: retargetDirectEditSession, flush: flushQueuedOptimisticCommands, dependents: retargetDependentOptimisticNodes, overlay: overlayOptimisticNode, finishRename: finishRenameRequest, rebindRenames: rebindRenameTargets, clearDraft: clearDraftNode, removeDraft: removeOptimisticNodeFromMap }).map(([key, fn]) => [key, guard(fn, key === "postCommand" ? "blocked" : false)]))));
      postThoughtForgeWebviewMessage(${readyIntent});

      const proposalContainer = document.querySelector("[data-thoughtforge-proposal-panel]");
      const proposalToggle = document.querySelector("[data-thoughtforge-proposal-toggle]");
      let proposalSnapshot = { files: [], trusted: false };
      function highlightProposalNode(nodeId) {
        mindMapElement?.querySelectorAll("[data-node-id]").forEach((node) => {
          if (nodeId && node.dataset.nodeId === nodeId) node.dataset.proposalTarget = "true";
          else delete node.dataset.proposalTarget;
        });
      }
      const proposalPanel = (${mountProposalPanel.toString()})(proposalContainer, {
        sendAction(action) {
          const selected = proposalSnapshot.files.find((file) => file.id === action.proposalId);
          postThoughtForgeWebviewMessage({
          type: "thoughtforge.proposal.action",
          ...action,
            ...(action.action === "approve" ? { baseVersion: selected?.baseVersion } : {}) });
        },
        highlightNode: highlightProposalNode, listen
      });
      own(() => proposalPanel.destroy());
      for (const name of ["keydown", "keyup", "beforeinput", "input", "compositionstart", "compositionend"]) {
        listen(proposalContainer, name, (event) => event.stopPropagation());
      }
      listen(proposalToggle, "click", () => {
        const open = proposalContainer.hidden;
        proposalContainer.hidden = !open;
        shellElement.dataset.proposalOpen = String(open);
        proposalToggle.setAttribute("aria-expanded", String(open));
        if (open) {
          postThoughtForgeWebviewMessage({
          type: "thoughtforge.proposal.action",
          action: "list" });
        } else {
          highlightProposalNode(null);
          postThoughtForgeWebviewMessage({
          type: "thoughtforge.proposal.action",
          action: "close" });
        }
      });
      bridge.subscribe((message) => {
        if (message.type === "thoughtforge.model.update" && !proposalContainer.hidden) highlightProposalNode(null);
        if (message.type !== "thoughtforge.proposal.update" || proposalContainer.hidden) return;
        if (typeof message.styles === "string" && !document.getElementById("thoughtforge-proposal-style")) {
          const style = document.createElement("style");
          style.id = "thoughtforge-proposal-style";
          style.textContent = message.styles;
          document.head.append(style);
        }
        proposalSnapshot = message.state;
        proposalPanel.update(proposalSnapshot);
      });
      return dispose;
      }
      mountThoughtForgeMap();
`;
}
