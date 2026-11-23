# iThoughts / iThoughtsX YouTube 動画 10 件分析 & ThoughtForge 踏襲設計レポート

> [!NOTE]
> 本ドキュメントは、開発終了した iThoughts / iThoughtsX の操作感・デザイン・情報設計から学び、**ThoughtForge（`thoughtforge-obsidian`）** の要件・UI/UX・ビジュアル設計へ昇華させるための調査レポートです。
> ThoughtForge は独立したオープンソースプロジェクトであり、iThoughts / toketaWare とは無関係・非提携です。記載の製品名は各権利者の商標であり、ロゴ・固有アイコン・意匠の直接模倣は行いません。また、すべての機能踏襲は **Markdown 正本・非破壊原則（色・形・座標を Markdown 本文へ保存しない）** の枠内で設計します。

---

## 1. 分析対象 YouTube 動画 10 件一覧

macOS（Big Sur / Classic OS X）および iPadOS / iOS での実操作・公式チュートリアル・日本語解説・レイアウトデモを網羅する実在動画 10 件を調査・フレーム観察しました。

| # | 動画タイトル | チャンネル | 尺 | URL | 主な検証領域 |
|---|---|---|---|---|---|
| 1 | iThoughtsX - The Ultimate Mind Mapping App on Big Sur | aMacxd | 7:46 | https://www.youtube.com/watch?v=0E78VnEBx_M | Big Sur UI・グリッド背景・上部 Notes ペイン・Boundary/Summary/Relationship・ステータスバー・ショートカットツールチップ |
| 2 | iThoughts Tutorial - Adding basic content | Biggerplate | 8:54 | https://www.youtube.com/watch?v=0IpRYdJkZRE | テーパード虹色ブランチ・パステル塗り丸角ノード・D&D 左右反転・折畳 `+`/`-` バッジ・Focus・Quick Filter |
| 3 | iThoughts Tutorial - Formatting your map style | Biggerplate | 7:18 | https://www.youtube.com/watch?v=i9Y1afw2f7I | 4 タブ `Style Sheet`（Map/Color/General/Levels）・カラーモード 4 種・Level 1 `Tapered` / Level 2+ `S Bend`・Callout・ライブプレビュー |
| 4 | iThoughts Tutorial - Adding Notes | Biggerplate | 2:40 | https://www.youtube.com/watch?v=Uckj_dQ4eiI | `Shift+Cmd+T` ノートペイン・ノード内ノートアイコンバッジ・**ホバークイックプレビュー**・空保存時の自動バッジ消去 |
| 5 | iThoughts Tutorial - Giving Presentations | Biggerplate | 4:15 | https://www.youtube.com/watch?v=R0Vl45_VUgI | 左サイドバー型スライド一覧・全体→各主要枝への滑らかなズーム遷移・下部ステータスバー `Zoom% | Focus` |
| 6 | iThoughts Tutorial - Task Information | Biggerplate | 4:33 | https://www.youtube.com/watch?v=oWGKNGbL384 | タスクパネル ポップオーバー・ノード内メタデータピル（日付・進捗・優先度 `[1]` 等）・`Clear All` |
| 7 | iThoughts Tutorial - Filtering | Biggerplate | 6:33 | https://www.youtube.com/watch?v=1XvWhUvXYL0 | `Quick Filter` 検索欄＋隣接する漏斗フィルタボタン・空間構造を維持した非一致ノード減光・チェック/フラグ/期限フィルタ |
| 8 | 【10分で解説】マインドマップアプリ決定版！iThoughtsの使い方 〜基礎編〜 | 元役者エンジニアむね | 8:40 | https://www.youtube.com/watch?v=h7_3szRJqzk | 日本語入力ワークフロー・**トピック番号付け**（`1.2.3...`, `a.b.c...`）・破線選択枠・方向クイック追加・全体フィット |
| 9 | Mind mapping iOS with iThoughts | Spondicious | 6:28 | https://www.youtube.com/watch?v=hukT0zEIK_8 | タッチ/キーボード併用・長押し追加メニュー（親/子/前後兄弟）・引き下げノートドロワー・D&D 並替・Focus 減光 |
| 10 | iThoughts Layouts | iThoughtsVideos | 1:19 | https://www.youtube.com/watch?v=h9y1_ximCd4 | レイアウト切替（左右放射 / トップダウン組織図＋直交エルボー / 高密度ファン）・丸角ボックスと下線テキストの階層混在 |

