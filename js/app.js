// Interfaz de la prueba: render de pasos, eventos, guardado local, fotos e informe.
import { CONN } from "./conexiones.js";
import { STEPS, stepEvals, stepStatus, stepChecks, stepFields, allEvals, suggested } from "./protocolo.js";
import * as db from "./db.js";
import { comprimir, aDataURL, deDataURL } from "./fotos.js";
import { generarPDF } from "./pdf.js";
import { sesion, login, logout, cambiarClave, ApiError } from "./api.js";
import * as sync from "./sync.js";
import { cargarHistorial, historialHTML } from "./historial.js";
import * as asistente from "./asistente.js";

export const VERSION = "1.4.0-etapa4";

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2800); }

/* ---------- estado ---------- */
// S es la prueba abierta. Las fotos viven aparte: S.photos[paso] guarda solo sus uuid
// y los Blob están en `blobs` (memoria) y en IndexedDB.
let S = null;
const blobs = new Map(), urls = new Map();

// Fecha local del teléfono (toISOString da la fecha UTC, que en Panamá cambia a las 7 p. m.)
function hoy() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }

function blankState() {
  return { uuid: db.uuid(), created: new Date().toISOString(), step: 0, vib: false, estado: "borrador", rev: 0,
    v: { fecha: hoy(), hilos: "12", clase: "F", vprueba: "500", base: "Rígida", ...(sesion() ? { tecnico: sesion().usuario.nombre } : {}) },
    ...(sesion() ? { duenoId: sesion().usuario.id } : {}),
    c: {}, obs: {}, photos: {} };
}
// Cerrada, aprobada o de otro técnico: se puede ver y sacar el PDF, pero no editar
const soloLectura = () => !S.sample && (S.estado !== "borrador" || sync.esAjena(S));
function textoEstado() {
  if (S.sample) return "Ejemplo, no se guarda";
  if (S.conflicto) return "Conflicto con el servidor";
  if (!sesion()) return "Guardado en este equipo";
  return S.dirty ? "Guardado · por subir" : S.archivosPend ? "Subiendo archivos…" : "Sincronizada";
}
function sampleState() {
  const s = blankState();
  s.uuid = "EJEMPLO"; s.sample = true; s.vib = true; s.step = 0;
  Object.assign(s.v, { cliente: "Ejemplo: Planta de bombeo", sitio: "Cuarto de bombas 2", tag: "BBA-201", ot: "OT-0000", tecnico: "Técnico de ejemplo",
    tamb: "31", hr: "78", fab: "WEG", modelo: "W22", serie: "1234567890", hp: "25", kw: "18.5", vplaca: "230/460", aplaca: "60/30", rpm: "1765", frame: "284T", fs: "1.15", clase: "F", hilos: "12",
    conexion: "Y serie, alto voltaje", vserv: "460", carga: "70", tcarc: "58", tla: "61", tloa: "55", tbornes: "44", dtfases: "2.5",
    vla_h: "2.1", vla_v: "1.6", vla_a: "1.2", vloa_h: "1.9", vloa_v: "1.4", vloa_a: "1.0", vibequipo: "(sin equipo, valores de ejemplo)",
    twind: "30", r1: "0.62", r2: "0.63", r3: "0.62", r4: "0.62", r5: "0.64", r6: "0.62", vprueba: "500", ir1: "850", irab: "1200", irbc: "1150", irca: "1300", pi: "2.8", dar: "1.45",
    vab: "462", vbc: "458", vca: "466", ia: "21.4", ib: "22.0", ic: "21.1" });
  return s;
}
const g = id => S.v[id];

/* ---------- guardado ---------- */
let saveT = null, savePend = null;
function setSaveState(t) { $("#saveState").textContent = t; }
function save(forzar = false) {
  if (S.sample) { S.updated = new Date().toISOString(); setSaveState("Ejemplo, no se guarda"); return; }
  // En solo lectura (p. ej. al cambiar de paso en una prueba cerrada) se guarda la posición, pero no cuenta como cambio
  if (forzar || !soloLectura()) { S.updated = new Date().toISOString(); S.dirty = true; }
  setSaveState("Guardando…");
  clearTimeout(saveT); saveT = setTimeout(flush, 250);
  if (sesion()) sync.programar();
}
function flush() {
  clearTimeout(saveT); saveT = null;
  if (!S || S.sample) return Promise.resolve();
  const copia = JSON.parse(JSON.stringify(S));
  savePend = db.putPrueba(copia)
    .then(() => setSaveState(textoEstado()))
    .catch(() => { setSaveState("No se pudo guardar"); toast("No se pudo guardar en este equipo. Exporta un respaldo"); });
  return savePend;
}
addEventListener("pagehide", () => { if (saveT) flush(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && saveT) flush(); });

