// Apps de dictado y de voz conocidas: usan el micrófono pero no son reuniones.
// Lógica pura: se sugieren solo si están instaladas en este Mac.

import type { InstalledApp } from "../../api";

interface Known {
  /** Prefijos de bundle id, en minúsculas. */
  ids: string[];
  /** Nombres de la app, ya normalizados (minúsculas, sin espacios ni signos). */
  names: string[];
}

// Identificadores comprobados: superwhisper (catálogo de Fleet) y Orca (Info.plist).
// El resto son los habituales; si la app cambia de id, se reconoce por su nombre.
const KNOWN: Known[] = [
  { ids: ["com.typeless."], names: ["typeless"] },
  { ids: ["com.electron.wispr-flow"], names: ["wisprflow"] },
  { ids: ["com.superduper.superwhisper"], names: ["superwhisper"] },
  { ids: ["com.goodsnooze.macwhisper"], names: ["macwhisper"] },
  { ids: ["com.stablyai.orca"], names: ["orca"] },
  { ids: ["com.electron.aqua-voice", "com.withaqua."], names: ["aquavoice"] },
];

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function rank(app: InstalledApp): number {
  const id = app.bundleId.toLowerCase();
  const name = normName(app.name);
  return KNOWN.findIndex((k) => k.ids.some((p) => id === p || id.startsWith(p.endsWith(".") ? p : `${p}.`)) || k.names.includes(name));
}

/** Las apps de dictado instaladas que aún no están en `already`, en un orden estable. */
export function dictationApps(apps: InstalledApp[], already: string[] = []): InstalledApp[] {
  const skip = new Set(already.map((id) => id.toLowerCase()));
  const found: { app: InstalledApp; rank: number }[] = [];
  for (const app of apps) {
    const id = app.bundleId.toLowerCase();
    if (skip.has(id)) continue;
    const r = rank(app);
    if (r < 0) continue;
    skip.add(id);
    found.push({ app, rank: r });
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.app);
}
