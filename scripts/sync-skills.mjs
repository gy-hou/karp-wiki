#!/usr/bin/env node
// Generate byte-identical discovery mirrors of the canonical kb-setup skill.
import { lstat, readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const MIRROR_COMPONENTS = [
  ['.claude', 'skills', 'kb-setup'],
  ['.agents', 'skills', 'kb-setup'],
];
const CANONICAL_COMPONENTS = ['skills', 'kb-setup'];

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

function componentPath(components) {
  return path.join(...components);
}

async function inspectDirectoryPath(root, components, context) {
  const relativePath = componentPath(components);
  const absolutePath = path.join(root, relativePath);
  let current = root;
  for (const component of components) {
    current = path.join(current, component);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') return { absolutePath, exists: false, issue: null };
      throw fsError(`Cannot inspect ${context} path component`, current, error);
    }
    if (stat.isSymbolicLink()) {
      return {
        absolutePath,
        exists: true,
        issue: { kind: 'symlink', relativePath: path.relative(root, current) },
      };
    }
    if (!stat.isDirectory()) {
      return {
        absolutePath,
        exists: true,
        issue: { kind: 'not a directory', relativePath: path.relative(root, current) },
      };
    }
  }
  return { absolutePath, exists: true, issue: null };
}

function entryType(stat) {
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  if (stat.isSymbolicLink()) return 'symlink';
  return 'non-regular';
}

async function buildEntryMap(rootDir, context) {
  const entryMap = new Map();

  async function visit(directory, parentRelative = '') {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw fsError(`Cannot read ${context} directory`, directory, error);
    }

    for (const entry of entries.sort((left, right) => compareCodePoints(left.name, right.name))) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = parentRelative
        ? path.join(parentRelative, entry.name)
        : entry.name;
      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch (error) {
        throw fsError(`Cannot inspect ${context} entry`, absolutePath, error);
      }
      const type = entryType(stat);
      entryMap.set(relativePath, { absolutePath, type });
      if (type === 'directory') await visit(absolutePath, relativePath);
    }
  }

  await visit(rootDir);
  return entryMap;
}

function sortedEntries(entryMap) {
  return [...entryMap.entries()].sort(([left], [right]) => compareCodePoints(left, right));
}

function driftKind(type, expectedType) {
  if (type === 'symlink') return 'symlink';
  return expectedType === 'directory' ? 'not a directory' : 'not a regular file';
}

function expectedMirrorEntries(sourceFiles) {
  const expected = new Map();
  for (const sourceFile of sourceFiles) {
    let parent = path.dirname(sourceFile.relativePath);
    while (parent !== '.') {
      expected.set(parent, { type: 'directory' });
      parent = path.dirname(parent);
    }
    expected.set(sourceFile.relativePath, { type: 'file' });
  }
  return sortedEntries(expected);
}