async function abrir(estado) {
  if (saveT) await flush();
  S = estado;
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear(); blobs.clear();
  if (!S.sample) {
    try { for (const f of await db.fotosDePrueba(S.uuid)) blobs.set(f.uuid, f.blob); } catch (e) { /* sin fotos */ }
    db.setMeta("actual", S.uuid).catch(() => {});
  } else {
    db.setMeta("actual", "").catch(() => {});
  }
  setSaveState(textoEstado());
  closeSheets(); render(); scrollTo(0, 0);
  reiniciarChat();
  bajarFotosFaltantes();
}
// Fotos que la prueba referencia y no están en este celular (prueba traída del servidor): se bajan y se guardan aquí
async function bajarFotosFaltantes() {
  const p = S; if (p.sample || !sesion() || navigator.onLine === false || !(p.rev > 0)) return;
  for (const [paso, ids] of Object.entries(p.photos || {})) {
    for (const id of ids) {
      if (blobs.has(id) || S !== p) continue;
      try {
        const blob = await sync.bajarFoto(p.uuid, id);
        await db.putFoto({ uuid: id, prueba: p.uuid, paso, blob, subida: true, creada: new Date().toISOString() });
        if (S === p) { blobs.set(id, blob); if (STEPS[S.step].id === paso) render(); }
      } catch (e) { if (e instanceof ApiError && (e.estado === 0 || e.estado === 401)) return; /* 404: aún no ha subido */ }
    }
  }
}
// Reemplaza una prueba local por la versión del servidor (aprobada, devuelta o editada en otro equipo)
async function reemplazar(uuid, nueva, estadoAntes) {
  await db.putPrueba(nueva);
  if (!S || S.sample || S.uuid !== uuid) return;
  clearTimeout(saveT); saveT = null;
  S = nueva; setSaveState(textoEstado()); render(); bajarFotosFaltantes();
  if (nueva.estado === "aprobada" && estadoAntes !== "aprobada") toast("Prueba aprobada por " + ((nueva.aprobacion && nueva.aprobacion.nombre) || "el supervisor"));
  else if (nueva.devolucion && estadoAntes === "cerrada") toast("El supervisor devolvió la prueba");
}
const esRevisor = () => { const s = sesion(); return !!s && (s.usuario.rol === "supervisor" || s.usuario.rol === "admin"); };
function fechaCorta(iso) {
  try { return new Date(iso).toLocaleString("es-ES", { timeZone: "America/Panama", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", ""); } catch (e) { return String(iso || ""); }
}
// Aplica a una prueba lo que devolvió el servidor (revisión, estado, conflicto) sin marcarla como modificada.
// `marca` es el `updated` con que se subió: si no cambió desde entonces, ya no está pendiente.
async function parchar(uuid, cambios, marca) {
  const aplicar = p => {
    Object.assign(p, cambios);
    if (cambios.errorSync === null) delete p.errorSync;
    if (marca !== undefined && p.updated === marca) p.dirty = false;
  };
  if (S && !S.sample && S.uuid === uuid) {
    const antes = [S.estado, S.estadoServidor, !!S.conflicto, S.errorSync || ""].join("|");
    aplicar(S);
    await db.putPrueba(JSON.parse(JSON.stringify(S))).catch(() => {});
    setSaveState(textoEstado());
    if ([S.estado, S.estadoServidor, !!S.conflicto, S.errorSync || ""].join("|") !== antes) render(); // solo si cambia lo que se ve: no interrumpe al que escribe
  } else {
    const p = await db.getPrueba(uuid); if (!p) return;
    aplicar(p); await db.putPrueba(p);
  }
}

// Si una miniatura no carga (la referencia en memoria dejó de servir), se vuelve a leer la foto
// de IndexedDB y se muestra de nuevo, sin obligar a recargar la página. Un solo reintento por imagen.
document.addEventListener("error", async e => {
  const t = e.target;
  if (!(t instanceof HTMLImageElement) || !t.dataset.foto || t.dataset.reintento) return;
  t.dataset.reintento = "1";
  const id = t.dataset.foto;
  try {
    const f = await db.getFoto(id); if (!f || !f.blob) return;
    const copia = new Blob([await f.blob.arrayBuffer()], { type: "image/jpeg" }); // copia en memoria, independiente del archivo de la base
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    blobs.set(id, copia);
    if (t.isConnected) t.src = fotoURL(id);
  } catch (err) { /* la foto no está en este equipo */ }
}, true);

function fotoURL(id) {
  if (!urls.has(id) && blobs.has(id)) urls.set(id, URL.createObjectURL(blobs.get(id)));
  return urls.get(id) || "";
}

/* ---------- bloques HTML ---------- */
function evHTML(e) {
  const t = { ok: "Cumple", warn: "Revisar", fail: "No cumple", na: "N/A" }[e.status] || "";
  return `<div class="ev ${e.status}"><span class="pill">${t}</span><span class="lbl">${esc(e.label)}${e.step ? ` <span class="hint">· ${esc(e.step)}</span>` : ""}</span><span class="val">${esc(e.value)}</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ""}</div>`;
}
function summaryHTML() {
  const ev = allEvals(S); const c = s => ev.filter(e => e.status === s).length;
  const bad = ev.filter(e => e.status === "fail" || e.status === "warn");
  const sug = suggested(S);
  return `<section class="block"><h2>Resumen</h2>
    <div class="summary-grid"><div class="sbox ok"><b>${c("ok")}</b>Cumplen</div><div class="sbox warn"><b>${c("warn")}</b>Observación</div><div class="sbox fail"><b>${c("fail")}</b>No cumplen</div></div>
    ${sug ? `<p>Dictamen sugerido por los criterios: <b>${esc(sug)}</b>. El técnico decide el dictamen final.</p>` : ""}
    ${bad.length ? `<div class="evals">${bad.map(evHTML).join("")}</div>` : ""}</section>`;
}
function extraHTML(st) {
  const d = (CONN[g("hilos")] || {})[g("conexion")];
  if (st.extra === "diagrama") return d ? `<section class="block"><h2>Diagrama de conexión</h2><div class="diagram">${esc(d)}</div><p class="hint">Marcado NEMA. Verifica siempre contra el diagrama de la placa del fabricante.</p></section>` : "";
  if (st.extra === "reconexion") return d ? `<section class="block"><h2>${esc(g("conexion"))}</h2><div class="diagram">${esc(d)}</div></section>` : `<section class="block"><p class="hint">Define la conexión de servicio en Datos de placa para ver el diagrama.</p></section>`;
  if (st.extra === "resumen") return summaryHTML();
  return "";
}
function fieldHTML(f) {
  const [id, label, type, unitOrOpts, cls, hint] = f; const val = S.v[id] ?? "";
  let ctl;
  if (type === "select") ctl = `<select id="f_${id}" data-f="${id}">${unitOrOpts.map(o => `<option ${o === String(val) ? "selected" : ""} value="${esc(o)}">${esc(o || "Seleccionar")}</option>`).join("")}</select>`;
  else if (type === "conn") { const opts = Object.keys(CONN[g("hilos")] || {}); ctl = `<select id="f_${id}" data-f="${id}"><option value="">Seleccionar</option>${opts.map(o => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`; }
  else if (type === "textarea") ctl = `<textarea id="f_${id}" data-f="${id}">${esc(val)}</textarea>`;
  else ctl = `<input id="f_${id}" data-f="${id}" type="${type === "number" ? "text" : type}" ${type === "number" ? 'inputmode="decimal"' : ""} autocomplete="off" value="${esc(val)}">`;
  const unit = type === "number" && unitOrOpts ? `<span class="unit">${esc(unitOrOpts)}</span>` : "";
  return `<div class="field ${cls || ""}"><label for="f_${id}">${esc(label)}</label><div class="inp">${ctl}${unit}</div>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;
}
function progressHTML() {
  return STEPS.map((s, i) => { const ss = stepStatus(s, S); return `<span title="${esc(s.title)}" data-go="${i}" class="${i === S.step ? "cur" : ss === "fail" ? "bad" : i < S.step ? "done" : ""}"></span>`; }).join("");
}

/* ---------- render ---------- */
function render() {
  const st = STEPS[S.step];
  $("#hdrMotor").textContent = [g("tag"), g("hp") ? g("hp") + " HP" : "", g("hilos") ? g("hilos") + " hilos" : ""].filter(Boolean).join(" · ") || "Prueba de motor";
  $("#progress").innerHTML = progressHTML();
  $("#stepCount").textContent = `Paso ${S.step + 1} de ${STEPS.length} · ${st.phase}`;
  const checks = stepChecks(st, S), fields = stepFields(st, S), evs = stepEvals(st, S);
  let h = "";
  if (S.sample) h += `<div class="banner"><span><b>Datos de ejemplo.</b> Recorre los pasos para ver cómo funciona. Para una prueba real, empieza una nueva.</span><button class="btn" type="button" id="startReal">Nueva prueba</button></div>`;
  if (S.conflicto) h += `<div class="banner fail"><span><b>Esta prueba cambió en el servidor desde otro equipo.</b> Elige cuál versión conservar; la otra se descarta.</span>
    <div class="btnrow"><button class="btn" type="button" id="usarLocal">Conservar la de este celular</button><button class="btn" type="button" id="usarServidor">Usar la del servidor</button></div></div>`;
  else if (S.estado === "aprobada") h += `<div class="banner ok"><span><b>Prueba aprobada</b>${S.aprobacion ? ` por ${esc(S.aprobacion.nombre || "el supervisor")} el ${esc(fechaCorta(S.aprobacion.fecha))}` : ""}. Solo lectura${sync.esAjena(S) ? `; técnico: ${esc(S.tecnicoNombre || "")}` : ""}.</span></div>`;
  else if (sync.esAjena(S) && S.estado === "cerrada" && esRevisor()) h += `<div class="banner"><span><b>Por revisar.</b> Prueba de ${esc(S.tecnicoNombre || "un técnico")}. Revisa los pasos, las fotos y el informe antes de decidir.</span>
    <div class="btnrow"><button class="btn primary" type="button" id="aprobar">Aprobar</button><button class="btn" type="button" id="devolver">Devolver al técnico</button></div></div>`;
  else if (sync.esAjena(S)) h += `<div class="banner"><span><b>Prueba de ${esc(S.tecnicoNombre || "otro técnico")}.</b> Solo lectura${S.estado === "borrador" ? "; el técnico aún no la ha cerrado" : ""}.</span></div>`;
  else if (S.estado === "borrador" && S.devolucion) h += `<div class="banner fail"><span><b>Devuelta por ${esc(S.devolucion.nombre || "el supervisor")}:</b> ${esc(S.devolucion.motivo.replace(/[.\s]+$/, ""))}. Corrígela y vuelve a cerrarla.</span></div>`;
  else if (S.estado === "cerrada") h += `<div class="banner"><span><b>Prueba cerrada.</b> Solo lectura${S.estadoServidor === "cerrada" ? "; pendiente de revisión del supervisor." : sesion() ? "; se subirá al servidor al haber conexión." : "; inicia sesión para subirla al servidor."}</span>
    ${S.estadoServidor === "cerrada" ? "" : `<button class="btn" type="button" id="reabrir">Reabrir</button>`}</div>`;
  if (S.errorSync && !S.conflicto) h += `<div class="banner fail"><span><b>No se pudo subir:</b> ${esc(S.errorSync)}</span></div>`;
  h += `<div class="phase">${esc(st.phase)}</div><h1 class="stitle">${esc(st.title)}</h1>${st.norma ? `<div class="norma">${esc(st.norma)}</div>` : ""}<p class="intro">${esc(st.intro)}</p>`;
  if (st.optional) h += `<section class="block"><label class="toggle"><input type="checkbox" id="vibToggle" ${S.vib ? "checked" : ""}> Aplicar módulo de vibración en esta prueba</label><p class="hint">Desactivado, el paso aparece como "no aplicado" en el informe.</p></section>`;
  const showBody = !st.optional || S.vib;
  if (showBody && checks.length) h += `<section class="block"><h2>Procedimiento</h2><div class="checks">${checks.map((c, i) => { const k = st.id + "_" + i; return `<label class="check"><input type="checkbox" data-c="${k}" ${S.c[k] ? "checked" : ""}><span>${esc(c)}</span></label>`; }).join("")}</div></section>`;
  if (showBody && fields.length) h += `<section class="block"><h2>Registro</h2><div class="fields">${fields.map(fieldHTML).join("")}</div></section>`;
  // El bloque existe aunque aún no haya lecturas, para que aparezca al escribir la primera
  if (st.evaluate) h += `<section class="block" id="evalBlock" ${evs.length ? "" : "hidden"}><h2>Evaluación automática</h2><div class="evals" id="evals">${evs.map(evHTML).join("")}</div></section>`;
  h += extraHTML(st);
  h += `<section class="block"><h2>Observaciones y fotos</h2><div class="field wide"><label for="obs_${st.id}" class="hint">Observaciones del paso</label><div class="inp"><textarea id="obs_${st.id}" data-o="${st.id}">${esc(S.obs[st.id] || "")}</textarea></div></div>
    <div class="photos">${(S.photos[st.id] || []).map((id, i) => blobs.has(id)
      ? `<figure><img src="${fotoURL(id)}" data-foto="${esc(id)}" alt="Foto ${i + 1} de ${esc(st.title)}"><button type="button" data-delphoto="${i}">Quitar</button></figure>`
      : `<figure class="falta"><span>Foto ${i + 1}<br>sin descargar</span></figure>`).join("")}</div>
    <label class="btn filebtn" for="ph_${st.id}" style="margin-top:8px">Agregar foto o termograma</label><input type="file" accept="image/*" id="ph_${st.id}" data-ph="${st.id}" multiple hidden></section>`;
  if ((st.id === "placa" || st.id === "dictamen") && !S.sample) h += `<section class="block"><h2>Historial del motor</h2>
    <p class="hint">Tendencia de aislamiento, PI y resistencia en las pruebas anteriores de este motor (por número de serie, o por TAG y cliente).</p>
    <button class="btn" type="button" id="verHistorial">Ver historial</button></section>`;
  if (st.id === "dictamen" && !S.sample && !soloLectura()) h += `<section class="block"><h2>Cerrar la prueba</h2>
    <p class="hint">Al cerrarla queda en solo lectura y pasa a revisión del supervisor. Antes de cerrar, elige el dictamen.</p>
    <button class="btn primary" type="button" id="cerrarPrueba">Cerrar prueba</button></section>`;
  $("#main").innerHTML = h;
  if (soloLectura()) {
    $("#main").querySelectorAll("input, select, textarea").forEach(el => { el.disabled = true; });
    $("#main").querySelectorAll(".filebtn, [data-delphoto]").forEach(el => { el.hidden = true; });
  }
  $("#prev").disabled = S.step === 0;
  $("#next").textContent = S.step === STEPS.length - 1 ? "Generar PDF" : "Siguiente";
  $("#pdfBtn").hidden = S.step === STEPS.length - 1; // en el último paso "Generar PDF" ya está en el botón principal
}
function refreshEvals() {
  const el = $("#evals");
  if (el) { const evs = stepEvals(STEPS[S.step], S); el.innerHTML = evs.map(evHTML).join(""); $("#evalBlock").hidden = !evs.length; }
  $("#progress").innerHTML = progressHTML();
}
function go(i) { S.step = Math.max(0, Math.min(STEPS.length - 1, i)); save(); render(); scrollTo(0, 0); closeSheets(); }

/* ---------- eventos ---------- */
document.addEventListener("input", e => {
  const t = e.target;
  if (soloLectura()) return;
  if (t.dataset.f) {
    S.v[t.dataset.f] = t.value; save();
    if (t.dataset.f === "hilos") { S.v.conexion = ""; render(); return; }
    if (t.dataset.f === "conexion") { render(); return; }
    refreshEvals();
  } else if (t.dataset.o) { S.obs[t.dataset.o] = t.value; save(); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "importJson") { await importar(t.files[0]); t.value = ""; return; }
  if (soloLectura()) return;
  if (t.dataset.c) { S.c[t.dataset.c] = t.checked; save(); }
  else if (t.id === "vibToggle") { S.vib = t.checked; save(); render(); }
  else if (t.dataset.ph) await agregarFotos(t.dataset.ph, [...t.files]);
});
document.addEventListener("click", async e => {
  const t = e.target.closest("button,[data-go]"); if (!t) return;
  if (t.dataset.go != null) go(+t.dataset.go);
  else if (t.dataset.delphoto != null) { if (!soloLectura()) quitarFoto(STEPS[S.step].id, +t.dataset.delphoto); }
  else if (t.id === "cerrarPrueba") cerrarPrueba();
  else if (t.id === "reabrir") { S.estado = "borrador"; delete S.cerrada; db.delPdf(S.uuid).catch(() => {}); save(); render(); toast("Prueba reabierta"); }
  else if (t.id === "aprobar" || t.id === "devolver") await revisar(t.id);
  else if (t.id === "verHistorial") await verHistorial();
  else if (t.dataset.chip) { $("#aiInput").value = t.dataset.chip; await preguntarAI(); }
  else if (t.id === "usarLocal") { S.rev = S.conflicto.rev; delete S.conflicto; save(true); render(); sync.programar(300); toast("Se conserva la versión de este celular"); }
  else if (t.id === "usarServidor") await usarServidor();
  else if (t.id === "btnSync") await sincronizarAhora();
  else if (t.id === "btnLogout") { await logout(); toast("Sesión cerrada. Las pruebas siguen en este celular"); }
  else if (t.id === "btnClave") { $("#claveForm").hidden = !$("#claveForm").hidden; }
  else if (t.dataset.traer) await traerDelServidor(t.dataset.traer);
  else if (t.dataset.close != null) closeSheets();
  else if (t.id === "startReal" || t.id === "newTest") { const n = blankState(); await db.putPrueba(JSON.parse(JSON.stringify(n))).catch(() => {}); await abrir(n); toast("Prueba nueva iniciada"); }
  else if (t.dataset.open) { const p = await db.getPrueba(t.dataset.open).catch(() => null); if (p) await abrir(p); else toast("No se pudo abrir la prueba"); }
  else if (t.dataset.sample != null) await abrir(sampleState());
});
$("#prev").onclick = () => { if (S.step > 0) go(S.step - 1); };
$("#next").onclick = () => { if (S.step < STEPS.length - 1) go(S.step + 1); else makePDF(); };
$("#pdfBtn").onclick = () => makePDF();
$("#btnSteps").onclick = () => {
  $("#stepList").innerHTML = STEPS.map((s, i) => `<button type="button" data-go="${i}"><span class="n">${String(i + 1).padStart(2, "0")}</span><span>${esc(s.title)}<br><span class="hint">${esc(s.phase)}${s.optional && !S.vib ? " · no aplicado" : ""}</span></span><span class="dot ${stepStatus(s, S)}"></span></button>`).join("");
  $("#sheetSteps").hidden = false;
};
$("#btnReports").onclick = async () => { await renderReports(); $("#sheetReports").hidden = false; };
$("#fab").onclick = () => abrirAsistente();
$("#exportJson").onclick = () => exportar();
function closeSheets() { document.querySelectorAll(".sheet").forEach(s => s.hidden = true); }
document.querySelectorAll(".sheet").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeSheets(); }));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });

async function renderReports() {
  if (saveT) await flush();
  let list = [];
  try { list = (await db.listPruebas()).sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || "")); } catch (e) { /* sin base local */ }
  const marca = r => r.conflicto ? "conflicto" : sync.esAjena(r) ? "de " + (r.tecnicoNombre || "otro técnico") : r.devolucion && r.estado === "borrador" ? "devuelta por el supervisor" : !sesion() ? "" : (r.dirty || r.archivosPend) ? "por subir" : r.sincronizada ? "sincronizada" : "";
  $("#reportList").innerHTML = `<button class="rep" type="button" data-sample><b>Prueba de ejemplo</b><span class="hint">Motor de 25 HP, 12 hilos, datos ficticios</span></button>` +
    (list.length ? list.map(r => `<button class="rep" type="button" data-open="${esc(r.uuid)}"><b>${esc(r.v.tag || "Sin TAG")} · ${esc(r.v.cliente || "Sin cliente")}</b><span class="hint">${esc([r.v.fecha, r.v.hp ? r.v.hp + " HP" : "", r.v.hilos ? r.v.hilos + " hilos" : "", r.v.dictamen || "sin dictamen", r.estado && r.estado !== "borrador" ? r.estado : "", marca(r), !S.sample && r.uuid === S.uuid ? "abierta" : ""].filter(Boolean).join(" · "))}</span></button>`).join("") : `<p class="hint">Aún no hay pruebas guardadas en este equipo.</p>`) +
    `<div id="remotas"></div>`;
  $("#version").textContent = "Versión " + VERSION;
  renderSesion();
  cargarRemotas(new Set(list.map(r => r.uuid)));
}

/* ---------- sesión y sincronización ---------- */
const ROL_TXT = { tecnico: "técnico", supervisor: "supervisor", admin: "administrador" };
function renderSesion(msg = "") {
  const s = sesion(), box = $("#sesionBox");
  const campo = (id, label, tipo, auto) => `<div class="field"><label for="${id}">${label}</label><div class="inp"><input id="${id}" type="${tipo}" autocomplete="${auto}" autocapitalize="none" spellcheck="false" required></div></div>`;
  box.innerHTML = s
    ? `<h4>Servidor ISELEC</h4><p><b>${esc(s.usuario.nombre)}</b> · ${esc(ROL_TXT[s.usuario.rol] || s.usuario.rol)}</p>
       <div class="btnrow"><button class="btn primary" type="button" id="btnSync">Sincronizar ahora</button><button class="btn" type="button" id="btnClave">Cambiar contraseña</button><button class="btn" type="button" id="btnLogout">Cerrar sesión</button></div>
       <form id="claveForm" hidden><div class="fields">${campo("claveActual", "Contraseña actual", "password", "current-password")}${campo("claveNueva", "Contraseña nueva (mín. 10 caracteres)", "password", "new-password")}</div><button class="btn" type="submit">Guardar contraseña</button></form>
       <p class="hint" id="syncMsg">${esc(msg)}</p>`
    : `<h4>Servidor ISELEC</h4>
       <form id="loginForm"><div class="fields">${campo("loginUsuario", "Usuario", "text", "username")}${campo("loginClave", "Contraseña", "password", "current-password")}</div><button class="btn primary" type="submit">Iniciar sesión</button></form>
       <p class="hint" id="syncMsg">${esc(msg || "Sin sesión la app funciona igual: las pruebas quedan en este celular y se suben cuando inicies sesión.")}</p>`;
}
function errorTxt(e) { return e instanceof ApiError ? e.message : "Ocurrió un error inesperado"; }

document.addEventListener("submit", async e => {
  const f = e.target; if (f.id !== "loginForm" && f.id !== "claveForm") return;
  e.preventDefault();
  const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
  try {
    if (f.id === "loginForm") {
      const u = await login($("#loginUsuario").value.trim(), $("#loginClave").value);
      toast("Sesión iniciada: " + u.nombre);
      await renderReports(); await sincronizarAhora();
    } else {
      if ($("#claveNueva").value.length < 10) { $("#syncMsg").textContent = "La contraseña nueva debe tener al menos 10 caracteres."; return; }
      await cambiarClave($("#claveActual").value, $("#claveNueva").value);
      renderSesion("Contraseña cambiada."); toast("Contraseña cambiada");
    }
  } catch (err) { const m = $("#syncMsg"); if (m) m.textContent = errorTxt(err); }
  finally { btn.disabled = false; }
});

async function sincronizarAhora() {
  const m = () => $("#syncMsg"); if (m()) m().textContent = "Sincronizando…";
  const r = await sync.sincronizar().catch(() => ({ motivo: "error", subidas: 0, conflictos: 0, errores: 1 }));
  const txt = r.motivo === "sin_red" ? "Sin conexión con el servidor. Las pruebas siguen guardadas aquí y se subirán después."
    : r.motivo === "sin_sesion" ? "La sesión venció. Inicia sesión de nuevo."
    : r.conflictos ? `${r.conflictos} prueba(s) con conflicto: ábrelas para elegir la versión.`
    : r.errores ? `${r.errores} prueba(s) no se pudieron subir. Ábrelas para ver el motivo.`
    : (r.subidas || r.fotos || r.informes || r.actualizadas) ? [r.subidas && `${r.subidas} prueba(s) subidas`, r.fotos && `${r.fotos} foto(s)`, r.informes && `${r.informes} informe(s)`, r.actualizadas && `${r.actualizadas} actualizada(s) desde el servidor`].filter(Boolean).join(", ") + "."
    : "Todo está al día.";
  if (!$("#sheetReports").hidden) { await renderReports(); if (m()) m().textContent = txt; }
  return r;
}

// Pruebas que están en el servidor y no en este celular (otro equipo, o las de los técnicos para el supervisor)
async function cargarRemotas(locales) {
  if (!sesion() || navigator.onLine === false) return;
  try {
    const rem = (await sync.listarServidor()).filter(r => !locales.has(r.uuid));
    const el = $("#remotas"); if (!el || !rem.length) return;
    const yo = sesion().usuario.id;
    const fila = r => `<button class="rep" type="button" data-traer="${esc(r.uuid)}"><b>${esc(r.tag || "Sin TAG")} · ${esc(r.cliente || "Sin cliente")}</b><span class="hint">${esc([r.fecha, r.dictamen || "sin dictamen", r.devuelta ? "devuelta" : r.estado, r.tecnico, "tocar para traerla"].filter(Boolean).join(" · "))}</span></button>`;
    // Para el supervisor, primero lo que espera su revisión
    const porRevisar = esRevisor() ? rem.filter(r => r.estado === "cerrada" && r.tecnico_id !== yo) : [];
    const resto = rem.filter(r => !porRevisar.includes(r));
    el.innerHTML = (porRevisar.length ? `<h4>Por revisar (${porRevisar.length})</h4>` + porRevisar.map(fila).join("") : "") + (resto.length ? `<h4>En el servidor</h4>` + resto.map(fila).join("") : "");
  } catch (e) { /* sin red: la lista local basta */ }
}
async function traerDelServidor(uuid) {
  try { const p = await sync.traer(uuid); await db.putPrueba(p); await abrir(p); toast("Prueba traída del servidor"); }
  catch (e) { toast(errorTxt(e)); }
}
async function usarServidor() {
  const c = S.conflicto; if (!c) return;
  const base = c.datos && typeof c.datos === "object" ? c.datos : {};
  const p = { c: {}, obs: {}, photos: {}, ...base, v: base.v || {}, uuid: S.uuid, step: S.step, rev: c.rev, estado: c.estado, estadoServidor: c.estado, dirty: false, sincronizada: c.actualizado_en };
  clearTimeout(saveT); saveT = null;
  await db.putPrueba(p); await abrir(p); toast("Se cargó la versión del servidor");
}
// Al cerrar se genera el informe que revisará y sellará el supervisor; queda guardado aquí hasta que suba.
async function cerrarPrueba() {
  if (!S.v.dictamen) { toast("Elige el dictamen antes de cerrar la prueba"); const d = $("#f_dictamen"); if (d) d.focus(); return; }
  if (!window.jspdf) { toast("No cargó el generador de PDF. Abre la app una vez con conexión antes de cerrar"); return; }
  if (!confirm("¿Cerrar la prueba?\n\nQueda en solo lectura y pasa a revisión del supervisor.")) return;
  const p = S;
  try {
    const { nombre, blob } = await construirPDF();
    await db.putPdf({ prueba: p.uuid, nombre, blob, subido: false, creada: new Date().toISOString() });
  } catch (err) { console.error(err); toast("No se pudo generar el informe; la prueba sigue abierta"); return; }
  if (S !== p) return;
  S.estado = "cerrada"; S.cerrada = new Date().toISOString(); S.archivosPend = true; delete S.devolucion;
  save(true); render(); scrollTo(0, 0); sync.programar(300);
  toast(sesion() ? "Prueba cerrada" : "Prueba cerrada. Inicia sesión para subirla");
}
// Aprobar o devolver (solo supervisor o administrador)
async function revisar(accion) {
  const p = S; let motivo = "";
  if (accion === "aprobar") { if (!confirm("¿Aprobar esta prueba?\n\nEl informe queda sellado con tu nombre y la fecha, y ya no se puede modificar.")) return; }
  else { motivo = (prompt("Motivo de la devolución (lo verá el técnico):") || "").trim(); if (!motivo) return; if (motivo.length < 5) { toast("Escribe un motivo más claro"); return; } }
  try {
    const r = accion === "aprobar" ? await sync.aprobar(p.uuid) : await sync.devolver(p.uuid, motivo);
    await reemplazar(p.uuid, { ...(await sync.traer(p.uuid)), step: p.step }, p.estado);
    toast(accion === "aprobar" ? (r.sellado === false ? "Prueba aprobada. El sello se agregará al generar el informe" : "Prueba aprobada e informe sellado") : "Prueba devuelta al técnico");
  } catch (e) { toast(errorTxt(e)); }
}

/* ---------- asistente técnico ---------- */
let chat = [], aiBusy = false;
function reiniciarChat() {
  chat = [];
  document.querySelectorAll("#chat .msg:not(:first-child)").forEach(m => m.remove());
}
function addMsg(clase, texto) {
  const d = document.createElement("div"); d.className = "msg " + clase; d.textContent = texto;
  $("#chat").appendChild(d); $("#chat").scrollTop = 1e9; return d;
}
function renderChips() {
  $("#aiChips").innerHTML = chat.length ? "" : asistente.sugerencias(STEPS[S.step].id).map(q => `<button type="button" class="chip" data-chip="${esc(q)}">${esc(q)}</button>`).join("");
}
async function abrirAsistente() {
  $("#sheetAI").hidden = false; renderChips();
  const est = $("#aiEstado"), listo = !!sesion() && navigator.onLine !== false;
  $("#aiSend").disabled = !listo || aiBusy; $("#aiInput").disabled = !listo;
  est.textContent = !sesion() ? "Inicia sesión en Pruebas para usar el asistente." : navigator.onLine === false ? "El asistente necesita conexión." : "";
  if (!listo) return;
  try {
    const u = await asistente.usoDeHoy();
    if (!u.disponible) { est.textContent = "El asistente aún no está habilitado en el servidor."; $("#aiSend").disabled = true; $("#aiInput").disabled = true; }
    else est.textContent = `Te quedan ${u.restantes} de ${u.limite} consultas hoy.`;
  } catch (e) { /* se sabrá al enviar */ }
  if (!$("#aiInput").disabled && matchMedia("(pointer: fine)").matches) $("#aiInput").focus(); // en el celular no se abre el teclado solo
}
async function preguntarAI() {
  const q = $("#aiInput").value.trim(); if (!q || aiBusy) return;
  if (!sesion()) { $("#aiEstado").textContent = "Inicia sesión en Pruebas para usar el asistente."; return; }
  const prueba = S;
  $("#aiInput").value = ""; $("#aiChips").innerHTML = ""; addMsg("user", q);
  aiBusy = true; $("#aiSend").disabled = true;
  const out = addMsg("ai", "Pensando…");
  try {
    const r = await asistente.preguntar([...chat, { role: "user", content: q }], asistente.contexto(prueba), parcial => { out.textContent = parcial; $("#chat").scrollTop = 1e9; });
    if (r.rechazo || !r.texto) { out.textContent = "El asistente no pudo responder esa consulta. Intenta formularla de otra manera."; }
    else {
      out.textContent = r.texto + (r.corte ? "\n\n(Respuesta cortada por longitud. Pide que continúe o haz una consulta más puntual.)" : "");
      if (S === prueba) { chat.push({ role: "user", content: q }, { role: "assistant", content: r.texto }); if (chat.length > 12) chat = chat.slice(-12); }
    }
    if (typeof r.restantes === "number") $("#aiEstado").textContent = `Te quedan ${r.restantes} consultas hoy.`;
  } catch (e) {
    const parcial = e instanceof ApiError && e.parcial ? e.parcial + "\n\n" : "";
    const msg = !(e instanceof ApiError) ? "No se pudo obtener respuesta. Intenta de nuevo."
      : e.estado === 0 ? "Sin conexión con el servidor. Intenta cuando tengas señal."
      : e.estado === 401 ? "La sesión venció. Inicia sesión de nuevo en Pruebas." : e.message;
    if (parcial) { out.textContent = parcial.trim(); addMsg("aviso", msg); } else { out.remove(); addMsg("aviso", msg); }
    if (e instanceof ApiError && typeof e.datos.restantes === "number") $("#aiEstado").textContent = `Te quedan ${e.datos.restantes} consultas hoy.`;
  } finally { aiBusy = false; $("#aiSend").disabled = !sesion(); $("#chat").scrollTop = 1e9; }
}
$("#aiForm").addEventListener("submit", e => { e.preventDefault(); preguntarAI(); });
$("#aiInput").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && matchMedia("(pointer: fine)").matches) { e.preventDefault(); preguntarAI(); } });

/* ---------- historial del motor ---------- */
async function verHistorial() {
  const cuerpo = $("#histBody"); $("#sheetHist").hidden = false;
  if (!(S.v.serie || "").trim() && !(S.v.tag || "").trim()) { cuerpo.innerHTML = `<p>Escribe el número de serie o el TAG del motor en los pasos 1 y 2 para buscar su historial.</p>`; return; }
  if (!sesion()) { cuerpo.innerHTML = `<p>El historial está en el servidor de ISELEC. Inicia sesión en <b>Pruebas</b> para consultarlo.</p>`; return; }
  cuerpo.innerHTML = `<p class="hint">Consultando…</p>`;
  try {
    if (saveT) await flush();
    await sync.sincronizar().catch(() => {}); // para que esta prueba entre con sus últimos valores
    cuerpo.innerHTML = historialHTML(await cargarHistorial(S.v), S);
  } catch (e) { cuerpo.innerHTML = `<p>${esc(e instanceof ApiError && e.estado === 0 ? "Sin conexión con el servidor. El historial necesita red." : errorTxt(e))}</p>`; }
}
// Lectura de un punto de la gráfica (al tocarlo, pasar el cursor o enfocarlo con el teclado)
function mostrarLectura(el) {
  const fig = el.closest(".graf"); if (!fig) return;
  let tip = fig.querySelector(".lectura"); if (!tip) { tip = document.createElement("div"); tip.className = "lectura"; tip.setAttribute("role", "status"); fig.appendChild(tip); }
  tip.textContent = el.dataset.tip;
  fig.querySelectorAll(".toca.sel").forEach(c => c.classList.remove("sel")); el.classList.add("sel");
}
for (const ev of ["pointerover", "click", "focusin"]) document.addEventListener(ev, e => { const t = e.target; if (t instanceof Element && t.matches(".toca")) mostrarLectura(t); });

/* ---------- fotos ---------- */
async function agregarFotos(paso, archivos) {
  if (!archivos.length) return;
  const destino = S; // la compresión es asíncrona: la foto va a la prueba que estaba abierta al elegirla
  let fallas = 0;
  for (const f of archivos) {
    try {
      const blob = await comprimir(f), id = db.uuid();
      if (!destino.sample) await db.putFoto({ uuid: id, prueba: destino.uuid, paso, blob, creada: new Date().toISOString() });
      if (destino === S) blobs.set(id, blob);
      (destino.photos[paso] = destino.photos[paso] || []).push(id);
      destino.archivosPend = true;
    } catch (err) { fallas++; }
  }
  if (fallas) toast(fallas === 1 ? "No se pudo leer una imagen" : `No se pudieron leer ${fallas} imágenes`);
  if (destino === S) { save(); render(); }
  else if (!destino.sample) db.putPrueba(JSON.parse(JSON.stringify(destino))).catch(() => {});
}
function quitarFoto(paso, i) {
  const [id] = (S.photos[paso] || []).splice(i, 1);
  if (id) {
    if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
    blobs.delete(id);
    if (!S.sample) db.delFoto(id).catch(() => {});
  }
  save(); render();
}

/* ---------- archivos ---------- */
// En teléfonos abre la hoja de compartir del sistema (WhatsApp, correo, Guardar en Archivos),
// que es lo que el técnico necesita para enviar el informe. Si no existe o falla, descarga.
async function saveFile(nombre, blob) {
  try {
    const archivo = new File([blob], nombre, { type: blob.type });
    if (matchMedia("(pointer: coarse)").matches && navigator.canShare && navigator.canShare({ files: [archivo] })) {
      try { await navigator.share({ files: [archivo], title: nombre }); return; }
      catch (err) { if (err && err.name === "AbortError") return; /* otro error: se descarga */ }
    }
  } catch (err) { /* sin File o sin share: se descarga */ }
  try {
    const u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 60000);
    toast("Archivo listo: " + nombre);
  } catch (err) { toast("No se pudo guardar el archivo"); }
}

async function construirPDF() {
  const fotos = {};
  for (const [paso, ids] of Object.entries(S.photos)) {
    fotos[paso] = [];
    for (const id of ids) if (blobs.has(id)) { try { fotos[paso].push(await aDataURL(blobs.get(id), 1000, 0.7)); } catch (e) { /* foto ilegible */ } }
  }
  return generarPDF(S, fotos);
}
let pdfBusy = false;
async function makePDF() {
  if (pdfBusy) return;
  pdfBusy = true;
  try {
    // El informe oficial es el del servidor: el sellado si está aprobada, o el que subió el técnico si la revisa el supervisor
    if (!S.sample && sesion() && navigator.onLine !== false && (S.estado === "aprobada" || (sync.esAjena(S) && S.estado === "cerrada"))) {
      try {
        toast("Descargando informe…");
        const blob = await sync.bajarPdf(S.uuid);
        await saveFile(`Informe-${(S.v.tag || "motor").replace(/[^\w-]+/g, "_")}-${S.v.fecha || ""}${S.estado === "aprobada" ? "-aprobado" : ""}.pdf`, blob);
        return;
      } catch (e) { if (sync.esAjena(S) && e instanceof ApiError && e.estado === 404) toast("El informe del técnico aún no ha subido; se genera aquí"); }
    }
    if (!window.jspdf) { toast("No cargó el generador de PDF. Abre la app una vez con conexión"); return; }
    toast("Generando informe…");
    const { nombre, blob } = await construirPDF();
    await saveFile(nombre, blob);
  } catch (err) { console.error(err); toast("No se pudo generar el informe"); }
  finally { pdfBusy = false; }
}

// Respaldo: todas las pruebas con sus fotos incrustadas (data URL) en `fotosData`
async function exportar() {
  try {
    if (saveT) await flush();
    const arr = await db.listPruebas();
    for (const p of arr) {
      const porId = new Map((await db.fotosDePrueba(p.uuid)).map(f => [f.uuid, f.blob]));
      p.fotosData = {};
      for (const [paso, ids] of Object.entries(p.photos || {})) {
        p.fotosData[paso] = [];
        for (const id of ids) if (porId.has(id)) p.fotosData[paso].push(await aDataURL(porId.get(id)));
      }
    }
    if (!arr.length) { toast("No hay pruebas guardadas para exportar"); return; }
    await saveFile("pruebas-motores-" + hoy() + ".json", new Blob([JSON.stringify(arr)], { type: "application/json" }));
  } catch (err) { console.error(err); toast("No se pudo exportar"); }
}
// Acepta respaldos de esta app y archivos JSON del prototipo (fotos como data URL en `photos`)
async function importar(archivo) {
  if (!archivo) return;
  try {
    const data = JSON.parse(await archivo.text()); const items = Array.isArray(data) ? data : [data];
    let n = 0;
    for (const it of items) {
      if (!it || typeof it.v !== "object" || !it.v) continue;
      const p = { ...blankState(), ...it, v: { ...it.v }, c: { ...(it.c || {}) }, obs: { ...(it.obs || {}) }, photos: {} };
      if (!/^[0-9a-f-]{36}$/i.test(String(it.uuid || ""))) p.uuid = db.uuid();
      delete p.id; delete p.sample; delete p.fotosData; p.dirty = true;
      const origen = it.fotosData || it.photos || {};
      for (const fv of await db.fotosDePrueba(p.uuid)) await db.delFoto(fv.uuid); // reimportar reemplaza las fotos
      for (const [paso, lista] of Object.entries(origen)) {
        for (const d of (Array.isArray(lista) ? lista : [])) {
          if (typeof d !== "string" || !d.startsWith("data:image/")) continue;
          const id = db.uuid();
          await db.putFoto({ uuid: id, prueba: p.uuid, paso, blob: await deDataURL(d), creada: new Date().toISOString() });
          (p.photos[paso] = p.photos[paso] || []).push(id);
        }
      }
      await db.putPrueba(p); n++;
    }
    if (!S.sample) { const act = await db.getPrueba(S.uuid); if (act) await abrir(act); $("#sheetReports").hidden = false; }
    await renderReports();
    toast(n ? n + " prueba(s) importada(s)" : "El archivo no contiene pruebas");
  } catch (err) { console.error(err); toast("El archivo no es un JSON de pruebas válido"); }
}

/* ---------- tema ---------- */
const TEMAS = ["auto", "light", "dark"], TEMA_TXT = { auto: "automático", light: "claro", dark: "oscuro" };
function temaActual() { try { const t = localStorage.getItem("pm_tema"); return TEMAS.includes(t) ? t : "auto"; } catch (e) { return "auto"; } }
function aplicarTema(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $("#btnTema").textContent = "Tema: " + TEMA_TXT[t];
}
$("#btnTema").onclick = () => {
  const t = TEMAS[(TEMAS.indexOf(temaActual()) + 1) % TEMAS.length];
  try { localStorage.setItem("pm_tema", t); } catch (e) { /* sin almacenamiento */ }
  aplicarTema(t);
};

/* ---------- inicio ---------- */
async function init() {
  aplicarTema(temaActual());
  let inicial = null;
  try { const id = await db.getMeta("actual"); if (id) inicial = await db.getPrueba(id); } catch (e) { /* IndexedDB no disponible */ }
  await abrir(inicial || sampleState());
  sync.configurar({ antes: () => (saveT ? flush() : savePend || Promise.resolve()), parchar, reemplazar });
  addEventListener("online", () => sync.programar(1000));
  addEventListener("pm-sesion", () => { setSaveState(textoEstado()); render(); if (!$("#sheetReports").hidden) renderSesion(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync.programar(1500); });
  sync.programar(2000);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // pide que el navegador no borre los datos
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
