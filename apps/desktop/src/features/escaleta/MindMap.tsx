import type { Escaleta, Tema } from "../../api";
import { formatClock, speakerColor } from "../../shared/format";

interface Placed {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  color: string;
  at: number | null;
  parent: Placed | null;
}

const COL_W = 264;
const NODE_W = 224;
const ROW_H = 46;
const PAD = 20;

/** Árbol horizontal: las hojas ocupan filas sucesivas y cada padre se centra en sus hijos. */
export function layoutMindMap(escaleta: Escaleta, title: string): { nodes: Placed[]; width: number; height: number } {
  const nodes: Placed[] = [];
  let row = 0;
  let maxDepth = 0;
  const place = (tema: Tema | null, label: string, id: string, depth: number, color: string, parent: Placed | null, children: Tema[]): Placed => {
    const node: Placed = { id, label, depth, x: PAD + depth * COL_W, y: 0, color, at: tema ? tema.inicio_ms : null, parent };
    nodes.push(node);
    maxDepth = Math.max(maxDepth, depth);
    if (children.length === 0) {
      node.y = PAD + row * ROW_H;
      row += 1;
    } else {
      const kids = children.map((c, i) => place(c, c.titulo, `${id}.${i + 1}`, depth + 1, depth === 0 ? speakerColor(i) : color, node, c.subtemas));
      node.y = ((kids[0]?.y ?? 0) + (kids[kids.length - 1]?.y ?? 0)) / 2;
    }
    return node;
  };
  place(null, title, "0", 0, "var(--accent)", null, escaleta.temas);
  return { nodes, width: PAD * 2 + maxDepth * COL_W + NODE_W, height: PAD * 2 + Math.max(1, row) * ROW_H - (ROW_H - 34) };
}

/** Mapa mental de la escaleta. Cada nodo salta a su minuto. */
export function MindMap({ escaleta, title, onSeek }: { escaleta: Escaleta; title: string; onSeek(ms: number): void }) {
  const { nodes, width, height } = layoutMindMap(escaleta, title);
  return (
    <div className="mindmap card" role="group" aria-label="Mapa de la escaleta">
      <div className="mindmap-canvas" style={{ width, height }}>
        <svg width={width} height={height} aria-hidden>
          {nodes.map((n) => {
            if (!n.parent) return null;
            const x1 = n.parent.x + NODE_W;
            const y1 = n.parent.y + 17;
            const x2 = n.x;
            const y2 = n.y + 17;
            const mid = (x1 + x2) / 2;
            return <path key={n.id} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" stroke={n.color} strokeOpacity={0.45} strokeWidth={1.6} />;
          })}
        </svg>
        {nodes.map((n) =>
          n.at == null ? (
            <span key={n.id} className="mm-node mm-root" style={{ left: n.x, top: n.y, width: NODE_W }}>
              {n.label}
            </span>
          ) : (
            <button
              key={n.id}
              type="button"
              className={`mm-node mm-depth-${Math.min(n.depth, 2)}`}
              style={{ left: n.x, top: n.y, width: NODE_W, ["--c" as string]: n.color }}
              aria-label={`${n.label} (${formatClock(n.at)})`}
              title={`${n.label} · ${formatClock(n.at)}`}
              onClick={() => onSeek(n.at ?? 0)}
            >
              <span className="mm-dot" aria-hidden />
              <span className="mm-label">{n.label}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}
