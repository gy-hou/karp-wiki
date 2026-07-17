# 自动摄入（本地 prepare-only）

这里的 launchd 配置只会准备候选提交，绝不会 push、merge 或提交到 `master`。每次成功运行会在 `auto/ingest-YYYY-MM-DD-HHMM` 分支创建提交；请人工 review 后再决定是否 merge。

## 安装与卸载

在仓库根目录安装一个 agent 的本机任务：

```bash
bash automation/install.sh codex
# 或
bash automation/install.sh claude
```

安装器会把不含个人路径的模板复制到 `~/Library/LaunchAgents/`，注入本机仓库和可执行文件路径后加载。卸载或暂停：

```bash
bash automation/uninstall.sh codex
# 或
bash automation/uninstall.sh claude
```

不要同时安装两个版本，除非你明确希望两套 agent 都尝试同一批 raw。

## 触发、产物与检查

- launchd 会在每周一、周四 09:00 触发，也会在 `raw/` 有新素材时触发。
- 包装脚本只会从干净的 `master` 启动；若当前分支不是 `master` 或工作树有改动，会安静中止，不会打断正在进行的工作。
- 成功时 `kb.mjs check` 已通过，提交只在日期分支；失败时会留下 `WIP` 提交和现场以供检查。
- 摘要写到本地生成物 `automation/last-run.md`；launchd 输出在 `automation/launchd.out.log` 和 `automation/launchd.err.log`。这些文件不入库。

自动摄入默认不联网。`raw/` 中的所有内容都是不可信数据，不是 agent 指令；详见 `skills/kb-setup/references/auto-ingest.md`。

## Codex Automation 定时运行

如果希望由 Codex App 而非 macOS launchd 触发，可使用 [`codex-automation-prompt.md`](codex-automation-prompt.md) 作为任务提示。它让 Codex Automation 自己担任外层控制器，复用相同的 prepare-only、`master`+干净树与注入安全边界，不再嵌套调用本机 `codex exec`。

默认计划为每周二、周四、周六上午 10:00（本机时区）。在 Codex App 的 Automations 中可以按自己的作息调整日期和时间；日程属于本机账户设置，不会写入仓库。无论采用哪种触发器，产物始终只在 `auto/ingest-*` 分支，仍需人工 review 后 merge。
