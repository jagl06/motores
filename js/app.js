// Interfaz de la prueba: render de pasos, eventos, guardado local, fotos e informe.
import { CONN } from "./conexiones.js";
import { STEPS, stepEvals, stepStatus, stepChecks, stepFields, allEvals, suggested } from "./protocolo.js";
import * as db from "./db.js";
import { comprimir, aDataURL, deDataURL } from "./fotos.js";
import { generarPDF } from "./pdf.js";

export const VERSION = "1.0.1-etapa1";

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
    v: { fecha: hoy(), hilos: "12", clase: "F", vprueba: "500", base: "Rígida" },
    c: {}, obs: {}, photos: {} };
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
function save() {
  S.updated = new Date().toISOString();
  if (S.sample) { setSaveState("Ejemplo, no se guarda"); return; }
  S.dirty = true; // pendiente de sincronizar (etapa 2)
  setSaveState("Guardando…");
  clearTimeout(saveT); saveT = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(saveT); saveT = null;
  if (!S || S.sample) return Promise.resolve();
  const copia = JSON.parse(JSON.stringify(S));
  savePend = db.putPrueba(copia)
    .then(() => setSaveState("Guardado en este equipo"))
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
    setSaveState("Guardado en este equipo");
  } else {
    db.setMeta("actual", "").catch(() => {});
    setSaveState("Ejemplo, no se guarda");
  }
  closeSheets(); render(); scrollTo(0, 0);
}
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
  h += `<div class="phase">${esc(st.phase)}</div><h1 class="stitle">${esc(st.title)}</h1>${st.norma ? `<div class="norma">${esc(st.norma)}</div>` : ""}<p class="intro">${esc(st.intro)}</p>`;
  if (st.optional) h += `<section class="block"><label class="toggle"><input type="checkbox" id="vibToggle" ${S.vib ? "checked" : ""}> Aplicar módulo de vibración en esta prueba</label><p class="hint">Desactivado, el paso aparece como "no aplicado" en el informe.</p></section>`;
  const showBody = !st.optional || S.vib;
  if (showBody && checks.length) h += `<section class="block"><h2>Procedimiento</h2><div class="checks">${checks.map((c, i) => { const k = st.id + "_" + i; return `<label class="check"><input type="checkbox" data-c="${k}" ${S.c[k] ? "checked" : ""}><span>${esc(c)}</span></label>`; }).join("")}</div></section>`;
  if (showBody && fields.length) h += `<section class="block"><h2>Registro</h2><div class="fields">${fields.map(fieldHTML).join("")}</div></section>`;
  // El bloque existe aunque aún no haya lecturas, para que aparezca al escribir la primera
  if (st.evaluate) h += `<section class="block" id="evalBlock" ${evs.length ? "" : "hidden"}><h2>Evaluación automática</h2><div class="evals" id="evals">${evs.map(evHTML).join("")}</div></section>`;
  h += extraHTML(st);
  h += `<section class="block"><h2>Observaciones y fotos</h2><div class="field wide"><label for="obs_${st.id}" class="hint">Observaciones del paso</label><div class="inp"><textarea id="obs_${st.id}" data-o="${st.id}">${esc(S.obs[st.id] || "")}</textarea></div></div>
    <div class="photos">${(S.photos[st.id] || []).map((id, i) => `<figure><img src="${fotoURL(id)}" alt="Foto ${i + 1} de ${esc(st.title)}"><button type="button" data-delphoto="${i}">Quitar</button></figure>`).join("")}</div>
    <label class="btn filebtn" for="ph_${st.id}" style="margin-top:8px">Agregar foto o termograma</label><input type="file" accept="image/*" id="ph_${st.id}" data-ph="${st.id}" multiple hidden></section>`;
  $("#main").innerHTML = h;
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
  if (t.dataset.f) {
    S.v[t.dataset.f] = t.value; save();
    if (t.dataset.f === "hilos") { S.v.conexion = ""; render(); return; }
    if (t.dataset.f === "conexion") { render(); return; }
    refreshEvals();
  } else if (t.dataset.o) { S.obs[t.dataset.o] = t.value; save(); }
});
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.dataset.c) { S.c[t.dataset.c] = t.checked; save(); }
  else if (t.id === "vibToggle") { S.vib = t.checked; save(); render(); }
  else if (t.dataset.ph) await agregarFotos(t.dataset.ph, [...t.files]);
  else if (t.id === "importJson") { await importar(t.files[0]); t.value = ""; }
});
document.addEventListener("click", async e => {
  const t = e.target.closest("button,[data-go]"); if (!t) return;
  if (t.dataset.go != null) go(+t.dataset.go);
  else if (t.dataset.delphoto != null) quitarFoto(STEPS[S.step].id, +t.dataset.delphoto);
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
$("#fab").onclick = () => { $("#sheetAI").hidden = false; };
$("#exportJson").onclick = () => exportar();
function closeSheets() { document.querySelectorAll(".sheet").forEach(s => s.hidden = true); }
document.querySelectorAll(".sheet").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeSheets(); }));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });

async function renderReports() {
  if (saveT) await flush();
  let list = [];
  try { list = (await db.listPruebas()).sort((a, b) => (b.updated || b.created || "").localeCompare(a.updated || a.created || "")); } catch (e) { /* sin base local */ }
  $("#reportList").innerHTML = `<button class="rep" type="button" data-sample><b>Prueba de ejemplo</b><span class="hint">Motor de 25 HP, 12 hilos, datos ficticios</span></button>` +
    (list.length ? list.map(r => `<button class="rep" type="button" data-open="${esc(r.uuid)}"><b>${esc(r.v.tag || "Sin TAG")} · ${esc(r.v.cliente || "Sin cliente")}</b><span class="hint">${esc(r.v.fecha || "")} · ${esc(r.v.hp ? r.v.hp + " HP" : "")} ${esc(r.v.hilos ? r.v.hilos + " hilos" : "")} · ${esc(r.v.dictamen || "sin dictamen")}${!S.sample && r.uuid === S.uuid ? " · abierta" : ""}</span></button>`).join("") : `<p class="hint">Aún no hay pruebas guardadas en este equipo.</p>`);
  $("#version").textContent = "Versión " + VERSION;
}

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

let pdfBusy = false;
async function makePDF() {
  if (pdfBusy) return;
  if (!window.jspdf) { toast("No cargó el generador de PDF. Abre la app una vez con conexión"); return; }
  pdfBusy = true; toast("Generando informe…");
  try {
    const fotos = {};
    for (const [paso, ids] of Object.entries(S.photos)) {
      fotos[paso] = [];
      for (const id of ids) if (blobs.has(id)) { try { fotos[paso].push(await aDataURL(blobs.get(id), 1000, 0.7)); } catch (e) { /* foto ilegible */ } }
    }
    const { nombre, blob } = generarPDF(S, fotos);
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
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); // pide que el navegador no borre los datos
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
