// Prueba de extremo a extremo de la API real (PHP + MySQL) en un entorno de DESARROLLO.
// Crea y cierra pruebas, así que no debe apuntarse a producción.
// Uso: node tools/probar-api.js <url> <archivo-de-claves>
//   El archivo es la salida de `php bin/usuario.php crear ...` para tecnico1, tecnico2 y supervisor1.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const [URL_API = "http://127.0.0.1:8125", ARCHIVO] = process.argv.slice(2);
if (/iselec\.com\.pa/.test(URL_API)) { console.error("Este script no se corre contra producción."); process.exit(2); }
const claves = {};
for (const m of readFileSync(ARCHIVO, "utf8").matchAll(/Usuario (\S+) creado[\s\S]*?: (\S+)/g)) claves[m[1]] = m[2];

const ORIGEN = "http://localhost:8123";
async function pedir(metodo, ruta, { token, cuerpo, crudo, origen = ORIGEN } = {}) {
  const r = await fetch(URL_API + ruta, { method: metodo, headers: { ...(origen ? { Origin: origen } : {}), ...(token ? { Authorization: "Bearer " + token } : {}), ...(cuerpo || crudo ? { "Content-Type": "application/json" } : {}) }, body: crudo ?? (cuerpo ? JSON.stringify(cuerpo) : undefined) });
  let d = null; const txt = await r.text(); try { d = JSON.parse(txt); } catch (e) { d = { _texto: txt.slice(0, 300) }; }
  return { e: r.status, d, h: r.headers };
}
let ok = 0; const fallas = [];
function espera(nombre, cond, detalle) { if (cond) ok++; else fallas.push(nombre + (detalle !== undefined ? " → " + JSON.stringify(detalle).slice(0, 400) : "")); }
const datos = (extra = {}) => ({ created: new Date().toISOString(), step: 3, vib: false, c: { termo_0: true }, obs: { termo: "Sin novedad, ñ á Ω" }, photos: {},
  v: { cliente: "Hotel Prueba", tag: "BBA-1", serie: "SN 123-45", ot: "OT-9", fecha: "2026-11-23", hp: "25", kw: "18.5", fab: "WEG", modelo: "W22", hilos: "12", clase: "F", ...extra } });

let r;
// --- básicos y CORS
r = await pedir("GET", "/"); espera("raíz", r.e === 200 && r.d.ok === true, r);
r = await pedir("GET", "/salud"); espera("salud con base", r.e === 200 && r.d.ok === true, r);
espera("CORS origen permitido", r.h.get("access-control-allow-origin") === ORIGEN, r.h.get("access-control-allow-origin"));
r = await pedir("GET", "/", { origen: "https://sitio-ajeno.example" }); espera("CORS origen ajeno sin cabecera", r.h.get("access-control-allow-origin") === null);
r = await pedir("OPTIONS", "/pruebas"); espera("preflight 204", r.e === 204 && /PUT/.test(r.h.get("access-control-allow-methods") || ""), r.e);
r = await pedir("GET", "/no-existe"); espera("404 ruta", r.e === 404 && r.d.codigo === "ruta", r);
r = await pedir("DELETE", "/pruebas"); espera("405 método", r.e === 405, r);
r = await pedir("GET", "/pruebas"); espera("401 sin token", r.e === 401 && r.d.codigo === "sin_sesion", r);
r = await pedir("GET", "/pruebas", { token: "a".repeat(64) }); espera("401 token inventado", r.e === 401, r);

// --- login
r = await pedir("POST", "/auth/login", { cuerpo: { usuario: "tecnico1", clave: "incorrecta-000" } }); espera("login clave mala", r.e === 401 && r.d.codigo === "credenciales", r);
r = await pedir("POST", "/auth/login", { cuerpo: { usuario: "no-existe", clave: "incorrecta-000" } }); espera("login usuario inexistente, mismo mensaje", r.e === 401 && r.d.codigo === "credenciales", r);
r = await pedir("POST", "/auth/login", { crudo: "{esto no es json" }); espera("login JSON inválido", r.e === 400, r);
r = await pedir("POST", "/auth/login", { cuerpo: { usuario: " TECNICO1 ", clave: claves.tecnico1 } }); espera("login ok (usuario sin distinguir mayúsculas)", r.e === 200 && r.d.token?.length === 64 && r.d.usuario.rol === "tecnico", r);
const t1 = r.d.token;
espera("login no devuelve el hash", !JSON.stringify(r.d).includes("$2y$"));
const t2 = (await pedir("POST", "/auth/login", { cuerpo: { usuario: "tecnico2", clave: claves.tecnico2 } })).d.token;
const ts = (await pedir("POST", "/auth/login", { cuerpo: { usuario: "supervisor1", clave: claves.supervisor1 } })).d.token;
espera("tres sesiones", !!t1 && !!t2 && !!ts);
r = await pedir("GET", "/auth/yo", { token: t1 }); espera("yo", r.e === 200 && r.d.usuario.usuario === "tecnico1" && r.d.usuario.nombre === "Técnico Uno", r);

