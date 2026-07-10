# karp-wiki 设计文档

> 通用型本地知识库一键搭建模板仓库 · v1 设计
> 日期:2026-07-10 · 状态:设计已确认,待出实施计划

## 1. 背景与目标

### 起源
灵感来自 Andrej Karpathy 2026 年 4 月关于"如何构建个人知识库"的思路。用户将其抽象成"一段 prompt + 一份工具清单"(见 `Karp-wiki-prompt.txt`),并已跑通一个**雅思专用**的可视化变种 `english-learn-database`(含 AGENTS.md 契约、确定性脚本、静态网页图谱)。

本项目要做的是:把这条已验证的链路(**prompt → 契约 → 脚本 → 可视化**)从"雅思专用"**抽象成通用型**,并包装成任何新手都能一键跑通的 Claude Code skill。

### 一句话目标
新手 clone 本仓库,在目录里对 Claude Code 说"帮我搭知识库",内置 `kb-setup` skill 完成从**领域定制 → 目录骨架 → 工具自检 → 首次录入**的全过程,产出一个纯 Markdown、数据留本地、换 AI 不丢数据的个人知识库。

### 已确认的核心决策
| 决策 | 结论 |
|------|------|
| 仓库策略 | 就地改造现有 starred 仓库;旧提示词内容备份到本地;GitHub 重命名保 star |
| 新名字 | **karp-wiki**(repo slug + 产品名) |
| v1 范围 | 核心 `kb-setup` skill + CLAUDE.md/AGENTS.md 契约;可视化只留数据契约接口,不写可跑代码 |
| 通用程度 | 领域无关空骨架 + 1 个填好的领域示例 |
| 交付形式 | 可 clone 的模板仓库,内置 `.claude/skills/kb-setup` |
| 目标 Agent | Claude Code 为主(SKILL.md)+ AGENTS.md 兼容其他 agent |
| 语言 | 中文为主 + 英文兼容 |

## 2. 架构:三层模型

沿用 Karpathy 三层,职责严格隔离:

1. **原始资料层 `raw/`** —— 只读。用户的论文、文章、笔记、截图、导出。LLM 永不改写。
2. **知识库层 `wiki/`** —— LLM 写和维护的结构化 Markdown(索引、摘要、卡片、概念页、综述)。
3. **规范层 `CLAUDE.md` / `AGENTS.md`** —— 告诉 LLM 怎么干活:目录契约、frontmatter 契约、ingest/query/lint 工作流、隐私与只读约束。

### 职责划分(关键设计)
- **`kb-setup` skill** = 只负责"一键搭建"这件**一次性**的事(问答定制、建骨架、工具自检、写首批页面)。这是 v1 核心交付物。
- **`CLAUDE.md`** = 负责**日常** ingest/query/lint。Agent 读宪法即会执行,不需要额外 skill。职责单一、边界清晰。
- **可视化** = v1 只在 `scripts/` + `web/` 留**数据契约文档**(frontmatter → JSON 映射),把 english-learn 的 build-kb 通用化留到 v2。

## 3. 交付物结构

clone 下来的仓库长这样:

```
karp-wiki/                        # slug 由 chatgpt-advanced-prompts 重命名而来(保 star)
├── README.md                     # 中文为主:这是什么 + 60 秒上手三步
├── readme-en.md                  # 英文兼容
├── CLAUDE.md                     # 本库"宪法":三层架构 + ingest/query/lint + 隐私/只读约束
├── AGENTS.md                     # 指向同一套规范的 agent 无关版(Codex 等可读)
├── .claude/
│   └── skills/
│       └── kb-setup/             # ★ 核心交付物:一键搭建 skill
│           ├── SKILL.md          #   onboarding 向导
│           └── references/
│               ├── directory-contract.md    # 目录契约
│               ├── frontmatter-contract.md  # YAML frontmatter 契约
│               └── workflows.md             # ingest/query/lint 详细步骤
├── wiki/                         # 通用空骨架
│   ├── index.md                  #   全局索引(每页一行:链接 + 一句话摘要)
│   ├── log.md                    #   操作日志
│   ├── concepts/                 #   概念页(.gitkeep)
│   ├── entities/                 #   实体页:人物/项目/公司/工具(.gitkeep)
│   ├── sources/                  #   资料摘要(.gitkeep)
│   └── outputs/                  #   查询产出:综述/对比表/分析(.gitkeep)
├── raw/                          # 原始资料区(只读),.gitkeep
├── templates/                    # frontmatter 模板:concept/entity/source/output
├── examples/                     # 1 个填好的领域示例(读书笔记),新手照抄
├── scripts/                      # 可视化接口(v1 占位):README + 数据契约,不含可跑代码
├── web/                          # 可视化接口(v1 占位):说明将来如何接 build-kb
├── .gitignore                    # 排除 raw 私密内容、生成物
└── LICENSE
```

## 4. 核心组件规格

### 4.1 `kb-setup` skill(SKILL.md)
一次性 onboarding 向导。触发:用户在 clone 好的目录里说"帮我搭知识库"/"初始化知识库"。

