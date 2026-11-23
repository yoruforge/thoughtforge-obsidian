import { Notice, Plugin, TFile, moment } from 'obsidian';
import {
  DEFAULT_PLUGIN_DATA,
  DEFAULT_PLUGIN_SETTINGS,
  type DraftEntry,
  type PluginDataV1,
  type PluginSettings,
} from './core/model';
import { getMessages, type Messages } from './i18n';
import { registerPluginCommands } from './obsidian/commands';
import { MINDMAP_VIEW_TYPE, MindMapView } from './obsidian/MindMapView';
import { ObsidianHostAdapter } from './obsidian/ObsidianHostAdapter';
import { MindMapSettingTab } from './obsidian/settingsTab';
import { FileCoordinator } from './sync/FileCoordinator';

function isValidDraftEntry(value: unknown): value is DraftEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['draftId'] === 'string' &&
    typeof entry['deviceId'] === 'string' &&
    typeof entry['filePath'] === 'string' &&
    (entry['field'] === 'title' || entry['field'] === 'note') &&
    typeof entry['targetTitleRaw'] === 'string' &&
    typeof entry['baseContentHash'] === 'string' &&
    typeof entry['text'] === 'string' &&
    typeof entry['savedAt'] === 'number'
  );
}

function parseStoredPluginData(raw: unknown): {
  readonly data: PluginDataV1;
  readonly writable: boolean;
} {
  if (raw === null || raw === undefined) {
    return { data: DEFAULT_PLUGIN_DATA, writable: true };
  }
  if (typeof raw !== 'object') {
    return { data: DEFAULT_PLUGIN_DATA, writable: false };
  }
  const obj = raw as Record<string, unknown>;
  if (obj['schemaVersion'] !== 1) {
    // Preserve unknown/future schema versions without overwriting data.json.
    return { data: DEFAULT_PLUGIN_DATA, writable: false };
  }
  const rawSettings =
    typeof obj['settings'] === 'object' && obj['settings'] !== null
      ? (obj['settings'] as Partial<PluginSettings>)
      : {};

  const mergedSettings: PluginSettings = {
    themeMode:
      rawSettings.themeMode === 'light' ||
      rawSettings.themeMode === 'dark-solarized' ||
      rawSettings.themeMode === 'auto'
        ? rawSettings.themeMode
        : DEFAULT_PLUGIN_SETTINGS.themeMode,
    rainbowBranches:
      typeof rawSettings.rainbowBranches === 'boolean'
        ? rawSettings.rainbowBranches
        : DEFAULT_PLUGIN_SETTINGS.rainbowBranches,
    imeGuardWindowMs:
      typeof rawSettings.imeGuardWindowMs === 'number' &&
      rawSettings.imeGuardWindowMs >= 50 &&
      rawSettings.imeGuardWindowMs <= 1000
        ? rawSettings.imeGuardWindowMs
        : DEFAULT_PLUGIN_SETTINGS.imeGuardWindowMs,
    defaultOpenMode:
      rawSettings.defaultOpenMode === 'new-tab' || rawSettings.defaultOpenMode === 'split'
        ? rawSettings.defaultOpenMode
        : DEFAULT_PLUGIN_SETTINGS.defaultOpenMode,
    layoutMode:
      rawSettings.layoutMode === 'balanced' ||
      rawSettings.layoutMode === 'right' ||
      rawSettings.layoutMode === 'org-chart'
        ? rawSettings.layoutMode
        : DEFAULT_PLUGIN_SETTINGS.layoutMode,
    colorStyle:
      rawSettings.colorStyle === 'pastel-fill' ||
      rawSettings.colorStyle === 'wireframe' ||
      rawSettings.colorStyle === 'monochrome'
        ? rawSettings.colorStyle
        : DEFAULT_PLUGIN_SETTINGS.colorStyle,
    edgeStyle:
      rawSettings.edgeStyle === 'tapered' ||
      rawSettings.edgeStyle === 'curved' ||
      rawSettings.edgeStyle === 'orthogonal'
        ? rawSettings.edgeStyle
        : DEFAULT_PLUGIN_SETTINGS.edgeStyle,
    canvasPattern:
      rawSettings.canvasPattern === 'none' ||
      rawSettings.canvasPattern === 'dots' ||
      rawSettings.canvasPattern === 'grid'
        ? rawSettings.canvasPattern
        : DEFAULT_PLUGIN_SETTINGS.canvasPattern,
    topicNumbering:
      rawSettings.topicNumbering === 'off' ||
      rawSettings.topicNumbering === 'decimal' ||
      rawSettings.topicNumbering === 'alpha'
        ? rawSettings.topicNumbering
        : DEFAULT_PLUGIN_SETTINGS.topicNumbering,
  };

  const rawDrafts = obj['drafts'];
  if (rawDrafts !== undefined && (!Array.isArray(rawDrafts) || !rawDrafts.every(isValidDraftEntry))) {
    // Fail closed if persisted drafts are corrupted so we do not overwrite user data.
    return { data: { schemaVersion: 1, settings: mergedSettings, drafts: [] }, writable: false };
  }
  const drafts: readonly DraftEntry[] = rawDrafts ?? [];

  return {
    data: {
      schemaVersion: 1,
      settings: mergedSettings,
      drafts,
    },
    writable: true,
  };
}

