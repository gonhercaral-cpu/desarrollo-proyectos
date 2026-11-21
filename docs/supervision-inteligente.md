# Supervisión inteligente de proyectos — Issue #43

## Estado de la entrega

Implementación integrada sobre `origin/main` (`466ce55`), preparada para revisión.
**No desplegada, sin activar IA ni comunicaciones automáticas en producción.**
No se habilitaron APIs, facturación, secretos, releases ni workflows de escritura.
No se consultaron ni modificaron proyectos de producción durante las pruebas.

La aprobación del despliegue corresponde al propietario conforme a `AGENTS.md`:
«El propietario humano aprueba la habilitación de automatizaciones con escritura y cualquier despliegue».
Los flags de servidor descritos más abajo constituyen una segunda barrera de activación.

## Funcionalidades y uso

1. Dirección abre **Todos los proyectos → Supervisión inteligente**.
2. «Actualizar índice» procesa 50 proyectos reales por lote; continuar hasta completar
   la indexación inicial. Los contadores parciales de inicialización se identifican.
3. Las seis tarjetas filtran atención, evidencias, próximos vencimientos, decisiones,
   inactividad y vencidos. Cada consulta examina hasta 100 proyecciones y devuelve
   hasta 25 coincidencias, con cursor. Un lote sin coincidencias puede tener página siguiente.
   Buscar texto actúa exclusivamente sobre los proyectos cargados, como indica la etiqueta.
4. Se puede filtrar por riesgo, estado y responsable, y ordenar por prioridad,
   vencimiento o actividad más antigua. Los responsables se consultan en el servidor
   y la lista de opciones se limita a 200 usuarios activos.
5. Las tarjetas muestran progreso **reportado**, condiciones verificables de riesgo,
   actividad, evidencia pendiente y fecha de cálculo. No certifican ese progreso.
6. Abrir un detalle no revisa ni aprueba nada. «Marcar avances revisados» registra
   una revisión explícita y auditable; aprobar evidencias y cerrar proyectos sigue
   haciéndose en el detalle existente del proyecto.
7. «Preparar mensaje», «Solicitar información» y «Solicitar corrección» permiten
   editar el texto. La vista previa muestra todos los mensajes y destinatarios
   autorizados. Solo la confirmación explícita crea notificaciones reales.
   La selección grupal admite hasta 10 proyectos, con hasta 20 destinatarios por proyecto.
8. Atender, descartar y posponer registran decisiones. Las posposiciones sobreviven
   al cambio de día y caducan a su fecha. Cambios relevantes de datos reabren decisiones;
   un simple recálculo temporal no las descarta. El riesgo factual puede continuar
   visible aunque una decisión esté atendida.
9. El asistente consulta prioridades, vencimientos, actividad, evidencias,
   entregables y cierre sugerido; puede limitarse a un proyecto y preparar avisos.
   Sus consultas y cifras son operaciones estructuradas. Con IA habilitada añade una
   síntesis sobre una muestra acotada y citada. Una consulta no autoriza envíos.
10. «Resumir actividad de la semana» usa la consulta real del asistente y sus fuentes;
    identifica si la síntesis utilizó IA. Los informes permiten periodos de 1, 7 y 30 días.
11. La configuración global valida calendario, umbrales, frecuencia, informes,
    destinatarios administrativos y cuotas de IA. El detalle permite guardar
    umbrales y zona horaria particulares. Los overrides admitidos del backend son
    calendario y umbrales; nunca permiten habilitar IA, modificar permisos o activar envíos.

## Motor y datos reutilizados

No existe otra base de proyectos. Se reutilizan `projects`, `projectUpdates`,
`projectLogs`, `evidence`, `users` y `notifications`.

- `functions/projectSupervisionEngine.js`: evaluación pura, determinística,
  sin Firebase ni red. Estados en español y técnicos; proyectos finalizados,
  cancelados, suspendidos, ocultos o archivados no generan recordatorios activos.
- Riesgo crítico: fecha vencida en un proyecto activo. Alto: bloqueos o elementos
  retrasados y plazo urgente. Medio: bloqueos, retrasos, inactividad, evidencia
  rechazada o revisión pendiente. Bajo: sin esas señales. No compara linealmente
  tiempo transcurrido con porcentaje de progreso.
- Valores iniciales: recordatorio 15 días antes, preventivo 7 con riesgo comprobable,
  prioritario 3 con riesgo; inactividad 7 días laborables. Zona inicial America/Tijuana,
  lunes a viernes y festivos configurables. Las fechas simples no se convierten a UTC.
