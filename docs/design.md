# ThoughtForge（`thoughtforge-obsidian`）設計書（v0.4）

> [!NOTE]
> 本ドキュメントは確定済み [prd.md](./prd.md) に基づく【フェーズ2: 設計】の正本です。Obsidian Community Plugin 公開基準と商標配慮を満たす独立プラグインとして設計しています。YouTube 動画 10 件の UI/UX・デザイン分析の詳細は [ithoughts-youtube-analysis.md](./ithoughts-youtube-analysis.md) を参照してください。

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
- **CommonMark リストネスト整合**：順序付きリスト（`1. ` = 3 桁、`10. ` = 4 桁）の子は、親の本文開始桁（インデント＋記号幅＋1）以上に字下げする。パーサーとパッチ生成の双方が同じ基準を使い、Obsidian 本体との親子解釈ズレを防ぐ。
- **編集セッションの開始時スナップショット固定と二重ゲート**：インライン編集・ノート編集の確定時は最新 `doc` から `PatchGuard` を作り直さず、編集開始時に固定した `filePath`・`PatchGuard` を使って CAS 照合する。`MarkdownEditorGate` はキュー投入前だけでなく `vault.process` の同期コールバック先頭でも再確認し、競合・検証失敗時は `PatchAbortError` を送出して書き込み自体を中断（ディスク無書込）して呼び出し元へ拒否コードを返す。
- **リストタイトルのブロック構文ガード**：リスト項目のタイトル先頭にブロック構文（`#`, `-`, `1.`, `>`, `` ``` ``, `---`, HTML タグ等）が入る編集は拒否する（見出しトピックでの `## 1. Overview` 等は許容）。
- **非同期ビュー更新の鮮度判定と厳密スナップショット比較**：非同期の読込・保存完了時は開始時の `path`・`loadSequence` と現在値を照合し、ノート切替・再読込後の遅着結果をビューへ反映しない。再描画スキップは LF 正規化 `contentHash` ではなく `path`・`basename`・`rawText`（改行コード含む）の厳密一致でのみ行う。
- **Obsidian グローバルホットキーとの競合回避（`View.scope`）**：`F2` など Obsidian 標準ホットキーと衝突するビュー内ショートカットは React `onKeyDown` に届かないため、`this.scope = new Scope(this.plugin.app.scope)` でビュー固有スコープに登録し、マップ内フォーカス（または `activeElement === document.body`）かつ非編集要素・非 IME 変換中のときのみ `return false` で処理する（Obsidian 1.15.1 実機確認済み）。
- **トピックノート直接編集（M2-c / M3）**：`SemanticCommand` の `updateNote` として実装し、PRD 必須の `field: 'note'` 下書き保護（`DraftStore` 退避・回復）と同時公開する。段落以外のブロック構文（見出し・箇条書き・コードフェンス等）が含まれる場合は書き戻さず理由通知＋下書き保持。箇条書きトピックのノートは元の字下げを自動付与する。
- **セキュリティ・Obsidian 審査基準**：`innerHTML` / `dangerouslySetInnerHTML` / `console.log` / deprecated API 禁止。外部リンクは `http:` / `https:` のみ、内部リンクはパストラバーサル（`..`）と絶対パスを遮断。
- **ツールチェーン・依存ビルド制約**：`pnpm` v11 ではビルドスクリプトを持つ依存の許否を [pnpm-workspace.yaml](../pnpm-workspace.yaml) の `allowBuilds` に明示しないと `ERR_PNPM_IGNORED_BUILDS` で `pnpm install` / `pnpm verify` が失敗する。単一パッケージ構成でも同ファイルを維持し、`allowBuilds: { esbuild: false }` で不要な postinstall を無効化する（実行バイナリはプラットフォーム別 `optionalDependencies` で動作することを確認済み）。また [package.json](../package.json) の `packageManager` は Corepack が自動ピン留めするため削除しない。

## 3.5 ビジュアル・UI/UX 設計指針（iThoughts 動画 10 件分析の踏襲仕様）

[ithoughts-youtube-analysis.md](./ithoughts-youtube-analysis.md) の分析を踏まえ、**Markdown 本文へ 1 バイトも視覚属性を書き込まない** 前提で、表現層（`src/core/layout/`, `src/ui/`, `styles.css`）および `data.json` ビュー設定へ以下を段階導入します。

