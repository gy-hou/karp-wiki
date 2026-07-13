import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function makeTmpDir(prefix = 'karp-') {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function withTmpDir(fn, prefix = 'karp-') {
  const dir = await makeTmpDir(prefix);
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
}
