# CLAUDE.md — thoughtforge-obsidian

このリポジトリは新規独立の Obsidian マインドマッププラグイン **ThoughtForge**（リポジトリ: `thoughtforge-obsidian`）の開発リポジトリです。

## 正本ドキュメント

- 要件定義: `docs/prd.md`
- 設計書: `docs/design.md`

## 必須ルール

1. **Markdown 正本・非破壊原則**：色・形・座標を Markdown へ保存しない。未対応ブロック（frontmatter、コード、表、引用、Callout、数式、HTML、コメント等）は 1 バイトも壊さない。
2. **Obsidian Community Plugin 審査基準・商標配慮**：
   - `innerHTML` / `outerHTML` / `insertAdjacentHTML` / `dangerouslySetInnerHTML` を禁止する。
   - `console.log` を残さない。
   - 既定ホットキーをコマンドに設定しない。
   - `workspace.activeLeaf` など deprecated API を使わない。
   - `manifest.json` の `id` / `name` に `obsidian` および他社製品名（`iThoughts` 等）を含めない（`id` は小文字とハイフンのみ、末尾 `plugin` 不可）。iThoughts リスペクト表記と非提携免責は `README.md` / `docs/prd.md` に記載する。
   - すべての CSS は `.ito-*` プレフィックス配下にスコープする。
3. **検証ゲート**：実装変更後は必ず `pnpm verify`（`typecheck` + `lint` + `test` + `build`）を通す。
4. **未実装箇所**：後続マイルストーンのフックは `// TODO: [理由] - [タスク内容]` 形式で明記する。
