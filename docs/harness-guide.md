# 自己改善ハーネス運用案内（Phase 1）

このリポジトリ（`thoughtforge-obsidian`）で、同じ説明・訂正・手戻りを減らすための最小構成（Phase 1）の運用ガイドです。

## 1. 構成と保存先

| 種別 | パス | Git 管理 | 役割 |
|---|---|---|---|
| Skill 正本（Codex 探索先） | `.agents/skills/session-retro/SKILL.md` | 共有（追跡対象） | 振り返り・選別・提案/記録/反映の手順正本 |
| 受入ケース・ログ規約 | `.agents/skills/session-retro/references/acceptance-cases.md` | 共有（追跡対象） | 9 件の受入確認ケースと摩擦ログ規約 |
| Claude Code 入口 | `.claude/skills/session-retro/SKILL.md` | 共有（追跡対象） | 正本 Skill への薄い委譲入口（手順の二重管理を回避） |
| 共通ルール正本 / 入口 | `CLAUDE.md` / `AGENTS.md` | 共有（追跡対象） | 既存開発規約の正本（`CLAUDE.md`）と Codex 用薄い入口（`AGENTS.md`） |
| 個人用観測ログ | `.local/friction-log.md` | **個人用・除外** | 採用前の摩擦観測メモ（`.git/info/exclude` で除外） |

- **個人除外の使い分け**: `.local/friction-log.md` は個人用ログのため、共有の `.gitignore` ではなくローカル専用の `.git/info/exclude` に登録しています（`.agents/` や `.claude/` など共有 Skill を隠す広い除外は使いません）。別マシンへクローンして使う場合は、`.git/info/exclude` に `.local/friction-log.md` を 1 行追加してください。
- **Phase 1 で導入しない部品**: `audit-harness` Skill・観測用 Hooks（Phase 2 対象）、独立セッション自動評価基盤（Phase 3 対象）は、実運用で不足が確認されるまで作成しません。

## 2. 呼び出し方（既定は提案モード・無書込み）

明示的に振り返りや知見整理を依頼するときだけ使用します（通常の開発・バグ修正依頼では恒久設定を変更しません）。

- **Claude Code**: `/session-retro`（例: `/session-retro 提案モードでこのセッションを振り返って`）
- **Codex**: `$session-retro` または「`session-retro` を使ってこのセッションを提案モードで振り返って」
- **モード指定**:
  - `提案`（既定）: ログも設定も書き換えず、候補と差分案のみ提示
  - `記録`: `.local/friction-log.md` だけ更新（恒久設定は変更しない）
  - `反映`: 指定・許可した候補と範囲だけを反映し検証

## 3. 新セッションでの実環境確認手順

リポジトリを開き直した新しいセッションで、以下を確認します（同セッション内の試運転だけでは実環境確認になりません）。

1. **Git 除外確認**: `git check-ignore -v .local/friction-log.md` が `.git/info/exclude` で一致し、`git status --short` に `.local/friction-log.md` が出ないこと。
2. **ツール検出・明示呼出し**: Claude Code（`/session-retro`）と Codex（`$session-retro`）それぞれで Skill が検出され、既定（提案モード）で無書込み動作すること。
3. **非対象時の抑止**: 通常のバグ修正や質問で恒久設定の変更が勝手に始まらないこと。
4. **任意（自然依頼）**: Skill 名を書かずに「このセッションの振り返りと再発防止案を整理して」と依頼したときの自動選択挙動。

## 4. 取り消し方（安全な個別切り戻し）

既存の作業差分を消す `git reset --hard` や `git clean` は使わず、今回追加したファイルだけを対象に戻します。

- **新規作成ファイルの削除**:
  - `.agents/skills/session-retro/`（`SKILL.md`, `references/acceptance-cases.md`）
  - `.claude/skills/session-retro/`（`SKILL.md`）
  - `docs/harness-guide.md`
  - `AGENTS.md`
  - `.local/friction-log.md`
- **既存ファイルの部分戻し**:
  - `CLAUDE.md` 末尾の「自己改善ハーネス（Phase 1）」2 行を削除
  - `.git/info/exclude` 末尾の `.local/friction-log.md` 行を削除
