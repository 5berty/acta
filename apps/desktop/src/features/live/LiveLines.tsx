import type { LiveSegment } from "../../api";
import { colorForName, formatClock } from "../../shared/format";
import { Highlight, type Range } from "../../shared/textSearch";
import { Avatar } from "../../shared/ui/ui";

/** `"yo"` y `"otros"` son las dos pistas; lo demás ya es un nombre. */
export const liveSpeakerName = (speaker: string): string => (speaker === "yo" ? "Yo" : speaker === "otros" ? "Otros" : speaker);
const speakerTint = (speaker: string): string => (speaker === "yo" ? "var(--accent)" : speaker === "otros" ? "#2f9e7a" : colorForName(speaker));

interface Props {
  segments: LiveSegment[];
  /** Coincidencias de la búsqueda para cada segmento. */
  rangesFor?(id: string): { ranges: Range[]; activeIndex: number };
  /** Segmento señalado (una cita de la respuesta). */
  flashId?: string | null;
}

/** Transcripción tomada en directo: quién, qué y cuándo. Lo provisional va atenuado. */
export function LiveLines({ segments, rangesFor, flashId }: Props) {
  return (
    <ol className="lines live-lines">
      {segments.map((s, i) => {
        const first = segments[i - 1]?.speaker !== s.speaker;
        const name = liveSpeakerName(s.speaker);
        const color = speakerTint(s.speaker);
        const found = rangesFor?.(s.id) ?? { ranges: [], activeIndex: -1 };
        return (
          <li key={s.id} className={first ? "turn" : undefined} data-seg={s.id}>
            <div className={`line live-line${s.final ? "" : " line-partial"}${flashId === s.id ? " line-flash" : ""}`}>
              <span className="line-gutter">{first ? <Avatar name={name} color={color} /> : null}</span>
              <span className="line-body">
                {first ? (
                  <span className="line-speaker" style={{ color }}>
                    {name}
                  </span>
                ) : null}
                <span className="line-text">
                  <Highlight text={s.text} ranges={found.ranges} activeIndex={found.activeIndex} />
                </span>
              </span>
              <span className="line-time num">{formatClock(s.startMs)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