// --- crear y actualizar
const u1 = randomUUID();
const inicial = datos();
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 0, datos: inicial, resumen: { pi: 2.8 } } }); espera("crear 201 rev 1", r.e === 201 && r.d.rev === 1 && r.d.estado === "borrador", r);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 0, datos: inicial } }); espera("reintento idéntico no sube rev", r.e === 200 && r.d.rev === 1, r);
r = await pedir("GET", "/pruebas/" + u1, { token: t1 }); espera("los objetos vacíos vuelven como {} y no como []", !Array.isArray(r.d.datos.photos) && typeof r.d.datos.photos === "object", r.d.datos?.photos);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 1, datos: datos({ sitio: "Sótano" }) } }); espera("actualizar rev 2", r.e === 200 && r.d.rev === 2, r);
r = await pedir("GET", "/pruebas/" + u1, { token: t1 }); espera("leer: datos íntegros con acentos", r.e === 200 && r.d.datos.v.sitio === "Sótano" && r.d.datos.obs.termo === "Sin novedad, ñ á Ω" && r.d.datos.c.termo_0 === true && r.d.serie === "SN 123-45" && r.d.orden === "OT-9" && r.d.fecha === "2026-11-23", r);
espera("leer: campos locales fuera de datos", !("dirty" in r.d.datos) && !("rev" in r.d.datos) && r.d.datos.uuid === u1);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 1, datos: datos({ sitio: "Desde otro equipo, revisión vieja" }) } });
espera("conflicto 409 con versión del servidor", r.e === 409 && r.d.codigo === "conflicto" && r.d.servidor.rev === 2 && r.d.servidor.datos.v.sitio === "Sótano" && !Array.isArray(r.d.servidor.datos.photos), r);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 2, datos: datos({ sitio: "Resuelto" }) } }); espera("resolver con la rev del servidor", r.e === 200 && r.d.rev === 3, r);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 3, datos: { sin: "v" } } }); espera("422 datos sin v", r.e === 422, r);
r = await pedir("PUT", "/pruebas/no-es-uuid", { token: t1, cuerpo: { rev: 0, datos: datos() } }); espera("uuid inválido", r.e === 404 || r.e === 400, r);
r = await pedir("PUT", "/pruebas/" + randomUUID(), { token: t1, cuerpo: { rev: 0, datos: { ...datos(), relleno: "x".repeat(1200000) } } }); espera("413 prueba demasiado grande", r.e === 413, r.e);

// --- permisos
r = await pedir("GET", "/pruebas/" + u1, { token: t2 }); espera("otro técnico no la lee", r.e === 403 && r.d.codigo === "ajena", r);
r = await pedir("PUT", "/pruebas/" + u1, { token: t2, cuerpo: { rev: 3, datos: datos({ sitio: "Intruso" }) } }); espera("otro técnico no la edita", r.e === 403, r);
r = await pedir("PUT", "/pruebas/" + u1, { token: ts, cuerpo: { rev: 3, datos: datos({ sitio: "Supervisor" }) } }); espera("el supervisor no la edita", r.e === 403, r);
r = await pedir("GET", "/pruebas/" + u1, { token: ts }); espera("el supervisor sí la lee", r.e === 200 && r.d.tecnico === "Técnico Uno" && r.d.datos.v.sitio === "Resuelto", r);
const u2 = randomUUID();
await pedir("PUT", "/pruebas/" + u2, { token: t2, cuerpo: { rev: 0, datos: datos({ cliente: "Fábrica Dos", tag: "M-9", serie: "", fecha: "2026-10-01" }) } });
r = await pedir("GET", "/pruebas", { token: t1 }); espera("técnico lista solo las suyas", r.e === 200 && r.d.pruebas.length >= 1 && r.d.pruebas.every(p => p.tecnico === "Técnico Uno") && !("datos" in r.d.pruebas[0]), r.d.pruebas?.length);
r = await pedir("GET", "/pruebas", { token: ts }); espera("supervisor lista todas", r.d.pruebas.some(p => p.uuid === u1) && r.d.pruebas.some(p => p.uuid === u2));
r = await pedir("GET", "/pruebas?cliente=" + encodeURIComponent("fábrica"), { token: ts }); espera("filtro cliente", r.d.pruebas.length >= 1 && r.d.pruebas.every(p => /fábrica/i.test(p.cliente)), r.d.pruebas);
r = await pedir("GET", "/pruebas?motor=" + encodeURIComponent("123-45"), { token: ts }); espera("filtro motor por serie", r.d.pruebas.some(p => p.uuid === u1) && !r.d.pruebas.some(p => p.uuid === u2), r.d.pruebas);
r = await pedir("GET", "/pruebas?desde=2026-11-01", { token: ts }); espera("filtro desde", r.d.pruebas.some(p => p.uuid === u1) && !r.d.pruebas.some(p => p.uuid === u2), r.d.pruebas);
r = await pedir("GET", "/pruebas?cliente=" + encodeURIComponent("%' OR '1'='1"), { token: ts }); espera("filtro con comillas no rompe ni devuelve todo", r.e === 200 && r.d.pruebas.length === 0, r);

