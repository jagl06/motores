// Sincronización con la API. El teléfono es la fuente de verdad mientras la prueba está abierta:
// cada cambio marca la prueba como `dirty` y aquí se sube cuando hay red y sesión.
//   - Idempotente: el uuid lo genera el teléfono y repetir un PUT no duplica nada.
//   - Conflictos: se envía la `rev` del servidor sobre la que se trabajó; si el servidor tiene otra
//     responde 409 y la prueba queda marcada `conflicto` hasta que el técnico elija cuál conservar.
import * as db from "./db.js";
import { pedir, sesion, ApiError, subirArchivo, bajarArchivo } from "./api.js";
import { num, r40 } from "./evaluadores.js";
import { WINDINGS } from "./conexiones.js";
import { suggested } from "./protocolo.js";

// Campos que solo tienen sentido en el teléfono y no viajan dentro de `datos`
const LOCALES = ["dirty", "conflicto", "rev", "estado", "estadoServidor", "sincronizada", "errorSync", "ajena", "duenoId", "tecnicoNombre", "aprobacion", "devolucion", "archivosPend", "pdfEnServidor", "fotosData", "sample"];

// Una prueba es ajena si se sabe quién es su técnico y no es el usuario de la sesión actual
// (el supervisor revisando, u otro técnico usando el mismo celular). Sin sesión no se puede saber.
export function esAjena(p) {
  const s = sesion();
  return !!s && p.duenoId != null && p.duenoId !== s.usuario.id;
}

export function datosParaServidor(p) {
  const d = JSON.parse(JSON.stringify(p));
  for (const k of LOCALES) delete d[k];
  return d;
}

// Valores clave de la prueba para el historial por motor (etapa 5)
export function resumen(p) {
  const v = p.v, ir = num(v.ir1), tw = num(v.twind);
  const grupos = v.hilos === "12" ? [[1, 2, 3], [4, 5, 6]] : [[1, 2, 3]];
  const res = grupos.map(gr => {
    const xs = gr.map(i => num(v["r" + i])).filter(x => x != null);
    if (xs.length < 3) return null;
    const prom = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { prom, prom_25c: tw != null ? prom * (234.5 + 25) / (234.5 + tw) : null, desbalance: (Math.max(...xs) - Math.min(...xs)) / prom * 100 };
  });
  return { fecha: v.fecha || null, t_devanado: tw, ir1: ir, ir1_40c: r40(p, ir), pi: num(v.pi), dar: num(v.dar),
    resistencia: res, devanados: (WINDINGS[v.hilos] || []).length, dictamen: v.dictamen || null, sugerido: suggested(p) || null };
}

// La app registra aquí cómo aplicar cambios a la prueba abierta y cómo vaciar su guardado pendiente
let ganchos = { antes: async () => {}, parchar: async () => {}, reemplazar: async () => {}, aviso: () => {} };
export function configurar(g) { ganchos = { ...ganchos, ...g }; }

let corriendo = false, repetir = false, temporizador = null;

export function programar(ms = 4000) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar().catch(() => {}), ms);
}


// Sube lo pendiente de cada prueba (datos, fotos, informe) y luego trae los cambios hechos en el servidor
// (aprobación, devolución, ediciones desde otro equipo).
// Devuelve { subidas, fotos, informes, actualizadas, conflictos, errores, motivo }
export async function sincronizar() {
  const r = { subidas: 0, fotos: 0, informes: 0, actualizadas: 0, conflictos: 0, errores: 0, motivo: "" };
  if (!sesion()) { r.motivo = "sin_sesion"; return r; }
  if (navigator.onLine === false) { r.motivo = "sin_red"; return r; }
  if (corriendo) { repetir = true; r.motivo = "en_curso"; return r; }
  corriendo = true;
  try {
    await ganchos.antes();
    for (let p of await db.listPruebas()) {
      if (esAjena(p) || p.conflicto || !(p.dirty || p.archivosPend)) continue;
      try {
        if (p.dirty) { await subir(p); r.subidas++; p = await db.getPrueba(p.uuid) || p; }
        if (p.archivosPend && p.rev > 0) await subirArchivos(p, r);   // la prueba debe existir en el servidor antes que sus archivos
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        if (e.estado === 0) { r.motivo = "sin_red"; break; }        // sin respuesta: se reintenta luego
        if (e.estado === 401) { r.motivo = "sin_sesion"; break; }
        if (e.estado === 404 && e.codigo === "ruta") continue;      // el servidor aún no tiene esta versión de la API: queda pendiente, sin alarmar
        if (e.estado === 409 && e.codigo === "conflicto") { r.conflictos++; await ganchos.parchar(p.uuid, { conflicto: e.datos.servidor }); continue; }
        if (e.estado === 409 && e.codigo === "cerrada") {           // ya estaba cerrada o aprobada en el servidor: manda el servidor
          await ganchos.parchar(p.uuid, { dirty: false, archivosPend: false, estado: e.datos.estado, estadoServidor: e.datos.estado, ...(e.datos.rev ? { rev: e.datos.rev } : {}), errorSync: e.message });
          r.errores++; continue;
        }
        r.errores++; await ganchos.parchar(p.uuid, { errorSync: e.message });
      }
    }
    if (!r.motivo) await actualizar(r);
  } finally {
    corriendo = false;
    if (repetir) { repetir = false; programar(500); }
  }
  ganchos.aviso(r);
  return r;
}

