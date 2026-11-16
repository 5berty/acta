import { useEffect, useState } from "react";
import type { ProviderConfig, SecretRef, ProviderKind, ProviderTestResult, Settings } from "../../api";
import { Bot, KeyRound, Plus, ScanSearch, Terminal, Trash2, X } from "lucide-react";
import { Button, Disclosure, IconButton, Select, Spinner, StatusDot, Stepper, Switch, errorMessage } from "../../shared/ui/ui";
import { Field, Group, Row, Section } from "./fields";

type KindType = ProviderKind["type"];

const KIND_LABEL: Record<KindType, string> = {
  claudeCli: "Claude Code (CLI)",
  codexCli: "Codex (CLI)",
  openAiCompatible: "OpenAI compatible (incluye Ollama)",
  anthropic: "Anthropic (clave de API)",
};
const KIND_BLURB: Record<KindType, string> = {
  claudeCli: "Usa el Claude Code que ya tienes instalado, con tu suscripción.",
  codexCli: "Usa el Codex que ya tienes instalado, con tu suscripción.",
  openAiCompatible: "Cualquier servidor compatible con OpenAI. Con Ollama, todo se queda en tu Mac.",
  anthropic: "La API de Anthropic con tu propia clave.",
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
    <Field label="Variables de entorno" hint="Las que fija tu alias de terminal, p. ej. CLAUDE_CONFIG_DIR. Las credenciales del CLI no se tocan nunca.">
      {rows.length > 0 ? (
        <ul className="plain env-rows">
          {rows.map(([k, v], i) => (
            <li key={i} className="field-line">
              <input className="input-mono" aria-label={`Nombre de la variable ${i + 1} de ${label}`} placeholder="NOMBRE" spellCheck={false} value={k} onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
              <input className="input-mono" aria-label={`Valor de la variable ${i + 1} de ${label}`} placeholder="valor" spellCheck={false} value={v} onChange={(e) => commit(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
              <IconButton small label={`Quitar variable ${k || i + 1} de ${label}`} onClick={() => commit(rows.filter((_, j) => j !== i))}>
                <X size={13} strokeWidth={2.2} aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button small icon={<Plus size={12} strokeWidth={2.4} aria-hidden />} aria-label={`Añadir variable a ${label}`} onClick={() => commit([...rows, ["", ""]])}>
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
    <Field label="Clave de API" hint={ref_ ? "Guardada en el Llavero de macOS. No se muestra ni se copia a los ajustes." : "Se guarda en el Llavero de macOS, nunca en los ajustes."}>
      <div className="field-line">
        <input type="password" autoComplete="off" aria-label={`Clave de API de ${label}`} placeholder={ref_ ? "••••••••  (ya hay una guardada)" : "Pega aquí la clave"} value={value} onChange={(e) => setValue(e.target.value)} />
        <Button
          small
          variant="primary"
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
  const isCli = k.type === "claudeCli" || k.type === "codexCli";
  const located = isCli && k.binaryPath.trim() !== "";
  return (
    <div className="provider card">
      <div className="provider-head">
        <span className={`provider-icon provider-${k.type}`} aria-hidden>
          {isCli ? <Terminal size={17} strokeWidth={2} /> : k.type === "anthropic" ? <KeyRound size={17} strokeWidth={2} /> : <Bot size={17} strokeWidth={2} />}
        </span>
        <div className="provider-title">
          <input aria-label={`Nombre de ${p.label}`} className="title-input" value={p.label} onChange={(e) => onChange({ ...p, label: e.target.value })} />
          <p className="provider-sub">
            {isCli ? (
              <>
                <StatusDot tone={located ? "ok" : "warn"} />
                {located ? "Instalado en tu Mac" : "Sin localizar: pulsa «Detectar CLI instalados»"}
              </>
            ) : (
              KIND_BLURB[k.type]
            )}
          </p>
        </div>
        <Switch label={`Activar ${p.label}`} checked={p.enabled} onChange={(enabled) => onChange({ ...p, enabled })} />
      </div>

      <div className="provider-fields">
        {isCli ? (
          <>
            <Field label="Modelo" hint="Vacío: el que tenga configurado el CLI.">
              <input aria-label={`Modelo de ${p.label}`} placeholder="Por defecto" value={k.model ?? ""} onChange={(e) => setKind({ ...k, model: e.target.value || null })} />
            </Field>
            {k.type === "claudeCli" ? (
              <Field label="Esfuerzo" hint="Cuánto piensa antes de responder.">
                <Select label={`Esfuerzo de ${p.label}`} value={k.effort ?? ""} onChange={(e) => setKind({ ...k, effort: e.target.value || null })}>
                  {EFFORTS.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </>
        ) : null}
        {k.type === "openAiCompatible" ? (
          <>
            <Field label="URL base" hint="Ollama: http://localhost:11434/v1">
              <input className="input-mono" aria-label="URL base de OpenAI compatible" spellCheck={false} value={k.baseUrl} onChange={(e) => setKind({ ...k, baseUrl: e.target.value })} />
            </Field>
            <Field label="Modelo">
              <input aria-label={`Modelo de ${p.label}`} value={k.model} onChange={(e) => setKind({ ...k, model: e.target.value })} />
            </Field>
          </>
        ) : null}
        {k.type === "anthropic" ? (
          <Field label="Modelo">
            <input aria-label={`Modelo de ${p.label}`} value={k.model} onChange={(e) => setKind({ ...k, model: e.target.value })} />
          </Field>
        ) : null}
      </div>
      {k.type === "openAiCompatible" ? (
        <ApiKeyField
          label={p.label}
          ref_={k.apiKey}
          onSave={async (value) => setKind({ ...k, apiKey: await onSecretSet(p.id, value) })}
          onDelete={async () => {
            await onSecretDelete(p.id);
            if (k.type === "openAiCompatible") setKind({ ...k, apiKey: null });
          }}
        />
      ) : null}
      {k.type === "anthropic" ? (
        <ApiKeyField
          label={p.label}
          ref_={k.apiKey}
          onSave={async (value) => setKind({ ...k, apiKey: await onSecretSet(p.id, value) })}
          onDelete={async () => {
            await onSecretDelete(p.id);
          }}
        />
      ) : null}

      <div className="provider-actions">
        <Button small capsule onClick={onTest} aria-label={`Probar conexión ${p.label}`} disabled={result === "pending"}>
          Probar conexión
        </Button>
        {result === "pending" ? (
          <span className="test-result muted">
            <Spinner /> Probando…
          </span>
        ) : null}
        {result && result !== "pending" ? (
          <span role="status" className={`test-result ${result.ok ? "ok" : "error"}`}>
            <StatusDot tone={result.ok ? "ok" : "danger"} />
            {result.message}
            {result.latencyMs != null ? ` (${result.latencyMs} ms)` : ""}
          </span>
        ) : null}
      </div>

      <Disclosure label="Avanzado" ariaLabel={`Avanzado de ${p.label}`}>
        {isCli ? (
          <>
            <Field label="Ruta del programa" hint="Las apps no heredan el PATH de tu terminal: hace falta la ruta completa. «Detectar» la rellena sola.">
              <input className="input-mono" aria-label={`Ruta del binario de ${p.label}`} value={k.binaryPath} placeholder="/opt/homebrew/bin/claude" spellCheck={false} onChange={(e) => setKind({ ...k, binaryPath: e.target.value })} />
            </Field>
            <EnvEditor label={p.label} env={k.extraEnv} onChange={(extraEnv) => setKind({ ...k, extraEnv })} />
          </>
        ) : null}
        <Field label="Tiempo máximo de espera" hint="Las actas de reuniones largas pueden tardar varios minutos.">
          <Stepper label={`Tiempo máximo de ${p.label} (s)`} value={p.timeoutS} min={5} step={30} unit="s" onChange={(timeoutS) => onChange({ ...p, timeoutS })} />
        </Field>
        <div>
          <Button small variant="danger" icon={<Trash2 size={12} strokeWidth={2} aria-hidden />} onClick={onRemove} aria-label={`Eliminar ${p.label}`}>
            Eliminar proveedor
          </Button>
        </div>
      </Disclosure>
    </div>
  );
}

export function ProvidersSection({ llm, tests, onChange, onTest, onDetect, onSecretSet, onSecretDelete }: Props) {
  const [kind, setKind] = useState<KindType>("claudeCli");
  const enabled = llm.providers.filter((p) => p.enabled);
  const task = (label: string, hint: string, aria: string, key: "minutesProvider" | "chatProvider" | "namingProvider") => (
    <Row label={label} hint={hint}>
      <Select label={`Proveedor para ${aria}`} value={llm[key] ?? ""} onChange={(e) => onChange({ ...llm, [key]: e.target.value || null })}>
        <option value="">Sin asignar</option>
        {enabled.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>
    </Row>
  );

  return (
    <Section title="Proveedores de IA" hint="Quién escribe las actas y responde en el chat. La transcripción siempre es local; esto solo afecta al texto.">
      <Group title="Quién hace cada cosa">
        {task("Acta", "Resumen, decisiones, tareas y escaleta.", "el acta", "minutesProvider")}
        {task("Chat", "Las respuestas de «Preguntar».", "el chat", "chatProvider")}
        {task("Nombres de grupo", "Títulos para los grupos sugeridos.", "los nombres de grupo", "namingProvider")}
      </Group>

      <div className="settings-group">
        <p className="group-title">Tus proveedores</p>
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
          {llm.providers.length === 0 ? <p className="card card-empty">Sin proveedores no hay actas ni chat. Añade uno o pulsa «Detectar CLI instalados».</p> : null}
        </div>
        <div className="provider-add">
          <Select label="Tipo de proveedor nuevo" value={kind} onChange={(e) => setKind(e.target.value as KindType)}>
            {(Object.keys(KIND_LABEL) as KindType[]).map((t) => (
              <option key={t} value={t}>
                {KIND_LABEL[t]}
              </option>
            ))}
          </Select>
          <Button small icon={<Plus size={12} strokeWidth={2.4} aria-hidden />} onClick={() => onChange({ ...llm, providers: [...llm.providers, newProvider(kind, llm.providers)] })}>
            Añadir proveedor
          </Button>
          <span className="spacer" />
          <Button small variant="ghost" icon={<ScanSearch size={13} strokeWidth={2} aria-hidden />} onClick={onDetect}>
            Detectar CLI instalados
          </Button>
        </div>
      </div>
    </Section>
  );
}
