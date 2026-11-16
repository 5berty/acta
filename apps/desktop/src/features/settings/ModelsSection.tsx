import { AudioLines, Download, Ear, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { ModelDownload, ModelStatus } from "../../api";
import { Button, ProgressBar, StatusDot } from "../../shared/ui/ui";
import { Group, Section } from "./fields";

export const MODEL_LABEL: Record<string, string> = {
  asr: "Transcripción",
  diarizer: "Separar hablantes",
  vad: "Detección de voz",
};
export const MODEL_WHAT: Record<string, string> = {
  asr: "Convierte el audio en texto.",
  diarizer: "Distingue quién habla en cada momento.",
  vad: "Detecta cuándo hay voz y cuándo silencio.",
};
export const MODEL_ICON: Record<string, ReactNode> = {
  asr: <AudioLines size={16} strokeWidth={1.9} aria-hidden />,
  diarizer: <Users size={16} strokeWidth={1.9} aria-hidden />,
  vad: <Ear size={16} strokeWidth={1.9} aria-hidden />,
};

export const formatBytes = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

interface Props {
  models: ModelStatus[];
  downloads: Record<string, ModelDownload>;
  onDownload(name: string): void;
}

export function ModelsSection({ models, downloads, onDownload }: Props) {
  return (
    <Section title="Modelos" hint="Los modelos de voz viven en tu Mac. Se descargan una sola vez y después todo funciona sin conexión.">
      <div className="settings-group">
        <ul className="plain group">
          {models.map((m) => {
            const label = MODEL_LABEL[m.name] ?? m.name;
            const d = downloads[m.name];
            const running = !!d && !d.done && !d.error;
            return (
              <li key={m.name} aria-label={label} className="row model-row">
                <span className="row-icon-tile" aria-hidden>
                  {MODEL_ICON[m.name] ?? <AudioLines size={16} strokeWidth={1.9} />}
                </span>
                <span className="row-text">
                  <span className="row-label">{label}</span>
                  <span className="row-hint">{MODEL_WHAT[m.name] ?? "Modelo local."}</span>
                  {running ? (
                    <span className="model-progress">
                      <ProgressBar fraction={d.fraction} label={`Descargando ${label}`} />
                      <span className="num">{Math.round(d.fraction * 100)} %</span>
                    </span>
                  ) : null}
                  {d?.error ? (
                    <span className="error" role="alert">
                      No se ha podido descargar: {d.error}
                    </span>
                  ) : null}
                </span>
                <span className="row-control">
                  <span className="model-status">
                    <StatusDot tone={m.downloaded ? "ok" : "neutral"} />
                    <span>{m.downloaded ? `Descargado${m.bytes != null ? ` · ${formatBytes(m.bytes)}` : ""}` : "Sin descargar"}</span>
                  </span>
                  <Button small variant={m.downloaded ? "ghost" : "primary"} capsule disabled={running} aria-label={`Descargar ${label}`} icon={m.downloaded ? null : <Download size={12} strokeWidth={2.4} aria-hidden />} onClick={() => onDownload(m.name)}>
                    {running ? "Descargando…" : m.downloaded ? "Volver a descargar" : "Descargar"}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <Group>
        <div className="row">
          <span className="row-text">
            <span className="row-hint">Se guardan en la carpeta de datos de acta. Puedes borrarlos y volver a descargarlos cuando quieras.</span>
          </span>
        </div>
      </Group>
    </Section>
  );
}
