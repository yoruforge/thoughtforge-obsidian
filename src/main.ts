import { Notice, Plugin, TFile, moment } from 'obsidian';
import {
  DEFAULT_PLUGIN_DATA,
  DEFAULT_PLUGIN_SETTINGS,
  type DraftEntry,
  type PluginDataV1,
  type PluginSettings,
} from './core/model';
import { getMessages, type Messages } from './i18n';
import { isSafeVaultImagePath } from './core/view/imageEmbeds';
import { registerPluginCommands } from './obsidian/commands';
import { MINDMAP_VIEW_TYPE, MindMapView } from './obsidian/MindMapView';
import { ExtractionAdapter } from './obsidian/ExtractionAdapter';
import { isExtractionRecord, type ExtractionRecord } from './sync/branchExtraction';
import { ObsidianMetadataProvider } from './obsidian/ObsidianMetadataProvider';
import { MindMapSettingTab } from './obsidian/settingsTab';
import { DraftStore } from './sync/DraftStore';
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
    (entry['targetHeaderLine'] === undefined || typeof entry['targetHeaderLine'] === 'number') &&
    (entry['targetOwnRangeHash'] === undefined ||
      typeof entry['targetOwnRangeHash'] === 'string') &&
    (entry['targetAncestorPath'] === undefined ||
      (Array.isArray(entry['targetAncestorPath']) &&
        entry['targetAncestorPath'].every((seg) => typeof seg === 'string'))) &&
    (entry['targetHadIdenticalSibling'] === undefined ||
      typeof entry['targetHadIdenticalSibling'] === 'boolean') &&
    typeof entry['baseContentHash'] === 'string' &&
    typeof entry['text'] === 'string' &&
    typeof entry['savedAt'] === 'number'
  );
}

type StoredData = PluginDataV1 & { readonly extractions?: readonly ExtractionRecord[] };

