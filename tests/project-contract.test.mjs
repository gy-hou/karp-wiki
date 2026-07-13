import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test('CLAUDE.md imports AGENTS.md on an exact standalone line', async () => {
  const lines = (await readFile(path.join(root, 'CLAUDE.md'), 'utf8')).split(/\r?\n/);
  assert.equal(
    lines.filter((line) => line === '@AGENTS.md').length,
    1,
    'CLAUDE.md must contain exactly one standalone @AGENTS.md import line',
  );
});

test('release gate checks the Claude import as an exact standalone line', async () => {
  const evaluation = await readFile(path.join(root, 'docs/eval/dual-agent-eval.md'), 'utf8');
  const importChecks = evaluation.split(/\r?\n/).filter((line) => (
    line.includes('grep') && line.includes('@AGENTS.md') && line.includes('CLAUDE.md')
  ));
  assert.ok(importChecks.length >= 2, `expected discovery and release import checks: ${importChecks.join('\n')}`);
  for (const importCheck of importChecks) {
    assert.match(importCheck, /grep -qx (?:'@AGENTS\.md'|"@AGENTS\.md") CLAUDE\.md/);
  }
});

test('template ignores local Obsidian state and generated data for nested KB roots', async () => {
  const gitignore = await readFile(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\*\*\/\.obsidian\/$/m);
  assert.match(gitignore, /^\*\*\/data\/generated\/$/m);
});

test('README tells users to open the example as a separate Obsidian vault', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /Obsidian/);
  assert.match(readme, /把 `examples\/` 单独作为 vault 打开/);
  assert.match(readme, /不要把整个模板仓库作为示例 vault/);
});

test('setup persists a machine-aware tool selection instead of only reporting probes', async () => {
  const config = JSON.parse(await readFile(path.join(root, '.karp-wiki/config.example.json'), 'utf8'));
  assert.deepEqual(Object.keys(config.tooling.selected), [
    'kernel',
    'search',
    'versioning',
    'image_ingest',
    'audio_ingest',
    'graph_view',
  ]);
  assert.equal(config.tooling.selected.audio_ingest, 'user-provided-transcript');

  const setupFlow = await readFile(
    path.join(root, 'skills/kb-setup/references/setup-flow.md'),
    'utf8',
  );
  const toolSelection = await readFile(
    path.join(root, 'skills/kb-setup/references/tool-selection.md'),
    'utf8',
  );
  assert.match(setupFlow, /config\.tooling\.inventory/);
  assert.match(setupFlow, /config\.tooling\.selected/);
  assert.match(setupFlow, /原子写入/);
  assert.match(toolSelection, /Agent 当前会话公开的工具清单/);
  assert.match(toolSelection, /本机配置/);
  assert.match(toolSelection, /Node\.js >=20/);
  assert.match(toolSelection, /未经用户明确许可不得安装/);
});
