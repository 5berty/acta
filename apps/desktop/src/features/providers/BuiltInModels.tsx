import { Cpu, Download, Pause, Play, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { HardwareInfo, LocalLlmDownload, LocalLlmStatus, LocalModelStatus, ProviderTestResult } from "../../api";
import { useApi, useApiEvent } from "../../app/ApiContext";
import { Badge, Button, IconButton, ProgressBar, Spinner, StatusDot, errorMessage } from "../../shared/ui/ui";

const GB = 1e9;
const GIB = 1024 ** 3;
/** "5,7 GB": tamaños en disco, en decimal como Finder. */
export const formatGb = (bytes: number): string => `${(bytes / GB).toFixed(1).replace(".", ",")} GB`;
const ramGb = (hw: HardwareInfo): number => Math.round(hw.ramBytes / GIB);

export interface BuiltInState {
  /** `null` mientras se pregunta al Mac. */
  status: LocalLlmStatus | null;
  /** Último evento de descarga de cada modelo. */
  progress: Record<string, LocalLlmDownload | undefined>;
  tests: Record<string, ProviderTestResult | "pending" | undefined>;
  download(modelId: string): void;
  pause(modelId: string): void;
  remove(modelId: string): void;
  test(modelId: string): void;
}

/** Estado del modelo local integrado: catálogo, descargas en vivo y pruebas. */
export function useBuiltInModels(): BuiltInState {
  const api = useApi();
  const [status, setStatus] = useState<LocalLlmStatus | null>(null);
  const [progress, setProgress] = useState<BuiltInState["progress"]>({});
  const [tests, setTests] = useState<BuiltInState["tests"]>({});

  const refresh = useCallback(() => void api.localLlmStatus().then(setStatus, () => setStatus(null)), [api]);
  useEffect(refresh, [refresh]);

  useApiEvent("localmodel:download", (e) => {
    setProgress((prev) => ({ ...prev, [e.modelId]: e }));
    if (e.done) refresh();
  });

  const fail = (modelId: string, e: unknown) =>
    setProgress((prev) => ({ ...prev, [modelId]: { modelId, stage: "done", receivedBytes: 0, totalBytes: 0, fraction: 0, done: true, error: errorMessage(e) } }));

  return {
    status,
    progress,
    tests,
    download: (modelId) => {
      setProgress((prev) => ({ ...prev, [modelId]: { modelId, stage: "model", receivedBytes: 0, totalBytes: 0, fraction: 0, done: false, error: null } }));
      api.localLlmDownload(modelId).catch((e: unknown) => fail(modelId, e));
    },
    pause: (modelId) => void api.localLlmCancel(modelId),
    remove: (modelId) => {
      setProgress((prev) => ({ ...prev, [modelId]: undefined }));
      setTests((prev) => ({ ...prev, [modelId]: undefined }));
      api.localLlmDelete(modelId).then(refresh, (e: unknown) => fail(modelId, e));
    },
    test: (modelId) => {
      setTests((prev) => ({ ...prev, [modelId]: "pending" }));
      api.localLlmTest(modelId).then(
        (r) => setTests((prev) => ({ ...prev, [modelId]: r })),
        (e: unknown) => setTests((prev) => ({ ...prev, [modelId]: { ok: false, message: errorMessage(e), latencyMs: null } })),
      );
    },
  };
}

const TIER: Record<LocalModelStatus["model"]["tier"], string> = { tiny: "Ligero", medium: "Equilibrado", large: "Avanzado" };

/** Por qué un nivel no se puede descargar, o un aviso si va justo. */
function fitNote(m: LocalModelStatus, hw: HardwareInfo): { text: string; blocked: boolean } | null {
  switch (m.fit) {
    case "tooBig":
      return { blocked: true, text: `Necesita ${m.model.minRamGb} GB de memoria y tu Mac tiene ${ramGb(hw)}.` };
    case "noDisk":
      return { blocked: true, text: `No cabe en el disco: ocupa ${formatGb(m.model.sizeBytes)} y hay que dejar 2 GB libres.` };
    case "tight":
      return { blocked: false, text: hw.appleSilicon ? "Funcionará, pero dejará poca memoria para el resto de apps." : "En un Mac con Intel irá muy lento." };
    default:
      return null;
  }
}

function stageText(d: LocalLlmDownload, m: LocalModelStatus): string {
  const pct = `${Math.round(d.fraction * 100)} %`;
  if (d.stage === "runtime") return "Preparando el motor (llama.cpp)…";
  if (d.stage === "verifying") return "Comprobando la descarga…";
  if (d.totalBytes === 0) return "Conectando…";
  return `${pct} · ${formatGb(d.receivedBytes)} de ${formatGb(m.model.sizeBytes)}`;
}

interface Props {
  state: BuiltInState;
  /** Modelo que ya escribe las actas, si es uno integrado. */
  inUse?: string | null;
  /** «Usar» en Ajustes, «Elegir» en la bienvenida. */
  verb?: string;
  onUse(modelId: string): void;
}

function ModelRow({ m, hw, state, inUse, verb, onUse }: { m: LocalModelStatus; hw: HardwareInfo } & Required<Pick<Props, "verb">> & Pick<Props, "state" | "inUse" | "onUse">) {
  const { model } = m;
  const d = state.progress[model.id];
  const running = !!d && !d.done;
  const failed = d?.done && d.error ? d.error : null;
  const note = fitNote(m, hw);
  const result = state.tests[model.id];
  const using = inUse === model.id && m.downloaded;
  const resume = !m.downloaded && m.partialBytes > 0;

  return (
    <li aria-label={model.name} className={`row builtin-row${note?.blocked ? " builtin-blocked" : ""}`} aria-disabled={note?.blocked || undefined}>
      <span className="builtin-tier" data-tier={model.tier} aria-hidden>
        {model.params}
      </span>
      <div className="row-text">
        <span className="row-label">
          {model.name}
          <span className="builtin-kind">{TIER[model.tier]}</span>
          {m.recommended ? <Badge tone="accent">Recomendado para tu Mac</Badge> : null}
          {using ? <Badge tone="ok">En uso</Badge> : null}
        </span>
        <span className="row-hint">{model.description}</span>
        <dl className="builtin-facts">
          <div>
            <dt>En disco</dt>
            <dd className="num">{formatGb(model.sizeBytes)}</dd>
          </div>
          <div>
            <dt>Memoria</dt>
            <dd className="num">≈ {formatGb(model.ramNeededBytes)}</dd>
          </div>
          <div>
            <dt>Velocidad</dt>
            <dd className="num">≈ {m.expectedTokensPerS} tokens/s</dd>
          </div>
          <div>
            <dt>Licencia</dt>
            <dd>{model.license}</dd>
          </div>
        </dl>
        {note ? (
          <span className={`builtin-note${note.blocked ? "" : " builtin-note-warn"}`}>
            <StatusDot tone={note.blocked ? "neutral" : "warn"} />
            {note.text}
          </span>
        ) : null}
        {running ? (
          <span className="model-progress">
            <ProgressBar fraction={d.stage === "model" ? d.fraction : d.stage === "verifying" ? 1 : 0} label={`Descargando ${model.name}`} />
            <span className="num">{stageText(d, m)}</span>
          </span>
        ) : null}
        {resume && !running && !failed ? <span className="row-hint num">En pausa · {formatGb(m.partialBytes)} de {formatGb(model.sizeBytes)} descargados</span> : null}
        {failed ? (
          <span className={d?.error?.includes("en pausa") ? "row-hint" : "error"} role="status">
            {failed}
          </span>
        ) : null}
        {result === "pending" ? (
          <span className="test-result muted">
            <Spinner /> Cargando el modelo…
          </span>
        ) : result ? (
          <span role="status" className={`test-result ${result.ok ? "ok" : "error"}`}>
            <StatusDot tone={result.ok ? "ok" : "danger"} />
            {result.ok ? `Funciona${result.latencyMs != null ? ` · respondió en ${(result.latencyMs / 1000).toFixed(1).replace(".", ",")} s` : ""}` : result.message}
          </span>
        ) : null}
      </div>
      <div className="row-control builtin-actions">
        {m.downloaded ? (
          <>
            <Button small capsule disabled={result === "pending"} aria-label={`Probar ${model.name}`} onClick={() => state.test(model.id)}>
              Probar
            </Button>
            <Button small capsule variant={using ? "secondary" : "primary"} disabled={using} aria-label={`${verb} ${model.name}`} onClick={() => onUse(model.id)}>
              {using ? "En uso" : verb}
            </Button>
            <IconButton
              small
              label={`Borrar ${model.name}`}
              title={`Borrar del disco (libera ${formatGb(model.sizeBytes)})`}
              onClick={() => {
                if (window.confirm(`¿Borrar ${model.name} de tu Mac? Se liberan ${formatGb(model.sizeBytes)}. Puedes volver a descargarlo cuando quieras.`)) state.remove(model.id);
              }}
            >
              <Trash2 size={14} strokeWidth={2} aria-hidden />
            </IconButton>
          </>
        ) : running ? (
          <Button small capsule aria-label={`Pausar la descarga de ${model.name}`} icon={<Pause size={12} strokeWidth={2.4} aria-hidden />} onClick={() => state.pause(model.id)}>
            Pausar
          </Button>
        ) : (
          <Button
            small
            capsule
            variant={m.recommended || resume ? "primary" : "secondary"}
            disabled={!!note?.blocked}
            aria-label={`${resume ? "Reanudar la descarga de" : "Descargar"} ${model.name}`}
            icon={resume ? <Play size={12} strokeWidth={2.4} aria-hidden /> : <Download size={12} strokeWidth={2.4} aria-hidden />}
            onClick={() => state.download(model.id)}
          >
            {resume ? "Reanudar" : "Descargar"}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Modelo local integrado: acta descarga un modelo y lo ejecuta ella misma.
 * Tres niveles; se recomienda uno según la memoria y el chip de este Mac y se
 * bloquean los que no caben.
 */
export function BuiltInModels({ state, inUse = null, verb = "Usar", onUse }: Props) {
  const { status } = state;
  if (!status) {
    return (
      <p className="card card-empty builtin-loading">
        <Spinner /> Mirando qué puede ejecutar tu Mac…
      </p>
    );
  }
  const hw = status.hardware;
  return (
    <div className="builtin" role="group" aria-label="Modelo local integrado">
      <p className="builtin-mac">
        <Cpu size={14} strokeWidth={2} aria-hidden />
        <span>
          Tu Mac: <strong>{hw.chip}</strong> · <span className="num">{ramGb(hw)} GB</span> de memoria
          {hw.freeDiskBytes != null ? (
            <>
              {" "}
              · <span className="num">{formatGb(hw.freeDiskBytes)}</span> libres
            </>
          ) : null}
        </span>
      </p>
      <ul className="plain group">
        {status.models.map((m) => (
          <ModelRow key={m.model.id} m={m} hw={hw} state={state} inUse={inUse} verb={verb} onUse={onUse} />
        ))}
      </ul>
      <p className="group-foot">
        Opcional. acta descarga el modelo una vez (se puede pausar y reanudar) y lo ejecuta en tu Mac con llama.cpp: sin Ollama, sin cuenta y sin conexión. Ni el audio ni el texto de la reunión salen del equipo. Se
        carga en memoria solo mientras se usa.
      </p>
    </div>
  );
}
