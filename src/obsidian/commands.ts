import { Notice } from 'obsidian';
import type ThoughtForgePlugin from '../main';
import { MindMapView } from './MindMapView';

/**
 * Registers plugin commands in the Obsidian Command Palette with NO default
 * hotkeys (per Obsidian Community Plugin guidelines to avoid hotkey conflicts).
 */
export function registerPluginCommands(plugin: ThoughtForgePlugin): void {
  plugin.addCommand({
    id: 'open-as-mindmap',
    name: plugin.messages.commands.openAsMap,
    checkCallback: (checking) => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || activeFile.extension.toLowerCase() !== 'md') {
        return false;
      }
      if (!checking) {
        void plugin.openFileAsMindMap(activeFile);
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'open-markdown-beside-mindmap',
    name: plugin.messages.commands.openMarkdownBeside,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      const activeFile = activeView?.file ?? plugin.app.workspace.getActiveFile();
      if (!activeFile || activeFile.extension.toLowerCase() !== 'md') {
        return false;
      }
      if (!checking) {
        const leaf = plugin.app.workspace.getLeaf('split');
        void leaf.openFile(activeFile).catch(() => {
          new Notice(plugin.messages.notices.openMapFailed);
        });
      }
      return true;
    },
  });

  // TODO: [M2 コマンド登録] - Classic Keymap の全編集・閲覧操作（子/兄弟/新親/削除/Undo/Redo等）を既定ホットキーなしでコマンドパレットへ登録する
}
