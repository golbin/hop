import type { WasmBridge } from '@/upstream/core';

// upstream ApplyCharFormatCommand는 표 셀만 runInBatch로 묶고, 본문 범위는 문단마다
// applyCharFormat → 재페이지네이션을 해서 전체 선택 서식(기울임, 글자 크기)이 O(n²)로 느리다.
// 이 호출들이 이어지는 동안 WASM batch를 하나만 열고, 다른 호출이 오기 직전(또는
// 마이크로태스크)에 닫아 재페이지네이션을 1회로 줄인다.
const BATCHED = new Set([
  'applyCharFormat',
  'applyCharFormatInCellByPath',
  'setCharShapeRuns',
  'setCharShapeRunsInCellByPath',
]);
// batch 안에서 안전한 읽기(레이아웃을 쓰지 않는 문단 길이·글자 모양 조회).
const READ_ONLY = new Set([
  'getCharShapeRuns',
  'getCharShapeRunsInCellByPath',
  'getParagraphLength',
  'getCellParagraphLengthByPath',
]);

type Doc = { beginBatch?: () => string; endBatch?: () => string };

export function batchCharFormat(bridge: WasmBridge): WasmBridge {
  const doc = () => (bridge as unknown as { doc: Doc | null }).doc;
  let open: Doc | null = null;
  let nested = 0; // 호출자가 runInBatch를 이미 열었으면 중복해서 열지 않는다.

  const close = () => {
    const d = open;
    open = null;
    d?.endBatch?.();
  };

  return new Proxy(bridge, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      const fn = value as (...args: unknown[]) => unknown;

      if (prop === 'runInBatch') {
        return (...args: unknown[]) => {
          close();
          nested++;
          try { return fn.apply(target, args); } finally { nested--; }
        };
      }
      if (READ_ONLY.has(prop)) return fn.bind(target);
      if (!BATCHED.has(prop)) {
        return (...args: unknown[]) => {
          close();
          return fn.apply(target, args);
        };
      }
      return (...args: unknown[]) => {
        const d = doc();
        if (!nested && !open && d?.beginBatch && d.endBatch) {
          d.beginBatch();
          open = d;
          queueMicrotask(close);
        }
        return fn.apply(target, args);
      };
    },
  });
}
