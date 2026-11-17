import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatClock } from "../../shared/format";
import { buildTicks, msAtX } from "./model";

const STEP_MS = 5_000;
const PAGE_MS = 30_000;
/** Margen en el que una etiqueta se alinea al borde para no salirse del trazado. */
const EDGE_PX = 34;

interface Props {
  total: number;
  /** Ancho del trazado en píxeles, para elegir el paso de las marcas. */
  width: number;
  currentMs: number | undefined;
  onSeek(ms: number): void;
}

/** Regla del tiempo: marcas legibles, clic y arrastre 1:1, y flechas de cinco en cinco segundos. */
export function TimelineRuler({ total, width, currentMs, onSeek }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const sent = useRef<number | null>(null);
  const [tip, setTip] = useState<number | null>(null);
  const now = Math.min(total, Math.max(0, Math.round(currentMs ?? 0)));
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;

  const at = (e: PointerEvent<HTMLDivElement>) => msAtX(e.clientX, e.currentTarget.getBoundingClientRect(), total);
  const send = (ms: number) => {
    if (sent.current === ms) return;
    sent.current = ms;
    onSeek(ms);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Con captura, el arrastre sigue aunque el puntero se salga de la regla.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = true;
    sent.current = null;
    const ms = at(e);
    setTip(ms);
    send(ms);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const ms = at(e);
    setTip(ms);
    if (dragging.current) send(ms);
  };
  const stop = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = { ArrowRight: now + STEP_MS, ArrowUp: now + STEP_MS, ArrowLeft: now - STEP_MS, ArrowDown: now - STEP_MS, PageUp: now + PAGE_MS, PageDown: now - PAGE_MS, Home: 0, End: total };
    const target = moves[e.key];
    if (target == null) return;
    e.preventDefault();
    onSeek(Math.min(total, Math.max(0, target)));
  };

  const edge = (ms: number) => {
    const x = (ms / total) * width;
    return x < EDGE_PX ? " tl-edge-start" : x > width - EDGE_PX ? " tl-edge-end" : "";
  };

  return (
    <div
      ref={ref}
      className="tl-ruler"
      role="slider"
      tabIndex={0}
      aria-label="Posición en la reunión"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={now}
      aria-valuetext={formatClock(now)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={() => {
        if (!dragging.current) setTip(null);
      }}
      onKeyDown={onKeyDown}
    >
      {buildTicks(total, width).map((t) => (
        <span key={t} className={`tl-tick num${edge(t)}`} style={{ left: pct(t) }} aria-hidden>
          {formatClock(t)}
        </span>
      ))}
      {tip != null ? (
        <span className={`tl-tip num${edge(tip)}`} role="tooltip" style={{ left: pct(tip) }}>
          {formatClock(tip)}
        </span>
      ) : null}
    </div>
  );
}
