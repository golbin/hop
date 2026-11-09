import { createToolbarPopup } from './toolbar-popup';

const ENHANCED = Symbol('rhwp-custom-select');

type EnhancedSelect = HTMLSelectElement & {
  [ENHANCED]?: {
    root: HTMLElement;
    sync: () => void;
  };
};

const SELECT_SELECTOR = [
  'select.sb-combo',
  'select.sb-ls-select',
  'select.dialog-select',
  'select.formula-select',
].join(',');

export function enhanceCustomSelects(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>(SELECT_SELECTOR).forEach(enhanceCustomSelect);
}

export function syncCustomSelect(select: HTMLSelectElement): void {
  (select as EnhancedSelect)[ENHANCED]?.sync();
}

export function getCustomSelectRoot(select: HTMLSelectElement): HTMLElement | null {
  return (select as EnhancedSelect)[ENHANCED]?.root ?? null;
}

function enhanceCustomSelect(select: HTMLSelectElement): void {
  const enhanced = select as EnhancedSelect;
  if (enhanced[ENHANCED] || select.multiple || select.size > 1 || select.dataset.nativeSelect === 'true') {
    return;
  }

  const root = document.createElement('div');
  root.className = `custom-select ${select.className}`.trim();
  root.dataset.selectId = select.id || '';
  root.tabIndex = -1;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const label = select.getAttribute('aria-label') ?? select.labels?.[0]?.textContent?.trim() ?? select.title;

  const value = document.createElement('span');
  value.className = 'custom-select-value';

  const arrow = document.createElement('span');
  arrow.className = 'custom-select-arrow';
  arrow.textContent = '▾';
  arrow.setAttribute('aria-hidden', 'true');

  const menu = document.createElement('div');
  menu.className = 'custom-select-menu';
  menu.setAttribute('role', 'listbox');

  trigger.append(value, arrow);
  select.before(root);
  root.append(trigger, menu, select);
  select.classList.add('native-select-hidden');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const popup = createToolbarPopup(root, trigger, menu);

  const commit = (option: HTMLOptionElement) => {
    if (option.disabled) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    popup.close();
    trigger.focus();
  };

  const rebuildMenu = () => {
    menu.innerHTML = '';
    const children = Array.from(select.children);
    for (const child of children) {
      if (child instanceof HTMLOptGroupElement) {
        const label = document.createElement('div');
        label.className = 'custom-select-group';
        label.textContent = child.label;
        menu.appendChild(label);
        Array.from(child.children)
          .filter((item): item is HTMLOptionElement => item instanceof HTMLOptionElement)
          .forEach((option) => menu.appendChild(createOptionRow(option, commit)));
      } else if (child instanceof HTMLOptionElement) {
        menu.appendChild(createOptionRow(child, commit));
      }
    }
  };

  const sync = () => {
    root.classList.toggle('disabled', select.disabled);
    trigger.disabled = select.disabled;
    if (select.disabled) popup.close();

    const selected = select.selectedOptions[0] ?? select.options[select.selectedIndex];
    value.textContent = selected?.textContent?.trim() || '';
    value.title = value.textContent;
    if (label) trigger.setAttribute('aria-label', `${label}: ${value.textContent}`);

    menu.querySelectorAll<HTMLElement>('.custom-select-option').forEach((row) => {
      row.classList.toggle('selected', row.dataset.value === select.value);
      row.setAttribute('aria-selected', String(row.dataset.value === select.value));
    });
  };

  trigger.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  trigger.addEventListener('click', () => {
    sync();
    popup.toggle();
  });

  trigger.addEventListener('dblclick', (event) => {
    select.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    event.preventDefault();
    event.stopPropagation();
  });

  root.addEventListener('keydown', (event) => {
    if (select.disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      if (menu.contains(event.target as Node)) {
        const rows = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).filter(row => !row.disabled);
        const index = rows.indexOf(event.target as HTMLButtonElement);
        rows[(index + delta + rows.length) % rows.length]?.focus();
      } else {
        stepSelection(select, delta);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      }
      event.preventDefault();
    }
  });

  const observer = new MutationObserver(() => {
    rebuildMenu();
    sync();
  });
  observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label'] });

  select.addEventListener('change', sync);
  rebuildMenu();
  sync();
  enhanced[ENHANCED] = { root, sync };
}

function createOptionRow(option: HTMLOptionElement, commit: (option: HTMLOptionElement) => void): HTMLElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'custom-select-option';
  row.dataset.value = option.value;
  row.textContent = option.textContent ?? '';
  row.disabled = option.disabled;
  row.setAttribute('role', 'option');
  row.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  row.addEventListener('click', () => commit(option));
  return row;
}

function stepSelection(select: HTMLSelectElement, delta: number): void {
  const options = Array.from(select.options);
  if (options.length === 0) return;

  let index = select.selectedIndex;
  for (let i = 0; i < options.length; i++) {
    index = (index + delta + options.length) % options.length;
    if (!options[index].disabled) {
      select.selectedIndex = index;
      return;
    }
  }
}
