// HOP 웹 내보내기 헬퍼
//
// rhwp 엔진이 직접 지원하는 바이트 출력(HWPX/HML)과, 섹션/문단 단위
// `exportSelectionHtml` 을 문서 전체로 조립한 HTML 을 기반으로 한
// HTML 파일 / Word 호환(.doc) 내보내기를 브라우저 Blob 다운로드로 제공한다.
//
// 주의: .doc 는 OOXML(.docx) 이 아니라 "HTML 기반 Word 문서"다. Word 가 표준적으로
// 열 수 있는 형식이며, 충실도는 HTML 수준(레이아웃/고급 서식 일부 손실)이다. 엔진에
// docx 변환기가 없기 때문에 브라우저에서 가능한 최선의 정공법이다.

/** 내보내기에 필요한 엔진 표면 (WasmBridge 의 부분집합, 구조적 타이핑) */
export interface DocumentExportEngine {
  fileName?: string;
  exportHwpx(): Uint8Array;
  exportHml(): Uint8Array;
  // HML 내보내기는 엔진이 HML 원본 문서에만 허용한다(HML_SOURCE_REQUIRED).
  hasHmlExportCapability?(): boolean;
  getSectionCount(): number;
  getParagraphCount(sectionIdx: number): number;
  getTextRange(sectionIdx: number, paraIdx: number, charOffset: number, count: number): string;
  exportSelectionHtml(
    sectionIdx: number,
    startPara: number,
    startOffset: number,
    endPara: number,
    endOffset: number,
  ): string;
}

export type ExportFormat = 'hwpx' | 'hml' | 'html' | 'doc';

interface FormatSpec {
  ext: string;
  mime: string;
  label: string;
}

const FORMAT_SPECS: Record<ExportFormat, FormatSpec> = {
  hwpx: { ext: 'hwpx', mime: 'application/vnd.hancom.hwpx', label: 'HWPX' },
  hml: { ext: 'hml', mime: 'application/x-hwpml', label: 'HML' },
  html: { ext: 'html', mime: 'text/html;charset=utf-8', label: 'HTML' },
  doc: { ext: 'doc', mime: 'application/msword', label: 'Word(.doc)' },
};

/** "문서.hwp" → "문서" (확장자 제거). 이름이 없으면 기본값. */
function baseName(fileName: string | undefined): string {
  const name = (fileName ?? '').trim() || '문서';
  return name.replace(/\.(hwp|hwpx|hml|html?|doc)$/i, '');
}

/** 브라우저 Blob 다운로드 트리거. */
export function downloadBlob(part: BlobPart, fileName: string, mime: string): void {
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // click 이 처리될 시간을 준 뒤 URL 해제
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 엔진이 반환하는 조각은 클립보드용 래퍼(`<html><body><!--StartFragment-->…`)를
 * 포함하므로, 문서로 재래핑하기 전에 body 내부만 추출한다.
 */
function unwrapEngineHtmlFragment(fragment: string): string {
  const bodyMatch = fragment.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const inner = bodyMatch ? bodyMatch[1] : fragment;
  return inner
    .replace(/<!--StartFragment-->/gi, '')
    .replace(/<!--EndFragment-->/gi, '')
    .trim();
}

/**
 * 문서 전체 HTML 을 섹션/문단 범위로 조립한다. `exportSelectionHtml` 은 섹션 단위라
 * 각 섹션의 첫 문단~마지막 문단 전체를 범위로 지정해 이어붙인다.
 */
export function collectDocumentHtml(engine: DocumentExportEngine): string {
  const sectionCount = Math.max(0, engine.getSectionCount());
  const parts: string[] = [];
  for (let section = 0; section < sectionCount; section += 1) {
    const paragraphCount = engine.getParagraphCount(section);
    if (paragraphCount <= 0) continue;
    const lastPara = paragraphCount - 1;
    // 마지막 문단의 끝 오프셋 = 마지막 문단 텍스트 길이. 큰 count 로 요청하면
    // 엔진이 실제 길이까지 클램프해 반환한다.
    let endOffset = 0;
    try {
      endOffset = (engine.getTextRange(section, lastPara, 0, 1_000_000) ?? '').length;
    } catch {
      endOffset = 0;
    }
    try {
      const html = engine.exportSelectionHtml(section, 0, 0, lastPara, endOffset) ?? '';
      const inner = unwrapEngineHtmlFragment(html);
      if (inner) parts.push(inner);
    } catch {
      /* 한 섹션 실패는 건너뛴다 */
    }
  }
  return parts.join('\n');
}

function wrapHtmlDocument(innerHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
</head>
<body>
${innerHtml}
</body>
</html>`;
}

/** Word 가 여는 HTML 기반 .doc 래퍼 (mso 네임스페이스 포함). */
function wrapWordDocument(innerHtml: string, title: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
</head>
<body>
${innerHtml}
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 지정한 형식으로 현재 문서를 내보낸다(브라우저 다운로드).
 * HTML/DOC 는 문서 전체 HTML 을 조립해 사용한다.
 */
export function exportDocument(engine: DocumentExportEngine, format: ExportFormat): void {
  const spec = FORMAT_SPECS[format];
  const fileName = `${baseName(engine.fileName)}.${spec.ext}`;
  const title = baseName(engine.fileName);

  if (format === 'hwpx') {
    downloadBlob(engine.exportHwpx() as unknown as BlobPart, fileName, spec.mime);
    return;
  }
  if (format === 'hml') {
    // 엔진은 HML 원본 문서에만 HML 내보내기를 허용한다(HML_SOURCE_REQUIRED).
    // 사전 판정 메서드가 없을 수 있으므로 실제 호출 실패도 친절 메시지로 변환한다.
    const hmlUnsupportedMessage =
      'HML 내보내기는 HML 원본 문서에서만 지원됩니다. HWPX 또는 HTML로 내보내 주세요.';
    if (engine.hasHmlExportCapability && !engine.hasHmlExportCapability()) {
      throw new Error(hmlUnsupportedMessage);
    }
    let bytes: Uint8Array;
    try {
      bytes = engine.exportHml();
    } catch {
      throw new Error(hmlUnsupportedMessage);
    }
    downloadBlob(bytes as unknown as BlobPart, fileName, spec.mime);
    return;
  }

  const innerHtml = collectDocumentHtml(engine);
  const document = format === 'doc'
    ? wrapWordDocument(innerHtml, title)
    : wrapHtmlDocument(innerHtml, title);
  downloadBlob(document, fileName, spec.mime);
}

export function exportFormatLabel(format: ExportFormat): string {
  return FORMAT_SPECS[format].label;
}
