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
  root.tabIndex = select.disabled ? -1 : 0;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

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

  const close = () => {
    root.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    if (select.disabled) return;
    closeOtherSelects(root);
    sync();
    root.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
  };

  const toggle = () => {
    if (root.classList.contains('open')) close();
    else open();
  };

  const commit = (option: HTMLOptionElement) => {
    if (option.disabled) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
    close();
    root.focus();
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
    root.tabIndex = select.disabled ? -1 : 0;
    trigger.disabled = select.disabled;

    const selected = select.selectedOptions[0] ?? select.options[select.selectedIndex];
    value.textContent = selected?.textContent?.trim() || '';
    value.title = value.textContent;

    menu.querySelectorAll<HTMLElement>('.custom-select-option').forEach((row) => {
      row.classList.toggle('selected', row.dataset.value === select.value);
    });
  };

  trigger.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggle();
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
    if (event.key === 'Escape') {
      close();
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      toggle();
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      stepSelection(select, event.key === 'ArrowDown' ? 1 : -1);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
      event.preventDefault();
    }
  });

  document.addEventListener('mousedown', (event) => {
    if (!root.contains(event.target as Node)) close();
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
    event.stopPropagation();
    commit(option);
  });
  return row;
}

function closeOtherSelects(current: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('.custom-select.open').forEach((select) => {
    if (select !== current) {
      select.classList.remove('open');
      select.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
    }
  });
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
