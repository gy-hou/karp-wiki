# Claude Code / Codex 双端验收矩阵

_用于 karp-wiki v1.1.1 的可复现验收、fresh-session 记录与发布前人工检查_

---

## 📋 证据边界

验收证据必须分成两类，不能互相替代。

| 证据类型 | 能证明 | 不能证明 |
| --- | --- | --- |
| 确定性脚本 | 文件存在、镜像一致、raw SHA-256、schema、引用、index 覆盖、隐私硬门、graph 结构、幂等与 fail-closed | Claude Code 或 Codex 是否在全新会话中触发 skill；图片中的语义是否真的被看见 |
| Agent fresh session | 自然语言或显式调用是否加载 `kb-setup`；交互式 setup、断点恢复与视觉理解是否真实发生 | canonical 与镜像逐字相等；所有坏 fixture 都被 kernel 拒绝；graph 与 golden 逐字一致 |

`node --test`、`kb.mjs` 和 shell 断言只属于第一类。技能触发率、setup 的交互行为、会话中是否实际读取图片，必须保留 Claude Code / Codex 的 fresh-session 记录。自然语言自动触发是需要测量的行为，**不承诺 100% 成功**；显式 `/kb-setup` 或 `$kb-setup` 是发现失败时的稳定入口。

## 🎯 最低验收门槛

以下 11 项全部通过才可签署验收。每项都注明主要证据及可复制命令。

### 1. 双端发现与触发

- Claude Code 从 `.claude/skills/kb-setup` 发现 skill，Codex 从 `.agents/skills/kb-setup` 发现 skill。
- 文件存在只能证明发现路径已安装；实际自动/显式触发由后文的 fresh-session 四象限记录证明。

```bash
set -euo pipefail
test -f .claude/skills/kb-setup/SKILL.md
test -f .agents/skills/kb-setup/SKILL.md
grep -q '^name: kb-setup$' .claude/skills/kb-setup/SKILL.md
grep -q '^name: kb-setup$' .agents/skills/kb-setup/SKILL.md
```

通过条件：上述命令退出 `0`，且 Claude Code、Codex 各有自然语言与显式调用的 fresh-session 记录。自然语言未触发时如实记失败，不把随后显式调用的成功改记成自动触发成功。

### 2. canonical 与镜像一致

`skills/kb-setup` 是 canonical；`.claude/skills/kb-setup` 与 `.agents/skills/kb-setup` 必须逐字同步。

```bash
npm run sync-skills:check
```

通过条件：退出 `0`。禁止在验收前先运行写入式 `npm run sync-skills` 来掩盖 drift。

### 3. setup 全新运行、幂等与 resume

setup 是 Agent skill 工作流，不是独立的 setup 可执行文件，因此本项由隔离目录中的 Agent 会话与事后脚本共同证明：

1. 在全新临时副本中完成六步 setup，最终 `state=complete`。
2. 对已完成副本再次显式调用 setup，文件快照不变。
3. 在一个独立副本中途终止；确认 `state=in_progress`、`setup.completed_steps` 无重复且保持 `_step_order` 顺序；在新会话恢复后仅执行 pending steps，最终完成。

完成或恢复后运行：

```bash
set -euo pipefail
node -e 'const c=require("./.karp-wiki/config.json"); const s=c.setup; if(c.state!=="complete"||s.current_step!==null||s.completed_steps.join("|")!==s._step_order.join("|")) process.exit(1)'
node scripts/kb.mjs check
```

幂等复测前后使用同一快照函数，第二次 setup 后 `diff` 必须为空：

```bash
snapshot() {
  find "$1" -type f ! -path '*/.git/*' -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256
}
snapshot "$CASE_ROOT" > "$EVIDENCE_DIR/setup-before.sha256"
# 在 CASE_ROOT 开启新的 fresh session，并显式调用 /kb-setup 或 $kb-setup。
snapshot "$CASE_ROOT" > "$EVIDENCE_DIR/setup-after.sha256"
diff -u "$EVIDENCE_DIR/setup-before.sha256" "$EVIDENCE_DIR/setup-after.sha256"
```

