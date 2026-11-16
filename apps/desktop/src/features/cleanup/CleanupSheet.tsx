import { Check, HardDrive } from "lucide-react";
import { useMemo, useState } from "react";
import type { CleanupCandidate, CleanupResult, CleanupSuggestions } from "../../api";
import { formatDate, formatDuration } from "../../shared/format";
import { Button, Modal } from "../../shared/ui/ui";
import { countLabel, formatSize, reasonLabels } from "./reasons";

interface Props {
  suggestions: CleanupSuggestions;
  onClose(): void;
  /** Borra las elegidas y devuelve lo liberado. */
  onDelete(ids: string[]): Promise<CleanupResult>;
  /** «Mantener»: no volver a sugerir estas reuniones. */
  onKeep(ids: string[]): Promise<void>;
  /** «Recordármelo más tarde». */
  onLater(): void;
  onOpenMeeting?(id: string): void;
}

/**
 * Hoja de revisión. El usuario decide reunión por reunión; borrar pide
 * confirmación en la misma hoja y al terminar dice cuánto disco se ha liberado.
 */
export function CleanupSheet({ suggestions, onClose, onDelete, onKeep, onLater, onOpenMeeting }: Props) {
  const [items, setItems] = useState<CleanupCandidate[]>(suggestions.candidates);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(suggestions.candidates.map((c) => c.meetingId)));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => items.filter((c) => selected.has(c.meetingId)), [items, selected]);
  const chosenBytes = chosen.reduce((n, c) => n + c.bytes, 0);
  const allSelected = items.length > 0 && chosen.length === items.length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const drop = (ids: string[]) => {
    setItems((prev) => prev.filter((c) => !ids.includes(c.meetingId)));
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  };
  const keep = async (ids: string[]) => {
    await onKeep(ids);
    drop(ids);
  };
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await onDelete(chosen.map((c) => c.meetingId));
      drop(r.deleted);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "No se han podido borrar."));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (result) {
    return (
      <Modal label="Reuniones antiguas" onClose={onClose} className="cleanup-sheet">
        <div className="cleanup-done" role="status">
          <span className="cleanup-done-icon" aria-hidden>
            <Check size={26} strokeWidth={2.4} />
          </span>
          <h2>{result.deleted.length === 1 ? "Se ha borrado 1 reunión" : `Se han borrado ${result.deleted.length} reuniones`}</h2>
          <p className="cleanup-freed">
            <HardDrive size={15} strokeWidth={1.9} aria-hidden />
            Has liberado {formatSize(result.freedBytes)}
          </p>
          {result.skipped.length > 0 ? <p className="muted">{countLabel(result.skipped.length)} no se {result.skipped.length === 1 ? "ha" : "han"} tocado: {result.skipped.length === 1 ? "es favorita o se está usando" : "son favoritas o se están usando"}.</p> : null}
          <Button variant="primary" capsule size="lg" onClick={onClose}>
            Hecho
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal label="Reuniones antiguas" onClose={onClose} className="cleanup-sheet">
      <header className="cleanup-head">
        <h2>Reuniones antiguas</h2>
        <p>
          Tienen más de {suggestions.minAgeDays} días y no las has abierto, buscado ni usado en el chat desde entonces. Las favoritas y las que tienen tareas tuyas pendientes nunca aparecen aquí.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="cleanup-none">No queda nada por revisar.</p>
      ) : (
        <>
          <div className="cleanup-select-all">
            <label className="cleanup-check">
              <input type="checkbox" className="check-box" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((c) => c.meetingId)))} />
              <span>{allSelected ? "Quitar selección" : "Seleccionar todas"}</span>
            </label>
            <span className="muted num">
              {chosen.length} de {items.length} · {formatSize(chosenBytes)}
            </span>
          </div>
          <ul className="plain group cleanup-list" aria-label="Reuniones sugeridas">
            {items.map((c) => {
              const labels = reasonLabels(c);
              return (
                <li key={c.meetingId} aria-label={c.title} className="row cleanup-row">
                  <input type="checkbox" className="check-box" aria-label={`Seleccionar ${c.title}`} checked={selected.has(c.meetingId)} onChange={() => toggle(c.meetingId)} />
                  <div className="row-text">
                    {onOpenMeeting ? (
                      <button type="button" className="cleanup-title" title="Abrir la reunión" onClick={() => onOpenMeeting(c.meetingId)}>
                        {c.title}
                      </button>
                    ) : (
                      <span className="cleanup-title">{c.title}</span>
                    )}
                    <span className="row-hint num">
                      {formatDate(c.startedAt)} · {formatDuration(c.duration)} · {formatSize(c.bytes)}
                    </span>
                    {labels.length > 0 ? (
                      <span className="cleanup-reasons">
                        {labels.map((l) => (
                          <span key={l} className="cleanup-reason">
                            {l}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <Button small capsule variant="ghost" aria-label={`Mantener ${c.title}`} title="No volver a sugerirla" onClick={() => void keep([c.meetingId])}>
                    Mantener
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {error ? (
        <p role="alert" className="error cleanup-error">
          {error}
        </p>
      ) : null}

      {confirming ? (
        <footer className="cleanup-foot cleanup-confirm" role="alertdialog" aria-label="Confirmar el borrado">
          <p>
            <strong>¿Borrar {countLabel(chosen.length)}?</strong> Se eliminan su audio, sus capturas y su transcripción, y se liberan {formatSize(chosenBytes)}. No se puede deshacer.
          </p>
          <Button capsule disabled={busy} onClick={() => setConfirming(false)}>
            Cancelar
          </Button>
          <Button capsule variant="danger" disabled={busy} onClick={() => void remove()}>
            {busy ? "Borrando…" : `Borrar ${countLabel(chosen.length)}`}
          </Button>
        </footer>
      ) : (
        <footer className="cleanup-foot">
          <Button
            capsule
            variant="ghost"
            onClick={() => {
              onLater();
              onClose();
            }}
          >
            Recordármelo más tarde
          </Button>
          <span className="spacer" />
          {items.length === 0 ? (
            <Button capsule variant="primary" onClick={onClose}>
              Cerrar
            </Button>
          ) : (
            <>
              <Button capsule disabled={chosen.length === 0} title="No volver a sugerir las seleccionadas" onClick={() => void keep(chosen.map((c) => c.meetingId))}>
                Mantener seleccionadas
              </Button>
              <Button capsule variant="danger" disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
                Borrar seleccionadas
              </Button>
            </>
          )}
        </footer>
      )}
    </Modal>
  );
}
