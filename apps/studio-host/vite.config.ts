import { defineConfig, normalizePath } from 'vite';
import { createRequire } from 'node:module';
import { basename, dirname, relative, resolve } from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createHopOverrides } from './hop-overrides';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const desktopConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../desktop/src-tauri/tauri.conf.json'), 'utf-8'),
);
const upstreamSrc = resolve(__dirname, '../../third_party/rhwp/rhwp-studio/src');
const hopSrc = resolve(__dirname, 'src');
const rhwpCore = normalizePath(require.resolve('@rhwp/core/rhwp.js'));
const rhwpCoreDir = dirname(rhwpCore);
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
    __APP_VERSION__: JSON.stringify(pkg.version),
    __HOP_VERSION__: JSON.stringify(desktopConfig.version),
  },
  resolve: {
    alias: [
      ...createHopOverrides(hopSrc),
      { find: '@wasm/rhwp.js', replacement: rhwpCore },
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
        rhwpCoreDir,
        fontAssetsDir,
        resolve(__dirname, '../../third_party/rhwp/rhwp-studio'),
      ],
    },
  },
});
