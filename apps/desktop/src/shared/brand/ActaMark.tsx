import { useId } from "react";

/** La marca de acta: la voz (onda) que se convierte en acta (hoja). Mismo dibujo que el icono de la app. */
export function ActaMark({ size = 32, label }: { size?: number; label?: string }) {
  const id = useId();
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
  return (
    <svg className="acta-mark" width={size} height={size} viewBox="0 0 824 824" {...a11y}>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0.12" y1="0" x2="0.88" y2="1">
          <stop offset="0" stopColor="#9a8cff" />
          <stop offset="0.5" stopColor="#5b5ff0" />
          <stop offset="1" stopColor="#3136c4" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="0.22" cy="0.08" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-wave`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7a6cff" />
          <stop offset="1" stopColor="#3b40d6" />
        </linearGradient>
      </defs>
      <rect width="824" height="824" rx="186" fill={`url(#${id}-bg)`} />
      <rect width="824" height="824" rx="186" fill={`url(#${id}-glow)`} />
      <g transform="translate(-100 -100)">
        <path d="M364 250h214l142 142v326a56 56 0 0 1-56 56H364a56 56 0 0 1-56-56V306a56 56 0 0 1 56-56z" fill="#fff" />
        <path d="M578 250l142 142H624a46 46 0 0 1-46-46z" fill="#c9cdff" />
        <g fill={`url(#${id}-wave)`}>
          <rect x="372" y="492" width="40" height="76" rx="20" />
          <rect x="432" y="446" width="40" height="168" rx="20" />
          <rect x="492" y="404" width="40" height="252" rx="20" />
          <rect x="552" y="462" width="40" height="136" rx="20" />
          <rect x="612" y="500" width="40" height="60" rx="20" />
        </g>
        <rect x="372" y="700" width="188" height="26" rx="13" fill="#b9bdf7" />
      </g>
    </svg>
  );
}
