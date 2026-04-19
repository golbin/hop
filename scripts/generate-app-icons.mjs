import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourceSvg = join(root, 'assets/logo/logo.svg');
const logoDir = join(root, 'assets/logo');

const pngTargets = [
  ['logo-16.png', 16],
  ['logo-32.png', 32],
  ['logo-48.png', 48],
  ['logo-128.png', 128],
  ['logo-256.png', 256],
  ['logo-300.png', 300],
  ['logo-512.png', 512],
  ['logo-1024.png', 1024],
];

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function renderPng(outPath, size) {
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  run('sips', ['-s', 'format', 'png', '-z', String(size), String(size), sourceSvg, '--out', outPath]);
}

function writeIco(outPath, pngPaths) {
  const headerSize = 6;
  const entrySize = 16;
  const count = pngPaths.length;
  const images = pngPaths.map(path => readFileSync(path));
  const header = Buffer.alloc(headerSize + entrySize * count);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = header.length;
  pngPaths.forEach((path, index) => {
    const image = images[index];
    const size = Number(path.match(/(\d+)\.png$/)?.[1] ?? 0);
    const entry = headerSize + entrySize * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });

  writeFileSync(outPath, Buffer.concat([header, ...images]));
}

function makeIcns(outPath) {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hop-iconset-'));
  const iconset = join(tempRoot, 'AppIcon.iconset');
  mkdirSync(iconset, { recursive: true });
  const entries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];

  try {
    entries.forEach(([name, size]) => renderPng(join(iconset, name), size));
    run('iconutil', ['-c', 'icns', iconset, '-o', outPath]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function copyIfPresent(from, to) {
  if (!existsSync(resolve(to, '..'))) return;
  copyFileSync(from, to);
}

mkdirSync(logoDir, { recursive: true });
pngTargets.forEach(([name, size]) => renderPng(join(logoDir, name), size));
writeIco(join(logoDir, 'favicon.ico'), [16, 32, 48, 256].map(size => join(logoDir, `logo-${size}.png`)));
makeIcns(join(logoDir, 'icon.icns'));

copyFileSync(join(logoDir, 'favicon.ico'), join(root, 'apps/studio-host/public/favicon.ico'));
copyIfPresent(join(logoDir, 'favicon.ico'), join(root, 'apps/studio-host/dist/favicon.ico'));

console.log('Generated app icons from assets/logo/logo.svg');
