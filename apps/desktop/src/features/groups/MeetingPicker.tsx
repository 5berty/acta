import { useEffect, useMemo, useState } from "react";
import type { MeetingSummary, SearchHit } from "../../api";
import { useApi } from "../../app/ApiContext";
import { formatDate, formatDuration } from "../../shared/format";
import { Highlight, findRanges, matches } from "../../shared/textSearch";
import { PickerPopover, type PickerItem } from "../../shared/ui/PickerPopover";
import { AvatarStack, PlatformIcon, errorMessage } from "../../shared/ui/ui";

interface Props {
  label?: string;
  /** Reuniones que ya están: salen marcadas y no se pueden elegir. */
  excludeIds: string[];
  onAdd(ids: string[]): void | Promise<void>;
}

const count = (n: number): string => (n === 0 ? "Añadir reuniones" : n === 1 ? "Añadir 1 reunión" : `Añadir ${n} reuniones`);

/** Buscador de reuniones (por título, participantes y contenido) con selección múltiple. */
export function MeetingPicker({ label = "Añadir reunión", excludeIds, onAdd }: Props) {
  const api = useApi();
  const [all, setAll] = useState<MeetingSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const text = query.trim();

  // Lo que se dijo: se pregunta al índice (con un respiro para no buscar a cada tecla).
  useEffect(() => {
    if (text.length < 2) {
      setHits([]);
      return;
    }
    let live = true;
    setLoading(true);
    const id = setTimeout(() => {
      void api
        .search({ text, scope: { kind: "all" }, limit: 40 })
        .then((h) => live && setHits([...h]))
        .catch((e) => live && (setHits([]), setError(errorMessage(e))))
        .finally(() => live && setLoading(false));
    }, 120);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [api, text]);

  const items = useMemo<PickerItem[]>(() => {
    const excluded = new Set(excludeIds);
    const snippet = new Map<string, string>();
    for (const h of hits) if (!snippet.has(h.meetingId)) snippet.set(h.meetingId, h.snippet);
    const shown = all.filter((m) => !text || matches(m.title, text) || m.speakerNames.some((n) => matches(n, text)) || snippet.has(m.id));
    const row = (m: MeetingSummary): PickerItem => {
      const said = text && !matches(m.title, text) ? snippet.get(m.id) : undefined;
      return {
        id: m.id,
        title: m.title,
        disabled: excluded.has(m.id),
        icon: <PlatformIcon platform={m.platform} size="sm" />,
        content: (
          <>
            <span className="picker-title">
              <Highlight text={m.title} ranges={findRanges(m.title, text)} />
            </span>
            <span className="picker-meta">
              {excluded.has(m.id) ? "Ya está en el grupo · " : ""}
              {formatDate(m.startedAt)} · {formatDuration(m.duration)}
            </span>
            {said ? (
              <span className="picker-snippet">
                «<Highlight text={said} ranges={findRanges(said, text)} />»
              </span>
            ) : null}
            <AvatarStack names={m.speakerNames} max={3} />
          </>
        ),
      };
    };
    // Las elegibles primero; las que ya están, al final.
    return [...shown.filter((m) => !excluded.has(m.id)), ...shown.filter((m) => excluded.has(m.id))].map(row);
  }, [all, hits, text, excludeIds]);

  return (
    <PickerPopover
      label={label}
      searchLabel="Buscar reuniones"
      placeholder="Busca por título, persona o algo que se dijo…"
      items={items}
      query={query}
      onQuery={setQuery}
      loading={loading}
      emptyText={error ?? (text ? `Ninguna reunión coincide con «${text}».` : "Aún no hay reuniones.")}
      confirmLabel={count}
      onConfirm={onAdd}
      onOpen={() => {
        setError(null);
        void api
          .meetingsList({ limit: 200 })
          .then((p) => setAll([...p.items]))
          .catch((e) => setError(errorMessage(e)));
      }}
    />
  );
}
