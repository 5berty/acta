import { AudioLines, CornerDownLeft, FolderOpen, Quote, Search, Settings, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MeetingSummary, SearchHit } from "../api";
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
}

interface Props {
  onClose(): void;
  onOpenMeeting(id: string, at?: number): void;
  onView(v: View): void;
}

const NAV: { view: View; label: string; icon: ReactNode }[] = [
  { view: "meetings", label: "Ir a Reuniones", icon: <AudioLines size={15} aria-hidden /> },
  { view: "groups", label: "Ir a Grupos", icon: <FolderOpen size={15} aria-hidden /> },
  { view: "ask", label: "Preguntar a todas tus reuniones", icon: <Sparkles size={15} aria-hidden /> },
  { view: "settings", label: "Abrir Ajustes", icon: <Settings size={15} aria-hidden /> },
];

/** Búsqueda rápida (⌘K): reuniones, frases del transcript y navegación. */
export function CommandPalette({ onClose, onOpenMeeting, onView }: Props) {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const text = query.trim();

  useEffect(() => {
    let live = true;
    void api.meetingsList({ text: text || null, limit: 6 }).then((p) => live && setMeetings(p.items));
    if (text.length >= 2) void api.search({ text, scope: { kind: "all" }, limit: 6 }).then((h) => live && setHits(h.slice(0, 6)));
    else setHits([]);
    setActive(0);
    return () => {
      live = false;
    };
  }, [api, text]);

  const items = useMemo<Item[]>(() => {
    const go = (f: () => void) => () => {
      f();
      onClose();
    };
    const q = text.toLowerCase();
    return [
      ...meetings.map((m) => ({
        id: `m-${m.id}`,
        group: text ? "Reuniones" : "Recientes",
        title: m.title,
        detail: formatDate(m.startedAt),
        icon: <PlatformIcon platform={m.platform} size="sm" />,
        run: go(() => onOpenMeeting(m.id)),
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
  }, [meetings, hits, text, onClose, onOpenMeeting, onView]);

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
          <span className="kbd" aria-hidden>
            esc
          </span>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Resultados" className="palette-list" ref={listRef}>
          {items.length === 0 ? <li className="palette-empty">Nada coincide con «{text}».</li> : null}
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
                  <CornerDownLeft className="palette-enter" size={13} aria-hidden />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