通过条件：首次完成、二次零修改、断点恢复后的 `completed_steps` 为完整且无重复的有序列表；会话记录没有重复写 source 或重复追加同一 ingest / setup-complete 事件。

### 4. 同素材 ingest 幂等

在已完成 setup 的同一隔离副本中，把 `raw/text/xxx.md` 再摄入一次。按实际 raw digest 统计 source：

```bash
set -euo pipefail
RAW_SHA=$(shasum -a 256 raw/text/xxx.md | awk '{print $1}')
SOURCE_COUNT=$(rg -l "^raw_sha256: [\"']?${RAW_SHA}[\"']?$" wiki/sources --glob '*.md' | wc -l | tr -d ' ')
test "$SOURCE_COUNT" -eq 1
node scripts/kb.mjs check
```

通过条件：仍只有一个 source 使用该 SHA-256，`check` 退出 `0`，没有 `duplicate_raw`。第二次 ingest 应更新或复用既有 source，不新建第二页。

### 5. raw append-only

在任何 Agent ingest 前先记录目标 raw bytes 的 SHA-256，完成首次和重复 ingest 后再比较：

```bash
set -euo pipefail
test -n "${RAW_SHA_BEFORE:?capture RAW_SHA_BEFORE before opening the Agent session}"
RAW_SHA_AFTER=$(shasum -a 256 raw/text/xxx.md | awk '{print $1}')
test "$RAW_SHA_BEFORE" = "$RAW_SHA_AFTER"
```

通过条件：前后 digest 完全一致。新增其他 raw 文件不构成失败；修改或删除已落盘的 `raw/text/xxx.md` 构成失败。

### 6. 坏输入全部 fail closed

必须拒绝：坏 YAML、缺字段、重复 ID、正文断链、错误 `source_ids` 引用、缺失媒体、无 frontmatter、路径穿越、非法枚举、重复 SHA。对应错误类别至少包括 `missing_field`、`duplicate_id`、`broken_link`、`broken_source_ref`、`raw_missing`、`no_frontmatter`、`path_escape` / `symlink_escape`、`invalid_status` / `invalid_visibility` 与 `duplicate_raw`。

`tests/fixtures/bad-*` 是坏库语料；`node --test` 负责断言具体错误类别，并可从这些 fixture 复制临时变体来覆盖缺字段、错误 source 引用和 symlink 逃逸等单项。先运行测试，再确认每个现有 bad fixture 的 CLI 都非零退出：

```bash
set -euo pipefail
node --test
for fixture in tests/fixtures/bad-*; do
  if node scripts/kb.mjs check --root "$fixture"; then
    echo "unexpected pass: $fixture" >&2
    exit 1
  fi
done
```

通过条件：测试全绿，所有 `bad-*` 都被拒绝；验收记录把上述十种坏输入逐项映射到 fixture 或 fixture-derived 单元用例。任何必需类别无断言都视为本项失败，不能仅凭“命令非零”笼统通过。

### 7. reindex 可修复且幂等

`reindex` 必须在有效 fixture 上 byte-idempotent；它也必须能在可解析但其他校验不合规的库中重建 index。`check` 的 index coverage 负责确认 index 与内容页 ID 集合相等。

```bash
set -euo pipefail
TMP_GOOD=$(mktemp -d "${TMPDIR:-/tmp}/karp-reindex-good.XXXXXX")
TMP_BAD=$(mktemp -d "${TMPDIR:-/tmp}/karp-reindex-bad.XXXXXX")
cp -R tests/fixtures/good/. "$TMP_GOOD/"
cp -R tests/fixtures/bad-broken-link/. "$TMP_BAD/"
node scripts/kb.mjs reindex --root "$TMP_GOOD"
shasum -a 256 "$TMP_GOOD/wiki/index.md" > "$TMP_GOOD/first.sha"
node scripts/kb.mjs reindex --root "$TMP_GOOD"
shasum -a 256 "$TMP_GOOD/wiki/index.md" > "$TMP_GOOD/second.sha"
diff -u "$TMP_GOOD/first.sha" "$TMP_GOOD/second.sha"
node scripts/kb.mjs check --root "$TMP_GOOD"
node scripts/kb.mjs reindex --root "$TMP_BAD"
test -s "$TMP_BAD/wiki/index.md"
```

