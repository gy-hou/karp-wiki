# Karp Wiki schema v1

本文档是 Karp Wiki v1 页面、索引、日志、隐私 tracking 和知识图谱的规范契约。下列规则由 `kb.mjs`、工作流和文档共同引用。

## 通用 frontmatter

每个页面都必须以 YAML frontmatter 开头，并包含以下最小通用字段：

| 字段 | 类型 | 必填 | 取值 |
|------|------|------|------|
| `schema_version` | integer | 是 | 只能为 `1` |
| `id` | string | 是 | 符合下文 ID 规则 |
| `type` | string | 是 | `concept`、`entity`、`source`、`output` 之一 |
| `subtype` | string | 否 | 领域细分；可为空字符串 |
| `title` | string | 是 | 非空页面标题 |
| `summary` | string | 是 | 非空的一句话摘要 |
| `tags` | string[] | 是 | 字符串数组；可为空数组 |
| `source_ids` | string[] | 是 | source 页面 ID 数组；可为空数组，且每个值只能指向 `type: source` 页面 |
| `status` | string | 是 | `active` 或 `archived` |
| `content_visibility` | string | 是 | `private` 或 `shareable` |
| `created_at` | string | 是 | `YYYY-MM-DD` 日期 |
| `updated_at` | string | 是 | `YYYY-MM-DD` 日期 |

## 枚举与日期

- `type ∈ {concept,entity,source,output}`。
- `status ∈ {active,archived}`。
- `content_visibility ∈ {private,shareable}`。
- `media_type ∈ {text,image,audio}`。
- `created_at` 与 `updated_at` 必须使用 `YYYY-MM-DD` 格式。

## ID 与文件名规则

- `id` 必须使用 kebab-case，并带与 `type` 一致的类型前缀：`concept-`、`entity-`、`source-` 或 `output-`。
- `id` 必须在全库唯一，页面创建后不得改变。
- 页面文件名必须等于 `<id>.md`。
- 内链统一写为 `[[id]]`。
- 领域细分必须使用 `subtype` 或 `tags`，不得新增顶层 `type`。

## source 额外字段

每个 `type: source` 页面还必须包含：

| 字段 | 类型 | 必填 | 取值 |
|------|------|------|------|
| `media_type` | string | 是 | `text`、`image`、`audio` 之一 |
| `raw_path` | string | 是 | 永远相对于 KB 根，写作 `raw/<sub>/<file>` |
| `raw_sha256` | string | 是 | 恰好 64 个十六进制字符，匹配 `[0-9a-fA-F]{64}` |
| `provenance` | string | `media_type: audio` 时是 | 音频来源说明，例如 `transcript-of-audio` |

`raw_path` 的 KB 根就是 `validate(pages, root)` 的 `root`。fixtures、examples 和真实库一律写 `raw/<sub>/<file>`，绝不写含 `tests/fixtures/...` 或 `examples/...` 前缀的路径。通用 raw 子目录为 `raw/text/`、`raw/images/`、`raw/audio/`。

`media_type: audio` 必须带 `provenance`；v1 只使用 transcript，不得把转写伪装成原始音频。

## output 额外字段

每个 `type: output` 页面还必须包含：

| 字段 | 类型 | 必填 | 取值 |
|------|------|------|------|
| `query` | string | 是 | 触发该产出的原始问题 |

## 安全与校验约束

以下约束与 `security.md` 一致，并由 `kb.mjs` 强制执行：

- `raw_path` 解析和规范化后的路径不得越过 KB 根；绝对路径和任何路径穿越均无效。
- `raw_path` 不得通过 symlink 指向 KB 根之外；解析路径上的 symlink 后，最终目标仍必须位于 KB 根内。
- 同一个 `raw_sha256` 不得对应多个 source 页面，以保证去重和幂等。
- `kb.mjs check` 与 `kb.mjs build-graph` 遇到任何校验失败都必须以非零状态退出。
- `kb.mjs build-graph` 必须先完成校验；有任何错误时不得写入 graph。
- `kb.mjs reindex` 可以在库未完全合规时运行，因为它用于修复 index 漂移，不受完整校验阻塞。

## 隐私 tracking 矩阵

隐私机制由两个正交轴组成：

- 仓库级 `config.storage.mode ∈ {local-only, private-git, public-git}`（用户声明，不靠 `git remote` 推断）。
- 页面级 frontmatter `content_visibility ∈ {private, shareable}`。

setup 据 mode 重写 `.gitignore` 并对已跟踪内容执行 `git rm --cached`，确定性 tracking 矩阵如下：

| 路径 | local-only | private-git | public-git |
|------|-----------|-------------|-----------|
| `raw/**` | 忽略 | 跟踪(备份) | 忽略(公开库永不发布 raw) |
| `wiki/**` 页面 + index/log | 忽略 | 跟踪 | 跟踪 |
| `data/generated/**` | 忽略 | 忽略 | 忽略(可重建) |
| `.karp-wiki/config.json`、templates、skill、docs、README | 跟踪 | 跟踪 | 跟踪 |

**public-git 硬门:** `kb.mjs check` 若发现**任何** `content_visibility: private` 页面即非零退出(私密内容请另建 local-only/private-git 库)。

**private-git 前置:** 需 `config.storage.remote_is_private_ack = true`,setup 明确警告"raw + wiki 摘要会推送到 remote"。

## index 与 log 契约

- `wiki/index.md` 是派生视图，由 `kb.mjs reindex` 生成；Agent 不得手工维护。每行格式必须为 `- [[id]] — summary`。
- `wiki/log.md` 是 append-only 事件日志，只能追加，不能修改或删除既有条目。每条格式必须为 `## [YYYY-MM-DD] ingest|query|lint | <标题>`。
- 通用页面目录为 `wiki/concepts/`、`wiki/entities/`、`wiki/sources/`、`wiki/outputs/`。

## graph 边契约（v1 冻结）

`kb.mjs build-graph` 输出 `data/generated/graph.json`。输出对象必须包含 `schema_version: 1`、`nodes` 数组和 `edges` 数组。

### 节点

- 每个页面节点只包含 `{id,type,title}`。
- `index.md`、`log.md` 和 `templates` 中的文件不生成节点。
- `nodes` 按 `id` 升序稳定排序。

### 边

- 页面 frontmatter 的每个 `source_ids` 值生成 `{from,to,relation:"derived_from"}`，其中 `from` 是当前页面 ID，`to` 是 source ID。
- 页面正文中的每个 `[[target]]` 生成 `{from,to,relation:"links_to"}`，其中 `from` 是当前页面 ID，`to` 是 `target`。
- 正文链接提取必须排除 YAML frontmatter 和 fenced code block；两处出现的 `[[target]]` 均不得生成 `links_to` 边。
- 边以 `(from,to,relation)` 为去重键；同一键只输出一次。
- `edges` 按 `from`、`to`、`relation` 依次升序稳定排序。

图输出的结构固定为：

```json
{
  "schema_version": 1,
  "nodes": [
    { "id": "concept-example", "type": "concept", "title": "概念名称" }
  ],
  "edges": [
    { "from": "concept-example", "to": "source-example", "relation": "derived_from" }
  ]
}
```
