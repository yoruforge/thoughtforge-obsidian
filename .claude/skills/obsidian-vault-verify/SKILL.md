---
name: obsidian-vault-verify
description: >-
  Run isolated Obsidian desktop smoke and acceptance checks for thoughtforge-obsidian
  using a dedicated test vault and profile without touching the user's main vault.
  Use when verifying UI changes, hotkeys, IME behavior, plugin manifest/ID changes,
  or Markdown sync before opening or merging a milestone PR.
---

# obsidian-vault-verify（Claude Code 入口）

このファイルは Claude Code から `/obsidian-vault-verify` として検出・起動するための薄い入口です。手順の正本は単一ファイルで管理しています。

## 実行手順

1. 正本 Skill [`.agents/skills/obsidian-vault-verify/SKILL.md`](../../../.agents/skills/obsidian-vault-verify/SKILL.md) を読み込む。
2. 正本に記載された隔離テスト Vault の準備、標準確認項目、終了処理・報告の手順に従って実行する。
