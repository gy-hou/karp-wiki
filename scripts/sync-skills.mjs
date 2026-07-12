#!/usr/bin/env node
// Generate byte-identical discovery mirrors of the canonical kb-setup skill.
import { lstat, readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
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

function compareCodePoints(left, right) {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function fsError(action, target, error) {
  const code = error.code ? `${error.code}: ` : '';
  return new Error(`${action} ${target}: ${code}${error.message}`, { cause: error });
}

async function walk(
  dir,
  { missingIsEmpty = false, includeNonRegular = false, context = 'directory' } = {},
) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (missingIsEmpty && error.code === 'ENOENT') return [];
    throw fsError(`Cannot read ${context}`, dir, error);
  }

  const out = [];
  for (const entry of entries.sort((a, b) => compareCodePoints(a.name, b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walk(full, { includeNonRegular, context }));
    } else if (entry.isFile() || includeNonRegular) {
      out.push(full);
    }
  }
  return out;
}

export async function syncSkills({ root, check = false } = {}) {
  if (!root) {
    root = repoRoot();
    if (!root) throw new Error('Cannot determine repo root; pass { root }.');
  }

  const srcDir = path.join(root, CANONICAL);
  const srcFiles = (await walk(srcDir, {
    missingIsEmpty: true,
    context: 'canonical directory',
  })).sort(compareCodePoints);
  if (srcFiles.length === 0) {
    throw new Error(`canonical skill is missing or empty: ${CANONICAL}`);
  }

  const drift = [];
  const mirrors = MIRRORS.map((mirror) => path.join(root, mirror));
  const srcRel = srcFiles.map((file) => path.relative(srcDir, file)).sort(compareCodePoints);

  for (const mirrorAbs of mirrors) {
    if (!check) await rm(mirrorAbs, { recursive: true, force: true });

    let mirrorStat = null;
    if (check) {
      try {
        mirrorStat = await lstat(mirrorAbs);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw fsError('Cannot inspect mirror root', mirrorAbs, error);
        }
      }
      if (mirrorStat && !mirrorStat.isDirectory()) {
        const kind = mirrorStat.isSymbolicLink() ? 'symlink' : 'not a directory';
        drift.push(`${path.relative(root, mirrorAbs)}: ${kind}`);
        continue;
      }
    }

    for (const srcFile of srcFiles) {
      const rel = path.relative(srcDir, srcFile);
      const destFile = path.join(mirrorAbs, rel);
      const srcBuf = await readFile(srcFile);

      if (check) {
        let destStat;
        try {
          destStat = await lstat(destFile);
        } catch (error) {
          if (error.code === 'ENOENT') {
            drift.push(`${path.relative(root, destFile)}: missing`);
            continue;
          }
          throw fsError('Cannot inspect mirror entry', destFile, error);
        }
        if (!destStat.isFile()) {
          const kind = destStat.isSymbolicLink() ? 'symlink' : 'not a regular file';
          drift.push(`${path.relative(root, destFile)}: ${kind}`);
          continue;
        }

        let destBuf;
        try {
          destBuf = await readFile(destFile);
        } catch (error) {
          throw fsError('Cannot read mirror entry', destFile, error);
        }
        if (!srcBuf.equals(destBuf)) {
          drift.push(`${path.relative(root, destFile)}: differs`);
        }
      } else {
        await mkdir(path.dirname(destFile), { recursive: true });
        await writeFile(destFile, srcBuf);
      }
    }

    if (check && mirrorStat) {
      const mirrorEntries = await walk(mirrorAbs, {
        includeNonRegular: true,
        context: 'mirror directory',
      });
      for (const file of mirrorEntries.sort(compareCodePoints)) {
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
