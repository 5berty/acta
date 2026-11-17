import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../api";
import { buildTicks, buildTopics, currentTopicKey, layoutMarkers, msAtX, tickStep } from "./model";

const topic = (at: number, end: number | null, label: string, refId: string | null): TimelineEvent => ({ at, end, kind: "topic", label, refId });

describe("marcas del eje", () => {
  it("elige un paso redondo según la duración y el ancho", () => {
    expect(tickStep(9 * 60_000, 720)).toBe(60_000);
    expect(tickStep(90 * 60_000, 720)).toBe(10 * 60_000);
    expect(tickStep(90 * 60_000, 1600)).toBe(5 * 60_000);
    expect(tickStep(40_000, 720)).toBe(5_000);
  });

  it("las marcas nunca están más juntas que una etiqueta", () => {
    for (const [total, width] of [[9 * 60_000, 520], [90 * 60_000, 520], [3 * 3_600_000, 700], [61_000, 2000]] as const) {
      const ticks = buildTicks(total, width);
      expect(ticks[0]).toBe(0);
      expect(ticks.length).toBeGreaterThan(1);
      const stepPx = ((ticks[1] ?? 0) / total) * width;
      expect(stepPx).toBeGreaterThanOrEqual(64);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(Math.max(...ticks)).toBeLessThanOrEqual(total);
    }
  });
});

describe("temas", () => {
  it("numera por la ruta y calcula la profundidad", () => {
    const topics = buildTopics([topic(0, 60_000, "A", "1"), topic(60_000, 120_000, "B", "2"), topic(70_000, 90_000, "B1", "2.1")], 120_000);
    expect(topics.map((t) => [t.number, t.depth])).toEqual([["1", 0], ["2", 0], ["2.1", 1]]);
  });

  it("sin ruta numera en orden y, sin final, llega hasta el siguiente tema", () => {
    const topics = buildTopics([topic(50_000, null, "B", null), topic(0, null, "A", null)], 100_000);
    expect(topics.map((t) => [t.number, t.title, t.at, t.end])).toEqual([["1", "A", 0, 50_000], ["2", "B", 50_000, 100_000]]);
  });

  it("el tema actual es el más profundo que contiene la posición", () => {
    const topics = buildTopics([topic(0, 60_000, "A", "1"), topic(60_000, 120_000, "B", "2"), topic(70_000, 90_000, "B1", "2.1")], 120_000);
    const key = (n: string) => topics.find((t) => t.number === n)?.key;
    expect(currentTopicKey(topics, 75_000)).toBe(key("2.1"));
    expect(currentTopicKey(topics, 95_000)).toBe(key("2"));
    expect(currentTopicKey(topics, 0)).toBe(key("1"));
    expect(currentTopicKey(topics, 500_000)).toBeNull();
  });
});

describe("marcadores", () => {
  const at = (ms: number) => ({ at: ms });

  it("los separados van en la primera fila", () => {
    const slots = layoutMarkers([at(0), at(50_000), at(100_000)], 100_000, 700);
    expect(slots.map((s) => [s.row, s.items.length])).toEqual([[0, 1], [0, 1], [0, 1]]);
  });

  it("los que se pisan se apilan en filas y, a partir de ahí, se agrupan", () => {
    const slots = layoutMarkers([at(50_000), at(50_100), at(50_200), at(50_300), at(50_400)], 100_000, 700);
    expect(slots.map((s) => [s.row, s.items.length])).toEqual([[0, 1], [1, 1], [2, 3]]);
    expect(slots.flatMap((s) => s.items)).toHaveLength(5);
  });

  it("40 tareas en 90 minutos caben en tres filas sin perder ninguna", () => {
    const items = Array.from({ length: 40 }, (_, i) => at(i < 30 ? i * 170_000 : 5_300_000 + i * 1_000));
    const slots = layoutMarkers(items, 5_400_000, 700);
    expect(Math.max(...slots.map((s) => s.row))).toBeLessThanOrEqual(2);
    expect(slots.reduce((n, s) => n + s.items.length, 0)).toBe(40);
  });
});

describe("del puntero al tiempo", () => {
  it("es proporcional y no se sale", () => {
    const rect = { left: 100, width: 800 };
    expect(msAtX(500, rect, 600_000)).toBe(300_000);
    expect(msAtX(100, rect, 600_000)).toBe(0);
    expect(msAtX(20, rect, 600_000)).toBe(0);
    expect(msAtX(5000, rect, 600_000)).toBe(600_000);
    expect(msAtX(500, { left: 0, width: 0 }, 600_000)).toBe(0);
  });
});
