#!/usr/bin/env node
// Build a static, shareable-by-default web data blob from the KB. Zero deps. Node >= 20.
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectPages,
  validate,
  buildGraph,
  findMalformed,
  resolveRoot,
  SCHEMA_VERSION,
  TYPES,
} from './kb.mjs';

export function buildWebData(pages, graph, { includePrivate = false } = {}) {
  const visible = includePrivate
    ? pages
    : pages.filter((page) => page.contentVisibility !== 'private');
  const ids = new Set(visible.map((page) => page.id));
  const byId = (left, right) => String(left.id).localeCompare(String(right.id));
  const nodes = visible
    .map((page) => ({
      id: page.id,
      type: page.type,
      title: page.title,
      summary: page.summary,
      tags: page.tags,
      content_visibility: page.contentVisibility,
    }))
    .sort(byId);
  const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
  const pagesOut = visible
    .map((page) => ({
      id: page.id,
      type: page.type,
      title: page.title,
      summary: page.summary,
      tags: page.tags,
      file: path.basename(page.file),
    }))
    .sort(byId);
  const counts = Object.fromEntries(
    TYPES.map((type) => [type, visible.filter((page) => page.type === type).length]),
  );

  return {
    schema_version: SCHEMA_VERSION,
    built_at: null,
    manifest: { total: visible.length, counts },
    nodes,
    edges,
    pages: pagesOut,
  };
}

function printErrors(errors) {
  const byCategory = {};
  for (const error of errors) (byCategory[error.category] ??= []).push(error.message);
  for (const [category, messages] of Object.entries(byCategory)) {
    console.error(`\n${category} (${messages.length}):`);
    for (const message of messages) console.error(`  - ${message}`);
  }
}

async function assertWikiDirectory(root) {
  const wiki = await stat(path.join(root, 'wiki'));
  if (!wiki.isDirectory()) throw new Error(`wiki/ is not a directory at KB root: ${root}`);
}

async function cmdBuild(root, { includePrivate }) {
  await assertWikiDirectory(root);
  const wikiDir = path.join(root, 'wiki');
  const pages = await collectPages(wikiDir);
  const errors = await validate(pages, root);
  for (const file of await findMalformed(wikiDir)) {
    errors.push({ category: 'no_frontmatter', message: path.relative(root, file) });
  }

  if (errors.length) {
    printErrors(errors);
    console.error(`\n✗ build-web aborted (fail-closed): ${errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }

  const data = buildWebData(pages, buildGraph(pages), { includePrivate });
  data.built_at = new Date().toISOString();
  const outDir = path.join(root, 'web', 'data');
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'kb-data.js'),
    `window.KB_DATA = ${JSON.stringify(data, null, 2)};\n`,
    'utf8',
  );
  const privateLabel = includePrivate ? ' (incl. private)' : '';
  console.log(
    `✓ build-web: ${data.nodes.length} node(s), ${data.edges.length} edge(s)${privateLabel} -> web/data/kb-data.js`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const root = resolveRoot(argv);
  if (!root) {
    console.error('Cannot determine KB root: run inside a git repo or pass --root <dir>.');
    process.exitCode = 2;
  } else {
    cmdBuild(root, { includePrivate: argv.includes('--include-private') }).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
