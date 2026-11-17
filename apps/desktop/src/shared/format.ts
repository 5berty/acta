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

/** Hora del día sin cero inicial: «9:05». */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export interface DayBucket {
  key: string;
  label: string;
}

/** Sección de la lista de reuniones: Hoy, Ayer, Esta semana (desde el lunes) o el mes. */
export function dayBucket(ts: number, now: number): DayBucket {
  const today = startOfDay(now);
  const day = startOfDay(ts);
  if (day >= today) return { key: "today", label: "Hoy" };
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day >= yesterday.getTime()) return { key: "yesterday", label: "Ayer" };
  const monday = new Date(today);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  if (day >= monday.getTime()) return { key: "week", label: "Esta semana" };
  const d = new Date(ts);
  const label = capitalize(new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(d));
  return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label };
}

export function groupByDay<T extends { startedAt: number }>(items: T[], now: number): (DayBucket & { items: T[] })[] {
  const groups: (DayBucket & { items: T[] })[] = [];
  for (const item of items) {
    const b = dayBucket(item.startedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.key === b.key) last.items.push(item);
    else groups.push({ ...b, items: [item] });
  }
  return groups;
}

/** Iniciales para los avatares: «Ana García» → AG, «Speaker 1» → S1. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

/** Color estable a partir de un nombre (para avatares fuera del transcript). */
export function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return speakerColor(h);
}

const KNOWN_APPS: Record<string, string> = {
  "com.microsoft.teams2": "Microsoft Teams",
  "com.microsoft.teams": "Microsoft Teams (clásico)",
  "us.zoom.xos": "Zoom",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.google.Chrome": "Google Chrome",
  "com.apple.Safari": "Safari",
  "company.thebrowser.Browser": "Arc",
  "com.brave.Browser": "Brave",
  "com.microsoft.edgemac": "Microsoft Edge",
  "org.mozilla.firefox": "Firefox",
  "com.cisco.webexmeetingsapp": "Webex",
  "com.hnc.Discord": "Discord",
};
const GENERIC_SEGMENTS = new Set(["com", "org", "net", "io", "us", "co", "app", "mac", "macos", "desktop", "client"]);

/** Nombre legible de una app a partir de su bundle id (sin enseñar el id). */
export function appDisplayName(bundleId: string, installedName?: string | null): string {
  const known = KNOWN_APPS[bundleId];
  if (known) return known;
  // El nombre con el que la app está instalada en este Mac, si se conoce.
  if (installedName?.trim()) return installedName.trim();
  const segments = bundleId.split(".").filter((s) => s && !GENERIC_SEGMENTS.has(s.toLowerCase()));
  const raw = segments[segments.length - 1] ?? bundleId;
  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}

export interface HumanError {
  title: string;
  hint: string;
  /** «Claude Code · sonnet»: quién falló, cuando el fallo es de la IA y se sabe. */
  llm?: string;
}

/** Proveedor y modelo que estaban trabajando cuando falló. */
export interface LlmContext {
  provider?: string | null;
  model?: string | null;
}

interface ErrorRule {
  test: RegExp;
  title: string | ((c: LlmContext) => string);
  hint: string | ((c: LlmContext) => string);
  /** El fallo es del proveedor de IA: se enseña cuál. */
  llm?: boolean;
}

const ERROR_RULES: ErrorRule[] = [
  { test: /no space|espacio|disk full|ENOSPC/i, title: "No queda espacio en el disco", hint: "Libera espacio y vuelve a intentarlo. El audio está a salvo." },
  { test: /not found|no such file|os error 2|ENOENT|no encontr/i, title: "No encuentro el asistente de IA", hint: "Revisa el proveedor en Ajustes → Proveedores de IA y pulsa «Detectar».", llm: true },
  { test: /timeout|timed out|tardado|deadline/i, title: "La IA ha tardado demasiado", hint: "Suele ser puntual. Reinténtalo; si se repite, prueba con otro proveedor.", llm: true },
  { test: /401|403|unauthori[sz]ed|api key|clave|credential|login/i, title: "La clave de la IA no es válida", hint: "Vuelve a iniciar sesión en el proveedor o revisa su clave en Ajustes.", llm: true },
  { test: /429|rate limit|quota|cuota|overloaded|529/i, title: "El proveedor de IA está saturado", hint: "Has llegado al límite de uso o el servicio va cargado. Reinténtalo en unos minutos.", llm: true },
  { test: /model.*(download|descarg)|not downloaded|sin descargar/i, title: "Falta descargar un modelo de voz", hint: "Descárgalo en Ajustes → Modelos y vuelve a intentarlo." },
  { test: /network|red\b|connection|conexi|dns|offline|ECONN/i, title: "No hay conexión con la IA", hint: "Comprueba la red. La transcripción es local, pero el acta necesita al proveedor.", llm: true },
  { test: /permission|permiso|denied|denegad/i, title: "Falta un permiso de macOS", hint: "Revísalo en Ajustes → Permisos." },
  {
    test: /json|schema|parse|esquema|formato/i,
    title: (c) => `${c.provider ?? "La IA"} ha respondido con un formato que acta no entiende`,
    hint: (c) => `${c.model ? `El modelo ${c.model} no ha devuelto el acta con la estructura esperada. ` : ""}Reinténtalo, o prueba otro modelo con «Reintentar con…».`,
  },
];

const clean = (s: string | undefined): string | null => s?.trim().replace(/[.\s]+$/, "") || null;

/** Proveedor y modelo, si el propio texto del error los trae («proveedor: X, modelo: Y»). */
export function llmFromError(error: string): LlmContext {
  const provider = /(?:proveedor|provider)\s*[:=]\s*[«"']?([^,;»"')\n]+)/i.exec(error)?.[1];
  const model = /(?:modelo|model)\s*[:=]\s*[«"']?([^,;»"')\s]+)/i.exec(error)?.[1];
  return { provider: clean(provider), model: clean(model) };
}

/** Convierte el error crudo del procesado en un título y una pista accionable. */
export function humanizeError(error: string | null | undefined, context: LlmContext = {}): HumanError {
  const stated = error ? llmFromError(error) : {};
  // Lo que diga el error manda sobre lo que hay configurado ahora.
  const c: LlmContext = stated.provider ? { provider: stated.provider, model: stated.model ?? null } : { provider: context.provider ?? null, model: stated.model ?? context.model ?? null };
  const rule = error ? ERROR_RULES.find((r) => r.test.test(error)) : undefined;
  if (!rule) return { title: "No se ha podido terminar el acta", hint: "El audio está a salvo. Puedes reintentarlo cuando quieras." };
  const text = (t: string | ((c: LlmContext) => string)) => (typeof t === "string" ? t : t(c));
  const llm = rule.llm && c.provider ? (c.model ? `${c.provider} · ${c.model}` : c.provider) : undefined;
  return { title: text(rule.title), hint: text(rule.hint), llm };
}
