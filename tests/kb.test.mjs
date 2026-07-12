import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFrontmatter, extractWikiLinks, resolveRoot,
  collectPages, findMalformed, validate, parseIndexIds, indexCoverageErrors, visibilityErrors, sha256File,
} from '../scripts/kb.mjs';
import * as kb from '../scripts/kb.mjs';
import { withTmpDir, writeTree } from './helpers/tmp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const kbCli = path.join(here, '..', 'scripts', 'kb.mjs');
const fx = (name) => path.join(here, 'fixtures', name);
const errsOf = async (name) => validate(await collectPages(path.join(fx(name), 'wiki')), fx(name));
const cats = (errs) => new Set(errs.map((e) => e.category));
const runCheck = (root) => spawnSync(process.execPath, [kbCli, 'check', '--root', root], { encoding: 'utf8' });
const runBuildGraph = (root) => spawnSync(process.execPath, [kbCli, 'build-graph', '--root', root], { encoding: 'utf8' });
const graphOutput = (root) => path.join(root, 'data', 'generated', 'graph.json');
const edgeTuple = (edge) => [edge.from, edge.to, edge.relation];
const compareTuple = (left, right) => {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
};
const page = (frontmatter, body = 'body') => `---\n${frontmatter}\n---\n\n${body}\n`;
const conceptFrontmatter = (id) => `schema_version: 1
id: ${id}
type: concept
title: T
summary: s
tags: []
source_ids: []
status: active
content_visibility: private
created_at: "2026-07-11"
updated_at: "2026-07-11"`;

test('parseFrontmatter parses fields, arrays, body', () => {
  const { frontmatter, body } = parseFrontmatter('---\nid: a\ntags: [x, y]\n---\n\nhello', 'a.md');
  assert.equal(frontmatter.id, 'a');
  assert.deepEqual(frontmatter.tags, ['x', 'y']);
  assert.equal(body, 'hello');
});

test('parseFrontmatter throws on unclosed', () => {
  assert.throws(() => parseFrontmatter('---\nid: a\nno closing', 'a.md'));
});

test('extractWikiLinks ignores code blocks and inline code', () => {
  assert.deepEqual(extractWikiLinks('see [[concept-a]] not ```\n[[concept-b]]\n``` or `[[concept-c]]`'), ['concept-a']);
});

test('resolveRoot: --root takes precedence over git/cwd', () => {
  assert.equal(resolveRoot(['--root', '/tmp/x']), path.resolve('/tmp/x'));
});

test('good fixture: zero validate errors', async () => {
  const errs = await errsOf('good');
  assert.deepEqual(errs, [], JSON.stringify(errs, null, 2));
});

test('good fixture: no malformed files', async () => {
  assert.deepEqual(await findMalformed(path.join(fx('good'), 'wiki')), []);
});

test('bad-dup-id → duplicate_id', async () => {
  assert.ok(cats(await errsOf('bad-dup-id')).has('duplicate_id'));
});

test('bad-broken-link → broken_link', async () => {
  assert.ok(cats(await errsOf('bad-broken-link')).has('broken_link'));
});

test('bad-missing-raw → raw_missing', async () => {
  assert.ok(cats(await errsOf('bad-missing-raw')).has('raw_missing'));
});

test('bad-traversal → path_escape', async () => {
  assert.ok(cats(await errsOf('bad-traversal')).has('path_escape'));
});

test('bad-enum → invalid_status and invalid_visibility', async () => {
  const c = cats(await errsOf('bad-enum'));
  assert.ok(c.has('invalid_status') && c.has('invalid_visibility'));
});

test('bad-dup-sha → duplicate_raw', async () => {
  assert.ok(cats(await errsOf('bad-dup-sha')).has('duplicate_raw'));
});

test('bad-no-frontmatter → findMalformed non-empty', async () => {
  assert.ok((await findMalformed(path.join(fx('bad-no-frontmatter'), 'wiki'))).length > 0);
});

test('indexCoverageErrors flags page missing from index', () => {
  assert.ok(indexCoverageErrors([{ id: 'concept-a' }], '# index\n').some((e) => e.category === 'index_missing'));
});

