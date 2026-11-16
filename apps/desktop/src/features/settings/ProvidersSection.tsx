import { useState } from "react";
import type { ProviderConfig, ProviderKind, ProviderTestResult, Settings } from "../../api";
import { Badge, Button } from "../../shared/ui/ui";
import { Field, NumberField, Section, Toggle } from "./fields";

type KindType = ProviderKind["type"];

const KIND_LABEL: Record<KindType, string> = {
  claudeCli: "Claude Code (CLI)",
  codexCli: "Codex (CLI)",
  openAiCompatible: "OpenAI compatible (incluye Ollama)",
  anthropic: "Anthropic (clave de API)",
};

export function newProvider(type: KindType, existing: ProviderConfig[]): ProviderConfig {
  let n = 1;
  while (existing.some((p) => p.id === `${type}-${n}`)) n += 1;
  const id = `${type}-${n}`;
  const base = { id, enabled: true, timeoutS: 600 };
  switch (type) {
    case "claudeCli":
      return { ...base, label: "Claude Code (CLI)", kind: { type, binaryPath: "", model: null, extraEnv: {} } };
    case "codexCli":
      return { ...base, label: "Codex (CLI)", kind: { type, binaryPath: "", model: null, extraEnv: {} } };
    case "openAiCompatible":
      return { ...base, label: "OpenAI compatible", kind: { type, baseUrl: "http://localhost:11434/v1", model: "", apiKey: null } };
    case "anthropic":
      return { ...base, label: "Anthropic", kind: { type, model: "", apiKey: { service: "acta", account: id } } };
  }
}

const envToText = (env: Record<string, string>): string =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
const textToEnv = (t: string): Record<string, string> =>
  Object.fromEntries(
    t
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as [string, string]),
  );

interface Props {
  llm: Settings["llm"];
  tests: Record<string, ProviderTestResult | "pending" | undefined>;
  onChange(llm: Settings["llm"]): void;
  onTest(id: string): void;
  onDetect(): void;
}

