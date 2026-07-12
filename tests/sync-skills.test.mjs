import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { syncSkills } from '../scripts/sync-skills.mjs';
import { withTmpDir, writeTree } from './helpers/tmp.mjs';

const CANON = {
  'skills/kb-setup/SKILL.md': '---\nname: kb-setup\ndescription: d\n---\nbody\n',
  'skills/kb-setup/references/schema.md': '# schema\n',
};

test('write/check mirrors every regular file and reports stable missing/extra drift', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      ...CANON,
      'skills/kb-setup/.DS_Store': 'REGULAR FILE METADATA',
    });
    const writeResult = await syncSkills({ root, check: false });
    const { drift, sourceFileCount } = await syncSkills({ root, check: true });
    assert.deepEqual(drift, []);
    assert.equal(writeResult.sourceFileCount, 3);
    assert.equal(sourceFileCount, 3);
    assert.equal(
      await readFile(path.join(root, '.claude/skills/kb-setup/.DS_Store'), 'utf8'),
      'REGULAR FILE METADATA',
    );
    assert.equal(
      await readFile(path.join(root, '.agents/skills/kb-setup/.DS_Store'), 'utf8'),
      'REGULAR FILE METADATA',
    );

    await rm(path.join(root, '.claude/skills/kb-setup/references/schema.md'));
    await writeTree(root, {
      '.claude/skills/kb-setup/references/z-extra.md': 'z\n',
      '.claude/skills/kb-setup/references/a-extra.md': 'a\n',
    });

    const driftResult = await syncSkills({ root, check: true });
    assert.deepEqual(driftResult.drift, [
      '.claude/skills/kb-setup/references/schema.md: missing',
      '.claude/skills/kb-setup/references/a-extra.md: extra',
      '.claude/skills/kb-setup/references/z-extra.md: extra',
    ]);
  });
});

test('targets both discovery mirrors', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, CANON);
    const { mirrors } = await syncSkills({ root, check: false });
    assert.ok(mirrors.some((mirror) => mirror.includes(path.join('.claude', 'skills', 'kb-setup'))));
    assert.ok(mirrors.some((mirror) => mirror.includes(path.join('.agents', 'skills', 'kb-setup'))));

    const agentsMirror = path.join(root, '.agents/skills/kb-setup');
    await rm(agentsMirror, { recursive: true });
    await symlink(path.join(root, 'skills/kb-setup'), agentsMirror);
    const { drift } = await syncSkills({ root, check: true });
    assert.deepEqual(drift, ['.agents/skills/kb-setup: symlink']);
  });
});

test('--check DETECTS a deliberately corrupted mirror (does not self-heal)', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, CANON);
    await syncSkills({ root, check: false });
    const tamperedFile = path.join(root, '.claude/skills/kb-setup/SKILL.md');
    await writeFile(tamperedFile, 'TAMPERED\n');
    const expectedSymlink = path.join(root, '.agents/skills/kb-setup/SKILL.md');
    await rm(expectedSymlink);
    await symlink(path.join(root, 'skills/kb-setup/SKILL.md'), expectedSymlink);
    const outsideDir = path.join(root, 'outside');
    await writeTree(outsideDir, { 'must-not-be-traversed.txt': 'outside\n' });
    const extraSymlink = path.join(root, '.agents/skills/kb-setup/linked-extra');
    await symlink(outsideDir, extraSymlink);

    const { drift } = await syncSkills({ root, check: true });

    assert.ok(drift.some((entry) => entry.includes('SKILL.md')));
    assert.ok(drift.includes('.agents/skills/kb-setup/SKILL.md: symlink'));
    assert.ok(drift.includes('.agents/skills/kb-setup/linked-extra: extra'));
    assert.ok(!drift.some((entry) => entry.includes('must-not-be-traversed.txt')));
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

  await withTmpDir(async (root) => {
    await writeTree(root, {
      ...sentinels,
      'skills/kb-setup/SKILL.md': CANON['skills/kb-setup/SKILL.md'],
    });
    const unreadableDir = path.join(root, 'skills/kb-setup/references/no-access');
    await mkdir(unreadableDir, { recursive: true });
    await chmod(unreadableDir, 0o000);
    try {
      await assert.rejects(
        () => syncSkills({ root, check: false }),
        /no-access.*(?:EACCES|permission denied)/i,
      );
      await assertSentinelsUnchanged(root);
    } finally {
      await chmod(unreadableDir, 0o700);
    }
  });
});
