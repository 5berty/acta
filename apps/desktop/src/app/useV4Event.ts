import { useEffect, useRef } from "react";
import { useApi } from "./ApiContext";
import { onV4, type V4Events } from "./v4";

/** Como `useApiEvent`, para los eventos de la oleada v4. */
export function useV4Event<E extends keyof V4Events>(event: E, handler: (payload: V4Events[E]) => void): void {
  const api = useApi();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    void onV4(api, event, (p) => ref.current(p))
      .then((u) => {
        if (cancelled) u();
        else off = u;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      off?.();
    };
  }, [api, event]);
}