- Una edición administrativa de la información general no cuenta como avance.
- El cierre solo se sugiere para revisión con evidencia aprobada, checklist completa
  y sin entregables pendientes o bloqueos. **Nunca se ejecuta automáticamente**.

### Colecciones internas nuevas

| Colección | Contenido |
| --- | --- |
| `projectSupervisionSummaries/{projectId}` | Proyección paginable, riesgos, fuentes acotadas, revisiones y decisiones vigentes |
| `projectSupervisionPrivate/settings` | Configuración auditada |
| `projectSupervisionPrivate/stats` | Contadores transaccionales y estado de indexación |
| `projectSupervisionPrivate/*` | Borradores, auditoría, alertas, actividad, informes, cooldowns, leases, cuotas y análisis |

Las reglas **deniegan todo acceso directo de cliente, incluso a administradores**,
a ambas colecciones. Solo las funciones autorizadas leen o escriben ahí.
No se modificaron Storage ni el esquema de permisos de proyectos existentes.

Los triggers releen el estado actual y actualizan contadores por diferencias en una
transacción. Se conserva una revisión de entradas separada de la fecha de cálculo.
Los traslados de evidencia recalculan tanto el proyecto de origen como el destino.

### Cobertura y límites honestos

- El contexto textual consulta hasta 30 avances, registros y evidencias externas por
  proyecto, además de los arrays existentes, y conserva fuentes recientes acotadas.
  La cobertura parcial se indica; no se descargan archivos.
- Para evidencias heredadas sin espejo embebido, los contadores completos se obtienen
  mediante agregaciones transaccionales, aunque los metadatos mostrados sean una muestra.
- Si se mezclan muchos registros externos con estados embebidos autoritativos y no
  puede resolverse toda la unión en la muestra, el número se muestra como **mínimo
  conocido**, se contabilizan proyectos con cobertura parcial y se bloquea el cierre
  sugerido. Resolver/migrar esa mezcla histórica requiere revisar el proyecto; no se
  presenta un cero concluyente ni una revisión completa ficticia.
- Informes: estado actual agregado y hasta 100 proyectos prioritarios; hasta 100
  eventos de actividad/decisión del periodo. Se marcan los límites alcanzados. La
  actividad histórica anterior a la activación solo se recupera en la muestra disponible;
  no se inventan snapshots retrospectivos.
- El asistente tiene intenciones explícitas, no acceso libre a Firestore. Una pregunta
  fuera de su alcance recibe una explicación de las consultas admitidas.

## Backend y procesos

`projectSupervision` es un callable protegido por el guard de dispositivos existente
más verificación de usuario activo y rol `admin` en Firestore. Operaciones:
`overview`, `people`, `refresh`, `detail`, `review`, `decision`, `prepare`, `send`,
`analyze`, `configure`, `configureProject`, `assistant`, `report`, `reports`.

Nuevas funciones exportadas:

- `updateProjectSupervision`: escritura de proyecto.
- `updateSupervisionFromAdvance`: escritura en `projectUpdates`.
- `updateSupervisionFromLog`: escritura en `projectLogs`.
- `updateSupervisionFromEvidence`: escritura en `evidence`.
- `scanProjectSupervision`: cada 15 minutos; cursor y lease persistentes; hasta 50
  proyectos por ejecución. Máximo tres análisis de proyecto nuevos por ciclo cuando
  estén autorizados, sin que los aciertos de caché bloqueen otros proyectos.
- `projectSupervision`: operaciones de dirección.

Los envíos automáticos respetan días, festivos, hora mínima y cooldown, y usan el
calendario particular del proyecto cuando existe. Se deduplican por proyecto,
plazo, etapa y destinatario. Las etapas están agrupadas para evitar avisos repetidos.
Las evidencias pendientes generan un aviso diario agrupado exclusivamente a dirección.
Informes diarios y semanales pueden coexistir; solo van a administradores activos
seleccionados y los mensajes enlazan al informe interno, sin copiar análisis confidenciales.
Borradores y límites de tasa vencidos se limpian en lotes de hasta 100 documentos.

## IA: integración preparada, llamada real pendiente

Se evaluó Gemini con Genkit. El proyecto usa Node 24, `firebase-admin` y
`firebase-functions`, sin Genkit. Se eligió un adaptador desacoplado de **Gemini en
Vertex AI por REST**, usando ADC de la identidad de ejecución y `fetch` de Node,
para esta operación acotada sin añadir dependencias ni claves al frontend.
Genkit sigue siendo una alternativa para observabilidad avanzada; no se instaló.

