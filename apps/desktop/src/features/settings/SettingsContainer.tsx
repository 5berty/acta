import { Bot, Camera, Download, Info, Radar, ShieldCheck, SlidersHorizontal, Timer } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { AppInfo, ModelDownload, ModelStatus, ProviderTestResult, Settings, VoiceprintSummary } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { Button, errorMessage } from "../../shared/ui/ui";
import { AboutSection } from "./AboutSection";
import { DetectionSection, GeneralSection, RecordingSection, ScreenSection } from "./GeneralSections";
import { ModelsSection } from "./ModelsSection";
import { PermissionsSection } from "./PermissionsSection";
import { usePermissions } from "./usePermissions";
import { createFromPreset } from "../providers/presets";
import { ProvidersSection } from "./ProvidersSection";

type SectionKey = "general" | "recording" | "detection" | "screen" | "providers" | "models" | "permissions" | "about";

const NAV_ICON = { size: 15, strokeWidth: 1.9, "aria-hidden": true } as const;
const SECTIONS: { key: SectionKey; label: string; icon: ReactNode; tint: string }[] = [
  { key: "general", label: "General", icon: <SlidersHorizontal {...NAV_ICON} />, tint: "#8e8e93" },
  { key: "recording", label: "Grabación y autoparada", icon: <Timer {...NAV_ICON} />, tint: "#ff453a" },
  { key: "detection", label: "Detección", icon: <Radar {...NAV_ICON} />, tint: "#30b0c7" },
  { key: "screen", label: "Capturas", icon: <Camera {...NAV_ICON} />, tint: "#ff9f0a" },
  { key: "providers", label: "Proveedores de IA", icon: <Bot {...NAV_ICON} />, tint: "#5e5ce6" },
  { key: "models", label: "Modelos", icon: <Download {...NAV_ICON} />, tint: "#34c759" },
  { key: "permissions", label: "Permisos", icon: <ShieldCheck {...NAV_ICON} />, tint: "#0a84ff" },
  { key: "about", label: "Acerca de", icon: <Info {...NAV_ICON} />, tint: "#8e8e93" },
];
const REQUIRED_PERMISSIONS = new Set(["microphone", "systemAudio"]);

export function SettingsContainer({ onReplayOnboarding }: { onReplayOnboarding?: () => void } = {}) {
  const api = useApi();
  const [section, setSection] = useState<SectionKey>("general");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const { permissions, refresh: refreshPermissions } = usePermissions(section === "permissions");
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
    void api.voiceprintsList().then(setVoiceprints);
    void api.modelsStatus().then(setModels);
    void api.appInfo().then(setInfo);
  }, [api]);

  // «Cambios guardados» se retira solo.
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(id);
  }, [message]);

  useApiEvent("model:download", (d) => {
    setDownloads((prev) => ({ ...prev, [d.name]: d }));
    if (d.done) void api.modelsStatus().then((m) => setModels([...m]));
  });

  const download = (name: string) => {
    setDownloads((prev) => ({ ...prev, [name]: { name, fraction: 0, done: false, error: null } }));
    api.modelsDownload(name).catch((e: unknown) => setDownloads((prev) => ({ ...prev, [name]: { name, fraction: 0, done: false, error: errorMessage(e) } })));
  };

  if (!draft || !saved) return <p className="loading">Cargando…</p>;
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
        const target = existing ?? createFromPreset(type === "claudeCli" ? "claudeCode" : "codex", providers);
        if (target.kind.type === "claudeCli" || target.kind.type === "codexCli") {
          target.kind.binaryPath = path;
          target.kind.extraEnv = { ...target.kind.extraEnv, ...env };
        }
        if (!existing) providers = [...providers, target];
      }
      return { ...d, llm: { ...d.llm, providers } };
    });
  };

  const needsAttention = permissions.some((p) => REQUIRED_PERMISSIONS.has(p.kind) && p.status === "denied");

  return (
    <div className="settings">
      <aside className="settings-nav">
        <h1>Ajustes</h1>
        <nav aria-label="Secciones de ajustes">
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" className={`settings-nav-item${section === s.key ? " settings-nav-active" : ""}`} aria-current={section === s.key ? "page" : undefined} onClick={() => setSection(s.key)}>
              <span className="settings-nav-icon" style={{ ["--c" as string]: s.tint }} aria-hidden>
                {s.icon}
              </span>
              {s.label}
              {s.key === "permissions" && needsAttention ? <span className="dot dot-danger settings-nav-alert" aria-hidden /> : null}
            </button>
          ))}
        </nav>
      </aside>
      <div className="page settings-pane">
        <div className="page-body">
          {section === "general" ? (
            <GeneralSection
              user={draft.user}
              cleanup={draft.cleanup}
              onCleanup={(cleanup) => setDraft({ ...draft, cleanup })}
              transcription={draft.transcription}
              onUser={(user) => setDraft({ ...draft, user })}
              onTranscription={(transcription) => setDraft({ ...draft, transcription })}
              voiceprints={voiceprints}
              onReplayOnboarding={onReplayOnboarding}
              onForget={(id) => void api.voiceprintDelete(id).then(() => api.voiceprintsList().then((v) => setVoiceprints([...v])))}
            />
          ) : null}
          {section === "recording" ? (
            <RecordingSection autoStop={draft.autoStop} recording={draft.recording} onAutoStop={(autoStop) => setDraft({ ...draft, autoStop })} onRecording={(recording) => setDraft({ ...draft, recording })} />
          ) : null}
          {section === "detection" ? <DetectionSection value={draft.detection} onChange={(detection) => setDraft({ ...draft, detection })} /> : null}
          {section === "screen" ? <ScreenSection value={draft.screen} onChange={(screen) => setDraft({ ...draft, screen })} /> : null}
          {section === "providers" ? (
            <ProvidersSection
              llm={draft.llm}
              tests={tests}
              onChange={(llm) => setDraft({ ...draft, llm })}
              onTest={(id) => void testProvider(id)}
              onDetect={() => void detect()}
              onSecretSet={(id, value) => api.secretSet(id, value)}
              onSecretDelete={(id) => api.secretDelete(id)}
            />
          ) : null}
          {section === "models" ? <ModelsSection models={models} downloads={downloads} onDownload={download} /> : null}
          {section === "permissions" ? (
            <PermissionsSection permissions={permissions} onRequest={(k) => void api.permissionsRequest(k).then(refreshPermissions)} onOpen={(k) => void api.openSystemSettings(k)} onRefresh={refreshPermissions} />
          ) : null}
          {section === "about" ? <AboutSection info={info} /> : null}
        </div>
      </div>
      {dirty || message ? (
        <div className="save-dock">
          <div className={`save-bar glass${dirty ? "" : " save-bar-toast"}`}>
            <span role={message ? "status" : undefined} className="save-text">
              {message ?? "Tienes cambios sin guardar"}
            </span>
            {dirty ? (
              <>
                <Button small capsule variant="ghost" onClick={() => setDraft(structuredClone(saved))}>
                  Descartar
                </Button>
                <Button small capsule variant="primary" onClick={() => void save()}>
                  Guardar cambios
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
