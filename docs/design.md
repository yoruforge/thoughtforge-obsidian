# ThoughtForge（`thoughtforge-obsidian`）設計書（v0.3）

> [!NOTE]
> 本ドキュメントは確定済み [prd.md](./prd.md) に基づく【フェーズ2: 設計】の正本です。Obsidian Community Plugin 公開基準と商標配慮を満たす独立プラグインとして設計しています。

## 1. アーキテクチャ概要

4 層クリーンアーキテクチャを採用し、Obsidian 依存を最外層（`src/obsidian/`）へ隔離します。

1. **Core Layer (`src/core/`)**：純粋 TypeScript（Obsidian 非依存）。Markdown 全行分類パーサー、Fail-Closed 判定、最小差分パッチ生成・Dry-Run 再解析、左右自動レイアウト＆階層テーマ、Focus/Quick Filter、キーボード空間ナビゲーション。
2. **Sync Layer (`src/sync/`)**：ノート単位の `FileCoordinator`（書き込み直列化・CAS 照合・Undo/Redo）、未保存 Markdown エディタ監視（`MarkdownEditorGate`）、`data.json` 下書きストア（`field: 'title' | 'note'`）、Phase 2 用 `NodeMetadataProvider` ポート。
3. **UI Layer (`src/ui/`)**：HTML + SVG ハイブリッド ＋ React 19。ビューポートカリング付き `ViewportCanvas`、ベジェ曲線 `SvgEdgeLayer`、DOM `DomNodeLayer`、日本語 IME ガード付き `InlineEditor`、本文直接編集対応 `NodePopover`、`Toolbar`、`StatusBar`。
4. **Obsidian Host Layer (`src/obsidian/`, `src/main.ts`)**：`FileView`、コマンドパレット登録（既定ホットキーなし）、設定タブ、i18n（`ja` / `en`）、安全なリンク・ソース行ジャンプ。

## 2. ブランディング・命名・商標配慮ルール

- **リポジトリ / ディレクトリ名**：`thoughtforge-obsidian` を使用する。
- **`manifest.json` の識別子と説明（Obsidian Community Plugin 審査基準）**：
  - `id` は小文字とハイフンのみとし、`obsidian`・他社製品名（`iThoughts` 等）・末尾 `plugin` を含めない（公開向け候補: `thoughtforge` または `thoughtforge-mindmap`）。
  - ローカル開発時、テスト用 Vault 内の `.obsidian/plugins/<folder>` フォルダ名は `manifest.json` の `id` と一致させる（不一致だと `onExternalSettingsChange` 等が正しく動作しないため、将来の `id` 移行時も配置先フォルダ名を同時に切り替える）。
  - `name` には `Obsidian` および他社製品名（`iThoughts` 等）を含めない（公開向け候補: `ThoughtForge` または `ThoughtForge MindMap`）。
  - `description` は機能中心の中立表現・250 文字以内・ピリオド終端とし、絵文字や `This is a plugin` などの冗長表現を避ける。
- **iThoughts リスペクト表記と免責**：
  - [README.md](../README.md) および [prd.md](./prd.md) の背景・設計思想・謝辞欄で、iThoughts（iThoughtsX）のキーボード中心の操作感から着想を得ている旨を明記してよい。
  - 記載時は「独立したオープンソースプロジェクトであり、iThoughts / toketaWare とは無関係・非提携であること」「記載の製品名は各権利者の商標であること」の免責（Disclaimer）を必ず併記する。
  - ロゴ・アイコン・スクリーンショットに iThoughts や Obsidian の公式ロゴ・類似意匠を使用しない。
- **識別子移行ステータス**：ディレクトリ名・`manifest.json`（`id: "thoughtforge"`, `name: "ThoughtForge"`, `author: "yoruforge"`）・`package.json`（`name: "thoughtforge-obsidian"`）・`MINDMAP_VIEW_TYPE`（`thoughtforge-mindmap-view`）・プラグインクラス名（`ThoughtForgePlugin`）・UI 文言・`README.md`（非提携免責含む）の移行完了。CSS プレフィックスは現行の `.ito-*` を維持している。

## 3. 主要設計ルール

- **全行分類不変条件**：ノートの全行は `frontmatter | heading | list-item | topic-note | unmapped | blank` のいずれか 1 つに必ず分類される。
- **未対応ブロック保護**：コードブロック、表、引用、Callout、数式 `$$`、HTML、コメント `%% %%`、frontmatter 等は 1 バイトも変えず保持し、インデント変更で中身が壊れる操作は拒否する。
- **Fail-Closed**：2MB 超・5,000 トピック超・閉じない frontmatter は地図を開かない。改行混在・タブ/スペース混在・箇条書き内見出し・範囲重複は読み取り専用にする。
- **Obsidian API 互換性**：Obsidian 1.13.0+ の基底クラス `Plugin` が `settings?: unknown` プロパティを持つため、プラグイン独自設定のアクセサは `mindMapSettings` とし、`pluginData.settings` を単一情報源として保持する。
- **トピックノート直接編集（M2）**：`SemanticCommand` の `updateNote` として実装。段落以外のブロック構文（見出し・箇条書き・コードフェンス等）が含まれる場合は書き戻さず理由通知＋下書き保持。箇条書きトピックのノートは元の字下げを自動付与する。
- **セキュリティ・Obsidian 審査基準**：`innerHTML` / `dangerouslySetInnerHTML` / `console.log` / deprecated API 禁止。外部リンクは `http:` / `https:` のみ、内部リンクはパストラバーサル（`..`）と絶対パスを遮断。
- **ツールチェーン・依存ビルド制約**：`pnpm` v11 ではビルドスクリプトを持つ依存の許否を [pnpm-workspace.yaml](../pnpm-workspace.yaml) の `allowBuilds` に明示しないと `ERR_PNPM_IGNORED_BUILDS` で `pnpm install` / `pnpm verify` が失敗する。単一パッケージ構成でも同ファイルを維持し、`allowBuilds: { esbuild: false }` で不要な postinstall を無効化する（実行バイナリはプラットフォーム別 `optionalDependencies` で動作することを確認済み）。また [package.json](../package.json) の `packageManager` は Corepack が自動ピン留めするため削除しない。

## 4. 実装ステータス

- **M0（環境構築）**：完了（`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `esbuild.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `manifest.json`, `versions.json`, `styles.css`、ディレクトリ名 `thoughtforge-obsidian` へ統一）
- **M1（閲覧 MVP）**：初期実装完了（Core パーサー・レイアウト・Focus/Quick Filter・ナビゲーション、React HTML+SVG ビューア、Obsidian `FileView`・コマンド・設定・i18n、Core 単体テスト 14 件、`pnpm verify` 通過、Obsidian 1.15.1 実機で基本表示と設定再起動保持を確認済み）
- **M2（双方向編集 MVP）**：次フェーズ（`src/core/patch/planner.ts`, `validator.ts`, `src/sync/`, `src/ui/InlineEditor.tsx`, `imeGuard.ts`, `NodePopover` の本文編集保存接続）
