import { FolderOpen, FolderPlus } from "lucide-react";
import { useMemo, useState } from "react";
import type { Group } from "../../api";
import { useApi } from "../../app/ApiContext";
import { Highlight, findRanges, fold, matches } from "../../shared/textSearch";
import { PickerPopover, type PickerItem } from "../../shared/ui/PickerPopover";

interface Props {
  label?: string;
  /** Grupos en los que ya está la reunión. */
  memberOf: string[];
  onAdd(groupIds: string[]): void | Promise<void>;
}

const count = (n: number): string => (n === 0 ? "Añadir a grupos" : n === 1 ? "Añadir a 1 grupo" : `Añadir a ${n} grupos`);
const meetings = (n: number): string => (n === 1 ? "1 reunión" : `${n} reuniones`);

/** Buscador de grupos para una reunión, con «Crear grupo» al vuelo. */
export function GroupPicker({ label = "Añadir a grupo", memberOf, onAdd }: Props) {
  const api = useApi();
  const [groups, setGroups] = useState<Group[]>([]);
  const [query, setQuery] = useState("");
  const text = query.trim();
  const load = () => api.groupsList().then((g) => setGroups([...g]));

  const items = useMemo<PickerItem[]>(() => {
    const mine = new Set(memberOf);
    const shown = groups.filter((g) => !text || matches(g.name, text) || matches(g.description ?? "", text));
    return [...shown.filter((g) => !mine.has(g.id)), ...shown.filter((g) => mine.has(g.id))].map((g) => ({
      id: g.id,
      title: g.name,
      disabled: mine.has(g.id),
      icon: (
        <span className="picker-folder" aria-hidden>
          <FolderOpen size={14} strokeWidth={1.9} />
        </span>
      ),
      content: (
        <>
          <span className="picker-title">
            <Highlight text={g.name} ranges={findRanges(g.name, text)} />
          </span>
          <span className="picker-meta">
            {mine.has(g.id) ? "Ya está en este grupo · " : ""}
            {meetings(g.meetingCount)}
            {g.description ? ` · ${g.description}` : ""}
          </span>
        </>
      ),
    }));
  }, [groups, memberOf, text]);

  const exists = groups.some((g) => fold(g.name) === fold(text));

  return (
    <PickerPopover
      label={label}
      icon={<FolderPlus size={13} strokeWidth={2} aria-hidden />}
      searchLabel="Buscar grupos"
      placeholder="Busca un grupo o escribe uno nuevo…"
      items={items}
      query={query}
      onQuery={setQuery}
      emptyText={text ? `Ningún grupo coincide con «${text}».` : "Aún no tienes grupos. Escribe un nombre para crear el primero."}
      confirmLabel={count}
      onConfirm={onAdd}
      create={
        text && !exists
          ? {
              label: (q) => `Crear grupo «${q}»`,
              run: async (q) => {
                const g = await api.groupCreate(q);
                await load();
                return g.id;
              },
            }
          : null
      }
      onOpen={() => void load()}
    />
  );
}
