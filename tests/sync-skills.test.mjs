import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { syncSkills } from '../scripts/sync-skills.mjs';
import { withTmpDir, writeTree } from './helpers/tmp.mjs';

const CANON = {
  'skills/kb-setup/SKILL.md': '---\nname: kb-setup\ndescription: d\n---\nbody\n',
  'skills/kb-setup/references/schema.md': '# schema\n',
};

test('write then --check reports no drift (temp dir only)', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      ...CANON,
      'skills/kb-setup/.DS_Store': 'NON-SKILL METADATA',
    });
    await syncSkills({ root, check: false });
    const { drift, sourceFileCount } = await syncSkills({ root, check: true });
    assert.deepEqual(drift, []);
    assert.equal(sourceFileCount, 2);
    await assert.rejects(
      () => readFile(path.join(root, '.claude/skills/kb-setup/.DS_Store')),
      { code: 'ENOENT' },
    );
    await assert.rejects(
      () => readFile(path.join(root, '.agents/skills/kb-setup/.DS_Store')),
      { code: 'ENOENT' },
    );
  });
});

test('targets both discovery mirrors', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, CANON);
    const { mirrors } = await syncSkills({ root, check: false });
    assert.ok(mirrors.some((mirror) => mirror.includes(path.join('.claude', 'skills', 'kb-setup'))));
    assert.ok(mirrors.some((mirror) => mirror.includes(path.join('.agents', 'skills', 'kb-setup'))));
  });
});

test('--check DETECTS a deliberately corrupted mirror (does not self-heal)', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, CANON);
    await syncSkills({ root, check: false });
    const tamperedFile = path.join(root, '.claude/skills/kb-setup/SKILL.md');
    await writeFile(tamperedFile, 'TAMPERED\n');

    const { drift } = await syncSkills({ root, check: true });

    assert.ok(drift.some((entry) => entry.includes('SKILL.md')));
    assert.equal(await readFile(tamperedFile, 'utf8'), 'TAMPERED\n');
  });
});

test('empty/missing canonical throws (never wipes mirrors then reports success)', async () => {
  const sentinels = {
    '.claude/skills/kb-setup/sentinel.txt': 'CLAUDE SENTINEL\n',
    '.agents/skills/kb-setup/sentinel.txt': 'AGENTS SENTINEL\n',
  };

  const assertSentinelsUnchanged = async (root) => {
    assert.equal(
      await readFile(path.join(root, '.claude/skills/kb-setup/sentinel.txt'), 'utf8'),
      sentinels['.claude/skills/kb-setup/sentinel.txt'],
    );
    assert.equal(
      await readFile(path.join(root, '.agents/skills/kb-setup/sentinel.txt'), 'utf8'),
      sentinels['.agents/skills/kb-setup/sentinel.txt'],
    );
  };

  await withTmpDir(async (root) => {
    await writeTree(root, sentinels);
    await assert.rejects(() => syncSkills({ root, check: false }), /canonical/i);
    await assertSentinelsUnchanged(root);
  });

  await withTmpDir(async (root) => {
    await writeTree(root, sentinels);
    await mkdir(path.join(root, 'skills/kb-setup'), { recursive: true });
    await assert.rejects(() => syncSkills({ root, check: false }), /canonical/i);
    await assertSentinelsUnchanged(root);
  });
});
