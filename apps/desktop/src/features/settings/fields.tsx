import type { ReactNode } from "react";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="toggle">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="toggle-label">{label}</span>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Número con conversión de unidad (p. ej. ms <-> minutos). */
export function NumberField({ label, value, onChange, step = 1, min = 0 }: { label: string; value: number; onChange(v: number): void; step?: number; min?: number }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        type="number"
        aria-label={label}
        min={min}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card settings-section" aria-label={title}>
      <h2>{title}</h2>
      {hint ? <p className="muted">{hint}</p> : null}
      {children}
    </section>
  );
}
