# ThoughtForge (`thoughtforge-obsidian`)

Obsidian の通常 Markdown ノート（`.md`）を変換・複製せず、そのままマインドマップとして閲覧できる Obsidian プラグインです。キーボードで枝をたどり、表示範囲を絞り込めます。マップ上での編集は M2 で実装予定です。

> [!NOTE]
> **Disclaimer / 免責・商標について**
> ThoughtForge is an independent open-source project inspired by the keyboard-first mind mapping workflow of iThoughts (iThoughtsX). It is **not affiliated with, endorsed by, or sponsored by** iThoughts or toketaWare. All product names, logos, and brands are the property of their respective owners.
>
> 本プロジェクトは iThoughts（iThoughtsX）のキーボード中心の操作感に敬意を表して設計した独立オープンソースプロジェクトであり、iThoughts / toketaWare とは無関係・非提携です。記載の製品名は各権利者の商標または登録商標です。

## 現在の実装範囲（M0〜M1：閲覧 MVP）

- 通常 `.md` ノートの決定論的パーサー（見出し・箇条書き・トピックノート・未対応ブロック全行分類）
- Fail-Closed 安全判定（2MB 超・5,000 トピック超・閉じない frontmatter で停止、改行混在・インデント混在・箇条書き内見出しで読み取り専用）
- HTML + SVG ハイブリッド ＋ React 19 による左右自動レイアウト描画＆ビューポートカリング
- 階層 0〜9 スタイル継承、レインボー配色、ライト / Dark Solarized テーマ追従
- Zoom / Pan / 全体フィット、折りたたみ（`.`）、表示深度（`0`〜`9`）、Focus（固定 / 追従）、Quick Filter、キーボード矢印移動
- ノード詳細ポップオーバー（トピックノート閲覧・未対応ブロック表示・Markdown ソース行ジャンプ・安全なリンク起動）
- 英語 / 日本語 i18n、コマンドパレット登録（既定ホットキーなし）、設定画面

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
- ライセンス: [LICENSE](./LICENSE)（MIT）
