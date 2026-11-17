// Búsqueda de texto sin distinguir mayúsculas ni tildes, y resaltado.
// La usan el transcript, la vista en directo y los selectores.

export type Range = [start: number, end: number];

const foldChar = (ch: string): string => ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** «Reunión» → «reunion». */
export const fold = (s: string): string => Array.from(s, foldChar).join("");

/** Texto plegado y, por cada carácter plegado, su posición en el original. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k += 1) map.push(i);
    folded += f;
    i += ch.length;
  }
  map.push(text.length);
  return { folded, map };
}

/** Tramos `[inicio, fin)` de `text` que coinciden con `query`. */
export function findRanges(text: string, query: string): Range[] {
  const q = fold(query.trim());
  if (!q) return [];
  const { folded, map } = foldWithMap(text);
  const out: Range[] = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(q, from);
    if (at < 0) break;
    let end = map[at + q.length] ?? text.length;
    // Las marcas combinantes que siguen pertenecen a la última letra.
    while (end < text.length && foldChar(text[end] ?? "") === "") end += 1;
    out.push([map[at] ?? 0, end]);
    from = at + q.length;
  }
  return out;
}

export const matches = (text: string, query: string): boolean => fold(text).includes(fold(query.trim()));

/** Texto con los tramos marcados. `active` pinta la coincidencia en la que está el cursor de búsqueda. */
export function Highlight({ text, ranges, active = false }: { text: string; ranges: Range[]; active?: boolean }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let last = 0;
  ranges.forEach(([a, b], i) => {
    if (a > last) parts.push(text.slice(last, a));
    parts.push(
      <mark key={i} className={active ? "hit hit-active" : "hit"}>
        {text.slice(a, b)}
      </mark>,
    );
    last = b;
  });
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
