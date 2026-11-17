import { ChartGantt } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ActionItem, Decision, TimelineEvent } from "../../api";
import { formatClock, formatDuration } from "../../shared/format";
import { EmptyState } from "../../shared/ui/ui";
import { blockLabel, buildTicks, buildTopics, currentTopicKey, DEFAULT_PLOT_PX, layoutMarkers, type TopicNode } from "./model";
import { formatDue, KIND_ONE, MARKER_ROW_PX, MarkerSlotView, usePopover, type MarkerItem, type MarkerKind } from "./TimelineMarkers";
import { TimelineRuler } from "./TimelineRuler";

const MARKER_LANES: { kind: MarkerKind; label: string }[] = [
  { kind: "decision", label: "Decisiones" },
  { kind: "actionItem", label: "Tareas" },
  { kind: "capture", label: "Capturas" },
];

/** Fila de temas, y filas más finas para los subtemas (como mucho dos niveles dibujados). */
const TOPIC_ROW_PX = 28;
const SUB_ROW_PX = 16;
const ROW_GAP_PX = 3;
const subRow = (depth: number) => Math.min(depth, 2);
const topicTop = (depth: number) => (depth === 0 ? 0 : TOPIC_ROW_PX + ROW_GAP_PX + (subRow(depth) - 1) * (SUB_ROW_PX + ROW_GAP_PX));

interface Props {
  events: TimelineEvent[];
  duration: number;
  /** Posición del audio, para la cabeza lectora. Sin audio, no se pasa. */
  currentMs?: number;
  /** Decisiones y tareas del acta: dan el texto completo y los detalles de cada marcador. */
  decisions?: Decision[];
  actionItems?: ActionItem[];
  onSeek(ms: number): void;
}

export function TimelineTab(props: Props) {
  if (props.events.length === 0) {
    return <EmptyState icon={<ChartGantt size={26} strokeWidth={1.7} />} title="No hay eventos en la línea de tiempo" hint="Aquí verás los temas, las decisiones y las capturas sobre el eje del tiempo." />;
  }
  return <TimelineView {...props} />;
}

/** Ancho real del trazado: decide qué títulos caben, cómo se reparten los puntos y el paso del eje. */
function usePlotWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_PLOT_PX);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

function markerItems(events: TimelineEvent[], decisions: Decision[], actionItems: ActionItem[]): MarkerItem[] {
  const out: MarkerItem[] = [];
  events.forEach((e, i) => {
    if (e.kind !== "decision" && e.kind !== "actionItem" && e.kind !== "capture") return;
    const task = e.kind === "actionItem" ? (actionItems.find((a) => a.id === e.refId) ?? null) : null;
    const decision = e.kind === "decision" ? decisions.find((d) => d.id === e.refId) : undefined;
    out.push({ key: `${e.kind}-${e.refId ?? "sin-id"}-${e.at}-${i}`, kind: e.kind, at: e.at, text: task?.text ?? decision?.text ?? e.label, task });
  });
  return out.sort((a, b) => a.at - b.at);
}

