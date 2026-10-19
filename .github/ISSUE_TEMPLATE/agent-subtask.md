---
name: Subtarea auxiliar de Codex
about: Contrato acotado para Claude Code o Gemini CLI, coordinado por Codex
title: "[Codex] "
---

## Objetivo y contexto

Describe el problema y enlaza el Issue principal.

## Criterios de aceptación

- Comportamiento esperado y compatibilidad requerida.

## Pruebas que ejecutará Codex

Lista comandos locales y pruebas de emuladores pertinentes; nunca producción.

## Asignación

Codex debe publicar un comentario independiente con `/codex-delegate claude` o
`/codex-delegate gemini` en la primera línea y el JSON del contrato debajo,
sin cercas Markdown. Consulta `docs/multiagent-collaboration.md`.
Abrir este Issue no ejecuta ningún modelo.