---

## 2. 機能網羅性マトリクス（iThoughts ⇄ ThoughtForge）

ThoughtForge の **Markdown 正本・非破壊原則** に照らし、全機能を 5 段階へ分類して網羅的に整理しました。

| 機能領域 | 参照動画 | ThoughtForge 現行（M1 / M2-a） | 踏襲方針・配置フェーズ | Markdown 非破壊整合 |
|---|---|---|---|---|
| 階層トピック描画・左右バランス配置 | #2, #10 | 実装済 | 維持・強化（**M2-ui**） | 100% 表現層 |
| 階層 0〜9 スタイル継承・レインボー配色 | #2, #3 | 実装済（均等線・白背景） | **パステルティント塗り＋カラーモード 3 種**へ刷新（**M2-ui**） | 100% 表現層（`data.json`） |
| テーパード有機曲線＆下線ベースライン接続 | #2, #3, #8, #10 | 未実装（均一幅 Bézier） | **Level 1 テーパード曲線 + `underline` 下線接続**（**M2-ui**） | 100% 表現層 |
| レイアウト切替（左右 / 右片側 / 組織図） | #3, #10 | 左右のみ | **`balanced` / `right` / `org-chart`（直交エルボー）** 追加（**M2-ui**） | 100% 表現層（`data.json`） |
| キャンバス背景グリッド（無地 / ドット / 方眼） | #1 | 単色背景のみ | オプション切替追加（**M2-ui**） | 100% 表現層（`data.json`） |
| マップ内 Style Sheet（ライブプレビュー切替） | #1, #3 | Obsidian 設定画面のみ | **Quick Style Popover** をマップ内に追加（**M2-ui**） | 100% 表現層（`data.json`） |
| 折りたたみ（`.` / `+`/`-`）・深度 `0〜9` | #2, #5, #9 | 実装済 | 展開時ホバー `-`・折畳時ブランチ色カウントバッジへ磨上げ（**M2-ui**） | ビュー状態のみ |
| Focus（固定/追従）＆ Zoom / Fit / 選択フィット | #2, #5, #7 | Focus・`⌘0` 実装済 | **`⌘⇧0` 選択フィット**・選択ノードへの自動パン追従追加（**M2-ui**） | ビュー状態のみ |
| Quick Filter ＋ 構造化フィルタ（漏斗） | #2, #7 | テキスト Quick Filter のみ | **Markdown 由来属性フィルタ**（ノート有 / `[ ]` / `[x]` / リンク / `#tag` / 保全ブロック）（**M2-ui**） | 100% パース結果由来 |
| トピックノート閲覧・ホバープレビュー・直接編集 | #1, #4, #9 | ポップオーバー閲覧のみ | **ノートアイコン SVG 化＋ホバープレビュー**（**M2-ui**）＆**`field: 'note'` 下書き保護と同時公開する直接編集＋`⌘⇧T`**（**M2-c**） | 段落のみ最小差分書戻し＋下書き保護 |
| リンクバッジ＆安全起動 | #1, #4 | 実装済（テキスト `↗`） | SVG リンクアイコン化＋`⌘K` 編集補助（**M2-ui / M2-b**） | Markdown リンクそのまま |
| タスクチェックボックス視覚化・トグル | #6, #7 | `[ ]` 保護のみ（生文字表示） | **チェックボックス視覚描画**（**M2-ui**）＆**クリックトグル `[ ]`↔`[x]`**（**M2-b**） | 既存 Markdown タスク記法のみ |
| トピック番号付け表示（`1.2.3` / `a.b.c`） | #8 | 未実装 | **非破壊表示オーバーレイ**（`off` / `1.2.3` / `a.b.c`）（**M2-ui**） | 100% 表現層（本文不変） |
| ステータスバー（語数・ズーム・Focus・Styles） | #1, #2, #5, #8 | トピック数・編集可否のみ | 語数/文字数・ズーム・Focus・Styles 起動を追加（**M2-ui**） | 100% 表現層 |
| Classic Keymap 基本（`F2`/`Tab`/`Enter`/`⇧Enter`） | #1, #2 | **M2-a 実装＆実機検証済** | 維持（`View.scope` `F2` + 日本語 IME ガード） | 最小差分＋CAS 保護 |
| Classic Keymap 拡張（`⇧Tab` / `Del` / `⌘⌫` / `⌘矢印` / `⌘Z` / `⌘Enter` 分割） | #1, #9 | 未実装（`commands.ts` 予約済） | **M2-b** で `planner.ts` / `FileCoordinator` Undo-Redo 接続 | 最小差分＋Dry-Run 検証 |
| ドラッグ＆ドロップ再配置・並替・枝コピペ | #2, #9 | 未実装 | **M2-c / M3** で `reparent` / `moveSibling` / `pasteBranch` 接続 | インデント破壊時は Fail-Closed |
| 画像サムネイル `![[ ]]`・`#tag` ピル・リンク遷移 | #1, #7 | リンク起動のみ | `#tag` ピル描画（**M2-ui**）、画像サムネイル・地図間移動・Backlinks（**M4 / Phase 2**） | Obsidian ネイティブ記法 |
| Boundary（境界）・Relationship（関係線）・Callout・個別色/アイコン | #1, #3, #10 | 未対応 | **Phase 2（M4）以降で `NodeMetadataProvider` サイドカー保存を検討** | **Markdown 本文へは一切書かない** |
| 簡易プレゼンテーションモード（枝順ズーム遷移） | #5 | 未実装 | **Phase 3（M5）** で全体→主要枝の自動スライド遷移として実装検討 | 100% 表現層（専用ファイル不要） |
| 独自タスク属性（Effort/Cost/Resources/Rollup）・自由座標・Doodle・独自同期・Office 出力 | #6, #9 | 対象外 | **意図的対象外（PRD 原則維持）** | 独自記法による Markdown 汚染を防止 |

