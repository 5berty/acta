import { Check, Plus, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, Spinner } from "./ui";
import { usePopover } from "./usePopover";

export interface PickerItem {
  id: string;
  /** Nombre accesible y texto principal. */
  title: string;
  /** Contenido de la fila; si falta, se pinta el título. */
  content?: ReactNode;
  icon?: ReactNode;
  /** Ya añadido: sale marcado y no se puede elegir. */
  disabled?: boolean;
}

interface Props {
  /** Texto del disparador y nombre del diálogo. */
  label: string;
  icon?: ReactNode;
  searchLabel: string;
  placeholder: string;
  items: PickerItem[];
  query: string;
  onQuery(q: string): void;
  loading?: boolean;
  emptyText: string;
  /** «Añadir 2 reuniones». Con 0 es el texto del botón desactivado. */
  confirmLabel(n: number): string;
  onConfirm(ids: string[]): void | Promise<void>;
  /** Fila «Crear … «texto»»: devuelve el id creado, que queda marcado. */
  create?: { label(q: string): string; run(q: string): Promise<string | null> } | null;
  onOpen?(): void;
  align?: "start" | "end";
}

/**
 * Selector con buscador: lista con casillas, selección múltiple y un botón
 * para confirmar. Sirve para añadir reuniones a un grupo y grupos a una reunión.
 * Teclado: ↑↓ mueven, ↩ marca, ⌘↩ confirma, Esc cierra.
 */
export function PickerPopover({ label, icon, searchLabel, placeholder, items, query, onQuery, loading, emptyText, confirmLabel, onConfirm, create, onOpen, align = "end" }: Props) {
  const { open, setOpen, close, root, trigger } = usePopover<HTMLSpanElement>();
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const rows = create ? [...items, { id: "__create__", title: create.label(query.trim()) }] : items;
  const index = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => {
    if (open) {
      setSelected([]);
      setActive(0);
      onQuery("");
      onOpen?.();
    }
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const toggle = (item: PickerItem) => {
    if (item.id === "__create__") {
      if (!create || busy) return;
      setBusy(true);
      void create
        .run(query.trim())
        .then((id) => {
          if (id) setSelected((prev) => (prev.includes(id) ? prev : [...prev, id]));
          onQuery("");
        })
        .finally(() => setBusy(false));
      return;
    }
    if (item.disabled) return;
    setSelected((prev) => (prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id]));
  };

  const confirm = () => {
    if (selected.length === 0 || busy) return;
    // En el orden en que se ven, no en el que se marcaron.
    const order = new Map(items.map((it, i) => [it.id, i]));
    const ids = [...selected].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
    setBusy(true);
    void Promise.resolve(onConfirm(ids)).finally(() => {
      setBusy(false);
      close();
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(rows.length - 1, index + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(0, index - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) confirm();
      else if (rows[index]) toggle(rows[index]);
    }
  };

  return (
    <span className="picker" ref={root}>
      <Button ref={trigger} small capsule icon={icon ?? <Plus size={12} strokeWidth={2.6} aria-hidden />} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open ? (
        <div role="dialog" aria-label={label} className={`picker-pop glass-thick picker-${align}`} onKeyDown={onKeyDown}>
          <div className="picker-search">
            <Search size={15} strokeWidth={2} aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-label={searchLabel}
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={rows[index] ? `${listId}-${rows[index].id}` : undefined}
              placeholder={placeholder}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
            {loading ? <Spinner /> : null}
          </div>
          <ul id={listId} role="listbox" aria-label={label} aria-multiselectable="true" className="picker-list" ref={listRef}>
            {rows.length === 0 ? <li className="picker-empty">{loading ? "Buscando…" : emptyText}</li> : null}
            {rows.map((item, i) => {
              const isCreate = item.id === "__create__";
              const checked = item.disabled || selected.includes(item.id);
              return (
                <li
                  key={item.id}
                  id={`${listId}-${item.id}`}
                  role="option"
                  aria-label={item.title}
                  aria-selected={isCreate ? false : checked}
                  aria-disabled={item.disabled || undefined}
                  data-active={i === index || undefined}
                  className={`picker-item${isCreate ? " picker-create" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => toggle(item)}
                >
                  {isCreate ? (
                    <span className="picker-check picker-check-add" aria-hidden>
                      <Plus size={12} strokeWidth={2.8} />
                    </span>
                  ) : (
                    <span className="picker-check" data-on={checked || undefined} aria-hidden>
                      {checked ? <Check size={11} strokeWidth={3.2} /> : null}
                    </span>
                  )}
                  {item.icon ? <span className="picker-icon">{item.icon}</span> : null}
                  <span className="picker-body">{item.content ?? <span className="picker-title">{item.title}</span>}</span>
                </li>
              );
            })}
          </ul>
          <div className="picker-foot">
            <span className="picker-keys" aria-hidden>
              <span className="kbd">↩</span> marcar <span className="kbd">⌘↩</span> añadir
            </span>
            <span className="spacer" />
            <Button small capsule variant="primary" disabled={selected.length === 0 || busy} onClick={confirm}>
              {confirmLabel(selected.length)}
            </Button>
          </div>
        </div>
      ) : null}
    </span>
  );
}
