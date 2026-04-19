/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module '@wasm/rhwp.js' {
  export * from '@rhwp/core';
  export { default } from '@rhwp/core';
}
