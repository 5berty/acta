import type { ProviderConfig, Settings } from "../../api";

/** Modelo configurado en un proveedor, si lo fija. */
export function providerModel(p: ProviderConfig): string | null {
  const k = p.kind;
  if (k.type === "builtIn") return k.modelId;
  return k.model || null;
}

/** «Claude Code (CLI) · sonnet». */
export function providerDisplay(p: ProviderConfig, model?: string | null): string {
  const m = model ?? providerModel(p);
  return m ? `${p.label} · ${m}` : p.label;
}

export function providerNames(settings: Settings): Record<string, string> {
  return Object.fromEntries(settings.llm.providers.map((p) => [p.id, p.label]));
}

export function providerById(settings: Settings, id: string | null | undefined): ProviderConfig | null {
  return settings.llm.providers.find((p) => p.id === id) ?? null;
}
