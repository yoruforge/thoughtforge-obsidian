# ThoughtForge (`thoughtforge-obsidian`)

Obsidian の通常 Markdown ノート（`.md`）を変換・複製せず、**そのままマインドマップとして閲覧・双方向編集できる** Obsidian プラグインです。色・座標・レイアウト設定を Markdown 本文に一切書き込まず、未対応ブロック（frontmatter、コードブロック、表、Callout 等）を 1 バイトも壊さずに最小差分で同期します。

> [!NOTE]
> **Disclaimer / 免責・商標について**
> ThoughtForge is an independent open-source project inspired by the keyboard-first mind mapping workflow of iThoughts (iThoughtsX). It is **not affiliated with, endorsed by, or sponsored by** iThoughts or toketaWare. All product names, logos, and brands are the property of their respective owners.
>
> 本プロジェクトは iThoughts（iThoughtsX）のキーボード中心の操作感に敬意を表して設計した独立オープンソースプロジェクトであり、iThoughts / toketaWare とは無関係・非提携です。記載の製品名は各権利者の商標または登録商標です。

## 現在の実装範囲（Phase 1 完了：M0〜M3）

### 閲覧・レイアウト・UI/UX（M1 / M2-ui）
- 通常 `.md` ノートの決定論的パーサー（見出し・箇条書き・順序付きリスト・トピックノート・未対応ブロックの全行分類）
- **Fail-Closed 安全判定**：2MB 超・5,000 トピック超・閉じない frontmatter で表示停止、改行コード混在・リストのタブ/スペース混在・箇条書き内見出し・範囲重複で読み取り専用化
- **HTML + SVG ハイブリッド ＋ React 19** による自動レイアウト描画＆ビューポートカリング
- **3 レイアウト切替**：左右バランス放射（`balanced`）／右片側展開（`right`）／トップダウン組織図（`org-chart`）
- **表現＆Quick Style Popover**：先細り有機曲線（`tapered`）・滑らか曲線・直交エルボー、パステル塗り／ワイヤーフレーム／モノクロ、レインボー配色、Light / Dark Solarized テーマ追従、背景パターン（無地／ドット／グリッド）、非破壊トピック番号付けオーバーレイ
- **ナビゲーション＆絞り込み**：Zoom / Pan / 全体フィット（`Cmd/Ctrl+0`）・選択フィット（`Cmd/Ctrl+Shift+0`）・選択ノード自動追従、折りたたみ（`.`）・表示深度（`0`〜`9`）、Focus（固定 / 追従）、Quick Filter（`/`）＋構造化フィルタ（ノート有・タスク状態・リンク・`#tag`・保全ブロック）
- ノートホバークイックプレビュー、詳細ポップオーバー（ソース行ジャンプ・安全なリンク起動）、英語 / 日本語 i18n、コマンドパレット登録（既定ホットキーなし）

### 双方向編集・下書き保護・D&D（M2-a / M2-b / M2-c・M3）
- **最小差分＆非破壊同期**：Dry-Run 再解析と `vault.process` CAS 照合により、対象範囲のみ最小差分で書き戻し。frontmatter・コードブロック・表・Callout・タスク記号・行末 `^block-id` を保持
- **未保存 Markdown 競合保護**：同一ノートを開いている Markdown エディタに未保存編集がある場合は書き込みを中断（ディスク無書込）
- **日本語 IME ガード**：`compositionstart` / `compositionend` ガード時間により、変換確定の `Enter` や確定直後の `Tab` 誤爆を防止
- **トピックノート直接編集＆`DraftStore` 下書き保護**：`Cmd/Ctrl+Shift+T` でポップオーバーからトピックノート本文を直接編集（`Cmd/Ctrl+Enter` 保存）。競合・ブロック構文拒否・書込中競合時は `data.json` へ自動退避し、再起動後も復元可能。文書変更後に復元先を一意特定できない場合は自動展開せず確認バナー（「ここへ復元」／「破棄」）へフェイルクローズ
- **ポインタ D&D＆枝コピペ**：6px しきい値付きドラッグ＆ドロップ再配置・並替（`Esc` キャンセル対応）、枝単位のコピー／カット／ペースト（`Cmd/Ctrl+C/X/V`）、Undo / Redo（`Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`）

## 主なキーボードショートカット（マップ内フォーカス時）

| 操作 | ショートカット |
|---|---|
| 選択移動 | 矢印キー（`↑` `↓` `←` `→`） |
| タイトル編集 | `F2` / `Cmd/Ctrl+Enter` / ダブルクリック |
| 編集中の兄弟分割 | 編集中に `Cmd/Ctrl+Enter` |
| 子トピック追加 / 新親を挿入 | `Tab` / `Shift+Tab` |
| 兄弟トピック追加（後 / 前） | `Enter` / `Shift+Enter` |
| 枝削除 / 子を昇格して削除 | `Delete` (`Backspace`) / `Cmd/Ctrl+Backspace` |
| 兄弟並替（上下） / 階層移動（インデント・アウトデント） | `Cmd/Ctrl+↑↓` / `Cmd/Ctrl+←→` |
| Undo / Redo | `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`（Windows/Linux は `Ctrl+Y` も対応） |
| トピック詳細ポップオーバー / ノート本文直接編集 | `Space` / `Cmd/Ctrl+Shift+T`（保存: `Cmd/Ctrl+Enter`） |
| 枝コピー / カット / ペースト | `Cmd/Ctrl+C` / `Cmd/Ctrl+X` / `Cmd/Ctrl+V` |
| 折りたたみ切替 / 表示深度 | `.` / `0`〜`9` |
| 全体フィット / 選択フィット / クイック検索 | `Cmd/Ctrl+0` / `Cmd/Ctrl+Shift+0` / `/` |

## 旧スナップショット（0.0.1）を利用している場合

旧版と現版は同じプラグイン ID `thoughtforge` を使います。旧版の `data.json` がある Vault では、現版は旧形式の設定・下書きを読み込めず、元のデータを保護するため設定変更も保存しません。旧版の編集機能や下書きが必要な場合は、その Vault を旧版のまま使い、現版は別のテスト用 Vault で試してください。旧版のソースは [退避ブランチ](https://github.com/yoruforge/thoughtforge-obsidian/tree/archive/v0-monorepo-snapshot) で確認できます。

## セットアップ・検証コマンド

```bash
pnpm install
pnpm verify
```

個別コマンド：

```bash
pnpm typecheck   # TypeScript 厳格型チェック
pnpm lint        # ESLint (TypeScript + React Hooks + セキュリティ規約)
pnpm test        # Vitest 単体テスト
pnpm build       # 本番バンドル生成 (main.js)
pnpm dev         # 開発用 watch ビルド
```

テスト用 Vault で実機確認する場合は、`<Vault>/.obsidian/plugins/thoughtforge/`（`manifest.json` の `id` と一致するフォルダ名）へ `main.js`・`manifest.json`・`styles.css` を配置してください。

## ドキュメント・ライセンス

- 企画書・要件定義書: [docs/prd.md](./docs/prd.md)
- 設計書: [docs/design.md](./docs/design.md)
- iThoughts UI/UX・動画 10 件分析: [docs/ithoughts-youtube-analysis.md](./docs/ithoughts-youtube-analysis.md)
- ライセンス: [LICENSE](./LICENSE)（MIT）
