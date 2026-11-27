/*
 * Navegación con el control remoto.
 *  - ListZone: lista vertical larga (miles de canales) que solo dibuja las filas visibles.
 *  - FormZone: botones y campos; las flechas buscan el elemento más cercano en esa dirección.
 *  - RowsZone: filas horizontales de carátulas (películas y series).
 * Todas aceptan también el puntero del Magic Remote o el ratón.
 */
var Nav = (function () {
  'use strict';
  function gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); }
  function findNext(cur, items, dir) {
    if (!cur) return items[0] || null;
    var r = cur.getBoundingClientRect(), rcx = (r.left + r.right) / 2, rcy = (r.top + r.bottom) / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < items.length; i++) {
      var e = items[i];
      if (e === cur) continue;
      var q = e.getBoundingClientRect(), qcx = (q.left + q.right) / 2, qcy = (q.top + q.bottom) / 2, primary, secondary, off;
      if (!q.width && !q.height) continue;
      if (dir === 'down' || dir === 'up') {
        if (dir === 'down' && (qcy <= rcy + 4 || q.top <= r.top + 4)) continue;
        if (dir === 'up' && (qcy >= rcy - 4 || q.bottom >= r.bottom - 4)) continue;
        primary = dir === 'down' ? Math.max(0, q.top - r.bottom) : Math.max(0, r.top - q.bottom);
        secondary = gap(q.left, q.right, r.left, r.right);
        off = Math.abs(qcx - rcx);
      } else {
        if (dir === 'right' && (qcx <= rcx + 4 || q.left <= r.left + 4)) continue;
        if (dir === 'left' && (qcx >= rcx - 4 || q.right >= r.right - 4)) continue;
        secondary = gap(q.top, q.bottom, r.top, r.bottom);
        if (secondary > 0) continue;   // izquierda/derecha solo dentro de la misma fila
        primary = dir === 'right' ? Math.max(0, q.left - r.right) : Math.max(0, r.left - q.right);
        off = Math.abs(qcy - rcy);
      }
      var score = primary + secondary * 4 + off * 0.05;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }
  return { findNext: findNext };
})();

