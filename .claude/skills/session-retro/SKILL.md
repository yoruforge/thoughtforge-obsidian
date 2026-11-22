---
name: session-retro
description: 明示的にセッションの振り返り、再発防止、知見の整理、摩擦ログ（friction-log）の記録・棚卸しを求められたときに使う。通常の開発・実装・バグ修正依頼だけで恒久設定の変更を開始しない。既定は提案モード（無書込み）。
---

# session-retro（Claude Code 入口）

このファイルは Claude Code から `/session-retro` として検出・起動するための薄い入口です。手順の正本は単一ファイルで管理しています。

## 実行手順

1. 正本 Skill [`.agents/skills/session-retro/SKILL.md`](../../../.agents/skills/session-retro/SKILL.md) を読み込む。
2. 正本に記載されたモード制約（既定: `提案`・無書込み）、根拠の 3 区分、重複判定、採用条件、3 区分検証、結果報告の手順に厳密に従って実行する。
3. 必要な場合のみ補助資料 [`.agents/skills/session-retro/references/acceptance-cases.md`](../../../.agents/skills/session-retro/references/acceptance-cases.md) を参照する。