test('visibilityErrors: public-git forbids private pages', () => {
  const pages = [{ id: 'c', contentVisibility: 'private' }, { id: 'd', contentVisibility: 'shareable' }];
  assert.equal(visibilityErrors(pages, 'public-git').length, 1);
  assert.equal(visibilityErrors(pages, 'local-only').length, 0);
});

test('validate rejects an ID without the matching type-prefixed kebab-case form', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/concepts/wrong.md': page(conceptFrontmatter('wrong')),
    });
    const errors = await validate(await collectPages(path.join(root, 'wiki')), root);
    assert.ok(cats(errors).has('invalid_id'));
  });
});

test('validate rejects a raw_path symlink that resolves outside the KB root', async () => {
  await withTmpDir(async (root) => {
    await withTmpDir(async (outside) => {
      await writeTree(root, {
        'wiki/sources/source-escape.md': page(`${conceptFrontmatter('source-escape')
          .replace('type: concept', 'type: source')}
media_type: text
raw_path: raw/text/link.md
raw_sha256: "0000000000000000000000000000000000000000000000000000000000000000"`),
      });
      await writeTree(outside, { 'secret.md': 'outside\n' });
      await mkdir(path.join(root, 'raw/text'), { recursive: true });
      await symlink(path.join(outside, 'secret.md'), path.join(root, 'raw/text/link.md'));

      const errors = await validate(await collectPages(path.join(root, 'wiki')), root);
      assert.ok(cats(errors).has('symlink_escape'));
    });
  });
});

test('review regression: parseFrontmatter requires a standalone closing delimiter', () => {
  assert.throws(() => parseFrontmatter('---\nid: concept-a\n---not-a-fence\nbody\n', 'concept-a.md'));
});

test('review regression: findMalformed flags a prefixed pseudo-fence', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/concepts/concept-a.md': '---\nid: concept-a\n---not-a-fence\nbody\n',
    });
    assert.deepEqual(await findMalformed(path.join(root, 'wiki')), [path.join(root, 'wiki/concepts/concept-a.md')]);
  });
});

test('review regression: inline arrays preserve numeric and boolean scalar types', () => {
  const parsed = parseFrontmatter('---\ntags: [learning, 7, false]\n---\n', 'types.md');
  assert.deepEqual(parsed.frontmatter.tags, ['learning', 7, false]);
});

