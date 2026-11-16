import { ChartGantt } from "lucide-react";
import type { TimelineEvent, TimelineKind } from "../../api";
import { formatClock } from "../../shared/format";
import { EmptyState } from "../../shared/ui/ui";

const KIND_LABEL: Record<TimelineKind, string> = {
  topic: "Temas",
  decision: "Decisiones",
  actionItem: "Tareas",
  capture: "Capturas",
  screenShare: "Pantalla compartida",
};
const LANES: TimelineKind[] = ["topic", "screenShare", "decision", "actionItem", "capture"];
const RANGE: TimelineKind[] = ["topic", "screenShare"];

interface Props {
  events: TimelineEvent[];
  duration: number;
  /** Posición del audio, para la cabeza lectora. */
  currentMs?: number;
  onSeek(ms: number): void;
}

export function TimelineTab({ events, duration, currentMs, onSeek }: Props) {
  if (events.length === 0) {
    return <EmptyState icon={<ChartGantt size={26} strokeWidth={1.7} />} title="No hay eventos en la línea de tiempo" hint="Aquí verás los temas, las decisiones y las capturas sobre el eje del tiempo." />;
  }
  const total = Math.max(duration, ...events.map((e) => e.end ?? e.at), 1);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  const ticks = Array.from({ length: 5 }, (_, i) => (total * i) / 4);

  return (
    <div className="timeline card">
      <div className="timeline-grid">
        {LANES.map((kind) => {
          const lane = events.filter((e) => e.kind === kind);
          if (lane.length === 0) return null;
          return (
            <div key={kind} className="lane">
              <span className="lane-label">
                <span className={`lane-key tl-${kind}`} aria-hidden />
                {KIND_LABEL[kind]}
              </span>
              <div className="lane-track">
                {lane.map((e, i) => {
                  const isRange = RANGE.includes(kind) && e.end != null;
                  return (
                    <button
                      key={`${e.at}-${i}`}
                      type="button"
                      className={`tl-item tl-${kind}${isRange ? " tl-range" : " tl-point"}`}
                      style={isRange ? { left: pct(e.at), width: pct((e.end ?? e.at) - e.at) } : { left: pct(e.at) }}
                      title={`${formatClock(e.at)} · ${e.label}`}
                      aria-label={`${e.label} (${formatClock(e.at)})`}
                      onClick={() => onSeek(e.at)}
                    >
                      {isRange ? <span className="tl-text">{e.label}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="lane lane-axis">
          <span className="lane-label" />
          <div className="lane-track axis">
            {ticks.map((t) => (
              <span key={t} className="tick num" style={{ left: pct(t) }}>
                {formatClock(t)}
              </span>
            ))}
          </div>
        </div>
        {currentMs != null && currentMs > 0 ? (
          <div className="playhead-rail" aria-hidden>
            <span className="playhead" style={{ left: pct(currentMs) }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
