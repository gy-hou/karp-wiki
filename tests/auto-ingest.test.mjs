import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTmpDir } from './helpers/tmp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sh = path.join(root, 'scripts', 'auto-ingest.sh');
const fixture = path.join(root, 'tests', 'fixtures', 'pending');
const run = (args) => execFileSync('bash', [sh, ...args], { encoding: 'utf8' });
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' });

test('--dry-run on pending fixture lists pending and plans a branch, no agent or commit', () => {
  const output = run(['--agent', 'codex', '--root', fixture, '--dry-run']);
  assert.match(output, /raw\/text\/orphan\.md/);
  assert.match(output, /auto\/ingest-/);
  assert.match(output, /DRY-RUN/);
});

test('rejects an unknown agent', () => {
  assert.throws(() => run(['--agent', 'gpt5', '--root', fixture, '--dry-run']));
});

test('refuses a non-master or dirty worktree before invoking an agent', async () => {
  await withTmpDir(async (kbRoot) => {
    await mkdir(path.join(kbRoot, 'wiki'), { recursive: true });
    await mkdir(path.join(kbRoot, 'raw', 'text'), { recursive: true });
    await writeFile(path.join(kbRoot, 'wiki', 'index.md'), '');
    await writeFile(path.join(kbRoot, 'raw', 'text', '.gitkeep'), '');
    git(['init', '-q', '-b', 'master'], kbRoot);
    git(['add', '.'], kbRoot);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], kbRoot);

    git(['checkout', '-qb', 'work'], kbRoot);
    assert.match(run(['--agent', 'codex', '--root', kbRoot]), /abort: not on master/);

    git(['checkout', '-q', 'master'], kbRoot);
    await writeFile(path.join(kbRoot, 'scratch.md'), 'dirty\n');
    assert.match(run(['--agent', 'codex', '--root', kbRoot]), /abort: working tree dirty/);
    assert.equal(git(['branch', '--show-current'], kbRoot).trim(), 'master');
  });
});
