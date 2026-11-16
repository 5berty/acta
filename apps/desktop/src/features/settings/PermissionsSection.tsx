import type { PermissionKind, PermissionState, PermissionStatus } from "../../api";
import { Badge, Button } from "../../shared/ui/ui";
import { Section } from "./fields";

const LABEL: Record<PermissionKind, string> = {
  microphone: "Micrófono",
  systemAudio: "Audio del sistema",
  screenRecording: "Grabación de pantalla",
  accessibility: "Accesibilidad",
  automation: "Automatización",
};
const WHY: Record<PermissionKind, string> = {
  microphone: "Tu voz (pista «Yo»). Obligatorio.",
  systemAudio: "La voz de los demás (macOS 14.2+). Obligatorio.",
  screenRecording: "Capturas de la pantalla compartida. Opcional.",
  accessibility: "Detecta la ventana de Teams y quién habla. Opcional, pero mejora mucho los nombres.",
  automation: "Lee la URL de Meet en tu navegador. Opcional.",
};
const STATUS: Record<PermissionStatus, string> = {
  granted: "Concedido",
  denied: "Denegado",
  notDetermined: "Sin decidir",
  unknown: "Desconocido",
};
const TONE: Record<PermissionStatus, "ok" | "danger" | "warn" | "neutral"> = {
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
    <Section title="Permisos" hint="macOS pide cada permiso a acta.app. Si lo has denegado, hay que activarlo a mano en Ajustes del Sistema.">
      <ul className="plain permissions">
        {permissions.map((p) => (
          <li key={p.kind} aria-label={LABEL[p.kind]} className="permission">
            <div>
              <strong>{LABEL[p.kind]}</strong> <Badge tone={TONE[p.status]}>{STATUS[p.status]}</Badge>
              <p className="field-hint">
                {WHY[p.kind]}
                {p.target ? ` (${p.target})` : ""}
              </p>
            </div>
            <div className="permission-actions">
              {p.status !== "granted" && p.status !== "denied" ? (
                <Button small variant="primary" onClick={() => onRequest(p.kind)}>
                  Conceder
                </Button>
              ) : null}
              {p.status !== "granted" ? (
                <Button small onClick={() => onOpen(p.kind)}>
                  Abrir Ajustes del Sistema
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <Button small variant="ghost" onClick={onRefresh}>
        Volver a comprobar
      </Button>
    </Section>
  );
}
