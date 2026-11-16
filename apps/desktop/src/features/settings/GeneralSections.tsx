import { Plus, X } from "lucide-react";
import { useState } from "react";
import type { AppRule, Platform, Settings, VoiceprintSummary } from "../../api";
import { appDisplayName, platformLabel } from "../../shared/format";
import { Avatar, Button, Disclosure, IconButton, PlatformIcon, Select } from "../../shared/ui/ui";
import { Field, Group, Row, Section, StepperRow, ToggleRow } from "./fields";

interface SectionProps<K extends keyof Settings> {
  value: Settings[K];
  onChange(v: Settings[K]): void;
}

const MIN = 60_000;
const HOUR = 3_600_000;

interface GeneralProps {
  user: Settings["user"];
  transcription: Settings["transcription"];
  onUser(v: Settings["user"]): void;
  onTranscription(v: Settings["transcription"]): void;
  voiceprints: VoiceprintSummary[];
  onForget(id: string): void;
}

export function GeneralSection({ user, transcription, onUser, onTranscription, voiceprints, onForget }: GeneralProps) {
  return (
    <Section title="General" hint="Todo se procesa en tu Mac. Lo único que sale es el texto que le mandas a tu proveedor de IA para escribir el acta.">
      <Group title="Tú" foot="acta usa tu nombre para saber qué tareas son tuyas.">
        <Row label="Tu nombre">
          <input aria-label="Tu nombre" value={user.displayName} onChange={(e) => onUser({ ...user, displayName: e.target.value })} />
        </Row>
        <Row label="También te llaman" hint="Separados por comas.">
          <input
            aria-label="Otros nombres"
            key={user.aliases.join(",")}
            defaultValue={user.aliases.join(", ")}
            placeholder="Edu, Eduardo"
            onBlur={(e) => onUser({ ...user, aliases: e.target.value.split(",").map((a) => a.trim()).filter(Boolean) })}
          />
        </Row>
      </Group>

      <Group title="Transcripción">
        <Row label="Idioma de las reuniones">
          <Select label="Idioma" value={transcription.language} onChange={(e) => onTranscription({ ...transcription, language: e.target.value })}>
            <option value="es">Español</option>
            <option value="en">Inglés</option>
            <option value="auto">Detectar</option>
          </Select>
        </Row>
        <ToggleRow label="Separar hablantes" hint="Distingue quién habla entre los demás participantes." checked={transcription.diarization} onChange={(diarization) => onTranscription({ ...transcription, diarization })} />
        <ToggleRow label="Transcripción en vivo" hint="Vista previa mientras grabas y detección de momentos importantes." checked={transcription.livePreview} onChange={(livePreview) => onTranscription({ ...transcription, livePreview })} />
      </Group>

      <Group title="Voces recordadas" foot="Cuando confirmas un nombre en un transcript, acta recuerda esa voz para la próxima reunión.">
        {voiceprints.length === 0 ? <Row label={<span className="muted">Todavía no recuerdo ninguna voz</span>} /> : null}
        {voiceprints.map((v) => (
          <Row key={v.id} icon={<Avatar name={v.displayName} />} label={v.displayName} hint={v.meetings === 1 ? "1 reunión" : `${v.meetings} reuniones`}>
            <Button small aria-label={`Olvidar la voz de ${v.displayName}`} onClick={() => onForget(v.id)}>
              Olvidar
            </Button>
          </Row>
        ))}
      </Group>

      <Disclosure label="Avanzado">
        <Group>
          <StepperRow
            label="Similitud mínima de voz (%)"
            title="Similitud mínima para reconocer una voz"
            hint="Más alto: menos confusiones, pero reconoce a menos gente."
            unit="%"
            max={100}
            value={transcription.voiceprintMinSimilarityPct}
            onChange={(n) => onTranscription({ ...transcription, voiceprintMinSimilarityPct: n })}
          />
        </Group>
      </Disclosure>
    </Section>
  );
}

interface RecordingProps {
  autoStop: Settings["autoStop"];
  recording: Settings["recording"];
  onAutoStop(v: Settings["autoStop"]): void;
  onRecording(v: Settings["recording"]): void;
}