/* ---------------- ListZone ---------------- */
function ListZone(o) {
  'use strict';
  var self = this;
  this.o = o;
  this.el = o.el;
  this.index = 0;
  this.top = 0;
  this.active = false;
  this.rows = {};
  U.addClass(this.el, 'lz');
  this.inner = U.el('div', 'lz-inner');
  this.emptyEl = U.el('div', 'lz-empty hidden');
  this.bar = U.el('div', 'lz-bar hidden');
  this.thumb = U.el('i');
  this.bar.appendChild(this.thumb);
  this.el.appendChild(this.inner);
  this.el.appendChild(this.emptyEl);
  this.el.appendChild(this.bar);

  function rowIndex(e) {
    var row = U.closestAttr(e.target, 'data-index', self.el);
    return row ? parseInt(row.getAttribute('data-index'), 10) : -1;
  }
  this.el.addEventListener('mouseover', function (e) {
    var i = rowIndex(e);
    if (i < 0) return;
    if (self.o.activate) self.o.activate(self);
    if (i !== self.index) { self.index = i; self.render(true); if (self.o.onFocus) self.o.onFocus(i); }
  });
  // Deslizar con el dedo (celular): mueve la lista sin cambiar el elemento elegido.
  var ty0 = 0, top0 = 0, moved = false;
  this.el.addEventListener('touchstart', function (e) { ty0 = e.touches[0].clientY; top0 = self.top; moved = false; }, false);
  this.el.addEventListener('touchmove', function (e) {
    var dy = e.touches[0].clientY - ty0, n = self.o.count();
    if (Math.abs(dy) > 8) moved = true;
    if (!moved) return;
    e.preventDefault();
    self.top = U.clamp(top0 - dy / (self.o.itemHeight * ((window.App && App.scale) || 1)), 0, Math.max(0, n - self.o.visible));
    self.render(true);
  }, false);
  this.el.addEventListener('click', function (e) {
    if (moved) { moved = false; return; }
    var i = rowIndex(e);
    if (i < 0) return;
    if (self.o.activate) self.o.activate(self);
    self.index = i;
    self.render(true);
    if (self.o.onSelect) self.o.onSelect(i);
  });
  this.el.addEventListener('wheel', function (e) {
    var n = self.o.count();
    if (!n) return;
    e.preventDefault();
    if (self.o.activate) self.o.activate(self);
    self.setIndex(U.clamp(self.index + (e.deltaY > 0 ? 1 : -1), 0, n - 1));
  });
}
// Ajusta cuántas filas caben según el alto real del contenedor (celular, al girar la pantalla).
ListZone.prototype.fit = function () {
  var h = this.el.clientHeight;
  if (h > 0) this.o.visible = Math.max(1, Math.floor(h / this.o.itemHeight));
  this.render(true);
};
ListZone.prototype.focus = function () { this.active = true; U.addClass(this.el, 'zone-active'); this.render(); };
ListZone.prototype.blur = function () { this.active = false; U.removeClass(this.el, 'zone-active'); };
ListZone.prototype.clearRows = function () {
  for (var k in this.rows) if (this.rows.hasOwnProperty(k)) this.inner.removeChild(this.rows[k]);
  this.rows = {};
};
ListZone.prototype.reset = function () { this.clearRows(); this.render(); };
ListZone.prototype.refreshAll = function () {
  for (var k in this.rows) {
    if (!this.rows.hasOwnProperty(k)) continue;
    var row = this.rows[k];
    row.innerHTML = '';
    this.o.render(parseInt(k, 10), row);
  }
  this.render(true);
};
ListZone.prototype.setIndex = function (i) {
  this.index = i;
  this.render();
  if (this.o.onFocus) this.o.onFocus(i);
};
ListZone.prototype.render = function (keepScroll) {
  var o = this.o, n = o.count(), h = o.itemHeight, vis = o.visible, m = o.margin === undefined ? 2 : o.margin, k, i;
  if (!n) {
    this.clearRows();
    this.index = 0;
    this.top = 0;
    this.emptyEl.textContent = o.emptyText || '';
    U.show(this.emptyEl, !!o.emptyText);
    U.show(this.bar, false);
    return;
  }
  U.show(this.emptyEl, false);
  this.index = U.clamp(this.index, 0, n - 1);
  if (!keepScroll) {
    if (this.index - m < this.top) this.top = this.index - m;
    if (this.index + m > this.top + vis - 1) this.top = this.index + m - vis + 1;
  }
  this.top = U.clamp(this.top, 0, Math.max(0, n - vis));
  var ty = 'translateY(' + (-this.top * h) + 'px)';
  this.inner.style.webkitTransform = ty;
  this.inner.style.transform = ty;
  var from = Math.max(0, Math.floor(this.top) - 1), to = Math.min(n - 1, Math.ceil(this.top) + vis);
  for (k in this.rows) {
    if (!this.rows.hasOwnProperty(k)) continue;
    i = parseInt(k, 10);
    if (i < from || i > to) { this.inner.removeChild(this.rows[k]); delete this.rows[k]; }
  }
  for (i = from; i <= to; i++) {
    var row = this.rows[i];
    if (!row) {
      row = document.createElement('div');
      row.className = 'lz-row';
      row.style.top = (i * h) + 'px';
      row.style.height = h + 'px';
      row.setAttribute('data-index', i);
      o.render(i, row);
      this.inner.appendChild(row);
      this.rows[i] = row;
    }
    U.toggleClass(row, 'focus', i === this.index);
    if (o.isSelected) U.toggleClass(row, 'selected', o.isSelected(i));
  }
  if (n > vis) {
    U.show(this.bar, true);
    this.thumb.style.height = Math.max(4, vis / n * 100) + '%';
    this.thumb.style.top = (this.top / n * 100) + '%';
  } else {
    U.show(this.bar, false);
  }
};
ListZone.prototype.handleKey = function (k) {
  var n = this.o.count();
  if (!n) return false;
  if (k === 'up') { if (this.index > 0) { this.setIndex(this.index - 1); return true; } return false; }
  if (k === 'down') { if (this.index < n - 1) { this.setIndex(this.index + 1); return true; } return false; }
  if (k === 'chup') { this.setIndex(Math.max(0, this.index - this.o.visible)); return true; }
  if (k === 'chdown') { this.setIndex(Math.min(n - 1, this.index + this.o.visible)); return true; }
  if (k === 'ok') { if (this.o.onSelect) this.o.onSelect(this.index); return true; }
  return false;
};

