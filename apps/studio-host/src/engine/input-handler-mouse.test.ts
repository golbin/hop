import { describe, expect, it, vi } from 'vitest';
import { hitTestNearPagePoint, selectParagraphAtPointer, tryHandleCellSelectionClick } from './input-handler-mouse';

describe('hitTestNearPagePoint', () => {
  it('falls back to nearby points when the exact click misses text', () => {
    const hitTest = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('miss');
      })
      .mockReturnValueOnce({ paragraphIndex: 0xFFFFFF00 })
      .mockReturnValueOnce({ sectionIndex: 0, paragraphIndex: 2, charOffset: 5 });

    const hit = hitTestNearPagePoint({ hitTest }, 0, 100, 200);

    expect(hit).toEqual({ sectionIndex: 0, paragraphIndex: 2, charOffset: 5 });
    expect(hitTest).toHaveBeenNthCalledWith(1, 0, 100, 200);
    expect(hitTest).toHaveBeenNthCalledWith(2, 0, 96, 200);
    expect(hitTest).toHaveBeenNthCalledWith(3, 0, 104, 200);
  });
});

describe('tryHandleCellSelectionClick', () => {
  it('promotes phase 1 selection into a mouse-driven range selection on plain click', () => {
    const advanceCellSelectionPhase = vi.fn();
    const shiftSelectCell = vi.fn();
    const updateCellSelection = vi.fn();
    const focus = vi.fn();
    const preventDefault = vi.fn();

    const handled = tryHandleCellSelectionClick.call(
      {
        cursor: {
          isInCellSelectionMode: () => true,
          getCellSelectionPhase: vi.fn()
            .mockReturnValueOnce(1)
            .mockReturnValueOnce(2),
          advanceCellSelectionPhase,
          shiftSelectCell,
          ctrlToggleCell: vi.fn(),
        },
        hitTestCellRowCol: () => ({ row: 2, col: 3 }),
        updateCellSelection,
        textarea: { focus },
      },
      {
        button: 0,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault,
      } as unknown as MouseEvent,
    );

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(advanceCellSelectionPhase).toHaveBeenCalled();
    expect(shiftSelectCell).toHaveBeenCalledWith(2, 3);
    expect(updateCellSelection).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });

  it('preserves modifier-driven selection behaviors', () => {
    const shiftSelectCell = vi.fn();
    const ctrlToggleCell = vi.fn();

    const handled = tryHandleCellSelectionClick.call(
      {
        cursor: {
          isInCellSelectionMode: () => true,
          getCellSelectionPhase: () => 2,
          advanceCellSelectionPhase: vi.fn(),
          shiftSelectCell,
          ctrlToggleCell,
        },
        hitTestCellRowCol: () => ({ row: 1, col: 1 }),
        updateCellSelection: vi.fn(),
        textarea: { focus: vi.fn() },
      },
      {
        button: 0,
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
      } as unknown as MouseEvent,
    );

    expect(handled).toBe(true);
    expect(shiftSelectCell).toHaveBeenCalledWith(1, 1);
    expect(ctrlToggleCell).not.toHaveBeenCalled();
  });
});

describe('selectParagraphAtPointer', () => {
  it('selects the whole paragraph under a double-click', () => {
    const clearSelection = vi.fn();
    const moveTo = vi.fn();
    const setAnchor = vi.fn();
    const updateCaret = vi.fn();
    const focus = vi.fn();

    const handled = selectParagraphAtPointer.call(
      {
        viewportManager: { getZoom: () => 2 },
        container: {
          querySelector: () => ({
            clientWidth: 500,
            getBoundingClientRect: () => ({ left: 10, top: 20 }),
          }),
        },
        virtualScroll: {
          getPageAtY: () => 0,
          getPageOffset: () => 100,
          getPageLeft: () => null,
          getPageWidth: () => 400,
        },
        wasm: {
          hitTest: vi.fn(() => ({ sectionIndex: 0, paragraphIndex: 3, charOffset: 4 })),
          getParagraphLength: vi.fn(() => 12),
        },
        cursor: { clearSelection, moveTo, setAnchor },
        updateCaret,
        textarea: { focus },
      },
      {
        clientX: 210,
        clientY: 140,
        target: { closest: () => null },
      } as unknown as MouseEvent,
    );

    expect(handled).toBe(true);
    expect(clearSelection).toHaveBeenCalled();
    expect(moveTo).toHaveBeenNthCalledWith(1, { sectionIndex: 0, paragraphIndex: 3, charOffset: 0 });
    expect(setAnchor).toHaveBeenCalled();
    expect(moveTo).toHaveBeenNthCalledWith(2, { sectionIndex: 0, paragraphIndex: 3, charOffset: 12 });
    expect(updateCaret).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
  });
});
