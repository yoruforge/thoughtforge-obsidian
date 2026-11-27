# M4-c 枝の切り出しの検証記録

## 検証対象コミット・履歴と成果物整合

本記録は `feat/m4c-extract-branch-to-note` ブランチにおける M4-c 実装および保護ブロック内参照カバレッジ検証の検証結果をまとめたものである。

| コミット | 内容 | Vitest 規模 | 備考 |
|---|---|---|---|
| `cd1cf77`（2026-11-26） | M4-c 初版実装 | 21 ファイル / 136 テスト | 初版受入記録および過去回帰 5 スイート（M4-b 13・M4-a 9・Phase 1 14・M2-c P1 7・M2-c 基本 6）実施版。 |
| `2ebfb92`（2026-11-26） | 復旧記録・保護ブロック・Redo 修正 | 21 ファイル / 143 テスト | `tests/core/extractBranch.test.ts` +4（10→14）・`tests/sync/branchExtraction.test.ts` +3（10→13）。当時 `docs/verification/m4c-acceptance.md` 未更新のため 136 件記載が残存していた。 |
| `f63efcc`（2026-11-27） | 保護ブロック内参照の網羅検証（Option C）コード＆テスト確定版 | 23 ファイル / 173 テスト | `tests/core/branchReferenceCoverage.test.ts` +25・`tests/obsidian/extractionAdapter.test.ts` +5 を追加。`pnpm verify` 全通過、隔離 Obsidian 1.15.1 で検証した `main.js`（509,027 bytes）のビルド元コード SHA（`f63efcc6a95cc935be322239596c23853b2bb9bd`）。 |
| 本記録コミット（`f63efcc` 後続） | `docs/verification/m4c-acceptance.md` のみ更新 | 23 ファイル / 173 テスト | `src/` および `tests/` は `f63efcc` と完全一致（`git diff f63efcc..HEAD -- src/ tests/` は空）。`main.js` は `.gitignore` 対象（非追跡）のため、`f63efcc` と同一ソース上で `pnpm verify`（`build` 含む）を再通過させて成果物の同等を担保。 |

## 自動検証（Mock-Cache / Pure Core Vitest）

以下の自動テストは **Vitest 上の模擬環境（`MockObsidianHarness` / `tests/obsidian/obsidianStub.ts` / 純粋 Core `CachedReferenceSnapshot`）** を用いた検証であり、実機 Obsidian の `metadataCache` 観測とは次節で明確に分離して記録する。

`pnpm verify`（`tsc --noEmit`・`eslint src tests`・`vitest run` **23 ファイル / 173 テスト**・`esbuild` 本番ビルド）が全通過した。Core の変換 14 ケース（`tests/core/extractBranch.test.ts`）には複数 H1、タブ・スペース・順序付きリスト、保護ブロック、CRLF、末尾改行、パス拒否、リスト枝内インデント保護ブロック拒否、コメントマスク列保持、ja/en エラーメッセージ局所化が含まれる。

### 保護ブロック内参照カバレッジ・結合回帰（`branchReferenceCoverage.test.ts` 25 件 + `extractionAdapter.test.ts` 5 件）

