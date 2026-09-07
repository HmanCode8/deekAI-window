/// <reference types="vite/client" />

import type { DeekaiBridge } from "@shared/bridge-api";

declare global {
  interface Window {
    deekai: DeekaiBridge;
  }
}

export {};
