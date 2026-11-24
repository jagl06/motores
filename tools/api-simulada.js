// API simulada en memoria, SOLO para desarrollo local del frontend (login y sincronización).
// Imita el contrato de api/ (PHP) de la etapa 2: login, pruebas y conflictos. No guarda nada en disco.
// No implementa fotos, PDF ni aprobación (etapa 3): para eso usar la API real en local (ver api/DEPLOY.md).
// Uso: node tools/api-simulada.js [puerto]   y en la app (consola): localStorage.pm_api = "http://localhost:8124"
// Usuarios de prueba: tecnico1, tecnico2 y supervisor1; contraseña "prueba-local-1234".
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";

const PUERTO = Number(process.argv[2] || 8124);
const ORIGENES = ["http://localhost:8123", "http://127.0.0.1:8123"];
const CLAVE = "prueba-local-1234";
const usuarios = [
  { id: 1, usuario: "tecnico1", nombre: "Técnico Uno", rol: "tecnico", clave: CLAVE },
  { id: 2, usuario: "tecnico2", nombre: "Técnico Dos", rol: "tecnico", clave: CLAVE },
  { id: 3, usuario: "supervisor1", nombre: "Supervisora Uno", rol: "supervisor", clave: CLAVE }
];
const sesiones = new Map(), pruebas = new Map();
const DICTAMENES = ["Apto para operar", "Apto con observaciones", "No apto"];
const LOCALES = ["dirty", "conflicto", "rev", "estado", "fotosData", "sample"];
const ahora = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const publico = u => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol });
class Err extends Error { constructor(estado, msg, codigo, extra = {}) { super(msg); Object.assign(this, { estado, codigo, extra }); } }

function resumida(p) {
  const v = p.datos.v;
  return { uuid: p.uuid, rev: p.rev, estado: p.estado, cliente: v.cliente || null, tag: v.tag || null, serie: v.serie || null, orden: v.ot || null,
    fecha: v.fecha || null, dictamen: DICTAMENES.includes(v.dictamen) ? v.dictamen : null, tecnico: usuarios.find(u => u.id === p.tecnico_id).nombre, tecnico_id: p.tecnico_id, actualizado_en: p.actualizado_en };
}

