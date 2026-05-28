import { invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';

type ShowToast = (text: string, type?: 'success' | 'error' | 'info') => void;

export interface VerifiedLaw {
  citation: string;
  lawName: string;
  articleQuery: string;
  path: string | null;
  status: 'mismatch' | 'not_found' | 'article_not_found' | 'verified';
  officialText: string | null;
  context: string | null;
}

export function useLawSystem(showToast: ShowToast) {
  /** 법령명으로 검색 — 매칭 경로 배열 반환 */
  const searchLaw = useCallback(
    async (query: string): Promise<string[]> => {
      if (!query.trim()) return [];
      const res = await invoke<string>('search_law', { query });
      if (res.includes('찾을 수 없습니다')) {
        showToast(res, 'error');
        return [];
      }
      return res.split('\n').filter(Boolean);
    },
    [showToast],
  );

  /** 경로 + 조 번호로 조문 내용 조회 */
  const fetchArticle = useCallback(
    async (path: string, rawQuery: string): Promise<string> => {
      if (!rawQuery.trim()) {
        showToast('조 번호를 입력해주세요 (예: 347)', 'info');
        return '';
      }
      let q = rawQuery.trim();
      if (!q.startsWith('제')) q = '제' + q;
      if (!q.endsWith('조')) q = q + '조';
      return invoke<string>('get_law_article', { path, articleQuery: q });
    },
    [showToast],
  );

  /** 현재 활성 문서 내 법령 인용 전체 검증 */
  const verifyDocumentLaws = useCallback(
    async (): Promise<VerifiedLaw[]> => {
      return invoke<VerifiedLaw[]>('verify_laws_in_document');
    },
    [],
  );

  /** 조문 텍스트를 문서 하단에 추가 */
  const appendLawText = useCallback(
    async (text: string): Promise<void> => {
      await invoke('ai_edit_document', { mode: 'append', text });
      showToast('✓ 법령 조문이 문서 하단에 추가되었습니다.', 'success');
    },
    [showToast],
  );

  return { searchLaw, fetchArticle, verifyDocumentLaws, appendLawText };
}
