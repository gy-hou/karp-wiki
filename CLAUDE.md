# karp-wiki — Claude Code 入口

@AGENTS.md

上面的独立 import 是本仓库通用规则的唯一正文。以下仅为 Claude Code 专属补充。

## Claude 专属
- 初始化技能通过 `.claude/skills/kb-setup` 自动发现,或显式 `/kb-setup`。
- `.claude/skills/kb-setup/` 与 `.agents/skills/kb-setup/` 均由 `skills/kb-setup/`(canonical)经 `npm run sync-skills` 生成,**请勿手工编辑镜像**;改规则改 canonical 后重跑同步(CI 会用 `npm run sync-skills:check` 校验)。
