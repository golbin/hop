import { editCommands as upstreamEditCommands } from '@upstream/command/commands/edit';
import type { CommandDef } from '@upstream/command/types';

type ClipboardCapableInputHandler = {
  performCopy?: () => void;
  performCut?: () => void;
  performPaste?: () => void | Promise<void>;
};

const hopEditCommandById = new Map<string, CommandDef>([
  ['edit:cut', {
    id: 'edit:cut',
    label: '오려 두기',
    icon: 'icon-cut',
    shortcutLabel: 'Ctrl+X',
    canExecute: (ctx) => ctx.hasDocument && (ctx.hasSelection || ctx.inPictureObjectSelection || ctx.inTableObjectSelection),
    execute(services) {
      (services.getInputHandler() as ClipboardCapableInputHandler | null)?.performCut?.();
    },
  }],
  ['edit:copy', {
    id: 'edit:copy',
    label: '복사하기',
    icon: 'icon-copy',
    shortcutLabel: 'Ctrl+C',
    canExecute: (ctx) => ctx.hasDocument && (ctx.hasSelection || ctx.inPictureObjectSelection || ctx.inTableObjectSelection),
    execute(services) {
      (services.getInputHandler() as ClipboardCapableInputHandler | null)?.performCopy?.();
    },
  }],
  ['edit:paste', {
    id: 'edit:paste',
    label: '붙이기',
    icon: 'icon-paste',
    shortcutLabel: 'Ctrl+V',
    canExecute: (ctx) => ctx.hasDocument,
    execute(services) {
      void (services.getInputHandler() as ClipboardCapableInputHandler | null)?.performPaste?.();
    },
  }],
]);

export const editCommands: CommandDef[] = upstreamEditCommands.map((command) =>
  hopEditCommandById.get(command.id) ?? command,
);