工作流:
1. **问答定制** —— 问知识库主题/领域、用途、是否含私密内容。
2. **工具自检** —— 检测 `git`、`rg`(ripgrep)、可选 Obsidian;缺失的给出安装命令(不自动装,只提示)。
3. **建骨架** —— 确认 `wiki/` 四大类目已就位;据领域可增设类目(如学习类加 `vocabulary/`)。
4. **定制宪法** —— 在 CLAUDE.md 补一段领域说明(该领域关注什么、类目怎么用)。
5. **首次录入** —— 引导用户放第一份资料到 `raw/`,走一遍 ingest,产出首个 source 页 + 更新 index/log,让用户立刻看到成品。
6. **收尾** —— 告诉用户日常怎么用(ingest/query/lint 三个动作),指向 examples/。

设计约束:skill 只做搭建,不承接日常操作;日常操作由 CLAUDE.md 承接。

### 4.2 `CLAUDE.md`(宪法)
包含:
- **三层架构说明** + `raw/` 只读铁律。
- **目录契约** —— 每个目录放什么、命名规范。
- **frontmatter 契约** —— 每页 YAML 头(见 4.4)。
- **三大工作流**:
  - **Ingest(摄入)**:读 `raw/` 新资料 → 与用户讨论要点 → 写 `sources/` 摘要 → 更新 `index.md` → 更新相关 `concepts/`+`entities/` → 追加 `log.md`。
  - **Query(查询)**:先读 `index.md` 定位 → 深读相关页 → 综合回答并引用具体页 → 有价值的答案存 `outputs/` 并更新 index。
  - **Lint(健康检查)**:查页面矛盾、孤立页(无入链)、提到但未建页的概念、可更新的过时信息。
- **约束**:隐私边界(私密内容仅明确查询时提及)、raw 只读、过期归档不删、统一 `[[wiki-links]]` 内链、每次操作同步更新 index + log(双维护)。

### 4.3 `AGENTS.md`
精简版,重申三层架构 + 目录/frontmatter 契约 + 工作流要点,并注明"详见 CLAUDE.md",让 Codex 等非 Claude agent 也能读懂规则。

### 4.4 frontmatter 契约(templates/)
每页 YAML 头最小通用集:
```yaml
---
id: <kebab-case-唯一标识>
type: concept | entity | source | output
title: <标题>
tags: [<标签>]
sources: [<关联 source id>]
created_at: 2026-07-10
updated_at: 2026-07-10
---
```
`templates/` 提供 4 个对应模板文件供 skill 和用户取用。

### 4.5 通用类目(wiki/)
Karpathy 原型最小通用集,任何领域适用:
- `concepts/` —— 概念页
- `entities/` —— 人物、项目、公司、工具
- `sources/` —— 每份原始资料一页摘要
- `outputs/` —— 查询产出(综述、对比表、分析)

### 4.6 领域示例(examples/)
放 1 个填好的完整示例领域:**读书笔记**(受众最广、最直观)。含 1 份 source、若干 concept/entity、1 个 output,以及一份精简 index —— 让新手打开即见成品。

### 4.7 可视化接口(scripts/ + web/,v1 占位)
只放文档:
- `scripts/README.md` —— 说明 v2 将把 english-learn 的 `build-kb.mjs` 通用化(读 wiki frontmatter → 生成 JSON)。
- **数据契约** —— 明确 frontmatter → JSON 节点/边的映射,保证 v1 写的页面将来能直接被可视化脚本消费。
- `web/README.md` —— 说明将来静态网页如何注入 `kb-data.js`、本地打开、不需云端。

## 5. Phase 0:仓库迁移(执行时的前置步骤)

> 本步骤有不可逆风险,执行时严格按序,备份确认后才清理。

1. 将当前 `chatgpt-advanced-prompts` 全部内容**复制**(非移动)到本地 `~/Documents/GitHub/chatgpt-prompts-archive/`,作为提示词数据库存档。
2. 用户确认备份完整后,在原仓库工作树内清理旧内容(command/、template/、dist/、node_modules/、vercel 相关等),保留 `.git`、`LICENSE`。
3. 铺入新的 karp-wiki 模板结构与内容。
4. 更新 README/readme-en 为 karp-wiki 介绍。
5. GitHub 端重命名仓库 `chatgpt-advanced-prompts` → `karp-wiki`(自动重定向,保 star)。此步可最后做,由用户在网页端操作或用 `gh` CLI。

## 6. 非目标(v1 明确不做)

- 不写可跑的可视化脚本 / 网页(只留契约,v2 做)。
- 不做云同步、登录、部署。
- 不自动安装工具(只检测 + 提示命令)。
- 不做多领域预设菜单(只 1 个示例领域 + 领域无关骨架)。
- 不从网页写回 Markdown。

## 7. 成功标准

- 新手 clone 仓库 → 启动 Claude Code → 说一句话 → 在 10 分钟内拥有一个含首个真实录入页面的可用知识库。
- 产出的每一页都符合 frontmatter 契约,且 `index.md`/`log.md` 同步更新。
- 所有文档中文为主、英文兼容;`AGENTS.md` 使非 Claude agent 也能遵守规则。
- 目录与 frontmatter 契约足够稳定,v2 的可视化脚本无需改动 v1 页面即可消费。
