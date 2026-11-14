import type { DocumentInfo, WasmBridge } from '@/upstream/core';
import { showHwpPasswordDialog } from '@/upstream/ui';
import { t } from '../hop-i18n';

type DocumentLoader = Pick<WasmBridge, 'loadDocument' | 'loadDocumentWithPassword' | 'getDocumentInfo'>;

// Upstream's open orchestration is private to its main.ts. Keep this adapter
// limited to password prompting; filesystem and session ownership stay native.
export async function loadDocumentForOpen(
  wasm: DocumentLoader, bytes: Uint8Array, fileName: string,
): Promise<DocumentInfo | null> {
  try {
    return wasm.loadDocument(bytes, fileName);
  } catch (error) {
    if (!String(error).includes('비밀번호가 필요한 암호 문서')) throw error;
  }

  let retryMessage: string | undefined;
  while (true) {
    const password = await showHwpPasswordDialog(fileName, retryMessage);
    if (password === null) return null;
    try {
      wasm.loadDocumentWithPassword(bytes, password, fileName);
      return wasm.getDocumentInfo();
    } catch (error) {
      const message = String(error);
      if (message.includes('비밀번호가 일치하지 않거나 암호화 데이터가 손상되었습니다')) {
        retryMessage = t('hop.document.passwordMismatch');
        continue;
      }
      if (message.includes('지원하지 않는 암호화 방식')) {
        throw new Error(t('hop.document.unsupportedEncryption'));
      }
      if (message.includes('DRM')) throw new Error(t('hop.document.drmUnsupported'));
      throw new Error(t('hop.document.encryptedOpenFailed'));
    }
  }
}
