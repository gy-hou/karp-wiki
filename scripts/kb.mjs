#!/usr/bin/env node
// karp-wiki deterministic kernel. Zero external deps. Node >= 20.
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const SCHEMA_VERSION = 1;
export const TYPES = ['concept', 'entity', 'source', 'output'];
const TYPE_SET = new Set(TYPES);
export const REQUIRED_FIELDS = [
  'schema_version', 'id', 'type', 'title', 'summary',
  'tags', 'source_ids', 'status', 'content_visibility', 'created_at', 'updated_at',
];
const MEDIA_TYPES = new Set(['text', 'image', 'audio']);
const STATUS_VALUES = new Set(['active', 'archived']);
const VISIBILITY_VALUES = new Set(['private', 'shareable']);
const STORAGE_MODES = new Set(['local-only', 'private-git', 'public-git']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SKIP_BASENAMES = new Set(['index.md', 'log.md']);

// Root order: --root > git toplevel > cwd with wiki/ > null.
export function resolveRoot(argvTail) {
  const i = argvTail.indexOf('--root');
  if (i !== -1) return argvTail[i + 1] ? path.resolve(argvTail[i + 1]) : null;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    // Git is optional for local-only KBs.
  }
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'wiki'))) return cwd;
  return null;
}

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === '[]') return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => parseScalar(part));
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return stripQuotes(trimmed);
}

export function parseFrontmatter(text, filePath) {
  const opening = /^---\r?\n/.exec(text);
  if (!opening) return null;
  const afterOpening = text.slice(opening[0].length);
  const closing = /^---\r?$/m.exec(afterOpening);
  if (!closing) throw new Error(`Unclosed frontmatter: ${filePath}`);
  const raw = afterOpening.slice(0, closing.index);
  const body = afterOpening.slice(closing.index + closing[0].length)
    .replace(/^\r?\n(?:\r?\n)?/, '');
  const frontmatter = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    frontmatter[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
  }
  return { frontmatter, body };
}

export function stripCodeBlocks(body) {
  const visibleLines = [];
  let fence = null;
  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
        fence = null;
      }
      continue;
    }

    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }
    visibleLines.push(line);
  }

  return visibleLines.join('\n')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '');
}

export function extractWikiLinks(body) {
  const clean = stripCodeBlocks(body);
  const links = [];
  const wikiLink = /\[\[([a-z0-9][a-z0-9-]*)\]\]/g;
  let match;
  while ((match = wikiLink.exec(clean)) !== null) links.push(match[1]);
  return links;
}

