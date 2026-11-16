import type { ModelDownload, ModelStatus } from "../../api";
import { Button, ProgressBar } from "../../shared/ui/ui";
import { Section } from "./fields";

const LABEL: Record<string, string> = {
  asr: "Transcripción",
  diarizer: "Diarización",
  vad: "Detección de voz",
};

const formatBytes = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

interface Props {
  models: ModelStatus[];
  downloads: Record<string, ModelDownload>;
  onDownload(name: string): void;
}

export function ModelsSection({ models, downloads, onDownload }: Props) {
  return (
    <Section title="Modelos" hint="Modelos locales de voz. Se descargan una vez y todo se procesa en tu Mac.">
      <ul className="plain">
        {models.map((m) => {
          const label = LABEL[m.name] ?? m.name;
          const d = downloads[m.name];
          const running = !!d && !d.done && !d.error;
          return (
            <li key={m.name} aria-label={label} className="voiceprint">
              <span>
                {label}{" "}
                <span className="muted">
                  · {m.downloaded ? `Descargado${m.bytes != null ? ` (${formatBytes(m.bytes)})` : ""}` : "Sin descargar"}
                </span>
              </span>
              {running ? <ProgressBar fraction={d.fraction} label={`Descargando ${label}`} /> : null}
              {d?.error ? (
                <span className="error" role="alert">
                  {label}: error ({d.error})
                </span>
              ) : null}
              <Button small disabled={running} aria-label={`Descargar ${label}`} onClick={() => onDownload(m.name)}>
                {m.downloaded ? "Volver a descargar" : "Descargar"}
              </Button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
