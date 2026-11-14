import type { RecentDocument } from '@/core/tauri-bridge';
import { t } from '../hop-i18n';

export function openRecentDocumentsDialog(
  documents: RecentDocument[],
  options: {
    clearRecentDocuments(): Promise<void>;
  },
): Promise<RecentDocument | null> {
  return new Promise((resolve) => {
    let selectedIndex = 0;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog-wrap recent-documents-dialog';
    dialog.style.width = '520px';

    const titleBar = document.createElement('div');
    titleBar.className = 'dialog-title';
    titleBar.textContent = t('menu.file.label.x625d99');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'dialog-close';
    closeBtn.textContent = '\u00D7';
    titleBar.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'dialog-body recent-documents-body';

    const list = document.createElement('div');
    list.className = 'recent-documents-list';
    list.setAttribute('role', 'listbox');
    body.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'dialog-footer';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'dialog-btn recent-documents-clear';
    clearBtn.textContent = t('hop.recent.clearList');

    const spacer = document.createElement('span');
    spacer.className = 'recent-documents-footer-spacer';

    const openBtn = document.createElement('button');
    openBtn.className = 'dialog-btn dialog-btn-primary';
    openBtn.textContent = t('hop.common.open');

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'dialog-btn';
    cancelBtn.textContent = t('hop.common.cancel');

    footer.append(clearBtn, spacer, openBtn, cancelBtn);
    dialog.append(titleBar, body, footer);
    overlay.appendChild(dialog);

    const close = (value: RecentDocument | null) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.remove();
      resolve(value);
    };

    const renderList = () => {
      list.replaceChildren();
      documents.forEach((recentDocument, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'recent-documents-item';
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(index === selectedIndex));
        item.dataset.index = String(index);

        const name = document.createElement('span');
        name.className = 'recent-documents-name';
        name.textContent = recentDocument.fileName;

        const path = document.createElement('span');
        path.className = 'recent-documents-path';
        path.textContent = recentDocument.path;

        item.append(name, path);
        item.addEventListener('click', () => {
          selectedIndex = index;
          updateSelection();
        });
        item.addEventListener('dblclick', () => close(documents[index] ?? null));
        list.appendChild(item);
      });
    };

    const updateSelection = () => {
      list.querySelectorAll<HTMLElement>('.recent-documents-item').forEach((item) => {
        item.setAttribute('aria-selected', String(Number(item.dataset.index) === selectedIndex));
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        close(null);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        close(documents[selectedIndex] ?? null);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex = Math.min(documents.length - 1, selectedIndex + 1);
        updateSelection();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = Math.max(0, selectedIndex - 1);
        updateSelection();
      }
    };

    closeBtn.addEventListener('click', () => close(null));
    cancelBtn.addEventListener('click', () => close(null));
    openBtn.addEventListener('click', () => close(documents[selectedIndex] ?? null));
    clearBtn.addEventListener('click', () => {
      clearBtn.disabled = true;
      void options.clearRecentDocuments()
        .then(() => close(null))
        .catch((error: unknown) => {
          console.warn('[recent-documents] clear failed:', error);
          clearBtn.disabled = false;
        });
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(null);
    });

    renderList();
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown, true);
    openBtn.focus();
  });
}