---

## 3. ビジュアルデザイン踏襲仕様（ThoughtForge デザイン言語）

動画 10 件から抽出した「一目で構造が分かり、長時間思考しても疲れない」視覚要素を、独自ブランド **ThoughtForge** のクリーンなデザイン言語として整理します（全 CSS は `.ito-*` 配下に厳密スコープ）。

### 3.1 エッジ（ブランチ曲線）とノード接続
- **Level 0 → Level 1 テーパード有機曲線（既定: `tapered`）**:
  - 中央ノード付け根を太く（約 `9px`）、Level 1 ノード側へ向かって滑らかに先細る（約 `2.5px`）塗りつぶし SVG Bézier リボンを描画し、マップの重心と放射方向を直感的に示す（動画 #2, #3, #5, #8）。
  - 設定で `curved`（均一幅 S ベンド曲線）および `org-chart` 時の `orthogonal`（直交エルボー線、動画 #10）へ切替可能にする。
- **Level 2+ S ベンド曲線 & `underline` ベースライン接続**:
  - `rounded-pill` / `rounded-rect` ノードには垂直中央（`y + height / 2`）へ接続する。
  - `underline` 形状（Level 3+ リーフ）には **下辺ベースライン（`y + height`）へ滑らかに接続** し、曲線がそのまま下線へと連続する軽快な見通しを実現する（動画 #3, #10）。

### 3.2 カラーモードとパステルティント塗り
動画 #2, #3, #8 に見られる「視認性と落ち着きの両立」を 3 つのカラーモードで表現します：
1. **`pastel-fill`（既定）**: Level 1〜2 の丸角ノード背景にブランチ色の淡いティント（Light: 約 10〜14%、Dark Solarized: 約 18〜22%）を敷き、同系色の鮮明な枠線を付与。Level 3+ は透明背景＋ブランチ色下線。
2. **`wireframe`**: 透明/ニュートラル背景＋ブランチ色枠線＆ブランチ色曲線（印刷・高密度マップ向け）。
3. **`monochrome`**: 単色アクセント＋明度差のみで階層表現（集中・ミニマル思考向け）。

