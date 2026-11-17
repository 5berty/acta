import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { MeetingAudio } from "../../api";

export type TrackChoice = "mix" | "mic" | "system";

interface PlayerValue {
  audio: MeetingAudio;
  audioRef: RefObject<HTMLAudioElement | null>;
  track: TrackChoice;
  setTrack(t: TrackChoice): void;
  currentMs: number;
  setCurrentMs(ms: number): void;
  hasAudio: boolean;
  /** Salta (en MediaMs) y reproduce. */
  seek(ms: number): void;
}

const noop: PlayerValue = {
  audio: { mic: null, system: null, mix: null },
  audioRef: { current: null },
  track: "mix",
  setTrack: () => {},
  currentMs: 0,
  setCurrentMs: () => {},
  hasAudio: false,
  seek: () => {},
};

/** Margen para dar por bueno un `seeked` y tiempo máximo esperándolo. */
const SEEK_TOLERANCE_MS = 750;
const SEEK_HOLD_MS = 2000;

const Ctx = createContext<PlayerValue>(noop);
export const usePlayer = (): PlayerValue => useContext(Ctx);

function firstAvailable(a: MeetingAudio): TrackChoice {
  if (a.mix) return "mix";
  if (a.system) return "system";
  return "mic";
}

export function PlayerProvider({ audio, children }: { audio: MeetingAudio; children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<TrackChoice>(() => firstAvailable(audio));
  const [currentMs, setCurrentMsState] = useState(0);
  const hasAudio = Boolean(audio.mix || audio.mic || audio.system);
  /** Salto pedido antes de que el audio tuviera metadatos: se aplica al cargarlos. */
  const pending = useRef<number | null>(null);
  /** Salto en curso: hasta el `seeked` manda la posición pedida, no la que informa el audio. */
  const held = useRef<number | null>(null);
  const holdTimer = useRef<number | null>(null);
  const wired = useRef(new WeakSet<HTMLAudioElement>());

  const release = useCallback(() => {
    held.current = null;
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  useEffect(() => release, [release]);

  // El `timeupdate` del reproductor pasa por aquí: durante un salto no puede pisar el destino.
  const setCurrentMs = useCallback((ms: number) => {
    if (held.current != null) return;
    setCurrentMsState(ms);
  }, []);

  const seek = useCallback(
    (ms: number) => {
      if (!Number.isFinite(ms)) return;
      const target = Math.max(0, ms);
      setCurrentMsState(target);
      const el = audioRef.current;
      if (!el) return;
      if (!wired.current.has(el)) {
        wired.current.add(el);
        el.addEventListener("loadedmetadata", () => {
          const at = pending.current;
          if (at == null) return;
          pending.current = null;
          el.currentTime = at / 1000;
          void el.play()?.catch(() => {});
        });
        el.addEventListener("seeked", () => {
          // Arrastrando llegan varios `seeked`: solo libera el que corresponde al último salto.
          if (held.current != null && Math.abs(el.currentTime * 1000 - held.current) < SEEK_TOLERANCE_MS) release();
        });
      }
      // Sin metadatos (HAVE_NOTHING) el navegador puede descartar la posición: se recuerda.
      pending.current = el.readyState < 1 ? target : null;
      release();
      held.current = target;
      // Red de seguridad: si el `seeked` no llega, el audio vuelve a mandar.
      holdTimer.current = window.setTimeout(release, SEEK_HOLD_MS);
      el.currentTime = target / 1000;
      void el.play()?.catch(() => {});
    },
    [release],
  );

  const value = useMemo<PlayerValue>(
    () => ({ audio, audioRef, track, setTrack, currentMs, setCurrentMs, hasAudio, seek }),
    [audio, track, currentMs, setCurrentMs, hasAudio, seek],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
