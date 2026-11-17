// Punto de entrada del módulo api. La UI importa SIEMPRE de aquí:
//   import { api } from "../api";
// Dentro de Tauri usa SIEMPRE la implementación real; en tests, el mock. Los
// datos de demostración solo con `VITE_ACTA_DEMO=1` explícito en desarrollo
// (nunca en un build de producción): quien usa la app no debe ver reuniones de mentira.

import type { ActaApi } from "./contract";
import { createDemoApi, type DemoOverlay } from "./demo";
import { createMockApi } from "./mock";
import { createTauriApi } from "./tauri";

export * from "./contract";
export type * from "./types";
export { createMockApi } from "./mock";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type ApiKind = "tauri" | "demo" | "mock";

export interface ApiEnv {
  mode: string;
  dev: boolean;
  demoFlag: string | undefined;
  tauri: boolean;
}

/** Qué implementación usar (lógica pura, testeada en index.test.ts). */
export function apiKind(e: ApiEnv): ApiKind {
  if (e.mode === "test") return "mock";
  if (e.dev && e.demoFlag === "1") return "demo";
  return e.tauri ? "tauri" : "mock";
}

function pick(): ActaApi {
  const env = import.meta.env;
  const kind = apiKind({ mode: env.MODE, dev: env.DEV, demoFlag: env.VITE_ACTA_DEMO, tauri: isTauri() });
  if (kind === "demo") {
    const params = new URLSearchParams(window.location.search);
    const overlay = (params.get("state") ?? env.VITE_ACTA_DEMO_OVERLAY ?? "idle") as DemoOverlay;
    return createDemoApi(overlay, { onboarding: params.has("onboarding"), noLocal: params.has("nolocal") }).api;
  }
  return kind === "tauri" ? createTauriApi() : createMockApi().api;
}

export const api: ActaApi = pick();
