# Sistema responsive de Active Classroom

Toda pantalla nueva debe reutilizar los tokens y primitivas de `src/design-system.css` y cumplir estas reglas:

- Ningún hijo de `grid` o `flex` puede depender del ancho de su contenido: usar `min-width: 0`.
- Tarjetas: `.ui-card`; agrupaciones verticales: `.ui-stack`; controles: `.ui-cluster`; colecciones: `.ui-grid`.
- Controles interactivos deben conservar un área mínima de `--ac-touch` (44 px).
- Medios y diapositivas usan `.ui-media-frame` o un `aspect-ratio`; nunca se estiran ni se recortan para llenar la ventana.
- Los tamaños usan tokens `--ac-space-*`, `--ac-text-*` y `clamp()`; evitar anchos/altos rígidos salvo iconos.

Breakpoints estructurales:

- Más de 1180 px: sidebar completo y panel docente en dos columnas.
- 820–1180 px: navegación compacta; recursos y proyector se reordenan bajo el escenario.
- Menos de 820 px: navegación horizontal, una sola columna y controles envueltos.
- Menos de 520 px: controles en cuadrícula táctil y selectores apilados.

