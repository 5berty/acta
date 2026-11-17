import { describe, expect, it } from "vitest";
import { createMockApi } from "../../api";
import { defaultSettings, freshSettings } from "../../api/mock";

// acta la usa más gente que quien la escribió: nada de su nombre, sus alias ni
// sus carpetas puede quedar en lo que se enseña o se trae por defecto.
const PERSONAL = /\bEdu\b|Eduardo|Navajas|claude-personal/;

const sources = import.meta.glob<string>(["../onboarding/**/*.{ts,tsx}", "../settings/**/*.{ts,tsx}", "../providers/**/*.{ts,tsx}", "../../styles/{onboarding,settings,providers}.css"], { query: "?raw", import: "default", eager: true });

describe("sin datos personales del autor", () => {
  const files = Object.entries(sources).filter(([path]) => !/\.test\.tsx?$/.test(path));

  it("mira el código de la bienvenida, los ajustes y los proveedores", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some(([p]) => p.endsWith("Onboarding.tsx"))).toBe(true);
    expect(files.some(([p]) => p.endsWith("GeneralSections.tsx"))).toBe(true);
    expect(files.some(([p]) => p.endsWith("presets.ts"))).toBe(true);
  });

  it("ningún archivo de esas pantallas los nombra", () => {
    const hits = files.flatMap(([path, text]) =>
      text
        .split("\n")
        .map((line, i) => (PERSONAL.test(line) ? `${path}:${i + 1}: ${line.trim()}` : null))
        .filter((x): x is string => x !== null),
    );
    expect(hits).toEqual([]);
  });

  it("los ajustes por defecto del mock tampoco", () => {
    expect(JSON.stringify(defaultSettings())).not.toMatch(PERSONAL);
    expect(JSON.stringify(freshSettings())).not.toMatch(PERSONAL);
    expect(JSON.stringify(createMockApi().controls.state.systemProfile)).not.toMatch(PERSONAL);
  });

  it("una instalación nueva no trae nombre, ni idioma forzado, ni proveedor de IA", () => {
    const s = freshSettings();
    expect(s.user).toEqual({ displayName: "", aliases: [] });
    expect(s.transcription.language).toBe("auto");
    expect(s.llm).toEqual({ providers: [], minutesProvider: null, chatProvider: null, namingProvider: null });
    expect(s.onboarding.completed).toBe(false);
  });
});