通过条件：两次 index digest 一致、good fixture 的 `check` 通过、bad-but-parseable fixture 即使仍有断链也能完成 `reindex`。

### 8. graph 版本、typed relations、去重、golden 与 fail-closed

```bash
set -euo pipefail
node --test --test-name-pattern='buildGraph|build-graph' tests/kb.test.mjs
node scripts/kb.mjs build-graph
node -e 'const g=require("./data/generated/graph.json"); const k=e=>`${e.from}|${e.to}|${e.relation}`; if(g.schema_version!==1||!g.edges.every(e=>e.from&&e.to&&e.relation)||new Set(g.edges.map(k)).size!==g.edges.length) process.exit(1)'
```

通过条件：`schema_version: 1`；所有边都有 `from`、`to`、`relation`；关系是 typed、无重复，并与 `tests/fixtures/good/graph.golden.json` 一致。fail-closed 测试还必须证明：不合规库运行 `build-graph` 时非零退出，且目标 `graph.json` 不存在或保持调用前状态，绝不写半成品。

### 9. public-git 隐私硬门

```bash
set -euo pipefail
node --test --test-name-pattern='public-git|visibilityErrors' tests/kb.test.mjs
```

通过条件：当 `.karp-wiki/config.json` 的 `storage.mode=public-git` 且任一页面为 `content_visibility: private` 时，`check` 与 `build-graph` 均非零退出；这不是 warning。

### 10. 文本、真实图片与音频边界

- 文本端到端证据来自 fresh-session 的 `raw/text/xxx.md` 摄入。
- 图片端到端证据使用 `examples/raw/images/note-shot.png`，它是实际存在且含可读内容的图片，不是 1×1 单元 fixture。
- 音频 v1 仅接受用户提供的 transcript；source 必须有 `provenance`，不得声称执行了 ASR。

脚本只验证文件/hash/结构管道：

```bash
set -euo pipefail
test -s examples/raw/images/note-shot.png
node scripts/kb.mjs check --root examples
rg -q '^media_type: image$' examples/wiki/sources/source-shot-productivity.md
rg -q '^raw_sha256: "?[0-9a-f]{64}"?$' examples/wiki/sources/source-shot-productivity.md
rg -q '^media_type: audio$' examples/wiki/sources/source-podcast-learning.md
rg -q '^provenance: transcript-of-audio$' examples/wiki/sources/source-podcast-learning.md
```

视觉理解必须另开具备视觉能力的 Agent fresh session，让 Agent 读取图片并记录它实际看见的词语、数字或关系；再由操作员对照图片人工核验。仅凭 `check --root examples`、图片存在或 hash 相符，不能声明视觉理解通过。若运行时没有视觉能力，本项的视觉部分记为“未通过/未执行”，不得从文件名、example source 或 README 反推图片内容。

### 11. 双端只比较结构不变量

Claude Code 与 Codex 使用相同 raw bytes 和固定回答。比较：

- 四类页面数量及 source 页数量
- `check` 所保证的 frontmatter、引用、index 覆盖与隐私契约
- graph 的 `schema_version`、边数量，以及归一化后的 `from type -> relation -> to type` 多重集合
- 目标 ingest log 恰好一条

不比较 title、summary、正文措辞或文件字节；LLM 文本不要求逐字相同。对两个成功 case 生成结构清单：

