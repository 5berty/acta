import { Archive, X } from "lucide-react";
import { Button, IconButton } from "../../shared/ui/ui";
import { countLabel, formatSize } from "./reasons";

interface Props {
  count: number;
  totalBytes: number;
  onReview(): void;
  /** «Recordármelo más tarde». */
  onLater(): void;
}

/** Aviso tranquilo: sugiere, nunca borra. Se puede cerrar y vuelve en una semana. */
export function CleanupBanner({ count, totalBytes, onReview, onLater }: Props) {
  return (
    <aside className="cleanup-banner" aria-label="Sugerencia de limpieza">
      <span className="cleanup-banner-icon" aria-hidden>
        <Archive size={17} strokeWidth={1.9} />
      </span>
      <div className="cleanup-banner-text">
        <p className="cleanup-banner-title">{count === 1 ? "Tienes 1 reunión antigua que quizá ya no necesites" : `Tienes ${count} reuniones antiguas que quizá ya no necesites`}</p>
        <p className="cleanup-banner-sub">
          {totalBytes > 0 ? `${count === 1 ? "Ocupa" : "Ocupan"} ${formatSize(totalBytes)}. ` : ""}No se borra nada sin que lo revises.
        </p>
      </div>
      <Button small capsule aria-label={`Revisar ${countLabel(count)} antiguas`} onClick={onReview}>
        Revisar
      </Button>
      <IconButton small label="Recordármelo más tarde" title="Recordármelo más tarde" onClick={onLater}>
        <X size={14} strokeWidth={2.2} aria-hidden />
      </IconButton>
    </aside>
  );
}