// --- cerrar
r = await pedir("POST", "/pruebas/" + u1 + "/cerrar", { token: t1 }); espera("cerrar sin dictamen 422", r.e === 422 && r.d.codigo === "sin_dictamen", r);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 3, cerrar: true, datos: datos({ sitio: "Resuelto" }) } }); espera("PUT cerrar sin dictamen 422", r.e === 422, r);
const final = datos({ sitio: "Resuelto", dictamen: "Apto con observaciones" });
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 3, cerrar: true, datos: final } }); espera("guardar y cerrar", r.e === 200 && r.d.estado === "cerrada" && r.d.rev === 4, r);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 3, cerrar: true, datos: final } }); espera("reintento del cierre es idempotente", r.e === 200 && r.d.estado === "cerrada" && r.d.rev === 4, r);
r = await pedir("PUT", "/pruebas/" + u1, { token: t1, cuerpo: { rev: 4, datos: datos({ sitio: "Cambio tras cerrar" }) } }); espera("cerrada no admite cambios", r.e === 409 && r.d.codigo === "cerrada", r);
r = await pedir("POST", "/pruebas/" + u1 + "/cerrar", { token: t1 }); espera("cerrar dos veces no falla", r.e === 200 && r.d.estado === "cerrada", r);
r = await pedir("POST", "/pruebas/" + u2 + "/cerrar", { token: t1 }); espera("no cierra la de otro", r.e === 403, r);
const u3 = randomUUID();
r = await pedir("PUT", "/pruebas/" + u3, { token: t1, cuerpo: { rev: 0, cerrar: true, datos: datos({ serie: "SN-12345", dictamen: "No apto" }) } }); espera("crear ya cerrada (cierre sin conexión)", r.e === 201 && r.d.estado === "cerrada", r);
r = await pedir("GET", "/pruebas?estado=cerrada", { token: t1 }); espera("filtro estado", r.d.pruebas.length >= 2 && r.d.pruebas.every(p => p.estado === "cerrada"), r.d.pruebas);

// --- contraseña y sesión
r = await pedir("POST", "/auth/clave", { token: t2, cuerpo: { actual: claves.tecnico2, nueva: "corta" } }); espera("clave nueva corta 422", r.e === 422, r);
r = await pedir("POST", "/auth/clave", { token: t2, cuerpo: { actual: "no-es-la-actual", nueva: "una-clave-larga-1" } }); espera("clave actual mala 401", r.e === 401, r);
r = await pedir("GET", "/auth/yo", { token: t2 }); espera("la sesión sigue tras fallar el cambio", r.e === 200, r);
const nueva = "nueva-" + randomUUID();
r = await pedir("POST", "/auth/clave", { token: t2, cuerpo: { actual: claves.tecnico2, nueva } }); espera("cambio de clave", r.e === 200, r);
r = await pedir("POST", "/auth/login", { cuerpo: { usuario: "tecnico2", clave: claves.tecnico2 } }); espera("la clave vieja ya no entra", r.e === 401, r);
r = await pedir("POST", "/auth/login", { cuerpo: { usuario: "tecnico2", clave: nueva } }); espera("la clave nueva entra", r.e === 200, r);
r = await pedir("POST", "/auth/clave", { token: r.d.token, cuerpo: { actual: nueva, nueva: claves.tecnico2 } }); espera("restaurar clave", r.e === 200, r);
r = await pedir("GET", "/auth/yo", { token: t2 }); espera("cambiar la clave cierra las otras sesiones", r.e === 401, r);
r = await pedir("POST", "/auth/logout", { token: t1 }); espera("logout", r.e === 200, r);
r = await pedir("GET", "/auth/yo", { token: t1 }); espera("token muerto tras logout", r.e === 401, r);

// --- fuerza bruta (al final: bloquea al usuario de prueba durante la ventana)
let ultimo = 0;
for (let i = 0; i < 9; i++) ultimo = (await pedir("POST", "/auth/login", { cuerpo: { usuario: "usuario-atacado", clave: "intento-" + i } })).e;
espera("429 tras 8 intentos fallidos", ultimo === 429, ultimo);

for (const f of fallas) console.log("FALLA  " + f);
console.log(`${ok}/${ok + fallas.length} comprobaciones pasan contra ${URL_API}`);
process.exit(fallas.length ? 1 : 0);
