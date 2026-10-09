import { cargoPatchTomlPattern, readPathCargoPatch, synchronizeCargoPatchToml } from './lib/rhwp-cargo-patches.mjs';
import { access, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  assertStableTag,
  buildStudioOverrideBaseline,
  cargoLockPackageVersion,
  cargoLockPackageEntries,
  cargoRoots,
  currentUpstreamCommit,
  parsePackageVersion,
  parseRustToolchain,
  parseUpdateTag,
  provenancePath,
  readJson,
  repoRelativePath,
  run,
  upstreamDir,
  upstreamLockPath,
  studioOverrideManifestPath,
  studioHostDir,
  studioMirroredAssetPaths,
  tomlSection,
  vendoredArtifactNames,
  vendorDir,
  writeJson,
  buildProvenance,
} from './lib/rhwp-upstream.mjs';
import { verifyRhwpUpstream } from './verify-rhwp-upstream.mjs';

const tag = parseUpdateTag(process.argv.slice(2));
if (!tag) {
  console.error('Usage: pnpm upstream:update -- vX.Y.Z');
  process.exit(2);
}

assertStableTag(tag);
if ((await readJson(upstreamLockPath)).fork) {
  throw new Error('Resolve the pinned downstream engine patch before updating the official release; see docs/architecture/UPSTREAM.md');
}
await assertSafeWorkingState();
await verifyRhwpUpstream();

const previousCommit = currentUpstreamCommit();
const previousLock = await readJson(upstreamLockPath);
const previousOverrideManifest = await readJson(studioOverrideManifestPath);
const backupDir = await mkdtemp(join(tmpdir(), 'hop-rhwp-update-backup-'));
let backupReady = false;

try {
  await backupOwnedFiles(backupDir);
  backupReady = true;
  run('git', ['fetch', 'origin', 'tag', tag], { cwd: upstreamDir, stdio: 'inherit' });
  const targetCommit = run('git', ['rev-parse', `${tag}^{commit}`], { cwd: upstreamDir });
  run('git', ['checkout', '--detach', targetCommit], { cwd: upstreamDir, stdio: 'inherit' });

  const target = await readTargetMetadata(tag, targetCommit, previousLock.source);
  target.cargoPatches = await resolveHopCargoPatches(previousLock.cargoPatches ?? {});
  await syncHopCargoPatches(previousLock.cargoPatches ?? {}, target.cargoPatches);
  await assertHopCargoPatches(target.cargoPatches);

  const installedWasmPackVersion = run('wasm-pack', ['--version']).replace(/^wasm-pack\s+/, '');
  if (
    previousLock.wasmPackVersion
    && installedWasmPackVersion !== previousLock.wasmPackVersion
    && process.env.HOP_ALLOW_WASM_PACK_VERSION_CHANGE !== '1'
  ) {
    throw new Error(
      `wasm-pack ${installedWasmPackVersion} does not match pinned ${previousLock.wasmPackVersion}; `
      + 'set HOP_ALLOW_WASM_PACK_VERSION_CHANGE=1 for an intentional generator upgrade',
    );
  }
  target.wasmPackVersion = installedWasmPackVersion;
  await buildVendoredWasm();

  await updateCargoLocks(previousLock.version, target.cargoPatches, target.rustToolchain);
  await syncStudioAssets();
  const nextOverrideManifest = {
    ...previousOverrideManifest,
    upstream: await buildStudioOverrideBaseline(previousOverrideManifest, target),
  };
  const changedInputs = changedStudioInputs(previousOverrideManifest, nextOverrideManifest);
  await writeJson(upstreamLockPath, target);
  await writeJson(studioOverrideManifestPath, nextOverrideManifest);
  await writeJson(provenancePath, await buildProvenance(target));
  await verifyRhwpUpstream();

  console.log(`rhwp candidate prepared: ${tag} (${targetCommit})`);
  if (changedInputs.length > 0) {
    console.log(`Review changed studio inputs: ${changedInputs.join(', ')}`);
  }
  console.log('Next: review the diff, run pnpm upstream:verify, then complete product smoke tests.');
} catch (error) {
  if (!backupReady) throw error;
  console.error(`rhwp update failed; restoring ${previousLock.tag}`);
  const recoveryErrors = [];
  try {
    await restoreOwnedFiles(backupDir);
  } catch (recoveryError) {
    recoveryErrors.push(recoveryError);
  }
  try {
    run('git', ['checkout', '--detach', previousCommit], { cwd: upstreamDir, stdio: 'inherit' });
  } catch (recoveryError) {
    recoveryErrors.push(recoveryError);
  }
  if (recoveryErrors.length > 0) {
    throw new AggregateError([error, ...recoveryErrors], 'rhwp update and recovery failed');
  }
  throw error;
} finally {
  await rm(backupDir, { recursive: true, force: true });
}

