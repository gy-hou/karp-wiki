# 首次搭建流程

只按以下顺序执行：`read_state` → `interview` → `privacy_tools` → `scaffold` → `first_ingest` → `finalize`。开始前读取 `references/security.md`；执行 privacy_tools 前读取 `references/tool-selection.md`；写目录或页面前读取 `references/schema.md`；first ingest 前读取 `references/workflows.md`。

## Resume 与 checkpoint 契约

配置更新必须在同目录写 `.karp-wiki/config.json.tmp`，完整落盘后以 rename 原子覆盖 `.karp-wiki/config.json`。不得直接分段修改正式文件。

1. 找到 `_step_order` 中首个未完成 ID；执行前先把 `setup.current_step` 原子写成该 ID。
2. 步骤全部成功后，把 ID **恰好一次**追加到 `setup.completed_steps`，把 `current_step` 设为下一个未完成 ID（finalize 后为 `null`），再原子写入。
3. `completed_steps` 必须是 `_step_order` 的有序、无重复前缀/子序列。已完成的 ID 直接跳过，绝不重复副作用。
4. 中途失败时不得标记该步完成；下次从同一 pending step 恢复。每步的文件写入与日志追加也必须先检查目标状态，保持幂等。

## 1. `read_state`

- **做什么：** 若 `.karp-wiki/config.json` 不存在，先从 `.karp-wiki/config.example.json` 复制；保留 `_step_order` 原值。读取配置：`state: complete` 时不写文件并退出；否则将 `state` 置为 `in_progress`。新复制配置后立即按 checkpoint 契约把 `current_step` 设为 `read_state`。
- **怎么问：** 无需提问；仅在配置损坏、state/步骤 ID 非法或无法原子写入时停止并说明。
- **产出：** 一份有效的 `config.json`，其 state 为 `in_progress`，随后完成 `read_state` checkpoint。
- **幂等与 checkpoint：** 不覆盖已有配置，不改名或重排 `_step_order`；已完成则跳过。若正式文件与 `.tmp` 同时存在，以可解析的正式文件为准并安全清理陈旧 `.tmp`，不得猜测未落盘状态。

## 2. `interview`

- **做什么：** 收集主题/领域、用途、主要输入模态；仅写入 `config.domain.topic`、`purpose` 与必要的 `extra_subtypes`。
- **怎么问：** 一次用简短问题确认“知识库主题是什么、希望用它做什么、首批资料是文本/图片/音频转写中的哪些”。
- **产出：** 完整的 `config.domain`；领域细分沿用 `subtype`/`tags`，不创造新顶层 `type`。
- **幂等与 checkpoint：** 已有非空回答先复述确认，不擅自覆盖；成功原子写入配置后完成 `interview` checkpoint。

## 3. `privacy_tools`

- **做什么：** 逐字告知：**“文件默认存放在本地;被 Agent 读取的内容会发送给所配置的模型提供商。”** 让用户选择 `config.storage.mode`：默认 `local-only`，或 `private-git`、`public-git`。存储 mode 与页面 `content_visibility` 是两个独立轴。
- **怎么问：** 展示三种行为后请用户明确选择；不得根据 `git remote` 推断 remote 是否私有。`private-git` 必须先警告“raw + wiki 摘要会推送到 remote”，并取得明确确认后写 `remote_is_private_ack: true`。
- **产出：**
  - `local-only`：忽略 `raw/**`、`wiki/**`；设置 `privacy.default_content_visibility: private`。Git 可选，无 Git 仓库也能继续。
  - `private-git`：跟踪 `raw/**`、`wiki/**`；要求 `remote_is_private_ack: true`；设置 `privacy.default_content_visibility: private`。
  - `public-git`：忽略 `raw/**`、跟踪 `wiki/**`；设置 `privacy.default_content_visibility: shareable`，并保证每个创建页面均为 `shareable`。公开库的确定性隐私门不接受任何 private 页面。
  - 三种 mode 均在任意 KB 根忽略 `**/data/generated/**` 与本机界面状态 `**/.obsidian/**`，并跟踪 `.karp-wiki/config.json`、templates、skill、docs、README。
  - 按 [tool-selection.md](tool-selection.md) 盘点 Agent 当前会话公开的能力、本机平台/架构/CPU/内存与已安装候选程序，写入 `config.tooling.inventory`；再按 kernel、search、versioning、image_ingest、audio_ingest、graph_view 六个角色形成 `config.tooling.selected`。向用户展示“角色 → 选择 → 理由 → 回退”摘要。
