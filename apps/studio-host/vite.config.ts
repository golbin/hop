import { defineConfig, normalizePath } from 'vite';
import { basename, dirname, relative, resolve } from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createHopOverrides } from './hop-overrides';

const desktopConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../desktop/src-tauri/tauri.conf.json'), 'utf-8'),
);
const upstreamStudioDir = resolve(__dirname, '../../third_party/rhwp/rhwp-studio');
const upstreamSrc = resolve(__dirname, '../../third_party/rhwp/rhwp-studio/src');
const hopSrc = resolve(__dirname, 'src');
const rhwpWasmModule = normalizePath(resolve(__dirname, 'vendor/rhwp-core/rhwp.js'));
const rhwpWasmDir = dirname(rhwpWasmModule);
const rhwpWasmPackage = JSON.parse(readFileSync(resolve(rhwpWasmDir, 'package.json'), 'utf-8'));
const fontAssetsDir = resolve(__dirname, '../../assets/fonts');

function hopFontAssets(): Plugin {
  return {
    name: 'hop-font-assets',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const fontName = basename(decodePath(req.url?.split('?')[0] ?? ''));
        if (!fontName.endsWith('.woff2')) {
          next();
          return;
        }

        const fontPath = resolve(fontAssetsDir, fontName);
        const relativeFontPath = relative(fontAssetsDir, fontPath);
        if (relativeFontPath.startsWith('..') || relativeFontPath === '' || !existsSync(fontPath)) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'font/woff2');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(fontPath).pipe(res);
      });
    },
    closeBundle() {
      const outDir = resolve(__dirname, 'dist/fonts');
      mkdirSync(outDir, { recursive: true });
      for (const fileName of readdirSync(fontAssetsDir)) {
        const source = resolve(fontAssetsDir, fileName);
        if (!fileName.endsWith('.woff2') || !statSync(source).isFile()) continue;
        copyFileSync(source, resolve(outDir, fileName));
      }
    },
  };
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return '';
  }
}

export default defineConfig({
  base: './',
  plugins: [hopFontAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(rhwpWasmPackage.version),
    __HOP_VERSION__: JSON.stringify(desktopConfig.version),
  },
  resolve: {
    alias: [
      ...createHopOverrides(hopSrc),
      { find: '@wasm/rhwp.js', replacement: rhwpWasmModule },
      { find: '@upstream', replacement: upstreamSrc },
      { find: '@', replacement: upstreamSrc },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 7700,
    fs: {
      allow: [
        __dirname,
        rhwpWasmDir,
        fontAssetsDir,
        upstreamStudioDir,
      ],
    },
  },
});
