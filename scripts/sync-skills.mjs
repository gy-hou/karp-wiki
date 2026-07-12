#!/usr/bin/env node
// Generate byte-identical discovery mirrors of the canonical kb-setup skill.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const MIRRORS = ['.claude/skills/kb-setup', '.agents/skills/kb-setup'];
const CANONICAL = 'skills/kb-setup';

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

export async function syncSkills({ root, check = false } = {}) {
  if (!root) {
    root = repoRoot();
    if (!root) throw new Error('Cannot determine repo root; pass { root }.');
  }

  const srcDir = path.join(root, CANONICAL);
  const srcFiles = (await walk(srcDir)).sort();
  if (srcFiles.length === 0) {
    throw new Error(`canonical skill is missing or empty: ${CANONICAL}`);
  }

  const drift = [];
  const mirrors = MIRRORS.map((mirror) => path.join(root, mirror));
  const srcRel = srcFiles.map((file) => path.relative(srcDir, file)).sort();

  for (const mirrorAbs of mirrors) {
    if (!check) await rm(mirrorAbs, { recursive: true, force: true });

    for (const srcFile of srcFiles) {
      const rel = path.relative(srcDir, srcFile);
      const destFile = path.join(mirrorAbs, rel);
      const srcBuf = await readFile(srcFile);

      if (check) {
        let destBuf;
        try {
          destBuf = await readFile(destFile);
        } catch {
          drift.push(`${path.relative(root, destFile)}: missing`);
          continue;
        }
        if (!srcBuf.equals(destBuf)) {
          drift.push(`${path.relative(root, destFile)}: differs`);
        }
      } else {
        await mkdir(path.dirname(destFile), { recursive: true });
        await writeFile(destFile, srcBuf);
      }
    }

    if (check) {
      for (const file of await walk(mirrorAbs)) {
        const rel = path.relative(mirrorAbs, file);
        if (!srcRel.includes(rel)) {
          drift.push(`${path.join(path.relative(root, mirrorAbs), rel)}: extra`);
        }
      }
    }
  }

  return { mirrors, drift, sourceFileCount: srcFiles.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const check = process.argv.includes('--check');
  syncSkills({ check }).then(({ drift, sourceFileCount }) => {
    if (check) {
      if (drift.length) {
        console.error('✗ skill mirrors out of sync:');
        for (const entry of drift) console.error(`  - ${entry}`);
        console.error('Run `npm run sync-skills` to regenerate.');
        process.exitCode = 1;
      } else {
        console.log(`✓ skill mirrors in sync (${sourceFileCount} files)`);
      }
    } else {
      console.log(`✓ synced ${sourceFileCount} files to ${MIRRORS.join(', ')}`);
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
