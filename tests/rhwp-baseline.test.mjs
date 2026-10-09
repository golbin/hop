import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const upstreamLock = JSON.parse(
  await readFile(join(repoRoot, 'config/rhwp-upstream.json'), 'utf8'),
);
const expectedRhwpVersion = upstreamLock.version;
const expectedRhwpCommit = upstreamLock.commit;

test('HOP keeps the rhwp renderer baseline aligned across submodule, vendored WASM, and native lockfile', async () => {
  const wasmPackage = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/package.json'), 'utf8'),
  );
  assert.equal(wasmPackage.version, expectedRhwpVersion);
  const provenance = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/PROVENANCE.json'), 'utf8'),
  );
  assert.equal(provenance.version, expectedRhwpVersion);
  assert.equal(provenance.source, upstreamLock.source);
  assert.equal(provenance.tag, upstreamLock.tag);
  assert.equal(provenance.commit, expectedRhwpCommit);
  assert.equal(provenance.rustToolchain, upstreamLock.rustToolchain);
  assert.equal(provenance.wasmPackVersion, upstreamLock.wasmPackVersion);
  assert.deepEqual(provenance.fork, upstreamLock.fork);

  for (const [fileName, expected] of Object.entries(provenance.artifacts)) {
    const bytes = await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core', fileName));
    assert.equal(bytes.length, expected.bytes, `${fileName} byte size should match provenance`);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      expected.sha256,
      `${fileName} checksum should match provenance`,
    );
  }

  const pnpmLock = await readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(pnpmLock, /@rhwp\/core@/);

  const cargoLock = await readFile(join(repoRoot, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  assert.match(
    cargoLock,
    new RegExp(`name = "rhwp"\\r?\\nversion = "${escapeRegExp(expectedRhwpVersion)}"`),
  );

  const quickLookCargoLock = await readFile(
    join(repoRoot, 'apps/desktop/quicklook/rust/Cargo.lock'),
    'utf8',
  );
  assert.match(
    quickLookCargoLock,
    new RegExp(`name = "rhwp"\\r?\\nversion = "${escapeRegExp(expectedRhwpVersion)}"`),
  );

  const upstreamDoc = await readFile(join(repoRoot, 'docs/architecture/UPSTREAM.md'), 'utf8');
  assert.match(upstreamDoc, /config\/rhwp-upstream\.json/);

  const submoduleEntry = git(['ls-files', '--stage', '--', 'third_party/rhwp']).stdout.trim();
  assert.match(submoduleEntry, new RegExp(`^160000 ${expectedRhwpCommit} 0\\tthird_party/rhwp$`));
  const checkoutCommit = git(['-C', 'third_party/rhwp', 'rev-parse', 'HEAD']).stdout.trim();
  assert.equal(checkoutCommit, expectedRhwpCommit);

});

test('active HOP font catalog only references packaged font assets', async () => {
  const fontCatalog = await readFile(
    join(repoRoot, 'apps/studio-host/src/core/font-catalog.ts'),
    'utf8',
  );
  const referencedFonts = Array.from(fontCatalog.matchAll(/['"]\/fonts\/([^'"]+)['"]/g),
    (match) => match[1]);
  assert.ok(referencedFonts.length > 0, 'font loader should declare packaged font assets');

  for (const fileName of new Set(referencedFonts)) {
    await access(join(repoRoot, 'assets/fonts', fileName));
  }
});

test('HOP leaves unsafe lineseg repair out of the document-open path', async () => {
  const mainSource = await readFile(join(repoRoot, 'apps/studio-host/src/main.ts'), 'utf8');
  const manifest = JSON.parse(
    await readFile(join(repoRoot, 'config/rhwp-studio-overrides.json'), 'utf8'),
  );

  assert.doesNotMatch(mainSource, /showValidationModalIfNeeded|repairValidationWarningsIfNeeded/);
  assert.doesNotMatch(mainSource, /getValidationWarnings|reflowLinesegs/);
  assert.ok(!manifest.overrides.some((entry) => entry.id === 'ui/validation-modal'));
  await assert.rejects(
    access(join(repoRoot, 'apps/studio-host/src/ui/validation-modal.ts')),
    { code: 'ENOENT' },
  );
});

