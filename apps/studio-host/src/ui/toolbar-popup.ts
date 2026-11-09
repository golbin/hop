interface Popup {
  host: HTMLElement;
  button: HTMLButtonElement;
  close(): void;
}

const activePopups = new WeakMap<Document, Popup>();
const observedDocuments = new WeakSet<Document>();

function observePopups(doc: Document): void {
  if (observedDocuments.has(doc)) return;
  observedDocuments.add(doc);
  const closeOutside = (event: Event) => {
    const active = activePopups.get(doc);
    if (active && !active.host.contains(event.target as Node)) active.close();
  };
  doc.addEventListener('mousedown', closeOutside, true);
  doc.addEventListener('focusin', closeOutside);
  doc.addEventListener('keydown', (event) => {
    const active = activePopups.get(doc);
    if (event.key !== 'Escape' || !active) return;
    event.stopPropagation();
    active.close();
    active.button.focus();
  }, true);
}

export function closeToolbarPopup(): void {
  activePopups.get(document)?.close();
}

/** Document listeners track only the open popup, not every enhanced control. */
export function createToolbarPopup(host: HTMLElement, button: HTMLButtonElement, panel: HTMLElement) {
  const doc = document;
  observePopups(doc);
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    host.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  const close = () => {
    setOpen(false);
    if (activePopups.get(doc)?.host === host) activePopups.delete(doc);
  };
  const open = () => {
    if (button.disabled) return;
    activePopups.get(doc)?.close();
    setOpen(true);
    activePopups.set(doc, { host, button, close });
  };
  close();
  return { open, close, toggle: () => { if (panel.hidden) open(); else close(); } };
}
