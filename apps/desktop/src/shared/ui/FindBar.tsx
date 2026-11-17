import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { RefObject } from "react";

interface Props {
  label: string;
  placeholder?: string;
  query: string;
  onQuery(q: string): void;
  /** Coincidencias totales y posición (base 0) de la actual. */
  count: number;
  index: number;
  onNext(): void;
  onPrev(): void;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Enseña el atajo ⌘F cuando el campo está vacío. */
  shortcut?: boolean;
}

/** Barra de búsqueda dentro de una vista: campo, «n de m», anterior y siguiente. ↩ siguiente, ⇧↩ anterior, Esc limpia. */
export function FindBar({ label, placeholder = "Buscar…", query, onQuery, count, index, onNext, onPrev, inputRef, shortcut = true }: Props) {
  const has = query.trim().length > 0;
  return (
    <div className="findbar" role="search">
      <Search size={14} strokeWidth={2.1} aria-hidden />
      <input
        ref={inputRef}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === "Escape" && query) {
            e.preventDefault();
            e.stopPropagation();
            onQuery("");
          }
        }}
      />
      {has ? (
        <>
          <span className="findbar-count num" aria-live="polite">
            {count > 0 ? `${index + 1} de ${count}` : "Sin resultados"}
          </span>
          <button type="button" className="findbar-btn" aria-label="Coincidencia anterior" title="Anterior (⇧↩)" disabled={count === 0} onClick={onPrev}>
            <ChevronUp size={14} strokeWidth={2.4} aria-hidden />
          </button>
          <button type="button" className="findbar-btn" aria-label="Siguiente coincidencia" title="Siguiente (↩)" disabled={count === 0} onClick={onNext}>
            <ChevronDown size={14} strokeWidth={2.4} aria-hidden />
          </button>
          <button type="button" className="findbar-btn" aria-label="Borrar búsqueda" title="Borrar (Esc)" onClick={() => onQuery("")}>
            <X size={13} strokeWidth={2.4} aria-hidden />
          </button>
        </>
      ) : shortcut ? (
        <span className="kbd" aria-hidden>
          ⌘F
        </span>
      ) : null}
    </div>
  );
}
