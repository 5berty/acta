// Punto de entrada del módulo api. La UI importa SIEMPRE de aquí:
//   import { api } from "../api";
// Dentro de Tauri usa la implementación real; en navegador/tests, el mock.

import type { ActaApi } from "./contract";
import { createMockApi } from "./mock";
import { createTauriApi } from "./tauri";

export * from "./contract";
export type * from "./types";
export { createMockApi } from "./mock";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api: ActaApi = isTauri() ? createTauriApi() : createMockApi().api;