### 3.3 選択フレーム・折畳ハンドル・背景グリッド・バッジ
- **選択リング**: 破線または二重ハロー（`box-shadow` + `outline`）で選択ノードを瞬時に視認可能にし、高速矢印移動時に見失わない設計（動画 #1, #8, #9）。
- **折りたたみハンドル**: 展開済みノードの `-` は通常時控えめ（ホバーまたは選択時に強調）、折りたたみ済みノードの件数バッジ（例: `4`）はブランチ色塗りつぶし＋白文字で常に明瞭表示（動画 #2, #5）。
- **キャンバス背景パターン**: `none`（無地）/ `dots`（微細ドット）/ `grid`（微細方眼、動画 #1 着想）を CSS `background-image` で提供。
- **SVG アイコンバッジ & Markdown ピル**:
  - テキスト文字の `N` / `!` / `↗` を明瞭なインライン SVG アイコン（React 要素、禁止 HTML API 不使用）へ置換。
  - `- [ ]` / `- [x]` はモノスペース生文字列ではなく視認性の高いチェックボックス表示とし、`#tag` はコンパクトなタグピルとして表示（編集時は原文そのままをインラインエディタへ渡して非破壊を維持）。

---

## 4. UI レイアウト踏襲仕様

1. **マップ内 Quick Style Popover（動画 #1, #3 着想）**:
   - ツールバーまたはステータスバーの `Styles` ボタンから即座に開閉できる小型ポップオーバー。
   - テーマ（Auto / Light / Dark Solarized）、カラーモード（Pastel / Wireframe / Monochrome）、レインボー配色、レイアウト（左右 / 右片側 / 組織図）、ブランチ線種（テーパード / 曲線 / 直交）、背景グリッド（無地 / ドット / 方眼）、トピック番号付け表示（Off / `1.2.3` / `a.b.c`）を **ライブプレビュー** で切替え、Obsidian の `data.json` に保存する。
2. **ノートアイコンのホバークイックプレビュー & トグル編集（動画 #1, #4, #9 着想）**:
   - トピックのノートアイコンへマウスオーバーすると、ポップオーバーを開かずに先頭数行を軽快にプレビュー表示する（動画 #4）。
   - `Space` または `Cmd/Ctrl+Shift+T` で詳細ポップオーバー／ノート編集欄を開閉し、空で保存すればバッジも自動消滅する。
3. **Quick Filter ＋ 構造化フィルタ ポップオーバー（動画 #7 着想）**:
   - ツールバー右上の `Quick Filter` 検索欄の隣に漏斗アイコンボタンを配置。
   - テキスト検索に加え、Markdown 由来の属性フィルタ（`ノート有` / `未完了タスク [ ]` / `完了タスク [x]` / `リンク有` / `保全ブロック有` / `#tag`）を空間構造を維持したまま減光フィルタリングできる。
4. **情報密度と操作性を兼ねた下部ステータスバー（動画 #1, #2, #5, #8 着想）**:
   - 左側: トピック数・総文字数/語数、編集状態/読取専用理由、フィルタ一致数
   - 右側: クリックでリセットできるズーム倍率、Focus 状態切替、`Styles` ポップオーバー起動

---

## 5. UX・キーボード＆マウス操作踏襲仕様