function TimelineView({ events, duration, currentMs, decisions, actionItems, onSeek }: Props) {
  const plotRef = useRef<HTMLDivElement | null>(null);
  const width = usePlotWidth(plotRef);
  const pop = usePopover();
  const [hot, setHot] = useState<string | null>(null);
  const topicsId = useId();
  const itemsId = useId();

  const total = useMemo(() => events.reduce((max, e) => Math.max(max, e.end ?? e.at), Math.max(duration, 1)), [events, duration]);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;

  const topics = useMemo(() => buildTopics(events, total), [events, total]);
  const shares = useMemo(() => events.filter((e) => e.kind === "screenShare"), [events]);
  const items = useMemo(() => markerItems(events, decisions ?? [], actionItems ?? []), [events, decisions, actionItems]);
  const lanes = useMemo(
    () =>
      MARKER_LANES.map((lane) => {
        const own = items.filter((i) => i.kind === lane.kind);
        return { ...lane, count: own.length, slots: layoutMarkers(own, total, width) };
      }).filter((lane) => lane.count > 0),
    [items, total, width],
  );
  const listed = useMemo(() => items.filter((i) => i.kind !== "capture"), [items]);
  const ticks = useMemo(() => buildTicks(total, width), [total, width]);

  const currentKey = currentMs != null ? currentTopicKey(topics, currentMs) : null;
  const deepest = topics.reduce((max, t) => Math.max(max, subRow(t.depth)), 0);
  const topicsHeight = TOPIC_ROW_PX + deepest * (SUB_ROW_PX + ROW_GAP_PX);
  const hover = (key: string) => ({ onMouseEnter: () => setHot(key), onMouseLeave: () => setHot(null), onFocus: () => setHot(key), onBlur: () => setHot(null) });

  return (
    <div className="timeline">
      <section className="card tl-card">
        <div ref={plotRef} className="tl-plot" role="group" aria-label="Línea de tiempo">
          {topics.length > 0 ? (
            <div className="tl-lane">
              <LaneLabel kind="topic" label="Temas" count={topics.length} />
              <div className="tl-track tl-track-topics" style={{ height: `${topicsHeight}px` }}>
                {topics.map((t) => {
                  const show = blockLabel(t.number, t.title, ((t.end - t.at) / total) * width, t.depth === 0 ? 1 : 0.88);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      className="tl-block tl-topic"
                      data-depth={subRow(t.depth)}
                      data-hot={hot === t.key || undefined}
                      aria-current={currentKey === t.key ? "true" : undefined}
                      style={{ left: pct(t.at), width: pct(t.end - t.at), top: `${topicTop(t.depth)}px` }}
                      title={`${t.number} · ${t.title} · ${formatClock(t.at)}`}
                      aria-label={`Tema ${t.number}: ${t.title} (${formatClock(t.at)})`}
                      onClick={() => onSeek(t.at)}
                      {...hover(t.key)}
                    >
                      {show !== "none" ? <span className="tl-num num">{t.number}</span> : null}
                      {show === "title" ? <span className="tl-text">{t.title}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {shares.length > 0 ? (
            <div className="tl-lane">
              <LaneLabel kind="screenShare" label="Pantalla compartida" count={shares.length} />
              <div className="tl-track tl-track-share">
                {shares.map((e, i) => {
                  const end = e.end ?? e.at;
                  return (
                    <button
                      key={`${e.at}-${i}`}
                      type="button"
                      className="tl-block tl-screenShare"
                      style={{ left: pct(e.at), width: pct(end - e.at) }}
                      title={`Pantalla compartida · ${formatClock(e.at)} – ${formatClock(end)}`}
                      aria-label={`Pantalla compartida (${formatClock(e.at)} – ${formatClock(end)})`}
                      onClick={() => onSeek(e.at)}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}

          {lanes.map((lane) => (
            <div key={lane.kind} className="tl-lane">
              <LaneLabel kind={lane.kind} label={lane.label} count={lane.count} />
              <div className="tl-track tl-track-points" style={{ height: `${(Math.max(...lane.slots.map((s) => s.row)) + 1) * MARKER_ROW_PX}px` }}>
                {lane.slots.map((slot) => (
                  <MarkerSlotView key={slot.items[0]?.key} slot={slot} kind={lane.kind} total={total} pop={pop} hot={hot} onHot={setHot} onSeek={onSeek} />
                ))}
              </div>
            </div>
          ))}

          <TimelineRuler total={total} width={width} currentMs={currentMs} onSeek={onSeek} />

          {/* Rejilla y cabeza lectora: en el MISMO contenedor que las pistas, así comparten borde y ancho. */}
          <div className="tl-overlay" aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="tl-gridline" style={{ left: pct(t) }} />
            ))}
            {currentMs != null ? <span className="tl-playhead" style={{ left: pct(currentMs) }} /> : null}
          </div>
        </div>
      </section>

      <div className="tl-lists">
        {topics.length > 0 ? (
          <section className="card tl-list-card">
            <div className="card-head">
              <h3 id={topicsId}>Temas</h3>
              <span className="card-count num">{topics.length}</span>
            </div>
            <ol className="tl-list" aria-labelledby={topicsId}>
              {topics.map((t) => (
                <li key={t.key}>
                  <TopicRow topic={t} hot={hot === t.key} current={currentKey === t.key} onSeek={onSeek} hover={hover(t.key)} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {listed.length > 0 ? (
          <section className="card tl-list-card">
            <div className="card-head">
              <h3 id={itemsId}>Decisiones y tareas</h3>
              <span className="card-count num">{listed.length}</span>
            </div>
            <ol className="tl-list" aria-labelledby={itemsId}>
              {listed.map((item) => (
                <li key={item.key}>
                  <button type="button" className="tl-row tl-row-item" data-hot={hot === item.key || undefined} onClick={() => onSeek(item.at)} {...hover(item.key)}>
                    <span className="tl-row-time num">{formatClock(item.at)}</span>
                    <span className={`tl-key tl-${item.kind}`} aria-hidden />
                    <span className="tl-row-main">
                      <span className={`tl-row-text${item.task?.done ? " tl-row-done" : ""}`}>{item.text}</span>
                      <span className="tl-row-meta">{itemMeta(item)}</span>
                    </span>
                    {item.task?.isMine ? <span className="badge badge-accent">Es tuya</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function itemMeta(item: MarkerItem): string {
  const parts = [KIND_ONE[item.kind]];
  if (item.task) {
    parts.push(item.task.ownerName ?? "Sin responsable");
    if (item.task.due) parts.push(`Vence ${formatDue(item.task.due)}`);
    if (item.task.done) parts.push("Hecha");
  }
  return parts.join(" · ");
}

function LaneLabel({ kind, label, count }: { kind: string; label: string; count: number }) {
  return (
    <div className="tl-lane-label">
      <span className={`tl-key tl-${kind}`} aria-hidden />
      {label}
      <span className="tl-lane-count num">{count}</span>
    </div>
  );
}

interface TopicRowProps {
  topic: TopicNode;
  hot: boolean;
  current: boolean;
  onSeek(ms: number): void;
  hover: { onMouseEnter(): void; onMouseLeave(): void; onFocus(): void; onBlur(): void };
}

function TopicRow({ topic, hot, current, onSeek, hover }: TopicRowProps) {
  return (
    <button type="button" className="tl-row tl-row-topic" data-depth={subRow(topic.depth)} data-hot={hot || undefined} aria-current={current ? "true" : undefined} onClick={() => onSeek(topic.at)} {...hover}>
      <span className="tl-row-num num">{topic.number}</span>
      <span className="tl-row-text">{topic.title}</span>
      <span className="tl-row-when">
        <span className="tl-row-time num">{formatClock(topic.at)}</span>
        <span className="tl-row-dur">{formatDuration(topic.end - topic.at)}</span>
      </span>
    </button>
  );
}
