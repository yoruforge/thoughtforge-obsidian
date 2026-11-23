---
name: obsidian-vault-verify
description: >-
  Run isolated Obsidian desktop smoke and acceptance checks for thoughtforge-obsidian
  using a dedicated test vault and profile without touching the user's main vault.
  Use when verifying UI changes, hotkeys, IME behavior, plugin manifest/ID changes,
  or Markdown sync before opening or merging a milestone PR.
---

# Obsidian 実機検証ランブック（thoughtforge-obsidian）

普段の Obsidian Vault や設定に影響を与えず、最新ビルドの `thoughtforge` プラグインを実機検証するための手順です。

## 事前準備

1. リポジトリルートで `pnpm verify` を通し、最新の `main.js` を生成する（作業ツリーに残る古い `main.js` をそのまま使わない）。
2. 隔離された一時ディレクトリに専用プロファイルとテスト用 Vault を作成する（普段の Vault は開かない）。
3. プラグイン配置先は **`<test-vault>/.obsidian/plugins/<manifest.id>/`**（現行は `thoughtforge`）とし、`manifest.json` の `id` とフォルダ名を一致させ、`main.js`・`manifest.json`・`styles.css` の 3 ファイルをコピーする。

## 標準確認項目

1. **起動・表示**: コマンドパレットからテストノートをマインドマップで開き、期待するトピック構造が表示されること。
2. **設定永続化**: 設定画面でテーマ等を変更し、テスト用 Obsidian プロセスを再起動したあと、設定画面・`data.json`・マップ表示の 3 点が一致すること。
3. **Markdown 編集・保全（M2 以降）**:
   - ダブルクリックおよび `F2` でのインライン改名、`Tab`（子追加）、`Enter` / `Shift+Enter`（前後兄弟追加）。
   - 保存後の `.md` ファイルを期待値と全文比較し、frontmatter・コードブロック・表・Callout 等が 1 バイトも変わっていないこと。
   - 順序付きリスト（例: `1. a`）の子追加後、Obsidian の Markdown 閲覧画面でも入れ子表示されること。
4. **日本語 IME**: 変換中の `Enter` と `compositionend` 直後の `Tab` で確定・フォーカス移動が誤爆せず、ガード時間経過後の `Enter` で正常保存されること（自動化で確認した場合は物理 IME 未確認である旨を報告する）。
5. **競合保護・外部変更**:
   - 同一ノートを隣の Markdown ペインで **編集モード（Source/Live Preview）** に固定して未保存変更を作り、マップ側からの編集が通知付きで拒否され、Markdown 側の未保存入力が保持されること。
   - タイトル編集中に外部変更が起きた際、別トピックを上書きせず入力中テキストの通知が出ること。

## 終了処理・報告

- 検証用 Obsidian プロセスを終了し、リポジトリの作業ツリーが汚れていないことを確認する。
- 確認できた項目（Obsidian バージョン明記）と未確認項目（例: 物理キーボード IME、旧バージョン互換）を分けて報告する。
