# Preparación de Gemini — Supervisión inteligente

Estado al 21 de noviembre de 2026: **preparado para revisión; no habilitado ni desplegado este ajuste**.
El PR #44 ya desplegado permanece sin cambios y con IA y comunicaciones automáticas apagadas.
Esta preparación no autoriza habilitar APIs, cambiar IAM, invocar modelos ni procesar datos mediante IA.

## Auditoría real, solo lectura

- Proyecto: `sistema-desarrollo-proyectos`; facturación vinculada y activa.
- API `aiplatform.googleapis.com`: **DISABLED**.
- Callable y barrido de supervisión: flags `PROJECT_SUPERVISION_AI_APPROVED=false`
  y `PROJECT_SUPERVISION_AUTOMATION_APPROVED=false` verificados en la configuración desplegada.
- No existe configuración administrativa guardada del módulo; se usan los defaults:
  IA desactivada, modelo vacío, 100 solicitudes y 200.000 tokens reservados por mes UTC,
  12.000 caracteres de fuentes y 1.000 tokens de salida por solicitud.
- No existe documento de consumo de IA del mes actual.
- La cuenta de ejecución compartida tiene `roles/editor`, sin condición en la política
  del proyecto. Ese rol incluye `aiplatform.endpoints.predict`. No se añadieron permisos,
  se crearon claves ni se revocó el rol compartido. El acceso efectivo del servicio
  deberá comprobarse en el piloto tras habilitar la API.

## Modelo y localización propuestos

**`gemini-3.5-flash-lite`, ubicación multirregión `us`, Standard PayGo.**
La documentación lo identifica como GA, con retiro anunciado para julio de 2027 o después.
Admite salida estructurada y razonamiento `MINIMAL`. El procesamiento multirregión
US mantiene el procesamiento ML dentro de Estados Unidos; no se usa fallback global.
Las funciones seguirían alojadas en `us-central1`: la ubicación del modelo es independiente.

El adaptador anterior fijaba `us-central1`, `thinkingBudget: 0` y temperatura 0.1.
Gemini 2.5 fue retirado en la API de Google Cloud el 20 de octubre de 2026. No se debe
activar esa combinación ni limitarse a escribir un nombre de modelo nuevo en el panel.

Cambios preparados en esta rama:

- Endpoint multirregión correcto: `https://aiplatform.us.rep.googleapis.com` y ubicación `us`.
- Configuración de ubicación por variable de servidor; `eu` y `global` solo si se eligen
  expresamente. El piloto solo admite el modelo revisado; modelos desconocidos y
  ubicaciones incompatibles fallan antes de obtener un token o hacer la llamada.
- `thinkingLevel: MINIMAL`, sin temperatura personalizada ni `thinkingBudget` antiguo.
- Esquema de respuesta JSON y comprobación de citas; rechaza truncamientos y no guarda
  partes de razonamiento internas.
- La reserva incluye los bytes UTF-8 del cuerpo completo: fuentes, instrucciones y
  esquema, más salida y margen. El caché distingue ubicación y versión del adaptador.
- Nuevo flag `PROJECT_SUPERVISION_AI_SCHEDULED_APPROVED=false` por defecto:
  habilitar análisis manual/asistente no inicia análisis en segundo plano.
- Las notificaciones mantienen su propio bloqueo de servidor; habilitar IA no lo cambia.

No se cambian dependencias, reglas de Firestore/Storage, destinatarios ni el estado de proyectos.

## Configuración que falta

1. Revisar e integrar el ajuste de compatibilidad; desplegarlo con **todos los flags de
   aprobación todavía en false**. No se desplegó en esta preparación.
2. Autorizar y habilitar `aiplatform.googleapis.com`. No hace falta contratar un modelo,
   reservar capacidad dedicada ni generar una API key para el frontend. Se usa ADC de
   la identidad de ejecución existente.
3. Confirmar el modelo/ubicación propuestos y aprobar que Google Cloud procese los
   textos autorizados de avances, comentarios y metadatos. Esos textos pueden incluir
   datos personales escritos por los colaboradores. No se enviarán archivos ni se hará
   OCR, búsqueda web, grounding o uso de herramientas.
4. Adoptar el piloto de **20 solicitudes y 200.000 tokens reservados/mes**, conservando
   12.000 caracteres de entrada y 1.000 tokens de salida incluidos los de razonamiento.
   Los análisis, el asistente y el resumen ejecutivo comparten el presupuesto.
5. Crear una alerta de presupuesto si se desea; una alerta financiera no es un corte
   automático. La barrera efectiva del módulo es la reserva transaccional de cuota.
6. Tras aprobación, habilitar `PROJECT_SUPERVISION_AI_APPROVED=true` solo en el callable
   de supervisión y guardar `aiEnabled=true` y el modelo en la configuración autorizada.
   Mantener `PROJECT_SUPERVISION_AI_SCHEDULED_APPROVED=false` en todos los servicios,
   y el flag general de IA en false en el barrido, durante el piloto manual.
7. Mantener `PROJECT_SUPERVISION_AUTOMATION_APPROVED=false`, `automaticNotifications=false`,
   `reportDaily=false` y `reportWeekly=false`. No hay envíos automáticos en este piloto.

