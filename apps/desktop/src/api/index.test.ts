import { describe, expect, it } from "vitest";
import { apiKind } from "./index";

// Edu nunca debe ver reuniones de mentira: dentro de Tauri siempre el backend
// real, salvo en desarrollo con VITE_ACTA_DEMO=1 explícito.
describe("apiKind", () => {
  it("uses the real backend inside Tauri without the explicit demo flag", () => {
    expect(apiKind({ mode: "production", dev: false, demoFlag: undefined, tauri: true })).toBe("tauri");
    expect(apiKind({ mode: "development", dev: true, demoFlag: undefined, tauri: true })).toBe("tauri");
    expect(apiKind({ mode: "development", dev: true, demoFlag: "0", tauri: true })).toBe("tauri");
  });

  it("ignores the demo flag in production builds", () => {
    expect(apiKind({ mode: "production", dev: false, demoFlag: "1", tauri: true })).toBe("tauri");
  });

  it("only shows demo data when explicitly asked in development", () => {
    expect(apiKind({ mode: "development", dev: true, demoFlag: "1", tauri: true })).toBe("demo");
    expect(apiKind({ mode: "development", dev: true, demoFlag: "1", tauri: false })).toBe("demo");
    expect(apiKind({ mode: "development", dev: true, demoFlag: undefined, tauri: false })).toBe("mock");
  });

  it("uses the mock in tests", () => {
    expect(apiKind({ mode: "test", dev: true, demoFlag: "1", tauri: false })).toBe("mock");
  });
});
