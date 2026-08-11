# Biblioteca local compartida

Fuente de datos para desarrollo local de Active Classroom:

```text
admin-web (crear/renombrar/subir)
  -> API Vite 127.0.0.1:1430/__active_classroom
  -> catalog.json + files/
  -> desktop src/services/library-catalog.ts (solo lectura)
  -> escenario docente y pantalla alumnado
```

`catalog.json` guarda jerarquía y metadata. `files/` guarda copias binarias importadas desde admin. El puente escucha solo en `127.0.0.1` mientras corre `npm run admin:dev`. No es backend, nube, sistema multiusuario ni seguridad de producción.

Docente actualiza con botón **Actualizar** o reiniciando la app. Reemplazo futuro: conservar contratos `LibraryCatalog` y sustituir adaptadores `admin-web/src/services/local-catalog.ts` y `src/services/library-catalog.ts` por cliente cloud autenticado.

Límites: cambios directos al JSON requieren reiniciar/actualizar; archivos máximos 512 MB; disponibilidad/códecs dependen del sistema; borrar admin storage/este directorio elimina copias locales. No editar archivos mientras upload está activo.
