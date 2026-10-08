import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentInfo } from '@/upstream/core';
import { loadDocumentForOpen } from './document-open';

const prompt = vi.hoisted(() => vi.fn());
vi.mock('@/upstream/ui', () => ({ showHwpPasswordDialog: prompt }));

const info: DocumentInfo = { pageCount: 1, fontsUsed: [], version: '5.0.3.0', sectionCount: 1, encrypted: true, fallbackFont: '' };
const bytes = new Uint8Array([1, 2]);
function encryptedLoader() {
  return {
    loadDocument: vi.fn((): DocumentInfo => { throw new Error('비밀번호가 필요한 암호 문서'); }),
    loadDocumentWithPassword: vi.fn(),
    getDocumentInfo: vi.fn(() => info),
  };
}

describe('document password opening', () => {
  beforeEach(() => prompt.mockReset());

  it('opens ordinary documents without prompting and preserves parse failures', async () => {
    const wasm = encryptedLoader();
    wasm.loadDocument.mockReturnValueOnce(info);
    expect(await loadDocumentForOpen(wasm, bytes, 'plain.hwp')).toEqual(info);
    wasm.loadDocument.mockImplementationOnce(() => { throw new Error('invalid file'); });
    await expect(loadDocumentForOpen(wasm, bytes, 'bad.hwp')).rejects.toThrow('invalid file');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('retries an incorrect password and returns the decrypted document info', async () => {
    const wasm = encryptedLoader();
    prompt.mockResolvedValueOnce('wrong').mockResolvedValueOnce('correct');
    wasm.loadDocumentWithPassword.mockImplementationOnce(() => {
      throw new Error('비밀번호가 일치하지 않거나 암호화 데이터가 손상되었습니다');
    });
    expect(await loadDocumentForOpen(wasm, bytes, 'locked.hwp')).toEqual(info);
    expect(prompt).toHaveBeenLastCalledWith('locked.hwp', expect.stringContaining('다시 입력'));
    expect(wasm.loadDocumentWithPassword).toHaveBeenLastCalledWith(bytes, 'correct', 'locked.hwp');
  });

  it('cancels without replacing the document', async () => {
    const wasm = encryptedLoader();
    prompt.mockResolvedValue(null);
    expect(await loadDocumentForOpen(wasm, bytes, 'locked.hwp')).toBeNull();
    expect(wasm.loadDocumentWithPassword).not.toHaveBeenCalled();
  });

  it.each(['지원하지 않는 암호화 방식', 'DRM', 'unexpected private details'])
  ('does not retry unsupported or non-password failures: %s', async (error) => {
    const wasm = encryptedLoader();
    prompt.mockResolvedValue('secret');
    wasm.loadDocumentWithPassword.mockImplementation(() => { throw new Error(error); });
    await expect(loadDocumentForOpen(wasm, bytes, 'locked.hwp')).rejects.toThrow(/지원하지 않|손상/);
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
