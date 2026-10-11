import type { Command } from 'obsidian';
import type { MapCommandId } from '../packages/map-view/src/map-view/commandIds.mjs';

/** Semantic operations, not synthesized keyboard events or patch payloads. */
export const MAP_COMMANDS = [
  { id: 'map-edit-title', name: '選択トピックのタイトルを編集', group: '作成・タイトル', classicKey: 'F2' },
  { id: 'map-edit-central-title', name: '中央タイトルを編集', group: '作成・タイトル', classicKey: 'F2（中央選択時）' },
  { id: 'map-insert-child', name: '子トピックを追加', group: '作成・タイトル', classicKey: 'Tab / Cmd+Enter' },
  { id: 'map-insert-sibling-after', name: '後ろに兄弟トピックを追加', group: '作成・タイトル', classicKey: 'Enter' },
  { id: 'map-insert-sibling-before', name: '前に兄弟トピックを追加', group: '作成・タイトル', classicKey: 'Shift+Enter' },
  { id: 'map-insert-parent', name: '新しい親を追加', group: '作成・タイトル' },
  { id: 'map-confirm-input', name: 'タイトルの入力を確定', group: '作成・タイトル', classicKey: 'Enter（入力中）' },
  { id: 'map-cancel-input', name: 'タイトルの入力を取り消す', group: '作成・タイトル', classicKey: 'Esc（入力中）' },
  { id: 'map-indent', name: '選択トピックを字下げ', group: '構造', classicKey: 'Cmd+矢印（枝の方向）' },
  { id: 'map-outdent', name: '選択トピックの字下げを戻す', group: '構造', classicKey: 'Shift+Tab / Cmd+矢印（中央の方向）' },
  { id: 'map-move-sibling-before', name: '兄弟順序を前へ移動', group: '構造', classicKey: 'Cmd+↑' },
  { id: 'map-move-sibling-after', name: '兄弟順序を後へ移動', group: '構造', classicKey: 'Cmd+↓' },
  { id: 'map-move-branch', name: '選択枝の移動先を選ぶ', group: '構造' },
  { id: 'map-confirm-move-before', name: '選んだ移動先の前へ移動', group: '構造' },
  { id: 'map-confirm-move-after', name: '選んだ移動先の後へ移動', group: '構造' },
  { id: 'map-confirm-move-child', name: '選んだ移動先の最後の子へ移動', group: '構造' },
  { id: 'map-cancel-move', name: '枝の移動を取り消す', group: '構造' },
  { id: 'map-delete-branch', name: '選択枝を削除', group: '削除・履歴', classicKey: 'Delete / Backspace' },
  { id: 'map-delete-node-keep-children', name: '子を残して選択トピックだけ削除', group: '削除・履歴', classicKey: 'Cmd+Delete' },
  { id: 'map-undo', name: '地図の操作を元に戻す', group: '削除・履歴', classicKey: 'Cmd+Z' },
  { id: 'map-redo', name: '地図の操作をやり直す', group: '削除・履歴', classicKey: 'Cmd+Shift+Z' },
  { id: 'map-copy-node-markdown', name: '選択トピックをMarkdownでコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-markdown', name: '選択枝をMarkdownでコピー', group: 'コピー・貼り付け', classicKey: 'Cmd+C' },
  { id: 'map-copy-node-opml', name: '選択トピックをOPMLでコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-opml', name: '選択枝をOPMLでコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-node-context', name: '選択トピックの文脈をコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-context', name: '選択枝の文脈をコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-node-issue-draft', name: '選択トピックのIssue下書きをコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-issue-draft', name: '選択枝のIssue下書きをコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-node-design-doc', name: '選択トピックの設計メモをコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-design-doc', name: '選択枝の設計メモをコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-node-test-matrix', name: '選択トピックのテスト観点をコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-test-matrix', name: '選択枝のテスト観点をコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-node-prompt-template', name: '選択トピックのプロンプトテンプレートをコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-prompt-template', name: '選択枝のプロンプトテンプレートをコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-ai-worker', name: '選択枝のAI Context PackをCodex向けにコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-ai-chat', name: '選択枝のAI Context PackをChatGPT・Claude向けにコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-subtree-ai-issue', name: '選択枝のAI Context PackをIssueチェックリスト向けにコピー', group: 'コピー・貼り付け' },
  { id: 'map-copy-visible-svg', name: '表示中の地図をSVGでコピー', group: 'コピー・貼り付け' },
  { id: 'map-paste-branch', name: '同じ地図でコピーした枝を貼り付け', group: 'コピー・貼り付け', classicKey: 'Cmd+V' },
  { id: 'map-select-previous', name: '前のトピックを選択', group: '選択', classicKey: '↑' },
  { id: 'map-select-next', name: '次のトピックを選択', group: '選択', classicKey: '↓' },
  { id: 'map-select-left', name: '左方向のトピックを選択', group: '選択', classicKey: '←' },
  { id: 'map-select-right', name: '右方向のトピックを選択', group: '選択', classicKey: '→' },
  { id: 'map-select-central', name: '中央テーマを選択', group: '選択' },
  { id: 'map-clear-selection', name: '地図の選択を解除', group: '選択' },
  { id: 'map-toggle-collapse', name: '選択枝を開閉', group: '開閉', classicKey: '.' },
  { id: 'map-depth-1', name: '選択枝を深度1まで表示', group: '開閉', classicKey: '1' },
  { id: 'map-depth-2', name: '選択枝を深度2まで表示', group: '開閉', classicKey: '2' },
  { id: 'map-depth-3', name: '選択枝を深度3まで表示', group: '開閉', classicKey: '3' },
  { id: 'map-depth-4', name: '選択枝を深度4まで表示', group: '開閉', classicKey: '4' },
  { id: 'map-depth-5', name: '選択枝を深度5まで表示', group: '開閉', classicKey: '5' },
  { id: 'map-depth-6', name: '選択枝を深度6まで表示', group: '開閉', classicKey: '6' },
  { id: 'map-depth-7', name: '選択枝を深度7まで表示', group: '開閉', classicKey: '7' },
  { id: 'map-depth-8', name: '選択枝を深度8まで表示', group: '開閉', classicKey: '8' },
  { id: 'map-depth-9', name: '選択枝を深度9まで表示', group: '開閉', classicKey: '9' },
  { id: 'map-depth-all', name: '選択枝の全階層を表示', group: '開閉', classicKey: '0' },
  { id: 'map-zoom-in', name: '地図を拡大', group: '表示' },
  { id: 'map-zoom-out', name: '地図を縮小', group: '表示' },
  { id: 'map-zoom-reset', name: '地図の倍率を100%に戻す', group: '表示' },
  { id: 'map-fit', name: '地図全体を表示', group: '表示' },
  { id: 'map-focus-selected', name: '選択枝を集中表示', group: '表示', classicKey: 'F' },
  { id: 'map-focus-follow-selection', name: '選択に追従して集中表示', group: '表示' },
  { id: 'map-focus-back', name: '集中表示の履歴を戻る', group: '表示', classicKey: '[' },
  { id: 'map-focus-forward', name: '集中表示の履歴を進む', group: '表示', classicKey: ']' },
  { id: 'map-focus-sibling-previous', name: '前の兄弟枝を集中表示', group: '表示', classicKey: 'Shift+[' },
  { id: 'map-focus-sibling-next', name: '次の兄弟枝を集中表示', group: '表示', classicKey: 'Shift+]' },
  { id: 'map-clear-focus', name: '集中表示を解除', group: '表示', classicKey: 'Shift+F / Esc' },
  { id: 'map-filter-start', name: 'Quick Filterを開始', group: '表示' },
  { id: 'map-filter-previous', name: '前の一致を選択', group: '表示', classicKey: 'Shift+Enter（検索欄）' },
  { id: 'map-filter-next', name: '次の一致を選択', group: '表示', classicKey: 'Enter（検索欄）' },
  { id: 'map-filter-clear', name: 'Quick Filterを解除', group: '表示', classicKey: 'Esc（検索欄）' },
  { id: 'map-reveal-source', name: '選択位置をMarkdownで表示', group: '閲覧・アクセシビリティ', classicKey: 'Cmd+Shift+O' },
  { id: 'map-open-selected-link', name: '選択トピックの既存リンクを選んで開く', group: '閲覧・アクセシビリティ' },
  { id: 'map-focus-toolbar', name: '地図の操作欄へ移動', group: '閲覧・アクセシビリティ' },
  { id: 'map-focus-notice', name: '地図の通知へ移動', group: '閲覧・アクセシビリティ' },
  { id: 'map-return-to-map', name: '地図へ戻る', group: '閲覧・アクセシビリティ' },
  { id: 'map-open-shortcut-help', name: '地図のキー操作一覧を開く', group: '補助', classicKey: '?' },
  { id: 'map-close-shortcut-help', name: '地図のキー操作一覧を閉じる', group: '補助', classicKey: 'Esc（一覧内）' },
  { id: 'map-open-command-palette', name: '地図内コマンドパレットを開く', group: '補助', classicKey: 'Cmd+/' },
  { id: 'map-close-command-palette', name: '地図内コマンドパレットを閉じる', group: '補助', classicKey: 'Esc（パレット内）' },
  { id: 'map-open-context-menu', name: '選択トピックの右クリックメニューを開く', group: '補助' },
  { id: 'map-close-context-menu', name: '地図の右クリックメニューを閉じる', group: '補助', classicKey: 'Esc（メニュー内）' }
] as const satisfies readonly { id: string; name: string; group: string; classicKey?: string }[];

export type { MapCommandId };
export type MapCommandExecutor = (command: MapCommandId, checking: boolean) => boolean;
export const executeMapCommandStub: MapCommandExecutor = () => false;
export const MAP_COMMAND_NOT_CONNECTED = 'この地図コマンドはまだ接続されていません。現在の地図内の操作を使ってください。';

export function registerMapCommands(addCommand: (command: Command) => unknown,
  execute: MapCommandExecutor, notify: (message: string) => void): void {
  for (const command of MAP_COMMANDS) {
    addCommand({ id: command.id, name: command.name, checkCallback: checking => {
      const accepted = execute(command.id, checking);
      if (!checking && !accepted) notify('この地図コマンドは現在利用できません。地図と入力の状態を確認してください。');
      return accepted;
    } });
  }
}
