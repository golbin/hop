import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import init, { HwpDocument, version } from '../apps/studio-host/vendor/rhwp-core/rhwp.js';

const lock = JSON.parse(await readFile(new URL('../config/rhwp-upstream.json', import.meta.url)));
await init({ module_or_path: await readFile(
  new URL('../apps/studio-host/vendor/rhwp-core/rhwp_bg.wasm', import.meta.url),
) });

test('shipped WASM keeps HOP document support without the unused PDF importer', () => {
  assert.equal(version(), lock.version);
  assert.equal(HwpDocument.supportsPdfImport(), false);
});

for (const format of ['hwp', 'hwpx', 'encrypted-hwp', 'encrypted-hwpx']) {
  test(`shipped WASM edits, renders and round-trips ${format}`, () => {
    const document = HwpDocument.createEmpty();
    const text = 'HOP 한글 편집·저장 검증';
    const password = format.startsWith('encrypted-') ? 'hop-test' : undefined;
    let reopened;
    try {
      document.createBlankDocument();
      document.insertText(0, 0, 0, text);
      const bytes = format.endsWith('hwpx')
        ? (password ? document.exportHwpxWithPassword(password) : document.exportHwpx())
        : (password ? document.exportHwpWithPassword(password) : document.exportHwp());
      if (password) {
        assert.throws(() => new HwpDocument(bytes));
        assert.throws(() => HwpDocument.openWithPassword(bytes, 'wrong-password'));
      }
      reopened = password ? HwpDocument.openWithPassword(bytes, password) : new HwpDocument(bytes);
      assert.ok(reopened.getTextFileText().includes(text));
      assert.ok(reopened.pageCount() >= 1);
      assert.match(reopened.renderPageSvg(0), /<svg/);
    } finally {
      reopened?.free();
      document.free();
    }
  });
}