async function assertSafeWorkingState() {
  if (run('git', ['status', '--porcelain'], { cwd: upstreamDir })) {
    throw new Error('third_party/rhwp has local changes');
  }
  const owned = [
    'config/rhwp-upstream.json',
    'config/rhwp-studio-overrides.json',
    'apps/studio-host/vendor/rhwp-core',
    ...studioMirroredAssetPaths.map((path) => `apps/studio-host/${path}`),
    ...cargoRoots.map((root) => `${repoRelativePath(root)}/Cargo.lock`),
    ...cargoRoots.map((root) => `${repoRelativePath(root)}/Cargo.toml`),
  ];
  const dirty = run('git', ['status', '--porcelain', '--', ...owned]);
  if (dirty) {
    throw new Error(`upstream-owned files have local changes:\n${dirty}`);
  }
}

async function readTargetMetadata(targetTag, commit, source) {
  const cargoToml = await readFile(join(upstreamDir, 'Cargo.toml'), 'utf8');
  const studioPackage = await readJson(join(upstreamDir, 'rhwp-studio/package.json'));
  const toolchainToml = await readFile(join(upstreamDir, 'rust-toolchain.toml'), 'utf8');
  const version = parsePackageVersion(cargoToml);
  if (targetTag !== `v${version}` || studioPackage.version !== version) {
    throw new Error(`tag, Cargo and studio versions are not aligned: ${targetTag}, ${version}, ${studioPackage.version}`);
  }
  return {
    schemaVersion: 1,
    source,
    version,
    tag: targetTag,
    commit,
    rustToolchain: parseRustToolchain(toolchainToml),
    wasmPackVersion: null,
    cargoPatches: {},
  };
}