function parseStoredPluginData(raw: unknown): {
  readonly data: StoredData;
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
  const extractions = obj['extractions'];
  if (
    extractions !== undefined &&
    (!Array.isArray(extractions) || !extractions.every(isExtractionRecord))
  ) {
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
  if (
    rawDrafts !== undefined &&
    (!Array.isArray(rawDrafts) || !rawDrafts.every(isValidDraftEntry))
  ) {
    // Fail closed if persisted drafts are corrupted so we do not overwrite user data.
    return { data: { schemaVersion: 1, settings: mergedSettings, drafts: [] }, writable: false };
  }
  const drafts: readonly DraftEntry[] = rawDrafts ?? [];

  return {
    data: {
      schemaVersion: 1,
      settings: mergedSettings,
      drafts,
      extractions,
    },
    writable: true,
  };
}

export default class ThoughtForgePlugin extends Plugin {
  private pluginData: StoredData = DEFAULT_PLUGIN_DATA;
  private saveQueue: Promise<void> = Promise.resolve();
  private extractionAdapter: ExtractionAdapter | null = null;
  private dataWritable = true;
  private fileCoordinator: FileCoordinator | null = null;
  private draftStore: DraftStore | null = null;
  private metadataProvider: ObsidianMetadataProvider | null = null;
  private metadataRefreshTimer: number | null = null;
  private branchClipboardMarkdown: string | null = null;
  private branchClipboardSyncedToOs = true;
  messages: Messages = getMessages('en');

  get mindMapSettings(): PluginSettings {
    return this.pluginData.settings;
  }

  getMetadataProvider(): ObsidianMetadataProvider {
    if (this.metadataProvider === null) {
      this.metadataProvider = new ObsidianMetadataProvider(this.app);
    }
    return this.metadataProvider;
  }

  private scheduleMetadataRefresh(): void {
    if (this.metadataRefreshTimer !== null) {
      window.clearTimeout(this.metadataRefreshTimer);
    }
    this.metadataRefreshTimer = window.setTimeout(() => {
      this.metadataRefreshTimer = null;
      this.refreshAllViews();
    }, 120);
  }

  private persist(update: (current: StoredData) => StoredData): Promise<void> {
    const run = this.saveQueue.then(async () => {
      if (!this.dataWritable) throw new Error('storage-unavailable');
      const next = update(this.pluginData);
      await this.saveData(next);
      this.pluginData = next;
    });
    this.saveQueue = run.catch(() => undefined);
    return run;
  }

  getExtractionAdapter(): ExtractionAdapter {
    if (!this.extractionAdapter)
      this.extractionAdapter = new ExtractionAdapter(
        this.app,
        () => this.pluginData.extractions ?? [],
        (record) =>
          this.persist((current) => ({
            ...current,
            extractions: [...(current.extractions ?? []).filter((r) => r.id !== record.id), record],
          })),
        (id) =>
          this.persist((current) => ({
            ...current,
            extractions: (current.extractions ?? []).filter((r) => r.id !== id),
          })),
      );
    return this.extractionAdapter;
  }

  getFileCoordinator(): FileCoordinator {
    if (this.fileCoordinator === null) {
      this.fileCoordinator = new FileCoordinator(this.getExtractionAdapter(), {
        extractionHost: this.getExtractionAdapter(),
      });
    }
    return this.fileCoordinator;
  }

  getDraftStore(): DraftStore {
    if (this.draftStore === null) {
      this.draftStore = new DraftStore(this.pluginData.drafts, async (nextDrafts) => {
        try {
          await this.persist((current) => ({ ...current, drafts: nextDrafts }));
          return true;
        } catch {
          return false;
        }
      });
      this.draftStore.subscribe(() => {
        this.refreshAllViews();
      });
    }
    return this.draftStore;
  }

  setBranchClipboard(markdown: string, syncedToOs: boolean): void {
    this.branchClipboardMarkdown = markdown;
    this.branchClipboardSyncedToOs = syncedToOs;
  }

  getBranchClipboard(): { readonly markdown: string | null; readonly syncedToOs: boolean } {
    return {
      markdown: this.branchClipboardMarkdown,
      syncedToOs: this.branchClipboardSyncedToOs,
    };
  }

  async onload(): Promise<void> {
    this.messages = getMessages(moment.locale());

    const loaded = parseStoredPluginData(await this.loadData());
    this.pluginData = loaded.data;
    this.dataWritable = loaded.writable;
    this.draftStore = null;
    this.getDraftStore();

    this.app.workspace.onLayoutReady(() => {
      void this.reconcileExtractions();
    });
    this.registerView(MINDMAP_VIEW_TYPE, (leaf) => new MindMapView(leaf, this));
    registerPluginCommands(this);
    this.addSettingTab(new MindMapSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on('create', (abstractFile) => {
        this.extractionAdapter?.changed(abstractFile.path);
        if (abstractFile instanceof TFile && isSafeVaultImagePath(abstractFile.path)) {
          this.getMetadataProvider().bumpVersion();
          this.scheduleMetadataRefresh();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('modify', (abstractFile) => {
        this.extractionAdapter?.changed(abstractFile.path);
        if (!(abstractFile instanceof TFile)) {
          return;
        }
        if (abstractFile.extension.toLowerCase() !== 'md') {
          if (isSafeVaultImagePath(abstractFile.path)) {
            this.getMetadataProvider().bumpVersion();
            this.scheduleMetadataRefresh();
          }
          return;
        }
        this.getMetadataProvider().markFileUpdating(abstractFile.path);
        for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
          if (leaf.view instanceof MindMapView && leaf.view.file?.path === abstractFile.path) {
            void leaf.view.reloadFromFile(abstractFile);
          }
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('rename', (abstractFile, oldPath) => {
        this.extractionAdapter?.changed(abstractFile.path);
        this.extractionAdapter?.changed(oldPath);
        if (!(abstractFile instanceof TFile)) {
          return;
        }
        this.getMetadataProvider().renamePath(oldPath, abstractFile.path);
        this.scheduleMetadataRefresh();
        if (abstractFile.extension.toLowerCase() !== 'md') {
          return;
        }
        this.fileCoordinator?.renameHistoryPath(oldPath, abstractFile.path);
        void this.draftStore?.renameFilePath(oldPath, abstractFile.path);
        for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
          if (leaf.view instanceof MindMapView) {
            leaf.view.renameHistoryPath(oldPath, abstractFile.path);
            if (leaf.view.file?.path === abstractFile.path) {
              void leaf.view.reloadFromFile(abstractFile);
            }
          }
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on('delete', (abstractFile) => {
        this.extractionAdapter?.changed(abstractFile.path);
        if (abstractFile instanceof TFile) {
          this.getMetadataProvider().removePath(abstractFile.path);
          this.scheduleMetadataRefresh();
          if (abstractFile.extension.toLowerCase() === 'md') {
            this.fileCoordinator?.clearHistory(abstractFile.path);
            for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
              if (leaf.view instanceof MindMapView) {
                leaf.view.removeHistoryPath(abstractFile.path);
              }
            }
          }
        }
      }),
    );

    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.getMetadataProvider().markFileFresh(file.path);
        this.scheduleMetadataRefresh();
      }),
    );

    this.registerEvent(
      this.app.metadataCache.on('resolved', () => {
        this.getMetadataProvider().markAllFresh();
        this.scheduleMetadataRefresh();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        this.refreshAllViews();
      }),
    );
  }

  private async reconcileExtractions(): Promise<void> {
    for (const record of this.getExtractionAdapter().records()) {
      if (record.phase === 'replacing') await this.getFileCoordinator().reconcileExtraction(record);
    }
    if (this.getExtractionAdapter().records().length) new Notice(this.messages.extraction.recovery);
  }

  onunload(): void {
    if (this.metadataRefreshTimer !== null) {
      window.clearTimeout(this.metadataRefreshTimer);
      this.metadataRefreshTimer = null;
    }
    this.fileCoordinator = null;
    this.draftStore = null;
    this.metadataProvider = null;
    this.branchClipboardMarkdown = null;
    // Workspace view cleanup is handled via MindMapView.onClose().
  }

  async updateSettings(patch: Partial<PluginSettings>): Promise<void> {
    const update = (current: StoredData) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    });
    if (this.dataWritable) await this.persist(update);
    else this.pluginData = update(this.pluginData);
    this.refreshAllViews();
  }

  async openFileAsMindMap(
    file: TFile,
    options?: {
      readonly openMode?: 'split' | 'new-tab';
      readonly reveal?: { readonly line?: number; readonly subpath?: string };
    },
  ): Promise<void> {
    if (file.extension.toLowerCase() !== 'md') {
      new Notice(this.messages.notices.selectMarkdownNote);
      return;
    }
    try {
      const mode = options?.openMode ?? this.mindMapSettings.defaultOpenMode;
      const leaf =
        mode === 'new-tab'
          ? this.app.workspace.getLeaf('tab')
          : this.app.workspace.getLeaf('split');
      await leaf.setViewState({
        type: MINDMAP_VIEW_TYPE,
        state: { file: file.path },
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
      if (options?.reveal && leaf.view instanceof MindMapView) {
        leaf.view.revealTarget(options.reveal);
      }
    } catch {
      new Notice(this.messages.notices.openMapFailed);
    }
  }

  async revealLineInMindMap(file: TFile, line: number): Promise<void> {
    if (file.extension.toLowerCase() !== 'md') {
      new Notice(this.messages.notices.selectMarkdownNote);
      return;
    }
    const existingLeaf = this.app.workspace
      .getLeavesOfType(MINDMAP_VIEW_TYPE)
      .find((leaf) => leaf.view instanceof MindMapView && leaf.view.file?.path === file.path);
    if (existingLeaf && existingLeaf.view instanceof MindMapView) {
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
      this.app.workspace.revealLeaf(existingLeaf);
      existingLeaf.view.revealTarget({ line });
      return;
    }
    await this.openFileAsMindMap(file, { reveal: { line } });
  }

  private refreshAllViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
      if (leaf.view instanceof MindMapView) {
        leaf.view.refreshAppearance();
      }
    }
  }
}
