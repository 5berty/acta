import { useCallback, useEffect, useMemo, useState } from "react";
import type { AvailableProvider, ChatScope, LlmOverride, Settings } from "../../api";
import { useApi } from "../../app/ApiContext";
import { providerById, providerDisplay, providerNames } from "./providerLabel";

/** Proveedor y modelo elegidos en el selector (`model: null` = el que tenga por defecto ese proveedor). */
export interface ModelChoice {
  providerId: string;
  model: string | null;
}

/** Lo que enseña el botón del compositor. */
export interface ChatModel {
  /** «NaN Builders · deepseek-v4-pro». `null` mientras cargan los ajustes. */
  label: string | null;
  providerId: string | null;
  model: string | null;
  /** No hay proveedor de IA con el que responder. */
  missing: boolean;
}

const PREFIX = "acta.chat.llm.";
const LAST = `${PREFIX}last`;
export const NO_PROVIDER = "Sin proveedor de IA";

/** Clave de cada chat: una reunión, un grupo o «todas». El directo usa `live:<sesión>`. */
export function chatScopeKey(scope: ChatScope): string {
  if (scope.kind === "meeting") return `meeting:${scope.meetingId}`;
  if (scope.kind === "group") return `group:${scope.groupId}`;
  return "all";
}

function read(key: string): ModelChoice | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { providerId, model } = v as { providerId?: unknown; model?: unknown };
    if (typeof providerId !== "string" || !providerId) return null;
    return { providerId, model: typeof model === "string" && model ? model : null };
  } catch {
    // Almacenamiento bloqueado o contenido roto: como si no hubiera nada.
    return null;
  }
}

/** La elección de ese chat o, si no tiene, la última hecha en cualquier chat. */
export function readChoice(scopeKey: string): ModelChoice | null {
  return read(PREFIX + scopeKey) ?? read(LAST);
}

/** Guarda la elección para ese chat y como punto de partida de los chats nuevos. */
export function saveChoice(scopeKey: string, choice: ModelChoice): void {
  try {
    const raw = JSON.stringify({ providerId: choice.providerId, model: choice.model });
    localStorage.setItem(PREFIX + scopeKey, raw);
    localStorage.setItem(LAST, raw);
  } catch {
    // Sin almacenamiento la elección vale solo para esta sesión.
  }
}

/**
 * Quién responde al siguiente mensaje. Una elección guardada cuyo proveedor ya
 * no existe o está desactivado se ignora: vuelve al proveedor de chat de Ajustes.
 */
export function resolveModel(settings: Settings | null, choice: ModelChoice | null): { model: ChatModel; llm: LlmOverride | null } {
  if (!settings) {
    return { model: { label: null, providerId: null, model: null, missing: false }, llm: choice ? { providerId: choice.providerId, model: choice.model } : null };
  }
  const picked = choice ? providerById(settings, choice.providerId) : null;
  if (choice && picked?.enabled) {
    const label = choice.model ? `${picked.label} · ${choice.model}` : picked.label;
    return { model: { label, providerId: picked.id, model: choice.model, missing: false }, llm: { providerId: picked.id, model: choice.model } };
  }
  const fallback = providerById(settings, settings.llm.chatProvider);
  if (!fallback) return { model: { label: NO_PROVIDER, providerId: null, model: null, missing: true }, llm: null };
  return { model: { label: providerDisplay(fallback), providerId: fallback.id, model: null, missing: false }, llm: null };
}

/**
 * Modelo de un chat: se elige por chat, vale para el siguiente mensaje y se
 * recuerda (por chat y como último usado) en `localStorage`.
 */
export function useChatModel(scopeKey: string) {
  const api = useApi();
  const [settings, setSettings] = useState<Settings | null>(null);
  // Elecciones hechas en esta sesión: mandan aunque el almacenamiento falle.
  const [session, setSession] = useState<Record<string, ModelChoice>>({});

  useEffect(() => {
    let live = true;
    api.settingsGet().then(
      (s) => live && setSettings(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api]);

  const choice = useMemo(() => session[scopeKey] ?? readChoice(scopeKey), [session, scopeKey]);
  const { model, llm } = useMemo(() => resolveModel(settings, choice), [settings, choice]);
  const names = useMemo(() => (settings ? providerNames(settings) : {}), [settings]);

  const pick = useCallback(
    (c: ModelChoice) => {
      saveChoice(scopeKey, c);
      setSession((prev) => ({ ...prev, [scopeKey]: c }));
    },
    [scopeKey],
  );
  const loadProviders = useCallback((): Promise<AvailableProvider[]> => api.llmProvidersAvailable(), [api]);

  return { model, llm, pick, loadProviders, providerNames: names };
}
