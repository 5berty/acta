import { useEffect, useState } from "react";
import type { Capture, MeetingDetail } from "../../api";
import { useApi } from "../../app/ApiContext";
import { CapturesTab } from "./CapturesTab";

export function CapturesContainer({ detail, onSeek, onChanged }: { detail: MeetingDetail; onSeek(ms: number): void; onChanged(): void }) {
  const api = useApi();
  const [dataDir, setDataDir] = useState<string | null>(null);
  useEffect(() => {
    void api.appInfo().then((i) => setDataDir(i.dataDir));
  }, [api]);

  // Convención del backend: <dataDir>/meetings/<id>/<path relativo>.
  const srcFor = (c: Capture): string => api.fileUrl(`${dataDir ?? ""}/meetings/${c.meetingId}/${c.path}`);

  return (
    <CapturesTab
      captures={detail.captures}
      minutes={detail.minutes}
      escaleta={detail.escaleta}
      srcFor={srcFor}
      onSeek={onSeek}
      onDelete={(id) => void api.captureDelete(id).then(onChanged)}
    />
  );
}
