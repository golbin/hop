import type { WasmBridge } from '@/core/wasm-bridge';
import type { EventBus } from '@/core/event-bus';
import type { CharProperties } from '@/core/types';
import { resolveCharShapeFontMods } from '@/core/font-application';
import { ModalDialog } from './dialog';
import { CharShapeDialog } from '@upstream/ui/char-shape-dialog';
import { ParaShapeDialog } from '@upstream/ui/para-shape-dialog';

interface StyleInfo {
  id: number;
  name: string;
  englishName: string;
  type: number;
  nextStyleId: number;
}

export class StyleEditDialog extends ModalDialog {
  private nameInput!: HTMLInputElement;
  private enNameInput!: HTMLInputElement;
  private typePara?: HTMLInputElement;
  private typeChar?: HTMLInputElement;
  private nextStyleSelect?: HTMLSelectElement;
  private nextStyleRow?: HTMLElement;
  private charModsJson = '{}';
  private paraModsJson = '{}';
  private pendingCharMods: Promise<void> | null = null;
  private addMode: boolean;
  private styleInfo: StyleInfo;

  onSave?: () => void;
  onClose?: () => void;

  constructor(
    private wasm: WasmBridge,
    private eventBus: EventBus,
    mode: 'add' | 'edit',
    styleInfo?: StyleInfo,
  ) {
    super(mode === 'add' ? '스타일 추가하기' : '스타일 편집하기', 480);
    this.addMode = mode === 'add';
    this.styleInfo = styleInfo ?? { id: -1, name: '새 스타일', englishName: '', type: 0, nextStyleId: 0 };
  }

  protected createBody(): HTMLElement {
    const body = document.createElement('div');
    body.className = 'se-body';

    const nameRow = document.createElement('div');
    nameRow.className = 'se-name-row';

    const nameGroup = document.createElement('div');
    nameGroup.className = 'se-field-group';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'se-label';
    nameLabel.textContent = '스타일 이름(N):';
    this.nameInput = document.createElement('input');
    this.nameInput.className = 'se-field-input';
    this.nameInput.value = this.styleInfo.name;
    nameGroup.appendChild(nameLabel);
    nameGroup.appendChild(this.nameInput);

    const enGroup = document.createElement('div');
    enGroup.className = 'se-field-group';
    const enLabel = document.createElement('label');
    enLabel.className = 'se-label';
    enLabel.textContent = '영문 이름(E):';
    this.enNameInput = document.createElement('input');
    this.enNameInput.className = 'se-field-input';
    this.enNameInput.value = this.styleInfo.englishName;
    enGroup.appendChild(enLabel);
    enGroup.appendChild(this.enNameInput);

    nameRow.appendChild(nameGroup);
    nameRow.appendChild(enGroup);
    body.appendChild(nameRow);

    const typeRow = document.createElement('div');
    typeRow.className = 'se-type-row';

    if (this.addMode) {
      const typeGroup = document.createElement('div');
      typeGroup.className = 'se-field-group';
      const typeLabel = document.createElement('div');
      typeLabel.className = 'se-label';
      typeLabel.textContent = '스타일 종류';
      const radioGroup = document.createElement('div');
      radioGroup.className = 'se-type-radios';

      const lblPara = document.createElement('label');
      this.typePara = document.createElement('input');
      this.typePara.type = 'radio';
      this.typePara.name = 'se-type';
      this.typePara.value = '0';
      this.typePara.checked = true;
      this.typePara.addEventListener('change', () => this.onTypeChange());
      lblPara.appendChild(this.typePara);
      lblPara.appendChild(document.createTextNode(' 문단(P)'));

      const lblChar = document.createElement('label');
      this.typeChar = document.createElement('input');
      this.typeChar.type = 'radio';
      this.typeChar.name = 'se-type';
      this.typeChar.value = '1';
      this.typeChar.addEventListener('change', () => this.onTypeChange());
      lblChar.appendChild(this.typeChar);
      lblChar.appendChild(document.createTextNode(' 글자(C)'));

      radioGroup.appendChild(lblPara);
      radioGroup.appendChild(lblChar);
      typeGroup.appendChild(typeLabel);
      typeGroup.appendChild(radioGroup);
      typeRow.appendChild(typeGroup);
    }

    if (this.styleInfo.type === 0) {
      const nextGroup = document.createElement('div');
      nextGroup.className = 'se-field-group se-next-group';
      const nextLabel = document.createElement('label');
      nextLabel.className = 'se-label';
      nextLabel.textContent = '다음 문단에 적용할 스타일(S):';
      this.nextStyleSelect = document.createElement('select');
      this.nextStyleSelect.className = 'se-field-select';
      this.populateNextStyleSelect();
      nextGroup.appendChild(nextLabel);
      nextGroup.appendChild(this.nextStyleSelect);
      this.nextStyleRow = nextGroup;
      typeRow.appendChild(nextGroup);
    }

    body.appendChild(typeRow);

    const shapeBtns = document.createElement('div');
    shapeBtns.className = 'se-shape-btns';

    const btnPara = document.createElement('button');
    btnPara.type = 'button';
    btnPara.className = 'se-shape-btn';
    btnPara.textContent = '문단 모양(T)...';
    btnPara.addEventListener('click', () => this.openParaDialog());

    const btnChar = document.createElement('button');
    btnChar.type = 'button';
    btnChar.className = 'se-shape-btn';
    btnChar.textContent = '글자 모양(L)...';
    btnChar.addEventListener('click', () => this.openCharDialog());

    shapeBtns.appendChild(btnPara);
    shapeBtns.appendChild(btnChar);
    body.appendChild(shapeBtns);

    const note = document.createElement('div');
    note.className = 'se-note';
    note.textContent = '스타일 이름은 다르지만 영문 이름이 같은 경우에는 두 스타일을 같은 스타일로 인식합니다.';
    body.appendChild(note);

    return body;
  }

