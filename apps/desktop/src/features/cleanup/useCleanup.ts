import { useCallback, useEffect, useState } from "react";
import type { CleanupResult, CleanupSuggestions } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { SNOOZE_MS } from "./reasons";

export interface Cleanup {
  suggestions: CleanupSuggestions | null;
  /** El aviso se enseña: hay candidatas y no está pospuesto. */
  showBanner: boolean;
  reload(): void;
  later(): void;
  remove(ids: string[]): Promise<CleanupResult>;
  keep(ids: string[]): Promise<void>;
}

/** Sugerencias de limpieza y sus acciones. `onChanged` avisa cuando se borra algo. */
export function useCleanup(onChanged?: () => void): Cleanup {
  const api = useApi();
  const [suggestions, setSuggestions] = useState<CleanupSuggestions | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);

  const reload = useCallback(() => {
    void api.cleanupSuggestions().then(setSuggestions, () => setSuggestions(null));
    void api.settingsGet().then((s) => setSnoozedUntil(s.cleanup?.snoozedUntil ?? null));
  }, [api]);
  useEffect(reload, [reload]);
  // Una estrella o una reunión recién abierta cambian lo que se sugiere.
  useApiEvent("meeting:updated", reload);

  const later = useCallback(() => {
    const until = Date.now() + SNOOZE_MS;
    setSnoozedUntil(until);
    // Sobre lo último guardado: no pisa otros ajustes.
    void api.settingsGet().then((s) => api.settingsUpdate({ ...s, cleanup: { ...s.cleanup, snoozedUntil: until } }));
  }, [api]);

  const remove = useCallback(
    async (ids: string[]) => {
      const result = await api.cleanupDelete(ids);
      reload();
      onChanged?.();
      return result;
    },
    [api, reload, onChanged],
  );
  const keep = useCallback(
    async (ids: string[]) => {
      await api.cleanupKeep(ids);
      reload();
    },
    [api, reload],
  );

  const count = suggestions?.candidates.length ?? 0;
  const snoozed = snoozedUntil != null && snoozedUntil > Date.now();
  return { suggestions, showBanner: count > 0 && !snoozed, reload, later, remove, keep };
}
