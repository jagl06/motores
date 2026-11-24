// Servidor estático para desarrollo local. Los módulos ES y el service worker
// no funcionan abriendo index.html como archivo; hace falta http://localhost.
// Uso: node tools/servir.js [puerto]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PUERTO = Number(process.argv[2] || process.env.PORT || 8123);
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (ruta.endsWith("/")) ruta += "index.html";
  const archivo = normalize(join(RAIZ, ruta));
  if (archivo !== RAIZ && !archivo.startsWith(RAIZ + sep)) { res.writeHead(403).end(); return; }
  try {
    const datos = await readFile(archivo);
    res.writeHead(200, { "Content-Type": TIPOS[extname(archivo)] || "application/octet-stream", "Cache-Control": "no-store" }).end(datos);
  } catch (e) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado"); }
}).listen(PUERTO, "127.0.0.1", () => console.log(`Motores ISELEC en http://localhost:${PUERTO}`));
