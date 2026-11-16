import { ExternalLink, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { BrandLogo } from "../../shared/brand/BrandLogo";
import { Badge, Button } from "../../shared/ui/ui";
import { PRESETS } from "./presets";

/** Lo que NaN Builders dice de sí mismo (nan.builders, 16-nov-2026). acta no lo puede verificar: por eso «según». */
export const NAN_PRIVACY = "Privacidad primero: sin registros de prompts ni respuestas, no entrena con tus datos y procesa en la UE (según NaN Builders).";
export const NAN_PLAN = "La clave de API requiere el plan con API (nan_member, 70 €/mes).";

/** Presentación de NaN Builders: por qué se sugiere, qué cuesta y dónde crear la cuenta. */
export function NanIntro({ onCreateAccount, children, heading = true }: { onCreateAccount(): void; children?: ReactNode; heading?: boolean }) {
  return (
    <div className="nan-intro">
      {heading ? (
        <div className="nan-head">
          <BrandLogo brand="nan" size="lg" />
          <div className="nan-title">
            <p className="nan-name">{PRESETS.nan.label}</p>
            <Badge tone="ok" icon={<ShieldCheck size={12} strokeWidth={2.2} aria-hidden />}>
              {PRESETS.nan.tag}
            </Badge>
          </div>
        </div>
      ) : null}
      <p className="nan-copy">{NAN_PRIVACY}</p>
      <p className="nan-plan">{NAN_PLAN}</p>
      <div className="nan-actions">
        <Button capsule title="Se abre en tu navegador (enlace de invitación)" icon={<ExternalLink size={13} strokeWidth={2.1} aria-hidden />} onClick={onCreateAccount}>
          Crear cuenta
        </Button>
        {children}
      </div>
    </div>
  );
}
