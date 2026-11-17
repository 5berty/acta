import type { TimelineEvent } from "../../api";

/** Ancho supuesto del trazado mientras no se ha medido (y en jsdom, que no maqueta). */
export const DEFAULT_PLOT_PX = 720;
/** Sitio que necesita una etiqueta del eje («1:30:00») para no tocar a la siguiente. */
const TICK_LABEL_PX = 72;
const TICK_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14_400].map((s) => s * 1000);

/** Paso «redondo» más pequeño cuyas etiquetas no se pisan en `widthPx`. */
export function tickStep(totalMs: number, widthPx: number): number {
  const width = widthPx > 0 ? widthPx : DEFAULT_PLOT_PX;
  for (const step of TICK_STEPS) {
    if ((step / totalMs) * width >= TICK_LABEL_PX) return step;
  }
  return TICK_STEPS[TICK_STEPS.length - 1] ?? totalMs;
}

/** Marcas del eje: múltiplos del paso desde 0, sin pasarse del final. */
export function buildTicks(totalMs: number, widthPx: number): number[] {
  const step = tickStep(totalMs, widthPx);
  const ticks: number[] = [];
  for (let t = 0; t <= totalMs; t += step) ticks.push(t);
  return ticks;
}

export interface TopicNode {
  key: string;
  /** «2» o «2.1»: la ruta en la escaleta, o el orden si el evento no la trae. */
  number: string;
  depth: number;
  title: string;
  at: number;
  end: number;
}

const PATH = /^\d+(\.\d+)*$/;

/** Temas ordenados por inicio, con su número, su profundidad y un final siempre definido. */
export function buildTopics(events: TimelineEvent[], totalMs: number): TopicNode[] {
  const sorted = events
    .filter((e) => e.kind === "topic")
    .map((e) => ({ e, path: e.refId && PATH.test(e.refId) ? e.refId : null }))
    .map((t) => ({ ...t, depth: t.path ? t.path.split(".").length - 1 : 0 }))
    .sort((a, b) => a.e.at - b.e.at || a.depth - b.depth);
  let loose = 0;
  return sorted.map((t, i) => {
    const number = t.path ?? String((loose += 1));
    // Sin final conocido: hasta el siguiente tema de su nivel (o superior), o hasta el final.
    const next = sorted.slice(i + 1).find((o) => o.depth <= t.depth && o.e.at > t.e.at);
    const end = t.e.end ?? next?.e.at ?? totalMs;
    return { key: `topic-${number}-${t.e.at}`, number, depth: t.depth, title: t.e.label, at: t.e.at, end: Math.max(end, t.e.at) };
  });
}

/** El tema más profundo que contiene `ms` (el subtema gana a su padre). */
export function currentTopicKey(topics: TopicNode[], ms: number): string | null {
  let best: TopicNode | null = null;
  for (const t of topics) {
    if (ms < t.at || ms >= t.end) continue;
    if (!best || t.depth > best.depth || (t.depth === best.depth && t.at >= best.at)) best = t;
  }
  return best?.key ?? null;
}

/** ¿Cabe el título junto al número en un bloque de `px`? Estimación por carácter (12 px, seminegrita). */
export function blockLabel(number: string, title: string, px: number, scale = 1): "title" | "number" | "none" {
  const numberPx = (number.length * 7.2 + 12) * scale;
  if (numberPx > px) return "none";
  return numberPx + (title.length * 6.9 + 8) * scale <= px ? "title" : "number";
}

export interface MarkerSlot<T> {
  row: number;
  /** Instante del primer marcador: ahí se dibuja. */
  at: number;
  items: T[];
}

/** Separación mínima entre marcadores de una fila (el punto mide 12 px y su zona de clic 20). */
export const MARKER_GAP_PX = 18;
export const MARKER_ROWS = 3;

/**
 * Reparte marcadores puntuales para que ninguno tape a otro: los que se pisan bajan de fila
 * y, agotadas las filas, se agrupan en el último hueco con un contador.
 */
export function layoutMarkers<T extends { at: number }>(items: T[], totalMs: number, widthPx: number, gapPx = MARKER_GAP_PX, maxRows = MARKER_ROWS): MarkerSlot<T>[] {
  const width = widthPx > 0 ? widthPx : DEFAULT_PLOT_PX;
  const px = (ms: number) => (ms / totalMs) * width;
  const slots: MarkerSlot<T>[] = [];
  const last: (MarkerSlot<T> | undefined)[] = [];
  for (const item of [...items].sort((a, b) => a.at - b.at)) {
    let placed = false;
    for (let row = 0; row < maxRows; row += 1) {
      const prev = last[row];
      if (prev && px(item.at) - px(prev.at) < gapPx) continue;
      const slot = { row, at: item.at, items: [item] };
      last[row] = slot;
      slots.push(slot);
      placed = true;
      break;
    }
    if (!placed) last[maxRows - 1]?.items.push(item);
  }
  return slots;
}

/** Posición horizontal del puntero → instante, 1:1 y sin salirse del trazado. */
export function msAtX(clientX: number, rect: { left: number; width: number }, totalMs: number): number {
  if (rect.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(ratio * totalMs);
}
