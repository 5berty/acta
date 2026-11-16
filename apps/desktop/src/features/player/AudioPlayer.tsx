import { Pause, Play, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../../app/ApiContext";
import { formatClock } from "../../shared/format";
import { Select } from "../../shared/ui/ui";
import { usePlayer, type TrackChoice } from "./PlayerContext";

const LABEL: Record<TrackChoice, string> = { mix: "Mezcla", mic: "Yo", system: "Otros" };
const RATES = [1, 1.25, 1.5, 2];
const BARS = 64;

interface Span {
  start: number;
  end: number;
}

/** Cuánta voz hay en cada tramo (0..1): la «onda» sale del transcript, no del audio. */
export function voiceActivity(spans: Span[], durationMs: number, bars = BARS): number[] {
  const out = new Array<number>(bars).fill(0);
  if (durationMs <= 0) return out;
  const width = durationMs / bars;
  for (const s of spans) {
    const first = Math.max(0, Math.floor(s.start / width));
    const last = Math.min(bars - 1, Math.floor(Math.max(s.start, s.end - 1) / width));
    for (let i = first; i <= last; i += 1) {
      const overlap = Math.min(s.end, (i + 1) * width) - Math.max(s.start, i * width);
      out[i] = Math.min(1, (out[i] ?? 0) + Math.max(0, overlap) / width);
    }
  }
  return out;
}

interface Props {
  /** Intervalos con voz (ms), para dibujar la onda. */
  activity?: Span[];
  /** Duración conocida de la reunión, mientras el audio no ha cargado. */
  durationMs?: number;
}

export function AudioPlayer({ activity, durationMs }: Props = {}) {
  const api = useApi();
  const p = usePlayer();
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const resume = useRef<{ at: number; play: boolean } | null>(null);

  const available = (["mix", "mic", "system"] as TrackChoice[]).filter((t) => p.audio[t]);
  const src = p.audio[p.track];
  const total = Number.isFinite(duration) && duration > 0 ? duration : (durationMs ?? 0);
  const bars = useMemo(() => (activity && activity.length > 0 ? voiceActivity(activity, total) : null), [activity, total]);

  // Al cambiar de pista se conserva la posición y el estado de reproducción.
  useEffect(() => {
    const el = p.audioRef.current;
    const r = resume.current;
    if (el && r) {
      el.currentTime = r.at;
      if (r.play) void el.play()?.catch(() => {});
      resume.current = null;
    }
  }, [src, p.audioRef]);

  if (!p.hasAudio || !src) {
    return (
      <div className="player player-empty glass">
        <VolumeX size={15} strokeWidth={1.9} aria-hidden />
        Esta reunión no tiene audio
      </div>
    );
  }

  const el = p.audioRef.current;
  const played = total > 0 ? Math.min(1, p.currentMs / total) : 0;

  return (
    <div className="player glass" role="group" aria-label="Reproductor">
      <audio
        ref={p.audioRef}
        src={api.fileUrl(src)}
        preload="metadata"
        onTimeUpdate={(e) => p.setCurrentMs(e.currentTarget.currentTime * 1000)}
        onLoadedMetadata={(e) => {
          setDuration(e.currentTarget.duration * 1000);
          e.currentTarget.playbackRate = rate;
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button type="button" className="player-play" aria-label={playing ? "Pausar audio" : "Reproducir audio"} onClick={() => (playing ? el?.pause() : void el?.play()?.catch(() => {}))}>
        {playing ? <Pause size={15} fill="currentColor" strokeWidth={0} aria-hidden /> : <Play size={15} fill="currentColor" strokeWidth={0} aria-hidden />}
      </button>
      <span className="player-time num">{formatClock(p.currentMs)}</span>
      <div className={`player-wave${bars ? "" : " player-wave-flat"}`}>
        {bars ? (
          <div className="wave" aria-hidden>
            {bars.map((v, i) => (
              <span key={i} className={`wave-bar${(i + 0.5) / bars.length <= played ? " wave-bar-played" : ""}`} style={{ height: `${Math.round(14 + 86 * Math.sqrt(v))}%` }} />
            ))}
          </div>
        ) : (
          <div className="wave-line" aria-hidden>
            <span style={{ transform: `scaleX(${played})` }} />
          </div>
        )}
        <input
          type="range"
          className="player-seek"
          aria-label="Posición"
          min={0}
          max={total > 0 ? Math.round(total) : 1}
          value={Math.min(Math.round(p.currentMs), Math.round(total) || 1)}
          onChange={(e) => p.seek(Number(e.target.value))}
        />
      </div>
      <span className="player-time player-total num">{formatClock(total)}</span>
      {available.length > 1 ? (
        <Select
          label="Pista"
          capsule
          value={p.track}
          onChange={(e) => {
            resume.current = { at: el?.currentTime ?? 0, play: playing };
            p.setTrack(e.target.value as TrackChoice);
          }}
        >
          {available.map((t) => (
            <option key={t} value={t}>
              {LABEL[t]}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        label="Velocidad"
        capsule
        value={rate}
        onChange={(e) => {
          const r = Number(e.target.value);
          setRate(r);
          if (el) el.playbackRate = r;
        }}
      >
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </Select>
    </div>
  );
}
