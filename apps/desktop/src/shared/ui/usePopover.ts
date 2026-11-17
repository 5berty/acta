import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Estado de un popover anclado a su disparador: se cierra con Esc o al pulsar
 * fuera, y al cerrarse devuelve el foco al disparador.
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<T>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  return { open, setOpen, close, root, trigger };
}
