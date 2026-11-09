#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('[quicklook] non-macOS platform; skipping Quick Look tests');
  process.exit(0);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(repoRoot, 'apps/desktop/quicklook/rust/Cargo.toml');

run('cargo', [
  'test',
  '--manifest-path',
  manifestPath,
  '--locked',
]);

function run(command, args) {
  console.log(`[quicklook] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      MACOSX_DEPLOYMENT_TARGET: process.env.MACOSX_DEPLOYMENT_TARGET || '12.0',
    },
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}
