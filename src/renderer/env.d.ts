/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<object, object, any>;
  export default component;
}

import type { ElectronAPI } from '../preload/preload';

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