/* ---------------- FormZone ---------------- */
function FormZone(container, o) {
  'use strict';
  var self = this;
  this.el = container;
  this.o = o || {};
  this.cur = null;
  this.lastId = null;
  this.active = false;
  function target(e) { return U.closest(e.target, function (n) { return U.hasClass(n, 'focusable'); }, container); }
  container.addEventListener('mouseover', function (e) {
    var t = target(e);
    if (!t) return;
    if (self.o.activate) self.o.activate(self);
    if (t !== self.cur) self.set(t, true);
  });
  container.addEventListener('click', function (e) {
    var t = target(e);
    if (!t) return;
    if (self.o.activate) self.o.activate(self);
    if (t !== self.cur) self.set(t, true);
    if (t.tagName === 'INPUT') self.edit(t);
  });
}
FormZone.prototype.items = function () {
  return U.$$('.focusable', this.el).filter(function (e) { return e.offsetParent !== null && !U.hasClass(e, 'disabled'); });
};
FormZone.prototype.byId = function (id) {
  if (!id) return null;
  var all = U.$$('[data-id]', this.el);
  for (var i = 0; i < all.length; i++) if (all[i].getAttribute('data-id') === id) return all[i];
  return null;
};
FormZone.prototype.focus = function (t) {
  this.active = true;
  U.addClass(this.el, 'zone-active');
  var items = this.items();
  if (!t || items.indexOf(t) < 0) t = (this.cur && items.indexOf(this.cur) >= 0) ? this.cur : (this.byId(this.lastId) || items[0] || null);
  this.set(t);
};
FormZone.prototype.blur = function () {
  this.active = false;
  U.removeClass(this.el, 'zone-active');
  var a = document.activeElement;
  if (a && a.tagName === 'INPUT' && this.el.contains(a)) a.blur();
};
FormZone.prototype.set = function (t, fromMouse) {
  if (this.cur && this.cur !== t) U.removeClass(this.cur, 'focus');
  this.cur = t;
  if (!t) return;
  this.lastId = t.getAttribute('data-id') || this.lastId;
  U.addClass(t, 'focus');
  if (!fromMouse) this.ensureVisible(t);
  if (this.o.onFocus) this.o.onFocus(t);
};
FormZone.prototype.ensureVisible = function (t) {
  var sc = this.o.scroller;
  if (!sc) return;
  var s = (window.App && App.scale) || 1, sr = sc.getBoundingClientRect(), r = t.getBoundingClientRect();
  var top = (r.top - sr.top) / s, bottom = (r.bottom - sr.top) / s, pad = 110, hgt = sc.clientHeight;
  if (top < pad) sc.scrollTop = Math.max(0, sc.scrollTop + top - pad);
  else if (bottom > hgt - pad) sc.scrollTop = sc.scrollTop + bottom - (hgt - pad);
};
FormZone.prototype.handleKey = function (k) {
  if (k === 'ok') {
    if (!this.cur) return false;
    if (this.cur.tagName === 'INPUT') this.edit(this.cur); else this.cur.click();
    return true;
  }
  if (k === 'left' || k === 'right' || k === 'up' || k === 'down') {
    var n = Nav.findNext(this.cur, this.items(), k);
    if (n) { this.set(n); return true; }
    return false;
  }
  return false;
};
// Abre el teclado del TV para escribir en el campo.
FormZone.prototype.edit = function (input) {
  var self = this;
  U.addClass(input, 'editing');
  input.focus();
  function done() {
    U.removeClass(input, 'editing');
    input.removeEventListener('blur', done);
    if (self.o.onEditEnd) self.o.onEditEnd(input);
  }
  input.addEventListener('blur', done);
  try { var l = input.value.length; input.setSelectionRange(l, l); } catch (e) { /* algunos tipos no lo permiten */ }
};

