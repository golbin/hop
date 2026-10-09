import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
  const packageBlock = tomlSection(toml, 'package');
  let version = packageBlock.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (/^version\s*=\s*\{\s*workspace\s*=\s*true\s*\}/m.test(packageBlock)) {
    version = tomlSection(toml, 'workspace.package').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  }
  if (!version) throw new Error('Unable to read rhwp package version from Cargo.toml');
  return version;
}

export function parseRustToolchain(toml) {
  const channel = toml.match(/^channel\s*=\s*"([^"]+)"/m)?.[1];
  if (!channel) throw new Error('Unable to read rhwp Rust toolchain');
  return channel;
}

export function tomlSection(toml, name) {
  const range = tomlSectionRange(toml, name);
  return range ? toml.slice(range.start, range.end) : '';
}

function tomlSectionRange(toml, name) {
  const escapedName = escapeRegExp(name);
  const header = toml.match(new RegExp(`^\\[${escapedName}\\][^\\S\\r\\n]*$`, 'm'));
  if (!header || header.index === undefined) return null;
  const afterHeader = header.index + header[0].length;
  const newlineLength = toml.slice(afterHeader).match(/^\r?\n/)?.[0].length ?? 0;
  const start = afterHeader + newlineLength;
  const nextSection = toml.slice(start).search(/^\[/m);
  return { start, end: nextSection === -1 ? toml.length : start + nextSection };
}

export function replaceTomlSection(toml, name, contents) {
  const range = tomlSectionRange(toml, name);
  if (!range) {
    if (!contents) return toml;
    return `${toml.trimEnd()}\n\n[${name}]\n${contents}`;
  }
  return `${toml.slice(0, range.start)}${contents}${toml.slice(range.end)}`;
}

export function cargoLockPackageVersion(lock, packageName) {
  return cargoLockPackageEntries(lock, packageName)[0]?.version;
}

export function cargoLockPackageEntries(lock, packageName) {
  return lock.split(/^\[\[package\]\]\s*$/m).slice(1).flatMap((block) => {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    if (name !== packageName) return [];
    return [{
      version: block.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
      source: block.match(/^source\s*=\s*"([^"]+)"/m)?.[1],
    }];
  });
}

export async function artifactMetadata(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

// Git may check out source text as CRLF on Windows. Source baselines describe
// repository text; generated artifact provenance continues to hash exact bytes.
export async function sourceTextHash(path) {
  const text = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
  return createHash('sha256').update(text).digest('hex');
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
    ...(lock.fork ? { fork: lock.fork } : {}),
    artifacts,
  };
}

export async function buildStudioOverrideBaseline(manifest, upstream) {
  const counterparts = {};
  for (const entry of manifest.overrides) {
    if (entry.strategy !== 'extension' && entry.strategy !== 'fork') continue;
    const relativePath = entry.id.endsWith('.css') ? entry.id : `${entry.id}.ts`;
    counterparts[entry.id] = await sourceTextHash(join(upstreamStudioDir, relativePath));
  }
  const assets = {};
  for (const relativePath of studioMirroredAssetPaths) {
    assets[relativePath] = await sourceTextHash(join(upstreamDir, 'rhwp-studio', relativePath));
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

// A downstream patch retains the official release identity and records its
// actual source separately. Moving branches are never accepted as pins.
export function pinnedEngineSource(lock) {
  assert.equal(normalizeGitSource(lock.source), officialUpstreamSource);
  if (!lock.fork) return officialUpstreamSource;
  assert.match(lock.fork.source, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.notEqual(lock.fork.source, officialUpstreamSource);
  assert.match(lock.fork.baseCommit, /^[0-9a-f]{40}$/);
  assert.ok(typeof lock.fork.reason === 'string' && lock.fork.reason.trim().length > 0);
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  return lock.fork.source;
}

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
