import React from 'react';
import ReactDOM from 'react-dom/client';
import { AgentSidebar } from './AgentSidebar';
import type { DesktopBridgeApi } from '@/core/tauri-bridge';

export class AISidebar {
  private container: HTMLElement;
  private root: ReactDOM.Root;
  private bridge: DesktopBridgeApi;
  private onDocumentChanged: (() => void) | undefined;

  constructor(container: HTMLElement, bridge: DesktopBridgeApi, onDocumentChanged?: () => void) {
    this.container = container;
    this.bridge = bridge;
    this.onDocumentChanged = onDocumentChanged;
    this.root = ReactDOM.createRoot(this.container);
    this.init();
  }

  private init() {
    this.root.render(React.createElement(AgentSidebar, { bridge: this.bridge, onDocumentChanged: this.onDocumentChanged }));
  }

  public toggle() {
    this.container.classList.toggle('collapsed');
  }

  public isOpen(): boolean {
    return !this.container.classList.contains('collapsed');
  }
}
