import { formatCommands as upstreamFormatCommands } from '@upstream/command/commands/format';
import type { CommandDef } from '@upstream/command/types';
import { CharShapeDialog } from '@/ui/char-shape-dialog';
import { resolveCharShapeFontMods } from '@/core/font-application';

const hopFormatCommandById = new Map<string, CommandDef>([
  ['format:char-shape', {
    id: 'format:char-shape',
    label: '글자 모양',
    icon: 'icon-char-shape',
    shortcutLabel: 'Alt+L',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      const ih = services.getInputHandler();
      if (!ih) return;

      const charProps = ih.getCharProperties();
      const savedSel = ih.getSelection();
      if (!savedSel) return;

      const dialog = new CharShapeDialog(services.wasm, services.eventBus);
      dialog.onApply = (mods) => {
        void (async () => {
          const resolvedMods = await resolveCharShapeFontMods(services.wasm, mods);
          ih.applyCharPropsToRange(savedSel.start, savedSel.end, resolvedMods);
        })().catch((error) => {
          console.warn('[format:char-shape] 글꼴 적용 실패:', error);
        });
      };
      dialog.onClose = () => ih.focus();
      dialog.show(charProps);
    },
  }],
]);

export const formatCommands: CommandDef[] = upstreamFormatCommands.map((command) =>
  hopFormatCommandById.get(command.id) ?? command,
);
