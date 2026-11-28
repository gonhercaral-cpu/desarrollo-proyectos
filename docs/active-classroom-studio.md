# Active Classroom Studio

En Active Classroom, abre el nivel y la unidad. Entra en **Studio** o usa **Abrir Studio** desde las acciones de un PPTX o Google Slides.

1. Importa desde Nube AES, sube un PPTX o selecciona una presentación de la unidad. Convierte la presentación para generar su borrador.
2. En **Editor**, selecciona un cuadro de texto o imagen compatible. Arrastra, mueve con las flechas o cambia los valores del inspector. El guardado automático conserva los cambios mientras el PNG muestra la última conversión.
3. Pulsa **Regenerar conversión**. Revisa el resultado y usa **Reproducción** para comprobar los recursos animados y los estados de revelado compatibles.
4. Abre **Alertas** para comparar. La vista de Google Slides consulta su miniatura original. Para PPTX, la referencia se conserva al generar la primera corrección.
5. En **Revisiones**, guarda el comentario y la prioridad. Un administrador de permisos puede asignar un revisor. Desde **Publicación**, un usuario autorizado puede aprobar, validar y publicar, o programar el borrador de la unidad. Restaurar publica los recursos verificados de una versión histórica con un número nuevo.

Para una aceptación aislada, crea una unidad nueva y usa **Publicación → Limitar esta unidad a un equipo de prueba** antes de la primera publicación. El operador necesita permisos de publicación y gestión de equipos. La asignación es permanente y restringe el catálogo, manifiesto, descarga y confirmación de sincronización al equipo elegido. Usa un archivo de prueba en Nube AES. Confirma recepción y reproducción en Desktop y verifica el estado de sincronización de la versión en Studio.

## Contratos y persistencia

- **Original.** Se conserva la generación del snapshot privado. Los documentos nativos de Google conservan su versión de Drive y usan el snapshot PPTX exportado por la ruta de conversión existente. Studio comprueba la vigencia y los permisos de Nube AES.
- **Borrador.** `activeClassroomStudioDrafts/{resourceId}` conserva los parches relativos a la fuente. Solo acceden las funciones autorizadas. La revisión de correcciones y la revisión de comentarios tienen contadores independientes. El código valida la pertenencia a la unidad antes de acceder a la presentación.
- **Regeneración.** Functions compara las correcciones aplicadas con el borrador y envía capacidades V4 para los estados PNG afectados. Python modifica una copia temporal del PPTX. Si existen campos que dependen del orden, conserva el PDF intermedio completo y rasteriza únicamente las páginas seleccionadas. Al reutilizar páginas, Functions verifica la generación y los metadatos de las referencias congeladas. El plan completo se procesa cuando cambian la estructura o el presupuesto GIF. Si falla, se recupera la conversión anterior.
- **Publicación.** La edición y la regeneración escriben el borrador. Las correcciones regeneradas requieren aprobación para publicar en cualquiera de las entradas de la interfaz. Cloud Tasks valida el borrador y la integridad de las generaciones antes de activar la versión. Una publicación programada se invalida si cambia la revisión capturada. La restauración verifica todos los recursos históricos y conserva el historial.
- **Compatibilidad.** El manifiesto mantiene `schemaVersion: 2`. Desktop reutiliza recursos con el mismo SHA-256. El editor de revelados manuales reutiliza los estados y capas que ya admite Desktop.
- **Tipografías.** Studio informa si el nombre explícito de una familia carece de coincidencia exacta en Fontconfig. La estimación de salto de línea depende de las métricas disponibles en el navegador y debe confirmarse en la imagen regenerada. El procesador mantiene el conjunto de fuentes instalado.
- **Elementos admitidos.** Cuadros simples e imágenes incrustadas de primer nivel con coordenadas explícitas. Los cuadros de varios fragmentos conservan su formato y permiten ajustes geométricos. El inspector de un fragmento simple admite color RGB, fuente instalada, tamaño, alineación e interlineado porcentual cuando el formato de origen es compatible. Los grupos, rotaciones, marcadores de posición, campos y movimientos complejos siguen sujetos al conversor y al formato Desktop.

## Validación e integración

- `npm run test:active-classroom` cubre la biblioteca y el editor de unidad.
- `python -m unittest discover -s tests` desde el directorio del procesador comprueba el PPTX editable y la regeneración PNG con LibreOffice.
- `tests/active-classroom-studio-emulator.test.cjs` usa Firestore y Storage locales para verificar permisos, concurrencia, fallo de conversión, aprobación, publicación, cancelación y restauración.
- `npm run test:offline`, `npm run test:player` y `npm run test:builds` desde Desktop cubren lectura y sincronización del contrato vigente.
- El orden de despliegue sigue [el procedimiento del procesador](active-classroom-office-processing.md): primero la imagen privada, después las Functions modificadas de Drive y al final Hosting. La validación de aceptación necesita una unidad aislada, un PPTX, un Google Slides y un equipo de prueba autorizado.
