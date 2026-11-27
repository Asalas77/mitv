/*
 * Teclas del control remoto LG (y su equivalente en el teclado del PC para probar).
 *   Flechas, OK (Enter), Atrás (461 / Esc / Retroceso), CH+ / CH- (Re Pág / Av Pág),
 *   botones de colores (Rojo = F en el PC), Info (I), números 0-9, reproducir/pausa (Espacio).
 */
var Keys = (function () {
  'use strict';
  var MAP = {
    37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok',
    461: 'back', 27: 'back', 8: 'back',
    33: 'chup', 34: 'chdown',
    415: 'play', 19: 'pause', 413: 'stop', 417: 'ff', 412: 'rw', 179: 'playpause', 32: 'playpause',
    403: 'red', 404: 'green', 405: 'yellow', 406: 'blue', 457: 'info',
    70: 'red', 73: 'info'
  };
  function fromEvent(e) {
    var c = e.keyCode || e.which;
    if (c >= 48 && c <= 57) return 'num' + (c - 48);
    if (c >= 96 && c <= 105) return 'num' + (c - 96);
    return MAP[c] || null;
  }
  function isNum(k) { return !!k && k.indexOf('num') === 0; }
  function digit(k) { return parseInt(k.slice(3), 10); }
  return { fromEvent: fromEvent, isNum: isNum, digit: digit };
})();
