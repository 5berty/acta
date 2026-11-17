import { ArrowDown, Captions } from "lucide-react";
import { useMemo, useRef, type ReactNode } from "react";
import type { LiveSegment, MeetingApp } from "../../api";
import { formatClock, platformLabel } from "../../shared/format";
import { FindBar } from "../../shared/ui/FindBar";
import { EmptyState, PlatformIcon } from "../../shared/ui/ui";
import { useFindShortcut, useLineSearch } from "../../shared/useLineSearch";
import { useStickToBottom } from "../../shared/useStickToBottom";
import { LiveLines } from "./LiveLines";

interface Props {
  segments: LiveSegment[];
  elapsedMs: number;
  paused: boolean;
  app: MeetingApp | null;
  /** `false`: la transcripción en vivo está apagada en Ajustes. */
  livePreview: boolean;
  /** Segmento señalado por una cita. */
  flashId: string | null;
  /** El chat «Pregunta sobre la reunión». */
  chat: ReactNode;
}

/** Vista «En directo»: lo que se va diciendo, un buscador y un chat. Tranquila: nada se mueve si no hace falta y no pide el foco. */
export function LiveView({ segments, elapsedMs, paused, app, livePreview, flashId, chat }: Props) {
  const lines = useMemo(() => segments.map((s) => ({ id: s.id, text: s.text, at: s.startMs })), [segments]);
  const search = useLineSearch(lines);
  useFindShortcut(search.input);
  const end = useRef<HTMLDivElement>(null);
  const last = segments[segments.length - 1];
  const { away, toBottom } = useStickToBottom(end, `${segments.length}|${last?.text.length ?? 0}`);
  const name = app ? (app.platform === "other" ? app.name : platformLabel(app.platform)) : null;

  return (
    <div className="page live">
      <header className="live-head">
        <div className="live-title">
          <span className={`rec-dot${paused ? " rec-dot-paused" : ""}`} aria-hidden />
          <h1>En directo</h1>
          <span className="live-timer num" aria-label="Tiempo grabado">
            {formatClock(elapsedMs)}
          </span>
          {paused ? <span className="live-paused">En pausa</span> : null}
          {app ? (
            <span className="live-app">
              <PlatformIcon platform={app.platform} size="sm" />
              {app.title ?? name}
            </span>
          ) : null}
        </div>
        <div className="live-find">
          <FindBar label="Buscar en el directo" placeholder="Buscar en lo que se ha dicho…" query={search.query} onQuery={search.setQuery} count={search.count} index={search.index} onNext={search.next} onPrev={search.prev} inputRef={search.input} />
        </div>
      </header>
      <div className="live-body">
        <section className="live-col live-transcript card" aria-label="Transcripción">
          <div className="live-scroll" ref={search.container}>
            <div role="log" aria-label="Transcripción en directo" aria-live="off">
              {segments.length === 0 ? (
                livePreview ? (
                  <EmptyState compact icon={<Captions size={22} strokeWidth={1.8} />} title="Esperando a que alguien hable…" hint="Lo que se diga irá apareciendo aquí, con unos segundos de retraso." />
                ) : (
                  <EmptyState compact icon={<Captions size={22} strokeWidth={1.8} />} title="La transcripción en directo está desactivada" hint="Actívala en Ajustes → Grabación → «Transcripción en vivo». La grabación sigue su curso y el acta saldrá al terminar." />
                )
              ) : (
                <LiveLines segments={segments} rangesFor={(id) => search.rangesFor(id)} flashId={flashId} />
              )}
            </div>
            <div ref={end} />
          </div>
          {away && segments.length > 0 ? (
            <button type="button" className="live-jump glass" onClick={toBottom}>
              <ArrowDown size={13} strokeWidth={2.4} aria-hidden />
              Volver al directo
            </button>
          ) : null}
        </section>
        <section className="live-col live-chat" aria-label="Pregunta sobre la reunión">
          {chat}
        </section>
      </div>
    </div>
  );
}
