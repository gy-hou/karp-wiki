# karp-wiki v2a 可视化 实施计划

> **给执行者:** REQUIRED SUB-SKILL —— 用 superpowers:subagent-driven-development(推荐)或 superpowers:executing-plans 逐任务执行。步骤用复选框(`- [ ]`)跟踪。
>
> **前置**:从**干净、已提交的 `master`**(≥ `95ae3d0`)拉一条新分支开工(如 `codex/karp-wiki-v2a-viz`)。不要在别的未提交改动上执行。

**Goal:** 给 karp-wiki 知识库加一个**静态、零依赖、只读**的本地 web 可视化:一条构建脚本从冻结的 kernel 生成 `web/data/kb-data.js`,一个手写 SVG 的网页展示 dashboard / 搜索 / 过滤 / 知识图谱,`file://` 直接打开或极简 http server。

**Architecture:** `scripts/build-web.mjs` 复用 kernel 导出(`collectPages`/`validate`/`buildGraph`/`findMalformed`/`resolveRoot`),**先 fail-closed 校验**,再产出 `web/data/kb-data.js`(`window.KB_DATA = {...}`)。`web/index.html` + `styles.css` + `app.js` 用 `<script>` 注入该数据(**不用 fetch**,故 `file://` 可直接跑),手写 SVG 画图谱,只读、不写回 Markdown。**参考实现** `/Users/mac/Documents/english-learn-database/web/`(同款零依赖 SVG 形态)是 UI 的起点,本计划给出泛化到 karp-wiki schema 的精确改造点。

**Tech Stack:** Node ≥ 20(仅标准库,零外部依赖);浏览器原生 JS,**无框架、无外部库、无 CDN、无 vendored JS**;手写 SVG。可选 `python3 -m http.server` 仅作便利。

## Global Constraints

- **零外部依赖**:构建脚本与网页两端都不得引入任何 npm 包、CDN、vendored 库(与 kernel 一致)。图谱布局手写(SVG),不用 d3/cytoscape/vis-network。
- **复用 kernel,不重写解析**:`build-web.mjs` 必须 `import` `scripts/kb.mjs` 的 `collectPages`/`validate`/`buildGraph`/`findMalformed`/`resolveRoot`/`SCHEMA_VERSION`/`TYPES`,不得复制 frontmatter 解析或图谱逻辑。
- **只读**:网页永不写回 Markdown;无登录、无云同步、无部署。
- **隐私默认安全(硬约束)**:`build-web` **默认排除 `content_visibility: private` 的页面**,且**排除任何一端落在被排除节点上的边** —— 排除是在 `kb-data.js` 层面剔除,不是 UI 隐藏。`--include-private` 才纳入私密页(仅供本地查看)。默认产物必须可安全分享。
- **fail-closed**:`build-web` 先跑 `validate` + `findMalformed`;有任何错误即非零退出且**不写 `kb-data.js`**(与 `kb.mjs build-graph` 一致)。
- **根定位**:`build-web` 支持 `--root <dir>`,解析顺序与 `resolveRoot` 一致(`--root` → git toplevel → `cwd(含 wiki/)` → fail-fast)。
- **Node 兼容**:`engines.node ">=20"` 不变;读 JSON 用 CommonJS(`node -e "require(...)"`);heredoc 用 `node --input-type=module - <<'NODE'`。
- **kb-data.js 契约(v2a 冻结)**:
  ```js
  window.KB_DATA = {
    schema_version: 1,
    built_at: "<ISO string>",          // 由 CLI 用 new Date().toISOString() 写入
    manifest: { total: <int>, counts: { concept, entity, source, output } },
    nodes: [ { id, type, title, summary, tags, content_visibility } ],  // 按 id 升序
    edges: [ { from, to, relation } ],  // relation ∈ derived_from|links_to;两端都在 nodes 内
    pages: [ { id, type, title, summary, tags, file } ]                  // file = basename,按 id 升序
  };
  ```
- **生成物不入库**:`web/data/kb-data.js` 是可重建生成物,gitignore 掉;`web/{index.html,styles.css,app.js}` 是产品代码,入库。网页在 `kb-data.js` 缺失时必须优雅降级(`window.KB_DATA || {空结构}`)。
- 参考实现只读借鉴,不修改:`~/Documents/english-learn-database/web/`。

## File Structure

