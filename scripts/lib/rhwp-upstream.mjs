import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'smol-toml';

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const upstreamDir = join(repoRoot, 'third_party/rhwp');
export const upstreamLockPath = join(repoRoot, 'config/rhwp-upstream.json');
export const studioOverrideManifestPath = join(repoRoot, 'config/rhwp-studio-overrides.json');
export const upstreamStudioDir = join(upstreamDir, 'rhwp-studio/src');
export const studioHostDir = join(repoRoot, 'apps/studio-host');
export const vendorDir = join(repoRoot, 'apps/studio-host/vendor/rhwp-core');
export const provenancePath = join(vendorDir, 'PROVENANCE.json');
export const cargoRoots = [
  join(repoRoot, 'apps/desktop/src-tauri'),
  join(repoRoot, 'apps/desktop/quicklook/rust'),
];
export const officialUpstreamSource = 'https://github.com/edwardkim/rhwp';

export const generatedArtifactNames = [
  'rhwp_bg.wasm',
  'rhwp.js',
  'rhwp.d.ts',
  'rhwp_bg.wasm.d.ts',
];
export const vendoredArtifactNames = [
  ...generatedArtifactNames,
  'package.json',
  'LICENSE',
];
export const studioMirroredAssetPaths = ['public/images/icon_small_ko_dark.svg'];

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.stdio ?? 'pipe',
  });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${details ? `\n${details}` : ''}`);
  }
  return result.stdout?.trim() ?? '';
}

export function parsePackageVersion(toml) {
  const manifest = parse(toml);
  const version = manifest.package?.version?.workspace
    ? manifest.workspace?.package?.version : manifest.package?.version;
  if (typeof version !== 'string') throw new Error('Unable to read rhwp package version from Cargo.toml');
  return version;
}

export function parseRustToolchain(toml) {
  const channel = parse(toml).toolchain?.channel;
  if (typeof channel !== 'string') throw new Error('Unable to read rhwp Rust toolchain');
  return channel;
}

export function cargoLockPackageVersion(lock, packageName) {
  return cargoLockPackageEntries(lock, packageName)[0]?.version;
}

export function cargoLockPackageEntries(lock, packageName) {
  return (parse(lock).package ?? []).filter(({ name }) => name === packageName)
    .map(({ version, source }) => ({ version, source }));
}

export async function artifactMetadata(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function repoRelativePath(path) {
  return relative(repoRoot, path).replaceAll('\\', '/');
}

export async function buildProvenance(lock) {
  const artifacts = {};
  for (const name of vendoredArtifactNames) {
    artifacts[name] = await artifactMetadata(join(vendorDir, name));
  }
  return {
    schemaVersion: 1,
    source: lock.source,
    version: lock.version,
    tag: lock.tag,
    commit: lock.commit,
    rustToolchain: lock.rustToolchain,
    wasmPackVersion: lock.wasmPackVersion,
    artifacts,
  };
}

export async function buildStudioOverrideBaseline(manifest, upstream) {
  const counterparts = {};
  for (const entry of manifest.overrides) {
    if (entry.strategy !== 'extension' && entry.strategy !== 'fork') continue;
    const relativePath = entry.id.endsWith('.css') ? entry.id : `${entry.id}.ts`;
    counterparts[entry.id] = (await artifactMetadata(join(upstreamStudioDir, relativePath))).sha256;
  }
  const assets = {};
  for (const relativePath of studioMirroredAssetPaths) {
    assets[relativePath] = (await artifactMetadata(join(upstreamDir, 'rhwp-studio', relativePath))).sha256;
  }
  return {
    version: upstream.version,
    commit: upstream.commit,
    counterparts,
    assets,
  };
}

export function currentUpstreamCommit() {
  return run('git', ['rev-parse', 'HEAD'], { cwd: upstreamDir });
}

export function assertStableTag(tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Expected a stable release tag such as v0.7.19, received: ${tag}`);
  }
}

export function parseUpdateTag(args) {
  const operands = args[0] === '--' ? args.slice(1) : args;
  if (operands.length !== 1 || operands[0].startsWith('--')) return null;
  return operands[0];
}

export function normalizeGitSource(source) {
  let normalized = source.trim();
  const scpStyle = normalized.match(/^git@([^:]+):(.+)$/);
  if (scpStyle) normalized = `https://${scpStyle[1]}/${scpStyle[2]}`;
  normalized = normalized.replace(/^ssh:\/\/git@/, 'https://');
  return normalized.replace(/\.git\/?$/, '').replace(/\/$/, '');
}
