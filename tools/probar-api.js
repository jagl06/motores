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
// Sube un archivo como cuerpo crudo (así suben las fotos y el PDF)
async function subir(ruta, token, bytes, tipo) {
  const r = await fetch(URL_API + ruta, { method: "POST", headers: { Origin: ORIGEN, Authorization: "Bearer " + token, "Content-Type": tipo }, body: bytes });
  let d = null; const txt = await r.text(); try { d = JSON.parse(txt); } catch (e) { d = { _texto: txt.slice(0, 300) }; }
  return { e: r.status, d };
}
async function bajar(ruta, token) {
  const r = await fetch(URL_API + ruta, { headers: { Origin: ORIGEN, ...(token ? { Authorization: "Bearer " + token } : {}) } });
  return { e: r.status, tipo: r.headers.get("content-type"), bytes: Buffer.from(await r.arrayBuffer()) };
}
const fx = n => readFileSync(new URL("./fixtures/" + n, import.meta.url));
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

// --- etapa 3: fotos, PDF, aprobar y devolver
const JPG = fx("foto.jpg"), PDF = fx("informe.pdf");
const u4 = randomUUID(), f1 = randomUUID(), f2 = randomUUID(), f3 = randomUUID();
const conFotos = (extra = {}) => ({ ...datos({ tag: "FOTOS-1", serie: "SN-FOTOS", dictamen: "Apto para operar", ...extra }), created: "2026-11-24T00:00:00.000Z", photos: { placa: [f1], termo: [f2] } });
const d4 = conFotos();
r = await subir(`/pruebas/${u4}/fotos?foto=${f1}&paso=placa`, t1, JPG, "image/jpeg"); espera("foto de una prueba que aún no existe 404", r.e === 404, r);
r = await pedir("PUT", "/pruebas/" + u4, { token: t1, cuerpo: { rev: 0, datos: d4 } }); espera("crear prueba con fotos", r.e === 201, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f1}&paso=placa`, t1, JPG, "image/jpeg"); espera("subir foto 201", r.e === 201 && r.d.bytes === JPG.length, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f1}&paso=placa`, t1, JPG, "image/jpeg"); espera("repetir la misma foto no duplica", r.e === 200 && r.d.repetida === true, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=placa`, t1, fx("no-es-jpeg.png"), "image/jpeg"); espera("PNG disfrazado de JPEG 415", r.e === 415, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=placa`, t1, Buffer.from("<?php echo 1; ?>"), "image/jpeg"); espera("PHP disfrazado de foto 415", r.e === 415, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=placa`, t1, fx("foto-enorme.jpg"), "image/jpeg"); espera("foto de 5000 px 422", r.e === 422, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=placa`, t1, Buffer.alloc(5300000, 1), "image/jpeg"); espera("foto de más de 5 MB 413", r.e === 413, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=..%2F..%2Fx`, t1, JPG, "image/jpeg"); espera("paso con ruta rara 400", r.e === 400, r);
r = await subir(`/pruebas/${u4}/fotos?foto=no-es-uuid&paso=placa`, t1, JPG, "image/jpeg"); espera("identificador de foto inválido 400", r.e === 400, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=placa`, t2, JPG, "image/jpeg"); espera("otro técnico no sube fotos", r.e === 403, r);
r = await subir(`/pruebas/${u2}/fotos?foto=${f1}&paso=placa`, t2, JPG, "image/jpeg"); espera("un uuid de foto no se reutiliza en otra prueba", r.e === 409 && r.d.codigo === "foto_ajena", r);
r = await bajar(`/pruebas/${u4}/fotos/${f1}`, t1); espera("bajar foto idéntica", r.e === 200 && r.tipo === "image/jpeg" && r.bytes.equals(JPG), [r.e, r.tipo, r.bytes.length]);
r = await bajar(`/pruebas/${u4}/fotos/${f1}`, ts); espera("el supervisor baja la foto", r.e === 200 && r.bytes.equals(JPG), r.e);
r = await bajar(`/pruebas/${u4}/fotos/${f1}`, t2); espera("otro técnico no baja la foto", r.e === 403, r.e);
r = await bajar(`/pruebas/${u4}/fotos/${f1}`); espera("sin sesión no baja la foto", r.e === 401, r.e);
r = await bajar(`/pruebas/${u4}/fotos/${f2}`, t1); espera("foto que no ha subido 404", r.e === 404, r.e);