function ProviderCard({ p, result, onChange, onRemove, onTest }: { p: ProviderConfig; result: ProviderTestResult | "pending" | undefined; onChange(p: ProviderConfig): void; onRemove(): void; onTest(): void }) {
  const k = p.kind;
  const setKind = (kind: ProviderKind) => onChange({ ...p, kind });
  return (
    <div className="provider">
      <div className="provider-head">
        <input aria-label={`Nombre de ${p.label}`} className="title-input" value={p.label} onChange={(e) => onChange({ ...p, label: e.target.value })} />
        <Badge>{KIND_LABEL[k.type]}</Badge>
        <Toggle label={`Activar ${p.label}`} checked={p.enabled} onChange={(enabled) => onChange({ ...p, enabled })} />
      </div>
      {k.type === "claudeCli" || k.type === "codexCli" ? (
        <>
          <Field label="Ruta del binario">
            <input aria-label={`Ruta del binario de ${p.label}`} value={k.binaryPath} placeholder="/opt/homebrew/bin/claude" onChange={(e) => setKind({ ...k, binaryPath: e.target.value })} />
          </Field>
          <Field label="Modelo (opcional)">
            <input aria-label={`Modelo de ${p.label}`} value={k.model ?? ""} onChange={(e) => setKind({ ...k, model: e.target.value || null })} />
          </Field>
          <Field label="Variables de entorno extra" hint="Una por línea, p. ej. CLAUDE_CONFIG_DIR=/ruta. Nunca se tocan las credenciales del CLI.">
            <textarea aria-label={`Variables de entorno de ${p.label}`} rows={2} defaultValue={envToText(k.extraEnv)} onBlur={(e) => setKind({ ...k, extraEnv: textToEnv(e.target.value) })} />
          </Field>
        </>
      ) : null}
      {k.type === "openAiCompatible" ? (
        <>
          <Field label="URL base" hint="Ollama: http://localhost:11434/v1">
            <input aria-label="URL base de OpenAI compatible" value={k.baseUrl} onChange={(e) => setKind({ ...k, baseUrl: e.target.value })} />
          </Field>
          <Field label="Modelo">
            <input aria-label={`Modelo de ${p.label}`} value={k.model} onChange={(e) => setKind({ ...k, model: e.target.value })} />
          </Field>
          <Field label="Referencia de la clave (Llavero)" hint="La clave vive en el Llavero de macOS, nunca en los ajustes.">
            <input
              aria-label={`Cuenta del Llavero de ${p.label}`}
              value={k.apiKey?.account ?? ""}
              placeholder="Sin clave (p. ej. Ollama)"
              onChange={(e) => setKind({ ...k, apiKey: e.target.value ? { service: k.apiKey?.service ?? "acta", account: e.target.value } : null })}
            />
          </Field>
        </>
      ) : null}
      {k.type === "anthropic" ? (
        <>
          <Field label="Modelo">
            <input aria-label={`Modelo de ${p.label}`} value={k.model} onChange={(e) => setKind({ ...k, model: e.target.value })} />
          </Field>
          <Field label="Referencia de la clave (Llavero)" hint="La clave vive en el Llavero de macOS, nunca en los ajustes.">
            <input aria-label={`Cuenta del Llavero de ${p.label}`} value={k.apiKey.account} onChange={(e) => setKind({ ...k, apiKey: { ...k.apiKey, account: e.target.value } })} />
          </Field>
        </>
      ) : null}
      <NumberField label={`Tiempo máximo de ${p.label} (s)`} value={p.timeoutS} min={5} onChange={(timeoutS) => onChange({ ...p, timeoutS })} />
      <div className="provider-actions">
        <Button small onClick={onTest} aria-label={`Probar conexión ${p.label}`} disabled={result === "pending"}>
          Probar conexión
        </Button>
        <Button small variant="ghost" onClick={onRemove} aria-label={`Eliminar ${p.label}`}>
          Eliminar
        </Button>
        {result === "pending" ? <span className="muted">Probando…</span> : null}
        {result && result !== "pending" ? (
          <span role="status" className={result.ok ? "ok" : "error"}>
            {result.message}
            {result.latencyMs != null ? ` (${result.latencyMs} ms)` : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function ProvidersSection({ llm, tests, onChange, onTest, onDetect }: Props) {
  const [kind, setKind] = useState<KindType>("claudeCli");
  const enabled = llm.providers.filter((p) => p.enabled);
  const task = (label: string, aria: string, key: "minutesProvider" | "chatProvider" | "namingProvider") => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select aria-label={`Proveedor para ${aria}`} value={llm[key] ?? ""} onChange={(e) => onChange({ ...llm, [key]: e.target.value || null })}>
        <option value="">Sin asignar</option>
        {enabled.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Section title="Proveedores de IA" hint="Quién escribe las actas y responde en el chat. Por defecto, Claude Code en tu Mac.">
      <div className="stack">
        {llm.providers.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            result={tests[p.id]}
            onChange={(np) => onChange({ ...llm, providers: llm.providers.map((x) => (x.id === p.id ? np : x)) })}
            onRemove={() =>
              onChange({
                ...llm,
                providers: llm.providers.filter((x) => x.id !== p.id),
                minutesProvider: llm.minutesProvider === p.id ? null : llm.minutesProvider,
                chatProvider: llm.chatProvider === p.id ? null : llm.chatProvider,
                namingProvider: llm.namingProvider === p.id ? null : llm.namingProvider,
              })
            }
            onTest={() => onTest(p.id)}
          />
        ))}
      </div>
      <div className="inline-form">
        <select aria-label="Tipo de proveedor nuevo" value={kind} onChange={(e) => setKind(e.target.value as KindType)}>
          {(Object.keys(KIND_LABEL) as KindType[]).map((t) => (
            <option key={t} value={t}>
              {KIND_LABEL[t]}
            </option>
          ))}
        </select>
        <Button small onClick={() => onChange({ ...llm, providers: [...llm.providers, newProvider(kind, llm.providers)] })}>
          Añadir proveedor
        </Button>
        <Button small variant="ghost" onClick={onDetect}>
          Detectar CLI instalados
        </Button>
      </div>
      <h3>Proveedor por tarea</h3>
      <div className="three-col">
        {task("Acta", "el acta", "minutesProvider")}
        {task("Chat", "el chat", "chatProvider")}
        {task("Nombres de grupo", "los nombres de grupo", "namingProvider")}
      </div>
    </Section>
  );
}
