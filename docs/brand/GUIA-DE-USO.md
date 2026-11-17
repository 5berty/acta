# acta — Guía de uso del logo (compacta)

## 1. El logo
- **Idea**: una «a» geométrica de caja única (anillo + montante) con el punto de grabación en el centro. La letra y la acción en una sola forma.
- **Versiones**: horizontal (`acta-horizontal`) · apilada (`acta-stacked`) · símbolo (`acta-symbol`) · solo palabra (`acta-wordmark`, sin punto) · icono de app (`acta-app-icon`).
- **Corte pequeño**: `acta-symbol-small` (anillo más grueso, huella mayor). Úsalo por debajo de 32 px.
- **Archivos**: `*.svg` son los maestros (trazados, sin texto ni fuentes). `png/` y `web/` son derivados.

## 2. Espacio de respeto
Deja a todos los lados **1 × el diámetro del punto REC** (≈ ¼ de la altura de la «a»). Escala con el logo; nunca una distancia fija.

## 3. Tamaño mínimo
| Versión | Pantalla | Impresión |
|---|---|---|
| Horizontal | 96 px de ancho | 20 mm |
| Apilada | 64 px de ancho | 16 mm |
| Símbolo | 16 px (usa `-small` por debajo de 32 px) | 6 mm |

## 4. Color
| Nombre | HEX | RGB | CMYK (aprox.) | Pantone |
|---|---|---|---|---|
| Índigo acta (principal) | `#3B36C9` | 59 · 54 · 201 | 71 · 73 · 0 · 21 | por igualar con muestrario |
| REC (solo el punto) | `#FF5A1F` | 255 · 90 · 31 | 0 · 65 · 88 · 0 | por igualar con muestrario |
| Carbón | `#15161F` | 21 · 22 · 31 | 32 · 29 · 0 · 88 | — |
| Papel | `#F6F5F1` | 246 · 245 · 241 | 0 · 0 · 2 · 4 | — |

CMYK calculado por conversión simple, sin perfil de impresión: pide prueba de color antes de imprimir.

**Contraste medido**: blanco sobre índigo 8,2:1 · índigo sobre papel 7,5:1 · REC sobre carbón 5,8:1 · REC sobre blanco 3,1:1 · REC sobre índigo 2,6:1.
El REC es un acento gráfico: **nunca lo uses como color de texto**. Sobre índigo (icono de app) queda por debajo de 3:1; lo compensa su tamaño y el aro índigo que lo rodea, pero es una limitación conocida.

**Pares aprobados**: color sobre blanco o papel · versión invertida (`-reversed`) sobre índigo o carbón · negro sobre blanco · blanco sobre cualquier fondo oscuro (`mono/`).
En una tinta (`mono/`), el punto toma el mismo color que la letra.

## 5. Versión invertida
Sobre fondo oscuro usa siempre `*-reversed.svg`: el anillo está adelgazado (36 en lugar de 40) para compensar que el blanco se ve más grueso.

## 6. Tipografía
La palabra «acta» está **dibujada a medida** (trazados, no una fuente): no la teclees, usa el archivo. La tipografía de la interfaz es la que ya usa la app.

## 7. Qué no hacer
No estirar ni deformar · no recolorear fuera de la paleta · no rotar ni reflejar (la «a» reflejada se lee como otra letra) · no añadir sombras, degradados, contornos ni efectos · no separar el punto de la «a» · no usar el punto REC en otra posición · no escribir el logo con una fuente · no ponerlo sobre fondos recargados sin baldosa.

## 8. Favicon e iconos
- `web/favicon.svg` / `favicon.ico` (16·32·48): baldosa índigo con el corte pequeño invertido, legible en pestañas claras y oscuras.
- `web/apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest` y `head-snippet.html`.
- `acta-app-icon.svg` / `png/acta-app-icon.png`: icono de macOS en rejilla de 1024 (cuerpo de 824 px con margen transparente).

## 9. Límites
- No hay búsqueda de marcas: hazla (bases de datos de marcas + búsqueda inversa de imagen) antes del lanzamiento público.
- No se han generado PDF/EPS/AI ni `.icns`; los SVG son el maestro.
- El render de comprobación es con Chrome; revisa en un editor vectorial si vas a imprimir.
