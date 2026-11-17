import { ChevronDown, ChevronRight, Mic, Minus, Plus } from "lucide-react";
import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from "react";
import type { Platform } from "../../api";
import { BrandLogo } from "../brand/BrandLogo";
import { platformBrand } from "../brand/brands";
import { colorForName, initials } from "../format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "glass";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
  size?: Size;
  capsule?: boolean;
  icon?: ReactNode;
}

const sizeClass = (small: boolean | undefined, size: Size | undefined): string => {
  const s = size ?? (small ? "sm" : "md");
  return s === "md" ? "" : ` btn-${s}`;
};

export function Button({ variant = "secondary", small, size, capsule, icon, className = "", children, ref, ...rest }: ButtonProps & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button ref={ref} type="button" className={`btn btn-${variant}${sizeClass(small, size)}${capsule ? " btn-capsule" : ""} ${className}`} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** Botón solo con icono: el nombre accesible va en `label`. */
export function IconButton({ label, variant = "ghost", small, size, capsule = true, className = "", children, ...rest }: Omit<ButtonProps, "icon"> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`btn icon-btn btn-${variant}${sizeClass(small, size)}${capsule ? " btn-capsule" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export type Tone = "neutral" | "accent" | "warn" | "danger" | "ok";

export function Badge({ tone = "neutral", icon, children }: { tone?: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon}
      {children}
    </span>
  );
}

export function StatusDot({ tone = "neutral" }: { tone?: Tone }) {
  return <span className={`dot dot-${tone}`} aria-hidden />;
}

export function Spinner() {
  return <span className="spinner" aria-hidden />;
}

export function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const pct = Math.round(clamped * 100);
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="progress-fill" style={{ transform: `scaleX(${clamped})` }} />
    </div>
  );
}

export function EmptyState({ icon, title, hint, compact, children }: { icon?: ReactNode; title: string; hint?: string; compact?: boolean; children?: ReactNode }) {
  return (
    <div className={`empty${compact ? " empty-compact" : ""}`}>
      {icon ? (
        <div className="empty-icon" aria-hidden>
          {icon}
        </div>
      ) : null}
      <p className="empty-title">{title}</p>
      {hint ? <p className="empty-hint">{hint}</p> : null}
      {children ? <div className="empty-actions">{children}</div> : null}
    </div>
  );
}

export interface TabDef<K extends string> {
  key: K;
  label: string;
  count?: number;
}

/** Pestañas como control segmentado en cápsula. */
export function Tabs<K extends string>({ tabs, active, onChange, label }: { tabs: TabDef<K>[]; active: K; onChange: (k: K) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="segmented">
      {tabs.map((t) => (
        <button key={t.key} role="tab" type="button" aria-selected={t.key === active} className="segment" onClick={() => onChange(t.key)}>
          {t.label}
          {t.count ? <span className="segment-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Elección entre pocas opciones (filtros, modos de vista). */
export function Segmented<K extends string>({ options, value, onChange, label, small }: { options: { key: K; label: string; icon?: ReactNode }[]; value: K; onChange: (k: K) => void; label: string; small?: boolean }) {
  return (
    <div role="group" aria-label={label} className={`segmented${small ? " segmented-sm" : ""}`}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.key === value} className="segment" onClick={() => onChange(o.key)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ label, onClose, children, className = "" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`modal glass-thick ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** `<select>` nativo con la flecha del sistema de diseño. */
export function Select({ label, capsule, className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; capsule?: boolean }) {
  return (
    <span className={`select${capsule ? " select-capsule" : ""} ${className}`}>
      <select aria-label={label} {...rest}>
        {children}
      </select>
      <ChevronDown size={13} strokeWidth={2.2} aria-hidden />
    </span>
  );
}

/** Interruptor. Semánticamente es una casilla, así se anuncia marcada o sin marcar. */
export function Switch({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean }) {
  return <input type="checkbox" className="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

/** Número con botones − y +. Mientras se escribe se respeta el texto a medias (p. ej. vacío). */
export function Stepper({ label, value, onChange, step = 1, min = 0, max, unit }: { label: string; value: number; onChange(v: number): void; step?: number; min?: number; max?: number; unit?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, n));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const bump = (delta: number) => {
    setDraft(null);
    onChange(clamp(round(value + delta)));
  };
  return (
    <span className="stepper">
      <button type="button" aria-label={`Reducir: ${label}`} onClick={() => bump(-step)}>
        <Minus size={13} strokeWidth={2.4} aria-hidden />
      </button>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft ?? (Number.isFinite(value) ? value : "")}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n)) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
      {unit ? <span className="stepper-unit">{unit}</span> : null}
      <button type="button" aria-label={`Aumentar: ${label}`} onClick={() => bump(step)}>
        <Plus size={13} strokeWidth={2.4} aria-hidden />
      </button>
    </span>
  );
}

/** Oculta lo técnico hasta que se pide. */
export function Disclosure({ label, ariaLabel, children, defaultOpen = false }: { label: string; ariaLabel?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="disclosure">
      <button type="button" className="disclosure-trigger" aria-label={ariaLabel} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ChevronRight size={13} strokeWidth={2.4} aria-hidden />
        {label}
      </button>
      {open ? (
        <div id={id} className="disclosure-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Avatar({ name, color, size }: { name: string; color?: string; size?: "sm" | "lg" }) {
  return (
    <span className={`avatar${size ? ` avatar-${size}` : ""}`} style={{ ["--c" as string]: color ?? colorForName(name) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="avatar-stack" title={names.join(", ")}>
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size="sm" />
      ))}
      {rest > 0 ? (
        <span className="avatar avatar-sm avatar-more" aria-hidden>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}

/** Mosaico de la app de la reunión: su logotipo, o un micro si no se conoce. */
export function PlatformIcon({ platform, size }: { platform: Platform; size?: "sm" | "lg" }) {
  const brand = platformBrand(platform);
  if (brand) return <BrandLogo brand={brand} size={size ?? "md"} />;
  return (
    <span className={`brand-tile brand-${size ?? "md"} brand-generic`} aria-hidden>
      <Mic strokeWidth={2} />
    </span>
  );
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return "Algo ha fallado";
}
