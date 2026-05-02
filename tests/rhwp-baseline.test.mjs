import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedRhwpVersion = '0.7.9';
const expectedRhwpCommit = '0fb3e6758b8ad11d2f3c3849c83b914684e83863';

test('HOP keeps the rhwp renderer baseline aligned across submodule, WASM package, and native lockfile', async () => {
  const studioPackage = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/package.json'), 'utf8'),
  );
  assert.equal(studioPackage.dependencies['@rhwp/core'], expectedRhwpVersion);

  const pnpmLock = await readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  assert.match(pnpmLock, new RegExp(`@rhwp/core@${escapeRegExp(expectedRhwpVersion)}`));

  const cargoLock = await readFile(join(repoRoot, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  assert.match(
    cargoLock,
    new RegExp(`name = "rhwp"\\nversion = "${escapeRegExp(expectedRhwpVersion)}"`),
  );

  const upstreamDoc = await readFile(join(repoRoot, 'docs/architecture/UPSTREAM.md'), 'utf8');
  assert.match(upstreamDoc, new RegExp(escapeRegExp(expectedRhwpCommit)));
  assert.match(upstreamDoc, new RegExp(escapeRegExp(`v${expectedRhwpVersion}`)));

  const submoduleStatus = git(['submodule', 'status', 'third_party/rhwp']).stdout.trim();
  assert.match(submoduleStatus, new RegExp(`^[ +-]?${expectedRhwpCommit} third_party/rhwp\\b`));
});

test('HOP preserves upstream lineseg validation and auto-reflow on document load', async () => {
  const mainSource = await readFile(join(repoRoot, 'apps/studio-host/src/main.ts'), 'utf8');

  assert.match(mainSource, /showValidationModalIfNeeded/);
  assert.match(mainSource, /wasm\.getValidationWarnings\(\)/);
  assert.match(mainSource, /wasm\.reflowLinesegs\(\)/);
  assert.match(mainSource, /canvasView\?\.loadDocument\(\)/);
});

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