async function resolveHopCargoPatches(existing) {
  const cargoToml = await readFile(join(upstreamDir, 'Cargo.toml'), 'utf8');
  const upstreamCargoLock = await readFile(join(upstreamDir, 'Cargo.lock'), 'utf8').catch(() => '');
  // Cargo patches are HOP-owned product policy. If upstream carries the same
  // patch, follow its pinned source; otherwise retain HOP's reviewed pin.
  if (!/^svg2pdf\s*=/m.test(tomlSection(cargoToml, 'patch.crates-io'))) return existing;
  const path = tomlSection(cargoToml, 'patch.crates-io').match(/^svg2pdf\s*=\s*\{\s*path\s*=\s*"([^"]+)"\s*\}/m)?.[1];
  if (path) return { ...existing, svg2pdf: await readPathCargoPatch('svg2pdf', path) };
  const source = cargoLockPackageEntries(upstreamCargoLock, 'svg2pdf')
    .map((entry) => entry.source?.match(/^git\+([^?#]+)(?:\?[^#]*)?#([0-9a-f]{40})$/))
    .find(Boolean);
  if (!source?.[1] || !source[2]) throw new Error('upstream svg2pdf patch is not pinned in Cargo.lock');
  return { ...existing, svg2pdf: { git: source[1], rev: source[2] } };
}

async function assertHopCargoPatches(patches) {
  for (const root of cargoRoots) {
    const cargoToml = await readFile(join(root, 'Cargo.toml'), 'utf8');
    const patchSection = tomlSection(cargoToml, 'patch.crates-io');
    for (const [name, patch] of Object.entries(patches)) {
      const expected = cargoPatchTomlPattern(name, patch, root);
      if (!expected.test(patchSection)) {
        throw new Error(`${basename(root)}/Cargo.toml ${name} must match the upstream patch contract`);
      }
    }
  }
}

async function syncHopCargoPatches(previousPatches, nextPatches) {
  for (const root of cargoRoots) {
    const path = join(root, 'Cargo.toml');
    const cargoToml = await readFile(path, 'utf8');
    await writeFile(path, synchronizeCargoPatchToml(cargoToml, previousPatches, nextPatches, root));
  }
}

async function buildVendoredWasm() {
  const outputDir = await mkdtemp(join(tmpdir(), 'hop-rhwp-wasm-'));
  try {
    run('wasm-pack', ['build', '--target', 'web', '--out-dir', outputDir, '--release'], {
      cwd: upstreamDir,
      stdio: 'inherit',
    });
    for (const name of vendoredArtifactNames) await access(join(outputDir, name));
    for (const entry of await readdir(vendorDir)) {
      if (entry !== 'PROVENANCE.json' && !vendoredArtifactNames.includes(entry)) {
        await rm(join(vendorDir, entry), { recursive: true, force: true });
      }
    }
    for (const name of vendoredArtifactNames) {
      await cp(join(outputDir, name), join(vendorDir, name), { recursive: true, force: true });
    }
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

async function updateCargoLocks(previousVersion, patches, rustToolchain) {
  const options = { stdio: 'inherit', env: { RUSTUP_TOOLCHAIN: rustToolchain } };
  for (const root of cargoRoots) {
    run('cargo', ['update', '-p', `rhwp@${previousVersion}`], { cwd: root, ...options });
    for (const name of Object.keys(patches)) {
      const lock = await readFile(join(root, 'Cargo.lock'), 'utf8');
      const version = cargoLockPackageVersion(lock, name);
      if (version) run('cargo', ['update', '-p', `${name}@${version}`], { cwd: root, ...options });
    }
  }
}

async function syncStudioAssets() {
  for (const relativePath of studioMirroredAssetPaths) {
    await cp(
      join(upstreamDir, 'rhwp-studio', relativePath),
      join(studioHostDir, relativePath),
      { force: true },
    );
  }
}

async function backupOwnedFiles(backup) {
  await cp(vendorDir, join(backup, 'vendor'), { recursive: true });
  await cp(upstreamLockPath, join(backup, 'rhwp-upstream.json'));
  await cp(studioOverrideManifestPath, join(backup, 'rhwp-studio-overrides.json'));
  for (const [index, relativePath] of studioMirroredAssetPaths.entries()) {
    await cp(join(studioHostDir, relativePath), join(backup, `studio-asset-${index}`));
  }
  for (const [index, root] of cargoRoots.entries()) {
    await cp(join(root, 'Cargo.lock'), join(backup, `Cargo-${index}.lock`));
    await cp(join(root, 'Cargo.toml'), join(backup, `Cargo-${index}.toml`));
  }
}

async function restoreOwnedFiles(backup) {
  await rm(vendorDir, { recursive: true, force: true });
  await cp(join(backup, 'vendor'), vendorDir, { recursive: true });
  await cp(join(backup, 'rhwp-upstream.json'), upstreamLockPath);
  await cp(join(backup, 'rhwp-studio-overrides.json'), studioOverrideManifestPath);
  for (const [index, relativePath] of studioMirroredAssetPaths.entries()) {
    await cp(join(backup, `studio-asset-${index}`), join(studioHostDir, relativePath));
  }
  for (const [index, root] of cargoRoots.entries()) {
    await cp(join(backup, `Cargo-${index}.lock`), join(root, 'Cargo.lock'));
    await cp(join(backup, `Cargo-${index}.toml`), join(root, 'Cargo.toml'));
  }
}

function changedStudioInputs(previous, next) {
  const changed = [];
  for (const field of ['counterparts', 'assets']) {
    const before = previous.upstream?.[field] ?? {};
    const after = next.upstream?.[field] ?? {};
    const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const id of ids) {
      if (before[id] !== after[id]) changed.push(field === 'assets' ? `asset:${id}` : id);
    }
  }
  return changed.sort();
}
