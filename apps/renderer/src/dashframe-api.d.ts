import type { DashFrameApi } from "@dashframe/desktop-types";

declare global {
  interface Window {
    dashframe: DashFrameApi;
  }
}

export {};
