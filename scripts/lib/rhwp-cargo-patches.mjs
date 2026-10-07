import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  cargoLockPackageEntries, escapeRegExp, parsePackageVersion,
  replaceTomlSection, run, tomlSection, upstreamDir,
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
  assert.match(tomlSection(toml, 'package'), new RegExp(`^name\\s*=\\s*"${escapeRegExp(crateName)}"`, 'm'));
  return { path, version: parsePackageVersion(toml) };
}

function assertInside(root, path) {
  const rel = relative(root, path);
  assert.ok(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'),
    'vendor patch must stay inside its source directory');
}

export function cargoPatchTomlPattern(crateName, patch, cargoRoot) {
  const crate = escapeRegExp(crateName);
  if (patch.path) {
    const path = escapeRegExp(cargoPatchPath(patch, cargoRoot));
    return new RegExp(`^${crate}\\s*=\\s*\\{(?=[^}]*path\\s*=\\s*"${path}")[^}]*\\}[^\\S\\r\\n]*$`, 'm');
  }
  const git = escapeRegExp(patch.git);
  const rev = escapeRegExp(patch.rev);
  return new RegExp(
    `^${crate}\\s*=\\s*\\{(?=[^}]*git\\s*=\\s*"${git}")(?=[^}]*rev\\s*=\\s*"${rev}")[^}]*\\}[^\\S\\r\\n]*$`,
    'm',
  );
}

export function synchronizeCargoPatchToml(toml, previousPatches, nextPatches, cargoRoot) {
  let patchSection = tomlSection(toml, 'patch.crates-io');
  for (const [crateName, patch] of Object.entries(previousPatches)) {
    if (!cargoPatchTomlPattern(crateName, patch, cargoRoot).test(patchSection)) {
      throw new Error(`Cargo.toml patch ${crateName} does not match the current upstream contract`);
    }
  }

  const crateNames = new Set([...Object.keys(previousPatches), ...Object.keys(nextPatches)]);
  for (const crateName of crateNames) {
    const linePattern = new RegExp(`^${escapeRegExp(crateName)}\\s*=\\s*\\{[^}]*\\}[^\\S\\r\\n]*$`, 'm');
    const next = nextPatches[crateName];
    if (!next) {
      patchSection = patchSection.replace(new RegExp(`${linePattern.source}\\r?\\n?`, 'm'), '');
      continue;
    }

    const fields = next.path
      ? `path = ${JSON.stringify(cargoPatchPath(next, cargoRoot))}`
      : `git = ${JSON.stringify(next.git)}, rev = ${JSON.stringify(next.rev)}`;
    const declaration = `${crateName} = { ${fields} }`;
    if (linePattern.test(patchSection)) {
      patchSection = patchSection.replace(linePattern, declaration);
      continue;
    }
    patchSection = `${patchSection.trimEnd()}${patchSection ? '\n' : ''}${declaration}\n`;
  }
  return replaceTomlSection(toml, 'patch.crates-io', patchSection);
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
