import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CliDetection, ModelDownload, ModelStatus, ProviderTestResult, Settings } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { Button, errorMessage } from "../../shared/ui/ui";
import { useBuiltInModels } from "../providers/BuiltInModels";
import { useLocalDetection } from "../providers/LocalModels";
import { NAN_REFERRAL_URL } from "../providers/presets";
import { PERMISSION_LABEL, PERMISSION_REQUIRED } from "../settings/PermissionsSection";
import { usePermissions } from "../settings/usePermissions";
import { AboutStep, type AboutState } from "./AboutStep";
import { AiStep } from "./AiStep";
import { aiProblem, applyAi, initialAi, secretIdFor, type AiState } from "./aiChoice";
import { DetectionStep, DoneStep, ModelsStep, PermissionsStep, WelcomeStep, type SummaryLine } from "./steps";

const STEPS = ["Bienvenida", "Sobre ti", "Permisos", "Transcripción", "Inteligencia artificial", "Detección", "Listo"] as const;
const ABOUT = 1;
const PERMISSIONS = 2;
const MODELS = 3;
const AI = 4;
const DETECTION = 5;
const LAST = STEPS.length - 1;

/** Bienvenida de primer arranque. Cada paso guarda lo suyo al avanzar; se puede saltar en cualquier momento. */
export function Onboarding({ onClose }: { onClose(): void }) {
  const api = useApi();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [saved, setSaved] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [about, setAbout] = useState<AboutState | null>(null);
  // Lo que se propuso desde macOS, para decir de dónde sale mientras no se cambie.
  const [fromSystem, setFromSystem] = useState<{ name: string | null; language: string | null }>({ name: null, language: null });
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<Record<string, ModelDownload>>({});
  const [cli, setCli] = useState<CliDetection | null | undefined>(undefined);
  const [ai, setAi] = useState<AiState | null>(null);
  const [detection, setDetection] = useState<Settings["detection"] | null>(null);
  const [autoStop, setAutoStop] = useState<Settings["autoStop"] | null>(null);
  const [test, setTest] = useState<ProviderTestResult | "pending" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const { detection: local, refresh: refreshLocal, error: localError } = useLocalDetection();
  const builtIn = useBuiltInModels();
  const savedRef = useRef<Settings | null>(null);
  savedRef.current = saved;

  // Permisos en vivo: al volver de Ajustes del Sistema, con `permissions:changed` y cada pocos segundos en su paso.
  const { permissions, refresh: refreshPermissions, error: permissionsLoadError } = usePermissions(step === PERMISSIONS);
  const detectCli = useCallback(() => {
    setCli(undefined);
    api.llmCliDetect().then(setCli, () => setCli(null));
  }, [api]);

  const load = useCallback(() => {
    setLoadError(null);
    // El perfil de macOS solo sirve para proponer: si no se puede leer, los campos salen vacíos.
    const profile = api.systemProfile().catch(() => null);
    Promise.all([api.settingsGet(), profile]).then(
      ([s, p]) => {
        const name = !s.user.displayName.trim() && p?.fullName?.trim() ? p.fullName.trim() : null;
        // «Automático» solo se cambia por el idioma del Mac la primera vez; después es una elección.
        const language = s.transcription.language === "auto" && !s.onboarding.completed && p && p.meetingLanguage !== "auto" ? p.meetingLanguage : null;
        setSaved(s);
        setAbout({ name: name ?? s.user.displayName, aliases: s.user.aliases, language: language ?? s.transcription.language });
        setFromSystem({ name, language });
        setAi(initialAi(s.llm));
        setDetection(s.detection);
        setAutoStop(s.autoStop);
      },
      (e: unknown) => setLoadError(errorMessage(e)),
    );
  }, [api]);
  const loadModels = useCallback(() => {
    api.modelsStatus().then(
      (m) => {
        setModels([...m]);
        setModelsError(null);
      },
      (e: unknown) => setModelsError(errorMessage(e)),
    );
  }, [api]);

  useEffect(() => {
    load();
    loadModels();
    detectCli();
  }, [load, loadModels, detectCli]);

  useApiEvent("model:download", (d) => {
    setDownloads((prev) => ({ ...prev, [d.name]: d }));
    if (d.done) loadModels();
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

  if (loadError) {
    return (
      <div className="ob-backdrop">
        <div className="ob-drag" data-tauri-drag-region aria-hidden />
        <div role="dialog" aria-modal="true" aria-label="Bienvenida a acta" className="ob-sheet ob-sheet-error glass-thick">
          <p role="alert" className="error">
            No se han podido leer los ajustes: {loadError}
          </p>
          <div className="cluster">
            <Button capsule variant="ghost" onClick={onClose}>
              Cerrar
            </Button>
            <Button capsule variant="primary" onClick={load}>
              Reintentar
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!saved || !about || !ai || !detection || !autoStop) return null;

  const problem = aiProblem(ai, cli ?? null, cli === undefined);
  const llm = () => applyAi(saved.llm, ai, cli ?? null);

  /** Lo que haya que guardar del paso actual antes de salir de él. */
  const leave = async (): Promise<boolean> => {
    if (step === ABOUT) return (await commit({ user: { displayName: about.name.trim(), aliases: about.aliases }, transcription: { ...saved.transcription, language: about.language } })) !== null;
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

  /** Pedir un permiso, abrir Ajustes del Sistema o un enlace: si falla, se dice. */
  const permission = (run: Promise<unknown>, what: string) => {
    setPermissionError(null);
    run.then(refreshPermissions, (e: unknown) => setPermissionError(`${what}: ${errorMessage(e)}`));
  };
  const openUrl = (url: string) => {
    api.openExternalUrl(url).then(
      () => setError(null),
      (e: unknown) => setError(`No se ha podido abrir el navegador: ${errorMessage(e)}`),
    );
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
          {step === ABOUT ? <AboutStep about={about} onAbout={setAbout} systemName={fromSystem.name} systemLanguage={fromSystem.language} /> : null}
          {step === PERMISSIONS ? (
            <PermissionsStep
              permissions={permissions}
              error={permissionError ?? permissionsLoadError}
              onRequest={(k) => permission(api.permissionsRequest(k), "No se ha podido pedir el permiso")}
              onOpen={(k) => permission(api.openSystemSettings(k), "No se ha podido abrir Ajustes del Sistema")}
              onRefresh={refreshPermissions}
            />
          ) : null}
          {step === MODELS ? <ModelsStep models={models} downloads={downloads} onDownload={download} error={modelsError} onRetry={loadModels} /> : null}
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
              localError={localError}
              builtIn={builtIn}
              onRefreshLocal={refreshLocal}
              onOpenUrl={openUrl}
              onCreateNanAccount={() => openUrl(NAN_REFERRAL_URL)}
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
