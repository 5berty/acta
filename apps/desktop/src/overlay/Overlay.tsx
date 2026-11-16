// Pastilla flotante (WP5 la UI, WP6 el NSPanel). Muestra: temporizador, dos
// medidores (Yo / Otros), pausa, parar; y se expande para las preguntas
// "Reunión de Teams detectada — ¿Grabar?" / "La llamada ha terminado — ¿Parar?".
import { useEffect, useState } from "react";
import { api, type SessionSnapshot } from "../api";

export function Overlay() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void api.sessionGetState().then(setSnapshot);
    void api.on("session:state", setSnapshot).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  return <div role="status">{snapshot?.state.state ?? "…"}</div>;
}
