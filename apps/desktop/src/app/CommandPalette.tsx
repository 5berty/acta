import { AudioLines, CornerDownLeft, FolderOpen, Quote, Search, Settings, Sparkles, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Group, MeetingSummary, SearchHit } from "../api";
import { StarButton } from "../shared/ui/Star";
import { formatClock, formatDate } from "../shared/format";
import { PlatformIcon } from "../shared/ui/ui";
import { useApi } from "./ApiContext";
import type { View } from "./Sidebar";

interface Item {
  id: string;
  group: string;
  title: string;
  detail?: string;
  icon: ReactNode;
  run(): void;
  /** Reuniones y grupos se pueden marcar desde aquí (botón o ⌘D). */
  star?: { on: boolean; noun: "favorita" | "favorito"; toggle(next: boolean): void };
}

interface Props {
  onClose(): void;
  onOpenMeeting(id: string, at?: number): void;
  onView(v: View): void;
  onOpenGroup?(id: string): void;
}

const NAV: { view: View; label: string; icon: ReactNode }[] = [
  { view: "meetings", label: "Ir a Reuniones", icon: <AudioLines size={15} aria-hidden /> },
  { view: "groups", label: "Ir a Grupos", icon: <FolderOpen size={15} aria-hidden /> },
  { view: "ask", label: "Preguntar a todas tus reuniones", icon: <Sparkles size={15} aria-hidden /> },
  { view: "settings", label: "Abrir Ajustes", icon: <Settings size={15} aria-hidden /> },
];

/** Búsqueda rápida (⌘K): reuniones, frases del transcript y navegación. */
export function CommandPalette({ onClose, onOpenMeeting, onView, onOpenGroup }: Props) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  /** Buscar solo en favoritas (reuniones con estrella y grupos con estrella). */
  const [favOnly, setFavOnly] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const text = query.trim();

  useEffect(() => {
    let live = true;
    void api.meetingsList({ text: text || null, favouritesOnly: favOnly, limit: 6 }).then((p) => live && setMeetings(p.items));
    if (text.length >= 2) void api.search({ text, scope: { kind: favOnly ? "favourites" : "all" }, limit: 6 }).then((h) => live && setHits(h.slice(0, 6)));
    else setHits([]);
    setActive(0);
    return () => {
      live = false;
    };
  }, [api, text, favOnly]);

  useEffect(() => {
    void api.groupsList().then((g) => setGroups([...g]));
  }, [api]);

  const starMeeting = useCallback(
    (id: string, favourite: boolean) => {
      setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, favourite } : m)));
      void api.meetingSetFavourite(id, favourite);
    },
    [api],
  );
  const starGroup = useCallback(
    (id: string, favourite: boolean) => {
      setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, favourite } : g)));
      void api.groupSetFavourite(id, favourite);
    },
    [api],
  );

  const items = useMemo<Item[]>(() => {
    const go = (f: () => void) => () => {
      f();
      onClose();
    };
    const q = text.toLowerCase();
    return [
      ...meetings.map((m) => ({
        id: `m-${m.id}`,
        group: favOnly ? "Favoritas" : text ? "Reuniones" : "Recientes",
        title: m.title,
        detail: formatDate(m.startedAt),
        icon: <PlatformIcon platform={m.platform} size="sm" />,
        run: go(() => onOpenMeeting(m.id)),
        star: { on: m.favourite, noun: "favorita" as const, toggle: (next: boolean) => starMeeting(m.id, next) },
      })),
      ...groups
        .filter((g) => (favOnly ? g.favourite : true) && (q ? g.name.toLowerCase().includes(q) : favOnly))
        .slice(0, 5)
        .map((g) => ({
          id: `g-${g.id}`,
          group: "Grupos",
          title: g.name,
          detail: g.meetingCount === 1 ? "1 reunión" : `${g.meetingCount} reuniones`,
          icon: <FolderOpen size={15} aria-hidden />,
          run: go(() => (onOpenGroup ? onOpenGroup(g.id) : onView("groups"))),
          star: { on: g.favourite, noun: "favorito" as const, toggle: (next: boolean) => starGroup(g.id, next) },
        })),
      ...hits.map((h, i) => ({
        id: `h-${h.meetingId}-${h.at}-${i}`,
        group: "En los transcripts",
        title: h.snippet,
        detail: `${h.speaker ? `${h.speaker} · ` : ""}${h.meetingTitle} · ${formatClock(h.at)}`,
        icon: <Quote size={15} aria-hidden />,
        run: go(() => onOpenMeeting(h.meetingId, h.at)),
      })),
      ...NAV.filter((n) => !q || n.label.toLowerCase().includes(q)).map((n) => ({
        id: `n-${n.view}`,
        group: "Ir a",
        title: n.label,
        icon: n.icon,
        run: go(() => onView(n.view)),
      })),
    ];
  }, [meetings, hits, groups, favOnly, text, onClose, onOpenMeeting, onOpenGroup, onView, starMeeting, starGroup]);

  const index = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(items.length - 1, index + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, index - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[index]?.run();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      // ⌘D: marcar o desmarcar como favorita sin cerrar la búsqueda.
      const star = items[index]?.star;
      if (star) {
        e.preventDefault();
        star.toggle(!star.on);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Búsqueda rápida" className="palette glass-thick" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Search size={17} strokeWidth={2} aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-label="Buscar en acta"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[index] ? `opt-${items[index].id}` : undefined}
            placeholder="Busca una reunión, una frase o una sección…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="fav-filter" aria-pressed={favOnly} title="Buscar solo en tus favoritas" onClick={() => setFavOnly((v) => !v)}>
            <Star size={13} strokeWidth={2} aria-hidden />
            Favoritas
          </button>
          <span className="kbd" aria-hidden>
            esc
          </span>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Resultados" className="palette-list" ref={listRef}>
          {items.length === 0 ? <li className="palette-empty">{favOnly && !text ? "Todavía no tienes favoritas. Márcalas con la estrella o con ⌘D." : `Nada coincide con «${text}»${favOnly ? " en tus favoritas" : ""}.`}</li> : null}
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header ? <p className="palette-group">{header}</p> : null}
                <div id={`opt-${item.id}`} role="option" aria-selected={i === index} className="palette-item" onMouseMove={() => setActive(i)} onClick={item.run}>
                  <span className="palette-icon">{item.icon}</span>
                  <span className="palette-title">{item.title}</span>
                  {item.detail ? <span className="palette-detail">{item.detail}</span> : null}
                  {item.star ? <StarButton on={item.star.on} name={item.title} noun={item.star.noun} size={14} onToggle={item.star.toggle} /> : null}
                  <CornerDownLeft className="palette-enter" size={13} aria-hidden />
                </div>
              </li>
            );
          })}
        </ul>
        <p className="palette-hint" aria-hidden>
          <span className="kbd">↵</span> abrir <span className="kbd">⌘D</span> favorita
        </p>
      </div>
    </div>
  );
}