export function RecordingSection({ autoStop, recording, onAutoStop, onRecording }: RecordingProps) {
  return (
    <Section title="Grabación y autoparada" hint="Evita grabaciones eternas cuando la llamada acaba y nadie pulsa parar.">
      <Group title="Parada automática" foot="Si hay silencio, acta pregunta en la pastilla. Si nadie responde, para sola y guarda la reunión.">
        <StepperRow
          label="Minutos de silencio antes de preguntar"
          title="Preguntar tras un silencio de"
          unit="min"
          min={1}
          value={autoStop.silencePromptAfterMs / MIN}
          onChange={(n) => onAutoStop({ ...autoStop, silencePromptAfterMs: Math.round(n * MIN) })}
        />
        <StepperRow
          label="Minutos sin respuesta antes de parar"
          title="Parar si nadie responde en"
          unit="min"
          min={1}
          value={autoStop.autoStopAfterUnansweredMs / MIN}
          onChange={(n) => onAutoStop({ ...autoStop, autoStopAfterUnansweredMs: Math.round(n * MIN) })}
        />
        <StepperRow label="Duración máxima (horas)" title="Duración máxima de una grabación" unit="h" step={0.5} min={0.5} value={autoStop.maxDurationMs / HOUR} onChange={(n) => onAutoStop({ ...autoStop, maxDurationMs: Math.round(n * HOUR) })} />
      </Group>

      <Disclosure label="Avanzado">
        <Group>
          <StepperRow
            label="Umbral de silencio (dBFS)"
            title="Umbral de silencio"
            hint="Por debajo de este nivel se considera que nadie habla."
            unit="dBFS"
            min={-90}
            max={0}
            value={autoStop.silenceThresholdDbfs}
            onChange={(n) => onAutoStop({ ...autoStop, silenceThresholdDbfs: n })}
          />
          <ToggleRow
            label="Borrar los fragmentos al terminar"
            hint="El audio se graba en trozos de 30 s por seguridad. Al acabar se unen; actívalo para no guardar también los trozos."
            checked={recording.deleteSegmentsAfterConcat}
            onChange={(deleteSegmentsAfterConcat) => onRecording({ ...recording, deleteSegmentsAfterConcat })}
          />
        </Group>
      </Disclosure>
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

/** Apps habituales, para añadirlas sin conocer su identificador. */
const PRESETS: AppRule[] = [
  { bundleId: "com.microsoft.teams2", platform: "teams", isBrowser: false },
  { bundleId: "us.zoom.xos", platform: "zoom", isBrowser: false },
  { bundleId: "com.tinyspeck.slackmacgap", platform: "slack", isBrowser: false },
  { bundleId: "com.google.Chrome", platform: "meet", isBrowser: true },
  { bundleId: "com.apple.Safari", platform: "meet", isBrowser: true },
  { bundleId: "company.thebrowser.Browser", platform: "meet", isBrowser: true },
];

export function DetectionSection({ value, onChange }: SectionProps<"detection">) {
  const [bundleId, setBundleId] = useState("");
  const [platform, setPlatform] = useState<Platform>("teams");
  const [browser, setBrowser] = useState(false);
  const [ignored, setIgnored] = useState("");
  const addRule = (rule: AppRule) => {
    if (value.rules.some((r) => r.bundleId === rule.bundleId)) return;
    onChange({ ...value, rules: [...value.rules, rule] });
  };
  const addIgnored = () => {
    const id = ignored.trim();
    if (!id || value.denylist.includes(id)) return;
    onChange({ ...value, denylist: [...value.denylist, id] });
    setIgnored("");
  };
  const add = () => {
    const id = bundleId.trim();
    if (!id) return;
    addRule({ bundleId: id, platform, isBrowser: browser });
    setBundleId("");
  };
  const presets = PRESETS.filter((p) => !value.rules.some((r) => r.bundleId === p.bundleId));

  return (
    <Section title="Detección" hint="Cuando una de estas apps entra en una llamada, acta te pregunta si quieres grabarla. Nunca graba sin preguntar.">
      <Group>
        <ToggleRow label="Detectar reuniones automáticamente" hint="Si lo apagas, solo se graba cuando pulses «Grabar ahora»." checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} />
      </Group>

      <Group title="Apps de reunión" foot="Solo estas apps pueden disparar la pregunta. En un navegador, solo cuenta si la pestaña es de Google Meet.">
        {value.rules.length === 0 ? <Row label={<span className="muted">Ninguna app: la detección no saltará nunca</span>} /> : null}
        {value.rules.map((r) => {
          const name = appDisplayName(r.bundleId);
          return (
            <div key={r.bundleId} className="row" title={r.bundleId}>
              <PlatformIcon platform={r.platform} size="sm" />
              <span className="row-text">
                <span className="row-label">{name}</span>
                <span className="row-hint">
                  {platformLabel(r.platform)}
                  {r.isBrowser ? " · en el navegador" : ""}
                </span>
              </span>
              <IconButton small label={`Quitar ${name}`} onClick={() => onChange({ ...value, rules: value.rules.filter((x) => x.bundleId !== r.bundleId) })}>
                <X size={13} strokeWidth={2.2} aria-hidden />
              </IconButton>
            </div>
          );
        })}
        {presets.length > 0 ? (
          <div className="row row-presets">
            <span className="row-hint">Añadir</span>
            <span className="cluster">
              {presets.map((p) => {
                const name = appDisplayName(p.bundleId);
                return (
                  <button key={p.bundleId} type="button" className="chip" aria-label={`Añadir ${name}`} onClick={() => addRule(p)}>
                    <Plus size={11} strokeWidth={2.6} aria-hidden />
                    <span>{name}</span>
                  </button>
                );
              })}
            </span>
          </div>
        ) : null}
      </Group>

      <Group title="Apps ignoradas" foot="Apps de dictado (Typeless, Orca…) que usan el micrófono pero no son reuniones.">
        {value.denylist.length === 0 ? <Row label={<span className="muted">Ninguna</span>} /> : null}
        {value.denylist.map((id) => {
          const name = appDisplayName(id);
          return (
            <div key={id} className="row" title={id}>
              <span className="row-text">
                <span className="row-label">{name}</span>
              </span>
              <IconButton small label={`Dejar de ignorar ${name}`} onClick={() => onChange({ ...value, denylist: value.denylist.filter((x) => x !== id) })}>
                <X size={13} strokeWidth={2.2} aria-hidden />
              </IconButton>
            </div>
          );
        })}
      </Group>

      <Disclosure label="Avanzado">
        <div className="card advanced">
          <Field label="Añadir otra app" hint="Su identificador (bundle id) sale con: osascript -e 'id of app &quot;Nombre&quot;'">
            <div className="field-line">
              <input className="input-mono" aria-label="Identificador de la app" placeholder="com.ejemplo.app" spellCheck={false} value={bundleId} onChange={(e) => setBundleId(e.target.value)} />
              <Select label="Tipo de reunión" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                {PLATFORMS.map((p) => (
                  <option key={p.v} value={p.v}>
                    {p.l}
                  </option>
                ))}
              </Select>
              <label className="check">
                <input type="checkbox" className="check-box" aria-label="Es un navegador" checked={browser} onChange={(e) => setBrowser(e.target.checked)} />
                Navegador
              </label>
              <Button small onClick={add}>
                Añadir app
              </Button>
            </div>
          </Field>
          <Field label="Ignorar una app">
            <div className="field-line">
              <input className="input-mono" aria-label="Identificador de la app a ignorar" placeholder="com.ejemplo.dictado" spellCheck={false} value={ignored} onChange={(e) => setIgnored(e.target.value)} />
              <Button small onClick={addIgnored}>
                Ignorar app
              </Button>
            </div>
          </Field>
          <Field label="Direcciones de Google Meet" hint="Una por línea. Si la pestaña activa contiene alguna, cuenta como reunión.">
            <textarea
              className="input-mono"
              aria-label="URLs de Meet"
              rows={2}
              defaultValue={value.meetUrlPatterns.join("\n")}
              onBlur={(e) => onChange({ ...value, meetUrlPatterns: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })}
            />
          </Field>
        </div>
      </Disclosure>
    </Section>
  );
}

function KeywordsInput({ keywords, onChange }: { keywords: string[]; onChange(k: string[]): void }) {
  const [text, setText] = useState("");
  const add = () => {
    const next = text.split(",").map((k) => k.trim()).filter((k) => k && !keywords.includes(k));
    if (next.length > 0) onChange([...keywords, ...next]);
    setText("");
  };
  return (
    <div className="tokens">
      {keywords.map((k) => (
        <span key={k} className="badge token">
          {k}
          <button type="button" className="badge-x" aria-label={`Quitar «${k}»`} onClick={() => onChange(keywords.filter((x) => x !== k))}>
            <X size={10} strokeWidth={2.6} aria-hidden />
          </button>
        </span>
      ))}
      <input
        aria-label="Palabras clave"
        placeholder="Añadir palabra…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}

export function ScreenSection({ value, onChange }: SectionProps<"screen">) {
  return (
    <Section title="Capturas" hint="Guarda las diapositivas que se comparten en la llamada y las enlaza con el tema y las tareas. Está apagado por defecto.">
      <Group foot="Necesita el permiso de Grabación de pantalla. Solo captura la ventana compartida, nunca tu escritorio.">
        <ToggleRow label="Capturar la pantalla compartida" hint="Una captura cada vez que cambia la diapositiva." checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} />
        <ToggleRow label="Borrar las candidatas que no se usen" hint="Al terminar, la IA elige las útiles y el resto se elimina." checked={value.pruneCandidates} onChange={(pruneCandidates) => onChange({ ...value, pruneCandidates })} />
      </Group>
      <Group title="Palabras que fuerzan una captura" foot="Si alguien las dice mientras se comparte pantalla, se guarda ese momento.">
        <div className="row row-stack">
          <KeywordsInput keywords={value.keywords} onChange={(keywords) => onChange({ ...value, keywords })} />
        </div>
      </Group>
    </Section>
  );
}