- **保護ブロック 4 種 × 3 条件**: `blockquote`・`callout`（見出し行／本文／折りたたみ `> [!tip]-`）・`table`（`\|` エスケープ別名含む）・`trailing-paragraph` に対し、(1) stale / `null` キャッシュ → 新規作成 0 件・元無変更で `metadata-updating` 停止、(2) 移動先で別ファイルへ解決 → `unsafe-reference` 停止、(3) 移動前後で同一解決 → 保護ブロックを 1 バイトも変更せず切り出し成功。
- **R1.1〜R1.4 境界ケース**: 複数行 Markdown リンク（`topic-note`・`list-item`・`trailing-paragraph`・`blockquote`・`callout` 見出し）、引用内 4 スペース字下げ `~~~` vs `<= 3` スペース正常フェンス（タブ仮想列・引用深度減少クローズ含む）、引用内 `> $$x$$` 同一行閉じ＋後続リンク、複数行／分割タグ HTML `src`・相対 `href`、および `> [![alt](...)` / `> [!alt](...)` 境界を検証。
- **非アクティブ領域の透過**: トップレベル／引用内のコードフェンス（`` ``` `` / `~~~`）・`indented-code`・数式ブロック・複数行 `%% ... %%` コメント（`visibleLines` マスクおよび誤キャッシュ済みリンク除外・枝手前からの状態引き継ぎ）で誤拒否せず非破壊切り出しが成功。
- **脚注・参照型リンク**: `footnote-def`・`link-ref-def`・インライン脚注参照 `[^1]`・文書内定義済み `[text][id]` / `[id][]` / `[id]` はキャッシュ空でも `unsafe-reference` 停止、未定義の `[TODO]` 等は許容。
- **最終コミット検査・ガード**: `commitExtraction` 事前通過後のキャッシュ変化（初回 `extract`・`retryId`・`redoForFile`）での最終停止および保存先・復旧記録保全、`MarkdownView` スタブ経由の `editor-dirty` ガードを検証。
- **ReDoS 線形時間耐性**: 悪意ある未閉鎖 `[`・バッククォート・`%%`・ネスト `>` を含む最大 50,000 文字入力（トークナイザ 8 種・カバレッジ 7 種）で線形終了を確認。

### 既存の障害注入・復旧（`tests/sync/branchExtraction.test.ts` 13 件）

| 障害注入 | 確認した結果 |
|---|---|
| R1・R2 | 別名で作成した保存先を再起動後に再利用。変更後も元枝を識別できれば再開し、同一内容の兄弟を区別できない場合は停止した。 |
| R3・R4 | 記録の永続化失敗時は作成 0 件。作成結果が不明な記録では明示確認を要求した。作成済み保存先の欠落、変更、未保存編集では元枝が残った。 |
| R5 | 元置換直後に保存先を失う場合、元が置換後の全文なら復元した。元にも外部追記があれば追記と復旧用原文が残った。 |
| B1・B2 | 改行だけ異なる保存先の再利用を拒否。参照先を確認できないケースでは新規作成前に停止した。 |
| H1・H2 | Undo は枝を復元して新ノートを保持。保存先が変化した Redo は履歴を消費せず、元の外部編集も保全した。 |
| C1 | 既存ノートや大小文字衝突を上書きせず、同時に開始した 2 要求による作成は 1 回だった。 |

関連テストの再実行コマンド:

```sh
pnpm exec vitest run tests/core/extractBranch.test.ts tests/core/branchReferenceCoverage.test.ts tests/obsidian/extractionAdapter.test.ts tests/sync/branchExtraction.test.ts
```

## 設計判断サマリ（OQ-1 / OQ-2）

- **OQ-1（複数行 Markdown リンク）**: 段落ラン結合で複数行リンクを検出し、(1) 未キャッシュ・位置または原文不一致（stale）は `metadata-updating`、(2) 最新キャッシュと完全一致する複数行内部リンク（`startLine !== endLine`、コメント外）は単一行 `ReferenceEdit` で書き換え不能かつ保護ブロック非破壊原則を維持するため `unsafe-reference`、(3) 外部 URL（`https?://`・`mailto:`・`tel:` 等）は `unsafe-reference` 停止前にスキップ許容（ただしラベル内ネスト内部画像は `(line, col)` 個別検証を継続）とした。
- **OQ-2（HTML ブロック・インライン HTML）**: HTML コメント（`<!-- ... -->`）・外部スキーム（`https?` / `mailto` / `tel` / `data` / `blob` / `about`）・フラグメント単独（`#...`）・`data-src` / `title` / `alt` 属性等を除外したうえで、`html-block`（コメントマスク後 `\n` 結合）およびアクティブ行インライン `<img ...>` / `<a ...>`（複数行分割タグ持ち越し含む）の相対 `src` / `href` と内部リンク記法を `unsafe-reference` で停止する方針とした。

## 5,000 トピック / ~1.8MB 性能参考計測（参考計測）

以下は `verifyBranchReferenceCoverage` 単体に対する隔離 Node 計測値であり、**参考計測**である（Design Doc NFR-1 の `< 10ms` はウォーム時の局所目標であり、5,000 トピック全枝走査に対するハード要件ではない。CI テストは環境揺らぎによるフレークを防ぐため `< 1_000ms` ガードを使用している）。

- **計測環境**: Node `v22.23.4` / `darwin arm64` / Apple M4 (10 cores) / コールド 1 回後、ウォームアップ 5 回 + 計測 20 回
- **全 5,000 トピック枝（`ok`, `1,771,345 bytes`, `10,000 lines`, `branchHeaderLine=1`）**: `cold = 59.261ms`, `warm(n=20): min = 36.659ms, median = 38.870ms, p95/max = 44.396ms`
- **全 5,000 トピック枝（topic 4,999 で `rejected`, `1,771,330 bytes`, `10,000 lines`, `branchHeaderLine=1`）**: `cold = 38.969ms`, `warm(n=20): min = 39.361ms, median = 40.451ms, p95/max = 58.873ms`
- **末尾 50 トピック枝（`ok`, `1,786,022 bytes`, `9,999 lines`, `branchHeaderLine=9,900`）**: `cold = 12.691ms`, `warm(n=20): min = 9.995ms, median = 10.882ms, p95/max = 11.428ms`（枝開始前の複数行コメント状態走査が支配）
- **先頭 50 トピック枝（`ok`, `1,790,971 bytes`, `9,999 lines`, `branchHeaderLine=1`）**: `cold = 0.984ms`, `warm(n=20): min = 0.434ms, median = 0.481ms, p95/max = 2.106ms`

## 隔離 Obsidian 1.15.1 実機検証（実 `metadataCache` / 実解決観測）

2026-11-27、`f63efcc` ビルド（`main.js`・`manifest.json`・`styles.css`）を専用 `--user-data-dir`（`obsidian-1.15.1.asar` 同梱、`ipcRenderer.sendSync('version') === '1.15.1'` を確認）および専用テスト Vault に配置し、Playwright CDP 経由で直列実機検証を実施した（新規保護ブロック実機 13 ケース + 既存 M4-c 受入 8 ケース、全 21 ケース通過）。

### 保護ブロック実 `metadataCache`・解決・R1 境界ケース（`Projects/Map.md` → `Archive/Branch.md`）

| ケース | Vault / 入力条件 | Obsidian 1.15.1 実 `metadataCache` / `getFirstLinkpathDest` 観測 | 結果 |
|---|---|---|---|
| `PB_1`（引用衝突） | `Projects/Picture.png` + `Archive/Picture.png`、`> [[Picture.png]]`・`> ![alt](Picture.png)` | `cache.links` に `[[Picture.png]]`（L4 col 2..17）、`cache.embeds` に `![alt](Picture.png)`（L5 col 2..21）登録。移動先解決が `Projects/Picture.png` → `Archive/Picture.png` へ変化。 | `unsafe-reference` で停止（作成 0 件・元無変更） |
| `PB_2`（Callout 衝突） | `Projects/Picture.png` + `Archive/Picture.png`、`> [!note] [[Picture.png]]`・`> [[Picture.png]]` | `cache.links` に 2 件（L4 col 10..25 / L5 col 2..17）登録。移動先で `Archive/Picture.png` へ変化。 | `unsafe-reference` で停止（作成 0 件・元無変更） |
| `PB_3`（表衝突） | `Projects/Picture.png` + `Archive/Picture.png`、`\| [[Picture.png\|Alias]] \|`・`\| [pic](Picture.png) \|` | `cache.links` に `original: "[[Picture.png\\|Alias]]"`（L6 col 2..24）および `"[pic](Picture.png)"`（L7 col 2..20）を原文どおり登録。 | `unsafe-reference` で停止（作成 0 件・元無変更） |
| `PB_4`（`trailing-paragraph` 衝突） | `Projects/Picture.png` + `Archive/Picture.png`、`%% marker %%\n\nTrailing [[Picture.png]]` | `cache.links` に `[[Picture.png]]`（L6 col 9..24）登録。 | `unsafe-reference` で停止（作成 0 件・元無変更） |
| `PB_5`（一意 / フルパス安全解決） | 上記 4 ブロックに `Projects/Picture.png`・`Unique.png`・`Assets/Unique.png` を配置 | `cache.links` 6 件・`cache.embeds` 1 件すべてが移動元・移動先双方で `Projects/Picture.png` または `Assets/Unique.png` へ同一解決。 | 切り出し成功、保護ブロック全文バイト一致 |
| `PB_6`（コードフェンス） | 衝突画像ありで `` ```md\n[[Picture.png]]\n``` `` と `` > ```md\n> [[Picture.png]]\n> ``` `` | `cache.links: []`、`cache.embeds: []`（実キャッシュ上も非参照）。 | 切り出し成功、両コードフェンスバイト一致 |
| `R1_1`（引用内複数行 MD リンク） | `Projects/Picture.png`（一意）、`> [photo\n> caption](Picture.png)` | **Obsidian 1.15.1 実 `cache.links` は単一の複数行 `LinkCache`（`start: {line: 4, col: 2}`, `end: {line: 5, col: 23}`, `original: "[photo\n> caption](Picture.png)"`）として登録**。 | 最新キャッシュ一致＋複数行内部リンクとして `unsafe-reference` 停止（作成 0 件・元無変更） |
| `R1_2`（引用内 4 スペース字下げ `~~~`） | `>     ~~~\n>\n> [[Picture.png]]`（衝突あり / 一意の 2 条件） | `cache.links` に `[[Picture.png]]`（L6 col 2..17）を登録。 | 衝突時 `unsafe-reference` 停止／一意時切り出し成功・原文バイト一致 |
| `R1_3`（引用内 `$$x$$` 同一行閉じ） | `> $$x$$ and [[Picture.png]]\n> [[Other.png]]`（衝突あり / 一意の 2 条件） | `cache.links` に `[[Picture.png]]`（L4 col 12..27）と `[[Other.png]]`（L5 col 2..15）の双方を登録。 | 衝突時 `unsafe-reference` 停止／一意時切り出し成功・原文バイト一致 |
| `R1_4`（複数行 HTML `<img>`・`<a>`） | `<div>\n<img src=\n"Picture.png">\n</div>` および `<div>\n<a href=\n"Target.md">go</a>\n</div>` | `cache.links: []`、`cache.embeds: []`（Obsidian 本体は生 HTML をリンク登録しないことを実測）。 | OQ-2 に従い `unsafe-reference` 停止（作成 0 件・元無変更） |

### 既存 M4-c 受入 8 ケース（`f63efcc` ビルド上で再検証・全通過）

再起動試験（`M4C_06`）では、テスト用の Obsidian プロセスを実際に `SIGTERM` 終了してから同一 `--user-data-dir` と Vault で再起動し、`1.15.1` 上で復旧通知・記録維持・再試行完了を確認した。

| ケース | 操作と合格条件（`f63efcc` 上の実機観測） |
|---|---|
| `M4C_01` | ポップオーバーで見出し枝を切り出した。コードブロックと子孫を含む新ノート、ブロック ID（`^alpha-id`）を保持した元ノートを全文照合し、リンクバッジ遷移と「戻る」を確認した。 |
| `M4C_02` | タスク枝をコマンドから切り出した。元のタスク記号・ブロック ID（`^task-id`）と、新ノートの本文・子リストの字下げ解除を全文一致で確認した。 |
| `M4C_03` | 新規ノート作成後に CDP 経由で `app.vault.process` を失敗させた。元ノートの Markdown 全文一致、復旧モーダル表示、`data.json` 上の `phase: 'created'` 記録、UI からの記録解消を確認した。 |
| `M4C_04` | 別内容の既存ノートを指定すると実行ボタンが無効になり、そのノートの内容を保持した。 |
| `M4C_05` | Undo 後の元ノートは抽出前の全文と一致し、切り出し先ノートが残った。 |
| `M4C_06` | 再起動後、復旧通知と未完了記録 2 件を確認した。保存先欠落時は実行不可になり、復元後は 2 本目の「メモ」に記録済みフォルダと `SecondMemo.md` が読み取り専用で表示され、再試行後も保存先は 1 件で 1 本目の本文が残った。曖昧な枝は確認チェック有効化まで実行不可となり、確認後に完了・記録解消された。 |
| `M4C_07` | Undo 後に保存先を編集モードで未保存変更（`dirty` 判定）または削除すると Redo は履歴を消費せず拒否された。保存先の内容・パスを戻すと Redo を再適用できた。 |
| `M4C_08` | 同名の画像とノートを移動元・先の両フォルダに配置し、バイナリ書込で実 CRLF ファイルを作成した。Wiki・Markdown の 4 参照が元のファイルを指すことを Obsidian のメタデータで確認した。CRLF コードブロックを保持し、既存出力を LF のみへ変更した状態では再利用を拒否した。 |

「切り出し先をマップで開く」、合成 IME イベント中（`compositionstart` → `compositionend` 直後の `Enter`）の抑止、相対 Markdown リンク設定での別フォルダへの遷移も確認した。相対設定の通常出力が上位フォルダ参照（`../`）になる場合は、マップで開ける Vault 内パスで同じ実ファイルを指定した。

## 検証の範囲・未実行項目・既知 Caveats

- **未再実行スイート（`f63efcc` 時点）**: 既存の隔離回帰 5 スイート（M4-b 13 件・M4-a 9 件・Phase 1 14 件・M2-c P1 7 件・M2-c 基本 6 件）は `cd1cf77`（2026-11-26）時点で通過済みだが、`f63efcc` では再実行していない（変更が `ExtractionAdapter.ts`・`blockScanner.ts`・`inlineMarkdown.ts`・`branchReferenceCoverage.ts` に局所化しているため Design Doc §13 OQ-3 に従い M4-c 対象範囲へ限定）。
- **未実施環境・操作**: 新モーダル等での**物理日本語キーボード IME**、**Windows / Linux 実機**、**スクリーンリーダー**は未実施。
- **模擬ハーネス上の `../` 注記**: Vitest の `MockObsidianHarness.resolveLinkDest` は `..` パス正規化を持たないため、保護ブロック内 `../` 相対パス遮断は本番コード検査（`src/obsidian/ExtractionAdapter.ts`・`src/core/view/vaultLinkPath.ts`・`src/core/patch/extractBranch.ts`）および非存在未解決ケースで担保している。
- **非原子性・障害注入前提**: ファイル書き込み失敗や最終検査直後の競合は意図的な障害注入（模擬ハーネスおよび CDP 経由 `app.vault.process` ラップ）で確認した。2 ファイルを同時に更新する原子性は前提にしていない。元にも外部変更がある場合は「未完了の切り出しを復旧する」で元枝の Markdown を取り出せる。
