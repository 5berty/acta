import { Accessibility, AppWindow, Mic, MonitorUp, RotateCw, Volume2 } from "lucide-react";
import type { ReactNode } from "react";
import type { PermissionKind, PermissionState, PermissionStatus } from "../../api";
import { appDisplayName } from "../../shared/format";
import { Badge, Button, StatusDot, type Tone } from "../../shared/ui/ui";
import { Section } from "./fields";

const LABEL: Record<PermissionKind, string> = {
  microphone: "Micrófono",
  systemAudio: "Audio del sistema",
  screenRecording: "Grabación de pantalla",
  accessibility: "Accesibilidad",
  automation: "Automatización",
};
const WHY: Record<PermissionKind, string> = {
  microphone: "Para grabar tu voz.",
  systemAudio: "Para grabar la voz de los demás.",
  screenRecording: "Para las capturas de la pantalla compartida.",
  accessibility: "Para ver en Teams quién está hablando y poner nombres en el transcript.",
  automation: "Para saber si la pestaña del navegador es una llamada de Meet.",
};
const REQUIRED: Record<PermissionKind, boolean> = {
  microphone: true,
  systemAudio: true,
  screenRecording: false,
  accessibility: false,
  automation: false,
};
const ICON: Record<PermissionKind, ReactNode> = {
  microphone: <Mic size={16} strokeWidth={1.9} aria-hidden />,
  systemAudio: <Volume2 size={16} strokeWidth={1.9} aria-hidden />,
  screenRecording: <MonitorUp size={16} strokeWidth={1.9} aria-hidden />,
  accessibility: <Accessibility size={16} strokeWidth={1.9} aria-hidden />,
  automation: <AppWindow size={16} strokeWidth={1.9} aria-hidden />,
};
const STATUS: Record<PermissionStatus, string> = {
  granted: "Concedido",
  denied: "Denegado",
  notDetermined: "Sin decidir",
  unknown: "Sin comprobar",
};
const TONE: Record<PermissionStatus, Tone> = {
  granted: "ok",
  denied: "danger",
  notDetermined: "warn",
  unknown: "neutral",
};

interface Props {
  permissions: PermissionState[];
  onRequest(kind: PermissionKind): void;
  onOpen(kind: PermissionKind): void;
  onRefresh(): void;
}

export function PermissionsSection({ permissions, onRequest, onOpen, onRefresh }: Props) {
  return (
    <Section title="Permisos" hint="macOS pide cada permiso por separado. Si deniegas alguno, solo se puede cambiar a mano en Ajustes del Sistema.">
      <div className="settings-group">
        <ul className="plain group permissions">
          {permissions.map((p) => (
            <li key={p.kind} aria-label={LABEL[p.kind]} className="row permission">
              <span className="row-icon-tile" aria-hidden>
                {ICON[p.kind]}
              </span>
              <span className="row-text">
                <span className="row-label">
                  {LABEL[p.kind]}
                  {REQUIRED[p.kind] ? <Badge tone="accent">Necesario</Badge> : <Badge>Opcional</Badge>}
                </span>
                <span className="row-hint">
                  {WHY[p.kind]}
                  {p.target ? ` Se pide para ${appDisplayName(p.target)}.` : ""}
                </span>
              </span>
              <span className="row-control permission-actions">
                <span className="permission-status">
                  <StatusDot tone={TONE[p.status]} />
                  <span>{STATUS[p.status]}</span>
                </span>
                {p.status !== "granted" && p.status !== "denied" ? (
                  <Button small capsule variant="primary" onClick={() => onRequest(p.kind)}>
                    Conceder
                  </Button>
                ) : null}
                {p.status !== "granted" ? (
                  <Button small capsule onClick={() => onOpen(p.kind)}>
                    Abrir Ajustes del Sistema
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="group-foot">Después de cambiar un permiso en Ajustes del Sistema, vuelve aquí y compruébalo.</p>
      </div>
      <div>
        <Button small capsule icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={onRefresh}>
          Volver a comprobar
        </Button>
      </div>
    </Section>
  );
}
