import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { isDeepStrictEqual } from 'node:util';
import {
  cargoLockPackageEntries, parsePackageVersion, run, upstreamDir,
} from './rhwp-upstream.mjs';

// Paths in the contract are relative to the immutable upstream checkout.
export function cargoPatchPath(patch, cargoRoot) {
  assert.ok(cargoRoot, 'a Cargo root is required for a path patch');
  assert.match(patch.path, /^vendor\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/);
  return relative(cargoRoot, resolve(upstreamDir, patch.path)).replaceAll('\\', '/');
}

export async function readPathCargoPatch(crateName, path, sourceRoot = upstreamDir) {
  assert.match(path, /^vendor\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/);
  const root = await realpath(sourceRoot);
  const directory = await realpath(join(root, path));
  assertInside(root, directory);
  assert.equal(run('git', ['status', '--porcelain', '--untracked-files=all', '--', path], { cwd: root }),
    '', 'vendor patch must be a clean part of the pinned upstream checkout');
  assert.ok(run('git', ['ls-files', '--', `${path}/Cargo.toml`], { cwd: root }),
    'vendor package manifest must be tracked by upstream');
  const toml = await readFile(join(directory, 'Cargo.toml'), 'utf8');
  assert.equal(parse(toml).package?.name, crateName);
  return { path, version: parsePackageVersion(toml) };
}

function assertInside(root, path) {
  const rel = relative(root, path);
  assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'),
    'vendor patch must stay inside its source directory');
}

export function cargoPatchDeclaration(patch, cargoRoot) {
  return patch.path
    ? { path: cargoPatchPath(patch, cargoRoot) }
    : { git: patch.git, rev: patch.rev };
}

export function synchronizeCargoPatchToml(toml, previousPatches, nextPatches, cargoRoot) {
  const manifest = parse(toml);
  const current = manifest.patch?.['crates-io'] ?? {};
  for (const [crateName, patch] of Object.entries(previousPatches)) {
    assert.deepEqual({ ...current[crateName] }, cargoPatchDeclaration(patch, cargoRoot),
      `Cargo.toml patch ${crateName} does not match the current upstream contract`);
  }
  if (isDeepStrictEqual(previousPatches, nextPatches)) return toml;
  const next = { ...current };
  for (const crateName of new Set([...Object.keys(previousPatches), ...Object.keys(nextPatches)])) {
    if (nextPatches[crateName]) next[crateName] = cargoPatchDeclaration(nextPatches[crateName], cargoRoot);
    else delete next[crateName];
  }
  if (Object.keys(next).length) {
    manifest.patch ??= {};
    manifest.patch['crates-io'] = next;
  } else {
    delete manifest.patch['crates-io'];
    if (!Object.keys(manifest.patch).length) delete manifest.patch;
  }
  return stringify(manifest);
}

export function cargoLockHasPatchSource(lock, crateName, patch) {
  if (patch.path) {
    const entries = cargoLockPackageEntries(lock, crateName);
    return entries.length === 1 && entries[0].version === patch.version && !entries[0].source;
  }
  return cargoLockPackageEntries(lock, crateName).some(({ source }) => {
    const parsed = source?.match(/^git\+([^?#]+)(?:\?[^#]*)?#([0-9a-f]{40})$/);
    return parsed?.[1] === patch.git && parsed[2] === patch.rev;
  });
}

// The immutable upstream manifest owns the PDF backend's package, path and version.
export async function readPdfBackend(cargoToml, sourceRoot = upstreamDir) {
  const dependency = parse(cargoToml).target?.['cfg(not(target_arch = "wasm32"))']?.dependencies?.svg2pdf;
  // Older releases use a registry dependency with a separate root patch.
  if (typeof dependency === 'string') return null;
  assert.ok(dependency?.path, 'upstream native SVG-to-PDF dependency must be vendored');
  const packageName = dependency.package ?? 'svg2pdf';
  const vendor = await readPathCargoPatch(packageName, dependency.path, sourceRoot);
  assert.equal(dependency.version, `=${vendor.version}`, 'upstream PDF dependency must pin its vendor version');
  return { package: packageName, ...vendor };
}
