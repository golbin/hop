/** 기존 형광펜과 같은 색상표를 글자색 팔레트에도 사용한다. */
export const COLOR_PALETTE = [
  ['#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff'],
  ['#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080', '#c0c0c0', '#808080'],
  ['#ff9999', '#ffcc99', '#ffff99', '#ccff99', '#99ff99', '#99ffcc', '#99ffff'],
  ['#99ccff', '#9999ff', '#cc99ff', '#ff99ff', '#ff99cc', '#e0e0e0', '#404040'],
  ['#cc0000', '#cc6600', '#cccc00', '#66cc00', '#00cc00', '#00cc66', '#00cccc'],
  ['#0066cc', '#0000cc', '#6600cc', '#cc00cc', '#cc0066', '#999999', '#000000'],
];

const RECENT_COLORS_KEY = 'hop.recent-text-colors';
const RECENT_COLORS_LIMIT = 7;

function readRecentColors(fallback: string[] = []): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    const colors = saved.filter((color): color is string => (
      typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    )).map((color) => color.toLowerCase());
    return [...new Set(colors)].slice(0, RECENT_COLORS_LIMIT);
  } catch {
    return fallback;
  }
}

function createSwatch(color: string, onSelect: (color: string) => void): HTMLButtonElement {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'sb-hl-swatch';
  swatch.style.background = color;
  swatch.setAttribute('aria-label', color);
  swatch.title = color;
  swatch.addEventListener('click', () => onSelect(color));
  return swatch;
}

export function setupTextColorPicker(
  container: HTMLElement,
  onSelect: (color: string) => void,
): void {
  const button = container.querySelector<HTMLButtonElement>('#btn-text-color')!;
  const picker = container.querySelector<HTMLInputElement>('#text-color-picker')!;
  const palette = document.createElement('div');
  palette.id = 'text-color-palette';
  palette.className = 'sb-hl-palette';
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', picker.getAttribute('aria-label') ?? '');
  button.setAttribute('aria-controls', palette.id);
  container.appendChild(palette);
  let recentColors = readRecentColors();
  const recentRow = document.createElement('div');
  recentRow.className = 'sb-hl-palette-row';
  const setOpen = (open: boolean) => {
    if (open) {
      recentColors = readRecentColors(recentColors);
      renderRecentColors();
    }
    palette.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  const applyColor = (color: string) => {
    recentColors = [color, ...readRecentColors(recentColors).filter((recent) => recent !== color)]
      .slice(0, RECENT_COLORS_LIMIT);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(recentColors)); }
    catch { /* 저장이 막혀도 현재 창에서는 최근 색을 재사용할 수 있다. */ }
    renderRecentColors();
    picker.value = color;
    setOpen(false);
    onSelect(color);
  };
  const renderRecentColors = () => {
    recentRow.replaceChildren(...recentColors.map((color) => createSwatch(color, applyColor)));
    if (recentColors.length === 0) recentRow.textContent = '아직 없음';
  };
  setOpen(false);

  // 팔레트 조작 중에도 편집기의 선택 범위를 유지한다.
  container.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('click', () => setOpen(palette.hidden === true));
  picker.addEventListener('input', () => applyColor(picker.value));

  for (const colors of [['#000000', '#404040', '#808080', '#c0c0c0', '#e0e0e0', '#f0f0f0', '#ffffff'], ...COLOR_PALETTE]) {
    const row = document.createElement('div');
    row.className = 'sb-hl-palette-row';
    for (const color of colors) {
      row.appendChild(createSwatch(color, applyColor));
    }
    palette.appendChild(row);
  }

  const recent = document.createElement('div');
  recent.id = 'recent-text-colors';
  recent.setAttribute('role', 'group');
  recent.setAttribute('aria-label', '최근에 사용한 색');
  const recentLabel = document.createElement('div');
  recentLabel.textContent = '최근에 사용한 색';
  recent.appendChild(recentLabel);
  recent.appendChild(recentRow);
  palette.appendChild(recent);
  renderRecentColors();

  const actions = document.createElement('div');
  actions.className = 'sb-hl-palette-actions';
  const other = document.createElement('button');
  other.type = 'button';
  other.textContent = '다른 색...';
  other.addEventListener('click', () => picker.click());
  actions.appendChild(other);
  palette.appendChild(actions);

  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !palette.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.focus();
    } else if (event.key === 'ArrowDown' && event.target === button) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      palette.querySelector<HTMLButtonElement>('button')!.focus();
    }
  });
  // 다른 도구가 버블링을 막아도 바깥 클릭으로 팔레트를 닫는다.
  document.addEventListener('mousedown', (event) => {
    if (!container.contains(event.target as Node)) setOpen(false);
  }, true);
  container.addEventListener('focusout', (event) => {
    if (!container.contains(event.relatedTarget as Node | null)) setOpen(false);
  });
}
