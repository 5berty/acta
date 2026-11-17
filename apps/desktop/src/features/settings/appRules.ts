// Reglas de «Apps de reunión»: qué plataforma proponer para una app y qué
// forma tiene un identificador. Lógica pura.

import type { AppRule, Platform } from "../../api";

export const PLATFORM_OPTIONS: { key: Platform; label: string }[] = [
  { key: "teams", label: "Teams" },
  { key: "meet", label: "Google Meet" },
  { key: "zoom", label: "Zoom" },
  { key: "slack", label: "Slack" },
  { key: "other", label: "Otra" },
];

/** Navegadores: ahí solo cuenta una pestaña de Google Meet. */
const BROWSERS = [
  "com.google.chrome",
  "com.apple.safari",
  "company.thebrowser.browser",
  "company.thebrowser.dia",
  "com.brave.browser",
  "com.microsoft.edgemac",
  "org.mozilla.firefox",
  "com.vivaldi.vivaldi",
  "com.operasoftware.opera",
  "org.chromium.chromium",
  "app.zen-browser.zen",
  "com.kagi.kagimacos",
  "com.duckduckgo.macos.browser",
];

/** Apps habituales, para añadirlas con un toque cuando están instaladas. */
export const MEETING_PRESETS: AppRule[] = [
  { bundleId: "com.microsoft.teams2", platform: "teams", isBrowser: false },
  { bundleId: "us.zoom.xos", platform: "zoom", isBrowser: false },
  { bundleId: "com.tinyspeck.slackmacgap", platform: "slack", isBrowser: false },
  { bundleId: "com.google.Chrome", platform: "meet", isBrowser: true },
  { bundleId: "com.apple.Safari", platform: "meet", isBrowser: true },
  { bundleId: "company.thebrowser.Browser", platform: "meet", isBrowser: true },
  { bundleId: "com.brave.Browser", platform: "meet", isBrowser: true },
  { bundleId: "com.microsoft.edgemac", platform: "meet", isBrowser: true },
  { bundleId: "org.mozilla.firefox", platform: "meet", isBrowser: true },
];

/** La regla más probable para una app: se enseña para confirmarla, no se aplica sola. */
export function guessRule(bundleId: string, name = ""): AppRule {
  const id = bundleId.toLowerCase();
  if (BROWSERS.some((b) => id === b || id.startsWith(`${b}.`))) return { bundleId, platform: "meet", isBrowser: true };
  const hay = `${id} ${name.toLowerCase()}`;
  const platform: Platform = hay.includes("teams") ? "teams" : hay.includes("zoom") ? "zoom" : hay.includes("slack") ? "slack" : "other";
  return { bundleId, platform, isBrowser: false };
}
