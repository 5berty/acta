import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, platformLabel, remainingSeconds, dbToLevel, tasksSplit, findTemaByPath } from "./format";

describe("format", () => {
  it("formatClock da mm:ss y h:mm:ss", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });
  it("formatDuration es legible", () => {
    expect(formatDuration(900_000)).toBe("15 min");
    expect(formatDuration(3_900_000)).toBe("1 h 5 min");
    expect(formatDuration(20_000)).toBe("<1 min");
  });
  it("platformLabel", () => {
    expect(platformLabel("teams")).toBe("Teams");
    expect(platformLabel("meet")).toBe("Google Meet");
  });
  it("remainingSeconds nunca baja de 0", () => {
    expect(remainingSeconds(1000, 5000, 3000)).toBe(3);
    expect(remainingSeconds(1000, 5000, 100_000)).toBe(0);
  });
  it("dbToLevel normaliza a 0..1", () => {
    expect(dbToLevel(-60)).toBe(0);
    expect(dbToLevel(0)).toBe(1);
    expect(dbToLevel(-30)).toBeCloseTo(0.5);
    expect(dbToLevel(-200)).toBe(0);
  });
  it("tasksSplit separa mías y de otros", () => {
    const a = { isMine: true } as never;
    const b = { isMine: false } as never;
    expect(tasksSplit([a, b])).toEqual({ mine: [a], others: [b] });
  });
  it("findTemaByPath resuelve rutas 1-based", () => {
    const t = (titulo: string, subtemas: never[] = []) => ({ titulo, resumen: "", inicio_ms: 0, fin_ms: 0, subtemas, capturas: [] });
    const esc = { temas: [t("A"), t("B", [t("B1")] as never[])] };
    expect(findTemaByPath(esc, "2.1")?.titulo).toBe("B1");
    expect(findTemaByPath(esc, "3")).toBeNull();
  });
});
