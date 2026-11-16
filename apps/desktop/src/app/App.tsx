// Ventana principal (WP5). Secciones previstas en src/features/:
// meetings (lista + detalle), transcript, escaleta, timeline, captures,
// minutes (resumen/tareas), chat, groups, settings, permissions.
import { useEffect, useState } from "react";
import { api, type SessionSnapshot } from "../api";

export function App() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void api.sessionGetState().then(setSnapshot);
    void api.on("session:state", setSnapshot).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  return (
    <main>
      <h1>acta</h1>
      <p>Estado: {snapshot?.state.state ?? "cargando…"}</p>
    </main>
  );
}