async function subir(p) {
  const marca = p.updated;
  const resp = await pedir("PUT", "/pruebas/" + p.uuid, { rev: p.rev || 0, datos: datosParaServidor(p), resumen: resumen(p), cerrar: p.estado === "cerrada" });
  // Si el técnico siguió escribiendo mientras subía, la prueba sigue pendiente con la revisión nueva
  await ganchos.parchar(p.uuid, { rev: resp.rev, estado: resp.estado, estadoServidor: resp.estado, sincronizada: resp.actualizado_en, errorSync: null, duenoId: sesion().usuario.id }, marca);
}

// Los archivos se envían como "application/octet-stream": el cortafuegos del hosting (ModSecurity) rechaza
// con 406 un POST cuyo Content-Type sea application/pdf. El servidor no se fía de esta cabecera:
// valida el contenido real del archivo.
const TIPO_SUBIDA = "application/octet-stream";
const referenciadas = p => new Set(Object.values(p.photos || {}).flat());
const fotosPendientes = async p => { const ref = referenciadas(p); return (await db.fotosDePrueba(p.uuid)).filter(f => !f.subida && ref.has(f.uuid)); };

// Fotos: una por petición, cada una con su uuid (repetir no duplica). Después, el informe PDF si la prueba está cerrada.
async function subirArchivos(p, r) {
  for (const f of await fotosPendientes(p)) {
    await subirArchivo(`/pruebas/${p.uuid}/fotos?foto=${f.uuid}&paso=${encodeURIComponent(f.paso)}`, f.blob, TIPO_SUBIDA);
    await db.putFoto({ ...f, subida: true }); r.fotos++;
  }
  const pdf = await db.getPdf(p.uuid);
  if (pdf && !pdf.subido && p.estado === "cerrada") {
    await subirArchivo(`/pruebas/${p.uuid}/pdf`, pdf.blob, TIPO_SUBIDA);
    await db.putPdf({ ...pdf, subido: true }); r.informes++;
  }
  // Se vuelve a mirar por si entró una foto mientras subían las anteriores
  const act = await db.getPrueba(p.uuid);
  const pdf2 = await db.getPdf(p.uuid);
  const quedan = act && ((await fotosPendientes(act)).length > 0 || (pdf2 && !pdf2.subido && act.estado === "cerrada"));
  if (!quedan) await ganchos.parchar(p.uuid, { archivosPend: false });
}

// Trae del servidor las pruebas locales que cambiaron allá y aquí no tienen cambios sin subir
async function actualizar(r) {
  let lista;
  try { lista = await listarServidor(); } catch (e) { return; }
  const remotas = new Map(lista.map(x => [x.uuid, x]));
  for (const p of await db.listPruebas()) {
    const s = remotas.get(p.uuid);
    if (s && p.duenoId == null) await ganchos.parchar(p.uuid, { duenoId: s.tecnico_id, tecnicoNombre: s.tecnico || "" }); // pruebas guardadas antes de la versión 1.2
    if (!s || p.dirty || p.conflicto || (s.rev === p.rev && s.estado === p.estado)) continue;
    try { await ganchos.reemplazar(p.uuid, { ...(await traer(p.uuid)), step: p.step || 0 }, p.estado); r.actualizadas++; }
    catch (e) { if (e instanceof ApiError && (e.estado === 0 || e.estado === 401)) return; }
  }
}

// Pruebas que están en el servidor (para traerlas a este teléfono)
export async function listarServidor() {
  return (await pedir("GET", "/pruebas")).pruebas;
}
export async function traer(uuid) {
  const r = await pedir("GET", "/pruebas/" + uuid);
  const base = r.datos && typeof r.datos === "object" ? r.datos : {};
  return { step: 0, vib: false, c: {}, obs: {}, photos: {}, ...base, v: base.v || {}, uuid: r.uuid, rev: r.rev, estado: r.estado, estadoServidor: r.estado,
    dirty: false, sincronizada: r.actualizado_en, duenoId: r.tecnico_id, tecnicoNombre: r.tecnico || "",
    aprobacion: r.aprobacion || null, devolucion: r.devolucion || null, pdfEnServidor: !!r.pdf };
}

// Revisión del supervisor
export const aprobar = uuid => pedir("POST", `/pruebas/${uuid}/aprobar`, {});
export const devolver = (uuid, motivo) => pedir("POST", `/pruebas/${uuid}/devolver`, { motivo });
export const bajarFoto = (uuid, foto) => bajarArchivo(`/pruebas/${uuid}/fotos/${foto}`);
export const bajarPdf = uuid => bajarArchivo(`/pruebas/${uuid}/pdf`);
