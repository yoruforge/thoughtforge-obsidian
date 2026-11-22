import { PluginSettingTab, Setting, type App } from 'obsidian';
import type { PluginSettings } from '../core/model';
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
      .setName(msg.rainbowName)
      .setDesc(msg.rainbowDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.mindMapSettings.rainbowBranches).onChange(async (value) => {
          await this.plugin.updateSettings({ rainbowBranches: value });
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
