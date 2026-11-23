import { PluginSettingTab, Setting, type App } from 'obsidian';
import type {
  BranchEdgeStyle,
  CanvasPattern,
  ColorStyleMode,
  MapLayoutMode,
  PluginSettings,
  TopicNumberingMode,
} from '../core/model';
import type ThoughtForgePlugin from '../main';

export class MindMapSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ThoughtForgePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const msg = this.plugin.messages.settings;
    const styles = this.plugin.messages.styles;
    containerEl.empty();

    new Setting(containerEl).setName(msg.heading).setHeading();

    new Setting(containerEl)
      .setName(msg.themeModeName)
      .setDesc(msg.themeModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('auto', msg.themeAuto)
          .addOption('light', msg.themeLight)
          .addOption('dark-solarized', msg.themeDark)
          .setValue(this.plugin.mindMapSettings.themeMode)
          .onChange(async (value) => {
            if (value === 'auto' || value === 'light' || value === 'dark-solarized') {
              await this.plugin.updateSettings({ themeMode: value });
            }
          }),
      );

    new Setting(containerEl)
      .setName(msg.colorStyleName)
      .setDesc(msg.colorStyleDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('pastel-fill', styles.colorPastel)
          .addOption('wireframe', styles.colorWireframe)
          .addOption('monochrome', styles.colorMonochrome)
          .setValue(this.plugin.mindMapSettings.colorStyle)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ colorStyle: value as ColorStyleMode });
          }),
      );

    new Setting(containerEl)
      .setName(msg.rainbowName)
      .setDesc(msg.rainbowDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.mindMapSettings.rainbowBranches).onChange(async (value) => {
          await this.plugin.updateSettings({ rainbowBranches: value });
        }),
      );

    new Setting(containerEl)
      .setName(msg.layoutModeName)
      .setDesc(msg.layoutModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('balanced', styles.layoutBalanced)
          .addOption('right', styles.layoutRight)
          .addOption('org-chart', styles.layoutOrgChart)
          .setValue(this.plugin.mindMapSettings.layoutMode)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ layoutMode: value as MapLayoutMode });
          }),
      );

    new Setting(containerEl)
      .setName(msg.edgeStyleName)
      .setDesc(msg.edgeStyleDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('tapered', styles.edgeTapered)
          .addOption('curved', styles.edgeCurved)
          .addOption('orthogonal', styles.edgeOrthogonal)
          .setValue(this.plugin.mindMapSettings.edgeStyle)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ edgeStyle: value as BranchEdgeStyle });
          }),
      );

    new Setting(containerEl)
      .setName(msg.canvasPatternName)
      .setDesc(msg.canvasPatternDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('none', styles.patternNone)
          .addOption('dots', styles.patternDots)
          .addOption('grid', styles.patternGrid)
          .setValue(this.plugin.mindMapSettings.canvasPattern)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ canvasPattern: value as CanvasPattern });
          }),
      );

    new Setting(containerEl)
      .setName(msg.numberingName)
      .setDesc(msg.numberingDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('off', styles.numberingOff)
          .addOption('decimal', styles.numberingDecimal)
          .addOption('alpha', styles.numberingAlpha)
          .setValue(this.plugin.mindMapSettings.topicNumbering)
          .onChange(async (value) => {
            await this.plugin.updateSettings({ topicNumbering: value as TopicNumberingMode });
          }),
      );

    new Setting(containerEl)
      .setName(msg.openModeName)
      .setDesc(msg.openModeDesc)
      .addDropdown((dropdown) =>
        dropdown
          .addOption('split', msg.openSplit)
          .addOption('new-tab', msg.openNewTab)
          .setValue(this.plugin.mindMapSettings.defaultOpenMode)
          .onChange(async (value) => {
            if (value === 'split' || value === 'new-tab') {
              await this.plugin.updateSettings({
                defaultOpenMode: value as PluginSettings['defaultOpenMode'],
              });
            }
          }),
      );

    new Setting(containerEl)
      .setName(msg.imeGuardName)
      .setDesc(msg.imeGuardDesc)
      .addSlider((slider) =>
        slider
          .setLimits(50, 500, 25)
          .setValue(this.plugin.mindMapSettings.imeGuardWindowMs)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.updateSettings({ imeGuardWindowMs: value });
          }),
      );
  }
}
