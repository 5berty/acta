import { useCallback, useEffect, useState } from "react";
import type { ModelDownload, ModelStatus, PermissionState, ProviderTestResult, Settings, VoiceprintSummary } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { Button, errorMessage } from "../../shared/ui/ui";
import { AutoStopSection, DetectionSection, ScreenSection, TranscriptionSection } from "./GeneralSections";
import { ModelsSection } from "./ModelsSection";
import { PermissionsSection } from "./PermissionsSection";
import { ProvidersSection, newProvider } from "./ProvidersSection";

export function SettingsContainer() {
  const api = useApi();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [permissions, setPermissions] = useState<PermissionState[]>([]);
  const [voiceprints, setVoiceprints] = useState<VoiceprintSummary[]>([]);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ModelDownload>>({});
  const [tests, setTests] = useState<Record<string, ProviderTestResult | "pending" | undefined>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.settingsGet().then((s) => {
      setSaved(s);
      setDraft(structuredClone(s));
    });
    void api.permissionsStatus().then(setPermissions);
    void api.voiceprintsList().then(setVoiceprints);
    void api.modelsStatus().then(setModels);
  }, [api]);

  useApiEvent("model:download", (d) => {
    setDownloads((prev) => ({ ...prev, [d.name]: d }));
    if (d.done) void api.modelsStatus().then((m) => setModels([...m]));
  });

  const download = (name: string) => {
    setDownloads((prev) => ({ ...prev, [name]: { name, fraction: 0, done: false, error: null } }));
    api.modelsDownload(name).catch((e: unknown) => setDownloads((prev) => ({ ...prev, [name]: { name, fraction: 0, done: false, error: errorMessage(e) } })));
  };
  useApiEvent("session:state", () => {}); // reservado: refrescar permisos al volver a la app

  const refreshPermissions = useCallback(() => void api.permissionsStatus().then((p) => setPermissions([...p])), [api]);

  if (!draft || !saved) return <p className="muted pad">Cargando…</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async (next: Settings = draft): Promise<boolean> => {
    try {
      const s = await api.settingsUpdate(next);
      setSaved(structuredClone(s));
      setDraft(structuredClone(s));
      setMessage("Cambios guardados");
      return true;
    } catch (e) {
      setMessage(errorMessage(e));
      return false;
    }
  };

  const testProvider = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "pending" }));
    // El backend prueba la configuración guardada: se guarda antes de probar.
    if (dirty && !(await save())) return setTests((t) => ({ ...t, [id]: undefined }));
    try {
      setTests((t) => ({ ...t, [id]: undefined }));
      const r = await api.llmProviderTest(id);
      setTests((t) => ({ ...t, [id]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [id]: { ok: false, message: errorMessage(e), latencyMs: null } }));
    }
  };

  const detect = async () => {
    const found = await api.llmCliDetect();
    setDraft((d) => {
      if (!d) return d;
      let providers = d.llm.providers.map((p) => ({ ...p, kind: { ...p.kind } })) as Settings["llm"]["providers"];
      for (const [type, path] of [["claudeCli", found.claude], ["codexCli", found.codex]] as const) {
        if (!path) continue;
        const existing = providers.find((p) => p.kind.type === type);
        const env = type === "claudeCli" ? found.claudeEnv : found.codexEnv;
        const target = existing ?? newProvider(type, providers);
        if (target.kind.type === "claudeCli" || target.kind.type === "codexCli") {
          target.kind.binaryPath = path;
          target.kind.extraEnv = { ...target.kind.extraEnv, ...env };
        }
        if (!existing) providers = [...providers, target];
      }
      return { ...d, llm: { ...d.llm, providers } };
    });
  };

  return (
    <div className="settings">
      <header className="settings-head">
        <h1>Ajustes</h1>
        <div className="settings-actions">
          {message ? <span role="status" className="muted">{message}</span> : null}
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(structuredClone(saved))}>
            Descartar
          </Button>
          <Button variant="primary" disabled={!dirty} onClick={() => void save()}>
            Guardar cambios
          </Button>
        </div>
      </header>
      <ProvidersSection llm={draft.llm} tests={tests} onChange={(llm) => setDraft({ ...draft, llm })} onTest={(id) => void testProvider(id)} onDetect={() => void detect()}
        onSecretSet={(id, value) => api.secretSet(id, value)}
        onSecretDelete={(id) => api.secretDelete(id)}
      />
      <ModelsSection models={models} downloads={downloads} onDownload={download} />
      <TranscriptionSection
        value={draft.transcription}
        onChange={(transcription) => setDraft({ ...draft, transcription })}
        voiceprints={voiceprints}
        onForget={(id) => void api.voiceprintDelete(id).then(() => api.voiceprintsList().then((v) => setVoiceprints([...v])))}
      />
      <PermissionsSection
        permissions={permissions}
        onRequest={(k) => void api.permissionsRequest(k).then(refreshPermissions)}
        onOpen={(k) => void api.openSystemSettings(k)}
        onRefresh={refreshPermissions}
      />
      <AutoStopSection value={draft.autoStop} onChange={(autoStop) => setDraft({ ...draft, autoStop })} />
      <DetectionSection value={draft.detection} onChange={(detection) => setDraft({ ...draft, detection })} />
      <ScreenSection value={draft.screen} onChange={(screen) => setDraft({ ...draft, screen })} />
    </div>
  );
}