- **ブランチ曲線と下線接続**：Level 0 → Level 1 は既定で先細り有機曲線（`tapered` SVG 塗りつぶしリボンパス）を描画し、`curved` / `orthogonal`（組織図用）と切替可能にする。`underline` 形状ノード（Level 3+）への接続終点は垂直中央ではなく下辺ベースライン（`y + height`）へ合わせ、曲線が下線へ滑らかに連続する表現とする。
- **カラーモードとパステルティント**：`pastel-fill`（Level 1〜2 にブランチ色の淡いティント塗り＋枠線、`underline` は透明背景＋下線）・`wireframe`・`monochrome` の 3 モードを Light / Dark Solarized の双方で提供する。
- **レイアウトモード**：`balanced`（左右放射・既定）、`right`（右片側展開）、`org-chart`（トップダウン組織図＋直交エルボー）を純粋レイアウトエンジン側で切り替える。
- **キャンバス＆ノード視認性**：高視認選択フレーム、展開時ホバー `-`／折畳時ブランチ色件数バッジ、任意背景パターン（`none` / `dots` / `grid`）、SVG アイコンバッジ（ノート・リンク・保全ブロック）、`- [ ]`/`[x]` タスク視覚表示・`#tag` ピル、非破壊トピック番号付けオーバーレイ（`off` / `1.2.3` / `a.b.c`）。
- **マップ内コントロール＆操作性**：
  - **Quick Style Popover**：設定画面を開かずテーマ・カラーモード・レイアウト・線種・グリッド・番号付けをライブプレビュー切替し、`data.json` へ永続化する。
  - **ノートホバープレビュー**：ノートアイコンへのホバーで先頭数行を即時プレビュー表示し、クリック/`Space`/`Cmd+Shift+T` で詳細ポップオーバー・編集へ遷移する。
  - **構造化フィルタ**：Quick Filter 欄の横に漏斗ポップオーバーを備え、Markdown 由来属性（ノート有・未完了/完了タスク・リンク有・保全ブロック有・`#tag`）で空間構造を保ったまま減光絞り込みを行う。
  - **拡張ステータスバー & カメラ追従**：トピック数・語数/文字数・ズーム・Focus・Styles を集約し、キーボード選択・新規追加時に画面外ノードへ自動パン追従する。`Cmd/Ctrl+Shift+0` で選択ノードフィットに対応する。

## 4. 実装ステータス

- **M0（環境構築）**：完了（`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `esbuild.config.mjs`, `eslint.config.mjs`, `vitest.config.ts`, `manifest.json`, `versions.json`, `styles.css`、ディレクトリ名 `thoughtforge-obsidian` へ統一）
- **M1（閲覧 MVP）**：完了（PR #1 で `main` へマージ済み。Core パーサー・レイアウト・Focus/Quick Filter・ナビゲーション、React HTML+SVG ビューア、Obsidian `FileView`・コマンド・設定・i18n、`pnpm verify`・Obsidian 1.15.1 実機確認済み）
- **M2-a（最小編集スライス）**：完了（PR #2 で `main` へマージ済み。`rename`/`insertChild`/`insertSibling`、Dry-Run 再解析、`FileCoordinator` / `MarkdownEditorGate`、`InlineEditor` + `imeGuard` + `editSession`、`viewGuard` + `View.scope` `F2`）
- **M2-b（構造編集・削除 & Undo/Redo）**：完了（PR #4 で `main` へマージ済み。`Shift+Tab` 新親・`Delete` 枝削除・`Cmd+Backspace` 子昇格削除・`Cmd+Arrow` 並替/昇降・`Cmd+Enter` 分割・`Cmd+Z/Shift+Z` Undo/Redo・タスク `[ ]`↔`[x]` 切替）
- **M2-ui（Visual Design & UI/UX Polish）**：完了（PR #5 で `main` へマージ済み。Section 3.5 のテーパード曲線・下線接続・カラーモード・3 レイアウト・Quick Style Popover・ノートホバープレビュー・構造化フィルタ・SVG バッジ・カメラ自動追従・フローティング HUD ステータスバー・非破壊トピック番号付け）
- **M2-c / M3（下書き保護＋本文直接編集 & 実用化）**：実装中（`DraftStore` による `field: 'title' | 'note'` 下書き退避・回復、`NodePopover` トピックノート直接編集・`Cmd+Shift+T`、ポインタ D&D 再配置・並替、枝コピー/カット/ペースト、コマンドパレット登録）
- **次フェーズ（M4 → M5）**：Obsidian Vault 連携強化・サイドカー視覚拡張検討（M4）、簡易プレゼン・エクスポート・`.itmz` インポート等（M5）
