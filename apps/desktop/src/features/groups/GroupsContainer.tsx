import { useCallback, useEffect, useState } from "react";
import type { Group, GroupSuggestion } from "../../api";
import { useApi } from "../../app/ApiContext";
import { FolderOpen } from "lucide-react";
import { EmptyState } from "../../shared/ui/ui";
import { GroupDetailContainer } from "./GroupDetailContainer";
import { GroupsView } from "./GroupsView";

export function GroupsContainer({ onOpenMeeting, initialGroupId = null }: { onOpenMeeting(id: string, at?: number): void; initialGroupId?: string | null }) {
  const api = useApi();
  const [groups, setGroups] = useState<Group[]>([]);
  const [suggestions, setSuggestions] = useState<GroupSuggestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialGroupId);
  const setFavourite = (id: string, favourite: boolean) => {
    // Optimista: la estrella responde al instante.
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, favourite } : g)));
    api.groupSetFavourite(id, favourite).then(load, load);
  };

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([api.groupsList(), api.groupSuggestionsList()]);
    setGroups([...g]);
    setSuggestions([...s]);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = groups.find((g) => g.id === selectedId) ?? null;

  return (
    <div className="page groups">
      <GroupsView
        groups={groups}
        suggestions={suggestions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onFavourite={setFavourite}
        onCreate={(name) => void api.groupCreate(name).then(async (g) => (await load(), setSelectedId(g.id)))}
        onAccept={(id, name) => void api.groupSuggestionAccept(id, name).then(load)}
        onDismiss={(id) => void api.groupSuggestionDismiss(id).then(load)}
        onRefresh={() => void api.groupSuggestionsRefresh().then(load)}
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
