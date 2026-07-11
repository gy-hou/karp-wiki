import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFrontmatter, extractWikiLinks, resolveRoot,
  collectPages, findMalformed, validate, indexCoverageErrors, visibilityErrors,
} from '../scripts/kb.mjs';
import { withTmpDir, writeTree } from './helpers/tmp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => path.join(here, 'fixtures', name);
const errsOf = async (name) => validate(await collectPages(path.join(fx(name), 'wiki')), fx(name));
const cats = (errs) => new Set(errs.map((e) => e.category));
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
