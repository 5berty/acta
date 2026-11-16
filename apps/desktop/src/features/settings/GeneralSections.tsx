import { useState } from "react";
import type { AppRule, ModelDownload, Platform, Settings, VoiceprintSummary } from "../../api";
import { Button, ProgressBar } from "../../shared/ui/ui";
import { Field, NumberField, Section, Toggle } from "./fields";

interface SectionProps<K extends keyof Settings> {
  value: Settings[K];
  onChange(v: Settings[K]): void;
}

const MIN = 60_000;
const HOUR = 3_600_000;

export function TranscriptionSection({
  value,
  onChange,
  downloads,
  voiceprints,
  onForget,
}: SectionProps<"transcription"> & { downloads: Record<string, ModelDownload>; voiceprints: VoiceprintSummary[]; onForget(id: string): void }) {
  return (
    <Section title="Transcripción" hint="Todo se procesa en tu Mac. Los modelos se descargan la primera vez que hacen falta.">
      <div className="three-col">
        <Field label="Idioma">
          <select aria-label="Idioma" value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value })}>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="auto">Detectar</option>
          </select>
        </Field>
        <NumberField label="Similitud mínima de voz (%)" value={value.voiceprintMinSimilarityPct} onChange={(n) => onChange({ ...value, voiceprintMinSimilarityPct: n })} />
      </div>
      <Toggle label="Separar hablantes" hint="Diariza la pista de los demás." checked={value.diarization} onChange={(diarization) => onChange({ ...value, diarization })} />
      <Toggle label="Transcripción en vivo" hint="Vista previa mientras grabas y detección de momentos importantes." checked={value.livePreview} onChange={(livePreview) => onChange({ ...value, livePreview })} />
      <h3>Modelos</h3>
      {Object.keys(downloads).length === 0 ? <p className="muted">Sin descargas en curso.</p> : null}
      <ul className="plain">
        {Object.values(downloads).map((d) => (
          <li key={d.name}>
            {d.error ? (
              <span className="error" role="alert">
                {d.name}: error ({d.error})
              </span>
            ) : d.done ? (
              <span className="ok">{d.name}: listo</span>
            ) : (
              <>
                <span>Descargando {d.name}</span>
                <ProgressBar fraction={d.fraction} label={`Descargando ${d.name}`} />
              </>
            )}
          </li>
        ))}
      </ul>
      <h3>Voces recordadas</h3>
      {voiceprints.length === 0 ? <p className="muted">Todavía no recuerdo ninguna voz. Confirma un nombre en un transcript para guardarla.</p> : null}
      <ul className="plain">
        {voiceprints.map((v) => (
          <li key={v.id} className="voiceprint">
            <span>
              {v.displayName} <span className="muted">· {v.meetings} reuniones</span>
            </span>
            <Button small variant="ghost" aria-label={`Olvidar la voz de ${v.displayName}`} onClick={() => onForget(v.id)}>
              Olvidar
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function AutoStopSection({ value, onChange }: SectionProps<"autoStop">) {
  return (
    <Section title="Parada automática" hint="Evita grabaciones eternas cuando la llamada acaba y nadie pulsa parar.">
      <div className="three-col">
        <NumberField label="Minutos de silencio antes de preguntar" value={value.silencePromptAfterMs / MIN} onChange={(n) => onChange({ ...value, silencePromptAfterMs: Math.round(n * MIN) })} />
        <NumberField label="Minutos sin respuesta antes de parar" value={value.autoStopAfterUnansweredMs / MIN} onChange={(n) => onChange({ ...value, autoStopAfterUnansweredMs: Math.round(n * MIN) })} />
        <NumberField label="Duración máxima (horas)" value={value.maxDurationMs / HOUR} step={0.5} onChange={(n) => onChange({ ...value, maxDurationMs: Math.round(n * HOUR) })} />
      </div>
      <NumberField label="Umbral de silencio (dBFS)" value={value.silenceThresholdDbfs} min={-90} onChange={(n) => onChange({ ...value, silenceThresholdDbfs: n })} />
    </Section>
  );
}

const PLATFORMS: { v: Platform; l: string }[] = [
  { v: "teams", l: "Teams" },
  { v: "meet", l: "Google Meet" },
  { v: "zoom", l: "Zoom" },
  { v: "slack", l: "Slack" },
  { v: "other", l: "Otra" },
];

export function DetectionSection({ value, onChange }: SectionProps<"detection">) {
  const [bundleId, setBundleId] = useState("");
  const [platform, setPlatform] = useState<Platform>("teams");
  const [browser, setBrowser] = useState(false);
  const add = () => {
    const id = bundleId.trim();
    if (!id || value.rules.some((r) => r.bundleId === id)) return;
    const rule: AppRule = { bundleId: id, platform, isBrowser: browser };
    onChange({ ...value, rules: [...value.rules, rule] });
    setBundleId("");
  };
  return (
    <Section title="Detección de reuniones" hint="Solo se detectan las apps de esta lista blanca; el resto nunca dispara una pregunta.">
      <Toggle label="Detectar reuniones automáticamente" checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} />
      <ul className="plain rules">
        {value.rules.map((r) => (
          <li key={r.bundleId} className="rule">
            <code>{r.bundleId}</code>
            <span className="muted">
              {PLATFORMS.find((p) => p.v === r.platform)?.l}
              {r.isBrowser ? " · navegador" : ""}
            </span>
            <Button small variant="ghost" aria-label={`Quitar ${r.bundleId}`} onClick={() => onChange({ ...value, rules: value.rules.filter((x) => x.bundleId !== r.bundleId) })}>
              Quitar
            </Button>
          </li>
        ))}
      </ul>
      <div className="inline-form">
        <input aria-label="Bundle id de la regla nueva" placeholder="com.ejemplo.app" value={bundleId} onChange={(e) => setBundleId(e.target.value)} />
        <select aria-label="Plataforma de la regla nueva" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
          {PLATFORMS.map((p) => (
            <option key={p.v} value={p.v}>
              {p.l}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" aria-label="Es un navegador" checked={browser} onChange={(e) => setBrowser(e.target.checked)} />
          Navegador
        </label>
        <Button small onClick={add}>
          Añadir regla
        </Button>
      </div>
      <Field label="URLs de Meet (una por línea)">
        <textarea
          aria-label="URLs de Meet"
          rows={2}
          defaultValue={value.meetUrlPatterns.join("\n")}
          onBlur={(e) => onChange({ ...value, meetUrlPatterns: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })}
        />
      </Field>
    </Section>
  );
}

export function ScreenSection({ value, onChange }: SectionProps<"screen">) {
  return (
    <Section title="Capturas de pantalla" hint="Desactivado por defecto. Necesita el permiso de Grabación de pantalla.">
      <Toggle
        label="Capturar la pantalla compartida"
        hint="Guarda diapositivas cuando alguien comparte pantalla en Teams."
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      <Toggle label="Borrar las candidatas que no se usen" checked={value.pruneCandidates} onChange={(pruneCandidates) => onChange({ ...value, pruneCandidates })} />
      <Field label="Palabras que disparan una captura (separadas por comas)">
        <input
          aria-label="Palabras clave"
          defaultValue={value.keywords.join(", ")}
          onBlur={(e) => onChange({ ...value, keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })}
        />
      </Field>
    </Section>
  );
}
