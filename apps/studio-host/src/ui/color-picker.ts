import { createToolbarPopup } from './toolbar-popup';
import { t } from '../hop-i18n';

/** 기존 형광펜과 같은 색상표를 글자색 팔레트에도 사용한다. */
const COLOR_PALETTE = [
  ['#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff'],
  ['#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080', '#c0c0c0', '#808080'],
  ['#ff9999', '#ffcc99', '#ffff99', '#ccff99', '#99ff99', '#99ffcc', '#99ffff'],
  ['#99ccff', '#9999ff', '#cc99ff', '#ff99ff', '#ff99cc', '#e0e0e0', '#404040'],
  ['#cc0000', '#cc6600', '#cccc00', '#66cc00', '#00cc00', '#00cc66', '#00cccc'],
  ['#0066cc', '#0000cc', '#6600cc', '#cc00cc', '#cc0066', '#999999', '#000000'],
];

const RECENT_COLORS_KEY = 'hop.recent-text-colors';
const RECENT_COLORS_LIMIT = 7;

function readRecentColors(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_COLORS_KEY) ?? '[]');
    if (!Array.isArray(saved)) return [];
    const colors = saved.filter((color): color is string => (
      typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
    )).map((color) => color.toLowerCase());
    return [...new Set(colors)].slice(0, RECENT_COLORS_LIMIT);
  } catch {
    return [];
  }
}

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function createSwatch(color: string, onSelect: (color: string) => void): HTMLButtonElement {
  const swatch = createButton('', () => onSelect(color));
  swatch.className = 'sb-hl-swatch';
  swatch.style.background = color;
  swatch.setAttribute('aria-label', color);
  swatch.title = color;
  return swatch;
}

function appendColors(panel: HTMLElement, onSelect: (color: string) => void): void {
  const gray = ['#000000', '#404040', '#808080', '#c0c0c0', '#e0e0e0', '#f0f0f0', '#ffffff'];
  for (const colors of [gray, ...COLOR_PALETTE]) {
    const row = document.createElement('div');
    row.className = 'sb-hl-palette-row';
    row.append(...colors.map(color => createSwatch(color, onSelect)));
    panel.appendChild(row);
  }
}

function appendRecentColors(panel: HTMLElement, onSelect: (color: string) => void) {
  const recent = document.createElement('div');
  recent.className = 'hop-recent-colors';
  const label = document.createElement('div');
  label.textContent = t('hop.color.recent');
  const row = document.createElement('div');
  row.className = 'sb-hl-palette-row';
  recent.append(label, row);
  panel.appendChild(recent);
  let colors = readRecentColors();
  let hasUnsavedColors = false;
  const render = () => {
    row.replaceChildren(...colors.map(color => createSwatch(color, onSelect)));
    if (colors.length === 0) row.textContent = t('hop.color.noneYet');
  };
  render();
  return (color: string) => {
    // Merge other windows' choices without losing unsaved in-memory history.
    const shared = hasUnsavedColors ? [] : readRecentColors();
    colors = [...new Set([color, ...shared, ...colors])].slice(0, RECENT_COLORS_LIMIT);
    try {
      localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(colors));
      hasUnsavedColors = false;
    } catch { hasUnsavedColors = true; }
    render();
  };
}

interface ColorPickerOptions {
  remember?: boolean;
  clear?: boolean;
  documentVersion?: () => number;
}

/** The text and highlight controls use the same palette and native picker. */
export function setupColorPicker(
  host: HTMLElement,
  onSelect: (color: string) => void,
  options: ColorPickerOptions = {},
): HTMLInputElement {
  const button = host.querySelector<HTMLButtonElement>('button')!;
  const picker = host.querySelector<HTMLInputElement>('input') ?? document.createElement('input');
  picker.type = 'color';
  picker.tabIndex = -1;
  picker.classList.add('hop-color-input');
  picker.setAttribute('aria-label', button.title);
  picker.setAttribute('aria-hidden', 'true');
  if (!picker.parentElement) host.appendChild(picker);
  const panel = host.querySelector<HTMLElement>('.sb-hl-palette') ?? document.createElement('div');
  panel.id ||= `${button.id}-palette`;
  panel.className = 'sb-hl-palette hop-color-palette';
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', button.title);
  if (!panel.parentElement) host.appendChild(panel);
  button.setAttribute('aria-controls', panel.id);
  const popup = createToolbarPopup(host, button, panel);
  let nativeChoice: { documentVersion: number | undefined; color: string } | undefined;
  const applyColor = (color: string) => {
    if (nativeChoice) nativeChoice.color = color;
    remember?.(color);
    picker.value = color;
    popup.close();
    onSelect(color);
  };
  appendColors(panel, applyColor);
  const remember = options.remember ? appendRecentColors(panel, applyColor) : undefined;
  const actions = document.createElement('div');
  actions.className = 'sb-hl-palette-actions';
  if (options.clear) actions.appendChild(createButton(t('hop.color.noColor'), () => applyColor('#ffffff')));
  actions.appendChild(createButton(t('hop.color.moreColors'), () => {
    nativeChoice = { documentVersion: options.documentVersion?.(), color: picker.value };
    picker.click();
  }));
  panel.appendChild(actions);
  host.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', popup.toggle);
  // Native choosers may commit several changes while their window stays open.
  // Ignore previews and repeated values, not later distinct commits.
  picker.addEventListener('change', () => {
    // Native choosers outlive the toolbar popup. Scope committed results to
    // their document, not the palette's visibility.
    if (nativeChoice && nativeChoice.documentVersion === options.documentVersion?.()
      && nativeChoice.color !== picker.value) {
      applyColor(picker.value);
    }
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    popup.open();
    panel.querySelector<HTMLButtonElement>('button')!.focus();
  });
  return picker;
}