  private populateNextStyleSelect(): void {
    if (!this.nextStyleSelect) return;
    this.nextStyleSelect.innerHTML = '';
    try {
      const styles = this.wasm.getStyleList();
      for (const s of styles) {
        if (s.type !== 0) continue;
        const opt = document.createElement('option');
        opt.value = String(s.id);
        opt.textContent = s.name;
        if (s.id === this.styleInfo.nextStyleId) opt.selected = true;
        this.nextStyleSelect.appendChild(opt);
      }
    } catch {
      // 무시
    }
  }

  private onTypeChange(): void {
    if (this.nextStyleRow) {
      this.nextStyleRow.style.display = this.typePara?.checked ? '' : 'none';
    }
  }

  private openParaDialog(): void {
    if (this.addMode && this.styleInfo.id < 0) {
      const dialog = new ParaShapeDialog(this.wasm, this.eventBus);
      dialog.onApply = (mods: object) => {
        this.paraModsJson = JSON.stringify(mods);
      };
      dialog.show({});
      return;
    }
    try {
      const detail = this.wasm.getStyleDetail(this.styleInfo.id);
      const dialog = new ParaShapeDialog(this.wasm, this.eventBus);
      dialog.onApply = (mods: object) => {
        this.paraModsJson = JSON.stringify(mods);
      };
      dialog.show(detail.paraProps);
    } catch (err) {
      console.warn('[StyleEditDialog] 문단 모양 열기 실패:', err);
    }
  }

  private openCharDialog(): void {
    const dialog = new CharShapeDialog(this.wasm, this.eventBus);
    dialog.onApply = (mods: Partial<CharProperties>) => {
      this.pendingCharMods = this.storeCharMods(mods);
    };

    if (this.addMode && this.styleInfo.id < 0) {
      dialog.show({});
      return;
    }

    try {
      const detail = this.wasm.getStyleDetail(this.styleInfo.id);
      dialog.show(detail.charProps);
    } catch (err) {
      console.warn('[StyleEditDialog] 글자 모양 열기 실패:', err);
    }
  }

  private async storeCharMods(mods: Partial<CharProperties>): Promise<void> {
    this.charModsJson = JSON.stringify(await resolveCharShapeFontMods(this.wasm, mods));
  }

  protected async onConfirm(): Promise<void | boolean> {
    await this.pendingCharMods;

    const name = this.nameInput.value.trim();
    const englishName = this.enNameInput.value.trim();
    const styleType = this.typePara?.checked ? 0 : (this.styleInfo.type ?? 0);
    const nextStyleId = this.nextStyleSelect ? (parseInt(this.nextStyleSelect.value) || 0) : this.styleInfo.nextStyleId;

    if (!name) {
      alert('스타일 이름을 입력하세요.');
      return false;
    }

    try {
      if (this.addMode) {
        const newId = this.wasm.createStyle(JSON.stringify({
          name, englishName, type: styleType, nextStyleId,
        }));
        if (this.charModsJson !== '{}' || this.paraModsJson !== '{}') {
          this.wasm.updateStyleShapes(newId, this.charModsJson, this.paraModsJson);
        }
      } else {
        this.wasm.updateStyle(this.styleInfo.id, JSON.stringify({
          name, englishName, nextStyleId,
        }));
        if (this.charModsJson !== '{}' || this.paraModsJson !== '{}') {
          this.wasm.updateStyleShapes(this.styleInfo.id, this.charModsJson, this.paraModsJson);
        }
      }
      this.onSave?.();
    } catch (err) {
      console.warn('[StyleEditDialog] 저장 실패:', err);
      return false;
    }
  }

  override show(): void {
    super.show();
    const confirmBtn = this.dialog.querySelector('.dialog-btn-primary');
    if (confirmBtn) {
      confirmBtn.textContent = this.addMode ? '추가(D)' : '설정(D)';
    }
  }

  override hide(): void {
    super.hide();
    this.onClose?.();
  }
}
