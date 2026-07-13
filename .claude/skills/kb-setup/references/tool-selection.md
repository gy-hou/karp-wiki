# 本机工具盘点与组合选择

setup 必须根据实际环境选择一套**最小够用**的工具组合，而不是假设工具存在，也不是把所有可见工具都调用一遍。选择同时受四项约束：Agent 当前会话公开的工具清单、本机配置与已安装程序、用户声明的输入模态、`storage.mode` 与隐私边界。

## 1. 盘点来源

先盘点，后选择；探测失败写为 unavailable/unknown，不得猜测。

1. 从 **Agent 当前会话公开的工具清单**读取可用能力，只登记宿主明确暴露的工具、skill、MCP 或 connector。按能力登记，例如 `file-read`、`file-search`、`shell`、`image-understanding`、`document-extraction`、`web-retrieval`；不得通过尝试调用无关工具来“碰碰运气”。
2. 先运行 `node --version`。Node.js >=20 是 `scripts/kb.mjs` 的硬依赖；缺失或版本过低时报告阻塞并给出适配当前 OS 的安装建议，未经许可不得安装。
3. Node 可用后，用下面的只读命令采集本机配置；结果写入 `config.tooling.machine`：

   ```bash
   node -e 'const os=require("node:os"); console.log(JSON.stringify({platform:os.platform(),arch:os.arch(),logical_cpu:os.cpus().length,memory_gb:Math.round(os.totalmem()/1073741824)}))'
   ```

4. 用当前 shell/OS 的只读等价命令探测本地候选工具并记录真实版本。至少检查 Node.js、Git、ripgrep (`rg`) 与 Obsidian；仅在用户输入类型需要时再检查宿主清单或本机已有的文档提取/OCR 工具。不要扫描用户文件来推断软件，不要读取凭据或全局配置内容。
5. 每个候选项写入 `config.tooling.inventory`：`id`、`source` (`agent-tool` 或 `local-command`)、`available`、`version`（未知为 `null`）、`capabilities`。Agent 工具使用宿主公开的稳定名称，例如 `agent:<tool-id>`；本地程序使用命令名。

机器的 CPU/内存用于判断候选工具声明的兼容性与成本，不自动开启本地模型、embedding、OCR 或 ASR。硬件足够不等于用户授权，也不改变 v1 的 transcript-only 音频契约。

## 2. 按角色选择

从 inventory 中按下表选择并展示理由。整套 `config.tooling.selected` 才是本次构建知识库使用的工具组合。

| 角色 | 选择顺序 | 阻断/回退 |
|------|----------|-----------|
| `kernel` | `node+kb.mjs` | Node.js <20 或不可用时阻断 setup。 |
| `search` | `rg` → Agent 已公开的 file-search → `node-fs` | `rg` 可选；缺失不要求安装，使用首个真实可用回退。 |
| `versioning` | Git mode 选 `git`；`local-only` 可选 `git` 或 `none` | `private-git`/`public-git` 无 Git 时阻断；不得从 remote 猜隐私。 |
| `image_ingest` | Agent 已公开的 image-understanding；若只有 OCR，则仅提取可见文字并明确局限；否则 `user-description` | 不得把 OCR 说成完整视觉理解，不得编造图片内容。 |
| `audio_ingest` | 固定 `user-provided-transcript` | 即使发现本地 ASR，v1 也不自动选择或执行。 |
| `graph_view` | 需要 typed-edge/visibility 过滤时选内置 `karp-web`；偏好编辑器内 backlinks 且本机有 Obsidian 时选 `obsidian`；否则 `markdown+graph.json` | `karp-web` 复用必需的 Node.js，无额外依赖；图谱浏览器不阻断知识库。 |

文档提取、网页检索、connector 等属于按需能力：只有 `interview` 的输入类型/用途确实需要、当前会话真实可用且用户授权相应外部读取时，才加入 inventory 并选用。首次本地 ingest 默认不联网，不因工具可见就自动使用外部服务。

硬依赖缺失时只给与当前 OS 相符的建议。macOS 的 Node.js 可建议 `brew install node`，Git 可建议 `xcode-select --install`，ripgrep 可建议 `brew install ripgrep`；Debian/Ubuntu 的 Git/ripgrep 可建议 `sudo apt-get install git ripgrep`，Node.js 必须在安装后复核 ≥20；Windows 可建议 `winget install OpenJS.NodeJS.LTS`、`winget install Git.Git`、`winget install BurntSushi.ripgrep.MSVC`。Obsidian 始终可选，缺失不要求安装。

## 3. 配置与 checkpoint

`config.tooling` 使用以下形状：

```json
{
  "detected_at": "2026-07-13T12:00:00Z",
  "machine": {
    "platform": "darwin",
    "arch": "arm64",
    "logical_cpu": 8,
    "memory_gb": 16
  },
  "inventory": [
    {
      "id": "rg",
      "source": "local-command",
      "available": true,
      "version": "14.1.1",
      "capabilities": ["file-search"]
    }
  ],
  "selected": {
    "kernel": "node+kb.mjs",
    "search": "rg",
    "versioning": "none",
    "image_ingest": "agent:<tool-id>",
    "audio_ingest": "user-provided-transcript",
    "graph_view": "obsidian"
  }
}
```

- `detected_at` 使用 UTC ISO 8601；inventory 按 `id` 稳定排序，重复运行得到同一语义结果。
- 在 `privacy_tools` checkpoint 前，把 machine、inventory、selected 与隐私选择在同一次原子配置更新中写入；缺少必需角色时不得完成该 checkpoint。
- 先向用户展示“角色 → 选择 → 理由 → 回退”摘要。无偏好冲突时可采用上表默认选择；安装软件、启用联网/connector 或改动用户全局配置前仍须取得明确许可。
- `config.tooling` 是带时间戳的能力快照，不是永久保证。换电脑、所选工具消失或版本不再满足要求时，只重新盘点并原子更新该对象，不重跑已完成的 ingest，也不擅自安装替代品。

未经用户明确许可不得安装、升级或启用任何工具。
