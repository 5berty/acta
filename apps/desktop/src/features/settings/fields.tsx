import type { ReactNode } from "react";
import { Stepper, Switch } from "../../shared/ui/ui";

/** Sección de Ajustes: título, explicación y grupos de filas. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-label={title}>
      <header className="settings-section-head">
        <h2>{title}</h2>
        {hint ? <p className="page-sub">{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** Grupo de filas con esquinas redondeadas, como en Ajustes del Sistema. */
export function Group({ title, foot, children }: { title?: string; foot?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-group">
      {title ? <p className="group-title">{title}</p> : null}
      <div className="group">{children}</div>
      {foot ? <p className="group-foot">{foot}</p> : null}
    </div>
  );
}

export function Row({ label, hint, icon, children }: { label: ReactNode; hint?: ReactNode; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      {icon}
      <span className="row-text">
        <span className="row-label">{label}</span>
        {hint ? <span className="row-hint">{hint}</span> : null}
      </span>
      {children ? <span className="row-control">{children}</span> : null}
    </div>
  );
}

export function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="row">
      <span className="row-text">
        <span className="row-label">{label}</span>
        {hint ? <span className="row-hint">{hint}</span> : null}
      </span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

export function StepperRow({ label, title, hint, value, onChange, step, min, max, unit }: { label: string; title?: string; hint?: string; value: number; onChange(v: number): void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <div className="row">
      <span className="row-text">
        <span className="row-label">{title ?? label}</span>
        {hint ? <span className="row-hint">{hint}</span> : null}
      </span>
      <Stepper label={label} value={value} onChange={onChange} step={step} min={min} max={max} unit={unit} />
    </div>
  );
}

/** Campo apilado (etiqueta, control, pista): para lo que vive en «Avanzado». */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}
