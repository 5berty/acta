import type { CleanupCandidate, CleanupReason } from "../../api";

const GB = 1e9;
/** "1,2 GB", "340 MB", "12 KB": espacio en disco, en decimal como Finder. */
export function formatSize(bytes: number): string {
  const n = (v: number, d: number) => v.toFixed(d).replace(".", ",");
  if (bytes >= GB) return `${n(bytes / GB, 1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return bytes > 0 ? "menos de 1 KB" : "0 KB";
}

/** "hace 4 meses", "hace 2 años", "hace 12 días". */
export function ago(days: number): string {
  if (days >= 730) return `hace ${Math.floor(days / 365)} años`;
  if (days >= 365) return "hace más de un año";
  if (days >= 60) return `hace ${Math.floor(days / 30)} meses`;
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

/** El motivo, en una etiqueta corta. La antigüedad ya se ve en la fecha de la fila. */
export function reasonLabel(r: CleanupReason): string | null {
  switch (r.kind) {
    case "old":
      return null;
    case "neverUsed":
      return "Nunca la has abierto";
    case "unusedFor":
      return `Sin usar ${ago(r.days).replace("hace ", "desde hace ")}`;
    case "short":
      return r.durationMs < 60_000 ? "Dura menos de un minuto" : `Dura ${Math.round(r.durationMs / 60_000)} min`;
    case "littleContent":
      return r.words === 0 ? "Sin transcripción" : "Casi sin contenido";
    case "failed":
      return "Falló al procesarse";
  }
}

export const reasonLabels = (c: CleanupCandidate): string[] => c.reasons.map(reasonLabel).filter((l): l is string => l !== null);

export const countLabel = (n: number): string => (n === 1 ? "1 reunión" : `${n} reuniones`);

/** «Recordármelo más tarde» calla el aviso una semana. */
export const SNOOZE_MS = 7 * 86_400_000;