test('review regression: validate rejects wrong common scalar field types', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/concepts/123.md': page(`schema_version: "1"
id: 123
type: false
subtype: 2
title: 3
summary: false
tags: []
source_ids: []
status: true
content_visibility: 4
created_at: false
updated_at: 5`),
    });
    const errors = await validate(await collectPages(path.join(root, 'wiki')), root);
    const messages = errors.filter((error) => error.category === 'type_error').map((error) => error.message);
    for (const field of [
      'schema_version', 'id', 'type', 'subtype', 'title', 'summary',
      'status', 'content_visibility', 'created_at', 'updated_at',
    ]) {
      assert.ok(messages.some((message) => message.includes(`: ${field}`)), `${field}: ${messages.join('\n')}`);
    }
  });
});

test('review regression: validate rejects non-string array elements', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/concepts/concept-array-types.md': page(`${conceptFrontmatter('concept-array-types')
        .replace('tags: []', 'tags: [learning, 7]')
        .replace('source_ids: []', 'source_ids: [source-a, false]')}`),
    });
    const errors = await validate(await collectPages(path.join(root, 'wiki')), root);
    const messages = errors.filter((error) => error.category === 'type_error').map((error) => error.message);
    assert.ok(messages.some((message) => message.includes(': tags')));
    assert.ok(messages.some((message) => message.includes(': source_ids')));
  });
});

test('review regression: validate rejects wrong source and output field types', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/sources/source-types.md': page(`${conceptFrontmatter('source-types')
        .replace('type: concept', 'type: source')}
media_type: 7
raw_path: false
raw_sha256: 9
provenance: true`),
      'wiki/outputs/output-types.md': page(`${conceptFrontmatter('output-types')
        .replace('type: concept', 'type: output')}
query: 7`),
    });
    const errors = await validate(await collectPages(path.join(root, 'wiki')), root);
    const messages = errors.filter((error) => error.category === 'type_error').map((error) => error.message);
    for (const field of ['media_type', 'raw_path', 'raw_sha256', 'provenance', 'query']) {
      assert.ok(messages.some((message) => message.includes(`: ${field}`)), `${field}: ${messages.join('\n')}`);
    }
  });
});

test('review regression: validate requires raw_path beneath the raw subtree', async () => {
  await withTmpDir(async (root) => {
    const content = 'in root but outside raw\n';
    await writeTree(root, {
      'published.txt': content,
      'wiki/sources/source-published.md': page(`${conceptFrontmatter('source-published')
        .replace('type: concept', 'type: source')}
media_type: text
raw_path: published.txt
raw_sha256: "${sha256File(Buffer.from(content))}"`),
    });
    const errors = await validate(await collectPages(path.join(root, 'wiki')), root);
    assert.ok(cats(errors).has('raw_path'), JSON.stringify(errors, null, 2));
  });
});

test('review regression: CLI rejects wiki when it is a regular file', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, { wiki: 'not a directory\n' });
    const result = runCheck(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
});

test('review regression: CLI rejects .karp-wiki when it is a regular file', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/index.md': '',
      '.karp-wiki': 'not a directory\n',
    });
    const result = runCheck(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
});

test('review regression: CLI rejects malformed config JSON', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/index.md': '',
      '.karp-wiki/config.json': '{not-json\n',
    });
    const result = runCheck(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
});

test('review regression: CLI rejects an unknown storage mode', async () => {
  await withTmpDir(async (root) => {
    await writeTree(root, {
      'wiki/concepts/concept-private.md': page(conceptFrontmatter('concept-private')),
      'wiki/index.md': '- [[concept-private]] — s\n',
      '.karp-wiki/config.json': '{"storage":{"mode":"publci-git"}}\n',
    });
    const result = runCheck(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
});

test('review regression: resolveRoot fails for --root without a value', () => {
  assert.equal(resolveRoot(['--root']), null);
});

test('buildIndex groups by frozen type order and is deterministic/idempotent', async () => {
  const pages = await collectPages(path.join(fx('good'), 'wiki'));
  const shuffled = [...pages].reverse();
  const once = kb.buildIndex(shuffled);
  assert.equal(once, kb.buildIndex(shuffled));
  assert.equal(once, kb.buildIndex(pages));
  assert.match(once, /- \[\[concept-spaced-repetition\]\] — /);

  const headings = ['## Concepts', '## Entities', '## Sources', '## Outputs'];
  const offsets = headings.map((heading) => once.indexOf(heading));
  assert.ok(offsets.every((offset) => offset !== -1), once);
  assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
  assert.ok(once.indexOf('- [[source-note]]') < once.indexOf('- [[source-shot]]'), once);
});

test('buildIndex round-trips through parseIndexIds to the full page set', async () => {
  const pages = await collectPages(path.join(fx('good'), 'wiki'));
  const ids = new Set(parseIndexIds(kb.buildIndex(pages)));
  assert.deepEqual(ids, new Set(pages.map((page) => page.id)));
});

test('reindex CLI is byte-idempotent on an isolated good fixture', async () => {
  await withTmpDir(async (root) => {
    const kbRoot = path.join(root, 'good');
    await cp(fx('good'), kbRoot, { recursive: true });

    const first = spawnSync(process.execPath, [kbCli, 'reindex', '--root', kbRoot], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const firstIndex = await readFile(path.join(kbRoot, 'wiki/index.md'));

    const second = spawnSync(process.execPath, [kbCli, 'reindex', '--root', kbRoot], { encoding: 'utf8' });
    assert.equal(second.status, 0, second.stdout + second.stderr);
    const secondIndex = await readFile(path.join(kbRoot, 'wiki/index.md'));

    assert.deepEqual(secondIndex, firstIndex);
  });
});

test('reindex CLI succeeds and writes an index for an invalid-but-parseable KB', async () => {
  await withTmpDir(async (root) => {
    const kbRoot = path.join(root, 'bad-broken-link');
    await cp(fx('bad-broken-link'), kbRoot, { recursive: true });

    const result = spawnSync(process.execPath, [kbCli, 'reindex', '--root', kbRoot], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(await readFile(path.join(kbRoot, 'wiki/index.md'), 'utf8'), /- \[\[concept-a\]\] — /);
  });
});

test('buildGraph emits exact nodes and typed, deduped, tuple-sorted edges', async () => {
  const pages = (await collectPages(path.join(fx('good'), 'wiki')))
    .reverse()
    .map((item) => ({
      ...item,
      sourceIds: Array.isArray(item.sourceIds) ? [...item.sourceIds, ...item.sourceIds] : item.sourceIds,
      links: [...item.links, ...item.links],
    }));

  assert.equal(typeof kb.buildGraph, 'function');
  const graph = kb.buildGraph(pages);
  assert.equal(graph.schema_version, 1);
  assert.deepEqual(graph.nodes.map((node) => node.id), [
    'concept-spaced-repetition',
    'entity-obsidian',
    'output-notes',
    'source-note',
    'source-shot',
  ]);
  for (const node of graph.nodes) assert.deepEqual(Object.keys(node), ['id', 'type', 'title']);

  const tuples = graph.edges.map(edgeTuple);
  assert.deepEqual(new Set(graph.edges.map((edge) => edge.relation)), new Set(['derived_from', 'links_to']));
  assert.equal(new Set(tuples.map((tuple) => JSON.stringify(tuple))).size, tuples.length);
  assert.deepEqual(tuples, [...tuples].sort(compareTuple));
  assert.equal(tuples.filter((tuple) => compareTuple(tuple, [
    'output-notes', 'source-note', 'derived_from',
  ]) === 0).length, 1);
});

test('buildGraph matches the manually audited golden fixture', async () => {
  const golden = JSON.parse(await readFile(path.join(fx('good'), 'graph.golden.json'), 'utf8'));
  assert.equal(typeof kb.buildGraph, 'function');
  const pages = await collectPages(path.join(fx('good'), 'wiki'));
  assert.deepEqual(kb.buildGraph(pages), golden);
});

test('build-graph CLI writes one-newline JSON matching golden from an isolated good fixture', async () => {
  await withTmpDir(async (root) => {
    const kbRoot = path.join(root, 'good');
    await cp(fx('good'), kbRoot, { recursive: true });

    const result = runBuildGraph(kbRoot);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const output = await readFile(graphOutput(kbRoot), 'utf8');
    assert.ok(output.endsWith('\n') && !output.endsWith('\n\n'));
    const golden = JSON.parse(await readFile(path.join(fx('good'), 'graph.golden.json'), 'utf8'));
    assert.deepEqual(JSON.parse(output), golden);
  });
});

test('build-graph CLI fails closed on validation errors', async () => {
  await withTmpDir(async (root) => {
    const kbRoot = path.join(root, 'bad-broken-link');
    await cp(fx('bad-broken-link'), kbRoot, { recursive: true });

    const result = runBuildGraph(kbRoot);
    assert.equal(existsSync(graphOutput(kbRoot)), false);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
});

test('build-graph CLI fails closed on malformed pages', async () => {
  await withTmpDir(async (root) => {
    const kbRoot = path.join(root, 'bad-no-frontmatter');
    await cp(fx('bad-no-frontmatter'), kbRoot, { recursive: true });

    const result = runBuildGraph(kbRoot);
    assert.equal(existsSync(graphOutput(kbRoot)), false);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
});

test('build-graph CLI fails closed on public-git private-page errors', async () => {
  await withTmpDir(async (root) => {
    const kbRoot = path.join(root, 'public-git');
    await cp(fx('good'), kbRoot, { recursive: true });
    await writeTree(kbRoot, {
      '.karp-wiki/config.json': '{"storage":{"mode":"public-git"}}\n',
    });

    const result = runBuildGraph(kbRoot);
    assert.equal(existsSync(graphOutput(kbRoot)), false);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  });
});

test('CLI rejects an inherited-property command with usage exit 2', () => {
  const result = spawnSync(process.execPath, [kbCli, 'toString', '--root', fx('good')], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /Usage: node scripts\/kb\.mjs <check\|reindex\|build-graph>/);
});
