/*
 * Punto de encuentro entre el celular y el TV para agregar una lista sin escribirla con el control.
 *
 *   POST /api/vincular  {code, url, epg?, name?, kind: "live"|"vod"}   ← lo envía el celular
 *   GET  /api/vincular?c=CODIGO                                        ← lo consulta el TV cada 3 s
 *
 * La lista se guarda en Netlify Blobs solo hasta que el TV la recoge (o 15 minutos como máximo)
 * y se borra al entregarla.
 */
import { getStore } from '@netlify/blobs';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8'
};
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;   // sin letras ni números que se confunden (I, O, 0, 1)
const URL_RE = /^https?:\/\/\S+$/i;
const TTL_MS = 15 * 60 * 1000;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: HEADERS });
}
function cleanCode(c) {
  return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  // strong: lo que guarda el celular se lee al instante desde el TV (sin el retraso de hasta 60 s).
  const store = getStore({ name: 'vincular', consistency: 'strong' });

  if (req.method === 'GET') {
    const code = cleanCode(new URL(req.url).searchParams.get('c'));
    if (!CODE_RE.test(code)) return json({ error: 'Código no válido' }, 400);
    const data = await store.get(code, { type: 'json' });
    if (!data) return json({ pending: true });
    await store.delete(code);
    if (Date.now() - data.t > TTL_MS) return json({ pending: true });
    return json({ ok: true, list: data.list });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'Datos no válidos' }, 400); }
    const code = cleanCode(body.code);
    const url = String(body.url || '').trim();
    const epg = String(body.epg || '').trim();
    const name = String(body.name || '').trim().slice(0, 60);
    const kind = body.kind === 'vod' ? 'vod' : 'live';
    if (!CODE_RE.test(code)) return json({ error: 'El código no es válido. Revisa el que aparece en el TV.' }, 400);
    if (!URL_RE.test(url) || url.length > 2000) return json({ error: 'La dirección de la lista debe empezar con http:// o https://' }, 400);
    if (epg && (!URL_RE.test(epg) || epg.length > 2000)) return json({ error: 'La dirección de la guía no es válida' }, 400);
    await store.setJSON(code, { t: Date.now(), list: { url, epg, name, kind } });
    return json({ ok: true });
  }

  return json({ error: 'Método no permitido' }, 405);
};

export const config = { path: '/api/vincular' };
