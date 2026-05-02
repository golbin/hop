import { describe, expect, it, vi } from 'vitest';

vi.mock('@upstream/command/commands/edit', () => ({
  editCommands: [
    { id: 'edit:copy', label: '복사하기', execute: vi.fn() },
    { id: 'edit:paste', label: '붙이기', execute: vi.fn() },
    { id: 'edit:find', label: '찾기', execute: vi.fn() },
  ],
}));

import { editCommands } from './edit';

describe('edit command overrides', () => {
  it('routes paste through the input handler instead of document.execCommand', () => {
    const performPaste = vi.fn();
    const command = editCommands.find((item) => item.id === 'edit:paste');

    command?.execute({
      getInputHandler: () => ({ performPaste }),
    } as never);

    expect(performPaste).toHaveBeenCalled();
  });

  it('keeps unrelated upstream edit commands available', () => {
    expect(editCommands.some((item) => item.id === 'edit:find')).toBe(true);
  });
});
