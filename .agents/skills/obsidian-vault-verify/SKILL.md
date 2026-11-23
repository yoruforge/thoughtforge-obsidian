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
2. 隔離された一時ディレクトリに専用プロファイル（`--user-data-dir`）とテスト用 Vault を作成する（ユーザーの普段使いの Vault や既定プロファイルは開かず、干渉しない）。
3. プラグイン配置先は **`<test-vault>/.obsidian/plugins/<manifest.id>/`**（現行は `thoughtforge`）とし、`manifest.json` の `id` とフォルダ名を一致させ、`main.js`・`manifest.json`・`styles.css` の 3 ファイルをコピーする。
4. 同一検証セッション内で別ノートへ切り替える場合は、先に既存の `thoughtforge-mindmap-view` リーフを閉じてから次のノートを開く（旧リーフが残ると DOM 選択が混線する）。外部変更の反映を確認する場合は、`fs.writeFileSync` 直後の待機よりも Obsidian の `vault.modify` を使う方がファイル監視タイミングの揺らぎを避けられる。

## 標準確認項目

1. **起動・表示**: コマンドパレットからテストノートをマインドマップで開き、期待するトピック構造が表示されること。
2. **設定永続化**: 設定画面または Quick Style Popover でテーマ・レイアウト等を変更し、テスト用 Obsidian プロセスを再起動したあと、設定画面・`data.json`・マップ表示の 3 点が一致すること。
3. **Markdown 編集・保全（M2 以降）**:
   - ダブルクリックおよび `F2` でのインライン改名、`Tab`（子追加）、`Enter` / `Shift+Enter`（前後兄弟追加）。
   - 保存後の `.md` ファイルを期待値と全文比較し、frontmatter・コードブロック・表・Callout 等が 1 バイトも変わっていないこと。
   - 順序付きリスト（例: `1. a`）の子追加後、Obsidian の Markdown 閲覧画面でも入れ子表示されること。
4. **日本語 IME**: 変換中の `Enter` と `compositionend` 直後の `Tab` で確定・フォーカス移動が誤爆せず、ガード時間経過後の `Enter` で正常保存されること（自動化で確認した場合は物理 IME 未確認である旨を報告する）。
5. **UI オーバーレイ隔離・描画実寸（M2-ui 以降）**:
   - Quick Style Popover 等のパネル内ボタンにフォーカスして `Tab` / `Shift+Tab` を押しても、マップの「子を追加」等の編集コマンドが誤発行されないこと。
   - パネルを開いた状態で `Cmd/Ctrl+P`（コマンドパレット）を開閉し、`Escape` が Obsidian オーバーレイを優先して閉じること。また検索欄への入力中にパネル再描画でフォーカスを奪われないこと。
   - 日本語見出しおよび同一 `#tag` を複数回繰り返した見出し（例: `#a #a #a #a #a #a`）で、計算上の配置と実寸が乖離して兄弟ノード同士が重ならないこと。
6. **トピックノート直接編集・下書き保護・D&D（M2-c 以降）**:
   - `Cmd/Ctrl+Shift+T` で本文編集を開き、`Cmd/Ctrl+Enter` で保存・Undo でき、見出し等のブロック構文混入時は Markdown を書き換えずに下書き（`data.json`）へ退避されること。
   - 検証用 Obsidian を再起動しても下書きが維持・復元でき、保存成功時に自動削除されること。
   - 同名トピック（別親の空行シフト、同一親の同名兄弟の行ズレ・改名）で別トピックへ自動誤復元・誤上書きされず、特定不能時は確認バナー（「ここに復元」／「破棄」）へ回ること。
   - **下書き形式・復元先の照合を変更した場合**：旧版の隔離 Vault で、同じ親の下に見出し・本文とも同じ兄弟を2つ作り、2つ目に下書きを保存する。`data.json` を引き継いでプラグインを更新し、2つ目を Markdown 側で改名する。1つ目の本文編集を開き、「ここに復元」を押さずに保存して、元の本文が保たれ、2つ目の下書きも `data.json` に残ることを確認する。旧版を用意できない場合は移行経路を未確認とする。
   - 書込競合中（in-flight）にタイトル分割（`Cmd/Ctrl+Enter`）を行っても入力全文が下書きへ退避されること。
   - ポインタ D&D の `Escape` キャンセルおよびキャンバス外リリース直後に、通常のノードクリックが効くこと。
7. **競合保護・外部変更**:
   - 同一ノートを隣の Markdown ペインで **編集モード（Source/Live Preview）** に固定して未保存変更を作り、マップ側からの編集が通知付きで拒否され、Markdown 側の未保存入力が保持されること。
   - タイトル編集中に外部変更が起きた際、別トピックを上書きせず入力中テキストの通知・下書き退避が行われること。

## 終了処理・報告

- 検証用に起動した Obsidian プロセス（専用プロファイル／デバッグポートで識別したプロセスのみ）を終了し、ユーザーの普段使いの Obsidian プロセスを決して終了・干渉しない。
- リポジトリの作業ツリーが汚れていないことを確認し、確認できた項目（Obsidian バージョン明記）と未確認項目（例: 物理キーボード IME、Windows/Linux、旧バージョン互換）を分けて報告する。
