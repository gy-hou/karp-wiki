# 多模态与工具能力

先检查当前运行时能力，再决定处理方式；不能验证的内容必须请用户补充，不得猜测。

## 模态 capability matrix

| 模态 | v1 支持 | 说明 |
|------|---------|------|
| 文本 | ✅ | 直接摄入。 |
| 图片 PNG/JPEG | ✅（条件） | 仅当当前 Agent 具备视觉能力；Agent 视觉阅读 → 摘要 → source `media_type: image`。文件/hash 管道由 `kb.mjs` 确定性校验；视觉理解依赖运行时 Agent，不由脚本断言。 |
| 音频 | transcript-only | v1 无内置 ASR。用户提供转写后按文本摄入，source 写 `media_type: audio` 与 `provenance: transcript-of-audio`；转写稿不等于原始音频。 |

## 处理步骤

1. 提醒用户：大文件会增加处理成本；私密内容被 Agent 读取时会发送给所配置的模型提供商。
2. 将新文件放到相应 `raw/text/`、`raw/images/` 或 `raw/audio/`；raw 落盘后 append-only，只能新增，不能修改或删除。
3. 文本直接读取。图片先确认视觉能力；没有视觉能力时不编造内容，请用户提供文字描述。音频只接收用户提供的 transcript，不声称执行了 ASR。
4. 每个 raw 文件落到一个 source 页，记录真实 `media_type`、相对 `raw_path` 与 raw bytes 的 SHA-256；音频另记 transcript provenance。
5. 按 `workflows.md` 完成去重、派生页面与确定性校验。

## 工具 capability matrix

| 工具 | 要求 | 自检 | 缺失时的建议（只提示，不自动执行） |
|------|------|------|------------------------------------|
| Node.js | 必需，版本 ≥20 | `node --version` | macOS: `brew install node@20`；Debian/Ubuntu: `sudo apt-get install nodejs npm` 后确认版本 ≥20（仓库版本过旧时改用 Node.js 官方安装方式）；Windows: `winget install OpenJS.NodeJS.LTS`。 |
| Git | `private-git`/`public-git` 必需；`local-only` 可选 | `git --version` | macOS: `xcode-select --install`；Debian/Ubuntu: `sudo apt-get install git`；Windows: `winget install Git.Git`。 |
| ripgrep (`rg`) | 可选 | `command -v rg` | macOS: `brew install ripgrep`；Debian/Ubuntu: `sudo apt-get install ripgrep`；Windows: `winget install BurntSushi.ripgrep.MSVC`。 |

安装建议仅供用户选择；未经明确许可不安装软件。
