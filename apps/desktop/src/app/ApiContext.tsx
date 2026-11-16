import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { api as defaultApi, type ActaApi, type EventName, type EventPayloads } from "../api";

const ApiContext = createContext<ActaApi>(defaultApi);

export function ApiProvider({ api, children }: { api?: ActaApi; children: ReactNode }) {
  return <ApiContext.Provider value={api ?? defaultApi}>{children}</ApiContext.Provider>;
}

export const useApi = (): ActaApi => useContext(ApiContext);

/** Suscripción a un evento del backend con limpieza segura (la baja es asíncrona). */
export function useApiEvent<E extends EventName>(event: E, handler: (payload: EventPayloads[E]) => void): void {
  const api = useApi();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    void api.on(event, (p) => ref.current(p)).then((u) => {
      if (cancelled) u();
      else off = u;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [api, event]);
}
