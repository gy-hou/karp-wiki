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
  assert.match(evaluation, /grep -qx '@AGENTS\.md' CLAUDE\.md/);
});
