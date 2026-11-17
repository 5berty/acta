// El proyecto no instala los tipos de Node: lo justo para que la prueba lea la hoja de estilos del disco.
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
}
