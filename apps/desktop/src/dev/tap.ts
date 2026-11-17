// SOLO desarrollo (VITE_ACTA_DEMO=1): deja emitir eventos del backend a mano
// desde la consola o desde el guion de capturas, para enseñar estados que el
// modo demo no recorre solo (streaming del chat, pasos del procesado, directo).
//   __actaEmit("live:transcript", { sessionId, segments: [...] })
// No entra en producción: main.tsx solo lo importa con el modo demo.

import type { ActaApi, EventName, EventPayloads } from "../api";

type Handler = (payload: unknown) => void;

export function installTap(api: ActaApi): void {
  const handlers = new Map<string, Set<Handler>>();
  const on = api.on.bind(api);
  api.on = (async (event: EventName, handler: Handler) => {
    const set = handlers.get(event) ?? new Set<Handler>();
    handlers.set(event, set);
    set.add(handler);
    const off = await on(event, handler as never);
    return () => {
      set.delete(handler);
      off();
    };
  }) as ActaApi["on"];
  const w = window as unknown as { __actaEmit?: unknown; __actaApi?: unknown };
  w.__actaEmit = <E extends EventName>(event: E, payload: EventPayloads[E]) => handlers.get(event)?.forEach((h) => h(payload));
  w.__actaApi = api;
}
