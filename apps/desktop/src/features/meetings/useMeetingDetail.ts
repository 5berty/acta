import { useCallback, useEffect, useState } from "react";
import type { MeetingDetail, VoiceprintSummary } from "../../api";
import { useApi } from "../../app/ApiContext";
import { errorMessage } from "../../shared/ui/ui";

export function useMeetingDetail(meetingId: string) {
  const api = useApi();
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [voiceprints, setVoiceprints] = useState<VoiceprintSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await api.meetingGet(meetingId);
      // Copia superficial: el backend puede devolver el mismo objeto mutado.
      setDetail({ ...d, meeting: { ...d.meeting }, transcript: { ...d.transcript }, minutes: d.minutes && { ...d.minutes } });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, meetingId]);

  useEffect(() => {
    setDetail(null);
    void reload();
    void api.voiceprintsList().then(setVoiceprints);
  }, [api, reload]);

  return { detail, voiceprints, error, reload };
}
