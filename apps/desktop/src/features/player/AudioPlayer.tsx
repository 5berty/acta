import { useEffect, useRef, useState } from "react";
import { useApi } from "../../app/ApiContext";
import { formatClock } from "../../shared/format";
import { Button } from "../../shared/ui/ui";
import { usePlayer, type TrackChoice } from "./PlayerContext";

const LABEL: Record<TrackChoice, string> = { mix: "Mezcla", mic: "Yo", system: "Otros" };
const RATES = [1, 1.25, 1.5, 2];

export function AudioPlayer() {
  const api = useApi();
  const p = usePlayer();
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const resume = useRef<{ at: number; play: boolean } | null>(null);

  const available = (["mix", "mic", "system"] as TrackChoice[]).filter((t) => p.audio[t]);
  const src = p.audio[p.track];

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
    return <div className="player player-empty">Esta reunión no tiene audio</div>;
  }

  const el = p.audioRef.current;

  return (
    <div className="player">
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
      <Button
        small
        variant="primary"
        aria-label={playing ? "Pausar audio" : "Reproducir audio"}
        onClick={() => (playing ? el?.pause() : void el?.play()?.catch(() => {}))}
      >
        {playing ? "Pausa" : "Reproducir"}
      </Button>
      <span className="player-time">{formatClock(p.currentMs)}</span>
      <input
        type="range"
        aria-label="Posición"
        min={0}
        max={Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 1}
        value={Math.min(Math.round(p.currentMs), Math.round(duration) || 1)}
        onChange={(e) => p.seek(Number(e.target.value))}
      />
      <span className="player-time muted">{formatClock(Number.isFinite(duration) ? duration : 0)}</span>
      <label className="field-inline">
        <span className="sr-only">Pista</span>
        <select
          aria-label="Pista"
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
        </select>
      </label>
      <select
        aria-label="Velocidad"
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
      </select>
    </div>
  );
}