function atender(metodo, ruta, cuerpo, token, query) {
  if (metodo === "GET" && ruta === "/") return [200, { api: "motores-iselec (simulada)", ok: true }];
  if (metodo === "POST" && ruta === "/auth/login") {
    const u = usuarios.find(x => x.usuario === String(cuerpo.usuario || "").toLowerCase().trim());
    if (!u || u.clave !== cuerpo.clave) throw new Err(401, "Usuario o contraseña incorrectos", "credenciales");
    const t = randomBytes(32).toString("hex"); sesiones.set(t, u.id);
    return [200, { token: t, vence_en: new Date(Date.now() + 30 * 864e5).toISOString(), usuario: publico(u) }];
  }
  const u = usuarios.find(x => x.id === sesiones.get(token));
  if (!u) throw new Err(401, "Inicia sesión", "sin_sesion");
  if (metodo === "POST" && ruta === "/auth/logout") { sesiones.delete(token); return [200, { ok: true }]; }
  if (metodo === "GET" && ruta === "/auth/yo") return [200, { usuario: publico(u) }];
  if (metodo === "POST" && ruta === "/auth/clave") {
    if (String(cuerpo.nueva || "").length < 10) throw new Err(422, "La contraseña debe tener al menos 10 caracteres", "clave_debil");
    if (cuerpo.actual !== u.clave) throw new Err(401, "La contraseña actual no coincide", "credenciales");
    u.clave = cuerpo.nueva; return [200, { ok: true }];
  }
  if (metodo === "GET" && ruta === "/pruebas") {
    let l = [...pruebas.values()].filter(p => u.rol !== "tecnico" || p.tecnico_id === u.id).map(resumida);
    if (query.get("cliente")) l = l.filter(p => (p.cliente || "").toLowerCase().includes(query.get("cliente").toLowerCase()));
    return [200, { pruebas: l.sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en)) }];
  }
  const m = ruta.match(/^\/pruebas\/([0-9a-f-]{36})(\/cerrar)?$/i);
  if (!m) throw new Err(404, "Ruta no encontrada", "ruta");
  const uuid = m[1].toLowerCase(), p = pruebas.get(uuid);
  if (metodo === "GET" && !m[2]) {
    if (!p) throw new Err(404, "La prueba no existe en el servidor", "no_existe");
    if (u.rol === "tecnico" && p.tecnico_id !== u.id) throw new Err(403, "Esta prueba es de otro técnico", "ajena");
    return [200, { ...resumida(p), datos: p.datos }];
  }
  if (metodo === "PUT" && !m[2]) {
    const datos = cuerpo.datos;
    if (!datos || typeof datos !== "object" || !datos.v || typeof datos.v !== "object") throw new Err(422, "Faltan los datos de la prueba", "datos_invalidos");
    for (const k of LOCALES) delete datos[k];
    datos.uuid = uuid;
    const hash = createHash("sha256").update(JSON.stringify(datos)).digest("hex"), cerrar = cuerpo.cerrar === true;
    if (cerrar && !DICTAMENES.includes(datos.v.dictamen)) throw new Err(422, "Para cerrar la prueba hay que elegir el dictamen", "sin_dictamen");
    if (!p) {
      const n = { uuid, tecnico_id: u.id, estado: cerrar ? "cerrada" : "borrador", rev: 1, hash, datos, actualizado_en: ahora() };
      pruebas.set(uuid, n); return [201, { uuid, rev: 1, estado: n.estado, actualizado_en: n.actualizado_en }];
    }
    if (p.tecnico_id !== u.id) throw new Err(403, "Esta prueba es de otro técnico", "ajena");
    const igual = p.hash === hash, ok = () => [200, { uuid, rev: p.rev, estado: p.estado, actualizado_en: p.actualizado_en }];
    if (p.estado !== "borrador") { if (igual) return ok(); throw new Err(409, "La prueba ya está cerrada en el servidor y no admite cambios", "cerrada", { estado: p.estado, rev: p.rev }); }
    if (Number(cuerpo.rev || 0) !== p.rev && !igual) throw new Err(409, "La prueba cambió en el servidor desde otro equipo", "conflicto", { servidor: { rev: p.rev, estado: p.estado, datos: p.datos, actualizado_en: p.actualizado_en } });
    if (igual && !cerrar) return ok();
    Object.assign(p, { rev: p.rev + 1, hash, datos, actualizado_en: ahora(), estado: cerrar ? "cerrada" : "borrador" });
    return ok();
  }
  if (metodo === "POST" && m[2]) {
    if (!p) throw new Err(404, "La prueba no existe en el servidor", "no_existe");
    if (p.tecnico_id !== u.id) throw new Err(403, "Esta prueba es de otro técnico", "ajena");
    if (p.estado === "borrador") {
      if (!DICTAMENES.includes(p.datos.v.dictamen)) throw new Err(422, "Para cerrar la prueba hay que elegir el dictamen", "sin_dictamen");
      Object.assign(p, { estado: "cerrada", rev: p.rev + 1, actualizado_en: ahora() });
    }
    return [200, { uuid, rev: p.rev, estado: p.estado, actualizado_en: p.actualizado_en }];
  }
  throw new Err(405, "Método no permitido", "metodo");
}

createServer((req, res) => {
  const origen = req.headers.origin || "";
  const cab = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", Vary: "Origin" };
  if (ORIGENES.includes(origen)) Object.assign(cab, { "Access-Control-Allow-Origin": origen, "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600" });
  if (req.method === "OPTIONS") { res.writeHead(204, cab).end(); return; }
  let crudo = "";
  req.on("data", d => { crudo += d; });
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    let estado, datos;
    try {
      const cuerpo = crudo ? JSON.parse(crudo) : {};
      const token = (String(req.headers.authorization || "").match(/^Bearer\s+([A-Za-z0-9]{32,128})$/) || [])[1];
      [estado, datos] = atender(req.method, "/" + url.pathname.replace(/^\/+|\/+$/g, ""), cuerpo, token, url.searchParams);
    } catch (e) {
      if (e instanceof Err) { estado = e.estado; datos = { error: e.message, codigo: e.codigo, ...e.extra }; }
      else { estado = 500; datos = { error: "Error interno del servidor", codigo: "interno" }; console.error(e); }
    }
    console.log(`${req.method} ${url.pathname} → ${estado}`);
    res.writeHead(estado, cab).end(JSON.stringify(datos));
  });
}).listen(PUERTO, "127.0.0.1", () => console.log(`API simulada en http://localhost:${PUERTO} (usuarios tecnico1, tecnico2, supervisor1)`));
