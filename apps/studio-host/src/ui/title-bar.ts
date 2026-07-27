// 앱 타이틀바 (한컴독스 스타일) 동작
//
// - 문서 로드/저장/변경 시 타이틀바의 문서명을 갱신한다.
// - "공유" 버튼: 현재 URL 을 클립보드에 복사한다 (웹 전용).
// - Tauri 데스크톱 런타임에서는 웹 전용 액션(공유·데스크톱 앱 링크)을 숨긴다.

interface TitleBarEventBus {
  on(event: string, callback: () => void): void;
}

interface TitleBarDocumentSource {
  fileName?: string;
  pageCount?: number;
}

export interface TitleBarOptions {
  eventBus: TitleBarEventBus;
  document: TitleBarDocumentSource;
  isDesktopRuntime: boolean;
  setStatusMessage?: (message: string) => void;
}

// 실측 기준(브라우저 eventBus 스파이): 새 문서는 create-new-document,
// 웹 파일 열기는 open-document-bytes:done, 데스크톱/홈 열기는 desktop-document-loaded,
// 드래그앤드롭 로드는 별도 로드 이벤트 없이 cursor-para-changed 만 발화된다.
// cursor-para-changed 는 편집 중에도 자주 발화되므로 타이머를 병합해 흡수한다.
const TITLE_UPDATE_EVENTS = [
  'create-new-document',
  'open-document-bytes:done',
  'desktop-document-loaded',
  'desktop-document-saved',
  'command-state-changed',
  'cursor-para-changed',
] as const;

export function initTitleBar(options: TitleBarOptions): void {
  const titleEl = document.getElementById('atb-doc-title');

  const updateTitle = () => {
    if (!titleEl) return;
    // 문서가 없으면(홈 화면) 엔진 기본값('document.hwp') 대신 앱 이름을 보여준다.
    if ((options.document.pageCount ?? 0) === 0) {
      titleEl.textContent = 'HOP';
      return;
    }
    const name = options.document.fileName?.trim();
    titleEl.textContent = name || '새 문서';
  };
  // 일부 이벤트(create-new-document)는 엔진 상태(pageCount/fileName) 갱신보다
  // 먼저 발화되므로, 즉시 + 짧은 지연 후 한 번 더 갱신해 stale 타이틀을 방지한다.
  // 지연 타이머는 병합해 고빈도 이벤트(cursor-para-changed)에도 부담이 없게 한다.
  let pendingTimer = 0;
  const scheduleUpdate = () => {
    updateTitle();
    if (pendingTimer) return;
    pendingTimer = window.setTimeout(() => {
      pendingTimer = 0;
      updateTitle();
    }, 120);
  };
  for (const event of TITLE_UPDATE_EVENTS) options.eventBus.on(event, scheduleUpdate);
  updateTitle();

  if (options.isDesktopRuntime) {
    // 데스크톱: 링크 공유/앱 다운로드는 의미가 없으므로 웹 전용 크롬을 제거한다.
    document.getElementById('menu-share')?.remove();
    document.getElementById('menu-desktop-link')?.remove();
    return;
  }

  document.getElementById('menu-share')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      options.setStatusMessage?.('문서 링크가 클립보드에 복사되었습니다');
    } catch {
      options.setStatusMessage?.('링크 복사에 실패했습니다. 주소창에서 직접 복사해 주세요.');
    }
  });
}
