import { useCallback, useEffect, useState } from "react";
import type { Group, MeetingQuery, MeetingSummary } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { CleanupBanner } from "../cleanup/CleanupBanner";
import { CleanupSheet } from "../cleanup/CleanupSheet";
import { useCleanup } from "../cleanup/useCleanup";
import { MeetingList, type DatePreset, type Progress } from "./MeetingList";
import { REPROCESS_STEPS } from "./ProcessingStatus";

const DAY = 86_400_000;

function range(preset: DatePreset): Pick<MeetingQuery, "from" | "to"> {
  const now = Date.now();
  if (preset === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime() };
  }
  if (preset === "7d") return { from: now - 7 * DAY };
  if (preset === "30d") return { from: now - 30 * DAY };
  return {};
}

export function MeetingListContainer({ onOpen }: { onOpen: (id: string) => void }) {
  const api = useApi();
  const [items, setItems] = useState<MeetingSummary[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [text, setText] = useState("");
  const [groupId, setGroupId] = useState("");
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [progress, setProgress] = useState<Record<string, Progress | undefined>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const page = await api.meetingsList({
      text: text || null,
      groupId: groupId || null,
      favouritesOnly,
      limit: 100,
      ...range(datePreset),
    });
    setItems(page.items);
    setLoading(false);
  }, [api, text, groupId, datePreset, favouritesOnly]);
  const cleanup = useCleanup(() => void load());

  useEffect(() => {
    let live = true;
    void api.meetingsList({ text: text || null, groupId: groupId || null, favouritesOnly, limit: 100, ...range(datePreset) }).then((page) => {
      if (live) {
        setItems(page.items);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [api, text, groupId, datePreset, favouritesOnly]);

  useEffect(() => {
    void api.groupsList().then(setGroups);
  }, [api]);

  useApiEvent("processing:progress", (p) =>
    setProgress((prev) => ({ ...prev, [p.meetingId]: { step: p.step, fraction: p.fraction } })),
  );
  useApiEvent("meeting:updated", () => void load());

  const setFavourite = (id: string, favourite: boolean) => {
    // Optimista: la estrella responde al instante; `meeting:updated` recarga la lista.
    setItems((prev) => prev.map((m) => (m.id === id ? { ...m, favourite } : m)));
    api.meetingSetFavourite(id, favourite).catch(() => void load());
  };

  return (
    <>
    <MeetingList
      items={items}
      groups={groups}
      text={text}
      groupId={groupId}
      datePreset={datePreset}
      favouritesOnly={favouritesOnly}
      onFavouritesOnly={setFavouritesOnly}
      onFavourite={setFavourite}
      banner={
        cleanup.showBanner && cleanup.suggestions ? (
          <CleanupBanner count={cleanup.suggestions.candidates.length} totalBytes={cleanup.suggestions.totalBytes} onReview={() => setReviewing(true)} onLater={cleanup.later} />
        ) : null
      }
      progress={progress}
      loading={loading}
      onText={setText}
      onGroup={setGroupId}
      onDatePreset={setDatePreset}
      onOpen={onOpen}
      onRetry={(id) => void api.meetingReprocess({ meetingId: id, steps: REPROCESS_STEPS }).then(load)}
      onRecord={() => void api.sessionStart(null).catch(() => {})}
    />
    {reviewing && cleanup.suggestions ? (
      <CleanupSheet
        suggestions={cleanup.suggestions}
        onClose={() => setReviewing(false)}
        onDelete={cleanup.remove}
        onKeep={cleanup.keep}
        onLater={cleanup.later}
        onOpenMeeting={(id) => {
          setReviewing(false);
          onOpen(id);
        }}
      />
    ) : null}
    </>
  );
}
