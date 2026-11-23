import { MarkdownView, Notice } from 'obsidian';
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
    id: 'reveal-cursor-in-mindmap',
    name: plugin.messages.commands.revealCursorInMap,
    checkCallback: (checking) => {
      const mdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const file = mdView?.file;
      if (!mdView || !file || file.extension.toLowerCase() !== 'md') {
        return false;
      }
      if (!checking) {
        const cursorLine = mdView.editor.getCursor().line;
        void plugin.revealLineInMindMap(file, cursorLine);
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'navigate-back',
    name: plugin.messages.commands.navigateBack,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView || !activeView.canNavigateBack()) return false;
      if (!checking) {
        void activeView.navigateBack();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'navigate-forward',
    name: plugin.messages.commands.navigateForward,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView || !activeView.canNavigateForward()) return false;
      if (!checking) {
        void activeView.navigateForward();
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

  plugin.addCommand({
    id: 'edit-topic-note',
    name: plugin.messages.commands.editTopicNote,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView) return false;
      if (!checking) {
        void activeView.triggerEditSelectedNote();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'copy-branch',
    name: plugin.messages.commands.copyBranch,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView) return false;
      if (!checking) {
        void activeView.triggerCopySelectedBranch();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'cut-branch',
    name: plugin.messages.commands.cutBranch,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView) return false;
      if (!checking) {
        void activeView.triggerCutSelectedBranch();
      }
      return true;
    },
  });

  plugin.addCommand({
    id: 'paste-branch',
    name: plugin.messages.commands.pasteBranch,
    checkCallback: (checking) => {
      const activeView = plugin.app.workspace.getActiveViewOfType(MindMapView);
      if (!activeView) return false;
      if (!checking) {
        void activeView.triggerPasteBranch();
      }
      return true;
    },
  });
}