```
scripts/build-web.mjs        # 构建:kernel -> web/data/kb-data.js(Task 1)
web/index.html               # 页面骨架 + <script> 注入(Task 2)
web/styles.css               # 样式(Task 2)
web/app.js                   # 渲染:dashboard/搜索/过滤/SVG 图谱/详情(Task 2)
web/data/kb-data.js          # 生成物(gitignore)(Task 1 产出)
tests/build-web.test.mjs     # build-web 单测(Task 1)
package.json                 # +build-web +dev scripts(Task 3)
.gitignore                   # + web/data/kb-data.js(Task 3)
README.md / readme-en.md     # + 可视化章节(Task 3)
```

**依赖顺序:** 1 → 2 → 3。

**Subagent-Driven 复核检查点:**
- Task 1 后:确认 build-web 真实先红后绿、隐私默认排除、fail-closed。
- Task 2 后:**人工视觉验收** —— 打开网页确认图谱、搜索、过滤、详情都工作。
- Task 3 后:干净 clone 跑完整 gate。

---

## Task 1: `scripts/build-web.mjs` —— 构建脚本(TDD)

**Files:**
- Create: `scripts/build-web.mjs`、`tests/build-web.test.mjs`

**Interfaces:**
- Produces(导出):`buildWebData(pages, graph, opts?) → { schema_version, built_at:null, manifest, nodes, edges, pages }`(纯函数;`built_at` 由 CLI 填);CLI `node scripts/build-web.mjs [--root <dir>] [--include-private]`。
- Consumes:`scripts/kb.mjs` 的 `collectPages`/`validate`/`buildGraph`/`findMalformed`/`resolveRoot`/`SCHEMA_VERSION`/`TYPES`。
- 测试 fixtures 复用现有:`tests/fixtures/good`(5 页**全 private**)与 `examples/`(5 页**全 shareable**)。

- [ ] **Step 1: 写失败测试 `tests/build-web.test.mjs`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPages, buildGraph } from '../scripts/kb.mjs';
import { buildWebData } from '../scripts/build-web.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const goodWiki = path.join(here, 'fixtures', 'good', 'wiki');
const examplesWiki = path.resolve(here, '..', 'examples', 'wiki');

