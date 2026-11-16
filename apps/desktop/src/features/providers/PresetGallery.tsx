import { Plus, Server } from "lucide-react";
import { BrandLogo } from "../../shared/brand/BrandLogo";
import { PRESETS, type PresetId } from "./presets";

/** Proveedores ya rellenos: un toque y queda añadido. */
export function PresetGallery({ presets, onAdd }: { presets: PresetId[]; onAdd(id: PresetId): void }) {
  return (
    <ul className="plain preset-grid">
      {presets.map((id) => {
        const p = PRESETS[id];
        return (
          <li key={id}>
            <button type="button" className="preset-card" aria-label={`Añadir ${p.label}`} onClick={() => onAdd(id)}>
              {p.brand ? (
                <BrandLogo brand={p.brand} />
              ) : (
                <span className="brand-tile brand-md brand-generic" aria-hidden>
                  <Server strokeWidth={1.9} />
                </span>
              )}
              <span className="preset-text">
                <span className="preset-name">
                  {p.label}
                  {p.tag ? <span className={`preset-tag${p.local ? " preset-tag-local" : ""}`}>{p.tag}</span> : null}
                </span>
                <span className="preset-blurb">{p.blurb}</span>
              </span>
              <Plus className="preset-plus" size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
