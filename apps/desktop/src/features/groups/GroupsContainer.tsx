import { useCallback, useEffect, useState } from "react";
import type { Group, GroupSuggestion } from "../../api";
import { useApi } from "../../app/ApiContext";
import { FolderOpen } from "lucide-react";
import { EmptyState, errorMessage } from "../../shared/ui/ui";
import { GroupDetailContainer } from "./GroupDetailContainer";
import { GroupsView } from "./GroupsView";

/** Aviso del panel lateral: resultado de la última acción. */
export type GroupsNotice =
  | { kind: "found"; count: number }
  | { kind: "empty"; ready: number | null }
  | { kind: "error"; message: string; retry: () => void };

export function GroupsContainer({ onOpenMeeting, initialGroupId = null }: { onOpenMeeting(id: string, at?: number): void; initialGroupId?: string | null }) {
  const api = useApi();
  const [groups, setGroups] = useState<Group[]>([]);
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialGroupId);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<GroupsNotice | null>(null);

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([api.groupsList(), api.groupSuggestionsList()]);
    setGroups([...g]);
    setSuggestions([...s]);
  }, [api]);

  const fail = (e: unknown, retry: () => void) => setNotice({ kind: "error", message: errorMessage(e), retry });

  const initialLoad = useCallback(() => {
    setNotice(null);
    load().catch((e) => setNotice({ kind: "error", message: errorMessage(e), retry: initialLoad }));
  }, [load]);

  useEffect(() => {
    initialLoad();
  }, [initialLoad]);

  /** Ejecuta una acción de escritura y recarga; cualquier fallo se enseña. */
  const act = (run: () => Promise<unknown>) => {
    setNotice(null);
    run()
      .then(load)
      .catch((e) => fail(e, () => void load().then(() => setNotice(null)).catch((e2) => fail(e2, initialLoad))));
  };

  const setFavourite = (id: string, favourite: boolean) => {
    setNotice(null);
    // Optimista: la estrella responde al instante; si falla, se deshace.
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, favourite } : g)));
    api
      .groupSetFavourite(id, favourite)
      .then(load)
      .catch((e) => {
        setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, favourite: !favourite } : g)));
        fail(e, () => setFavourite(id, favourite));
      });
  };

  const refresh = () => {
    if (refreshing) return;
    setNotice(null);
    setRefreshing(true);
    api
      .groupSuggestionsRefresh()
      .then(async (found) => {
        await load();
        if (found.length > 0) {
          setNotice({ kind: "found", count: found.length });
          return;
        }
        // Sin sugerencias: se cuenta cuántas reuniones procesadas hay para explicar por qué.
        let ready: number | null = null;
        try {
          const page = await api.meetingsList({ limit: 200 });
          ready = page.items.filter((m) => m.status === "ready").length;
        } catch {
          ready = null;
        }
        setNotice({ kind: "empty", ready });
      })
      .catch((e) => fail(e, refresh))
      .finally(() => setRefreshing(false));
  };

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="page groups">
      <GroupsView
        groups={groups}
        suggestions={suggestions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onFavourite={setFavourite}
        refreshing={refreshing}
        notice={notice}
        onCloseNotice={() => setNotice(null)}
        onCreate={(name) => act(async () => setSelectedId((await api.groupCreate(name)).id))}
        onAccept={(id, name) => act(() => api.groupSuggestionAccept(id, name))}
        onDismiss={(id) => act(() => api.groupSuggestionDismiss(id))}
        onRefresh={refresh}
      />
      <div className="groups-main">
        {selected ? (
          <GroupDetailContainer
            key={selected.id}
            group={selected}
            onChanged={() => void load()}
            onFavourite={(f) => setFavourite(selected.id, f)}
            onDeleted={() => {
              setSelectedId(null);
              void load();
            }}
            onOpenMeeting={onOpenMeeting}
          />
        ) : (
          <EmptyState
            icon={<FolderOpen size={28} strokeWidth={1.7} />}
            title={groups.length === 0 ? "Crea tu primer grupo" : "Elige un grupo"}
            hint={
              groups.length === 0
                ? "Por ejemplo «Proyecto Atlas» o «Uno a uno con Ana». Después podrás preguntar a todas sus reuniones de golpe."
                : "Verás sus reuniones y podrás preguntarles a todas a la vez."
            }
          />
        )}
      </div>
    </div>
  );
}
