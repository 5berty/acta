import { Fragment, type ReactNode } from "react";
import type { Citation } from "../api";
import { useApi } from "../app/ApiContext";
import { formatClock } from "./format";

// Markdown pequeño y seguro para actas y respuestas del chat: encabezados,
// listas (numeradas, anidadas), tablas, citas, código, enlaces y énfasis.
// No interpreta HTML: todo pasa por React, que lo escapa. Tolera texto a
// medias (streaming): un bloque de código sin cerrar se pinta igual.

interface Ctx {
  citations: Citation[];
  onCitation?: (c: Citation) => void;
  openUrl(url: string): void;
}

export const citationLabel = (c: Citation): string => `${c.meetingTitle}, ${formatClock(c.at)}`;

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\([^)\s]+\)|\[\d+\])/g;
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function inline(text: string, ctx: Ctx): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.length > 4 && ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__")))) return <strong key={i}>{inline(part.slice(2, -2), ctx)}</strong>;
    if (part.length > 4 && part.startsWith("~~") && part.endsWith("~~")) return <del key={i}>{inline(part.slice(2, -2), ctx)}</del>;
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) return <em key={i}>{inline(part.slice(1, -1), ctx)}</em>;
    const cite = /^\[(\d+)\]$/.exec(part);
    if (cite) {
      const c = ctx.citations.find((x) => x.n === Number(cite[1]));
      if (!c || !ctx.onCitation) return part;
      const label = citationLabel(c);
      return (
        <button key={i} type="button" className="cite" aria-label={`Cita ${c.n}: ${label}`} title={label} onClick={() => ctx.onCitation?.(c)}>
          {c.n}
        </button>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label = "", url = ""] = link;
      if (!SAFE_URL.test(url)) return <Fragment key={i}>{label}</Fragment>;
      return (
        <a
          key={i}
          href={url}
          rel="noreferrer noopener"
          onClick={(e) => {
            // Nunca se navega dentro de la ventana de acta.
            e.preventDefault();
            ctx.openUrl(url);
          }}
        >
          {label}
        </a>
      );
    }
    return part;
  });
}

interface ListItem {
  indent: number;
  ordered: boolean;
  text: string;
}

function list(items: ListItem[], ctx: Ctx, key: string): ReactNode {
  const base = items[0]?.indent ?? 0;
  const ordered = items[0]?.ordered ?? false;
  const nodes: ReactNode[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i]!;
    let j = i + 1;
    while (j < items.length && items[j]!.indent > base) j += 1;
    const children = items.slice(i + 1, j);
    nodes.push(
      <li key={i}>
        {inline(item.text, ctx)}
        {children.length > 0 ? list(children, ctx, `${key}-${i}`) : null}
      </li>,
    );
    i = j;
  }
  return ordered ? <ol key={key}>{nodes}</ol> : <ul key={key}>{nodes}</ul>;
}

const cells = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function blocks(source: string, ctx: Ctx): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      out.push(<p key={out.length}>{inline(para.join("\n"), ctx)}</p>);
      para = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? "").trimEnd();
    const fence = /^\s*(```|~~~)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith(fence[1]!)) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1;
      out.push(
        <pre key={out.length} data-lang={fence[2] || undefined}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const Tag = heading[1]!.length <= 2 ? "h3" : "h4";
      out.push(<Tag key={out.length}>{inline(heading[2] ?? "", ctx)}</Tag>);
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push(<hr key={out.length} />);
      i += 1;
      continue;
    }
    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "")) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim()) {
        rows.push(cells(lines[i] ?? ""));
        i += 1;
      }
      out.push(
        <div key={out.length} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((h, k) => (
                  <th key={k}>{inline(h, ctx)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>
                  {head.map((_, c) => (
                    <td key={c}>{inline(r[c] ?? "", ctx)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(<blockquote key={out.length}>{blocks(quote.join("\n"), ctx)}</blockquote>);
      continue;
    }
    if (BULLET.test(line)) {
      flush();
      const items: ListItem[] = [];
      while (i < lines.length) {
        const raw = lines[i] ?? "";
        const m = BULLET.exec(raw);
        if (m) items.push({ indent: (m[1] ?? "").replace(/\t/g, "  ").length, ordered: /\d/.test(m[2] ?? ""), text: m[3] ?? "" });
        else if (raw.trim() && /^\s{2,}/.test(raw) && items.length > 0) items[items.length - 1]!.text += `\n${raw.trim()}`;
        else break;
        i += 1;
      }
      out.push(list(items, ctx, `l${out.length}`));
      continue;
    }
    para.push(line);
    i += 1;
  }
  flush();
  return out;
}

interface Props {
  source: string;
  /** Con citas, cada `[n]` conocido es un botón que salta a ese momento. */
  citations?: Citation[];
  onCitation?: (c: Citation) => void;
}

export function Markdown({ source, citations = [], onCitation }: Props) {
  const api = useApi();
  const ctx: Ctx = { citations, onCitation, openUrl: (url) => void api.openExternalUrl(url) };
  return <div className="md">{blocks(source, ctx)}</div>;
}
