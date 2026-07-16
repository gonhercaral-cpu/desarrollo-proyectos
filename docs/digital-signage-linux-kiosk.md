# Digital Signage en Linux modo quiosco

Guia para preparar una PC Linux, mini PC o Raspberry Pi OS como reproductor de Digital Signage.

El reproductor usa una URL como:

```text
https://DOMINIO/signage/player/DEVICE_TOKEN
```

No coloques tokens reales en documentacion, tickets o capturas publicas.

## Requisitos

- Debian, Ubuntu, Raspberry Pi OS o distribucion compatible.
- Usuario grafico con sesion X11 o escritorio liviano.
- Red estable.
- Chromium o Chromium Browser.
- Acceso `sudo` si necesitas instalar paquetes.
- URL completa del reproductor copiada desde el modulo Digital Signage.

## Copiar URL desde el sistema

1. Entra al sistema como administrador.
2. Abre `Digital Signage`.
3. Ve a `Dispositivos`.
4. Selecciona la pantalla.
5. Usa `Copiar URL`.
6. La URL debe verse asi:

```text
https://DOMINIO/signage/player/DEVICE_TOKEN
```

## Instalacion rapida con script

Desde la raiz del repo:

```bash
chmod +x scripts/signage/install-linux-kiosk.sh
./scripts/signage/install-linux-kiosk.sh --url "https://DOMINIO/signage/player/DEVICE_TOKEN" --name "Pantalla Recepcion"
```

Tambien puedes ejecutarlo sin parametros. El script pedira la URL:

```bash
./scripts/signage/install-linux-kiosk.sh
```

El script crea:

```text
~/.config/aes-signage/player.env
~/.local/bin/aes-signage-kiosk
~/.config/autostart/aes-signage.desktop
```

## Archivo de configuracion local

Edita la configuracion cuando cambie la URL o el nombre local:

```bash
nano ~/.config/aes-signage/player.env
```

Formato:

```bash
PLAYER_URL="https://DOMINIO/signage/player/DEVICE_TOKEN"
DEVICE_NAME="Pantalla Recepcion"
```

Despues reinicia sesion o ejecuta:

```bash
~/.local/bin/aes-signage-kiosk
```

## Probar Chromium manualmente

Antes de activar autostart, prueba:

```bash
chromium --kiosk --no-first-run --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required "https://DOMINIO/signage/player/DEVICE_TOKEN"
```

En algunas distros el comando es:

```bash
chromium-browser --kiosk --no-first-run --disable-infobars --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required "https://DOMINIO/signage/player/DEVICE_TOKEN"
```

## Activar autostart

El script crea un archivo `.desktop` en:

```text
~/.config/autostart/aes-signage.desktop
```

Esto abre el reproductor al iniciar sesion grafica. Si no inicia, verifica que tu entorno respete XDG Autostart. En Raspberry Pi OS/LXDE tambien puedes agregar manualmente:

```text
@/home/USUARIO/.local/bin/aes-signage-kiosk
```

en:

```text
~/.config/lxsession/LXDE-pi/autostart
```

## Evitar suspension de pantalla

El launcher intenta ejecutar:

```bash
xset s off
xset s noblank
xset -dpms
```

Si la pantalla se apaga, revisa configuracion de energia del sistema. En Raspberry Pi OS tambien revisa `Screen Blanking`.

## Ocultar cursor

El script instala `unclutter` si esta disponible. Si no se instala, el reproductor funciona igual, solo puede quedar visible el cursor.

Instalacion manual:

```bash
sudo apt-get update
sudo apt-get install unclutter
```

## Desinstalar o revertir

No borres nada critico. Quita solo estos archivos creados para quiosco:

```bash
rm -f ~/.config/autostart/aes-signage.desktop
rm -f ~/.local/bin/aes-signage-kiosk
rm -f ~/.config/aes-signage/player.env
```

Opcionalmente elimina el perfil local de Chromium usado por el quiosco:

```bash
rm -rf ~/.config/aes-signage/chromium-profile
```

No desinstales Chromium si se usa para otras cosas.

## Problemas comunes

### Pantalla dice "Dispositivo no registrado"

La URL contiene token incorrecto o el dispositivo fue eliminado. Copia de nuevo la URL desde `Digital Signage > Dispositivos`.

### Pantalla dice "Sin contenido asignado"

El dispositivo no tiene playlist/campaña asignada o el contenido esta inactivo.

### Video no reproduce

Verifica que Chromium abra con:

```text
--autoplay-policy=no-user-gesture-required
```

El player tambien usa video muted para permitir autoplay.

### Chromium no abre al reiniciar

Verifica:

```bash
ls ~/.config/autostart/aes-signage.desktop
cat ~/.config/aes-signage/player.env
```

Luego prueba manual:

```bash
~/.local/bin/aes-signage-kiosk
```

### Cursor visible

Instala `unclutter` o mueve el cursor a una esquina.

### No hay conexion

El player puede usar ultimo manifest y cache best-effort si ya reprodujo contenido antes. La primera carga requiere red.
