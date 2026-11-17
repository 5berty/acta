import { useCallback, useEffect, useState } from "react";
import type { PermissionState } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";

const POLL_MS = 2_000;

/**
 * Permisos de macOS siempre al día. El estado lo dice el backend; aquí se
 * vuelve a preguntar cuando puede haber cambiado: al volver a la ventana (la
 * persona viene de Ajustes del Sistema), con `permissions:changed` y, mientras
 * la pantalla de permisos está a la vista (`watching`), cada pocos segundos.
 */
export function usePermissions(watching: boolean) {
  const api = useApi();
  const [permissions, setPermissions] = useState<PermissionState[]>([]);

  const refresh = useCallback(() => {
    api.permissionsStatus().then(
      (p) => setPermissions([...p]),
      () => {},
    );
  }, [api]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState !== "hidden") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (!watching) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") refresh();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [watching, refresh]);

  // El backend ya lo ha comprobado: la fila cambia sin esperar a otra consulta.
  // Automatización va por app (varias filas): ahí se vuelve a preguntar.
  useApiEvent("permissions:changed", (c) => {
    setPermissions((prev) => {
      const rows = prev.filter((p) => p.kind === c.kind);
      if (rows.length !== 1 || rows[0]?.target) return prev;
      return prev.map((p) => (p.kind === c.kind ? { ...p, status: c.status } : p));
    });
    if (c.kind === "automation") refresh();
  });

  return { permissions, refresh };
}
