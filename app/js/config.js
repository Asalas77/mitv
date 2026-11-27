/*
 * Configuración general de Mi TV.
 * Para usar tu propio nombre cambia APP_NAME aquí y "title"/"vendor" en appinfo.json.
 * Todo el código está escrito en JavaScript ES5 para que funcione en TVs LG webOS antiguos.
 */
var CONFIG = {
  APP_NAME: 'Mi TV',
  VERSION: '1.1.1',
  STORAGE_PREFIX: 'mitv.',
  AUTOPLAY_LAST_CHANNEL: true,   // al abrir la app, reproduce en miniatura el último canal visto
  EPG_PAST_HOURS: 3,             // horas de guía hacia atrás que se conservan
  EPG_FUTURE_HOURS: 36,          // horas de guía hacia adelante que se conservan
  BANNER_MS: 5000,               // tiempo visible de la barra de información del canal
  VOD_BAR_MS: 4000,              // tiempo visible de la barra de progreso de películas
  SEEK_STEP: 10,                 // segundos que avanza/retrocede ◀ ▶
  SEEK_STEP_FAST: 30,            // segundos que avanza/retrocede ⏪ ⏩
  NUM_ENTRY_MS: 1600,            // espera tras marcar un número de canal
  ZAP_DELAY_MS: 450,             // espera antes de sintonizar al cambiar de canal rápido
  JELLYFIN_CLIENT: 'Mi TV',
  DEMO_LIVE_URL: 'demo/canales-demo.m3u',
  DEMO_VOD_URL: 'demo/peliculas-demo.m3u',
  PAIR_SITE: 'https://mitv-online.netlify.app',   // sitio con la página y la función para vincular el celular
  // Listas que vienen cargadas la primera vez que se abre la app.
  DEFAULT_LISTS: [
    { id: 'unida', name: 'Canales abiertos verificados (Chile + español)', url: 'listas/canales.m3u', epg: '' }
  ]
};
