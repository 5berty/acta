import { Check, ChevronDown, RotateCw, Search, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { AvailableProvider } from "../../api";
import { Spinner, errorMessage } from "../../shared/ui/ui";
import { usePopover } from "../../shared/ui/usePopover";
import type { ChatModel, ModelChoice } from "./useChatModel";

interface Props {
  /** Quién responde ahora (lo que enseña el botón). */
  model: ChatModel;
  onPick(choice: ModelChoice): void;
  /** `llm_providers_available`: se pide al abrir. */
  loadProviders(): Promise<AvailableProvider[]>;
}

interface Row extends ModelChoice {
  text: string;
  name: string;
}

/** A partir de cuántos modelos compensa un filtro. */
const FILTER_FROM = 8;
const NO_PROVIDERS = "No hay proveedores de IA activados. Actívalos en Ajustes → Proveedores de IA.";
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function rowsOf(p: AvailableProvider): Row[] {
  if (p.models.length === 0) return [{ providerId: p.providerId, model: null, text: "Su modelo por defecto", name: `${p.label} · Su modelo por defecto` }];
  return p.models.map((m) => ({ providerId: p.providerId, model: m, text: m, name: `${p.label} · ${m}` }));
}

/**
 * Selector de proveedor y modelo del chat: el indicador del compositor es un
 * botón que abre, hacia arriba, la lista de proveedores activados. Lo elegido
 * vale para el siguiente mensaje, así que sigue disponible mientras llega una
 * respuesta.
 */
export function ModelPicker({ model, onPick, loadProviders }: Props) {
  const { open, setOpen, close, root, trigger } = usePopover<HTMLSpanElement>();
  const [providers, setProviders] = useState<AvailableProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    loadProviders().then(
      (p) => live && setProviders([...p]),
      (e) => {
        if (!live) return;
        setProviders(null);
        setError(errorMessage(e));
      },
    );
    return () => {
      live = false;
    };
    // Al abrir y al reintentar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  const total = useMemo(() => (providers ?? []).reduce((n, p) => n + Math.max(1, p.models.length), 0), [providers]);
  const filterable = total > FILTER_FROM;
  const q = filterable ? fold(query.trim()) : "";
  const groups = useMemo(
    () =>
      (providers ?? [])
        .map((p) => ({ provider: p, rows: rowsOf(p).filter((r) => !q || fold(r.name).includes(q)) }))
        .filter((g) => g.rows.length > 0),
    [providers, q],
  );
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const isCurrent = (r: Row, p: AvailableProvider) => r.providerId === model.providerId && (r.model === model.model || (model.model === null && r.model === p.defaultModel));

  // Al abrir (y al filtrar) la fila activa es la elegida, o la primera.
  useEffect(() => {
    if (!open) return;
    let at = -1;
    let i = 0;
    for (const g of groups) {
      for (const r of g.rows) {
        if (at < 0 && isCurrent(r, g.provider)) at = i;
        i += 1;
      }
    }
    setActive(q ? 0 : Math.max(0, at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groups]);

  // El foco va al filtro si lo hay; si no, a la lista. Nunca se queda en el botón.
  useEffect(() => {
    if (!open) return;
    (filterable ? input.current : list.current)?.focus();
  }, [open, filterable, providers, error]);

  useEffect(() => {
    if (!open || active < 0) return;
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);

  const toggle = () => {
    if (!open) setQuery("");
    setOpen(!open);
  };
  const choose = (r: Row | undefined) => {
    if (!r) return;
    close();
    onPick({ providerId: r.providerId, model: r.model });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Dentro del formulario del compositor: Intro aquí elige modelo, no envía.
    if (e.key === "Enter") {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      choose(rows[active]);
      return;
    }
    const last = rows.length - 1;
    const to = e.key === "ArrowDown" ? Math.min(last, active + 1) : e.key === "ArrowUp" ? Math.max(0, active - 1) : e.key === "Home" && !filterable ? 0 : e.key === "End" && !filterable ? last : null;
    if (to === null) return;
    e.preventDefault();
    setActive(to);
  };

  const label = model.label ?? "Modelo de IA";
  const activeId = active >= 0 && active < rows.length ? `${id}-${active}` : undefined;
  let n = 0;

  return (
    <span className="model-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`composer-model${model.missing ? " composer-model-warn" : ""}`}
        aria-label={`Modelo de IA: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Quién responde al siguiente mensaje"
        onClick={toggle}
      >
        {model.missing ? <TriangleAlert size={11} strokeWidth={2.3} aria-hidden /> : <Sparkles size={11} strokeWidth={2.2} aria-hidden />}
        <span className="composer-model-label">{model.label ?? ""}</span>
        <ChevronDown className="composer-model-chevron" size={11} strokeWidth={2.6} aria-hidden />
      </button>
      {open ? (
        <div className="menu glass-thick model-pop" onKeyDown={onKeyDown}>
          {filterable ? (
            <label className="model-filter">
              <Search size={13} strokeWidth={2.2} aria-hidden />
              <input
                ref={input}
                type="text"
                role="combobox"
                aria-label="Filtrar modelos"
                aria-expanded
                aria-controls={`${id}-list`}
                aria-activedescendant={activeId}
                aria-autocomplete="list"
                autoComplete="off"
                spellCheck={false}
                placeholder="Filtrar modelos…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          ) : null}
          {error !== null ? (
            <div className="model-state">
              <p role="alert" className="model-error">
                <TriangleAlert size={14} strokeWidth={2.1} aria-hidden />
                <span>{error}</span>
              </p>
              <button type="button" className="menu-item model-retry" onClick={() => setAttempt((a) => a + 1)}>
                <RotateCw size={12} strokeWidth={2.2} aria-hidden />
                Reintentar
              </button>
            </div>
          ) : providers === null ? (
            <p className="menu-empty" role="status">
              <Spinner /> Buscando modelos…
            </p>
          ) : providers.length === 0 ? (
            <p className="menu-empty model-none">{NO_PROVIDERS}</p>
          ) : (
            <div ref={list} id={`${id}-list`} role="listbox" aria-label="Modelo de IA" aria-activedescendant={filterable ? undefined : activeId} tabIndex={-1} className="model-list">
              {rows.length === 0 ? <p className="menu-empty">Ningún modelo coincide con «{query.trim()}».</p> : null}
              {groups.map(({ provider: p, rows: rs }) => (
                <div key={p.providerId} role="group" aria-label={p.label} className="menu-group">
                  <p className="menu-group-label model-group-label">
                    <span className="menu-item-text">{p.label}</span>
                    {p.defaultFor.includes("chat") ? <span className="menu-note">por defecto</span> : null}
                  </p>
                  {rs.map((r) => {
                    const i = n++;
                    const selected = isCurrent(r, p);
                    return (
                      <div
                        key={r.model ?? ""}
                        id={`${id}-${i}`}
                        role="option"
                        aria-label={r.name}
                        aria-selected={selected}
                        data-active={i === active || undefined}
                        className="menu-item model-option"
                        onMouseMove={() => i !== active && setActive(i)}
                        onClick={() => choose(r)}
                      >
                        <span className="model-check" aria-hidden>
                          {selected ? <Check size={12} strokeWidth={2.8} /> : null}
                        </span>
                        <span className="menu-item-text">{r.text}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}
