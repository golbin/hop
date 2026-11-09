#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quicklookRoot = join(repoRoot, 'apps/desktop/quicklook');
const rustRoot = join(quicklookRoot, 'rust');
const ffiHeader = join(quicklookRoot, 'Sources/Shared/HopQuickLookFFI.h');
const tauriTargetRoot = join(repoRoot, 'apps/desktop/src-tauri/target');
const stagingRoot = join(tauriTargetRoot, 'quicklook');
const plugInsDir = join(stagingRoot, 'PlugIns');
const libDir = join(stagingRoot, 'Frameworks');

if (process.platform !== 'darwin') {
  console.log('[quicklook] non-macOS platform; skipping Quick Look extension build');
  process.exit(0);
}

const target = process.env.HOP_MACOS_TARGET || defaultMacTarget();
const swiftTarget = target === 'x86_64-apple-darwin'
  ? 'x86_64-apple-macosx12.0'
  : 'aarch64-apple-macosx12.0';
const releaseDir = join(rustRoot, 'target', target, 'release');
const sharedLib = join(releaseDir, 'libhop_quicklook_ffi.dylib');
const stagedSharedLib = join(libDir, 'libhop_quicklook_ffi.dylib');

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(plugInsDir, { recursive: true });
mkdirSync(libDir, { recursive: true });

buildRustSharedLibrary(stagedSharedLib);

buildExtension({
  moduleName: 'HopQuickLookPreview',
  appexName: 'HopQuickLookPreview.appex',
  sharedLib: stagedSharedLib,
  infoPlist: join(quicklookRoot, 'Resources/Preview/Info.plist'),
  sources: [
    join(quicklookRoot, 'Sources/Shared/HopQuickLookFFI.swift'),
    join(quicklookRoot, 'Sources/Preview/HwpPreviewProvider.swift'),
  ],
  frameworks: [
    'CoreFoundation',
    'CoreGraphics',
    'CoreText',
    'Foundation',
    'QuickLookUI',
    'UniformTypeIdentifiers',
    'OSLog',
  ],
});

buildExtension({
  moduleName: 'HopQuickLookThumbnail',
  appexName: 'HopQuickLookThumbnail.appex',
  sharedLib: stagedSharedLib,
  infoPlist: join(quicklookRoot, 'Resources/Thumbnail/Info.plist'),
  sources: [
    join(quicklookRoot, 'Sources/Shared/HopQuickLookFFI.swift'),
    join(quicklookRoot, 'Sources/Thumbnail/HwpThumbnailProvider.swift'),
  ],
  frameworks: [
    'CoreGraphics',
    'CoreFoundation',
    'CoreText',
    'Foundation',
    'ImageIO',
    'QuickLookThumbnailing',
    'UniformTypeIdentifiers',
    'OSLog',
  ],
});

console.log(`[quicklook] staged extensions in ${plugInsDir}`);

function buildRustSharedLibrary(output) {
  const args = [
    'build',
    '--manifest-path',
    join(rustRoot, 'Cargo.toml'),
    '--locked',
    '--release',
    '--target',
    target,
  ];
  run('cargo', args);

  if (!existsSync(sharedLib)) {
    throw new Error(`Quick Look Rust shared library was not produced: ${sharedLib}`);
  }
  copyFileSync(sharedLib, output);
  run('xcrun', ['install_name_tool', '-id', '@rpath/libhop_quicklook_ffi.dylib', output]);
  run('xcrun', ['strip', '-S', '-x', output]);
  sign(output);
}

function buildExtension({ moduleName, appexName, sharedLib, infoPlist, sources, frameworks }) {
  const appexDir = join(plugInsDir, appexName);
  const contentsDir = join(appexDir, 'Contents');
  const macosDir = join(contentsDir, 'MacOS');
  mkdirSync(macosDir, { recursive: true });
  cpSync(infoPlist, join(contentsDir, 'Info.plist'));

  const output = join(macosDir, moduleName);
  linkSwift({ moduleName, sources, sharedLib, frameworks, output, entry: '_NSExtensionMain' });

  // Exercise the same optimized Swift/Rust link, including dynamic class lookup.
  // Cross-compiled extensions are exercised by their native CI runner instead.
  if (target === defaultMacTarget()) {
    const smoke = join(macosDir, `${moduleName}-smoke`);
    linkSwift({
      moduleName, sharedLib, frameworks, output: smoke, entry: '_main',
      sources: [...sources, join(quicklookRoot, 'Tests/LinkSmoke.swift')],
      defines: moduleName === 'HopQuickLookPreview' ? ['HOP_PREVIEW'] : [],
    });
    sign(smoke);
    run(smoke, [join(repoRoot, 'third_party/rhwp/samples/text-align-2.hwp')]);
    rmSync(smoke);
  }

  sign(appexDir, ['--entitlements', join(quicklookRoot, 'Resources/Extension.entitlements')]);
}

function sign(path, extraArgs = []) {
  const identity = process.env.APPLE_SIGNING_IDENTITY || '-';
  const timestampArgs = identity === '-' ? ['--timestamp=none'] : ['--timestamp'];
  run('codesign', [
    '--force', '--sign', identity, ...timestampArgs,
    // Ad-hoc development signatures have no Team ID for library validation.
    ...(identity === '-' ? [] : ['--options', 'runtime']), ...extraArgs, path,
  ]);
}

function linkSwift({ moduleName, sources, sharedLib, frameworks, output, entry, defines = [] }) {
  const swiftArgs = [
    '-target',
    swiftTarget,
    '-O',
    '-application-extension',
    '-parse-as-library',
    '-emit-executable',
    '-module-name',
    moduleName,
    ...defines.flatMap((define) => ['-D', define]),
    '-import-objc-header',
    ffiHeader,
    '-o',
    output,
    ...sources,
    sharedLib,
    '-Xlinker', '-rpath', '-Xlinker', '@executable_path/../../../../Frameworks',
    '-Xlinker',
    '-dead_strip',
    '-Xlinker',
    '-e',
    '-Xlinker',
    entry,
    ...frameworks.flatMap((framework) => ['-framework', framework]),
  ];
  run('xcrun', ['swiftc', ...swiftArgs]);
  // Strip local/debug symbols before signing, preserving dynamic exports.
  run('xcrun', ['strip', '-S', '-x', output]);
}

function defaultMacTarget() {
  return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
}

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