La [plantilla revisable](supervision-gemini-pilot.example.json) está deliberadamente
apagada. Es información de preparación, no un script de activación. Al guardar la
configuración hay que mezclar el patch con los valores existentes y conservar los
umbrales y calendarios que dirección haya cambiado entretanto.

## Costes estimados

Precios Standard PayGo no globales consultados el 21 de noviembre de 2026, en USD:

| Concepto | Tarifa por millón de tokens |
| --- | ---: |
| Entrada de texto | 0,33 USD |
| Salida, incluido razonamiento | 2,75 USD |

Sin caché facturable, grounding, archivos, búsquedas ni capacidad reservada.
El caché de este módulo es Firestore: no crea caché explícita de pago en Vertex.

Fórmula: `(tokens de entrada × 0,33 + tokens de salida × 2,75) / 1.000.000`.

| Escenario ilustrativo | Tokens de entrada/salida por consulta | Coste de modelo |
| --- | --- | ---: |
| Una consulta breve | 2.000 / 500 | 0,002035 USD |
| Piloto de 20 consultas breves | 2.000 / 500 | 0,0407 USD |
| Piloto de 20 consultas más extensas | 5.000 / 1.000 | 0,088 USD |

Son supuestos de cálculo, no consumos medidos con el tokenizador del modelo. No se
hizo ninguna inferencia ni se ejecutó CountTokens contra el proveedor en esta preparación.
El piloto real debe medir consumo, calidad, latencia y validez del JSON antes de ampliar cuota.

Como envolvente técnica muy conservadora, 200.000 tokens reservados multiplicados por
la tarifa mayor equivalen a **0,55 USD/mes de inferencia** a estas tarifas. Este cálculo
no es una garantía sobre la factura de todo Google Cloud: no incluye impuestos,
conversión de moneda, Firestore, Functions, logs ni uso de otros módulos/identidades.
Las reservas no se liberan por errores; puede detenerse la IA antes de gastar esa cifra.
Propongo una previsión inicial adicional de **1 USD/mes** para este piloto, pendiente de
medir el coste incremental de infraestructura; no constituye un límite duro del proveedor.

### Alcance real de la cuota

Medición de los seis proyectos activos existentes, sin enviar texto a Gemini y sin
conservarlo en el informe de medición:

- Fuentes seleccionadas por proyecto: 2.207–7.620 caracteres.
- Reserva con el adaptador preparado: 5.307–11.174 tokens por proyecto.
- Una ronda de los seis: 50.613 tokens reservados.
- Con 200.000 tokens: tres rondas completas (18 análisis), más análisis parciales
  hasta agotar uno de los límites. Las consultas del asistente consumen la misma cuota.

Por tanto, el default de «100 solicitudes» nunca debe presentarse como 100 análisis
asegurados. Para el piloto propongo limitar además a 20 solicitudes manuales. En la
versión desplegada el análisis programado también consume cuota al cambiar la versión
por día local; el nuevo flag independiente evita ese consumo durante el piloto.

## Prueba real después de la aprobación

Primero usar un texto sintético sin datos personales, una sola solicitud, y comprobar
respuesta STOP, JSON válido, citas conocidas y `usageMetadata`. Después probar un proyecto
expresamente seleccionado, verificar la reserva/consumo y repetir para comprobar el caché.
Revisar que el barrido no invoca al proveedor y que el conteo de notificaciones sigue en cero.
No se necesitan mensajes a colaboradores ni cambios de estado para probar el modelo.

Rollback: desactivar `aiEnabled` y devolver `PROJECT_SUPERVISION_AI_APPROVED=false`;
las reglas determinísticas y el panel permanecen disponibles. La desactivación no
revierte solicitudes que ya estuvieran en curso ni cargos ya generados.

## Fuentes oficiales

- [Modelo Gemini 3.5 Flash-Lite: capacidades, ubicación y ciclo de vida](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite).
- [Ciclo de vida y retiro de modelos](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions).
- [Endpoints regionales, multirregión y globales](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations).
- [Configuración de razonamiento](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking).
- [Precios de Google Cloud para modelos](https://cloud.google.com/model-garden/pricing).

## Validación local

La preparación utiliza respuestas controladas, sin llamadas reales a Gemini. Las pruebas
cubren endpoint multirregión, modelo admitido, parámetros vigentes, respuestas truncadas,
citas inválidas, exclusión de pensamiento interno, reserva del payload completo, caché
por ubicación y piloto manual sin IA programada ni notificaciones.


Resultado: **214 pruebas correctas, 0 fallos**, incluyendo seguridad de reglas y Storage,
integración, motor, proveedor simulado y regresión de notificaciones. ESLint específico
sin errores y sintaxis de `functions/index.js` correcta. `npm run lint` global continúa
bloqueado por la dependencia `typescript-eslint` ausente en la configuración de
Active Classroom; no se modificó ese módulo ni se ocultó el resultado.

Al finalizar se repitió la auditoría de producción: API de Vertex DISABLED, ambos
flags generales false, configuración sin modelo/IA habilitada y sin documento de
consumo del mes. No se desplegaron estos cambios.
