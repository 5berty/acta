import type { ReactNode } from "react";
import type { MeetingSummary } from "../../api";
import { formatDate, formatDuration, formatTime, platformLabel } from "../../shared/format";
import { StarButton } from "../../shared/ui/Star";
import { AvatarStack, PlatformIcon } from "../../shared/ui/ui";

interface Props {
  meeting: MeetingSummary;
  /** `time`: solo la hora (la lista ya agrupa por día). `date`: fecha completa. */
  when?: "time" | "date";
  onOpen(): void;
  /** Con esto la fila enseña la estrella de favorita. */
  onFavourite?(favourite: boolean): void;
  children?: ReactNode;
}

/** Fila de reunión: icono de la app, título, datos y participantes. El lateral es libre. */
export function MeetingRow({ meeting: m, when = "date", onOpen, onFavourite, children }: Props) {
  return (
    <li className="m-row" data-favourite={m.favourite || undefined}>
      <button type="button" className="m-row-main" onClick={onOpen}>
        <PlatformIcon platform={m.platform} />
        <span className="m-row-text">
          <span className="m-row-title">{m.title}</span>
          <span className="m-row-meta">
            {when === "time" ? formatTime(m.startedAt) : formatDate(m.startedAt)} · {formatDuration(m.duration)} · {platformLabel(m.platform)}
          </span>
          {m.snippet ? <span className="m-row-snippet">«{m.snippet}»</span> : null}
        </span>
        <AvatarStack names={m.speakerNames} />
      </button>
      {children || onFavourite ? (
        <div className="m-row-side">
          {children}
          {onFavourite ? <StarButton on={m.favourite} name={m.title} onToggle={onFavourite} /> : null}
        </div>
      ) : null}
    </li>
  );
}
