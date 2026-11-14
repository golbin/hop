import type { DesktopBridgeApi, DesktopUpdateState } from '@/core/tauri-bridge';
import { t } from '../hop-i18n';

export type UpdateNoticeActions = Partial<
  Pick<DesktopBridgeApi, 'startUpdateInstall' | 'restartToApplyUpdate'>
>;

export class UpdateNotice {
  private readonly actions: UpdateNoticeActions;
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly bodyEl: HTMLParagraphElement;
  private readonly metaEl: HTMLParagraphElement;
  private readonly errorEl: HTMLParagraphElement;
  private readonly actionsEl: HTMLDivElement;
  private state: DesktopUpdateState = { status: 'idle' };
  private dismissedKey: string | null = null;
  private actionPending = false;
  private actionError: string | null = null;

  constructor(actions: UpdateNoticeActions = {}) {
    this.actions = actions;
    this.root = document.createElement('div');
    this.root.className = 'update-notice';
    this.root.hidden = true;

    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'update-notice__title';

    this.bodyEl = document.createElement('p');
    this.bodyEl.className = 'update-notice__body';

    this.metaEl = document.createElement('p');
    this.metaEl.className = 'update-notice__meta';

    this.errorEl = document.createElement('p');
    this.errorEl.className = 'update-notice__error';

    this.actionsEl = document.createElement('div');
    this.actionsEl.className = 'update-notice__actions';

    this.root.append(this.titleEl, this.bodyEl, this.metaEl, this.errorEl, this.actionsEl);
    document.body.appendChild(this.root);
  }

  setState(state: DesktopUpdateState): void {
    this.state = state;
    this.actionPending = false;
    this.actionError = null;
    this.render();
  }

  private render(): void {
    if (this.state.status === 'idle') {
      this.root.hidden = true;
      return;
    }

    const key = this.noticeKey(this.state);
    if (key && key === this.dismissedKey) {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    this.root.dataset.state = this.state.status;
    this.actionsEl.replaceChildren();

    switch (this.state.status) {
      case 'available':
        this.titleEl.textContent = t('hop.update.availableTitle', { version: this.state.version });
        this.bodyEl.textContent = t('hop.update.availableBody');
        this.setOptionalText(this.metaEl, t('hop.update.availableMeta'));
        this.errorEl.hidden = true;
        this.actionsEl.append(
          this.createActionButton(t('hop.update.update'), true, () => this.startInstall()),
          this.createActionButton(t('hop.common.close'), false, () => this.dismiss()),
        );
        break;

      case 'downloading':
        this.titleEl.textContent = t('hop.update.downloadingTitle', { version: this.state.version });
        this.bodyEl.textContent = t('hop.update.downloadingBody');
        this.setOptionalText(this.metaEl, this.progressText(
          this.state.downloadedBytes,
          this.state.totalBytes ?? null,
        ));
        this.errorEl.hidden = true;
        break;

      case 'ready':
        this.titleEl.textContent = t('hop.update.readyTitle', { version: this.state.version });
        this.bodyEl.textContent = t('hop.update.readyBody');
        this.setOptionalText(this.metaEl, null);
        this.errorEl.hidden = true;
        this.actionsEl.append(
          this.createActionButton(t('hop.update.restartNow'), true, () => this.restartToApply()),
          this.createActionButton(t('hop.update.later'), false, () => this.dismiss()),
        );
        break;

      case 'error':
        this.titleEl.textContent = t('hop.update.failedTitle', { version: this.state.version });
        this.bodyEl.textContent = this.state.message;
        this.setOptionalText(this.metaEl, null);
        this.errorEl.hidden = true;
        this.actionsEl.append(
          this.createActionButton(t('hop.update.retry'), true, () => this.startInstall()),
          this.createActionButton(t('hop.common.close'), false, () => this.dismiss()),
        );
        break;
    }

    if (this.actionError) {
      this.errorEl.hidden = false;
      this.errorEl.textContent = this.actionError;
    } else {
      this.errorEl.hidden = true;
      this.errorEl.textContent = '';
    }
  }

  private createActionButton(
    label: string,
    primary: boolean,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `update-notice__button${primary ? ' update-notice__button--primary' : ''}`;
    button.textContent = label;
    button.disabled = this.actionPending;
    button.addEventListener('click', () => {
      onClick();
    });
    return button;
  }

  private async startInstall(): Promise<void> {
    await this.runAction(this.actions.startUpdateInstall);
  }

  private async restartToApply(): Promise<void> {
    await this.runAction(this.actions.restartToApplyUpdate);
  }

  private async runAction(action: (() => Promise<void>) | undefined): Promise<void> {
    if (!action || this.actionPending) return;
    this.actionPending = true;
    this.actionError = null;
    this.render();

    try {
      await action();
    } catch (error) {
      this.actionPending = false;
      this.actionError = this.errorText(error);
      this.render();
    }
  }

  private dismiss(): void {
    this.dismissedKey = this.noticeKey(this.state);
    this.root.hidden = true;
  }

  private noticeKey(state: DesktopUpdateState): string | null {
    if (state.status === 'idle') return null;
    return `${state.status}:${state.version}`;
  }

  private progressText(downloadedBytes: number, totalBytes: number | null): string {
    if (totalBytes && totalBytes > 0) {
      const percent = Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
      return `${this.formatBytes(downloadedBytes)} / ${this.formatBytes(totalBytes)} (${percent}%)`;
    }
    return t('hop.update.downloaded', { size: this.formatBytes(downloadedBytes) });
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private setOptionalText(element: HTMLElement, text: string | null): void {
    element.textContent = text ?? '';
    element.hidden = !text;
  }

  private errorText(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return String(error);
  }
}
