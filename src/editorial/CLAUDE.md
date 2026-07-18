# Editor Editorial

Lee primero:

@../../docs/editorial-context.md

## Reglas

- Audita el código real antes de modificar.
- El código prevalece sobre la documentación.
- No avances de fase sin instrucción explícita.
- Conserva el shell y la arquitectura.
- No hagas refactors externos.
- Preserva cambios ajenos y campos desconocidos.
- No uses mocks permanentes.
- No dejes botones activos sin comportamiento.
- Mantén compatibilidad legacy.
- No guardes páginas como capturas.
- Usa comunicación caveman.
- Plan máximo de cuatro puntos.
- Corrige solo errores relacionados con la tarea.

## Validación

```bash
npm run build
npx eslint src/editorial tests/editorial-*.test.mjs
node --test tests/editorial-*.test.mjs
git diff --check
```

Las pruebas Firebase pueden estar bloqueadas por falta de Java o reglas no desplegadas. Repórtalo sin alterar el entorno.
