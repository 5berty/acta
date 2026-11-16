// Mando a distancia SOLO para desarrollo (VITE_ACTA_DEMO=1): permite recorrer la
// UI sin tocar el ratón para sacar capturas. Lee `node_modules/.acta-demo/remote.json`
// (lo sirve Vite) y ejecuta sus pasos cuando cambia `id`. No entra en producción.

type Step =
  | { click: string }
  | { type: string; text: string }
  | { key: string; meta?: boolean }
  | { overlay: string }
  | { scroll: number };

interface Script {
  id: string;
  /** "main" u "overlay": qué ventana lo ejecuta. */
  window?: string;
  steps: Step[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const label = (el: Element): string => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();

function find(name: string): HTMLElement | undefined {
  const all = [...document.querySelectorAll<HTMLElement>("button, [role=tab], [role=option], input, textarea, select")];
  return all.find((el) => label(el) === name) ?? all.find((el) => label(el).startsWith(name));
}

async function run(step: Step): Promise<void> {
  if ("click" in step) find(step.click)?.click();
  else if ("type" in step) {
    const el = find(step.type) as HTMLInputElement | undefined;
    if (!el) return;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, step.text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if ("key" in step) (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: step.key, metaKey: step.meta ?? false, bubbles: true }));
  else if ("overlay" in step) (window as unknown as { __actaDemo?: { setOverlay(s: string): void } }).__actaDemo?.setOverlay(step.overlay);
  else if ("scroll" in step) document.querySelector(".page")?.scrollTo({ top: step.scroll });
  await sleep(220);
}

export function startRemote(windowName: string): void {
  // El guion que ya estuviera al arrancar no se repite.
  let last: string | null = null;
  setInterval(() => {
    void fetch(`/node_modules/.acta-demo/remote.json?t=${Date.now()}`)
      .then((r) => (r.ok ? (r.json() as Promise<Script>) : null))
      .then(async (script) => {
        if (!script || script.id === last) return;
        const first = last === null;
        last = script.id;
        if (first) return;
        if (script.window && script.window !== windowName) return;
        for (const step of script.steps) await run(step);
      })
      .catch(() => {});
  }, 500);
}
