import type { CSSProperties } from "react";
import { BRANDS, type BrandId } from "./brands";

export type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

interface Props {
  brand: BrandId;
  size?: LogoSize;
  /** Nombra el logo para lectores de pantalla (y como ayuda al pasar el ratón). Sin él es decorativo. */
  label?: boolean;
}

/** Mosaico con el logotipo de una app o un proveedor. */
export function BrandLogo({ brand, size = "md", label }: Props) {
  const b = BRANDS[brand];
  const style = { "--c": b.color, "--ink": b.ink ?? "#fff", "--logo": `url("${b.src}")`, "--logo-scale": b.scale ?? 0.6 } as CSSProperties;
  const a11y = label ? ({ role: "img", "aria-label": b.name, title: b.name } as const) : ({ "aria-hidden": true } as const);
  return (
    <span className={`brand-tile brand-${size}`} data-brand={brand} style={style} {...a11y}>
      {b.image ? <img className="brand-image" src={b.src} alt="" draggable={false} /> : <span className="brand-glyph" />}
    </span>
  );
}