export function sha256File(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function isMissing(error) {
  return error?.code === 'ENOENT';
}

async function collectAllFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectAllFiles(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function collectMarkdown(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

export async function collectPages(wikiDir) {
  const files = (await collectMarkdown(wikiDir)).sort();
  const pages = [];
  for (const file of files) {
    if (SKIP_BASENAMES.has(path.basename(file))) continue;
    const text = await readFile(file, 'utf8');
    let parsed;
    try {
      parsed = parseFrontmatter(text, file);
    } catch {
      continue;
    }
    if (!parsed) continue;
    const fm = parsed.frontmatter;
    pages.push({
      file,
      basename: path.basename(file),
      id: fm.id,
      type: fm.type,
      title: fm.title,
      summary: fm.summary,
      tags: fm.tags,
      sourceIds: fm.source_ids,
      status: fm.status,
      contentVisibility: fm.content_visibility,
      mediaType: fm.media_type,
      rawPath: fm.raw_path,
      rawSha256: fm.raw_sha256,
      provenance: fm.provenance,
      query: fm.query,
      schemaVersion: fm.schema_version,
      body: parsed.body,
      frontmatter: fm,
      links: extractWikiLinks(parsed.body),
    });
  }
  return pages;
}

export async function findMalformed(wikiDir) {
  const files = (await collectMarkdown(wikiDir)).sort();
  const malformed = [];
  for (const file of files) {
    if (SKIP_BASENAMES.has(path.basename(file))) continue;
    const text = await readFile(file, 'utf8');
    try {
      if (parseFrontmatter(text, file) === null) malformed.push(file);
    } catch {
      malformed.push(file);
    }
  }
  return malformed;
}

function isWithin(parent, candidate) {
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

function hasValidId(page) {
  if (typeof page.id !== 'string' || !TYPE_SET.has(page.type)) return false;
  return new RegExp(`^${page.type}-[a-z0-9]+(?:-[a-z0-9]+)*$`).test(page.id);
}

export async function validate(pages, rootDir) {
  const errors = [];
  const add = (category, message) => errors.push({ category, message });
  const root = path.resolve(rootDir);
  const realRoot = await realpath(root);
  const ids = new Set();
  const sourceIds = new Set(pages.filter((page) => page.type === 'source').map((page) => page.id));
  const shaMap = new Map();

  for (const page of pages) {
    const relativeFile = path.relative(root, page.file);
    for (const field of REQUIRED_FIELDS) {
      const value = page.frontmatter[field];
      const missing = value === undefined || value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        ((field === 'source_ids' || field === 'tags') && !Array.isArray(value));
      if (missing) add('missing_field', `${relativeFile}: ${field}`);
    }
    if (page.frontmatter.schema_version !== undefined &&
        !Number.isInteger(page.frontmatter.schema_version)) {
      add('type_error', `${relativeFile}: schema_version must be an integer`);
    }
    for (const field of [
      'id', 'type', 'title', 'summary', 'status',
      'content_visibility', 'created_at', 'updated_at',
    ]) {
      const value = page.frontmatter[field];
      if (value !== undefined && typeof value !== 'string') {
        add('type_error', `${relativeFile}: ${field} must be a string`);
      }
    }
    if (page.frontmatter.subtype !== undefined && typeof page.frontmatter.subtype !== 'string') {
      add('type_error', `${relativeFile}: subtype must be a string`);
    }
    if (page.schemaVersion !== SCHEMA_VERSION) {
      add('schema_version', `${relativeFile}: expected ${SCHEMA_VERSION}, got ${page.schemaVersion}`);
    }
    if (!TYPE_SET.has(page.type)) add('invalid_type', `${relativeFile}: ${page.type}`);
    if (page.id !== undefined && !hasValidId(page)) add('invalid_id', `${relativeFile}: ${page.id}`);
    if (page.status !== undefined && !STATUS_VALUES.has(page.status)) {
      add('invalid_status', `${relativeFile}: ${page.status}`);
    }
    if (page.contentVisibility !== undefined && !VISIBILITY_VALUES.has(page.contentVisibility)) {
      add('invalid_visibility', `${relativeFile}: ${page.contentVisibility}`);
    }
    for (const field of ['created_at', 'updated_at']) {
      const value = page.frontmatter[field];
      if (value !== undefined && !DATE_RE.test(String(value))) {
        add('invalid_date', `${relativeFile}: ${field}=${value}`);
      }
    }
    if (page.tags !== undefined) {
      if (!Array.isArray(page.tags)) add('type_error', `${relativeFile}: tags must be an array`);
      else if (page.tags.some((tag) => typeof tag !== 'string')) {
        add('type_error', `${relativeFile}: tags elements must be strings`);
      }
    }
    if (page.sourceIds !== undefined) {
      if (!Array.isArray(page.sourceIds)) add('type_error', `${relativeFile}: source_ids must be an array`);
      else if (page.sourceIds.some((sourceId) => typeof sourceId !== 'string')) {
        add('type_error', `${relativeFile}: source_ids elements must be strings`);
      }
    }
    if (page.id && page.basename !== `${page.id}.md`) {
      add('filename', `${relativeFile}: expected ${page.id}.md`);
    }
    if (page.id) {
      if (ids.has(page.id)) add('duplicate_id', `${relativeFile}: ${page.id}`);
      else ids.add(page.id);
    }
    for (const sourceId of (Array.isArray(page.sourceIds) ? page.sourceIds : [])) {
      if (!sourceIds.has(sourceId)) add('broken_source_ref', `${relativeFile}: source_ids -> ${sourceId}`);
    }

    if (page.type === 'source') {
      for (const field of ['media_type', 'raw_path', 'raw_sha256']) {
        const value = page.frontmatter[field];
        if (value !== undefined && typeof value !== 'string') {
          add('type_error', `${relativeFile}: ${field} must be a string`);
        }
      }
      if (page.frontmatter.provenance !== undefined && typeof page.frontmatter.provenance !== 'string') {
        add('type_error', `${relativeFile}: provenance must be a string`);
      }
      if (!MEDIA_TYPES.has(page.mediaType)) add('media_type', `${relativeFile}: ${page.mediaType}`);
      if (page.mediaType === 'audio' && (!page.provenance || String(page.provenance).trim() === '')) {
        add('missing_field', `${relativeFile}: provenance (audio must declare transcript provenance)`);
      }
      if (typeof page.rawPath !== 'string' || page.rawPath.trim() === '') {
        add('raw_path', `${relativeFile}: missing raw_path`);
      } else if (path.isAbsolute(page.rawPath)) {
        add('path_escape', `${relativeFile}: raw_path must be relative to KB root -> ${page.rawPath}`);
      } else {
        const absoluteRaw = path.resolve(root, page.rawPath);
        if (!isWithin(root, absoluteRaw)) {
          add('path_escape', `${relativeFile}: raw_path escapes KB root -> ${page.rawPath}`);
        } else if (!isWithin(path.join(root, 'raw'), absoluteRaw) || absoluteRaw === path.join(root, 'raw')) {
          add('raw_path', `${relativeFile}: raw_path must be beneath raw/ -> ${page.rawPath}`);
        } else {
          try {
            const realRawRoot = await realpath(path.join(root, 'raw'));
            const realRaw = await realpath(absoluteRaw);
            if (!isWithin(realRoot, realRawRoot) || !isWithin(realRawRoot, realRaw)) {
              add('symlink_escape', `${relativeFile}: raw_path resolves outside KB root`);
            } else {
              const actual = sha256File(await readFile(realRaw));
              if (!page.rawSha256) add('raw_hash', `${relativeFile}: missing raw_sha256`);
              else if (page.rawSha256 !== actual) add('raw_hash', `${relativeFile}: raw_sha256 mismatch`);
              if (page.rawSha256) {
                if (shaMap.has(page.rawSha256)) {
                  add('duplicate_raw', `${shaMap.get(page.rawSha256)} <-> ${relativeFile}`);
                } else {
                  shaMap.set(page.rawSha256, relativeFile);
                }
              }
            }
          } catch (error) {
            if (isMissing(error)) add('raw_missing', `${relativeFile}: raw file not found ${page.rawPath}`);
            else throw error;
          }
        }
      }
    }

    if (page.type === 'output') {
      if (page.query !== undefined && page.query !== null && typeof page.query !== 'string') {
        add('type_error', `${relativeFile}: query must be a string`);
      }
      if (page.query === undefined || page.query === null ||
          (typeof page.query === 'string' && page.query.trim() === '')) {
        add('missing_field', `${relativeFile}: query`);
      }
    }
  }

  for (const page of pages) {
    for (const link of page.links) {
      if (!ids.has(link)) add('broken_link', `${path.relative(root, page.file)}: [[${link}]]`);
    }
  }
  return errors;
}

export function parseIndexIds(text) {
  const ids = [];
  const indexEntry = /^-\s+\[\[([a-z0-9][a-z0-9-]*)\]\]/gm;
  let match;
  while ((match = indexEntry.exec(text)) !== null) ids.push(match[1]);
  return ids;
}

export function indexCoverageErrors(pages, indexText) {
  const pageIds = new Set(pages.map((page) => page.id).filter(Boolean));
  const indexIds = new Set(parseIndexIds(indexText));
  const errors = [];
  for (const id of pageIds) {
    if (!indexIds.has(id)) errors.push({ category: 'index_missing', message: `index.md missing ${id}` });
  }
  for (const id of indexIds) {
    if (!pageIds.has(id)) errors.push({ category: 'index_stale', message: `index.md lists unknown ${id}` });
  }
  return errors;
}

export function visibilityErrors(pages, mode) {
  if (mode !== 'public-git') return [];
  return pages
    .filter((page) => page.contentVisibility === 'private')
    .map((page) => ({
      category: 'visibility_leak',
      message: `${page.id}: private page not allowed in public-git mode (set content_visibility: shareable or use a private KB)`,
    }));
}

export async function pendingRaw(root) {
  const pages = await collectPages(path.join(root, 'wiki'));
  const recorded = new Set(
    pages
      .filter((page) => page.type === 'source' && page.rawSha256)
      .map((page) => page.rawSha256),
  );
  const files = await collectAllFiles(path.join(root, 'raw'));
  const pending = [];
  for (const file of files.sort()) {
    if (path.basename(file) === '.gitkeep') continue;
    const sha256 = sha256File(await readFile(file));
    if (!recorded.has(sha256)) {
      pending.push({ path: path.relative(root, file), sha256 });
    }
  }
  return pending.sort((left, right) => left.path.localeCompare(right.path));
}

const TYPE_TITLES = { concept: 'Concepts', entity: 'Entities', source: 'Sources', output: 'Outputs' };

export function buildIndex(pages) {
  const lines = [
    '# 知识库索引', '',
    '> 本文件由 `node scripts/kb.mjs reindex` 生成,请勿手工编辑。',
    '> 每页一行:`- [[id]] — summary`。', '',
  ];
  for (const type of TYPES) {
    lines.push(`## ${TYPE_TITLES[type]}`, '');
    const group = pages.filter((page) => page.type === type).sort((a, b) => {
      const aId = String(a.id);
      const bId = String(b.id);
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
    for (const page of group) lines.push(`- [[${page.id}]] — ${page.summary}`);
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

export function buildGraph(pages) {
  const nodes = pages
    .filter((page) => page.id)
    .map((page) => ({ id: page.id, type: page.type, title: page.title }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const seen = new Set();
  const edges = [];
  const push = (from, to, relation) => {
    if (!from || !to) return;
    const key = `${from}|${to}|${relation}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, relation });
  };
  for (const page of pages) {
    for (const sourceId of (Array.isArray(page.sourceIds) ? page.sourceIds : [])) {
      push(page.id, sourceId, 'derived_from');
    }
    for (const link of page.links) push(page.id, link, 'links_to');
  }
  edges.sort((left, right) => {
    for (const field of ['from', 'to', 'relation']) {
      if (left[field] < right[field]) return -1;
      if (left[field] > right[field]) return 1;
    }
    return 0;
  });
  return { schema_version: SCHEMA_VERSION, nodes, edges };
}

async function cmdReindex(root) {
  const pages = await collectPages(path.join(root, 'wiki'));
  await writeFile(path.join(root, 'wiki', 'index.md'), buildIndex(pages), 'utf8');
  console.log(`✓ reindex: ${pages.length} page(s) -> wiki/index.md`);
}

async function cmdBuildGraph(root) {
  const wikiDir = path.join(root, 'wiki');
  const pages = await collectPages(wikiDir);
  const errors = await validate(pages, root);
  for (const file of await findMalformed(wikiDir)) {
    errors.push({ category: 'no_frontmatter', message: path.relative(root, file) });
  }
  errors.push(...visibilityErrors(pages, await readConfigMode(root)));
  if (errors.length) {
    printErrors(errors);
    console.error(`\n✗ build-graph aborted (fail-closed): ${errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }
  const graph = buildGraph(pages);
  const outDir = path.join(root, 'data', 'generated');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  console.log(`✓ build-graph: ${graph.nodes.length} node(s), ${graph.edges.length} edge(s) -> data/generated/graph.json`);
}

async function readConfigMode(root) {
  try {
    const config = JSON.parse(await readFile(path.join(root, '.karp-wiki', 'config.json'), 'utf8'));
    const mode = config?.storage?.mode;
    if (!STORAGE_MODES.has(mode)) throw new Error(`Invalid storage mode: ${mode}`);
    return mode;
  } catch (error) {
    if (isMissing(error)) return 'local-only';
    throw error;
  }
}

function printErrors(errors) {
  const byCategory = {};
  for (const error of errors) (byCategory[error.category] ??= []).push(error.message);
  for (const [category, messages] of Object.entries(byCategory)) {
    console.error(`\n${category} (${messages.length}):`);
    for (const message of messages) console.error(`  - ${message}`);
  }
}

async function readIndex(wikiDir) {
  try {
    return await readFile(path.join(wikiDir, 'index.md'), 'utf8');
  } catch (error) {
    if (isMissing(error)) return '';
    throw error;
  }
}

async function cmdCheck(root) {
  const wikiDir = path.join(root, 'wiki');
  const pages = await collectPages(wikiDir);
  const errors = await validate(pages, root);
  for (const file of await findMalformed(wikiDir)) {
    errors.push({ category: 'no_frontmatter', message: path.relative(root, file) });
  }
  errors.push(...indexCoverageErrors(pages, await readIndex(wikiDir)));
  errors.push(...visibilityErrors(pages, await readConfigMode(root)));
  if (errors.length) {
    printErrors(errors);
    console.error(`\n✗ check failed: ${errors.length} error(s) across ${pages.length} page(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ check passed: ${pages.length} page(s)`);
}

async function cmdPending(root) {
  const pending = await pendingRaw(root);
  for (const item of pending) console.log(item.path);
  console.error(`${pending.length} pending raw file(s)`);
}

async function assertKb(root) {
  try {
    const wiki = await stat(path.join(root, 'wiki'));
    if (!wiki.isDirectory()) throw new Error(`wiki/ is not a directory at KB root: ${root}`);
  } catch (error) {
    if (isMissing(error)) throw new Error(`No wiki/ found at KB root: ${root}`);
    throw error;
  }
}

const COMMANDS = {
  check: cmdCheck,
  reindex: cmdReindex,
  'build-graph': cmdBuildGraph,
  pending: cmdPending,
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const command = process.argv[2];
  const root = resolveRoot(process.argv.slice(3));
  const commandFn = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!commandFn) {
    console.error('Usage: node scripts/kb.mjs <check|reindex|build-graph|pending> [--root <dir>]');
    process.exitCode = 2;
  } else if (!root) {
    console.error('Cannot determine KB root: run inside a git repo or pass --root <dir>.');
    process.exitCode = 2;
  } else {
    assertKb(root)
      .then(() => commandFn(root))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