export default class ThoughtForgePlugin extends Plugin {
  private pluginData: PluginDataV1 = DEFAULT_PLUGIN_DATA;
  private dataWritable = true;
  private fileCoordinator: FileCoordinator | null = null;
  messages: Messages = getMessages('en');

  get mindMapSettings(): PluginSettings {
    return this.pluginData.settings;
  }

  getFileCoordinator(): FileCoordinator {
    if (this.fileCoordinator === null) {
      this.fileCoordinator = new FileCoordinator(new ObsidianHostAdapter(this.app));
    }
    return this.fileCoordinator;
  }

  async onload(): Promise<void> {
    this.messages = getMessages(moment.locale());

    const loaded = parseStoredPluginData(await this.loadData());
    this.pluginData = loaded.data;
    this.dataWritable = loaded.writable;

    this.registerView(MINDMAP_VIEW_TYPE, (leaf) => new MindMapView(leaf, this));
    registerPluginCommands(this);
    this.addSettingTab(new MindMapSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('modify', (abstractFile) => {
        if (!(abstractFile instanceof TFile) || abstractFile.extension.toLowerCase() !== 'md') {
          return;
        }
        for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
          if (leaf.view instanceof MindMapView && leaf.view.file?.path === abstractFile.path) {
            void leaf.view.reloadFromFile(abstractFile);
          }
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (abstractFile, oldPath) => {
        if (!(abstractFile instanceof TFile) || abstractFile.extension.toLowerCase() !== 'md') {
          return;
        }
        this.fileCoordinator?.renameHistoryPath(oldPath, abstractFile.path);
        for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
          if (leaf.view instanceof MindMapView && leaf.view.file?.path === abstractFile.path) {
            void leaf.view.reloadFromFile(abstractFile);
          }
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', (abstractFile) => {
        if (abstractFile instanceof TFile && abstractFile.extension.toLowerCase() === 'md') {
          this.fileCoordinator?.clearHistory(abstractFile.path);
        }
      }),
    );

    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        this.refreshAllViews();
      }),
    );
  }

  onunload(): void {
    this.fileCoordinator = null;
    // Workspace view cleanup is handled via MindMapView.onClose().
  }

  async updateSettings(patch: Partial<PluginSettings>): Promise<void> {
    this.pluginData = {
      ...this.pluginData,
      settings: {
        ...this.pluginData.settings,
        ...patch,
      },
    };
    if (this.dataWritable) {
      await this.saveData(this.pluginData);
    }
    this.refreshAllViews();
  }

  async openFileAsMindMap(file: TFile): Promise<void> {
    if (file.extension.toLowerCase() !== 'md') {
      new Notice(this.messages.notices.selectMarkdownNote);
      return;
    }
    try {
      const leaf =
        this.mindMapSettings.defaultOpenMode === 'new-tab'
          ? this.app.workspace.getLeaf('tab')
          : this.app.workspace.getLeaf('split');
      await leaf.setViewState({
        type: MINDMAP_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    } catch {
      new Notice(this.messages.notices.openMapFailed);
    }
  }

  private refreshAllViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
      if (leaf.view instanceof MindMapView) {
        leaf.view.refreshAppearance();
      }
    }
  }
}
