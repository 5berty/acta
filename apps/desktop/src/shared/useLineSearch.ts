import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { findRanges, type Range } from "./textSearch";

export interface SearchLine {
  id: string | number;
  text: string;
  /** Momento de la línea (ms), para saltar el audio. */
  at: number;
}

/** Lo que devuelve una búsqueda del backend: basta con saber qué líneas son. */
export interface RemoteMatch {
  utteranceId: string | number;
  startMs: number;
  /** Tramos `[inicio, fin)` dentro del texto de la línea, si el backend los da. */
  ranges?: [number, number][];
}

export interface LineHit {
  lineId: string | number;
  range: Range;
  at: number;
}

interface Options {
  /** Búsqueda del backend. `null` (o un fallo) = filtrar solo en cliente. */
  remote?: (query: string) => Promise<RemoteMatch[] | null>;
  /** Al ir a otra coincidencia con siguiente/anterior. */
  onJump?: (hit: LineHit) => void;
}

/**
 * Búsqueda dentro de una lista de líneas (transcript, directo): coincidencias
 * resaltables, cursor con siguiente/anterior y ⌘F para ir al campo.
 */
export function useLineSearch(lines: SearchLine[], { remote, onJump }: Options = {}) {
  const [query, setQueryState] = useState("");
  const [cursor, setCursor] = useState(0);
  const [found, setFound] = useState<{ q: string; matches: RemoteMatch[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const remoteRef = useRef(remote);
  remoteRef.current = remote;

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setCursor(0);
  }, []);

  useEffect(() => {
    const search = remoteRef.current;
    if (!search || q.length < 2) {
      setFound(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      search(q).then(
        (matches) => live && setFound(matches ? { q, matches } : null),
        () => live && setFound(null),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);

  const hits = useMemo<LineHit[]>(() => {
    if (!q) return [];
    const remote = found?.q === q ? found.matches : [];
    return lines.flatMap((line) => {
      let ranges = findRanges(line.text, q);
      if (ranges.length === 0 && line.text) {
        // El backend puede encontrar lo que el texto literal no (otra forma de la palabra):
        // se usan sus tramos o, si no los da, se marca la línea entera.
        const m = remote.find((x) => String(x.utteranceId) === String(line.id) || x.startMs === line.at);
        if (m) ranges = m.ranges?.length ? m.ranges.filter(([a, b]) => a < b && b <= line.text.length) : [[0, line.text.length]];
        if (m && ranges.length === 0) ranges = [[0, line.text.length]];
      }
      return ranges.map((range) => ({ lineId: line.id, range, at: line.at }));
    });
  }, [lines, q, found]);

  const index = hits.length === 0 ? 0 : Math.min(cursor, hits.length - 1);
  const current = hits[index] ?? null;

  const go = useCallback(
    (delta: number) => {
      if (hits.length === 0) return;
      const next = (index + delta + hits.length) % hits.length;
      setCursor(next);
      const hit = hits[next];
      if (hit) onJump?.(hit);
    },
    [hits, index, onJump],
  );

  // La coincidencia actual siempre a la vista.
  useEffect(() => {
    if (current) container.current?.querySelector("mark.hit-active")?.scrollIntoView?.({ block: "center" });
  }, [current?.lineId, current?.range[0], q]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tramos de una línea y cuál de ellos es el actual (-1 si ninguno). */
  const rangesFor = useCallback(
    (lineId: string | number): { ranges: Range[]; activeIndex: number } => {
      const mine = hits.filter((h) => h.lineId === lineId);
      return { ranges: mine.map((h) => h.range), activeIndex: current && current.lineId === lineId ? mine.indexOf(current) : -1 };
    },
    [hits, current],
  );

  return { query, setQuery, hits, index, count: hits.length, next: () => go(1), prev: () => go(-1), rangesFor, input, container, active: q.length > 0 };
}

/** ⌘F (o Ctrl+F) lleva el foco al campo de búsqueda de la vista. */
export function useFindShortcut(input: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f" && input.current) {
        e.preventDefault();
        input.current.focus();
        input.current.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [input]);
}
