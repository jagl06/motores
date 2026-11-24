// Sincronización con la API. El teléfono es la fuente de verdad mientras la prueba está abierta:
// cada cambio marca la prueba como `dirty` y aquí se sube cuando hay red y sesión.
//   - Idempotente: el uuid lo genera el teléfono y repetir un PUT no duplica nada.
//   - Conflictos: se envía la `rev` del servidor sobre la que se trabajó; si el servidor tiene otra
//     responde 409 y la prueba queda marcada `conflicto` hasta que el técnico elija cuál conservar.
import * as db from "./db.js";
import { pedir, sesion, ApiError } from "./api.js";
import { num, r40 } from "./evaluadores.js";
import { WINDINGS } from "./conexiones.js";
import { suggested } from "./protocolo.js";

// Campos que solo tienen sentido en el teléfono y no viajan dentro de `datos`
const LOCALES = ["dirty", "conflicto", "rev", "estado", "estadoServidor", "sincronizada", "errorSync", "ajena", "fotosData", "sample"];

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
let ganchos = { antes: async () => {}, parchar: async () => {}, aviso: () => {} };
export function configurar(g) { ganchos = { ...ganchos, ...g }; }

let corriendo = false, repetir = false, temporizador = null;

export function programar(ms = 4000) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar().catch(() => {}), ms);
}

// Sube todas las pruebas pendientes. Devuelve { subidas, conflictos, errores, motivo }
export async function sincronizar() {
  const r = { subidas: 0, conflictos: 0, errores: 0, motivo: "" };
  if (!sesion()) { r.motivo = "sin_sesion"; return r; }
  if (navigator.onLine === false) { r.motivo = "sin_red"; return r; }
  if (corriendo) { repetir = true; r.motivo = "en_curso"; return r; }
  corriendo = true;
  try {
    await ganchos.antes();
    for (const p of await db.listPruebas()) {
      if (!p.dirty || p.conflicto) continue;
      try { await subir(p); r.subidas++; }
      catch (e) {
        if (!(e instanceof ApiError)) throw e;
        if (e.estado === 0) { r.motivo = "sin_red"; break; }        // sin respuesta: se reintenta luego
        if (e.estado === 401) { r.motivo = "sin_sesion"; break; }
        if (e.estado === 409 && e.codigo === "conflicto") { r.conflictos++; await ganchos.parchar(p.uuid, { conflicto: e.datos.servidor }); continue; }
        if (e.estado === 409 && e.codigo === "cerrada") {           // ya estaba cerrada en el servidor: manda el servidor
          await ganchos.parchar(p.uuid, { dirty: false, estado: e.datos.estado, estadoServidor: e.datos.estado, rev: e.datos.rev, errorSync: e.message });
          r.errores++; continue;
        }
        r.errores++; await ganchos.parchar(p.uuid, { errorSync: e.message });
      }
    }
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
  await ganchos.parchar(p.uuid, { rev: resp.rev, estado: resp.estado, estadoServidor: resp.estado, sincronizada: resp.actualizado_en, errorSync: null }, marca);
}

// Pruebas que están en el servidor (para traerlas a este teléfono)
export async function listarServidor() {
  return (await pedir("GET", "/pruebas")).pruebas;
}
export async function traer(uuid) {
  const r = await pedir("GET", "/pruebas/" + uuid);
  const base = r.datos && typeof r.datos === "object" ? r.datos : {};
  const s = sesion();
  return { step: 0, vib: false, c: {}, obs: {}, photos: {}, ...base, v: base.v || {}, uuid: r.uuid, rev: r.rev, estado: r.estado, estadoServidor: r.estado,
    dirty: false, sincronizada: r.actualizado_en, ajena: !s || r.tecnico_id !== s.usuario.id, tecnicoNombre: r.tecnico || "" };
}