```bash
set -euo pipefail
inventory() {
  root=$1
  out=$2
  node scripts/kb.mjs reindex --root "$root" >/dev/null
  node scripts/kb.mjs check --root "$root" >/dev/null
  node scripts/kb.mjs build-graph --root "$root" >/dev/null
  {
    for type in concept entity source output; do
      count=$({ rg -l "^type: ${type}$" "$root/wiki" --glob '*.md' 2>/dev/null || true; } | wc -l | tr -d ' ')
      printf 'pages.%s=%s\n' "$type" "$count"
    done
    node -e 'const g=require(process.argv[1]); const t=new Map(g.nodes.map(n=>[n.id,n.type])); console.log(`graph.schema_version=${g.schema_version}`); for(const x of g.edges.map(e=>`${t.get(e.from)}|${e.relation}|${t.get(e.to)}`).sort()) console.log(`edge=${x}`)' "$root/data/generated/graph.json"
    count=$(rg '^## .* ingest \|' "$root/wiki/log.md" | rg -v 'setup-complete' | wc -l | tr -d ' ')
    printf 'target_ingest_logs=%s\n' "$count"
  } > "$out"
}
inventory "$CLAUDE_ROOT" "$EVIDENCE_DIR/claude.structure"
inventory "$CODEX_ROOT" "$EVIDENCE_DIR/codex.structure"
diff -u "$EVIDENCE_DIR/claude.structure" "$EVIDENCE_DIR/codex.structure"
```

通过条件：结构清单相同，两个 `target_ingest_logs=1`，但不要求自然语言内容相同。如双方生成的页面 ID 不同，只要类型数量与归一化边结构相同即可。

## 🔍 双端 fresh-session 测试脚本

每个 trial 必须使用独立副本和全新会话；不能在同一对话中先失败再显式触发，并把整段记成自然语言成功。

### 准备隔离 case

从待验收 commit 创建四个无历史临时副本，并写入完全相同的 raw bytes：

```bash
set -euo pipefail
REPO=$(git rev-parse --show-toplevel)
EVIDENCE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/karp-evidence.XXXXXX")
prepare_case() {
  label=$1
  root=$(mktemp -d "${TMPDIR:-/tmp}/karp-${label}.XXXXXX")
  git -C "$REPO" archive HEAD | tar -x -C "$root"
  mkdir -p "$root/raw/text"
  printf '%s\n' \
    '# Dual-agent acceptance material' \
    'A local knowledge base preserves raw bytes and builds a validated graph.' \
    > "$root/raw/text/xxx.md"
  printf '%s\n' "$root"
}
CLAUDE_NATURAL=$(prepare_case claude-natural)
CLAUDE_EXPLICIT=$(prepare_case claude-explicit)
CODEX_NATURAL=$(prepare_case codex-natural)
CODEX_EXPLICIT=$(prepare_case codex-explicit)
for item in \
  "claude-natural:$CLAUDE_NATURAL" \
  "claude-explicit:$CLAUDE_EXPLICIT" \
  "codex-natural:$CODEX_NATURAL" \
  "codex-explicit:$CODEX_EXPLICIT"; do
  label=${item%%:*}
  root=${item#*:}
  shasum -a 256 "$root/raw/text/xxx.md" > "$EVIDENCE_DIR/${label}.raw-before.sha256"
done
printf 'evidence=%s\n' "$EVIDENCE_DIR"
```

不要复制个人 raw、token 或私密配置。`git archive HEAD` 确保各 trial 起点相同，且不携带之前会话产生的 `.karp-wiki/config.json`。

### 固定回答

如果 setup 询问，四个 trial 都逐字使用以下选择：

| 问题 | 固定回答 |
| --- | --- |
| 主题 | `dual-agent evaluation` |
| 用途 | `验证文本摄入和结构不变量` |
| 首批模态 | `text` |
| storage mode | `local-only` |
| 额外 subtype / tag | `不增加额外 subtype；tag 使用 dual-agent-eval` |
| 首份资料 | `raw/text/xxx.md` |

Agent 必须先原样说明隐私提示，再由操作员选择 `local-only`。不要为了让两端文字一样而指定 title、summary 或正文模板。

### Claude Code 固定 prompt

自然语言 trial：在 `CLAUDE_NATURAL` 中开启全新 Claude Code 会话，只发送：

```text
把 raw/text/xxx.md 摄入知识库
```

显式 trial：在 `CLAUDE_EXPLICIT` 中开启另一个全新 Claude Code 会话，先发送 `/kb-setup`，随后发送同一个固定 prompt：

