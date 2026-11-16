import { useEffect, useState } from "react";
import type { SessionSnapshot } from "../api";
import { useApi, useApiEvent } from "./ApiContext";
import { formatClock } from "../shared/format";
import { Button } from "../shared/ui/ui";

export type View = "meetings" | "groups" | "ask" | "settings";

const ITEMS: { key: View; label: string }[] = [
  { key: "meetings", label: "Reuniones" },
  { key: "groups", label: "Grupos" },
  { key: "ask", label: "Preguntar" },
  { key: "settings", label: "Ajustes" },
];

export function Sidebar({ view, onView }: { view: View; onView(v: View): void }) {
  const api = useApi();
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  useEffect(() => {
    void api.sessionGetState().then(setSnap);
  }, [api]);
  useApiEvent("session:state", setSnap);

  const s = snap?.state.state ?? "idle";
  const recording = s === "recording" || s === "paused";

  return (
    <aside className="sidebar">
      <div className="brand">acta</div>
      <nav aria-label="Secciones">
        {ITEMS.map((i) => (
          <button key={i.key} type="button" className={`nav-item${view === i.key ? " nav-active" : ""}`} aria-current={view === i.key ? "page" : undefined} onClick={() => onView(i.key)}>
            {i.label}
          </button>
        ))}
      </nav>
      <div className="side-session">
        {recording ? (
          <p className="rec-chip" role="status">
            <span className="rec-dot" aria-hidden /> {s === "paused" ? "En pausa" : "Grabando"} · {formatClock(snap?.elapsedMs ?? 0)}
          </p>
        ) : s === "idle" || s === "ready" || s === "failed" ? (
          <Button variant="primary" onClick={() => void api.sessionStart(null).then(setSnap)}>
            Grabar ahora
          </Button>
        ) : (
          <p className="muted">Procesando…</p>
        )}
      </div>
    </aside>
  );
}
