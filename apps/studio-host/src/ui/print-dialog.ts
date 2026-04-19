import type { PageInfo } from '@/core/types';

interface PrintableDocument {
  fileName: string;
  pageCount: number;
  getPageInfo(pageNum: number): PageInfo;
  renderPageSvg(pageNum: number): string;
}

interface PrintDialogOptions {
  onStatus?(message: string): void;
  print?(): void | Promise<void>;
}

const PRINT_ROOT_ID = 'hop-print-root';
const PRINT_STYLE_ID = 'hop-print-style';

export async function openPrintDialog(
  document: PrintableDocument,
  options: PrintDialogOptions = {},
): Promise<void> {
  const pageCount = document.pageCount;
  if (pageCount === 0) return;

  const svgPages: string[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const message = `인쇄 준비 중... (${i + 1}/${pageCount})`;
    options.onStatus?.(message);
    svgPages.push(document.renderPageSvg(i));
    if (i % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const pageInfo = document.getPageInfo(0);
  const widthMm = Math.round((pageInfo.width * 25.4) / 96);
  const heightMm = Math.round((pageInfo.height * 25.4) / 96);

  renderPrintDocument({
    fileName: document.fileName,
    pageCount,
    svgPages,
    widthMm,
    heightMm,
  });

  options.onStatus?.('인쇄 대화상자를 여는 중...');
  await nextFrame();

  let cleaned = false;
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
    removePrintDocument();
  };
  window.addEventListener('afterprint', cleanup, { once: true });

  try {
    await (options.print?.() ?? window.print());
    if (!cleaned) cleanupTimer = window.setTimeout(cleanup, 5 * 60 * 1000);
  } catch (error) {
    window.removeEventListener('afterprint', cleanup);
    cleanup();
    throw error;
  }
}

function renderPrintDocument(payload: {
  fileName: string;
  pageCount: number;
  svgPages: string[];
  widthMm: number;
  heightMm: number;
}): void {
  removePrintDocument();

  const style = document.createElement('style');
  style.id = PRINT_STYLE_ID;
  style.textContent = `
  @page { size: ${payload.widthMm}mm ${payload.heightMm}mm; margin: 0; }
  @media screen {
    #${PRINT_ROOT_ID} {
      display: none;
    }
  }
  @media print {
    html,
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
    }
    body > :not(#${PRINT_ROOT_ID}) {
      display: none !important;
    }
    #${PRINT_ROOT_ID} {
      display: block !important;
      width: ${payload.widthMm}mm;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
    }
    #${PRINT_ROOT_ID} .hop-print-page {
      width: ${payload.widthMm}mm;
      height: ${payload.heightMm}mm;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden;
      break-after: page;
      page-break-after: always;
      background: #fff;
    }
    #${PRINT_ROOT_ID} .hop-print-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    #${PRINT_ROOT_ID} svg {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }
  }
`;

  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  root.setAttribute('aria-hidden', 'true');
  root.dataset.fileName = payload.fileName;
  root.dataset.pageCount = String(payload.pageCount);
  for (const svg of payload.svgPages) {
    const page = document.createElement('div');
    page.className = 'hop-print-page';
    const svgNode = parsePrintableSvg(svg);
    if (svgNode) page.appendChild(svgNode);
    root.appendChild(page);
  }

  document.head.appendChild(style);
  document.body.appendChild(root);
}

function parsePrintableSvg(svg: string): SVGSVGElement | null {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) return null;

  const svgElement = parsed.documentElement;
  if (svgElement.tagName.toLowerCase() !== 'svg') return null;

  sanitizeSvg(svgElement);
  return document.importNode(svgElement, true) as unknown as SVGSVGElement;
}

function sanitizeSvg(root: Element): void {
  root.querySelectorAll('script, foreignObject, iframe, object, embed, link, meta').forEach((node) => {
    node.remove();
  });

  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || value.includes('javascript:')) {
        element.removeAttribute(attribute.name);
      } else if (['href', 'src', 'xlink:href'].includes(name) && !isSafeSvgReference(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

function isSafeSvgReference(value: string): boolean {
  return value === ''
    || value.startsWith('#')
    || value.startsWith('data:image/png;')
    || value.startsWith('data:image/jpeg;')
    || value.startsWith('data:image/jpg;')
    || value.startsWith('data:image/gif;')
    || value.startsWith('data:image/webp;')
    || value.startsWith('data:image/bmp;');
}

function removePrintDocument(): void {
  document.getElementById(PRINT_STYLE_ID)?.remove();
  document.getElementById(PRINT_ROOT_ID)?.remove();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
