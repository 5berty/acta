import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { ActionItem } from "../../api";
import { formatClock } from "../../shared/format";
import type { MarkerSlot } from "./model";

export type MarkerKind = "decision" | "actionItem" | "capture";

export interface MarkerItem {
  key: string;
  kind: MarkerKind;
  at: number;
  /** Texto completo del acta; si no se encuentra, la etiqueta del evento. */
  text: string;
  task: ActionItem | null;
}

export const KIND_ONE: Record<MarkerKind, string> = { decision: "Decisión", actionItem: "Tarea", capture: "Captura" };
const KIND_MANY: Record<MarkerKind, string> = { decision: "decisiones", actionItem: "tareas", capture: "capturas" };

/** Alto de cada fila de marcadores (coincide con la zona de clic). */
export const MARKER_ROW_PX = 20;
const HOVER_DELAY_MS = 90;
const CLOSE_DELAY_MS = 120;
/** Tras cerrar uno, el siguiente se abre al instante y sin animación. */
const WARM_MS = 400;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
/** La fecha viene como la escribió la IA: si es ISO se enseña en castellano, si no tal cual. */
export function formatDue(due: string): string {
  const m = ISO_DATE.exec(due);
  if (!m) return due;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

interface OpenState {
  key: string;
  /** Fijado con clic o Intro: no se cierra al salir con el ratón. */
  pinned: boolean;
  /** Sin animación: abierto con teclado o justo después de otro. */
  instant: boolean;
}

export interface PopoverControl {
  open: OpenState | null;
  hoverIn(key: string): void;
  hoverOut(): void;
  focusIn(key: string): void;
  toggle(key: string): void;
  close(): void;
  /** Devuelve el foco al marcador sin que eso vuelva a abrir el globo. */
  focusQuietly(el: HTMLElement | null): void;
}

/** Un solo globo abierto a la vez para todos los marcadores del trazado. */
export function usePopover(): PopoverControl {
  const [open, setOpen] = useState<OpenState | null>(null);
  const current = useRef<OpenState | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const closedAt = useRef(0);
  const quiet = useRef(false);

  const set = useCallback((next: OpenState | null) => {
    if (current.current && !next) closedAt.current = Date.now();
    current.current = next;
    setOpen(next);
  }, []);
  const clear = useCallback(() => {
    if (openTimer.current != null) window.clearTimeout(openTimer.current);
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const close = useCallback(() => {
    clear();
    set(null);
  }, [clear, set]);

  const hoverIn = useCallback(
    (key: string) => {
      clear();
      const cur = current.current;
      if (cur?.key === key || cur?.pinned) return;
      if (cur || Date.now() - closedAt.current < WARM_MS) set({ key, pinned: false, instant: true });
      else openTimer.current = window.setTimeout(() => set({ key, pinned: false, instant: false }), HOVER_DELAY_MS);
    },
    [clear, set],
  );
  const hoverOut = useCallback(() => {
    clear();
    if (current.current && !current.current.pinned) closeTimer.current = window.setTimeout(() => set(null), CLOSE_DELAY_MS);
  }, [clear, set]);
  const focusIn = useCallback(
    (key: string) => {
      if (quiet.current || current.current?.key === key) return;
      clear();
      set({ key, pinned: false, instant: true });
    },
    [clear, set],
  );
  const toggle = useCallback(
    (key: string) => {
      clear();
      const cur = current.current;
      if (cur?.key === key && cur.pinned) set(null);
      else set({ key, pinned: true, instant: cur?.key === key ? cur.instant : false });
    },
    [clear, set],
  );
  const focusQuietly = useCallback((el: HTMLElement | null) => {
    quiet.current = true;
    el?.focus();
    quiet.current = false;
  }, []);

  // Fijado o no, un clic fuera lo cierra.
  const openKey = open?.key ?? null;
  useEffect(() => {
    if (openKey == null) return;
    const onDown = (e: Event) => {
      const slot = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-slot]") : null;
      if (slot?.dataset.slot !== openKey) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [openKey, close]);

  return { open, hoverIn, hoverOut, focusIn, toggle, close, focusQuietly };
}

interface SlotProps {
  slot: MarkerSlot<MarkerItem>;
  kind: MarkerKind;
  total: number;
  pop: PopoverControl;
  hot: string | null;
  onHot(key: string | null): void;
  onSeek(ms: number): void;
}

/** Un marcador (o un grupo con contador) y su globo anclado. */
export function MarkerSlotView({ slot, kind, total, pop, hot, onHot, onSeek }: SlotProps) {
  const button = useRef<HTMLButtonElement | null>(null);
  const first = slot.items[0];
  if (!first) return null;
  const key = first.key;
  const single = slot.items.length === 1 ? first : null;
  const isOpen = pop.open?.key === key;
  const ratio = slot.at / total;
  const align = ratio < 0.3 ? "start" : ratio > 0.7 ? "end" : "center";
  const label = single ? `${KIND_ONE[kind]}: ${single.text} (${formatClock(single.at)})` : `${slot.items.length} ${KIND_MANY[kind]} (${formatClock(slot.at)})`;
  const isHot = slot.items.some((i) => i.key === hot);

  return (
    <span
      className="tl-slot"
      data-slot={key}
      data-open={isOpen || undefined}
      style={{ left: `${Math.min(100, Math.max(0, ratio * 100))}%`, top: `${slot.row * MARKER_ROW_PX}px` }}
      onMouseEnter={() => {
        pop.hoverIn(key);
        onHot(key);
      }}
      onMouseLeave={() => {
        pop.hoverOut();
        onHot(null);
      }}
      onBlur={(e) => {
        if (isOpen && !e.currentTarget.contains(e.relatedTarget)) pop.close();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !isOpen) return;
        e.stopPropagation();
        pop.close();
        pop.focusQuietly(button.current);
      }}
    >
      <button
        ref={button}
        type="button"
        className={`tl-marker tl-${kind}${single ? "" : " tl-cluster"}`}
        data-hot={isHot || undefined}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onFocus={() => pop.focusIn(key)}
        onClick={() => pop.toggle(key)}
      >
        {single ? null : <span className="num">{slot.items.length}</span>}
      </button>
      {isOpen ? <MarkerPopover items={slot.items} label={label} align={align} instant={pop.open?.instant ?? false} pop={pop} anchor={button} onSeek={onSeek} /> : null}
    </span>
  );
}

interface PopoverProps {
  items: MarkerItem[];
  label: string;
  align: "start" | "center" | "end";
  instant: boolean;
  pop: PopoverControl;
  anchor: RefObject<HTMLButtonElement | null>;
  onSeek(ms: number): void;
}

function MarkerPopover({ items, label, align, instant, pop, anchor, onSeek }: PopoverProps) {
  const jump = (at: number, target: HTMLElement) => {
    onSeek(at);
    // Con teclado el foco estaba dentro: vuelve al marcador en vez de perderse.
    const hadFocus = target.closest("[data-slot]")?.contains(document.activeElement) ?? false;
    pop.close();
    if (hadFocus) pop.focusQuietly(anchor.current);
  };
  return (
    <div className={`tl-pop tl-pop-${align}`} data-instant={instant || undefined} role="dialog" aria-label={label} tabIndex={-1}>
      <div className="tl-pop-card glass-thick">
        <div className="tl-pop-scroll">
          {items.map((item) => (
            <article key={item.key} className="tl-pop-item">
              <header className="tl-pop-head">
                <span className={`tl-key tl-${item.kind}`} aria-hidden />
                <span className="tl-pop-kind">{KIND_ONE[item.kind]}</span>
                {item.task?.isMine ? <span className="badge badge-accent">Es tuya</span> : null}
                <span className="tl-pop-time num">{formatClock(item.at)}</span>
              </header>
              <p className="tl-pop-text">{item.text}</p>
              {item.task ? (
                <dl className="tl-pop-meta">
                  <div>
                    <dt>Responsable</dt>
                    <dd>{item.task.ownerName ?? "Sin responsable"}</dd>
                  </div>
                  {item.task.due ? (
                    <div>
                      <dt>Vence</dt>
                      <dd>{formatDue(item.task.due)}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Estado</dt>
                    <dd className={item.task.done ? "tl-done" : undefined}>{item.task.done ? "Hecha" : "Pendiente"}</dd>
                  </div>
                </dl>
              ) : null}
              <button type="button" className="btn btn-sm tl-pop-go" onClick={(e) => jump(item.at, e.currentTarget)}>
                Ir al minuto {formatClock(item.at)}
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
