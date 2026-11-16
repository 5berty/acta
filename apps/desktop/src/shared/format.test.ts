import { describe, expect, it } from "vitest";
import { formatClock, formatDuration, platformLabel, remainingSeconds, dbToLevel, tasksSplit, findTemaByPath } from "./format";
import { appDisplayName, dayBucket, formatTime, groupByDay, humanizeError, initials } from "./format";

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

describe("agrupar por día", () => {
  const now = new Date(2026, 10, 18, 12, 0).getTime(); // miércoles 18-nov-2026
  const at = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();

  it("etiqueta hoy, ayer, esta semana y meses anteriores", () => {
    expect(dayBucket(at(18, 9), now)).toEqual({ key: "today", label: "Hoy" });
    expect(dayBucket(at(17), now)).toEqual({ key: "yesterday", label: "Ayer" });
    expect(dayBucket(at(16), now)).toEqual({ key: "week", label: "Esta semana" });
    expect(dayBucket(at(9), now).label).toBe("Noviembre de 2026");
    expect(dayBucket(new Date(2026, 8, 3).getTime(), now).label).toBe("Septiembre de 2026");
  });

  it("el lunes, el domingo anterior ya no es «esta semana»", () => {
    const monday = new Date(2026, 10, 16, 12).getTime();
    expect(dayBucket(at(15), monday).label).toBe("Ayer");
    expect(dayBucket(at(14), monday).label).toBe("Noviembre de 2026");
  });

  it("agrupa conservando el orden de llegada", () => {
    const groups = groupByDay([{ startedAt: at(18) }, { startedAt: at(18, 8) }, { startedAt: at(17) }], now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([["Hoy", 2], ["Ayer", 1]]);
  });
});

describe("nombres y errores para humanos", () => {
  it("saca iniciales", () => {
    expect(initials("Ana García")).toBe("AG");
    expect(initials("edu")).toBe("E");
    expect(initials("Speaker 1")).toBe("S1");
    expect(initials("  ")).toBe("?");
  });

  it("traduce un bundle id a un nombre de app", () => {
    expect(appDisplayName("com.microsoft.teams2")).toBe("Microsoft Teams");
    expect(appDisplayName("us.zoom.xos")).toBe("Zoom");
    expect(appDisplayName("com.typeless.app")).toBe("Typeless");
    expect(appDisplayName("com.acme.super-notes")).toBe("Super Notes");
  });

  it("explica los errores de procesado sin jerga", () => {
    expect(humanizeError("claude: command not found (os error 2)").title).toBe("No encuentro el asistente de IA");
    expect(humanizeError("timeout tras 600 s").title).toBe("La IA ha tardado demasiado");
    expect(humanizeError("HTTP 401 Unauthorized").title).toBe("La clave de la IA no es válida");
    expect(humanizeError("model whisper not downloaded").title).toBe("Falta descargar un modelo de voz");
    expect(humanizeError("No space left on device").title).toBe("No queda espacio en el disco");
    const unknown = humanizeError("algo raro");
    expect(unknown.title).toBe("No se ha podido terminar el acta");
    expect(unknown.hint).toMatch(/audio está a salvo/);
    expect(humanizeError(null).title).toBe("No se ha podido terminar el acta");
  });

  it("formatea la hora del día", () => {
    expect(formatTime(new Date(2026, 10, 18, 9, 5).getTime())).toBe("9:05");
  });
});
