import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
  const [currentMs, setCurrentMs] = useState(0);
  const hasAudio = Boolean(audio.mix || audio.mic || audio.system);

  const seek = useCallback((ms: number) => {
    setCurrentMs(ms);
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    void el.play()?.catch(() => {});
  }, []);

  const value = useMemo<PlayerValue>(
    () => ({ audio, audioRef, track, setTrack, currentMs, setCurrentMs, hasAudio, seek }),
    [audio, track, currentMs, hasAudio, seek],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
