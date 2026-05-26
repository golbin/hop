import type { ValidationReport } from '@upstream/core/wasm-bridge';

export type ValidationChoice = 'auto-fix' | 'as-is' | 'cancel';

const MAX_WARNING_DETAILS = 50;

export class ValidationModal {
  private overlay: HTMLDivElement | null = null;
  private captureHandler: ((event: KeyboardEvent) => void) | null = null;
  private resolver: ((choice: ValidationChoice) => void) | null = null;

  constructor(private readonly report: ValidationReport) {}

  async showAsync(): Promise<ValidationChoice> {
    return new Promise((resolve) => {
      this.resolver = resolve;
      this.build();
      document.body.appendChild(this.overlay!);
      this.bindKeyboard();
      this.overlay
        ?.querySelector<HTMLButtonElement>('.dialog-btn-primary')
        ?.focus();
    });
  }

  private build(): void {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog-wrap';
    dialog.style.width = '480px';
    dialog.appendChild(this.createTitle());
    dialog.appendChild(this.createBody());
    dialog.appendChild(this.createFooter());

    this.overlay.appendChild(dialog);
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.resolve('cancel');
    });
  }

  private createTitle(): HTMLElement {
    const title = document.createElement('div');
    title.className = 'dialog-title';
    title.textContent = '문서 보정 확인';

    const closeButton = document.createElement('button');
    closeButton.className = 'dialog-close';
    closeButton.textContent = '\u00D7';
    closeButton.addEventListener('click', () => this.resolve('cancel'));
    title.appendChild(closeButton);

    return title;
  }

  private createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'dialog-body';
    body.style.padding = '16px 20px';
    body.style.lineHeight = '1.6';

    const description = document.createElement('p');
    description.style.margin = '0 0 12px 0';
    description.textContent =
      `이 문서에는 렌더링 품질에 영향을 줄 수 있는 비표준 줄 정보가 있습니다 ` +
      `(경고 ${this.report.count}건). 자동 보정을 적용하면 표시가 더 안정적일 수 있습니다.`;
    body.appendChild(description);

    body.appendChild(this.createWarningSummary());
    body.appendChild(this.createWarningDetails());

    return body;
  }

  private createWarningSummary(): HTMLElement {
    const summary = document.createElement('ul');
    summary.style.margin = '0 0 12px 16px';
    summary.style.padding = '0';
    summary.style.fontSize = '13px';
    summary.style.color = '#555';

    for (const [kind, count] of Object.entries(this.report.summary)) {
      const item = document.createElement('li');
      item.textContent = `${kind}: ${count}건`;
      summary.appendChild(item);
    }

    return summary;
  }

  private createWarningDetails(): HTMLElement {
    const details = document.createElement('details');
    details.style.marginTop = '8px';

    const summary = document.createElement('summary');
    summary.textContent = '상세 보기';
    summary.style.cursor = 'pointer';
    summary.style.fontSize = '13px';
    summary.style.color = '#0066cc';
    details.appendChild(summary);

    const list = document.createElement('div');
    list.style.maxHeight = '180px';
    list.style.overflow = 'auto';
    list.style.marginTop = '8px';
    list.style.padding = '8px';
    list.style.background = '#f6f6f6';
    list.style.borderRadius = '4px';
    list.style.fontFamily = 'monospace';
    list.style.fontSize = '12px';

    for (const warning of this.report.warnings.slice(0, MAX_WARNING_DETAILS)) {
      const line = document.createElement('div');
      const cell = warning.cell
        ? ` [cell ctrl=${warning.cell.ctrl} row=${warning.cell.row} col=${warning.cell.col} para=${warning.cell.innerPara}]`
        : '';
      line.textContent = `section=${warning.section} para=${warning.paragraph} ${warning.kind}${cell}`;
      list.appendChild(line);
    }

    const hiddenCount = this.report.warnings.length - MAX_WARNING_DETAILS;
    if (hiddenCount > 0) {
      const more = document.createElement('div');
      more.style.color = '#888';
      more.style.marginTop = '4px';
      more.textContent = `... 외 ${hiddenCount}건`;
      list.appendChild(more);
    }

    details.appendChild(list);
    return details;
  }

  private createFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className = 'dialog-footer';

    const autoFixButton = document.createElement('button');
    autoFixButton.className = 'dialog-btn dialog-btn-primary';
    autoFixButton.textContent = '자동 보정';
    autoFixButton.addEventListener('click', () => this.resolve('auto-fix'));

    const asIsButton = document.createElement('button');
    asIsButton.className = 'dialog-btn';
    asIsButton.textContent = '그대로 열기';
    asIsButton.addEventListener('click', () => this.resolve('as-is'));

    footer.append(autoFixButton, asIsButton);
    return footer;
  }

  private bindKeyboard(): void {
    this.captureHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        this.resolve('cancel');
        return;
      }
      if (event.key === 'Enter') {
        event.stopPropagation();
        event.preventDefault();
        this.resolve('auto-fix');
        return;
      }
      event.stopPropagation();
    };
    document.addEventListener('keydown', this.captureHandler, true);
  }

  private resolve(choice: ValidationChoice): void {
    if (this.captureHandler) {
      document.removeEventListener('keydown', this.captureHandler, true);
      this.captureHandler = null;
    }
    this.overlay?.remove();
    this.overlay = null;
    this.resolver?.(choice);
    this.resolver = null;
  }
}

export async function showValidationModalIfNeeded(
  report: ValidationReport,
): Promise<ValidationChoice> {
  if (!report || report.count === 0) return 'as-is';
  return new ValidationModal(report).showAsync();
}
