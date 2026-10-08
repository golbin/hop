import type { DocumentInfo, WasmBridge } from '@/upstream/core';
import { showHwpPasswordDialog } from '@/upstream/ui';

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
        retryMessage = '암호가 일치하지 않거나 문서가 손상되었습니다. 다시 입력하세요.';
        continue;
      }
      if (message.includes('지원하지 않는 암호화 방식')) {
        throw new Error('지원하지 않는 암호화 방식의 문서입니다.');
      }
      if (message.includes('DRM')) throw new Error('DRM으로 보호된 문서는 지원하지 않습니다.');
      throw new Error('암호화된 문서를 열 수 없습니다. 문서가 손상되었는지 확인하세요.');
    }
  }
}