/* ---------------- RowsZone ---------------- */
function RowsZone(o) {
  'use strict';
  var self = this;
  this.o = o;
  this.el = o.el;
  this.r = 0;
  this.top = 0;
  this.cols = [];
  this.rowEls = {};
  this.active = false;
  this.inner = U.el('div', 'vr-inner');
  this.el.appendChild(this.inner);
  function cardOf(e) { return U.closestAttr(e.target, 'data-c', self.el); }
  this.el.addEventListener('mouseover', function (e) {
    var c = cardOf(e);
    if (!c) return;
    var r = parseInt(c.getAttribute('data-r'), 10), ci = parseInt(c.getAttribute('data-c'), 10);
    if (self.o.activate) self.o.activate(self);
    if (r !== self.r || ci !== (self.cols[r] || 0)) { self.r = r; self.cols[r] = ci; self.render(true); self.fire(); }
  });
  // Deslizar (celular): horizontal recorre la fila, vertical cambia de fila.
  var x0 = 0, y0 = 0, swiped = false;
  this.el.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; swiped = false; }, false);
  this.el.addEventListener('touchmove', function (e) {
    var dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) e.preventDefault();
  }, false);
  this.el.addEventListener('touchend', function (e) {
    var t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0, rows = self.o.rows();
    if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;
    swiped = true;
    if (self.o.activate) self.o.activate(self);
    if (Math.abs(dx) > Math.abs(dy)) {
      var row = rows[self.r], step = Math.max(1, Math.floor(self.o.visibleCards / 2));
      if (row) self.cols[self.r] = U.clamp((self.cols[self.r] || 0) + (dx < 0 ? step : -step), 0, row.items.length - 1);
    } else {
      self.r = U.clamp(self.r + (dy < 0 ? 1 : -1), 0, rows.length - 1);
    }
    self.render();
    self.fire();
  }, false);
  this.el.addEventListener('click', function (e) {
    if (swiped) { swiped = false; return; }
    var c = cardOf(e);
    if (!c) return;
    if (self.o.activate) self.o.activate(self);
    self.r = parseInt(c.getAttribute('data-r'), 10);
    self.cols[self.r] = parseInt(c.getAttribute('data-c'), 10);
    self.render(true);
    var it = self.current();
    if (it && self.o.onSelect) self.o.onSelect(it);
  });
}
RowsZone.prototype.focus = function () { this.active = true; U.addClass(this.el, 'zone-active'); this.render(); };
RowsZone.prototype.blur = function () { this.active = false; U.removeClass(this.el, 'zone-active'); };
RowsZone.prototype.fire = function () { if (this.o.onFocus) this.o.onFocus(this.current()); };
RowsZone.prototype.current = function () {
  var row = this.o.rows()[this.r];
  return row ? (row.items[this.cols[this.r] || 0] || null) : null;
};
RowsZone.prototype.reset = function () {
  for (var k in this.rowEls) if (this.rowEls.hasOwnProperty(k)) this.inner.removeChild(this.rowEls[k]);
  this.rowEls = {};
  this.render();
};
RowsZone.prototype.render = function (fromMouse) {
  var rows = this.o.rows(), n = rows.length, RH = this.o.rowHeight, CW = this.o.cardWidth, VIS = this.o.visibleCards, k, i, j;
  if (!n) {
    for (k in this.rowEls) if (this.rowEls.hasOwnProperty(k)) this.inner.removeChild(this.rowEls[k]);
    this.rowEls = {};
    return;
  }
  this.r = U.clamp(this.r, 0, n - 1);
  if (!fromMouse) this.top = this.r;
  this.top = U.clamp(this.top, 0, n - 1);
  var ty = 'translateY(' + (-this.top * RH) + 'px)';
  this.inner.style.webkitTransform = ty;
  this.inner.style.transform = ty;
  var from = Math.max(0, this.top - 1), to = Math.min(n - 1, this.top + 2);
  for (k in this.rowEls) {
    if (!this.rowEls.hasOwnProperty(k)) continue;
    i = parseInt(k, 10);
    if (i < from || i > to) { this.inner.removeChild(this.rowEls[k]); delete this.rowEls[k]; }
  }
  for (i = from; i <= to; i++) {
    var row = rows[i], re = this.rowEls[i];
    if (!re) {
      re = U.el('div', 'vr-row');
      re.style.top = (i * RH) + 'px';
      re.appendChild(U.el('div', 'vr-title', row.title));
      var track = U.el('div', 'vr-track');
      re.cardsEl = U.el('div', 'vr-cards');
      track.appendChild(re.cardsEl);
      re.appendChild(track);
      re.cards = {};
      this.inner.appendChild(re);
      this.rowEls[i] = re;
    }
    var count = row.items.length, c = U.clamp(this.cols[i] || 0, 0, Math.max(0, count - 1));
    this.cols[i] = c;
    if (re.off === undefined || !fromMouse) re.off = U.clamp(c - 1, 0, Math.max(0, count - VIS));
    var tx = 'translateX(' + (-re.off * CW) + 'px)';
    re.cardsEl.style.webkitTransform = tx;
    re.cardsEl.style.transform = tx;
    var cf = Math.max(0, re.off - 2), ct = Math.min(count - 1, re.off + VIS + 1);
    for (k in re.cards) {
      if (!re.cards.hasOwnProperty(k)) continue;
      j = parseInt(k, 10);
      if (j < cf || j > ct) { re.cardsEl.removeChild(re.cards[k]); delete re.cards[k]; }
    }
    for (j = cf; j <= ct; j++) {
      var ce = re.cards[j];
      if (!ce) {
        ce = U.el('div', 'card');
        ce.style.left = (j * CW) + 'px';
        ce.setAttribute('data-r', i);
        ce.setAttribute('data-c', j);
        this.o.renderCard(row.items[j], ce);
        re.cardsEl.appendChild(ce);
        re.cards[j] = ce;
      }
      U.toggleClass(ce, 'focus', i === this.r && j === c);
    }
  }
};
RowsZone.prototype.handleKey = function (k) {
  var rows = this.o.rows();
  if (!rows.length) return false;
  var row = rows[this.r], c = this.cols[this.r] || 0;
  if (k === 'left') { if (c > 0) { this.cols[this.r] = c - 1; this.render(); this.fire(); return true; } return false; }
  if (k === 'right') { if (c < row.items.length - 1) { this.cols[this.r] = c + 1; this.render(); this.fire(); } return true; }
  if (k === 'up') { if (this.r > 0) { this.r--; this.render(); this.fire(); return true; } return false; }
  if (k === 'down') { if (this.r < rows.length - 1) { this.r++; this.render(); this.fire(); } return true; }
  if (k === 'ok') { var it = this.current(); if (it && this.o.onSelect) this.o.onSelect(it); return true; }
  return false;
};
