import { ExternalLink, RotateCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { LocalDetection, LocalRuntime } from "../../api";
import { useApi } from "../../app/ApiContext";
import { BrandLogo } from "../../shared/brand/BrandLogo";
import { Badge, Button, Disclosure, Select, Spinner, StatusDot, errorMessage } from "../../shared/ui/ui";
import { PRESETS } from "./presets";

export type LocalKind = "ollama" | "lmStudio";

/** Busca Ollama y LM Studio en este Mac. `null` mientras se pregunta. */
export function useLocalDetection(): { detection: LocalDetection | null; refresh(): void; error: string | null } {
  const api = useApi();
  const [detection, setDetection] = useState<LocalDetection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setDetection(null);
    setError(null);
    api.llmDetectLocal().then(setDetection, (e: unknown) => {
      // No se pudo mirar: no es lo mismo que «no está en marcha», así que se dice.
      setDetection({ ollama: off(PRESETS.ollama.baseUrl), lmStudio: off(PRESETS.lmStudio.baseUrl) });
      setError(errorMessage(e));
    });
  }, [api]);
  useEffect(refresh, [refresh]);
  return { detection, refresh, error };
}
const off = (baseUrl = ""): LocalRuntime => ({ running: false, baseUrl, models: [] });

const HOW: Record<LocalKind, { site: string; url: string; steps: React.ReactNode[] }> = {
  ollama: {
    site: "ollama.com",
    url: "https://ollama.com/download",
    steps: [
      "Descarga Ollama e instálalo como cualquier app.",
      <>
        Abre Terminal y descarga un modelo, por ejemplo: <code className="selectable">ollama pull gemma3</code>
      </>,
      "Deja Ollama abierto y pulsa «Volver a buscar».",
    ],
  },
  lmStudio: {
    site: "lmstudio.ai",
    url: "https://lmstudio.ai",
    steps: ["Descarga LM Studio e instálalo.", "Dentro de la app, busca y descarga un modelo.", "Activa el servidor local (pestaña Developer, «Start Server») y pulsa «Volver a buscar»."],
  },
};

interface Props {
  detection: LocalDetection | null;
  /** No se pudo buscar en este Mac. */
  error?: string | null;
  /** Modelo que ya se está usando de cada servidor, si lo hay. */
  inUse?: Partial<Record<LocalKind, string>>;
  /** Texto del botón: «Usar» en Ajustes, «Elegir» en la bienvenida. */
  verb?: string;
  onUse(kind: LocalKind, model: string, baseUrl: string): void;
  onRefresh(): void;
  onOpenUrl(url: string): void;
}

function statusText(rt: LocalRuntime): string {
  if (!rt.running) return "No está en marcha";
  if (rt.models.length === 0) return "En marcha, sin modelos";
  return `En marcha · ${rt.models.length} ${rt.models.length === 1 ? "modelo" : "modelos"}`;
}

function RuntimeRow({ kind, rt, inUse, verb, onUse, onOpenUrl }: { kind: LocalKind; rt: LocalRuntime | null; inUse?: string; verb: string; onUse: Props["onUse"]; onOpenUrl: Props["onOpenUrl"] }) {
  const name = PRESETS[kind].label;
  const how = HOW[kind];
  const [picked, setPicked] = useState<string | null>(null);
  const model = picked && rt?.models.includes(picked) ? picked : inUse && rt?.models.includes(inUse) ? inUse : (rt?.models[0] ?? "");
  const ready = !!rt && rt.running && rt.models.length > 0;
  return (
    <li aria-label={name} className="row local-row">
      <BrandLogo brand={PRESETS[kind].brand!} />
      <div className="row-text">
        <span className="row-label">
          {name}
          {ready && inUse === model ? <Badge tone="accent">En uso</Badge> : null}
        </span>
        <span className="row-hint local-status">
          {rt ? (
            <>
              <StatusDot tone={ready ? "ok" : rt.running ? "warn" : "neutral"} />
              <span>{statusText(rt)}</span>
            </>
          ) : (
            <>
              <Spinner /> Buscando en este Mac…
            </>
          )}
        </span>
        {rt && !ready ? (
          <Disclosure label={rt.running ? "Cómo descargar un modelo" : "Cómo instalarlo"} ariaLabel={`Cómo instalar ${name}`}>
            <ol className="how-list">
              {how.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <div>
              <Button small capsule aria-label={`Abrir ${how.site}`} title="Se abre en tu navegador" icon={<ExternalLink size={12} strokeWidth={2.2} aria-hidden />} onClick={() => onOpenUrl(how.url)}>
                Abrir {how.site}
              </Button>
            </div>
          </Disclosure>
        ) : null}
      </div>
      {ready ? (
        <div className="row-control">
          <Select label={`Modelo de ${name}`} value={model} onChange={(e) => setPicked(e.target.value)}>
            {rt.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Button variant={inUse === model ? "secondary" : "primary"} capsule aria-label={`${verb} ${name}`} onClick={() => onUse(kind, model, rt.baseUrl)}>
            {verb}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** Servidores de modelos en este Mac: qué hay en marcha, con qué modelos, y cómo instalarlos si faltan. */
export function LocalModels({ detection, error, inUse = {}, verb = "Usar", onUse, onRefresh, onOpenUrl }: Props) {
  return (
    <div className="local-models">
      <ul className="plain group">
        <RuntimeRow kind="ollama" rt={detection?.ollama ?? null} inUse={inUse.ollama} verb={verb} onUse={onUse} onOpenUrl={onOpenUrl} />
        <RuntimeRow kind="lmStudio" rt={detection?.lmStudio ?? null} inUse={inUse.lmStudio} verb={verb} onUse={onUse} onOpenUrl={onOpenUrl} />
      </ul>
      <div className="group-foot local-foot">
        {error ? (
          <span role="alert" className="error">
            No se ha podido buscar Ollama ni LM Studio en este Mac: {error}
          </span>
        ) : (
          <span>Con un modelo local, ni el audio ni el texto de la reunión salen de tu Mac.</span>
        )}
        <Button small capsule variant="ghost" disabled={!detection} icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={onRefresh}>
          Volver a buscar
        </Button>
      </div>
    </div>
  );
}
