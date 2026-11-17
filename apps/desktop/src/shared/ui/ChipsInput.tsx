import { Plus, X } from "lucide-react";
import { useState } from "react";

interface Props {
  /** Nombre accesible del campo. */
  label: string;
  values: string[];
  onChange(next: string[]): void;
  placeholder?: string;
  /** Propuestas de un toque; las que ya están no se enseñan. */
  suggestions?: string[];
}

const same = (a: string, b: string): boolean => a.localeCompare(b, "es", { sensitivity: "accent" }) === 0;

/**
 * Lista de textos cortos como fichas: Intro o coma añaden, la X o Retroceso
 * quitan. Sirve para los nombres con los que te llaman y las palabras clave.
 */
export function ChipsInput({ label, values, onChange, placeholder, suggestions = [] }: Props) {
  const [text, setText] = useState("");

  const add = (raw: string) => {
    const next = [...values];
    for (const part of raw.split(",")) {
      const v = part.trim();
      if (v && !next.some((x) => same(x, v))) next.push(v);
    }
    if (next.length !== values.length) onChange(next);
    setText("");
  };
  const pending = suggestions.filter((s) => s.trim() && !values.some((v) => same(v, s)));

  return (
    <div className="tokens">
      {values.length > 0 ? (
        <ul className="plain tokens-list">
          {values.map((v) => (
            <li key={v} className="badge token">
              {v}
              <button type="button" className="badge-x" aria-label={`Quitar «${v}»`} onClick={() => onChange(values.filter((x) => x !== v))}>
                <X size={10} strokeWidth={2.6} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
        onBlur={() => add(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && text === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
      />
      {pending.map((s) => (
        <button key={s} type="button" className="chip chip-suggest" aria-label={`Añadir «${s}»`} onClick={() => add(s)}>
          <Plus size={11} strokeWidth={2.6} aria-hidden />
          <span>{s}</span>
        </button>
      ))}
    </div>
  );
}
