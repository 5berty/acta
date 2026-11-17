import type { MeetingLanguage } from "../../api";

/** Idiomas de las reuniones que se ofrecen, en este orden, en la bienvenida y en Ajustes. */
export const MEETING_LANGUAGES: { value: MeetingLanguage; label: string }[] = [
  { value: "auto", label: "Automático (detectar)" },
  { value: "es", label: "Español" },
  { value: "en", label: "English" },
  { value: "ca", label: "Català" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
  { value: "it", label: "Italiano" },
  { value: "pt", label: "Português" },
];

/** Las opciones del desplegable: si lo guardado es otro idioma, se conserva como una opción más. */
export function languageOptions(current: string): { value: string; label: string }[] {
  return MEETING_LANGUAGES.some((l) => l.value === current) ? MEETING_LANGUAGES : [...MEETING_LANGUAGES, { value: current, label: current }];
}
