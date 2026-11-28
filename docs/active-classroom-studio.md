# Active Classroom Studio

En Active Classroom, abre el nivel y la unidad. Entra en **Studio** o usa **Abrir Studio** desde las acciones de un PPTX o Google Slides.

1. Importa desde Nube AES, sube un PPTX o selecciona una presentación de la unidad. Convierte la presentación para generar su borrador.
2. En **Editor**, selecciona un cuadro de texto o imagen compatible. Arrastra, mueve con las flechas o cambia los valores del inspector. El guardado automático conserva los cambios mientras el PNG muestra la última conversión.
3. Pulsa **Regenerar conversión**. Revisa el resultado y usa **Reproducción** para comprobar los recursos animados y los estados de revelado compatibles.
4. Abre **Alertas** para comparar. La vista de Google Slides consulta su miniatura original. Para PPTX, la referencia se conserva al generar la primera corrección.
5. En **Revisiones**, guarda el comentario y la prioridad. Un administrador de permisos puede asignar un revisor. Desde **Publicación**, un usuario autorizado puede aprobar, validar y publicar, o programar el borrador de la unidad. Restaurar publica los recursos verificados de una versión histórica con un número nuevo.

## Contratos y persistencia

- **Original.** Se conserva la generación del snapshot privado. Los documentos nativos de Google conservan su versión de Drive y usan el snapshot PPTX exportado por la ruta de conversión existente. Studio comprueba la vigencia y los permisos de Nube AES.
- **Borrador.** `activeClassroomStudioDrafts/{resourceId}` conserva los parches relativos a la fuente. Solo acceden las funciones autorizadas. La revisión de correcciones y la revisión de comentarios tienen contadores independientes. El código valida la pertenencia a la unidad antes de acceder a la presentación.
- **Regeneración.** Functions envía al procesador privado las correcciones y las capacidades V4 de la generación exacta. Python modifica una copia temporal del PPTX. Después, el pipeline existente produce los PNG, estados de revelado y GIF que Desktop sabe reproducir. Si la regeneración falla, se recupera la conversión anterior. El registro de procesamiento permite recuperar una conversión interrumpida cuando expire su concesión.
- **Publicación.** La edición y la regeneración escriben el borrador. Las correcciones regeneradas requieren aprobación para publicar en cualquiera de las entradas de la interfaz. Cloud Tasks valida el borrador y la integridad de las generaciones antes de activar la versión. Una publicación programada se invalida si cambia la revisión capturada. La restauración verifica todos los recursos históricos y conserva el historial.
- **Compatibilidad.** El manifiesto mantiene `schemaVersion: 2`. Desktop puede reutilizar recursos con el mismo SHA-256. La regeneración del servidor todavía procesa la presentación completa.
- **Tipografías.** Studio informa si el nombre explícito de una familia carece de coincidencia exacta en Fontconfig. La estimación de salto de línea depende de las métricas disponibles en el navegador y debe confirmarse en la imagen regenerada. El procesador mantiene el conjunto de fuentes instalado.
- **Elementos admitidos.** Cuadros simples e imágenes incrustadas de primer nivel con coordenadas explícitas. Los cuadros de varios fragmentos conservan su formato y permiten ajustes geométricos. La edición textual y de tamaño de fuente se limita a un fragmento simple. Los grupos, rotaciones, marcadores de posición, campos y los movimientos complejos siguen sujetos a la fidelidad del conversor y al formato Desktop.

## Validación e integración

- `npm run test:active-classroom` cubre la biblioteca y el editor de unidad.
- `python -m unittest discover -s tests` desde el directorio del procesador comprueba el PPTX editable y la regeneración PNG con LibreOffice.
- `tests/active-classroom-studio-emulator.test.cjs` usa Firestore y Storage locales para verificar permisos, concurrencia, fallo de conversión, aprobación, publicación, cancelación y restauración.
- `npm run test:offline`, `npm run test:player` y `npm run test:builds` desde Desktop cubren lectura y sincronización del contrato vigente.
- El orden de despliegue sigue [el procedimiento del procesador](active-classroom-office-processing.md): primero la imagen privada, después las Functions modificadas de Drive y al final Hosting. La validación de aceptación necesita una unidad aislada, un PPTX, un Google Slides y un equipo de prueba autorizado.