test('buildWebData excludes private pages by default (good fixture is all private)', async () => {
  const pages = await collectPages(goodWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  assert.equal(data.nodes.length, 0);
  assert.equal(data.edges.length, 0);
  assert.equal(data.manifest.total, 0);
});

test('buildWebData includes private with --include-private', async () => {
  const pages = await collectPages(goodWiki);
  const data = buildWebData(pages, buildGraph(pages), { includePrivate: true });
  assert.equal(data.nodes.length, 5);
});

test('buildWebData on shareable examples yields nodes + typed edges', async () => {
  const pages = await collectPages(examplesWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  assert.equal(data.nodes.length, 5);
  assert.ok(data.edges.length > 0);
  const relations = new Set(data.edges.map((e) => e.relation));
  assert.ok(relations.has('derived_from') && relations.has('links_to'));
});

test('every edge references only included nodes (no leaked ids)', async () => {
  const pages = await collectPages(examplesWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  const ids = new Set(data.nodes.map((n) => n.id));
  for (const e of data.edges) { assert.ok(ids.has(e.from)); assert.ok(ids.has(e.to)); }
});

test('shape and stable ordering', async () => {
  const pages = await collectPages(examplesWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  assert.equal(data.schema_version, 1);
  assert.equal(data.built_at, null);
  for (const k of ['manifest', 'nodes', 'edges', 'pages']) assert.ok(k in data);
  const ids = data.nodes.map((n) => n.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(Object.keys(data.manifest.counts), ['concept', 'entity', 'source', 'output']);
});
```

- [ ] **Step 2: 运行确认失败** — `cd "$(git rev-parse --show-toplevel)" && node --test tests/build-web.test.mjs` → FAIL(`Cannot find module '../scripts/build-web.mjs'`)。

- [ ] **Step 3: 实现 `scripts/build-web.mjs`**

```javascript
#!/usr/bin/env node
// Build a static, shareable-by-default web data blob from the KB. Zero deps. Node >= 20.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectPages, validate, buildGraph, findMalformed, resolveRoot, SCHEMA_VERSION, TYPES,
} from './kb.mjs';

export function buildWebData(pages, graph, { includePrivate = false } = {}) {
  const visible = includePrivate ? pages : pages.filter((p) => p.contentVisibility !== 'private');
  const ids = new Set(visible.map((p) => p.id));
  const byId = (a, b) => String(a.id).localeCompare(String(b.id));
  const nodes = visible
    .map((p) => ({ id: p.id, type: p.type, title: p.title, summary: p.summary, tags: p.tags, content_visibility: p.contentVisibility }))
    .sort(byId);
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const pagesOut = visible
    .map((p) => ({ id: p.id, type: p.type, title: p.title, summary: p.summary, tags: p.tags, file: path.basename(p.file) }))
    .sort(byId);
  const counts = Object.fromEntries(TYPES.map((t) => [t, visible.filter((p) => p.type === t).length]));
  return { schema_version: SCHEMA_VERSION, built_at: null, manifest: { total: visible.length, counts }, nodes, edges, pages: pagesOut };
}

async function cmdBuild(root, { includePrivate }) {
  const wikiDir = path.join(root, 'wiki');
  const pages = await collectPages(wikiDir);
  const errors = await validate(pages, root);
  for (const f of await findMalformed(wikiDir)) errors.push({ category: 'no_frontmatter', message: path.relative(root, f) });
  if (errors.length) {
    const byCat = {};
    for (const e of errors) (byCat[e.category] ??= []).push(e.message);
    for (const [cat, msgs] of Object.entries(byCat)) {
      console.error(`\n${cat} (${msgs.length}):`);
      for (const m of msgs) console.error(`  - ${m}`);
    }
    console.error(`\n✗ build-web aborted (fail-closed): ${errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }
  const data = buildWebData(pages, buildGraph(pages), { includePrivate });
  data.built_at = new Date().toISOString();
  const outDir = path.join(root, 'web', 'data');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'kb-data.js'), `window.KB_DATA = ${JSON.stringify(data, null, 2)};\n`, 'utf8');
  console.log(`✓ build-web: ${data.nodes.length} node(s), ${data.edges.length} edge(s)${includePrivate ? ' (incl. private)' : ''} -> web/data/kb-data.js`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const root = resolveRoot(argv);
  if (!root) { console.error('Cannot determine KB root: run inside a git repo or pass --root <dir>.'); process.exitCode = 2; }
  else cmdBuild(root, { includePrivate: argv.includes('--include-private') }).catch((err) => { console.error(err.message); process.exitCode = 1; });
}
```

- [ ] **Step 4: 运行确认通过** — `node --test tests/build-web.test.mjs` → PASS(5 tests)。全量 `node --test` 也应仍全绿。

- [ ] **Step 5: 冒烟 —— CLI 生成 + fail-closed + 隐私默认**

```bash
cd "$(git rev-parse --show-toplevel)"
node scripts/build-web.mjs --root examples && head -1 examples/web/data/kb-data.js && grep -c '"id"' examples/web/data/kb-data.js
node scripts/build-web.mjs --root tests/fixtures/good && grep -q '"nodes": \[\]' tests/fixtures/good/web/data/kb-data.js && echo "private excluded by default OK"
rm -rf tests/fixtures/bad-broken-link/web
node scripts/build-web.mjs --root tests/fixtures/bad-broken-link >/dev/null 2>&1; echo "fail-closed exit=$?"
test -e tests/fixtures/bad-broken-link/web/data/kb-data.js && echo "LEAKED (bug)" || echo "no output on failure OK"
# 清理生成物
rm -rf examples/web tests/fixtures/good/web tests/fixtures/bad-broken-link/web
```
Expected:`window.KB_DATA = {` 开头;examples 有 5 个 `"id"`(实际 node 数);good 默认 `"nodes": []` → `private excluded by default OK`;`fail-closed exit=1`;`no output on failure OK`。

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add scripts/build-web.mjs tests/build-web.test.mjs
git commit -m "feat: build-web.mjs — shareable-by-default web data from kernel (fail-closed, TDD)"
```

---

## Task 2: `web/` 网页(泛化参考实现的零依赖 SVG UI)

> 以 `/Users/mac/Documents/english-learn-database/web/`(`index.html` + `styles.css` + `app.js`,手写 SVG、`window.KB_DATA` 注入)为起点,**泛化到 karp-wiki schema**。下方给出必须满足的改造点与验收,而非逐行代码(UI 本质是视觉产物,参考实现即模板)。

**Files:**
- Create: `web/index.html`、`web/styles.css`、`web/app.js`

**Interfaces:**
- Consumes:`web/data/kb-data.js` 注入的 `window.KB_DATA`(Task 1 冻结的契约)。
- 读取方式:`index.html` 用 `<script src="./data/kb-data.js"></script>` 再 `<script src="./app.js"></script>`,**不用 fetch**(保证 `file://` 可跑)。

**改造要求(逐条,验收据此):**
- **入口降级**:`app.js` 首行 `const kb = window.KB_DATA || { schema_version: 1, built_at: null, manifest: { total: 0, counts: {} }, nodes: [], edges: [], pages: [] };`,`kb-data.js` 缺失时页面不崩、提示"请先 `npm run build-web`"。
- **类型标签/配色**:仅四类 `concept / entity / source / output`(中文标签:概念/实体/来源/产出),各一色;**删除**参考里的 `vocabulary/sentence/paragraph/mistake` 及 tag 伪节点。
- **Dashboard**:显示 `manifest.total` 与四类计数、`built_at`。
- **搜索**:对 `nodes` 的 `title`/`summary`/`tags` 做不区分大小写子串匹配。
- **过滤**:type(全部/概念/实体/来源/产出)、tag(取自数据)、relation(全部 / `derived_from` / `links_to`)。
- **图谱(手写 SVG)**:节点按 type 上色;**边按 relation 区分**(如 `derived_from` 实线带箭头、`links_to` 虚线),布局可用参考的简单确定性布局(如按 type 分列/环形),不引入布局库;过滤条件作用于图谱。
- **详情**:点节点 → 侧栏显示 `title / type / summary / tags`,以及指向对应页面的相对链接(`wiki/<type复数>/<file>` 或直接 `pages[].file`);**只读**,不提供编辑。
- **隐私提示**:页面注明"本视图默认只含 shareable 页;私密页需用 `--include-private` 重建后本地查看"。
- **YAGNI 删除**:参考里的 practice/练习模式、进度存储(`loadProgress`/`saveProgress`)、雅思专用视图一律不移植。

- [ ] **Step 1: 读参考实现,产出三文件**

先读 `~/Documents/english-learn-database/web/{index.html,styles.css,app.js}`,按上述改造点改写为 karp-wiki 版本,写入 `web/index.html`、`web/styles.css`、`web/app.js`。

- [ ] **Step 2: JS 语法与数据结构冒烟(非交互)**

```bash
cd "$(git rev-parse --show-toplevel)"
node --check web/app.js && echo "app.js syntax OK"
node scripts/build-web.mjs --root examples >/dev/null
node --input-type=module - <<'NODE'
import { readFile } from 'node:fs/promises';
const src = await readFile('examples/web/data/kb-data.js', 'utf8');
const window = {};
new Function('window', src)(window);      // eval the injected blob with a window shim
const d = window.KB_DATA;
if (!d || d.nodes.length !== 5) throw new Error('kb-data shape unexpected: ' + JSON.stringify(d?.manifest));
console.log('kb-data valid: nodes', d.nodes.length, 'edges', d.edges.length, 'built_at', !!d.built_at);
NODE
```
Expected:`app.js syntax OK`;`kb-data valid: nodes 5 edges N built_at true`。

- [ ] **Step 3:【人工视觉检查点】打开网页验收**

用 examples 数据打开页面:
```bash
cd "$(git rev-parse --show-toplevel)"
node scripts/build-web.mjs --root examples
# 方式一:直接 file:// 打开
open examples/web/index.html    # 若 web/ 在 examples 下;否则见下
# 方式二:根库 web/(把 examples 数据拷到根 web/data 或直接对根库 build)
```
> 注意:`build-web --root examples` 会把 `kb-data.js` 写到 `examples/web/data/`,但 `web/{index.html,app.js,styles.css}` 在**仓库根**的 `web/`。验收时用根库 `web/` + 一份有内容的 `kb-data.js`:可临时 `node scripts/build-web.mjs --root examples` 后把 `examples/web/data/kb-data.js` 拷到根 `web/data/`,或直接对一个 shareable 内容的根库构建。**人工确认:** 图谱渲染出 5 个节点、两类边可区分、搜索/type/tag/relation 过滤生效、点节点出详情且能跳到页面。确认后清理临时生成物。

- [ ] **Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add web/index.html web/styles.css web/app.js
git commit -m "feat: static zero-dep web viz (SVG graph, search/filter, read-only) generalized from reference"
```

---

## Task 3: 接线(npm scripts + gitignore + README)+ 最终 gate

**Files:**
- Modify: `package.json`、`.gitignore`、`README.md`、`readme-en.md`

- [ ] **Step 1: `package.json` 加 scripts**

在 `scripts` 中新增:
```json
    "build-web": "node scripts/build-web.mjs",
    "dev": "npm run build-web && (command -v python3 >/dev/null && python3 -m http.server 5173 --directory web || echo 'open web/index.html directly (file://)')"
```
(保留现有 check/reindex/build-graph/sync-skills/test/gate。)

- [ ] **Step 2: `.gitignore` 忽略生成物**

在生成物区追加(与现有 `**/data/generated/` 同段):
```gitignore
**/web/data/kb-data.js
```

- [ ] **Step 3: README 加"可视化"章节(中/英)**

必含:`npm run build-web` 生成 `web/data/kb-data.js`;`file://` 直接打开 `web/index.html` 或 `npm run dev`(需 python3,仅便利);**默认只含 shareable 页,`--include-private` 才含私密,仅本地查看**;只读、不写回;数据契约见本计划;与 Obsidian Graph View 的区别(typed-edge/visibility 过滤是这个 web 独有)。

- [ ] **Step 4: 验证声明**

```bash
cd "$(git rev-parse --show-toplevel)"
node -e "const p=require('./package.json'); console.log('build-web' in p.scripts && 'dev' in p.scripts ? 'scripts OK':'MISSING')"
grep -q 'web/data/kb-data.js' .gitignore && echo "gitignore OK"
grep -qi 'include-private' README.md && echo "privacy doc OK"
grep -q 'build-web' README.md && grep -q 'build-web' readme-en.md && echo "readme OK"
```
Expected:全部 OK。

- [ ] **Step 5: 最终 gate(set -euo pipefail)**

```bash
cd "$(git rev-parse --show-toplevel)"
bash -c 'set -euo pipefail
  node --test 2>&1 | grep -E "ℹ (tests|pass|fail)"
  npm run sync-skills:check >/dev/null && echo "mirrors OK"
  node scripts/kb.mjs check >/dev/null && echo "root check OK"
  node scripts/kb.mjs check --root examples >/dev/null && echo "examples check OK"
  node scripts/build-web.mjs --root examples >/dev/null && echo "build-web OK"
  node --check web/app.js && echo "web js OK"
  echo "V2A GATE PASSED"'
rm -rf examples/web   # 清理生成物,勿留脏
git status --porcelain | grep -v '\.DS_Store' || echo "工作树干净"
```
Expected:测试全绿;各 OK;`V2A GATE PASSED`;工作树干净。

- [ ] **Step 6: Commit**

```bash
cd "$(git rev-parse --show-toplevel)"
git add package.json .gitignore README.md readme-en.md
git commit -m "docs+wire: build-web/dev scripts, ignore generated kb-data.js, README viz section"
```

---

## Self-Review

**1. 覆盖:** 可视化设计(零依赖 SVG、kernel 复用、隐私默认排除、fail-closed、只读、`file://` 可跑、typed-edge/visibility 过滤)全部落到 Task 1-3。参考实现的成熟形态被泛化,雅思专用部分(练习/进度/多类型)按 YAGNI 砍掉。

**2. Placeholder scan:** `build-web.mjs` 与测试给出逐字代码;UI 因是视觉产物,给出"参考实现 + 精确改造点 + 人工视觉验收 + 非交互 JS/数据冒烟",无 TODO/TBD。

**3. Type consistency:** `kb-data.js` 契约(`schema_version/built_at/manifest/nodes/edges/pages`,节点字段 `id/type/title/summary/tags/content_visibility`,边 `from/to/relation`)在 Global Constraints、`buildWebData`、测试、UI 改造点全一致。复用 kernel 导出名(`collectPages/validate/buildGraph/findMalformed/resolveRoot/SCHEMA_VERSION/TYPES`)与 kb.mjs 一致。生成物路径 `web/data/kb-data.js` 在脚本/gitignore/dev/README 一致。fail-closed 与隐私默认排除在脚本与 Task 1 Step 5 冒烟对齐。
```
