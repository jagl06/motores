// Service worker: deja la app y sus librerías disponibles sin señal.
// Al cambiar cualquier archivo de la lista, subir CACHE para forzar la actualización.
const CACHE = "motores-v4";
const FUENTES = "motores-fuentes-v1";

const APP = [
  "./", "index.html", "css/app.css", "manifest.webmanifest",
  "js/app.js", "js/conexiones.js", "js/evaluadores.js", "js/protocolo.js", "js/db.js", "js/fotos.js", "js/pdf.js",
  "icons/icon-192.png", "icons/icon-512.png"
];
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP.map(u => new Request(u, { cache: "reload" })));
    await c.addAll(CDN.map(u => new Request(u, { mode: "cors" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== FUENTES) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Devuelve lo guardado y, si hay red, refresca la copia para la próxima vez.
async function cacheYRefresca(req, nombre, e) {
  const c = await caches.open(nombre);
  const guardado = await c.match(req, { ignoreSearch: req.mode === "navigate" });
  const red = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
  if (guardado) { e.waitUntil(red); return guardado; }
  return (await red) || (req.mode === "navigate" ? c.match("index.html") : Response.error());
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(cacheYRefresca(req, CACHE, e));
  else if (url.hostname === "cdnjs.cloudflare.com") e.respondWith(caches.match(req).then(r => r || fetch(req)));
  else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") e.respondWith(cacheYRefresca(req, FUENTES, e));
});
