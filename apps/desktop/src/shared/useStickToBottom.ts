import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Margen en px dentro del cual se considera que se está «al final». */
const NEAR = 80;

/** El antepasado que hace scroll (la página, una columna…). */
export function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * Mantiene el scroll pegado al final mientras llega contenido, salvo que la
 * persona haya subido a leer: entonces no la arrastra y `away` pasa a `true`
 * para ofrecerle volver.
 */
export function useStickToBottom(anchor: RefObject<HTMLElement | null>, signal: unknown) {
  const pinned = useRef(true);
  const scroller = useRef<HTMLElement | null>(null);
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = scrollParent(anchor.current);
    scroller.current = el;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
      pinned.current = near;
      setAway(!near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [anchor]);

  const toBottom = useCallback(() => {
    const el = scroller.current ?? scrollParent(anchor.current);
    pinned.current = true;
    setAway(false);
    if (el) el.scrollTop = el.scrollHeight;
  }, [anchor]);

  useLayoutEffect(() => {
    const el = scroller.current ?? scrollParent(anchor.current);
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [anchor, signal]);

  return { away, toBottom };
}
