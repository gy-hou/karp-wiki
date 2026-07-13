import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPages, buildGraph } from '../scripts/kb.mjs';
import { buildWebData } from '../scripts/build-web.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const goodWiki = path.join(here, 'fixtures', 'good', 'wiki');
const examplesWiki = path.resolve(here, '..', 'examples', 'wiki');

test('buildWebData excludes private pages by default (good fixture is all private)', async () => {
  const pages = await collectPages(goodWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  assert.equal(data.nodes.length, 0);
  assert.equal(data.edges.length, 0);
  assert.equal(data.manifest.total, 0);
});

test('buildWebData includes private with --include-private', async () => {
  const pages = await collectPages(goodWiki);
  const data = buildWebData(pages, buildGraph(pages), { includePrivate: true });
  assert.equal(data.nodes.length, 5);
});

test('buildWebData on shareable examples yields nodes + typed edges', async () => {
  const pages = await collectPages(examplesWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  assert.equal(data.nodes.length, 5);
  assert.ok(data.edges.length > 0);
  const relations = new Set(data.edges.map((edge) => edge.relation));
  assert.ok(relations.has('derived_from') && relations.has('links_to'));
});

test('every edge references only included nodes (no leaked ids)', async () => {
  const pages = await collectPages(examplesWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  const ids = new Set(data.nodes.map((node) => node.id));
  for (const edge of data.edges) {
    assert.ok(ids.has(edge.from));
    assert.ok(ids.has(edge.to));
  }
});

test('shape and stable ordering', async () => {
  const pages = await collectPages(examplesWiki);
  const data = buildWebData(pages, buildGraph(pages), {});
  assert.equal(data.schema_version, 1);
  assert.equal(data.built_at, null);
  for (const key of ['manifest', 'nodes', 'edges', 'pages']) assert.ok(key in data);
  const ids = data.nodes.map((node) => node.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(Object.keys(data.manifest.counts), ['concept', 'entity', 'source', 'output']);
});
