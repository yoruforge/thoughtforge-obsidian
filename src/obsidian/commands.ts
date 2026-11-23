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

  plugin.addCommand({
    id: 'undo',
    name: plugin.messages.commands.undo,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView) return false;
      if (!checking) {
        void activeView.triggerUndo();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'redo',
    name: plugin.messages.commands.redo,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView) return false;
      if (!checking) {
        void activeView.triggerRedo();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'toggle-task',
    name: plugin.messages.commands.toggleTask,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView) return false;
      if (!checking) {
        void activeView.triggerToggleSelectedTask();
      }
      return true;
    },
  });

  // TODO: [M2-c コマンド登録] - 残りの編集操作（トピックノート直接編集・枝コピペ等）を既定ホットキーなしでコマンドパレットへ登録する
}
