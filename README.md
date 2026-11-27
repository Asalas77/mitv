# Mi TV — reproductor de TV en vivo, películas y series para LG webOS

App propia para televisores LG (webOS), hecha desde cero. Reproduce **solo las fuentes que tú
configuras**: la lista M3U de tu proveedor de TV, canales que se emiten gratis de forma oficial,
tu propio servidor [Jellyfin](https://jellyfin.org) o listas M3U con tus propios videos.
No incluye canales ni enlaces de terceros (solo una demostración con señales de prueba públicas
y cortometrajes libres de Blender Foundation).

## Qué incluye

- **TV en vivo**: categorías (`group-title`), favoritos, logos, vista previa en miniatura,
  pantalla completa con barra de información, lista rápida de canales sobre el video,
  cambio de canal con ▲▼ / CH+ CH− y marcado directo de números.
- **Guía de programación** (XMLTV): "ahora / después" en cada canal y una cuadrícula canales × horas.
  Se cruza con los canales por `tvg-id`, `tvg-name` o nombre.
- **Películas y series**: desde Jellyfin (con temporadas, episodios y "Continuar viendo"
  guardado en el servidor) o desde listas M3U (con "Continuar viendo" guardado en el TV).
- **Ajustes** en la propia app: agregar/quitar listas, conectar Jellyfin, demostración, borrar datos.
- Hecha en JavaScript ES5 sin librerías, para que funcione también en TVs LG antiguos.

## Estructura

```
MiTV/
├── app/                      ← la app de webOS (esto es lo que se empaqueta)
│   ├── appinfo.json          ← id, nombre, versión e íconos
│   ├── index.html
│   ├── css/app.css
│   ├── js/                   ← lógica (ver comentarios al inicio de cada archivo)
│   │   ├── config.js         ← nombre de la app y tiempos
│   │   ├── m3u.js / xmltv.js ← lectores de listas y guías
│   │   ├── data.js           ← carga canales, categorías, guía y catálogo
│   │   ├── jellyfin.js       ← cliente de Jellyfin
│   │   ├── player.js         ← reproductor (miniatura / pantalla completa)
│   │   ├── nav.js            ← navegación con el control remoto
│   │   └── screens/          ← TV en vivo, Guía, Películas, Ficha, Ajustes
│   ├── img/                  ← íconos (80×80 y 130×130)
│   └── demo/                 ← listas de demostración y carátulas
└── tools/
    ├── servidor_pruebas.py   ← servidor local para probar en el PC (incluye un Jellyfin simulado)
    ├── generar_medios_prueba.py ← crea videos de prueba con ffmpeg
    └── generar_iconos.py     ← regenera íconos y carátulas (Pillow)
```

## Probarla en el PC

Necesitas Python 3 (y ffmpeg solo para los videos de prueba):

```powershell
cd C:\app\Xuper\MiTV
python tools\generar_medios_prueba.py
python tools\servidor_pruebas.py
```

Abre <http://localhost:8080> en Chrome o Edge. Teclas: flechas, **Enter** = OK,
**Esc** o **Retroceso** = Atrás, **Re Pág / Av Pág** = CH+ / CH−, **F** = botón rojo (favorito),
**I** = info, números = canal, **Espacio** = pausa.

En **Ajustes** puedes agregar las listas de prueba del servidor local:

| Qué | Dirección |
|---|---|
| Canales de prueba (con guía) | `http://localhost:8080/pruebas/canales.m3u` |
| 3000 canales (rendimiento) | `http://localhost:8080/pruebas/grande.m3u` |
| Películas de prueba | `http://localhost:8080/pruebas/peliculas.m3u` |
| Jellyfin simulado | servidor `http://localhost:8080/jellyfin`, usuario `prueba`, contraseña `prueba` |

## Instalarla en tu TV LG

Se instala con el **Modo Desarrollador** oficial de LG (no hace falta rootear el TV).

1. **Cuenta de desarrollador**: créala gratis en <https://webostv.developer.lge.com>.
2. **En el TV**: abre la tienda *LG Content Store*, instala la app **Developer Mode**, ábrela,
   inicia sesión con esa cuenta y activa **Dev Mode Status** (el TV se reinicia). Vuelve a abrir
   Developer Mode y activa **Key Server**. Anota la **IP** del TV y la **frase de acceso** (passphrase).
3. **En el PC**, instala las herramientas de LG (necesitan Node.js):

   ```powershell
   npm install -g @webos-tools/cli
   ```

4. Registra el TV (responde: nombre `tv`, la IP del TV, puerto `9922`, usuario `prisoner`, sin contraseña):

   ```powershell
   ares-setup-device
   ```

   ```powershell
   ares-novacom --device tv --getkey
   ```

   (te pedirá la frase de acceso que muestra el TV).
5. Empaqueta, instala y abre la app:

   ```powershell
   ares-package C:\app\Xuper\MiTV\app -o C:\app\Xuper\MiTV\dist
   ```

   ```powershell
   ares-install --device tv C:\app\Xuper\MiTV\dist\com.mitv.player_1.0.0_all.ipk
   ```

   ```powershell
   ares-launch --device tv com.mitv.player
   ```

La app aparece en el menú de apps del TV. La sesión del Modo Desarrollador caduca cada cierto
tiempo: abre la app *Developer Mode* y pulsa **Extend** para renovarla (si caduca, las apps
instaladas así dejan de estar disponibles hasta que la renueves y las vuelvas a instalar).
Para depurar en el TV: `ares-inspect --device tv --app com.mitv.player --open`.

## Usar tus fuentes

- **Lista de canales**: la URL M3U que te da tu proveedor. Formato:

  ```
  #EXTM3U url-tvg="http://servidor/guia.xml"
  #EXTINF:-1 tvg-id="canal1" tvg-logo="http://servidor/logo.png" group-title="Noticias",Canal 1
  http://servidor/canal1.m3u8
  ```

- **Guía**: si la lista trae `url-tvg` se usa sola; si no, pon la URL XMLTV al agregar la lista.
  Los TV más antiguos no pueden descomprimir guías `.xml.gz`; en ese caso usa la versión `.xml`.
- **Películas M3U**: igual que una lista de canales; `tvg-logo` es la carátula, `group-title`
  la fila, y opcionalmente `year="2020"` y `description="..."`.
- **Jellyfin**: en Ajustes pon `http://IP-de-tu-servidor:8096`, tu usuario y contraseña. Si un
  archivo no se reproduce, activa *Transcodificar en el servidor*.

## Control remoto

| Tecla | En listas | En pantalla completa (TV) | En pantalla completa (película) |
|---|---|---|---|
| ▲ ▼ | moverse | canal siguiente / anterior | mostrar barra |
| ◀ ▶ | cambiar de columna | ◀ lista de canales · ▶ info | retroceder / avanzar 10 s |
| OK | elegir | lista de canales | pausa / continuar |
| CH+ / CH− | saltar página | canal siguiente / anterior | — |
| ⏪ ⏩ | — | — | retroceder / avanzar 30 s |
| Rojo | favorito | favorito | — |
| 0–9 | ir al canal | ir al canal | — |
| Atrás | volver / menú | vista previa | salir (guarda la posición) |

## Personalizar

- **Nombre**: `title` y `vendor` en `app/appinfo.json` y `APP_NAME` en `app/js/config.js`.
  Si cambias el `id` (por ejemplo `com.tunombre.tv`), el `.ipk` llevará ese nombre.
- **Ícono**: `python tools\generar_iconos.py --c1 "#29b6f6" --c2 "#1565c0"` (o reemplaza
  `app/img/icon.png` 80×80 y `app/img/largeIcon.png` 130×130).
- **Color principal**: el ámbar `#ffb300` en `app/css/app.css`.
- **Versión**: sube `version` en `appinfo.json` y `VERSION` en `config.js` antes de reinstalar.

## Limitaciones conocidas

- Probada en un navegador Chromium del PC con el servidor de pruebas; **todavía no en un TV
  LG real**. Las teclas del control, los formatos de video y el teclado en pantalla siguen la
  documentación de LG, pero conviene revisarlos en tu TV.
- No reproduce señales con DRM (Widevine/PlayReady) ni enlaces que exigen cabeceras especiales
  (User-Agent o Referer).
- En el navegador del PC algunas señales HLS (por ejemplo, con audio HE-AAC, como las dos de
  Akamai de la demostración) no se reproducen; los TV LG normalmente sí las soportan.
- En el navegador del PC, las listas de otros servidores solo cargan si ese servidor lo permite
  (CORS). Las apps instaladas en el TV no suelen tener esa restricción.

Úsala solo con contenido que tengas derecho a ver.

## Licencia

Código bajo licencia [MIT](LICENSE). Los componentes de `app/vendor/` (hls.js, qrcode-generator)
mantienen sus propias licencias, y las señales de las listas pertenecen a sus dueños.
