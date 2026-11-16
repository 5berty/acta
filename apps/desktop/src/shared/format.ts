import type { ActionItem, Escaleta, Platform, Tema } from "../api";

const pad = (n: number): string => n.toString().padStart(2, "0");

/** mm:ss, o h:mm:ss a partir de la hora. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1 min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function formatDate(ts: number): string {
  return new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ts);
}

export function formatDay(ts: number): string {
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(ts);
}

const PLATFORMS: Record<Platform, string> = {
  teams: "Teams",
  meet: "Google Meet",
  zoom: "Zoom",
  slack: "Slack",
  other: "Reunión",
};

export const platformLabel = (p: Platform): string => PLATFORMS[p];

/** Segundos que quedan hasta `createdAt + totalMs`. */
export function remainingSeconds(createdAt: number, totalMs: number, now: number): number {
  return Math.max(0, Math.ceil((createdAt + totalMs - now) / 1000));
}

/** dBFS (-60..0) a 0..1 para los medidores. */
export function dbToLevel(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export function tasksSplit(items: ActionItem[]): { mine: ActionItem[]; others: ActionItem[] } {
  return { mine: items.filter((i) => i.isMine), others: items.filter((i) => !i.isMine) };
}

/** Ruta 1-based tipo "2.1" (tema 2, subtema 1). */
export function findTemaByPath(escaleta: Escaleta | null, path: string | null): Tema | null {
  if (!escaleta || !path) return null;
  let level: Tema[] = escaleta.temas;
  let found: Tema | null = null;
  for (const part of path.split(".")) {
    const i = Number.parseInt(part, 10) - 1;
    const next: Tema | undefined = level[i];
    if (!next) return null;
    found = next;
    level = next.subtemas;
  }
  return found;
}

/** Paleta estable por índice de hablante (legible en claro y oscuro). */
export const SPEAKER_COLORS = ["#4f7cff", "#e0703a", "#2f9e7a", "#b05ad6", "#c9a227", "#d6456b", "#2f98b8"];
export const speakerColor = (index: number): string => SPEAKER_COLORS[index % SPEAKER_COLORS.length] ?? "#4f7cff";