`projectSupervisionAI.js` no tiene herramientas, navegación ni descarga de adjuntos.
Solo recibe texto y metadatos autorizados, limitados por tamaño. Los comentarios y
archivos son datos no confiables. La respuesta debe tener hechos, inferencias y
recomendaciones con referencias existentes. Citas inventadas y salidas inválidas se
rechazan. Una cita estructural válida no prueba semánticamente cada afirmación:
la interfaz pide contrastar la síntesis con las fuentes.

Se conservan versión, modelo, fecha, fuentes analizadas, exclusiones y consumo observado.
El caché depende de datos, reglas y modelo. Hay lease contra concurrencia, timeout
25 s, backoff de 5 minutos tras fallo y reserva transaccional de cuota antes de llamar.
La apertura de la pestaña no invoca IA. El análisis manual, el programado y las síntesis
solicitadas comparten las cuotas mensuales. Los fallos no interrumpen las reglas.

PDF, imágenes, audio y vídeo: **no se analiza su contenido** en esta versión;
se identifican como metadatos. No se configuró un modelo real ni se verificaron
permisos, disponibilidad regional o facturación de una cuenta de Vertex.

Referencias consultadas:
[Genkit: Google Generative AI](https://genkit.dev/docs/js/integrations/google-genai/),
[respuestas estructuradas de Gemini](https://ai.google.dev/gemini-api/docs/structured-output),
[precios de Vertex AI](https://cloud.google.com/model-garden/pricing).

## Seguridad y límites operativos

- No se confían rol, destinatarios, rutas ni análisis enviados por el cliente.
- El backend genera las rutas y obtiene destinatarios a partir de las asignaciones
  que conceden acceso real al proyecto y de usuarios todavía activos.
- Borradores ligados al autor, vigencia 15 minutos, confirmación explícita y relectura
  transaccional de proyecto/destinatarios/cooldown inmediatamente antes del envío.
- Notificaciones, cooldown, auditoría y estado del borrador se escriben atómicamente.
  Repetir el envío devuelve el resultado ya confirmado. No se alteran responsables,
  fechas oficiales, aprobaciones de evidencias ni estados de cierre.
- La revisión se distingue de visualización y de aprobación. La auditoría registra
  quién, cuándo, mensaje, destinatarios y versión autorizada.
- Tasa por administrador/operación: 30 solicitudes/minuto; análisis, 5/minuto.
- Máximo tres instancias del callable/triggers; una del barrido programado.

### Costes

Por defecto, IA y comunicaciones automáticas están apagadas: cero consultas al modelo.
Esto no significa que un despliegue sea gratuito: Firestore, Functions y Scheduler
pueden generar cargos bajo la facturación vigente del proyecto.

IA: tope inicial 100 solicitudes y 200.000 tokens **reservados** al mes UTC;
12.000 caracteres de entrada y 1.000 tokens de salida por solicitud. Se reserva un
peor caso por bytes UTF-8 más salida y margen de sistema; los intentos fallidos no
liberan esa reserva. El consumo efectivo del proveedor se registra por separado.
El límite de solicitudes es adicional, no una promesa de poder consumir las 100.
No hay modelo seleccionado, por lo que no se inventa un coste monetario exacto.
Estimación al seleccionarlo: tokens de entrada × tarifa de entrada + tokens de
salida × tarifa de salida; como cota conservadora de modelo, aplicar al total
reservado la mayor tarifa por token, más los costes de infraestructura.

El barrido ejecuta hasta 96 lotes diarios de 50 proyectos; el caché evita consultar
los registros hijos de proyectos sin cambios durante el mismo día local. En el
peor caso de lotes siempre llenos hay aproximadamente 24.400 lecturas base diarias,
más escrituras/lecturas de cambios, conteos, IA y envíos. Un ciclo completo demora
aproximadamente `ceil(proyectos / 50) × 15 minutos`; la interfaz muestra la frescura.
Revisar cuotas, volumen, presupuesto e índices antes de activar producción. Estos
límites de aplicación no sustituyen un presupuesto financiero de Google Cloud.

## Coordinación y procedencia

- **Codex**: arquitectura, integración sobre main actual, backend Firebase,
  autorización, índices/reglas, flujos transaccionales, costes, correcciones,
  pruebas, UI final, revisión y publicación del PR.
- **Claude Code**: propuestas de motor puro + pruebas y componente React,
  solicitadas bajo contratos del Issue #43, sin herramientas, escritura ni secretos.
  Codex leyó, corrigió y aplicó esos archivos. No se atribuyen al auxiliar pruebas
  que ejecutó Codex.
- **Antigravity**: consulta de arquitectura/UI y propuesta de CSS. La primera
  generación grande de UI agotó seis minutos y **no se utilizó su salida parcial**;
  se redujo el contrato y el CSS sí terminó con salida 0 y `status: success`.
- Una revisión auxiliar de Codex detectó casos de paginación, decisiones, calendario,
  evidencias y tamaño de informes; Codex los corrigió y añadió pruebas.

No se alcanzó una delegación del 80%: la integración de seguridad e infraestructura
quedó en Codex conforme a las restricciones del repositorio y a los resultados reales
de las herramientas. Contratos/resultados privados permanecen fuera de Git en
`.orquestacion/`; no se publican transcripciones ni credenciales.

## Validación

Batería conjunta final: **204 pruebas, 204 correctas, 0 fallos**, en 29 suites.

- Reglas y Storage en `security-rules-audit`, sin credenciales de producción.
- Motor: fechas locales/DST, días hábiles/festivos, estados terminales, alto avance
  con plazo corto sin bloqueo, falta de datos, checklist y evidencias duplicadas.
- Integración: autorización de todas las operaciones, paginación, contadores,
  revisión explícita, decisiones/versiones, envío concurrente idempotente,
  destinatarios revocados, caducidad, cooldown, caída de proveedor, caché,
  presupuesto, informes diarios/semanales, digest administrativo, posposición,
  reglas particulares y evidencia heredada/trasladada.
- Regresión de notificaciones y actividad de proyectos existentes.
- La prueba antigua `tests/multiagent-security.test.cjs` no está presente en main
  actual; su invocación se registró como no disponible, no como prueba correcta.
- Build de Vite correcto; conserva avisos existentes de tamaño de bundles/imports.
- ESLint en archivos nuevos: sin errores. Archivos afectados existentes conservan
  tres avisos de dependencias de `useMemo` en AllProjects.
- El lint global no está limpio: la base anterior tenía 137 errores/37 avisos,
  frente a 136/37 tras integrar la pestaña. En la worktree de main, `npm run lint`
  además encuentra una configuración de escritorio cuyo `typescript-eslint` no
  está instalado. No se modificó ese módulo para ocultar el fallo.
- Navegador contra Auth/Firestore/Functions/Storage emulados: login de dirección,
  carga de tres proyectos ficticios, edición → vista previa → confirmación →
  notificación real en emulador, informe persistido y consulta del asistente.
  Revisión responsive en 360, 768 y 1280 px, sin desbordamiento horizontal observado.
  No es una prueba de Vertex real ni una verificación de producción.

Comando reproducible de validación conjunta:

```sh
firebase emulators:exec --config firebase.rules-test.json --project security-rules-audit --only firestore,storage 'node --test --test-concurrency=1 tests/firebase-rules.test.mjs tests/project-supervision-integration.test.cjs tests/project-supervision-engine.test.cjs tests/operational-notifications-tools.test.cjs tests/project-notification-activity.test.mjs'
npm run build
```

## Publicación gradual pendiente de aprobación

1. Revisar PR, diff, resultados y las limitaciones anteriores. No saltarse checks
   obligatorios por los fallos globales existentes; resolverlos mediante el flujo del repositorio.
2. Tras aprobación humana, desplegar índices y reglas y esperar índices listos.
3. Desplegar únicamente las seis funciones de supervisión y Hosting actualizado,
   siguiendo el flujo existente. No desplegar las otras codebases por accidente.
4. Mantener `PROJECT_SUPERVISION_AUTOMATION_APPROVED` y
   `PROJECT_SUPERVISION_AI_APPROVED` ausentes o `false`. Completar la indexación
   inicial y realizar un piloto con destinatarios de prueba autorizados.
5. Para IA, seleccionar y verificar un modelo regional admitido, autorizar coste y
   tratamiento de datos, habilitar la API/IAM mínima de la identidad de ejecución
   y configurar `PROJECT_SUPERVISION_AI_APPROVED=true`; solo entonces activar
   `aiEnabled` y el modelo desde dirección. No introducir una clave en el cliente.
6. Para automatización, revisar reglas/destinatarios/deduplicación, obtener aprobación
   y configurar `PROJECT_SUPERVISION_AUTOMATION_APPROVED=true`; después activar las
   opciones deseadas del módulo. No se envían correos: se usa `notifications`.
7. Verificar accesos de administrador/colaborador, logs, índices, actualización,
   costes y ausencia de duplicados tras el despliegue. La aceptación productiva
   permanece pendiente hasta esa comprobación.

No hay despliegues, merges a main ni releases ejecutados por esta entrega local.
