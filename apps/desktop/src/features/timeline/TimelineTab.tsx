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

export function TimelineTab({ events, duration, onSeek }: { events: TimelineEvent[]; duration: number; onSeek(ms: number): void }) {
  if (events.length === 0) return <EmptyState title="No hay eventos en la línea de tiempo" />;
  const total = Math.max(duration, ...events.map((e) => e.end ?? e.at), 1);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  const ticks = Array.from({ length: 5 }, (_, i) => (total * i) / 4);

  return (
    <div className="timeline">
      {LANES.map((kind) => {
        const lane = events.filter((e) => e.kind === kind);
        if (lane.length === 0) return null;
        return (
          <div key={kind} className="lane">
            <span className="lane-label">{KIND_LABEL[kind]}</span>
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
            <span key={t} className="tick" style={{ left: pct(t) }}>
              {formatClock(t)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