```text
把 raw/text/xxx.md 摄入知识库
```

自然语言 trial 的成功定义是：在操作员没有提示 skill 名称之前，Claude Code 自行从 `.claude/skills` 加载或调用 `kb-setup` 并进入 setup。显式 trial 的记录必须包含 `/kb-setup` 调用。

### Codex 固定 prompt

自然语言 trial：在 `CODEX_NATURAL` 中开启全新 Codex 会话，只发送：

```text
把 raw/text/xxx.md 摄入知识库
```

显式 trial：在 `CODEX_EXPLICIT` 中开启另一个全新 Codex 会话，先发送 `$kb-setup`，随后发送同一个固定 prompt：

```text
把 raw/text/xxx.md 摄入知识库
```

自然语言 trial 的成功定义是：在操作员没有提示 skill 名称之前，Codex 自行从 `.agents/skills` 加载或调用 `kb-setup` 并进入 setup。显式 trial 的记录必须包含 `$kb-setup` 调用。

### 每个成功 case 的断言

在 case 根目录运行。`setup-complete` 是独立的生命周期日志，不计入本次素材的单条 ingest 断言：

```bash
set -euo pipefail
test "$(find wiki/sources -type f -name 'source-*.md' | wc -l | tr -d ' ')" -eq 1
node scripts/kb.mjs reindex
node scripts/kb.mjs check
node scripts/kb.mjs build-graph
test "$(rg '^## .* ingest \|' wiki/log.md | rg -v 'setup-complete' | wc -l | tr -d ' ')" -eq 1
RAW_SHA_AFTER=$(shasum -a 256 raw/text/xxx.md | awk '{print $1}')
SOURCE_SHA=$(node -e 'const fs=require("node:fs"); const files=fs.readdirSync("wiki/sources").filter(f=>f.endsWith(".md")); const hashes=files.flatMap(f=>{const m=fs.readFileSync(`wiki/sources/${f}`,"utf8").match(/^raw_sha256:\s*["\x27]?([0-9a-f]{64})["\x27]?\s*$/m); return m?[m[1]]:[]}); if(hashes.length!==1) process.exit(1); process.stdout.write(hashes[0])')
test "$RAW_SHA_AFTER" = "$SOURCE_SHA"
```

通过记录还必须显示 Agent 在写页后按 `reindex` → `check` → `build-graph` 顺序运行；事后补跑上述命令只能证明最终结构，不能替代会话内工作流证据。

### 中断与 resume trial

Claude Code 和 Codex 各准备一个额外独立 case，显式调用 setup。等某一步 checkpoint 已原子落盘且 `state=in_progress` 时终止会话，不手工编辑配置。中断后先记录：

```bash
node -e 'const c=require("./.karp-wiki/config.json"); const s=c.setup; const seen=new Set(s.completed_steps); if(c.state!=="in_progress"||seen.size!==s.completed_steps.length) process.exit(1); console.log(JSON.stringify({current_step:s.current_step,completed_steps:s.completed_steps}))'
```

再开启全新会话，使用 `/kb-setup` 或 `$kb-setup` 和同一组固定回答。验收会话必须说明它从 `setup.current_step` / 首个 pending step 恢复，并跳过 `completed_steps`。恢复完成后运行第 3 项的完整状态断言；比较日志和 source，确认没有重复副作用。

### 触发率与结果记录

每个客户端的自然语言 trial 与显式 trial 分开计算。可重复 `N` 次，但必须记录分母；最低 smoke 记录为每格一次。自然语言成功率可能低于 100%，这本身是结果，不得美化。

| 日期/commit | Agent/版本 | 模式 | trial 数 | 触发数 | 触发率 | setup 完成 | 1 source | check | index 覆盖 | 1 ingest log | raw 不变 | transcript / 证据路径 | 备注 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| 待填 | Claude Code | natural | 1 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 待填 | Claude Code | `/kb-setup` | 1 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 待填 | Codex | natural | 1 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |
| 待填 | Codex | `$kb-setup` | 1 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |

