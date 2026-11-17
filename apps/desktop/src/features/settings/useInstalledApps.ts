import { useCallback, useEffect, useMemo, useState } from "react";
import type { InstalledApp } from "../../api";
import { useApi } from "../../app/ApiContext";
import type { AppsSource } from "../../shared/ui/AppListEditor";
import { errorMessage } from "../../shared/ui/ui";

/**
 * Las apps instaladas y en marcha de este Mac, con sus iconos. Se piden la
 * primera vez que hacen falta (`enabled`) y se pueden volver a pedir.
 */
export function useInstalledApps(enabled = true): AppsSource {
  const api = useApi();
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  const reload = useCallback(() => {
    setApps(null);
    setError(null);
    api.appsList().then(
      (list) => setApps([...list]),
      (e: unknown) => setError(errorMessage(e)),
    );
  }, [api]);

  useEffect(() => {
    if (!enabled || asked) return;
    setAsked(true);
    reload();
  }, [enabled, asked, reload]);

  return useMemo(() => ({ apps, error, reload, iconUrl: (path: string) => api.fileUrl(path) }), [apps, error, reload, api]);
}
