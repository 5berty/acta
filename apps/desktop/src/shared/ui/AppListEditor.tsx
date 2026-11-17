import { AppWindow, Plus, RotateCw, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { InstalledApp } from "../../api";
import { appDisplayName } from "../format";
import { Button, Disclosure, IconButton, Spinner, StatusDot } from "./ui";
import { usePopover } from "./usePopover";

/** Las apps de este Mac: `apps` es `null` mientras se buscan o si no se pudieron leer (`error`). */
export interface AppsSource {
  apps: InstalledApp[] | null;
  error: string | null;
  reload(): void;
  /** De la ruta del PNG del icono a algo que un `<img>` pueda cargar. */
  iconUrl(path: string): string;
}

export interface AppListEntry {
  bundleId: string;
  /** Texto secundario delante del identificador («Teams · en el navegador»). */
  detail?: string;
  /** Qué pintar si la app no tiene icono (no está instalada o no se pudo sacar). */
  fallbackIcon?: ReactNode;
}

export interface PickedApp {
  bundleId: string;
  name: string;
}

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
/** Forma de un bundle id: al menos dos partes separadas por puntos, sin espacios (`com.empresa.app`). */
export const isBundleId = (text: string): boolean => /^[A-Za-z0-9-]+(\.[A-Za-z0-9_-]+)+$/.test(text);

/** Icono de una app. El PNG ya trae sus esquinas: no se recorta. Si falta o no carga, un icono genérico. */
export function AppIcon({ src, size = 28, fallback }: { src: string | null; size?: number; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    if (fallback) return <>{fallback}</>;
    return (
      <span className="app-icon app-icon-glyph" style={{ width: size, height: size }} aria-hidden>
        <AppWindow size={Math.round(size * 0.58)} strokeWidth={1.9} />
      </span>
    );
  }
  return <img className="app-icon" src={src} width={size} height={size} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
}

interface PickerProps {
  /** Nombre de la lista a la que se añade. */
  listTitle: string;
  label: string;
  source: AppsSource;
  taken: string[];
  onPick(app: PickedApp): void;
}

/**
 * Selector de apps instaladas: buscador, las que están en marcha primero y las
 * ya añadidas desactivadas. Elegir una la añade en el acto.
 * Teclado: ↑↓ mueven, ↩ añade, Esc cierra.
 */
function AppPicker({ listTitle, label, source, taken, onPick }: PickerProps) {
  const { open, setOpen, close, root, trigger } = usePopover<HTMLSpanElement>();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const q = fold(query.trim());
  const rows = (source.apps ?? [])
    .filter((a) => !q || fold(a.name).includes(q) || a.bundleId.toLowerCase().includes(q))
    .sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  const index = Math.min(active, Math.max(0, rows.length - 1));
  const isTaken = (a: InstalledApp) => taken.some((id) => sameId(id, a.bundleId));

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    // Cerca del final de la página el selector quedaría cortado: se trae a la vista.
    popRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView?.({ block: "nearest" });
  }, [index]);

  const pick = (a: InstalledApp | undefined) => {
    if (!a || isTaken(a)) return;
    onPick({ bundleId: a.bundleId, name: appDisplayName(a.bundleId, a.name) });
    close();
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
      pick(rows[index]);
    }
  };

  const loading = !source.apps && !source.error;
  return (
    <span className="picker" ref={root}>
      <Button ref={trigger} small capsule icon={<Plus size={12} strokeWidth={2.6} aria-hidden />} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open ? (
        <div ref={popRef} role="dialog" aria-label={`${label}: ${listTitle}`} className="picker-pop glass-thick picker-start app-picker" onKeyDown={onKeyDown}>
          <div className="picker-search">
            <Search size={15} strokeWidth={2} aria-hidden />
            <input
              autoFocus
              role="combobox"
              aria-label="Buscar app"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={rows[index] ? `${listId}-${index}` : undefined}
              placeholder="Buscar entre las apps de este Mac"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {loading ? <Spinner /> : null}
          </div>
          {source.error ? (
            <div className="picker-empty app-picker-error">
              <p role="alert" className="error">
                No se han podido leer las apps de este Mac: {source.error}
              </p>
              <Button small capsule icon={<RotateCw size={12} strokeWidth={2.2} aria-hidden />} onClick={source.reload}>
                Reintentar
              </Button>
            </div>
          ) : (
            <ul id={listId} role="listbox" aria-label={`${label}: ${listTitle}`} className="picker-list" ref={listRef}>
              {loading ? <li className="picker-empty">Buscando las apps de este Mac…</li> : null}
              {!loading && rows.length === 0 ? (
                <li className="picker-empty">{q ? "Ninguna app coincide. Si no aparece, añádela por su identificador en «Avanzado»." : "No se ha encontrado ninguna app. Añádela por su identificador en «Avanzado»."}</li>
              ) : null}
              {rows.map((a, i) => {
                const disabled = isTaken(a);
                return (
                  <li
                    key={a.bundleId}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-label={a.name}
                    aria-selected={i === index}
                    aria-disabled={disabled || undefined}
                    data-active={i === index || undefined}
                    className="picker-item app-picker-item"
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(a)}
                  >
                    <AppIcon src={a.iconPath ? source.iconUrl(a.iconPath) : null} size={26} />
                    <span className="app-picker-text">
                      <span className="picker-title">{a.name}</span>
                      <span className="picker-meta">{a.bundleId}</span>
                    </span>
                    {disabled ? (
                      <span className="app-picker-state">Ya añadida</span>
                    ) : a.running ? (
                      <span className="app-picker-state">
                        <StatusDot tone="ok" />
                        En marcha
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </span>
  );
}

interface Props {
  /** Título del grupo y nombre accesible de la lista. */
  title: string;
  foot?: ReactNode;
  entries: AppListEntry[];
  source: AppsSource;
  emptyText: string;
  addLabel?: string;
  removeLabel(name: string): string;
  /** Apps que se proponen con un toque (ya filtradas por quien usa la lista). */
  suggestions?: InstalledApp[];
  suggestLabel?(name: string): string;
  onPick(app: PickedApp): void;
  /** Al tocar una sugerencia; si falta, se trata como cualquier otra elección. */
  onSuggestion?(app: PickedApp): void;
  onRemove(bundleId: string): void;
  /** Un paso más tras elegir (p. ej. qué tipo de reunión es): se pinta como última fila. */
  children?: ReactNode;
}

/**
 * Lista editable de apps por su bundle id: filas con icono y nombre, un
 * selector de apps instaladas, sugerencias de un toque y, en «Avanzado», el
 * identificador a mano. No guarda nada: avisa con `onPick` y `onRemove`.
 */
export function AppListEditor({ title, foot, entries, source, emptyText, addLabel = "Añadir app", removeLabel, suggestions = [], suggestLabel = (n) => `Añadir ${n}`, onPick, onSuggestion = onPick, onRemove, children }: Props) {
  const [manual, setManual] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const installed = (bundleId: string) => source.apps?.find((a) => sameId(a.bundleId, bundleId));
  const nameOf = (bundleId: string) => appDisplayName(bundleId, installed(bundleId)?.name);
  const taken = entries.map((e) => e.bundleId);

  const addManual = () => {
    const id = manual.trim();
    if (!id) return setProblem("Escribe el identificador de la app, por ejemplo com.empresa.app.");
    if (!isBundleId(id)) return setProblem("Eso no parece un identificador de app. Tiene esta forma: com.empresa.app, sin espacios.");
    const dup = taken.find((t) => sameId(t, id));
    if (dup) return setProblem(`${nameOf(dup)} ya está en la lista.`);
    // Si está instalada, se guarda con las mayúsculas que usa el sistema.
    const app = installed(id);
    onPick({ bundleId: app?.bundleId ?? id, name: nameOf(app?.bundleId ?? id) });
    setManual("");
    setProblem(null);
  };

  return (
    <div className="settings-group app-list" role="group" aria-label={title}>
      <p className="group-title">{title}</p>
      <ul className="plain group">
        {entries.length === 0 ? (
          <li className="row">
            <span className="row-text">
              <span className="row-label muted">{emptyText}</span>
            </span>
          </li>
        ) : null}
        {entries.map((e) => {
          const app = installed(e.bundleId);
          const name = nameOf(e.bundleId);
          return (
            <li key={e.bundleId} aria-label={name} className="row app-row">
              <AppIcon src={app?.iconPath ? source.iconUrl(app.iconPath) : null} fallback={e.fallbackIcon} />
              <span className="row-text">
                <span className="row-label">{name}</span>
                <span className="row-hint app-row-meta">
                  {e.detail ? <span>{e.detail}</span> : null}
                  <span className="app-row-id selectable">{e.bundleId}</span>
                </span>
              </span>
              <IconButton small label={removeLabel(name)} onClick={() => onRemove(e.bundleId)}>
                <X size={13} strokeWidth={2.2} aria-hidden />
              </IconButton>
            </li>
          );
        })}
        {children ? <li className="app-list-step">{children}</li> : null}
      </ul>
      <div className="app-list-bar">
        <AppPicker listTitle={title} label={addLabel} source={source} taken={taken} onPick={onPick} />
        {suggestions.map((a) => {
          const name = appDisplayName(a.bundleId, a.name);
          return (
            <button key={a.bundleId} type="button" className="chip app-chip" aria-label={suggestLabel(name)} onClick={() => onSuggestion({ bundleId: a.bundleId, name })}>
              <AppIcon src={a.iconPath ? source.iconUrl(a.iconPath) : null} size={20} fallback={<Plus size={11} strokeWidth={2.6} aria-hidden />} />
              <span>{suggestLabel(name)}</span>
            </button>
          );
        })}
      </div>
      {foot ? <p className="group-foot">{foot}</p> : null}
      <div className="app-list-advanced">
        <Disclosure label="Avanzado" ariaLabel={`Avanzado de ${title}`}>
          <div className="card advanced">
            <div className="field">
              <span className="field-label">Añadir por identificador</span>
              <div className="field-line">
                <input
                  className="input-mono"
                  aria-label="Identificador de la app"
                  aria-invalid={problem ? true : undefined}
                  placeholder="com.empresa.app"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={manual}
                  onChange={(e) => {
                    setManual(e.target.value);
                    setProblem(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManual();
                    }
                  }}
                />
                <Button small aria-label="Añadir por identificador" onClick={addManual}>
                  Añadir
                </Button>
              </div>
              {problem ? (
                <span role="alert" className="error">
                  {problem}
                </span>
              ) : (
                <span className="field-hint">
                  Para una app que no sale en la lista. Su identificador (bundle id) se ve en Terminal con: <code className="selectable">osascript -e 'id of app "Nombre"'</code>
                </span>
              )}
            </div>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}
