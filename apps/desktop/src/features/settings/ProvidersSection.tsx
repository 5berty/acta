import { useEffect, useState } from "react";
import type { ProviderConfig, SecretRef, ProviderKind, ProviderTestResult, Settings } from "../../api";
import { Badge, Button, errorMessage } from "../../shared/ui/ui";
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
      return { ...base, label: "Claude Code (CLI)", kind: { type, binaryPath: "", model: null, effort: null, extraEnv: {} } };
    case "codexCli":
      return { ...base, label: "Codex (CLI)", kind: { type, binaryPath: "", model: null, extraEnv: {} } };
    case "openAiCompatible":
      return { ...base, label: "OpenAI compatible", kind: { type, baseUrl: "http://localhost:11434/v1", model: "", apiKey: null } };
    case "anthropic":
      return { ...base, label: "Anthropic", kind: { type, model: "", apiKey: { service: "acta", account: `provider:${id}` } } };
  }
}

const EFFORTS: { v: string; l: string }[] = [
  { v: "", l: "Por defecto" },
  { v: "low", l: "Bajo" },
  { v: "medium", l: "Medio" },
  { v: "high", l: "Alto" },
  { v: "xhigh", l: "Muy alto" },
  { v: "max", l: "Máximo" },
];

type EnvRow = [string, string];
const envToRows = (env: Record<string, string>): EnvRow[] => Object.entries(env);
const rowsToEnv = (rows: EnvRow[]): Record<string, string> => Object.fromEntries(rows.filter(([k]) => k.trim() !== "").map(([k, v]) => [k.trim(), v]));

/** Filas clave/valor. Las filas sin nombre viven solo en local hasta que se rellenan. */
function EnvEditor({ label, env, onChange }: { label: string; env: Record<string, string>; onChange(env: Record<string, string>): void }) {
  const [rows, setRows] = useState<EnvRow[]>(() => envToRows(env));
  const serialized = JSON.stringify(env);
  useEffect(() => {
    setRows((current) => (JSON.stringify(rowsToEnv(current)) === serialized ? current : envToRows(env)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);
  const commit = (next: EnvRow[]) => {
    setRows(next);
    onChange(rowsToEnv(next));
  };
  return (
    <Field label="Variables de entorno extra" hint="Las que fija tu alias, p. ej. CLAUDE_CONFIG_DIR=/Users/tú/.claude-personal. Nunca se tocan las credenciales del CLI.">
      <ul className="plain env-rows">
        {rows.map(([k, v], i) => (
          <li key={i} className="inline-form">
            <input aria-label={`Nombre de la variable ${i + 1} de ${label}`} placeholder="NOMBRE" value={k} onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
            <input aria-label={`Valor de la variable ${i + 1} de ${label}`} placeholder="valor" value={v} onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
            <Button small variant="ghost" aria-label={`Quitar variable ${k || i + 1} de ${label}`} onClick={() => commit(rows.filter((_, j) => j !== i))}>
              Quitar
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button small aria-label={`Añadir variable a ${label}`} onClick={() => commit([...rows, ["", ""]])}>
          Añadir variable
        </Button>
      </div>
    </Field>
  );
}

/** Clave de API: nunca se guarda en los ajustes, solo la referencia al Llavero. */
function ApiKeyField({ label, ref_, onSave, onDelete }: { label: string; ref_: SecretRef | null; onSave(value: string): Promise<void>; onDelete(): Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Field label="Clave de API" hint={ref_ ? `Referencia en el Llavero: ${ref_.account}. El valor nunca se muestra.` : "Sin clave guardada. Vive en el Llavero de macOS, nunca en los ajustes."}>
      <div className="inline-form">
        <input type="password" autoComplete="off" aria-label={`Clave de API de ${label}`} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button
          small
          aria-label={`Guardar en el Llavero ${label}`}
          disabled={!value}
          onClick={() =>
            void run(async () => {
              await onSave(value);
              setValue("");
            })
          }
        >
          Guardar en el Llavero
        </Button>
        <Button small variant="ghost" aria-label={`Borrar clave ${label}`} onClick={() => void run(onDelete)}>
          Borrar clave
        </Button>
      </div>
      {error ? (
        <span role="alert" className="error">
          {error}
        </span>
      ) : null}
    </Field>
  );
}

interface Props {
  llm: Settings["llm"];
  tests: Record<string, ProviderTestResult | "pending" | undefined>;
  onChange(llm: Settings["llm"]): void;
  onTest(id: string): void;
  onDetect(): void;
  onSecretSet(providerId: string, value: string): Promise<SecretRef>;
  onSecretDelete(providerId: string): Promise<void>;
}

function ProviderCard({ p, result, onChange, onRemove, onTest, onSecretSet, onSecretDelete }: { p: ProviderConfig; result: ProviderTestResult | "pending" | undefined; onChange(p: ProviderConfig): void; onRemove(): void; onTest(): void; onSecretSet: Props["onSecretSet"]; onSecretDelete: Props["onSecretDelete"] }) {
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
          <Field label="Ruta del binario" hint="Ruta absoluta: las apps de escritorio no heredan el PATH de tu terminal. Si usas un alias, pulsa Detectar.">
            <input aria-label={`Ruta del binario de ${p.label}`} value={k.binaryPath} placeholder="/opt/homebrew/bin/claude" spellCheck={false} onChange={(e) => setKind({ ...k, binaryPath: e.target.value })} />
          </Field>
          <Field label="Modelo (opcional)">
            <input aria-label={`Modelo de ${p.label}`} value={k.model ?? ""} onChange={(e) => setKind({ ...k, model: e.target.value || null })} />
          </Field>
          {k.type === "claudeCli" ? (
            <Field label="Esfuerzo (effort)" hint="Por defecto usa el del propio CLI.">
              <select aria-label={`Esfuerzo de ${p.label}`} value={k.effort ?? ""} onChange={(e) => setKind({ ...k, effort: e.target.value || null })}>
                {EFFORTS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <EnvEditor label={p.label} env={k.extraEnv} onChange={(extraEnv) => setKind({ ...k, extraEnv })} />
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
          <ApiKeyField
            label={p.label}
            ref_={k.apiKey}
            onSave={async (value) => setKind({ ...k, apiKey: await onSecretSet(p.id, value) })}
            onDelete={async () => {
              await onSecretDelete(p.id);
              if (k.type === "openAiCompatible") setKind({ ...k, apiKey: null });
            }}
          />
        </>
      ) : null}
      {k.type === "anthropic" ? (
        <>
          <Field label="Modelo">
            <input aria-label={`Modelo de ${p.label}`} value={k.model} onChange={(e) => setKind({ ...k, model: e.target.value })} />
          </Field>
          <ApiKeyField
            label={p.label}
            ref_={k.apiKey}
            onSave={async (value) => setKind({ ...k, apiKey: await onSecretSet(p.id, value) })}
            onDelete={async () => {
              await onSecretDelete(p.id);
            }}
          />
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

export function ProvidersSection({ llm, tests, onChange, onTest, onDetect, onSecretSet, onSecretDelete }: Props) {
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
            onSecretSet={onSecretSet}
            onSecretDelete={onSecretDelete}
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
