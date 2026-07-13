# karp-wiki

_一个内含 project-scoped skill 的 GitHub Template，用 Claude Code 或 Codex 把原始资料整理成可校验、可查询的本地知识库。_

[English](readme-en.md)

---

## 📋 定位与归属

这是一个供你从 **Use this template** 开始创建新知识库项目的 GitHub Template；它不声称是可以安装进任意已有仓库的通用 skill。

本项目受 Andrej Karpathy 于 2026-04-04 发布的 Gist[^1] 启发。inspired by, not affiliated with or endorsed by Andrej Karpathy。基于其抽象模式的独立实现。

## 🚀 快速上手

1. 在 GitHub 点击 **Use this template**，创建你自己的私有仓库。相比直接 clone 并把模板仓库保留为 `origin`，这样更安全。
2. 安装并登录 Claude Code 或 Codex；这一步不计入下面的时间。
3. 在新仓库目录启动 Agent，然后说“帮我搭知识库”；也可以显式调用 `/kb-setup`（Claude Code）或 `$kb-setup`（Codex）。

> 📌 **计时口径：** 已安装并登录 Agent 后,约 10 分钟完成首次录入。

自然语言请求是否自动触发 skill 取决于 Agent 的发现与调用行为；若未触发，请使用上面的显式命令。本项目不承诺 60 秒完成，也不承诺自动触发必然发生。

## 🔗 Claude Code 与 Codex 双端发现

| Agent | 发现入口 | 显式调用 |
| --- | --- | --- |
| Claude Code | [`.claude/skills/kb-setup/`](.claude/skills/kb-setup/) | `/kb-setup` |
| Codex | [`.agents/skills/kb-setup/`](.agents/skills/kb-setup/) | `$kb-setup` |

两端入口都由 [`skills/kb-setup/`](skills/kb-setup/) 这一 canonical source 经 `npm run sync-skills` 生成。CI 用 `npm run sync-skills:check` 校验三个副本一致；不要直接编辑两个发现镜像。

## 🏗️ 三层架构与核心原则

```mermaid
flowchart LR
    accTitle: karp-wiki 三层架构
    accDescr: 原始资料由 Agent 整理为结构化知识页，AGENTS.md 与项目内 skill 同时约束原始资料和知识页的处理边界。

    raw[(📥 raw/ 原始资料)] -->|Agent 摄入| wiki[📚 wiki/ 结构化知识]
    rules[🛡️ AGENTS.md 规范层] -.->|约束| raw
    rules -.->|约束| wiki

    classDef source fill:#fef9c3,stroke:#ca8a04,stroke-width:2px,color:#713f12
    classDef knowledge fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef policy fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a5f

    class raw source
    class wiki knowledge
    class rules policy
```

1. `raw/` 是 append-only 的不可信原始资料层；Agent 不改写或删除已有 bytes。
2. `wiki/` 是 Agent 维护的结构化知识层，使用 Markdown、YAML frontmatter 与 `[[wiki-links]]`。
3. [`AGENTS.md`](AGENTS.md) 与 project-scoped skill 构成规范层，定义 setup、ingest、query、lint、隐私和校验边界。

核心原则：

- **纯 Markdown：** 知识页是普通文件，不依赖专有数据库。
- **换 AI 不丢：** 数据保留在项目文件中，更换兼容的 Agent 或模型时无需迁移专有数据格式。
- **多模态：** 文本可直接摄入；图片需要当前 Agent 确实具备视觉能力；v1 的音频仅摄入用户提供的音频转写，不内置 ASR。

## 🔐 隐私与存储模式

文件默认存放在本地;被 Agent 读取的内容会发送给所配置的模型提供商。

使用前请阅读 Claude Code 数据使用说明[^2]和 OpenAI Codex 数据控制说明[^3]。`local-only` 表示文件的 Git tracking 策略，不表示内容永远不会离开设备；上面的模型提供商边界始终适用。

仓库级 `.karp-wiki/config.json` 中的 `storage.mode` 有三种取值：

| `storage.mode` | 默认 | Git tracking 行为 |
| --- | --- | --- |
| `local-only` | 是 | `raw/**`、`wiki/**` 与可重建数据不进入 Git |
| `private-git` | 否 | 明确确认远端为私有后，跟踪 `raw/**` 与 `wiki/**`；可重建数据仍忽略 |
| `public-git` | 否 | 永不跟踪 `raw/**`，可跟踪 `wiki/**`；可重建数据仍忽略 |

页面级 frontmatter 的 `content_visibility` 独立取值为 `private` 或 `shareable`，不能从 `storage.mode` 推断。`public-git` 有硬门：只要存在任何 `content_visibility: private` 页面，`npm run check` 就会非零退出，禁止通过。

## 🔧 确定性工具与 graph 契约

这些命令需要 **Node ≥20**：

| 命令 | 作用 |
| --- | --- |
| `npm run reindex` | 从知识页重建 `wiki/index.md` |
| `npm run check` | 校验 schema、链接、raw/hash、索引与隐私门 |
| `npm run build-graph` | 校验通过后生成知识图谱数据 |

`data/generated/graph.json` 是 v2 可视化的可消费契约，包含 `schema_version: 1`、`nodes` 与 `edges`。v1 只产数据，无可视化 UI。

## 📍 目录导览

| 路径 | 用途 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 首次启动、日常工作流与安全边界 |
| [`examples/`](examples/) | 完整的文本、图片与音频转写示例 |
| [`skills/kb-setup/references/schema.md`](skills/kb-setup/references/schema.md) | frontmatter、隐私 tracking 与 graph 的权威契约 |
| [`skills/kb-setup/`](skills/kb-setup/) | `kb-setup` canonical source |
| [`raw/`](raw/) | append-only 原始资料 |
| [`wiki/`](wiki/) | 结构化知识页、索引与日志 |
| [`templates/`](templates/) | 四种知识页模板 |

## 🔗 参考资料

[^1]: Andrej Karpathy. (2026-04-04). GitHub Gist. https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

[^2]: Anthropic. “Claude Code data usage.” https://docs.anthropic.com/en/docs/claude-code/data-usage

[^3]: OpenAI. “Using Codex with ChatGPT.” https://help.openai.com/en/articles/11369540-using-codex-with-chatgpt