r = await pedir("POST", `/pruebas/${u4}/aprobar`, { token: ts }); espera("no se aprueba un borrador", r.e === 409 && r.d.codigo === "no_cerrada", r);
r = await pedir("PUT", "/pruebas/" + u4, { token: t1, cuerpo: { rev: 1, cerrar: true, datos: d4 } }); espera("cerrar la prueba con fotos", r.e === 200 && r.d.estado === "cerrada", r);
r = await pedir("POST", `/pruebas/${u4}/aprobar`, { token: t1 }); espera("un técnico no aprueba", r.e === 403 && r.d.codigo === "sin_permiso", r);
r = await pedir("POST", `/pruebas/${u4}/aprobar`, { token: ts }); espera("sin PDF no se aprueba", r.e === 409 && r.d.codigo === "falta_pdf", r);
r = await bajar(`/pruebas/${u4}/pdf`, ts); espera("PDF que no ha subido 404", r.e === 404, r.e);
r = await subir(`/pruebas/${u4}/pdf`, t1, Buffer.from("esto no es un pdf"), "application/pdf"); espera("texto disfrazado de PDF 415", r.e === 415, r);
r = await subir(`/pruebas/${u4}/pdf`, t1, JPG, "application/pdf"); espera("JPEG disfrazado de PDF 415", r.e === 415, r);
r = await subir(`/pruebas/${u4}/pdf`, t2, PDF, "application/pdf"); espera("otro técnico no sube el PDF", r.e === 403, r);
r = await subir(`/pruebas/${u4}/pdf`, t1, PDF, "application/octet-stream"); espera("subir PDF estando cerrada (como lo envía la app)", r.e === 201 && r.d.version === 1, r);
r = await subir(`/pruebas/${u4}/pdf`, t1, PDF, "application/pdf"); espera("repetir el PDF no sube versión", r.e === 200 && r.d.repetido === true, r);
r = await pedir("POST", `/pruebas/${u4}/aprobar`, { token: ts }); espera("con fotos pendientes no se aprueba", r.e === 409 && r.d.codigo === "faltan_fotos" && r.d.faltan === 1, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f2}&paso=termo`, t1, JPG, "application/octet-stream"); espera("la foto pendiente sube estando cerrada (como la envía la app)", r.e === 201, r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=termo`, t1, Buffer.from("<?php echo 1; ?>"), "application/octet-stream"); espera("octet-stream no se salta la validación del contenido", r.e === 415, r);
r = await pedir("GET", "/pruebas/" + u4, { token: ts }); espera("la prueba informa fotos y PDF en servidor", r.d.fotos?.length === 2 && r.d.pdf === true && r.d.aprobacion === null && r.d.devolucion === null, r.d);

// devolver, corregir y volver a cerrar
r = await pedir("POST", `/pruebas/${u4}/devolver`, { token: ts, cuerpo: { motivo: "" } }); espera("devolver sin motivo 422", r.e === 422, r);
r = await pedir("POST", `/pruebas/${u4}/devolver`, { token: t1, cuerpo: { motivo: "No me gusta" } }); espera("un técnico no devuelve", r.e === 403, r);
r = await pedir("POST", `/pruebas/${u4}/devolver`, { token: ts, cuerpo: { motivo: "Falta la foto de la placa legible" } }); espera("devolver", r.e === 200 && r.d.estado === "borrador" && r.d.devolucion?.motivo === "Falta la foto de la placa legible" && r.d.devolucion?.nombre === "Supervisora Uno", r);
const revDev = r.d.rev;
r = await pedir("GET", "/pruebas", { token: t1 }); espera("la lista marca la devuelta", r.d.pruebas.find(p => p.uuid === u4)?.devuelta === true, r.d.pruebas.find(p => p.uuid === u4));
r = await pedir("POST", `/pruebas/${u4}/devolver`, { token: ts, cuerpo: { motivo: "Otra vez lo mismo" } }); espera("no se devuelve un borrador", r.e === 409, r);
r = await pedir("PUT", "/pruebas/" + u4, { token: t1, cuerpo: { rev: revDev, cerrar: true, datos: conFotos({ sitio: "Corregida tras la devolución" }) } }); espera("el técnico corrige y vuelve a cerrar", r.e === 200 && r.d.estado === "cerrada", r);
r = await pedir("GET", "/pruebas/" + u4, { token: t1 }); espera("al volver a cerrar se limpia la devolución", r.d.devolucion === null && r.d.estado === "cerrada", r.d.devolucion);