| 操作 | ショートカット（マップ内） | 動画出典 | 実装フェーズ |
|---|---|---|---|
| インライン改名 | `F2`（`View.scope`）/ ダブルクリック | #1, #2 | **M2-a 済** |
| 子トピック追加 | `Tab` | #1, #2, #9 | **M2-a 済** |
| 後ろ / 前に兄弟追加 | `Enter` / `Shift+Enter` | #1, #2, #9 | **M2-a 済** |
| **新親トピック挿入** | `Shift+Tab` | #9 / 公式仕様 | **M2-b** |
| **カーソル位置で兄弟分割 / 編集開始** | `Cmd/Ctrl+Enter` | 公式仕様 | **M2-b** |
| **枝削除 / 子を昇格して単体削除** | `Backspace`/`Delete` / `Cmd/Ctrl+Backspace` | #2 / 公式仕様 | **M2-b** |
| **兄弟並替・階層昇降** | `Cmd/Ctrl+Arrow` | 公式仕様 | **M2-b** |
| **Undo / Redo** | `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` | #8, #9 | **M2-b** |
| **ノート編集トグル** | `Cmd/Ctrl+Shift+T`（＋ `Space` ポップオーバー） | #1, #4 | **M2-c（下書き保護と同時）** |
| 折りたたみ / 深度表示 | `.` / `0`〜`9` | #2, #5 | **M1 済** |
| Focus 切替 / Quick Filter | `F` / `/` | #2, #7 | **M1 済** |
| 全体フィット / **選択ノードへズームフィット** | `Cmd/Ctrl+0` / `Cmd/Ctrl+Shift+0` | #5, #8 / 公式仕様 | `⌘0` 済 / **`⌘⇧0` M2-ui** |
| **枝のカット・コピー・ペースト** | `Cmd/Ctrl+X / C / V` | 公式仕様 | **M2-c / M3** |
| **D&D による親変更・兄弟並替** | ノードドラッグ＆ドロップ（挿入ライン表示） | #2, #9 | **M2-c / M3** |

追加の UX 磨上げポイント：
- **選択ノードへの自動カメラ追従**: 矢印キー移動や `Tab`/`Enter` で新規作成したノードがビューポート端・画面外へ出た場合、最小距離だけ滑らかにパンして視界に収める。
- **ツールバーのショートカットヒント**: 各ボタンの `title` ツールチップへ `[Tab]` / `[Enter]` / `[F2]` / `[F]` / `[/]` / `[⌘0]` 等を併記し、学習コストを下げる（動画 #1）。
- **日本語 IME 最優先原則の維持**: `imeGuardWindowMs` による変換中 `Enter`・直後 `Tab` 抑止と、外部変更時の入力テキスト通知保護をすべての編集導線（タイトル・ノート双方）へ一貫適用する。

---

## 6. 推奨実装ロードマップ（PR #2・PR #3 マージ後）

1. **M2-b（構造編集・削除 & Undo/Redo）**: `Shift+Tab`（新親） / `Delete`（枝削除） / `Cmd+Backspace`（子昇格削除） / `Cmd+Arrow`（並替・階層昇降） / `Cmd+Enter`（分割） / `Cmd+Z`・`Cmd+Shift+Z`（Undo/Redo） / タスク `[ ]`↔`[x]` クリックトグルを実装し、M2-a の編集操作と削除を安全に取り消せる一区切りを完成させる。
2. **M2-ui（Visual Design & UI/UX Polish スライス）**: 既存 Markdown 同期に手を入れず表現層・ビュー層を刷新（テーパード曲線・下線接続・カラーモード 3 種・レイアウト 3 種・背景グリッド・Quick Style Popover・ノートホバープレビュー・構造化フィルタ・SVG バッジ・ステータスバー拡充・`⌘⇧0` 選択フィット・カメラ自動追従・非破壊トピック番号付け。設定はまず Vault 共通で `data.json` の `settings` へ保存）。
3. **M2-c / M3（下書き保護＋本文直接編集・D&D・枝コピペ）**: `DraftStore`（`field: 'title' | 'note'` 下書き退避・復元 UI）と同時公開するポップオーバー内ノート直接編集（`updateNote` / `Cmd+Shift+T`）、D&D 再配置・並替、枝コピペ、実機受入完了。
4. **M4 / M5（Obsidian 強化＆拡張）**: 画像 `![[ ]]` サムネイル、地図間リンク移動＆Backlinks、`NodeMetadataProvider` による非破壊サイドカー視覚拡張（Boundary / Relationship / 個別色検討）、枝順簡易プレゼンテーションモード、エクスポート・`.itmz` インポート。
