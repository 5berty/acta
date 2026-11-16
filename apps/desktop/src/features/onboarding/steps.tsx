import { AudioLines, Check, CircleAlert, Command, Download, Lock, MenuSquare, MessageCircle, Mic, RotateCw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { ModelDownload, ModelStatus, PermissionKind, PermissionState, Settings } from "../../api";
import { ActaMark } from "../../shared/brand/ActaMark";
import { BrandLogo } from "../../shared/brand/BrandLogo";
import { Badge, Button, ProgressBar, StatusDot, Stepper, Switch } from "../../shared/ui/ui";
import { MODEL_ICON, MODEL_LABEL, MODEL_WHAT, formatBytes } from "../settings/ModelsSection";
import { PERMISSION_ICON, PERMISSION_LABEL, PERMISSION_REQUIRED, PERMISSION_STATUS, PERMISSION_TONE, PERMISSION_WHY, permissionKey, permissionName, permissionTargetHint } from "../settings/PermissionsSection";

/** Cabecera común de cada paso. */
export function StepHead({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <header className="ob-head">
      <h1>{title}</h1>
      <p className="ob-sub">{sub}</p>
    </header>
  );
}

const FEATURES = [
  { icon: <Mic size={19} strokeWidth={1.9} aria-hidden />, title: "Graba sola", text: "Detecta que has entrado en una llamada y te pregunta si la graba. Tu voz y la de los demás, en pistas separadas." },
  { icon: <Lock size={19} strokeWidth={1.9} aria-hidden />, title: "Se queda en tu Mac", text: "El audio y la transcripción no salen de tu equipo. No hay cuenta, ni nube, ni bots que entren en la reunión." },
  { icon: <Sparkles size={19} strokeWidth={1.9} aria-hidden />, title: "El acta, al colgar", text: "Resumen, decisiones y tus tareas. Y un chat para preguntar qué se dijo, con el minuto exacto." },
];

export function WelcomeStep() {
  return (
    <div className="ob-welcome">
      <ActaMark size={84} />
      <StepHead title="Te damos la bienvenida a acta" sub="Graba tus reuniones, las transcribe en tu Mac y te deja el acta escrita. En dos minutos lo dejamos listo." />
      <ul className="plain ob-features">
        {FEATURES.map((f) => (
          <li key={f.title} className="ob-feature">
            <span className="ob-feature-icon" aria-hidden>
              {f.icon}
            </span>
            <span>
              <span className="ob-feature-title">{f.title}</span>
              <span className="ob-feature-text">{f.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PERMISSION_ORDER: PermissionKind[] = ["microphone", "systemAudio", "accessibility", "automation", "screenRecording"];

interface PermissionsProps {
  permissions: PermissionState[];
  onRequest(kind: PermissionKind): void;
  onOpen(kind: PermissionKind): void;
  onRefresh(): void;
}

export function PermissionsStep({ permissions, onRequest, onOpen, onRefresh }: PermissionsProps) {
  const sorted = [...permissions].sort((a, b) => PERMISSION_ORDER.indexOf(a.kind) - PERMISSION_ORDER.indexOf(b.kind));
  const missing = sorted.filter((p) => PERMISSION_REQUIRED[p.kind] && p.status !== "granted");
  return (
    <div className="ob-step">
      <StepHead title="Permisos de macOS" sub="macOS pide cada permiso por separado. Los dos primeros hacen falta para grabar; el resto mejoran el resultado y puedes darlos más adelante." />
      <ul className="plain group">
        {sorted.map((p) => (
          <li key={permissionKey(p)} aria-label={permissionName(p)} className="row permission">
            <span className="row-icon-tile" aria-hidden>
              {PERMISSION_ICON[p.kind]}
            </span>
            <span className="row-text">
              <span className="row-label">
                {PERMISSION_LABEL[p.kind]}
                {PERMISSION_REQUIRED[p.kind] ? <Badge tone="accent">Necesario</Badge> : <Badge>Opcional</Badge>}
              </span>
              <span className="row-hint">
                {PERMISSION_WHY[p.kind]}
                {permissionTargetHint(p)}
              </span>
            </span>
            <span className="row-control permission-actions">
              <span className="permission-status">
                <StatusDot tone={PERMISSION_TONE[p.status]} />
                <span>{PERMISSION_STATUS[p.status]}</span>
              </span>
              {p.status !== "granted" && p.status !== "denied" ? (
                <Button small capsule variant="primary" onClick={() => onRequest(p.kind)}>
                  Conceder
                </Button>
              ) : null}
              {p.status !== "granted" ? (
                <Button small capsule title="Abre el panel de Privacidad y seguridad" onClick={() => onOpen(p.kind)}>
                  Abrir Ajustes del Sistema
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="ob-foot-note">
        <span>{missing.length > 0 ? "Sin micrófono y audio del sistema no se puede grabar. El estado se actualiza solo al volver de Ajustes del Sistema." : "Lo necesario está concedido. Puedes seguir."}</span>
        <Button small capsule variant="ghost" icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={onRefresh}>
          Comprobar ahora
        </Button>
      </div>
    </div>
  );
}

interface ModelsProps {
  models: ModelStatus[];
  downloads: Record<string, ModelDownload>;
  onDownload(name: string): void;
}

export function ModelsStep({ models, downloads, onDownload }: ModelsProps) {
  const running = (name: string) => {
    const d = downloads[name];
    return !!d && !d.done && !d.error;
  };
  const pending = models.filter((m) => !m.downloaded && !running(m.name));
  const allDone = models.length > 0 && models.every((m) => m.downloaded);
  return (
    <div className="ob-step">
      <StepHead title="Transcripción en tu Mac" sub="Los modelos de voz se descargan una sola vez y después funcionan sin conexión. Convierten el audio en texto sin enviarlo a ningún sitio." />
      <ul className="plain group">
        {models.map((m) => {
          const label = MODEL_LABEL[m.name] ?? m.name;
          const d = downloads[m.name];
          return (
            <li key={m.name} aria-label={label} className="row model-row">
              <span className="row-icon-tile" aria-hidden>
                {MODEL_ICON[m.name] ?? <AudioLines size={16} strokeWidth={1.9} />}
              </span>
              <span className="row-text">
                <span className="row-label">{label}</span>
                <span className="row-hint">{MODEL_WHAT[m.name] ?? "Modelo local."}</span>
                {running(m.name) && d ? (
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
                  <span>{m.downloaded ? `Descargado${m.bytes != null ? ` · ${formatBytes(m.bytes)}` : ""}` : running(m.name) ? "Descargando…" : "Sin descargar"}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ob-foot-note">
        <span>{allDone ? "Ya lo tienes todo. La transcripción funciona sin conexión." : "Puedes seguir mientras se descargan: la descarga continúa de fondo."}</span>
        {pending.length > 0 ? (
          <Button capsule variant="primary" icon={<Download size={13} strokeWidth={2.3} aria-hidden />} onClick={() => pending.forEach((m) => onDownload(m.name))}>
            Descargar todo
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const MIN = 60_000;

interface DetectionProps {
  detection: Settings["detection"];
  autoStop: Settings["autoStop"];
  onDetection(v: Settings["detection"]): void;
  onAutoStop(v: Settings["autoStop"]): void;
}

export function DetectionStep({ detection, autoStop, onDetection, onAutoStop }: DetectionProps) {
  return (
    <div className="ob-step">
      <StepHead title="Que empiece y pare sola" sub="acta se da cuenta de que estás en una llamada y te pregunta antes de grabar. Nunca graba sin que digas que sí." />
      <div className="group">
        <label className="row">
          <span className="ob-apps" aria-hidden>
            <BrandLogo brand="teams" size="sm" />
            <BrandLogo brand="meet" size="sm" />
          </span>
          <span className="row-text">
            <span className="row-label">Avisarme cuando empiece una reunión</span>
            <span className="row-hint">Funciona con Microsoft Teams y con Google Meet en el navegador. Puedes añadir Zoom, Slack y otras en Ajustes.</span>
          </span>
          <Switch label="Avisarme cuando empiece una reunión" checked={detection.enabled} onChange={(enabled) => onDetection({ ...detection, enabled })} />
        </label>
      </div>
      <div>
        <p className="group-title">Cuando la llamada se acaba y nadie pulsa parar</p>
        <div className="group">
          <div className="row">
            <span className="row-text">
              <span className="row-label">Preguntar si paro tras un silencio de</span>
              <span className="row-hint">Aparece una pregunta en la pastilla flotante.</span>
            </span>
            <Stepper label="Minutos de silencio antes de preguntar" unit="min" min={1} value={autoStop.silencePromptAfterMs / MIN} onChange={(n) => onAutoStop({ ...autoStop, silencePromptAfterMs: Math.round(n * MIN) })} />
          </div>
          <div className="row">
            <span className="row-text">
              <span className="row-label">Parar sola si nadie responde en</span>
              <span className="row-hint">La reunión se guarda igualmente. Así no hay grabaciones eternas.</span>
            </span>
            <Stepper label="Minutos sin respuesta antes de parar" unit="min" min={1} value={autoStop.autoStopAfterUnansweredMs / MIN} onChange={(n) => onAutoStop({ ...autoStop, autoStopAfterUnansweredMs: Math.round(n * MIN) })} />
          </div>
        </div>
        <p className="group-foot">Estos valores van bien para casi todo el mundo. Se cambian en Ajustes › Grabación y autoparada.</p>
      </div>
    </div>
  );
}

export interface SummaryLine {
  ok: boolean;
  text: string;
}

const TIPS = [
  { icon: <MenuSquare size={17} strokeWidth={1.9} aria-hidden />, text: "acta vive en la barra de menús: cerrar la ventana no la apaga." },
  { icon: <Command size={17} strokeWidth={1.9} aria-hidden />, text: "Pulsa ⌘K para buscar cualquier reunión o frase." },
  { icon: <MessageCircle size={17} strokeWidth={1.9} aria-hidden />, text: "En «Preguntar» puedes hablar con todas tus reuniones a la vez." },
];

export function DoneStep({ summary }: { summary: SummaryLine[] }) {
  return (
    <div className="ob-step ob-done">
      <StepHead title="Todo listo" sub="Entra en tu próxima reunión y acta te preguntará si la graba. O pulsa «Grabar ahora» cuando quieras." />
      <ul className="plain group" aria-label="Resumen">
        {summary.map((s) => (
          <li key={s.text} className="row ob-summary">
            <span className={`ob-check${s.ok ? "" : " ob-check-warn"}`} aria-hidden>
              {s.ok ? <Check size={14} strokeWidth={2.8} /> : <CircleAlert size={15} strokeWidth={2.2} />}
            </span>
            <span className="row-text">
              <span className="row-label">{s.text}</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="plain ob-tips">
        {TIPS.map((t) => (
          <li key={t.text}>
            {t.icon}
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
