import { ChipsInput } from "../../shared/ui/ChipsInput";
import { Select } from "../../shared/ui/ui";
import { languageOptions } from "../settings/languages";
import { StepHead } from "./steps";

export interface AboutState {
  name: string;
  aliases: string[];
  language: string;
}

interface Props {
  about: AboutState;
  onAbout(next: AboutState): void;
  /** Nombre propuesto desde la cuenta de macOS; `null` si ya había uno o no se pudo leer. */
  systemName: string | null;
  /** Idioma propuesto desde los idiomas del Mac; `null` si ya se había elegido uno. */
  systemLanguage: string | null;
}

/** El nombre de pila, si el nombre completo tiene varias palabras: se ofrece como alias de un toque. */
export function firstName(fullName: string): string | null {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  return words.length > 1 ? words[0]! : null;
}

/** Paso «Sobre ti»: cómo te llamas, cómo te llaman y en qué idioma son tus reuniones. */
export function AboutStep({ about, onAbout, systemName, systemLanguage }: Props) {
  const first = firstName(about.name);
  const named = about.name.trim() !== "";
  return (
    <div className="ob-step">
      <StepHead
        title="Sobre ti"
        sub="acta usa tu nombre para saber qué tareas y menciones son tuyas. Se guarda en este Mac y nunca sale de tu Mac, salvo dentro del texto de la reunión que se envía al proveedor de IA que tú elijas."
      />
      <div className="group">
        <div className="row">
          <span className="row-text">
            <span className="row-label">Tu nombre</span>
            {systemName !== null && about.name === systemName ? <span className="row-hint ob-from-system">Lo hemos tomado de tu cuenta de macOS</span> : null}
          </span>
          <span className="row-control">
            <input aria-label="Tu nombre" placeholder="Nombre y apellido" autoComplete="off" value={about.name} onChange={(e) => onAbout({ ...about, name: e.target.value })} />
          </span>
        </div>
        <div className="row row-stack">
          <span className="row-text">
            <span className="row-label">También te llaman</span>
            <span className="row-hint">Apodos o formas cortas con las que te nombran en las reuniones. Pulsa Intro o coma para añadir cada uno.</span>
          </span>
          <ChipsInput label="También te llaman" placeholder="Álex, Alejandra" values={about.aliases} suggestions={first ? [first] : []} onChange={(aliases) => onAbout({ ...about, aliases })} />
        </div>
      </div>
      <div className="group">
        <div className="row">
          <span className="row-text">
            <span className="row-label">Idioma de las reuniones</span>
            <span className="row-hint">Dirige la transcripción y el idioma del acta. La interfaz de acta está, por ahora, en español.</span>
            {systemLanguage !== null && about.language === systemLanguage ? <span className="row-hint ob-from-system">Lo hemos tomado de los idiomas de tu Mac</span> : null}
          </span>
          <span className="row-control">
            <Select label="Idioma de las reuniones" value={about.language} onChange={(e) => onAbout({ ...about, language: e.target.value })}>
              {languageOptions(about.language).map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </span>
        </div>
      </div>
      <div className="ob-foot-note">
        <span>{named ? "Puedes cambiarlo cuando quieras en Ajustes › General." : "Puedes seguir sin ponerlo. Sin tu nombre, acta no podrá saber qué tareas son tuyas; se añade luego en Ajustes › General."}</span>
      </div>
    </div>
  );
}
