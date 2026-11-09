import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('../apps/desktop/linux/AppRun', import.meta.url));
const options = { skip: process.platform !== 'linux' || process.arch !== 'x64' };

function runLauncher(environmentFor, { fallback = false, workingDirectory = 'current' } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'hop appimage 한글 [test] '));
  const appDir = join(root, 'current');
  const old = join(root, 'unmounted-old');
  const kept = join(root, 'user GTK');
  try {
    mkdirSync(join(appDir, 'usr/bin'), { recursive: true });
    if (workingDirectory !== 'current') mkdirSync(join(old, 'usr'), { recursive: true });
    // A real ELF lets the launcher exercise its loader probe and print only
    // this test's controlled environment, without starting a WebView.
    const executable = join(appDir, 'usr/bin/hop-desktop');
    copyFileSync('/usr/bin/env', executable);
    chmodSync(executable, 0o755);
    if (fallback) {
      copyFileSync(executable, join(appDir, 'AppRun.wrapped'));
      writeFileSync(executable, '#!/bin/sh\nexit 1\n');
      mkdirSync(join(appDir, 'apprun-hooks'));
      writeFileSync(join(appDir, 'apprun-hooks/linuxdeploy-plugin-gtk.sh'),
        'export GDK_BACKEND=x11 GTK_IM_MODULE_FILE="$APPDIR/cache" GTK_PATH="$APPDIR/modules"\n');
    }
    const probe = 'printf "HOP_LAUNCHER_CWD=%s\\0" "$(pwd -P)"; exec env -0';
    const args = workingDirectory === 'removed'
      ? ['-c', 'rmdir "$1" "$2"; PWD="$HOME" exec bash "$3" /bin/sh -c "$4"',
        'hop-deleted-cwd', join(old, 'usr'), old, launcher, probe]
      : [launcher, '/bin/sh', '-c', probe];
    const output = execFileSync('bash', args, {
      env: { HOME: homedir(), PATH: '/usr/bin:/bin', APPDIR: appDir, ...environmentFor(old, kept) },
      encoding: 'utf8', stdio: 'pipe',
      cwd: workingDirectory === 'current' ? appDir : join(old, 'usr'),
    });
    const environment = Object.fromEntries(output.split('\0').filter(Boolean).map((field) => {
      const separator = field.indexOf('=');
      return [field.slice(0, separator), field.slice(separator + 1)];
    }));
    return { environment, appDir, kept };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('AppImage relaunch discards paths owned by an unavailable old bundle', options, () => {
  const { environment, appDir } = runLauncher((old) => ({
    GTK_DATA_PREFIX: old, GTK_EXE_PREFIX: `${old}//usr`,
    LD_LIBRARY_PATH: `${old}/usr/lib`, PATH: `${old}/usr/bin:/usr/bin:/bin`,
    GTK_IM_MODULE_FILE: `${old}//usr/lib/gtk-3.0/immodules.cache`,
    GSETTINGS_SCHEMA_DIR: `${old}/usr/share/glib-2.0/schemas`,
    PYTHONHOME: `${old}/usr`, GST_PLUGIN_SYSTEM_PATH: `${old}/usr/lib/gstreamer-1.0`,
  }));
  for (const name of ['GTK_DATA_PREFIX', 'GTK_EXE_PREFIX', 'LD_LIBRARY_PATH', 'GTK_IM_MODULE_FILE',
    'GSETTINGS_SCHEMA_DIR', 'PYTHONHOME', 'GST_PLUGIN_SYSTEM_PATH']) {
    assert.equal(environment[name], undefined, name);
  }
  assert.equal(environment.PATH, '/usr/bin:/bin');
  assert.equal(environment.APPDIR, appDir);
  assert.equal(environment.HOP_LAUNCHER_CWD, appDir);
});

test('AppImage relaunch preserves user paths and logical input/backend choices', options, () => {
  const { environment, kept } = runLauncher((old, kept) => ({
    GTK_DATA_PREFIX: old, GTK_EXE_PREFIX: `${old}/usr`,
    LD_LIBRARY_PATH: `${old}/usr/lib:${kept}/lib:`,
    GTK_PATH: `${old}//usr/lib/gtk-3.0:${kept}/modules`,
    GTK_IM_MODULE_FILE: `${kept}/immodules.cache`,
    PYTHONPATH: `${kept}/python:${old}/usr/python`,
    GTK_IM_MODULE: 'fcitx', GDK_BACKEND: 'wayland',
  }));
  assert.equal(environment.LD_LIBRARY_PATH, `${kept}/lib:`);
  assert.equal(environment.GTK_PATH, `${kept}/modules`);
  assert.equal(environment.GTK_IM_MODULE_FILE, `${kept}/immodules.cache`);
  assert.equal(environment.PYTHONPATH, `${kept}/python`);
  assert.equal(environment.GTK_IM_MODULE, 'fcitx');
  assert.equal(environment.GDK_BACKEND, 'wayland');
});

test('a user GTK prefix is retained without the generated AppImage prefix pair', options, () => {
  const { environment, kept } = runLauncher((_old, kept) => ({
    GTK_DATA_PREFIX: kept, GTK_EXE_PREFIX: kept,
    GTK_PATH: `${kept}/modules`, LD_LIBRARY_PATH: `${kept}/lib`,
  }));
  assert.equal(environment.GTK_DATA_PREFIX, kept);
  assert.equal(environment.GTK_EXE_PREFIX, kept);
  assert.equal(environment.GTK_PATH, `${kept}/modules`);
  assert.equal(environment.LD_LIBRARY_PATH, `${kept}/lib`);
});

test('empty user overrides remain empty during an AppImage relaunch', options, () => {
  const { environment } = runLauncher((old) => ({
    GTK_DATA_PREFIX: old, GTK_EXE_PREFIX: `${old}/usr`,
    GTK_PATH: '', GTK_IM_MODULE_FILE: '', PYTHONPATH: '',
  }));
  for (const name of ['GTK_PATH', 'GTK_IM_MODULE_FILE', 'PYTHONPATH']) {
    assert.equal(environment[name], '');
  }
});

test('bundled fallback preserves explicit backend and GTK module overrides', options, () => {
  const { environment, kept } = runLauncher((_old, kept) => ({
    GDK_BACKEND: 'wayland', GTK_IM_MODULE_FILE: `${kept}/cache`, GTK_PATH: '',
  }), { fallback: true });
  assert.equal(environment.GDK_BACKEND, 'wayland');
  assert.equal(environment.GTK_IM_MODULE_FILE, `${kept}/cache`);
  assert.equal(environment.GTK_PATH, '');
});

test('AppImage relaunch leaves the previous bundle working directory', options, () => {
  const { environment } = runLauncher((old) => ({
    GTK_DATA_PREFIX: old, GTK_EXE_PREFIX: `${old}/usr`,
  }), { workingDirectory: 'previous' });
  assert.equal(environment.HOP_LAUNCHER_CWD, realpathSync(homedir()));
});

test('AppImage relaunch recovers when its previous working directory is gone', options, () => {
  const { environment } = runLauncher((old) => ({
    GTK_DATA_PREFIX: old, GTK_EXE_PREFIX: `${old}/usr`,
  }), { workingDirectory: 'removed' });
  assert.equal(environment.HOP_LAUNCHER_CWD, realpathSync(homedir()));
});
