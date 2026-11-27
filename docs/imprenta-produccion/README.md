# Gestor de Impresiones

El Gestor se abre desde **Imprenta → Gestor de Impresiones**. La navegación conserva **Solicitudes**, **Certificados**, **Credenciales**, **Plantillas** y las secciones de producción e Inventario existentes.

## Operación

1. Elige un PDF local de hasta 32 MB, un PDF de Nube AS o un archivo vinculado a un material o plantilla. El servidor valida el documento y conserva una copia inmutable, con número de páginas, versión de Storage y SHA-256.
2. Define el papel, color, caras, copias, prioridad y acabados. Puedes guardar un borrador antes de vincular equipos.
3. Confirma la modalidad y las impresoras compatibles. La distribución por páginas requiere ensamblar los tramos. La estimación del tiempo depende de la capacidad y cola informadas por el equipo.
4. En el detalle, concilia la salida real. CUPS acredita el envío o la finalización en la cola. Para registrar calidad, el operador verifica todas las partes y el ensamblaje.
5. Registra unidades aceptadas y rechazadas. Aplica una regla de inventario explícita para ingresar automáticamente las aceptadas, o regístralas manualmente. El destino de la regla queda como etiqueta operativa sobre el inventario global por producto. Los documentos personalizados se entregan directamente salvo regla específica por producto y tipo.

## Documentos emitidos

En **Configuración de Imprenta**, la activación de certificados y credenciales empieza deshabilitada. Prueba primero una copia en cada cola y verifica el QR, el folio, el tamaño y el recorrido de recuperación. Cuando se habilita, **Preparar en Gestor** usa el PDF definitivo de la emisión. En credenciales históricas hace falta el PDF de frente y reverso que conserva el QR original. En **Solicitudes** se muestra el estado asociado al trabajo. Sigue disponible el flujo anterior, con confirmación cuando haya una entrega gestionada sin resolver.

## Agente local

Consulta [instalación, vinculación, diagnóstico y actualización](../../as-print-agent/README.md). Los instaladores de macOS y Linux con CUPS usan Python 3 y qpdf. El paquete macOS se genera sin firma Developer ID. La cola y el registro local persisten al cerrar el navegador. Cuando el agente o CUPS pierden información después de comenzar el envío, confirma físicamente qué salió antes de reasignar.

## Datos y seguridad

Las escrituras de producción pasan por Cloud Functions. Firestore contiene `printJobs/{id}/events`, `printDocuments`, `printPrinters`, `printAgents`, `printSettings/production`, `printMaterialLinks`, `printProductionTemplates`, `printReports` y `printReportSchedules`. Las credenciales de agentes y operaciones idempotentes son internas. Pagina el historial por fecha. Storage admite cargas temporales privadas de una sola creación y snapshots de producción sin escritura de clientes. La purga programada retira cargas abandonadas de más de 24 horas. La actualización es aditiva y usa los movimientos ya existentes de existencias e insumos.

Los reportes distinguen caras solicitadas, caras verificadas durante la conciliación, unidades de calidad y stock ingresado. Las emisiones provienen de sus registros originales. Los reportes periódicos pueden avisar dentro de la plataforma. El correo requiere un proveedor autorizado. La telemetría y los costos aparecen si hay datos del dispositivo o del trabajo. La imposición de cuadernillos y los controladores físicos dependen de las capacidades del dispositivo. Las interfaces utilizan la navegación institucional y fechas, datos y documentos del entorno en uso.

## Evidencia visual local

| Referencia | Captura |
| --- | --- |
| Gestor y seguimiento | [Trabajos](capturas/01-trabajos.png), [1024 px](capturas/12-trabajos-1024.png) |
| Nueva impresión | [Asistente](capturas/02-nueva-impresion.png), [Selector de Nube AS](capturas/11-selector-nube.png) |
| Historial | [Historial](capturas/03-historial.png) |
| Estadísticas | [Estadísticas](capturas/04-estadisticas.png) |
| Reportes | [Centro de reportes](capturas/05-reportes.png) |
| Integración con Inventario | [Inventario](capturas/06-inventario.png) |
| Catálogo de materiales | [Materiales](capturas/07-materiales.png) |
| Biblioteca de plantillas | [Plantillas](capturas/08-plantillas.png) |
| Configuración | [Configuración](capturas/09-configuracion.png), [Vinculación](capturas/10-vinculacion.png) |

Las capturas muestran la aplicación con Firebase local. La navegación general corresponde al repositorio. Los estados vacíos y equipos de prueba explican las diferencias con las cifras y fotografías de los diseños.

## Validación y recuperación

- `node --test tests/print-*.test.cjs tests/certificate-*.test.mjs tests/certificate-*.test.cjs`
- `npm run test:rules` y `npm run build`.
- Con Firebase local, ejecuta `tests/print-production-emulator.test.cjs` y `tests/print-agent-emulator.test.cjs`.
- `python3 -B as-print-agent/test_agent.py` y `python3 -B as-print-agent/test_virtual_ipp.py`.

Despliega las funciones por nombre en el codebase `default`, después las reglas de Firestore y Storage y al final Hosting. Conserva el release de Hosting y los IDs de reglas vigentes para recuperarlos si falla la verificación. Durante una recuperación operativa, revoca los agentes afectados y verifica el resultado físico de los trabajos ya aceptados por CUPS. Usa los estados y el historial de eventos para conciliar la cola antes de devolverla a servicio.

## Miniaturas, grupos y reglas

- La primera etapa y el visor de PDF muestran seis miniaturas por página de navegación. Selecciona una imagen para abrir su página en el visor. El renderizado ocurre en el navegador con el PDF definitivo ya autorizado.
- En Configuración, crea grupos con colas detectadas y ordena sus reglas. Se aplica la primera regla activa cuyas condiciones coinciden con el documento y el tiraje. Si ninguna coincide, se usa el grupo seleccionado o la configuración general. Si la regla exige velocidad o una cola con un máximo de trabajos, solo cuentan equipos con esas lecturas. Si el grupo queda sin equipos aptos, el asistente indica el motivo antes de encolar.
- El asistente muestra la regla, el grupo, los tramos y la duración estimada cuando tiene datos suficientes. Si cambian las asignaciones entre la revisión y la confirmación, vuelve a mostrar el reparto antes de encolar.
- En los detalles de la impresora, las lecturas de CUPS muestran cuándo se tomaron. Los consumibles y las bandejas pueden informar un valor, un porcentaje calculable o un nivel sin datos. El contador de caras procesadas se muestra por tramo cuando CUPS lo facilita. El avance de CUPS y la validación física conservan estados separados.