export async function syncSkills({ root, check = false } = {}) {
  if (!root) {
    root = repoRoot();
    if (!root) throw new Error('Cannot determine repo root; pass { root }.');
  }
  root = path.resolve(root);

  const canonicalRelative = componentPath(CANONICAL_COMPONENTS);
  const canonicalState = await inspectDirectoryPath(root, CANONICAL_COMPONENTS, 'canonical');
  if (canonicalState.issue) {
    throw new Error(
      `canonical path component is ${canonicalState.issue.kind}: ${canonicalState.issue.relativePath}`,
    );
  }
  if (!canonicalState.exists) {
    throw new Error(`canonical skill is missing or empty: ${canonicalRelative}`);
  }

  const canonicalEntries = await buildEntryMap(canonicalState.absolutePath, 'canonical');
  for (const [relativePath, entry] of sortedEntries(canonicalEntries)) {
    if (entry.type !== 'directory' && entry.type !== 'file') {
      throw new Error(`canonical entry ${path.join(canonicalRelative, relativePath)} is ${entry.type}`);
    }
  }
  if (canonicalEntries.get('SKILL.md')?.type !== 'file') {
    throw new Error(`canonical SKILL.md must be a regular file: ${path.join(canonicalRelative, 'SKILL.md')}`);
  }

  const sourceFiles = [];
  for (const [relativePath, entry] of sortedEntries(canonicalEntries)) {
    if (entry.type !== 'file') continue;
    let content;
    try {
      content = await readFile(entry.absolutePath);
    } catch (error) {
      throw fsError('Cannot read canonical file', entry.absolutePath, error);
    }
    sourceFiles.push({ relativePath, content });
  }
  if (sourceFiles.length === 0) {
    throw new Error(`canonical skill is missing or empty: ${canonicalRelative}`);
  }

  const drift = [];
  const mirrorRelatives = MIRROR_COMPONENTS.map(componentPath);
  const mirrors = mirrorRelatives.map((mirror) => path.join(root, mirror));
  const mirrorStates = [];
  for (const mirrorComponents of MIRROR_COMPONENTS) {
    mirrorStates.push(await inspectDirectoryPath(root, mirrorComponents, 'mirror'));
  }

  if (!check) {
    const invalidMirror = mirrorStates.find((state) => state.issue);
    if (invalidMirror) {
      throw new Error(
        `mirror path component is ${invalidMirror.issue.kind}: ${invalidMirror.issue.relativePath}`,
      );
    }

    for (const mirrorAbs of mirrors) {
      await rm(mirrorAbs, { recursive: true, force: true });
      for (const sourceFile of sourceFiles) {
        const destFile = path.join(mirrorAbs, sourceFile.relativePath);
        await mkdir(path.dirname(destFile), { recursive: true });
        await writeFile(destFile, sourceFile.content);
      }
    }
    return { mirrors, drift, sourceFileCount: sourceFiles.length };
  }

  const expectedEntries = expectedMirrorEntries(sourceFiles);
  const expectedPaths = new Set(expectedEntries.map(([relativePath]) => relativePath));
  const sourceFilesByPath = new Map(sourceFiles.map((file) => [file.relativePath, file]));

  for (let index = 0; index < mirrors.length; index += 1) {
    const mirrorAbs = mirrors[index];
    const mirrorState = mirrorStates[index];
    const mirrorRelative = mirrorRelatives[index];
    if (mirrorState.issue) {
      drift.push(`${mirrorState.issue.relativePath}: ${mirrorState.issue.kind}`);
      continue;
    }

    const mirrorEntries = mirrorState.exists
      ? await buildEntryMap(mirrorAbs, 'mirror')
      : new Map();
    for (const [relativePath, expectedEntry] of expectedEntries) {
      const displayPath = path.join(mirrorRelative, relativePath);
      const mirrorEntry = mirrorEntries.get(relativePath);
      if (!mirrorEntry) {
        drift.push(`${displayPath}: missing`);
        continue;
      }
      if (mirrorEntry.type !== expectedEntry.type) {
        drift.push(`${displayPath}: ${driftKind(mirrorEntry.type, expectedEntry.type)}`);
        continue;
      }
      if (expectedEntry.type === 'file') {
        let destBuf;
        try {
          destBuf = await readFile(mirrorEntry.absolutePath);
        } catch (error) {
          throw fsError('Cannot read mirror entry', mirrorEntry.absolutePath, error);
        }
        const sourceFile = sourceFilesByPath.get(relativePath);
        if (!sourceFile.content.equals(destBuf)) {
          drift.push(`${displayPath}: differs`);
        }
      }
    }

    for (const [relativePath, entry] of sortedEntries(mirrorEntries)) {
      if (!expectedPaths.has(relativePath) && entry.type !== 'directory') {
        drift.push(`${path.join(mirrorRelative, relativePath)}: extra`);
      }
    }
  }

  return { mirrors, drift, sourceFileCount: sourceFiles.length };
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
      console.log(`✓ synced ${sourceFileCount} files to ${MIRROR_COMPONENTS.map(componentPath).join(', ')}`);
    }
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
