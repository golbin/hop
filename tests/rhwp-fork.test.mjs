import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import { pinnedEngineSource, officialUpstreamSource, sourceTextHash, artifactMetadata } from '../scripts/lib/rhwp-upstream.mjs';

const lock = {
  source: officialUpstreamSource,
  commit: 'a'.repeat(40),
  fork: {
    source: 'https://github.com/mytrashcan/rhwp',
    baseCommit: 'b'.repeat(40),
    reason: 'Reserve body-wide Square tables across columns',
  },
};

test('source baselines survive CRLF checkout while artifact hashes retain exact bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hop-source-hash-'));
  try {
    const lf = join(dir, 'lf.ts');
    const crlf = join(dir, 'crlf.ts');
    await writeFile(lf, 'const title = "제목";\nexport {title};\n');
    await writeFile(crlf, 'const title = "제목";\r\nexport {title};\r\n');
    assert.equal(await sourceTextHash(lf), await sourceTextHash(crlf));
    assert.notEqual((await artifactMetadata(lf)).sha256, (await artifactMetadata(crlf)).sha256);
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
});

test('official releases and explicitly pinned downstream sources are distinguished', () => {
  assert.equal(pinnedEngineSource({ source: officialUpstreamSource }), officialUpstreamSource);
  assert.equal(pinnedEngineSource(lock), lock.fork.source);
});

test('downstream pins reject moving refs and undocumented or mismatched sources', () => {
  for (const fork of [
    { ...lock.fork, baseCommit: 'main' },
    { ...lock.fork, reason: '' },
    { ...lock.fork, source: 'https://example.com/rhwp' },
    { ...lock.fork, source: officialUpstreamSource },
  ]) assert.throws(() => pinnedEngineSource({ ...lock, fork }));
  assert.throws(() => pinnedEngineSource({ ...lock, commit: 'main' }));
  assert.throws(() => pinnedEngineSource({ ...lock, source: lock.fork.source }));
});
