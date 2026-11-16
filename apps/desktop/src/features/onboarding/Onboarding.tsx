import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CliDetection, ModelDownload, ModelStatus, PermissionState, ProviderTestResult, Settings } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { Button, errorMessage } from "../../shared/ui/ui";
import { useLocalDetection } from "../providers/LocalModels";
import { NAN_REFERRAL_URL } from "../providers/presets";
import { PERMISSION_LABEL, PERMISSION_REQUIRED } from "../settings/PermissionsSection";
import { AiStep } from "./AiStep";
import { aiProblem, applyAi, initialAi, secretIdFor, type AiState } from "./aiChoice";
import { DetectionStep, DoneStep, ModelsStep, PermissionsStep, WelcomeStep, type SummaryLine } from "./steps";

const STEPS = ["Bienvenida", "Permisos", "Transcripción", "Inteligencia artificial", "Detección", "Listo"] as const;
const PERMISSIONS = 1;
const AI = 3;
const DETECTION = 4;
const LAST = STEPS.length - 1;
/** Mientras se miran los permisos, se vuelve a preguntar cada poco. */
const PERMISSION_POLL_MS = 2_000;

/** Bienvenida de primer arranque. Cada paso guarda lo suyo al avanzar; se puede saltar en cualquier momento. */
export function Onboarding({ onClose }: { onClose(): void }) {
  const api = useApi();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [saved, setSaved] = useState<Settings | null>(null);
  const [permissions, setPermissions] = useState<PermissionState[]>([]);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [downloads, setDownloads] = useState<Record<string, ModelDownload>>({});
  const [cli, setCli] = useState<CliDetection | null | undefined>(undefined);
  const [ai, setAi] = useState<AiState | null>(null);
  const [detection, setDetection] = useState<Settings["detection"] | null>(null);
  const [autoStop, setAutoStop] = useState<Settings["autoStop"] | null>(null);
  const [test, setTest] = useState<ProviderTestResult | "pending" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { detection: local, refresh: refreshLocal } = useLocalDetection();
  const savedRef = useRef<Settings | null>(null);
  savedRef.current = saved;

  const refreshPermissions = useCallback(() => void api.permissionsStatus().then((p) => setPermissions([...p])), [api]);
  const detectCli = useCallback(() => {
    setCli(undefined);
    api.llmCliDetect().then(setCli, () => setCli(null));
  }, [api]);

  useEffect(() => {
    void api.settingsGet().then((s) => {
      setSaved(s);
      setAi(initialAi(s.llm));
      setDetection(s.detection);
      setAutoStop(s.autoStop);
    });
    void api.modelsStatus().then(setModels);
    refreshPermissions();
    detectCli();
  }, [api, refreshPermissions, detectCli]);

  // Permisos en vivo: al volver de Ajustes del Sistema y cada pocos segundos.
  useEffect(() => {
    if (step !== PERMISSIONS) return;
    window.addEventListener("focus", refreshPermissions);
    const id = window.setInterval(refreshPermissions, PERMISSION_POLL_MS);
    return () => {
      window.removeEventListener("focus", refreshPermissions);
      window.clearInterval(id);
    };
  }, [step, refreshPermissions]);

  useApiEvent("model:download", (d) => {
    setDownloads((prev) => ({ ...prev, [d.name]: d }));
    if (d.done) void api.modelsStatus().then((m) => setModels([...m]));
  });

  const download = (name: string) => {
    setDownloads((prev) => ({ ...prev, [name]: { name, fraction: 0, done: false, error: null } }));
    api.modelsDownload(name).catch((e: unknown) => setDownloads((prev) => ({ ...prev, [name]: { name, fraction: 0, done: false, error: errorMessage(e) } })));
  };

  /** Guarda un cambio sobre lo último guardado. */
  const commit = async (patch: Partial<Settings>): Promise<Settings | null> => {
    const base = savedRef.current;
    if (!base) return null;
    try {
      const next = await api.settingsUpdate({ ...base, ...patch });
      savedRef.current = next;
      setSaved(next);
      setError(null);
      return next;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  };

  if (!saved || !ai || !detection || !autoStop) return null;

  const problem = aiProblem(ai, cli ?? null, cli === undefined);
  const llm = () => applyAi(saved.llm, ai, cli ?? null);

  /** Lo que haya que guardar del paso actual antes de salir de él. */
  const leave = async (): Promise<boolean> => {
    if (step === AI && ai.choice && !problem) return (await commit({ llm: llm() })) !== null;
    if (step === DETECTION) return (await commit({ detection, autoStop })) !== null;
    return true;
  };
  const go = async (to: number) => {
    if (to > step && !(await leave())) return;
    setDir(to > step ? "fwd" : "back");
    setStep(to);
  };
  const finish = async () => {
    if (await commit({ onboarding: { completed: true } })) onClose();
  };

  const runTest = async () => {
    setTest("pending");
    const s = await commit({ llm: llm() });
    const id = s?.llm.minutesProvider;
    if (!id) return setTest(null);
    try {
      setTest(await api.llmProviderTest(id));
    } catch (e) {
      setTest({ ok: false, message: errorMessage(e), latencyMs: null });
    }
  };

  const summary = (): SummaryLine[] => {
    const missing = permissions.filter((p) => PERMISSION_REQUIRED[p.kind] && p.status !== "granted");
    const provider = saved.llm.providers.find((p) => p.enabled && p.id === saved.llm.minutesProvider);
    const downloading = models.some((m) => !m.downloaded && downloads[m.name] && !downloads[m.name]!.done && !downloads[m.name]!.error);
    const modelsOk = models.length > 0 && models.every((m) => m.downloaded);
    return [
      missing.length === 0
        ? { ok: true, text: "Micrófono y audio del sistema concedidos" }
        : { ok: false, text: `Falta el permiso de ${missing.map((p) => PERMISSION_LABEL[p.kind].toLowerCase()).join(" y de ")}: sin él no se puede grabar` },
      modelsOk ? { ok: true, text: "Modelos de voz descargados" } : { ok: false, text: downloading ? "Los modelos de voz se están descargando" : "Faltan modelos de voz por descargar (Ajustes › Modelos)" },
      provider ? { ok: true, text: `Actas con ${provider.label.replace(/ \(CLI\)$/, "")}` } : { ok: false, text: "Sin proveedor de IA: habrá transcripción, pero no acta ni chat" },
      saved.detection.enabled ? { ok: true, text: "acta te avisará cuando empiece una reunión" } : { ok: true, text: "Detección desactivada: grabarás a mano con «Grabar ahora»" },
    ];
  };

  const blocked = step === AI && !!problem;
  const primary = step === 0 ? "Empezar" : step === LAST ? "Empezar a usar acta" : "Continuar";

  return (
    <div className="ob-backdrop">
      <div className="ob-drag" data-tauri-drag-region aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Bienvenida a acta" className="ob-sheet glass-thick">
        <div className="ob-top">
          <ol className="plain ob-steps" aria-label="Pasos">
            {STEPS.map((name, i) => (
              <li key={name} className={`ob-dot${i < step ? " ob-dot-done" : ""}`} aria-current={i === step ? "step" : undefined} title={name}>
                <span className="sr-only">{name}</span>
              </li>
            ))}
          </ol>
          <span className="ob-step-name" aria-hidden>
            {step + 1} de {STEPS.length} · {STEPS[step]}
          </span>
          {step < LAST ? (
            <Button small capsule variant="ghost" title="Puedes volver a verla en Ajustes › General" onClick={() => void finish()}>
              Saltar
            </Button>
          ) : null}
        </div>

        <div className="ob-body" data-dir={dir} key={step}>
          {step === 0 ? <WelcomeStep /> : null}
          {step === 1 ? <PermissionsStep permissions={permissions} onRequest={(k) => void api.permissionsRequest(k).then(refreshPermissions)} onOpen={(k) => void api.openSystemSettings(k)} onRefresh={refreshPermissions} /> : null}
          {step === 2 ? <ModelsStep models={models} downloads={downloads} onDownload={download} /> : null}
          {step === AI ? (
            <AiStep
              ai={ai}
              onAi={(next) => {
                setAi(next);
                setTest(null);
              }}
              cli={cli}
              onDetectCli={detectCli}
              local={local}
              onRefreshLocal={refreshLocal}
              onOpenUrl={(url) => void api.openExternalUrl(url)}
              onCreateNanAccount={() => void api.openExternalUrl(NAN_REFERRAL_URL)}
              onSecret={(value) => api.secretSet(secretIdFor(saved.llm, ai) ?? "custom", value)}
              listModels={(baseUrl, withKey) => api.llmListModels(baseUrl, withKey ? secretIdFor(saved.llm, ai) : null)}
              problem={problem}
              test={test}
              onTest={() => void runTest()}
            />
          ) : null}
          {step === DETECTION ? <DetectionStep detection={detection} autoStop={autoStop} onDetection={setDetection} onAutoStop={setAutoStop} /> : null}
          {step === LAST ? <DoneStep summary={summary()} /> : null}
        </div>

        <div className="ob-nav">
          {step > 0 ? (
            <Button size="lg" capsule variant="ghost" icon={<ArrowLeft size={15} strokeWidth={2.2} aria-hidden />} onClick={() => void go(step - 1)}>
              Atrás
            </Button>
          ) : null}
          {error ? (
            <span role="alert" className="error ob-error">
              {error}
            </span>
          ) : (
            <span className="spacer" />
          )}
          <Button size="lg" capsule variant="primary" disabled={blocked} onClick={() => void (step === LAST ? finish() : go(step + 1))}>
            {primary}
            {step < LAST ? <ArrowRight size={15} strokeWidth={2.3} aria-hidden /> : null}
          </Button>
        </div>
      </div>
    </div>
  );
}
