import { defineConfig } from 'vite';
import { basename, relative, resolve } from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const upstreamSrc = resolve(__dirname, '../../third_party/rhwp/rhwp-studio/src');
const hopSrc = resolve(__dirname, 'src');
const rhwpCore = resolve(__dirname, 'node_modules/@rhwp/core/rhwp.js');
const fontAssetsDir = resolve(__dirname, '../../assets/fonts');

const hopOverride = (id: string) => ({
  find: `@/${id}`,
  replacement: resolve(hopSrc, id),
});

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
  plugins: [hopFontAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: [
      hopOverride('core/font-loader'),
      hopOverride('core/bridge-factory'),
      hopOverride('core/desktop-events'),
      hopOverride('core/tauri-bridge'),
      hopOverride('command/shortcut-map'),
      hopOverride('command/commands/file'),
      hopOverride('ui/custom-select'),
      hopOverride('ui/dialog'),
      hopOverride('ui/print-dialog'),
      hopOverride('ui/toolbar'),
      hopOverride('styles/custom-select.css'),
      hopOverride('styles/font-set-dialog.css'),
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
        fontAssetsDir,
        resolve(__dirname, '../../third_party/rhwp/rhwp-studio'),
      ],
    },
  },
});
