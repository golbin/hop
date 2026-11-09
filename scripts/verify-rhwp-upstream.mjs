import { cargoLockHasPatchSource, cargoPatchDeclaration, readPathCargoPatch, readPdfBackend } from './lib/rhwp-cargo-patches.mjs';
import { parse } from 'smol-toml';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  artifactMetadata,
  buildStudioOverrideBaseline,
  cargoLockPackageVersion,
  cargoRoots,
  currentUpstreamCommit,
  normalizeGitSource,
  officialUpstreamSource,
  parsePackageVersion,
  parseRustToolchain,
  provenancePath,
  readJson,
  repoRoot,
  run,
  upstreamDir,
  upstreamLockPath,
  studioOverrideManifestPath,
  studioHostDir,
  studioMirroredAssetPaths,
  vendoredArtifactNames,
  vendorDir,
  wasmFeatures,
} from './lib/rhwp-upstream.mjs';

export async function verifyRhwpUpstream() {
  const lock = await readJson(upstreamLockPath);
  assert.equal(lock.schemaVersion, 1);
  assert.equal(normalizeGitSource(lock.source), officialUpstreamSource);
  assert.equal(
    normalizeGitSource(run('git', ['remote', 'get-url', 'origin'], { cwd: upstreamDir })),
    officialUpstreamSource,
    'submodule origin must match the provenance source',
  );
  assert.match(lock.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.tag, `v${lock.version}`);
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.equal(currentUpstreamCommit(), lock.commit, 'submodule checkout must match upstream lock');
  assert.equal(run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: upstreamDir }),
    '', 'upstream checkout must be clean');

  const cargoToml = await readFile(join(upstreamDir, 'Cargo.toml'), 'utf8');
  const studioPackage = await readJson(join(upstreamDir, 'rhwp-studio/package.json'));
  const rustToolchain = await readFile(join(upstreamDir, 'rust-toolchain.toml'), 'utf8');
  assert.equal(parsePackageVersion(cargoToml), lock.version);
  assert.equal(studioPackage.version, lock.version);
  assert.equal(parseRustToolchain(rustToolchain), lock.rustToolchain);
  const pdfBackend = await readPdfBackend(cargoToml);

  const wasmPackage = await readJson(join(vendorDir, 'package.json'));
  const provenance = await readJson(provenancePath);
  assert.equal(wasmPackage.name, 'rhwp');
  assert.equal(wasmPackage.version, lock.version);
  assert.equal(provenance.schemaVersion, 1);
  assert.equal(provenance.wasmDefaultFeatures, false, 'WASM must disable upstream default features');
  assert.deepEqual(provenance.wasmFeatures, wasmFeatures, 'WASM features must match HOP product scope');
  for (const field of ['source', 'version', 'tag', 'commit', 'rustToolchain', 'wasmPackVersion']) {
    assert.deepEqual(provenance[field], lock[field], `provenance ${field} must match upstream lock`);
  }
  assert.deepEqual(Object.keys(provenance.artifacts).sort(), [...vendoredArtifactNames].sort());
  const vendorEntries = (await readdir(vendorDir)).filter((name) => name !== 'PROVENANCE.json');
  assert.deepEqual(vendorEntries.sort(), [...vendoredArtifactNames].sort());
  for (const [name, expected] of Object.entries(provenance.artifacts)) {
    assert.deepEqual(await artifactMetadata(join(vendorDir, name)), expected, `${name} provenance mismatch`);
  }

  for (const [crateName, patch] of Object.entries(lock.cargoPatches ?? {})) {
    if (patch.path) assert.deepEqual(await readPathCargoPatch(crateName, patch.path), patch);
  }
  for (const cargoRoot of cargoRoots) {
    const cargoLock = await readFile(join(cargoRoot, 'Cargo.lock'), 'utf8');
    assert.equal(cargoLockPackageVersion(cargoLock, 'rhwp'), lock.version);
    await verifyNativeCargo(lock, cargoRoot, cargoLock, pdfBackend);
  }
  const overrideManifest = await readJson(studioOverrideManifestPath);
  assert.deepEqual(
    overrideManifest.upstream,
    await buildStudioOverrideBaseline(overrideManifest, lock),
    'studio override counterpart baseline must match the pinned upstream',
  );
  for (const relativePath of studioMirroredAssetPaths) {
    assert.deepEqual(
      await artifactMetadata(join(studioHostDir, relativePath)),
      await artifactMetadata(join(upstreamDir, 'rhwp-studio', relativePath)),
      `${relativePath} must match the pinned upstream studio asset`,
    );
  }
  await verifyFontAssets();
  return lock;
}

async function verifyNativeCargo(lock, cargoRoot, cargoLock, pdfBackend) {
  const cargoToml = await readFile(join(cargoRoot, 'Cargo.toml'), 'utf8');
  const manifest = parse(cargoToml);
  if (pdfBackend) {
    assert.equal(manifest.patch?.['crates-io']?.svg2pdf, undefined,
      'remove the obsolete svg2pdf registry patch');
    assert.ok(cargoLockHasPatchSource(cargoLock, pdfBackend.package, pdfBackend),
      'native PDF output must use the pinned upstream vendor source');
    if (pdfBackend.package !== 'svg2pdf') {
      assert.equal(cargoLockPackageVersion(cargoLock, 'svg2pdf'), undefined,
        'native graphs must not retain the uncorrected registry PDF backend');
    }
  }
  for (const [crateName, patch] of Object.entries(lock.cargoPatches ?? {})) {
    assert.deepEqual({ ...manifest.patch?.['crates-io']?.[crateName] }, cargoPatchDeclaration(patch, cargoRoot));
    assert.ok(
      cargoLockHasPatchSource(cargoLock, crateName, patch),
      `${crateName} Cargo.lock must match the upstream patch contract`,
    );
  }
}

async function verifyFontAssets() {
  const fontCatalog = await readFile(join(repoRoot, 'apps/studio-host/src/core/font-catalog.ts'), 'utf8');
  const names = new Set(Array.from(fontCatalog.matchAll(/['"]\/fonts\/([^'"]+)['"]/g), (m) => m[1]));
  assert.ok(names.size > 0, 'active font catalog must reference packaged fonts');
  for (const name of names) await access(join(repoRoot, 'assets/fonts', name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyRhwpUpstream()
    .then((lock) => console.log(`rhwp upstream contract verified: ${lock.tag} (${lock.commit})`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