// aprobar y sellar
r = await pedir("POST", `/pruebas/${u4}/aprobar`, { token: ts }); espera("aprobar y sellar", r.e === 200 && r.d.estado === "aprobada" && r.d.sellado === true && r.d.aprobacion?.nombre === "Supervisora Uno", r);
const revAp = r.d.rev;
r = await pedir("POST", `/pruebas/${u4}/aprobar`, { token: ts }); espera("aprobar dos veces no cambia nada", r.e === 200 && r.d.rev === revAp, r);
r = await bajar(`/pruebas/${u4}/pdf`, t1); const sellado = r.bytes;
espera("el técnico baja el PDF sellado", r.e === 200 && r.tipo === "application/pdf" && sellado.subarray(0, 5).toString() === "%PDF-" && !sellado.equals(PDF) && sellado.length > PDF.length, [r.e, r.tipo, sellado.length]);
r = await bajar(`/pruebas/${u4}/pdf`, t2); espera("otro técnico no baja el PDF", r.e === 403, r.e);
r = await pedir("PUT", "/pruebas/" + u4, { token: t1, cuerpo: { rev: revAp, datos: conFotos({ sitio: "Cambio tras aprobar" }) } }); espera("aprobada no admite cambios", r.e === 409 && r.d.codigo === "cerrada" && r.d.estado === "aprobada", r);
r = await subir(`/pruebas/${u4}/fotos?foto=${f3}&paso=placa`, t1, JPG, "image/jpeg"); espera("aprobada no admite fotos", r.e === 409, r);
r = await subir(`/pruebas/${u4}/pdf`, t1, PDF, "application/pdf"); espera("aprobada no admite otro PDF", r.e === 409, r);
r = await pedir("POST", `/pruebas/${u4}/devolver`, { token: ts, cuerpo: { motivo: "Ya no se puede" } }); espera("aprobada no se devuelve", r.e === 409, r);
r = await pedir("GET", "/pruebas?estado=aprobada", { token: ts }); espera("filtro de aprobadas", r.d.pruebas.some(p => p.uuid === u4), r.d.pruebas?.length);

// --- etapa 5: historial por motor
const serieH = "HIST-" + randomUUID().slice(0, 8), hist = [];
for (const [fecha, ir, pi] of [["2026-01-15", 900, 3.1], ["2026-06-20", 620, 2.6], ["2026-11-20", 310, 2.1]]) {
  const id = randomUUID(); hist.push(id);
  await pedir("PUT", "/pruebas/" + id, { token: fecha === "2026-06-20" ? t2 : t1, cuerpo: { rev: 0, datos: datos({ cliente: "Planta Historial", tag: "BH-1", serie: serieH, fecha }),
    resumen: { fecha, t_devanado: 30, ir1: ir * 2, ir1_40c: ir, pi, dar: 1.4, resistencia: [{ prom: 0.62, prom_25c: 0.61, desbalance: 1.6 }, null], dictamen: null, sugerido: "Apto para operar" } } });
}
r = await pedir("GET", "/motores/" + encodeURIComponent(serieH) + "/historial", { token: t1 });
espera("historial por serie: tres pruebas en orden de fecha", r.e === 200 && r.d.pruebas.length === 3 && r.d.pruebas.map(p => p.fecha).join() === "2026-01-15,2026-06-20,2026-11-20" && r.d.motores.length === 1, r.d);
espera("historial: trae los valores del resumen", r.d.pruebas?.[2]?.resumen?.ir1_40c === 310 && r.d.pruebas?.[0]?.resumen?.pi === 3.1 && r.d.pruebas?.[0]?.resumen?.resistencia?.[1] === null, r.d.pruebas?.[2]);
espera("historial: incluye pruebas de otros técnicos, sin sus datos completos", r.d.pruebas?.[1]?.tecnico === "Técnico Dos" && !("datos" in (r.d.pruebas?.[1] || {})), r.d.pruebas?.[1]);
r = await pedir("GET", "/motores/historial?q=" + encodeURIComponent(serieH.toLowerCase().replace("-", " ")), { token: ts }); espera("historial: la serie se normaliza (minúsculas, espacios)", r.e === 200 && r.d.pruebas.length === 3, r.d);
r = await pedir("GET", "/motores/historial?q=" + encodeURIComponent("BH-1") + "&cliente=" + encodeURIComponent("planta historial"), { token: t1 }); espera("historial por TAG y cliente", r.e === 200 && r.d.pruebas.length === 3, r.d);
r = await pedir("GET", "/motores/historial?q=" + encodeURIComponent("BH-1") + "&cliente=" + encodeURIComponent("Otro Cliente"), { token: t1 }); espera("historial: mismo TAG en otro cliente no se mezcla", r.e === 200 && r.d.pruebas.length === 0, r.d);
r = await pedir("GET", "/motores/historial?q=" + encodeURIComponent("NO-EXISTE-" + randomUUID()), { token: t1 }); espera("historial de un motor sin pruebas: lista vacía", r.e === 200 && r.d.pruebas.length === 0 && r.d.motores.length === 0, r.d);
r = await pedir("GET", "/motores/historial?q=", { token: t1 }); espera("historial sin motor 400", r.e === 400, r);
r = await pedir("GET", "/motores/" + encodeURIComponent(serieH) + "/historial"); espera("historial sin sesión 401", r.e === 401, r);
r = await pedir("GET", "/motores/historial?q=" + encodeURIComponent("x' OR '1'='1"), { token: t1 }); espera("historial con comillas no rompe", r.e === 200 && r.d.pruebas.length === 0, r);

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
