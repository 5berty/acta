/** La marca de acta: una «a» de caja única con el punto de grabación. Mismo dibujo que el icono de la app (docs/brand). */
export function ActaMark({ size = 32, label }: { size?: number; label?: string }) {
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
  return (
    <svg className="acta-mark" width={size} height={size} viewBox="0 0 824 824" {...a11y}>
      <rect width="824" height="824" rx="186" fill="#3b36c9" />
      <g transform="translate(-100 -100)">
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M770 254 V758 H662 V715.91 A258 258 0 1 1 662 296.09 V254 Z M512 356 A150 150 0 1 0 512 656 A150 150 0 1 0 512 356 Z"
        />
        <circle cx="512" cy="506" r="66" fill="#ff5a1f" />
      </g>
    </svg>
  );
}
