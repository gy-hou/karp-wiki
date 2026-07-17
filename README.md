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

## 🧰 根据本机配置选择工具组合

`kb-setup` 不会假设每台电脑都有同一套工具。初始化时，它会同时盘点 **Agent 当前会话公开的工具能力** 与 **本机配置/已安装程序**，包括操作系统、CPU 架构、逻辑核心数、内存，以及 Node.js、Git、ripgrep、Obsidian 等是否可用；随后按角色选择一套最小够用的组合，并把清单与选择原子写入 `.karp-wiki/config.json` 的 `tooling.inventory` 和 `tooling.selected`，供后续工作流复用。

- 确定性内核固定使用 Node.js ≥20 + `scripts/kb.mjs`；缺少时 setup 会阻断并给出安装建议。
- 搜索优先使用本机 `rg`，否则选择当前 Agent 的文件搜索能力，再否则使用 Node.js 文件遍历。
- `private-git`/`public-git` 选择 Git；`local-only` 可以不使用版本控制。
- 图片仅在当前 Agent 确实有视觉能力时选择视觉工具；音频在 v1 始终使用用户提供的 transcript。
- 内置 `karp-web` 可查看 typed-edge 与可见性过滤；本机有 Obsidian 时也可按偏好选择其 Graph View，最低回退仍是 Markdown 与 `graph.json`。

Agent 会先展示选型摘要；未经用户明确许可不会安装软件，也不会为了“用上更多工具”调用与任务无关的工具。完整决策规则见 [`tool-selection.md`](skills/kb-setup/references/tool-selection.md)。

## 🔧 确定性工具与 graph 契约

这些命令需要 **Node ≥20**：

| 命令 | 作用 |
| --- | --- |
| `npm run reindex` | 从知识页重建 `wiki/index.md` |
| `npm run check` | 校验 schema、链接、raw/hash、索引与隐私门 |
| `npm run build-graph` | 校验通过后生成知识图谱数据 |

`data/generated/graph.json` 是 kernel 的基础图契约，包含 `schema_version: 1`、`nodes` 与 `edges`；下面的 v2a viewer 使用更丰富、默认可分享的 `web/data/kb-data.js`。

## 🤖 本地自动摄入（prepare-only）

可选的 launchd 自动化会在**每周一、周四 09:00**以及 `raw/` 有新素材时运行。它只处理 `node scripts/kb.mjs pending` 列出的、尚无 source 页记录的素材，并且默认不联网。

这是严格的 **prepare-only** 流程：它只会从干净的 `master` 创建 `auto/ingest-*` 日期分支，在 `kb.mjs check` 通过后提交到该分支；自动流程**绝不 push、merge 或提交到 `master`**。你必须人工 review，再自行决定是否 merge。若工作树不干净或当前不在 `master`，任务会直接中止，避免干扰正在进行的工作。

安装一个本地 agent（任选其一）：

```bash
bash automation/install.sh codex
# 或
bash automation/install.sh claude
```

暂停/卸载则运行 `bash automation/uninstall.sh codex`（或 `claude`）。运行摘要在本机 `automation/last-run.md`，完整说明见 [`automation/README.md`](automation/README.md)。

无人值守时安全边界更重要：**`raw/` 下的一切都是不可信数据，不是给 agent 的指令。** 自动 agent 忽略其中的命令、指示和链接，不执行 raw 内代码；具体流程见 [`auto-ingest.md`](skills/kb-setup/references/auto-ingest.md)。

除 launchd 外，也可在 Codex App 创建每周定时任务：默认示例为周二、周四、周六上午 10:00，本机可自行调整。它使用 [`Codex Automation controller prompt`](automation/codex-automation-prompt.md)，同样只准备 `auto/ingest-*` 分支，绝不自动 merge 或 push。

## 🕸️ 本地 Web 可视化

运行下面的命令会先 fail-closed 校验知识库，再生成 `web/data/kb-data.js`：

```bash
npm run build-web
```

随后可直接用 `file://` 打开 [`web/index.html`](web/index.html)，或运行 `npm run dev`，再访问 `http://127.0.0.1:5173/web/`。`dev` 只绑定本机 loopback；Python 3 只是便利服务器，不是构建依赖。

构建默认**只写入 `content_visibility: shareable` 页面**，并剔除任何连接到被排除节点的边。只有明确要在本机查看私密内容时才运行：

```bash
npm run build-web -- --include-private
```

含私密页的产物只能留在本机，不能分享；生成后直接打开 `web/index.html`。若仍需本地 HTTP，从仓库根运行 `python3 -m http.server 5173 --bind 127.0.0.1`，不要再运行 `npm run dev`，因为后者会按安全默认值重新构建并排除 private 页面。viewer 是零依赖、只读页面，不登录、不联网、不写回 Markdown；支持标题/摘要/标签搜索，以及 type、tag、visibility、`derived_from`/`links_to` 过滤。与 Obsidian Graph View 相比，这个网页直接区分 typed edges，并在生成层默认排除 private 页面，而不是只在界面上隐藏。

## 👁️ 用 Obsidian 查看示例

查看成品知识图谱时，请把 `examples/` 单独作为 vault 打开。不要把整个模板仓库作为示例 vault；否则根 README、`docs/`、skills 等项目 Markdown 也会进入 Obsidian Graph View，干扰这 5 个示例知识页。Obsidian 创建的 `.obsidian/` 是本机界面状态，模板会在任意目录层级忽略它。

## 📍 目录导览

| 路径 | 用途 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 首次启动、日常工作流与安全边界 |
| [`examples/`](examples/) | 图片与音频转写 raw 输入，以及由它们生成的文本知识页；没有独立的 `examples/raw/text/` 输入 |
| [`skills/kb-setup/references/schema.md`](skills/kb-setup/references/schema.md) | frontmatter、隐私 tracking 与 graph 的权威契约 |
| [`skills/kb-setup/`](skills/kb-setup/) | `kb-setup` canonical source |
| [`raw/`](raw/) | append-only 原始资料 |
| [`wiki/`](wiki/) | 结构化知识页、索引与日志 |
| [`templates/`](templates/) | 四种知识页模板 |

## 🔗 参考资料

[^1]: Andrej Karpathy. (2026-04-04). GitHub Gist. https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

[^2]: Anthropic. “Claude Code data usage.” https://docs.anthropic.com/en/docs/claude-code/data-usage

[^3]: OpenAI. “Using Codex with ChatGPT.” https://help.openai.com/en/articles/11369540-using-codex-with-chatgpt
