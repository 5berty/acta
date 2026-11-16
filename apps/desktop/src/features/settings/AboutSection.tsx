import type { AppInfo } from "../../api";
import { Disclosure } from "../../shared/ui/ui";
import { Field, Group, Row, Section } from "./fields";

export function AboutSection({ info }: { info: AppInfo | null }) {
  return (
    <Section title="Acerca de">
      <div className="about-hero card">
        <span className="about-mark" aria-hidden>
          a
        </span>
        <div>
          <p className="about-name">acta</p>
          <p className="muted">Tus reuniones, transcritas y resumidas en tu Mac.</p>
        </div>
      </div>
      <Group>
        <Row label="Versión">
          <span className="muted num selectable">{info?.version ?? "…"}</span>
        </Row>
        <Row label="macOS">
          <span className="muted num selectable">{info?.macosVersion ?? "Desconocido"}</span>
        </Row>
        <Row label="Componente de captura" hint="El ayudante nativo que graba el audio y detecta las reuniones.">
          <span className="muted num selectable">{info?.sidecarVersion ?? "No disponible"}</span>
        </Row>
      </Group>
      <Disclosure label="Avanzado">
        <div className="card advanced">
          <Field label="Carpeta de datos" hint="Aquí están el audio, las capturas, los modelos y la base de datos.">
            <code className="path selectable">{info?.dataDir ?? "…"}</code>
          </Field>
        </div>
      </Disclosure>
    </Section>
  );
}