test('HOP keeps unsaved-document guards on local file and new-document replacement paths', async () => {
  const mainSource = await readFile(join(repoRoot, 'apps/studio-host/src/main.ts'), 'utf8');

  assert.match(mainSource, /confirmSaveBeforeReplacingDocument[\s\S]*from ['"]@\/upstream\/commands['"]/);
  assert.match(mainSource, /async function canReplaceCurrentDocument\([\s\S]*confirmSaveBeforeReplacingDocument\(commandServices\)/);
  assert.match(mainSource, /const skipUnsavedGuard = input\.dataset\.skipUnsavedGuard === ['"]true['"]/);
  assert.match(mainSource, /await loadFile\(file, \{ skipUnsavedGuard \}\)/);
  assert.match(mainSource, /if \(!await canReplaceCurrentDocument\(options\.skipUnsavedGuard\)\) return/);
  assert.match(mainSource, /if \(isTauriRuntime\(\) \|\| !await canReplaceCurrentDocument\(\)\) return/);
});

test('HOP defers editor engine and table command behavior to upstream rhwp', async () => {
  const manifest = JSON.parse(
    await readFile(join(repoRoot, 'config/rhwp-studio-overrides.json'), 'utf8'),
  );
  const overrideIds = manifest.overrides.map((entry) => entry.id);

  assert.ok(!overrideIds.some((id) => id.startsWith('engine/')));
  assert.ok(!overrideIds.includes('command/commands/table'));

  for (const path of [
    'apps/studio-host/src/engine/input-handler.ts',
    'apps/studio-host/src/engine/table-object-renderer.ts',
    'apps/studio-host/src/engine/table-resize-renderer.ts',
    'apps/studio-host/src/command/commands/table.ts',
  ]) {
    await assert.rejects(access(join(repoRoot, path)), { code: 'ENOENT' });
  }
});

test('HOP product info keeps the upstream rhwp version and adds HOP version separately', async () => {
  const viteConfig = await readFile(join(repoRoot, 'apps/studio-host/vite.config.ts'), 'utf8');
  const aboutDialog = await readFile(join(repoRoot, 'apps/studio-host/src/ui/about-dialog.ts'), 'utf8');

  assert.match(viteConfig, /__APP_VERSION__:\s*JSON\.stringify\(rhwpWasmPackage\.version\)/);
  assert.match(viteConfig, /__HOP_VERSION__:\s*JSON\.stringify\(desktopConfig\.version\)/);
  assert.match(aboutDialog, /extends UpstreamAboutDialog/);
  assert.match(aboutDialog, /super\.createBody\(\)/);
  assert.match(aboutDialog, /HOP \$\{__HOP_VERSION__\}/);
});

test('desktop release tests and platform builds use the upstream Rust toolchain', async () => {
  const releaseWorkflow = await readFile(
    join(repoRoot, '.github/workflows/hop-desktop.yml'),
    'utf8',
  );
  const contractReads = releaseWorkflow.match(
    /require\(['"]\.\/config\/rhwp-upstream\.json['"]\)\.rustToolchain/g,
  ) ?? [];

  assert.equal(contractReads.length, 2, 'release test and build jobs should read the contract');
  assert.match(
    releaseWorkflow,
    /rustup toolchain install "\$toolchain" --profile minimal --target "\$\{\{ matrix\.target \}\}"/,
  );
  assert.equal(
    releaseWorkflow.match(/RUSTUP_TOOLCHAIN=\$toolchain/g)?.length,
    2,
    'release test and build jobs should activate the pinned toolchain',
  );
});

test('CI installs clippy for the upstream Rust toolchain', async () => {
  const ciWorkflow = await readFile(
    join(repoRoot, '.github/workflows/ci.yml'),
    'utf8',
  );

  assert.match(
    ciWorkflow,
    /rustup toolchain install "\$toolchain" --profile minimal --component clippy/,
  );
  assert.match(ciWorkflow, /RUSTUP_TOOLCHAIN=\$toolchain/);
});

test('desktop release checksum manifest does not hash itself', async () => {
  const releaseWorkflow = await readFile(
    join(repoRoot, '.github/workflows/hop-desktop.yml'),
    'utf8',
  );

  assert.match(
    releaseWorkflow,
    /find \. -type f ! -name 'SHA256SUMS\.txt' -print0/,
  );
});

test('desktop release artifact presence check is pipefail-safe', async () => {
  const releaseWorkflow = await readFile(
    join(repoRoot, '.github/workflows/hop-desktop.yml'),
    'utf8',
  );

  assert.match(releaseWorkflow, /find artifacts -type f -print -quit/);
  assert.doesNotMatch(releaseWorkflow, /find artifacts -type f \| grep -q/);
});

test('HOP keeps PDF export menu-only without a stale Ctrl+E label', async () => {
  const fileCommands = await readFile(join(repoRoot, 'apps/studio-host/src/command/commands/file.ts'), 'utf8');
  const indexHtml = await readFile(join(repoRoot, 'apps/studio-host/index.html'), 'utf8');
  const pdfMenuItem = indexHtml.match(/<div class="md-item disabled" data-cmd="file:export-pdf">.*?<\/div>/);

  assert.doesNotMatch(fileCommands, /id:\s*['"]file:export-pdf['"][\s\S]*?shortcutLabel:/);
  assert.ok(pdfMenuItem, 'PDF export menu item should exist');
  assert.doesNotMatch(pdfMenuItem[0], /md-shortcut|Ctrl\+E|Cmd\+E/);
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