- **幂等与 checkpoint：** 根据 `schema.md` tracking 矩阵重写 `.gitignore` 的受管规则，同时保留无关用户规则。若处于 Git worktree，对变为禁止跟踪且已经 tracked 的路径执行安全的 `git rm --cached` 操作，具体使用 `git rm -r --cached --ignore-unmatch -- <paths>`；只移出 index，绝不删除本地文件。`local-only` 且不在 Git 仓库时说明 Git-only untracking 不适用并跳过。`private-git`/`public-git` 没有 Git 时本步不能完成。隐私设置、tracking 规则、必要 untracking、`config.tooling.inventory` 与 `config.tooling.selected` 必须全部成功，并在同一次原子写入中保存配置后才 checkpoint。已有完整的带时间戳 tooling 快照先验证所选工具仍可用；环境未变则复用，换机或失效才重新盘点，不重复其他副作用。

Node.js ≥20 是硬依赖；Git 在 Git mode 下是硬依赖。其余工具按 inventory 选择真实可用的回退。缺失时按当前 OS 给建议，但未经用户明确许可不安装、升级、启用工具或联网服务。

## 4. `scaffold`

- **做什么：** 按 `schema.md` 确认或创建 `wiki/{concepts,entities,sources,outputs}` 与 `raw/{text,images,audio}`，不删改已有内容。领域扩展只用页面 `subtype`/`tags`。
- **怎么问：** 展示从 `config.domain` 推导的少量 subtype/tag 建议，请用户确认；不要求用户设计新目录或顶层 type。
- **产出：** 通用目录骨架；领域说明仅存在 `config.domain`，**不**修改 `AGENTS.md` 或 `CLAUDE.md`。
- **幂等与 checkpoint：** 目录存在即复用；确认所需目录齐全且配置原子写入后完成 `scaffold` checkpoint。

## 5. `first_ingest`

- **做什么：** 引导用户把第一份资料新增到合适的 `raw/` 子目录；严格执行 `workflows.md` 的 Ingest：先 hash raw bytes、按 SHA-256 去重、创建或更新一个 source 页和相关派生页，然后依次运行 `reindex` → `check` → `build-graph`。
- **怎么问：** 请用户指定首份本地资料；按 `config.tooling.selected` 使用已经确认的组合。图片/音频仍须按 `multimodal.md` 确认能力和转写条件；已选工具不可用时按 `tool-selection.md` 重新盘点，不得静默换成外部服务。不得修改或删除已落盘 raw bytes。
- **产出：** 至少一个有效 source 页面、必要的 concept/entity 页面、当前 index 和 graph，以及成功后的单条 ingest log。
- **幂等与 checkpoint：** 相同 `raw_sha256` 更新既有 source，不新建第二个 source；日志先查同一 ingest 事件，避免重复。三个确定性命令全部成功且 `check` 通过后才 checkpoint；此前不得进入 finalize。

## 6. `finalize`

- **做什么：** 再确认 `first_ingest` 已完成且最近一次 `check` 成功。向 `wiki/log.md` 追加恰好一条符合 schema 的 setup-complete 事件：`## [YYYY-MM-DD] ingest | setup-complete`。随后一次原子配置写入同时完成三项：把 `finalize` 恰好一次加入 `completed_steps`、设置 `current_step: null`、设置 `state: complete`。
- **怎么问：** 无新增选择；总结已完成内容，并告知日常三动作 ingest/query/lint 与 `examples/` 入口。
- **产出：** `state: complete`、无 pending step、恰好一条 setup-complete log event。
- **幂等与 checkpoint：** 若从 partial finalize 恢复，先检测既有 setup-complete 事件并复用，不重复追加；只有日志存在且门槛仍满足时才执行最终原子 checkpoint。完成后再次调用 setup 必须立即退出。
