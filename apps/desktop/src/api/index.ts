// Punto de entrada del módulo api. La UI importa SIEMPRE de aquí:
//   import { api } from "../api";
// Dentro de Tauri usa la implementación real; en tests, el mock; y en
// desarrollo sin Tauri (o con VITE_ACTA_DEMO=1), los datos de demostración.

import type { ActaApi } from "./contract";
import { createDemoApi, type DemoOverlay } from "./demo";
import { createMockApi } from "./mock";
import { createTauriApi } from "./tauri";

export * from "./contract";
export type * from "./types";
export { createMockApi } from "./mock";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function pick(): ActaApi {
  const env = import.meta.env;
  if (env.MODE === "test") return createMockApi().api;
  const demo = env.DEV && (env.VITE_ACTA_DEMO === "1" || !isTauri());
  if (demo) {
    const overlay = (new URLSearchParams(window.location.search).get("state") ?? env.VITE_ACTA_DEMO_OVERLAY ?? "idle") as DemoOverlay;
    return createDemoApi(overlay).api;
  }
  return isTauri() ? createTauriApi() : createMockApi().api;
}

export const api: ActaApi = pick();
