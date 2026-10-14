import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const studioRoot = join(repoRoot, 'apps/studio-host/src');
const rustAdapterRoot = join(repoRoot, 'apps/desktop/rhwp-adapter');
const upstreamStudioRoot = join(repoRoot, 'third_party/rhwp/rhwp-studio/src');

test('production studio code reaches rhwp internals only through the upstream adapter directory', async () => {
  const violations = [];
  const manifest = JSON.parse(await readFile(join(repoRoot, 'config/rhwp-studio-overrides.json'), 'utf8'));
  const overrideIds = new Set(manifest.overrides.map((entry) => entry.id));
  for (const file of await typescriptFiles(studioRoot)) {
    const relativePath = relative(studioRoot, file).replaceAll('\\', '/');
    if (relativePath.startsWith('upstream/') || relativePath.endsWith('.test.ts')) continue;
    const source = await readFile(file, 'utf8');
    if (source.includes("'@upstream/") || source.includes('"@upstream/')) {
      violations.push(`${relativePath}: direct @upstream import`);
    }
    for (const match of source.matchAll(/['"]@\/([^'"]+)['"]/g)) {
      if (match[1].startsWith('upstream/')) continue;
      if (localModuleExists(match[1]) && !overrideIds.has(match[1])) {
        violations.push(`${relativePath}: HOP alias is not registered as an override @/${match[1]}`);
      } else if (!localModuleExists(match[1])) {
        violations.push(`${relativePath}: implicit upstream alias @/${match[1]}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('desktop product crates reach rhwp only through the shared Rust adapter', async () => {
  const desktopManifest = await readFile(join(repoRoot, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const quickLookManifest = await readFile(join(repoRoot, 'apps/desktop/quicklook/rust/Cargo.toml'), 'utf8');
  const adapterManifest = await readFile(join(rustAdapterRoot, 'Cargo.toml'), 'utf8');

  assert.match(desktopManifest, /hop-rhwp-adapter\s*=\s*\{/);
  assert.match(quickLookManifest, /hop-rhwp-adapter\s*=\s*\{/);
  assert.doesNotMatch(desktopManifest, /^rhwp\s*=/m);
  assert.doesNotMatch(quickLookManifest, /^rhwp\s*=/m);
  assert.match(adapterManifest, /^rhwp\s*=\s*\{\s*path\s*=\s*"\.\.\/\.\.\/\.\.\/third_party\/rhwp"\s*\}/m);

  const violations = [];
  for (const root of [
    join(repoRoot, 'apps/desktop/src-tauri/src'),
    join(repoRoot, 'apps/desktop/quicklook/rust/src'),
  ]) {
    for (const file of await rustFiles(root)) {
      const source = await readFile(file, 'utf8');
      if (/\brhwp::/.test(source)) violations.push(relative(repoRoot, file));
    }
  }
  assert.deepEqual(violations, []);
});

test('desktop keeps PDF policy thin and delegates searchable encoding to rhwp', async () => {
  const desktopManifest = await readFile(join(repoRoot, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
  const pdfExport = await readFile(join(repoRoot, 'apps/desktop/src-tauri/src/pdf_export.rs'), 'utf8');
  const adapter = await readFile(join(rustAdapterRoot, 'src/lib.rs'), 'utf8');

  assert.doesNotMatch(desktopManifest, /^pdf-writer\s*=|^svg2pdf\s*=\s*"/m);
  assert.doesNotMatch(pdfExport, /embed_text\s*:\s*false|pdf_writer::|svg2pdf::/);
  assert.match(pdfExport, /searchable_pdf_from_svg_pages/);
  assert.match(adapter, /svgs_to_pdf_with_options/);
  assert.match(adapter, /embed_text:\s*true/);
  assert.match(adapter, /fallback_sans:\s*"Noto Sans KR"\.to_string\(\)/);

  const tauriConfig = await readFile(
    join(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'),
    'utf8',
  );
  assert.match(tauriConfig, /NotoSansKR-Regular\.ttf/);
  assert.match(tauriConfig, /fonts\/pdf\/NotoSansKR-Regular\.ttf/);
  assert.match(pdfExport, /third_party\/rhwp\/ttfs\/opensource/);
});

test('every Vite override is classified and points to an intentional HOP module', async () => {
  const manifest = JSON.parse(await readFile(join(repoRoot, 'config/rhwp-studio-overrides.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.overrides.length > 0);

  const ids = new Set();
  for (const entry of manifest.overrides) {
    assert.ok(!ids.has(entry.id), `duplicate override: ${entry.id}`);
    assert.match(entry.reason, /\S/);
    assert.ok(['extension', 'fork', 'contribution'].includes(entry.strategy));
    assert.ok(moduleExists(studioRoot, entry.id), `missing HOP override: ${entry.id}`);
    if (entry.strategy === 'extension' || entry.strategy === 'fork') {
      assert.ok(moduleExists(upstreamStudioRoot, entry.id), `missing upstream counterpart: ${entry.id}`);
    }
    ids.add(entry.id);
  }
});

test('studio host declares compatibility required by imported upstream source', async () => {
  const rootPackage = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  const upstreamPackage = JSON.parse(
    await readFile(join(repoRoot, 'third_party/rhwp/rhwp-studio/package.json'), 'utf8'),
  );
  const studioHostPackage = JSON.parse(
    await readFile(join(repoRoot, 'apps/studio-host/package.json'), 'utf8'),
  );
  const tsconfig = JSON.parse(await readFile(join(repoRoot, 'apps/studio-host/tsconfig.json'), 'utf8'));

  assert.equal(
    rootPackage.dependencies['@noble/hashes'],
    upstreamPackage.dependencies['@noble/hashes'],
  );
  assert.equal(
    studioHostPackage.devDependencies['canvaskit-wasm'],
    upstreamPackage.dependencies['canvaskit-wasm'],
  );
  for (const dependency of ['typescript', 'vite']) {
    assert.equal(
      studioHostPackage.devDependencies[dependency],
      upstreamPackage.devDependencies[dependency],
    );
  }
  assert.equal(tsconfig.compilerOptions.allowImportingTsExtensions, true);
});

test('HOP composes the upstream renderer and ruler protocols without local forks', async () => {
  const upstreamInputHandler = await readFile(
    join(upstreamStudioRoot, 'engine/input-handler.ts'),
    'utf8',
  );
  const mainSource = await readFile(join(studioRoot, 'main.ts'), 'utf8');
  const viewAdapter = await readFile(join(studioRoot, 'upstream/view.ts'), 'utf8');
  const manifest = JSON.parse(
    await readFile(join(repoRoot, 'config/rhwp-studio-overrides.json'), 'utf8'),
  );

  assert.match(
    upstreamInputHandler,
    /emit\('document-page-invalidated',\s*\{[\s\S]*?pageIndex,[\s\S]*?reason:\s*'text-edit'/,
  );
  assert.match(viewAdapter, /CanvasView.*@upstream\/view\/canvas-view/);
  assert.match(viewAdapter, /RendererSession.*@upstream\/view\/renderer-session/);
  assert.match(viewAdapter, /Ruler.*@upstream\/view\/ruler/);
  assert.match(mainSource, /canvasView\?\.prepareDocumentLoad\(\)/);
  assert.match(mainSource, /await canvasView\?\.loadDocument\(\)/);
  assert.ok(!manifest.overrides.some((entry) => entry.id.startsWith('view/')));
  for (const path of ['view/canvas-view.ts', 'view/ruler.ts', 'view/hop-page-renderer.ts']) {
    await assert.rejects(access(join(studioRoot, path)), { code: 'ENOENT' });
  }
});

test('HOP composes upstream theme state and keeps owned surfaces token-based', async () => {
  const mainSource = await readFile(join(studioRoot, 'main.ts'), 'utf8');
  const coreAdapter = await readFile(join(studioRoot, 'upstream/core.ts'), 'utf8');
  const studioHtml = await readFile(join(repoRoot, 'apps/studio-host/index.html'), 'utf8');

  assert.match(coreAdapter, /initThemeSync[\s\S]*@upstream\/core\/theme/);
  assert.match(mainSource, /initThemeSync\(\(effective, mode\) =>/);
  for (const mode of ['system', 'light', 'dark']) {
    assert.equal(
      studioHtml.match(new RegExp(`data-theme-mode-choice="${mode}"`, 'g'))?.length,
      1,
    );
  }

  for (const relativePath of [
    'styles/custom-select.css',
    'styles/font-set-dialog.css',
    'styles/home-screen.css',
    'styles/update-notice.css',
  ]) {
    const css = await readFile(join(studioRoot, relativePath), 'utf8');
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${relativePath} must use theme tokens`);
  }
});

test('HOP keeps the pinned upstream style toolbar markup contract', async () => {
  const studioHtml = await readFile(join(repoRoot, 'apps/studio-host/index.html'), 'utf8');
  const upstreamHtml = await readFile(
    join(repoRoot, 'third_party/rhwp/rhwp-studio/index.html'),
    'utf8',
  );

  assert.equal(
    extractStyleToolbar(studioHtml),
    extractStyleToolbar(upstreamHtml),
    'HOP style toolbar markup must stay aligned with pinned rhwp CSS',
  );
});

async function typescriptFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await typescriptFiles(path));
    else if (entry.name.endsWith('.ts')) results.push(path);
  }
  return results;
}

async function rustFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await rustFiles(path));
    else if (entry.name.endsWith('.rs')) results.push(path);
  }
  return results;
}

function localModuleExists(moduleId) {
  return moduleExists(studioRoot, moduleId);
}

function extractStyleToolbar(html) {
  const match = html.match(
    /<!-- 서식 도구 모음 \(style bar\) -->\s*(<div id="style-bar">[\s\S]*<\/div>)\s*(?:<\/header>\s*)?<!-- 에디터 영역 \(눈금자 포함\) -->/,
  );
  assert.ok(match, 'style toolbar section should exist');
  return match[1].trim();
}

function moduleExists(root, moduleId) {
  const candidates = /\.[A-Za-z0-9]+$/.test(moduleId) ? [
    join(root, moduleId),
  ] : [
    join(root, `${moduleId}.ts`),
    join(root, `${moduleId}.css`),
    join(root, moduleId, 'index.ts'),
  ];
  return candidates.some(existsSync);
}
