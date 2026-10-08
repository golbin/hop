import type { CommandDef } from '@/upstream/commands';

const STORAGE_KEY = 'hop.toolbar-labels';
const COMMAND_ID = 'view:toolbar-labels';

function applyToolbarLabels(visible: boolean): void {
  document.documentElement.dataset.toolbarLabels = visible ? 'shown' : 'hidden';
  for (const item of document.querySelectorAll(`[data-cmd="${COMMAND_ID}"]`)) {
    item.classList.toggle('active', visible);
    item.setAttribute('aria-checked', String(visible));
  }
}

function readToolbarLabels(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== 'hidden'; }
  catch { return true; }
}

export function initToolbarLabels(): void {
  applyToolbarLabels(readToolbarLabels());
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) applyToolbarLabels(readToolbarLabels());
  });
}

export const toolbarLabelsCommand: CommandDef = {
  id: COMMAND_ID,
  label: '도구 상자 라벨 표시',
  execute() {
    const visible = document.documentElement.dataset.toolbarLabels === 'hidden';
    applyToolbarLabels(visible);
    try { localStorage.setItem(STORAGE_KEY, visible ? 'shown' : 'hidden'); }
    catch { /* Keep the current window usable when storage is unavailable. */ }
  },
};
