import { ChevronDown, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AvailableProvider, LlmOverride } from "../../api";
import { Spinner } from "../../shared/ui/ui";
import { usePopover } from "../../shared/ui/usePopover";

interface Props {
  label?: string;
  menuLabel?: string;
  /** Un solo botón discreto (cabecera del resumen): el menú incluye «Proveedor por defecto». */
  quiet?: boolean;
  disabled?: boolean;
  /** `null`: con el proveedor y modelo de siempre. */
  onRetry(llm: LlmOverride | null): void;
  /** `llm_providers_available`: se pide al abrir el menú. */
  loadProviders(): Promise<AvailableProvider[]>;
}

/**
 * «Reintentar» partido en dos: el botón principal usa el proveedor por
 * defecto; la flecha abre «Reintentar con…» para elegir otro proveedor o
 * modelo solo esta vez.
 */
export function RetryMenu({ label = "Reintentar", menuLabel = "Reintentar con…", quiet, disabled, onRetry, loadProviders }: Props) {
  const { open, setOpen, close, root, trigger } = usePopover<HTMLSpanElement>();
  const [providers, setProviders] = useState<AvailableProvider[] | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    menu.current?.focus();
    loadProviders().then(
      (p) => live && setProviders([...p]),
      () => live && setProviders([]),
    );
    return () => {
      live = false;
    };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (llm: LlmOverride | null) => {
    close();
    onRetry(llm);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? Math.min(items.length - 1, at + 1) : Math.max(0, at - 1);
    items[next]?.focus();
  };

  return (
    <span className={`split${quiet ? " split-quiet" : ""}`} ref={root}>
      {quiet ? (
        <button ref={trigger} type="button" className="btn btn-ghost btn-sm btn-capsule split-solo" aria-label={label} title={menuLabel} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
          <RotateCw size={12} strokeWidth={2.2} aria-hidden />
          <span aria-hidden>Regenerar</span>
          <ChevronDown size={12} strokeWidth={2.4} aria-hidden />
        </button>
      ) : (
        <>
          <button type="button" className="btn btn-primary btn-sm split-main" disabled={disabled} onClick={() => onRetry(null)}>
            <RotateCw size={12} strokeWidth={2.2} aria-hidden />
            {label}
          </button>
          <button ref={trigger} type="button" className="btn btn-primary btn-sm split-more" aria-label={menuLabel} title={menuLabel} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
            <ChevronDown size={13} strokeWidth={2.6} aria-hidden />
          </button>
        </>
      )}
      {open ? (
        <div ref={menu} role="menu" aria-label={menuLabel} tabIndex={-1} className="menu glass-thick" onKeyDown={onKeyDown}>
          <p className="menu-title">{menuLabel}</p>
          {quiet ? (
            <button type="button" role="menuitem" className="menu-item" onClick={() => pick(null)}>
              Proveedor por defecto
            </button>
          ) : null}
          {providers === null ? (
            <p className="menu-empty">
              <Spinner /> Buscando proveedores…
            </p>
          ) : providers.length === 0 ? (
            <p className="menu-empty">No hay proveedores de IA activados.</p>
          ) : (
            providers.map((p) => (
              <div key={p.providerId} role="group" aria-label={p.label} className="menu-group">
                <p className="menu-group-label">{p.label}</p>
                {p.models.length > 0 ? (
                  p.models.map((m) => (
                    <button key={m} type="button" role="menuitem" aria-label={`${p.label} · ${m}`} className="menu-item" onClick={() => pick({ providerId: p.providerId, model: m })}>
                      <span className="menu-item-text">{m}</span>
                      {p.isDefault && m === p.defaultModel ? <span className="menu-note">por defecto</span> : null}
                    </button>
                  ))
                ) : (
                  <button type="button" role="menuitem" aria-label={p.label} className="menu-item" onClick={() => pick({ providerId: p.providerId, model: null })}>
                    <span className="menu-item-text">{p.defaultModel ?? "Su modelo por defecto"}</span>
                    {p.isDefault ? <span className="menu-note">por defecto</span> : null}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}
    </span>
  );
}
