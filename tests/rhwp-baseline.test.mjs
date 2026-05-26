import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const expectedRhwpVersion = '0.7.13';
const expectedRhwpCommit = 'b3e16ef212af81ef37d973ddb86d6816d3804642';

test('HOP keeps the rhwp renderer baseline aligned across submodule, vendored WASM, and native lockfile', async () => {
  const wasmPackage = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/package.json'), 'utf8'),
  );
  assert.equal(wasmPackage.version, expectedRhwpVersion);
  const wasmBytes = await readFile(join(repoRoot, 'apps/studio-host/vendor/rhwp-core/rhwp_bg.wasm'));
  assert.ok(wasmBytes.length > 0, 'vendored rhwp WASM should be present');

  const pnpmLock = await readFile(join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(pnpmLock, /@rhwp\/core@/);

  const cargoLock = await readFile(join(repoRoot, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
  assert.match(
    cargoLock,
    new RegExp(`name = "rhwp"\\r?\\nversion = "${escapeRegExp(expectedRhwpVersion)}"`),
  );

  const upstreamDoc = await readFile(join(repoRoot, 'docs/architecture/UPSTREAM.md'), 'utf8');
  assert.match(upstreamDoc, new RegExp(escapeRegExp(expectedRhwpCommit)));
  assert.match(upstreamDoc, new RegExp(escapeRegExp(`v${expectedRhwpVersion}`)));

  const submoduleStatus = git(['submodule', 'status', 'third_party/rhwp']).stdout.trim();
  assert.match(submoduleStatus, new RegExp(`^[ +-]?${expectedRhwpCommit} third_party/rhwp\\b`));
});

test('HOP preserves upstream lineseg validation and auto-reflow on document load', async () => {
  const mainSource = await readFile(join(repoRoot, 'apps/studio-host/src/main.ts'), 'utf8');
  const overrides = await readFile(join(repoRoot, 'apps/studio-host/hop-overrides.ts'), 'utf8');
  const validationModal = await readFile(join(repoRoot, 'apps/studio-host/src/ui/validation-modal.ts'), 'utf8');

  assert.match(mainSource, /showValidationModalIfNeeded/);
  assert.doesNotMatch(mainSource, /currentSourceFormat/);
  assert.match(mainSource, /wasm\.getValidationWarnings\(\)/);
  assert.match(mainSource, /wasm\.reflowLinesegs\(\)/);
  assert.match(mainSource, /canvasView\?\.loadDocument\(\)/);
  assert.match(mainSource, /repairValidationWarningsIfNeeded/);

  const validationStart = mainSource.indexOf('async function repairValidationWarningsIfNeeded');
  assert.notEqual(validationStart, -1, 'validation block should call getValidationWarnings');
  const validationEnd = mainSource.indexOf('/** 문서 초기화 공통 시퀀스', validationStart);
  assert.ok(validationEnd > validationStart, 'validation helper should exist before document initialization');

  const validationBlock = mainSource.slice(validationStart, validationEnd);
  assert.doesNotMatch(validationBlock, /sourceFormat\s*===\s*['"]hwpx['"]/);
  assert.match(validationBlock, /const report = wasm\.getValidationWarnings\(\)/);
  assert.match(validationBlock, /catch \(error\)/);
  assert.match(validationBlock, /return reflowedCount\s*>\s*0/);
  assert.match(mainSource, /const normalizedDuringLoad = await repairValidationWarningsIfNeeded\(displayName\)/);
  assert.match(overrides, /['"]ui\/validation-modal['"]/);
  assert.match(validationModal, /문서 보정 확인/);
  assert.doesNotMatch(validationModal, /HWPX 비표준 감지/);
});

test('HOP keeps unsaved-document guards on local file and new-document replacement paths', async () => {
  const mainSource = await readFile(join(repoRoot, 'apps/studio-host/src/main.ts'), 'utf8');

  assert.match(mainSource, /import \{ confirmSaveBeforeReplacingDocument \} from ['"]@upstream\/command\/commands\/file['"]/);
  assert.match(mainSource, /async function canReplaceCurrentDocument\([\s\S]*confirmSaveBeforeReplacingDocument\(commandServices\)/);
  assert.match(mainSource, /const skipUnsavedGuard = input\.dataset\.skipUnsavedGuard === ['"]true['"]/);
  assert.match(mainSource, /await loadFile\(file, \{ skipUnsavedGuard \}\)/);
  assert.match(mainSource, /if \(!await canReplaceCurrentDocument\(options\.skipUnsavedGuard\)\) return/);
  assert.match(mainSource, /if \(isTauriRuntime\(\) \|\| !await canReplaceCurrentDocument\(\)\) return/);
});

test('HOP defers editor engine and table command behavior to upstream rhwp', async () => {
  const overrides = await readFile(join(repoRoot, 'apps/studio-host/hop-overrides.ts'), 'utf8');

  assert.doesNotMatch(overrides, /['"]engine\//);
  assert.doesNotMatch(overrides, /['"]command\/commands\/table['"]/);

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
