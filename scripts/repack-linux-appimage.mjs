// Use the system WebKitGTK runtime and keep its GTK/GLib/IME stack together,
// rather than mixing it with copies from the Ubuntu build runner.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const image = resolve(process.argv[2] ?? '');
if (process.platform !== 'linux' || process.arch !== 'x64' || !process.argv[2]) {
  throw new Error('Usage on Linux x64: node scripts/repack-linux-appimage.mjs <Tauri AppImage>');
}
const { productName } = JSON.parse(readFileSync(new URL('../apps/desktop/src-tauri/tauri.conf.json', import.meta.url)));
const source = join(dirname(image), `${productName}.AppDir`);
const executable = readFileSync(join(source, 'usr/bin/hop-desktop'));
const marker = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_APP');
if (executable.indexOf(marker) < 0 || executable.indexOf(marker) !== executable.lastIndexOf(marker)) {
  throw new Error('Expected the Tauri AppImage executable with its updater marker');
}
const temporary = mkdtempSync(join(tmpdir(), 'hop-appimage-'));
try {
  const tool = join(temporary, 'appimagetool.AppImage');
  const response = await fetch('https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage');
  if (!response.ok) throw new Error(`appimagetool download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== 'ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0') {
    throw new Error('appimagetool SHA-256 mismatch');
  }
  writeFileSync(tool, bytes, { mode: 0o755 });
  chmodSync(image, 0o755);
  const offset = Number(execFileSync(image, ['--appimage-offset'], { encoding: 'utf8' }).trim());
  const original = readFileSync(image);
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset >= original.length) {
    throw new Error('Invalid AppImage runtime offset');
  }
  const runtime = join(temporary, 'runtime');
  writeFileSync(runtime, original.subarray(0, offset));

  const appDir = join(temporary, `${productName}.AppDir`);
  cpSync(realpathSync(source), appDir, { recursive: true, verbatimSymlinks: true });
  // The fallback AppRun supplies LD_LIBRARY_PATH. Without an embedded rpath,
  // the same executable can also load the complete system runtime.
  execFileSync('patchelf', ['--remove-rpath', join(appDir, 'usr/bin/hop-desktop')]);
  writeFileSync(join(appDir, 'AppRun'), `#!/usr/bin/env bash
set -e
APPDIR=\${APPDIR:-$(readlink -f "$(dirname "$0")")}
export APPDIR
if /lib64/ld-linux-x86-64.so.2 --list "$APPDIR/usr/bin/hop-desktop" >/dev/null 2>&1; then
  exec "$APPDIR/usr/bin/hop-desktop" "$@"
fi
# Preserve standalone execution when the system WebKitGTK runtime is unavailable.
hop_backend_set=\${GDK_BACKEND+x}
hop_backend=\${GDK_BACKEND-}
. "$APPDIR/apprun-hooks/linuxdeploy-plugin-gtk.sh"
if [ "$hop_backend_set" = x ]; then export GDK_BACKEND="$hop_backend"; fi
exec "$APPDIR/AppRun.wrapped" "$@"
`, { mode: 0o755 });

  const output = join(dirname(image), `${productName}-repacked.AppImage`);
  try {
    execFileSync(tool, ['--appimage-extract-and-run', '--runtime-file', runtime, '--comp', 'zstd',
      '--mksquashfs-opt=-Xcompression-level', '--mksquashfs-opt=22', appDir, output], {
      env: { ...process.env, ARCH: 'x86_64' }, stdio: 'inherit',
    });
    renameSync(output, image);
    // The old signature covers different bytes. The release workflow signs again.
    rmSync(`${image}.sig`, { force: true });
  } finally {
    rmSync(output, { force: true });
  }
  console.log('Repacked AppImage to prefer system WebKitGTK, retaining its standalone runtime');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