视觉 trial 另记：Agent/版本、是否声明视觉能力、图片 digest、实际看到的可核验词语/关系、人工对照结果、会话证据路径。没有视觉能力或没有会话证据时不能填“通过”。

## ⚙️ 全库最终 gate

从待发布 commit 的仓库根运行以下命令，保持 `set -euo pipefail`，不得拆开后只报告最后一个子命令：

```bash
cd "$(git rev-parse --show-toplevel)"
bash -c 'set -euo pipefail
  echo "== unit tests =="; node --test
  echo "== mirrors =="; npm run sync-skills:check
  echo "== root check =="; node scripts/kb.mjs check
  echo "== examples check =="; node scripts/kb.mjs check --root examples
  echo "== build graph =="; node scripts/kb.mjs build-graph
  echo "== discovery paths =="; ls .claude/skills/kb-setup/SKILL.md .agents/skills/kb-setup/SKILL.md
  echo "== import =="; grep -q "@AGENTS.md" CLAUDE.md
  echo "== config =="; node -e "const c=require(\"./.karp-wiki/config.example.json\"); if(c.state!==\"not_started\") process.exit(1)"
  echo "ALL GATES PASSED"'
echo "final gate exit=$?"
```

通过条件：末尾同时出现 `ALL GATES PASSED` 与 `final gate exit=0`。这条 release gate 不替代前述 fresh-session 触发、resume 与视觉证据。

## 🔐 legacy tag 语义与人工授权检查点

先定义想保留的历史语义，再从下面两个互斥选项中选一个。`legacy-prompt-db` 只能指向其中一个 commit，**绝不能同时执行两条 tag 命令**。

已核验历史：cleanup commit 是 `94c3e5d`，其父 `f958ff2` 是删除旧内容前的最后快照，仍含 command/template/dist；`da901c9` 是尚未加入任何 karp-wiki 设计文档的纯旧 prompt 仓库。`f958ff2~1` 实际解析为 `fb6e8ae`，语义不符合这两个目标。

| 先由用户确认的目标语义 | 唯一目标 | 授权后才可人工执行的 annotated tag |
| --- | --- | --- |
| 删除旧内容前最后快照；允许仍含 karp-wiki 设计文档 | `f958ff2` | `git tag -a legacy-prompt-db f958ff2 -m "Last snapshot before old prompt content was removed"` |
| 纯旧 prompt 库；不含任何 karp-wiki 设计文档 | `da901c9` | `git tag -a legacy-prompt-db da901c9 -m "Pure legacy prompt database (pre karp-wiki docs)"` |

> 🚫 **禁止：** 不得使用 `git tag ... f958ff2~1`；它指向 `fb6e8ae`，是错误目标。

tag、push 与 GitHub Template repository 设置都是人工授权检查点。Agent 在未获得用户明确授权并确认上述二选一语义前，只能展示命令，不能执行。授权后的人工流程是：

```bash
# 只执行上表中用户确认的一个 git tag -a 命令，然后再执行：
git push origin legacy-prompt-db
# 最后由有权限的用户在 GitHub Settings 中勾选 "Template repository"。
```

最终记录必须写明选择的语义、目标 SHA、annotated tag message、push 结果与 GitHub 设置操作者。若尚未授权，则写明 `no tag / no push / no GitHub setting change`，并把该外部步骤保持为 pending；本地文档与 gate 可以独立完成。

## ✅ 签署模板

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 11 项最低门槛 | 待填 | 命令输出与 fresh-session 记录 |
| Claude Code 自然/显式触发率 | 待填 | 触发率表 |
| Codex 自然/显式触发率 | 待填 | 触发率表 |
| 双端结构不变量 | 待填 | 两份 structure 清单与 diff |
| 文本/图片/音频边界 | 待填 | hash、check、视觉人工记录 |
| 最终 release gate | 待填 | `ALL GATES PASSED` / exit `0` |
| legacy 语义授权 | pending 或二选一 | 用户确认记录 |
| tag / push / GitHub Template | pending 或已授权完成 | 外部操作记录 |

验收人只在脚本证据与 Agent 证据各自完整时签署；任何一类证据缺失都不能由另一类推断补齐。
