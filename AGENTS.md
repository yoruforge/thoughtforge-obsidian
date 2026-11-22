# AGENTS.md — thoughtforge-obsidian

本リポジトリ（独立 Git root: `thoughtforge-obsidian`）で Codex / Antigravity 等の AI エージェントが作業する際の共通入口です。

- **共通ルール正本**: 作業前に [CLAUDE.md](./CLAUDE.md) を確認し、同ファイルの必須ルール（Markdown 正本・非破壊原則、Obsidian Community Plugin 審査基準・商標配慮、`pnpm verify` 検証ゲート等）に従ってください。
- **要件・設計正本**: [docs/prd.md](./docs/prd.md) / [docs/design.md](./docs/design.md)（M2 以降の編集・同期・View スコープ不変条件を含む）
- **コミット・作業ツリー境界**: 作業ツリーに別件の未コミット差分が混在している場合は `git add -A` を使わず、対象タスクのファイルのみを選択的にステージしてください。
- **未実行検証の明記**: 環境制約等で `pnpm verify` や Obsidian 実機確認を実行できなかった場合は、未実行として明記し完了扱いしません。
- **セッション振り返り・知見整理**: 明示的に振り返りや再発防止を依頼されたときのみ、`.agents/skills/session-retro/SKILL.md`（既定: 提案モード・無書込み）を使用してください。運用と取り消し方法は [docs/harness-guide.md](./docs/harness-guide.md) にあります。
