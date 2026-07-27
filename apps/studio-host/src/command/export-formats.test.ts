import { describe, expect, it, vi } from 'vitest';
import { collectDocumentHtml, exportDocument, type DocumentExportEngine } from './export-formats';

// node 환경(DOM 없음)이라 downloadBlob 을 타지 않는 경로만 검증한다:
// - 문서 전체 HTML 조립(collectDocumentHtml)
// - HML 미지원 문서의 친절 메시지 가드(exportDocument 가 downloadBlob 이전에 throw)

function engine(overrides: Partial<DocumentExportEngine> = {}): DocumentExportEngine {
  return {
    fileName: '문서.hwp',
    exportHwpx: () => new Uint8Array([1]),
    exportHml: () => new Uint8Array([2]),
    getSectionCount: () => 0,
    getParagraphCount: () => 0,
    getTextRange: () => '',
    exportSelectionHtml: () => '',
    ...overrides,
  };
}

describe('collectDocumentHtml', () => {
  it('concatenates per-section selection HTML across all sections', () => {
    const getParagraphCount = vi.fn((section: number) => (section === 0 ? 2 : 1));
    const getTextRange = vi.fn(() => 'abc');
    const exportSelectionHtml = vi.fn(
      (section: number, sp: number, so: number, ep: number, eo: number) =>
        `<p>sec${section}:${sp},${so}-${ep},${eo}</p>`,
    );

    const html = collectDocumentHtml(
      engine({ getSectionCount: () => 2, getParagraphCount, getTextRange, exportSelectionHtml }),
    );

    // 섹션0: 문단 0..1, 끝오프셋 = 마지막 문단 텍스트 길이(3), 섹션1: 문단 0..0
    expect(html).toBe('<p>sec0:0,0-1,3</p>\n<p>sec1:0,0-0,3</p>');
    expect(exportSelectionHtml).toHaveBeenCalledTimes(2);
  });

  it('strips the engine clipboard wrapper (<html><body><!--StartFragment-->)', () => {
    const html = collectDocumentHtml(
      engine({
        getSectionCount: () => 1,
        getParagraphCount: () => 1,
        getTextRange: () => 'ab',
        exportSelectionHtml: () =>
          '<html><body>\n<!--StartFragment-->\n<p>본문</p>\n<!--EndFragment-->\n</body></html>',
      }),
    );

    expect(html).toBe('<p>본문</p>');
  });

  it('skips empty sections', () => {
    const html = collectDocumentHtml(
      engine({ getSectionCount: () => 1, getParagraphCount: () => 0 }),
    );
    expect(html).toBe('');
  });
});

describe('exportDocument HML guard', () => {
  it('throws a friendly message when the engine reports no HML capability', () => {
    expect(() =>
      exportDocument(engine({ hasHmlExportCapability: () => false }), 'hml'),
    ).toThrow('HML 원본 문서에서만');
  });

  it('translates a raw engine export failure into a friendly message', () => {
    expect(() =>
      exportDocument(
        engine({
          exportHml: () => {
            throw new Error('[HML_SOURCE_REQUIRED] /HWPML');
          },
        }),
        'hml',
      ),
    ).toThrow('HML 원본 문서에서만');
  });
});
