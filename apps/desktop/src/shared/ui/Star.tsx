import { Star } from "lucide-react";

interface Props {
  on: boolean;
  /** Qué se marca (sale en la ayuda emergente): «Daily del equipo». */
  name: string;
  /** "favorita" para reuniones, "favorito" para grupos. */
  noun?: "favorita" | "favorito";
  onToggle(next: boolean): void;
  size?: number;
  className?: string;
}

/**
 * Estrella de favorito. Responde al pulsar (escala) y la estrella se rellena
 * con un pequeño rebote: es una acción poco frecuente y con significado.
 */
export function StarButton({ on, name, noun = "favorita", onToggle, size = 16, className = "" }: Props) {
  // La etiqueta es corta: la fila ya dice de qué reunión o grupo se trata.
  const label = on ? `Quitar de ${noun}s` : `Marcar como ${noun}`;
  return (
    <button
      type="button"
      className={`star-btn ${className}`}
      aria-pressed={on}
      aria-label={label}
      title={on ? `Quitar «${name}» de ${noun}s` : `Marcar «${name}» como ${noun}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!on);
      }}
    >
      <Star size={size} strokeWidth={1.9} aria-hidden />
    </button>
  );
}
