// Evaluadores de criterios de aceptación.
// Portados del prototipo sin cambiar fórmulas, umbrales ni textos.
// Única diferencia: reciben la prueba `p` ({ v: valores, vib: bool }) como
// parámetro en lugar de leer un estado global, para poder probarlos sin DOM.
// NO cambiar umbrales sin aprobación de ISELEC.
import { WINDINGS, CLASS_RISE } from "./conexiones.js";

export const num = v => {
  if (v === "" || v == null) return null;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
};
export const fmt = (n, d = 2) => n == null ? "s/d" : Number(n).toFixed(d);

const E = (label, value, status, note) => ({ label, value, status, note });

export function evalTermo(p) {
  const g = id => p.v[id];
  const out = [], ta = num(g("tamb"));
  const dt = num(g("dtfases"));
  if (dt != null) {
    let st = dt <= 1 ? "ok" : dt <= 3 ? "warn" : dt <= 15 ? "warn" : "fail";
    const note = dt <= 1 ? "Sin anomalía" : dt <= 3 ? "Posible deficiencia, investigar (NETA 1-3 °C)" : dt <= 15 ? "Deficiencia probable, reparar cuando sea posible (NETA 4-15 °C)" : "Discrepancia mayor, reparar de inmediato (NETA >15 °C)";
    out.push(E("ΔT entre conexiones similares", fmt(dt, 1) + " °C", st, note));
  }
  const tb = num(g("tbornes"));
  if (tb != null && ta != null) {
    const r = tb - ta; const st = r <= 10 ? "ok" : r <= 20 ? "warn" : "fail";
    out.push(E("Caja de bornes sobre ambiente", fmt(r, 1) + " °C", st, r <= 10 ? "Dentro de 10 °C sobre ambiente; revisar solo si hay punto caliente localizado" : r <= 20 ? "NETA 11-20 °C: deficiencia probable" : "NETA >20 °C: monitorear o reparar según magnitud"));
  }
  for (const [id, nm] of [["tla", "Rodamiento lado acople"], ["tloa", "Rodamiento lado opuesto"]]) {
    const t = num(g(id)); if (t == null) continue;
    const r = ta != null ? t - ta : null;
    let st = "ok"; if ((r != null && r > 40) || t > 80) st = "warn"; if ((r != null && r > 50) || t > 95) st = "fail";
    out.push(E(nm, fmt(t, 1) + " °C", st, (r != null ? "Elevación " + fmt(r, 1) + " °C. " : "") + "Criterio práctico: alerta >40 °C sobre ambiente u 80 °C; falla >50 °C u 95 °C"));
  }
  const tc = num(g("tcarc")), cls = g("clase");
  if (tc != null && ta != null && CLASS_RISE[cls]) {
    const r = tc - ta, lim = CLASS_RISE[cls];
    const st = r < lim - 30 ? "ok" : r < lim - 10 ? "warn" : "fail";
    out.push(E("Carcasa sobre ambiente", fmt(r, 1) + " °C", st, "Clase " + cls + ": elevación de devanado permitida " + lim + " °C (NEMA MG-1). La superficie está 10-30 °C por debajo del devanado; indicativo"));
  }
  return out;
}

export function vibLimits(p) {
  const g = id => p.v[id];
  const kw = num(g("kw")) ?? (num(g("hp")) != null ? num(g("hp")) * 0.746 : null);
  const flex = g("base") === "Flexible";
  if (kw == null) return null;
  if (kw < 15) return { std: "ISO 10816-1 clase I (<15 kW)", ab: 0.71, bc: 1.8, cd: 4.5 };
  if (kw <= 300) return flex ? { std: "ISO 20816-3 grupo 2, base flexible", ab: 2.3, bc: 4.5, cd: 7.1 } : { std: "ISO 20816-3 grupo 2, base rígida", ab: 1.4, bc: 2.8, cd: 4.5 };
  return flex ? { std: "ISO 20816-3 grupo 1, base flexible", ab: 3.5, bc: 7.1, cd: 11.0 } : { std: "ISO 20816-3 grupo 1, base rígida", ab: 2.3, bc: 4.5, cd: 7.1 };
}

export function evalVib(p) {
  const g = id => p.v[id];
  if (!p.vib) return [E("Módulo de vibración", "no aplicado", "na", "Se activará cuando ISELEC cuente con equipo")];
  const L = vibLimits(p); if (!L) return [E("Límites", "s/d", "na", "Ingresa la potencia en datos de placa")];
  const ids = ["vla_h", "vla_v", "vla_a", "vloa_h", "vloa_v", "vloa_a"];
  const vals = ids.map(i => num(g(i))).filter(v => v != null);
  if (!vals.length) return [];
  const mx = Math.max(...vals);
  const zone = mx <= L.ab ? "A" : mx <= L.bc ? "B" : mx <= L.cd ? "C" : "D";
  const st = zone === "A" || zone === "B" ? "ok" : zone === "C" ? "warn" : "fail";
  const txt = { A: "Zona A: máquina nueva o recién reparada", B: "Zona B: aceptable para operación prolongada", C: "Zona C: no apta para operación prolongada, programar corrección", D: "Zona D: severidad que puede causar daño" }[zone];
  return [E("Velocidad máx. RMS (10-1000 Hz)", fmt(mx, 2) + " mm/s · zona " + zone, st, txt + ". " + L.std + ": A/B " + L.ab + ", B/C " + L.bc + ", C/D " + L.cd + " mm/s")];
}

export function evalRes(p) {
  const g = id => p.v[id];
  const w = WINDINGS[g("hilos")] || WINDINGS["6"];
  const vals = w.map((_, i) => num(g("r" + (i + 1))));
  const have = vals.filter(v => v != null);
  if (have.length < 3) return [];
  const out = [];
  const tw = num(g("twind"));
  const groups = g("hilos") === "12" ? [[0, 1, 2], [3, 4, 5]] : [[0, 1, 2]];
  groups.forEach((gr, k) => {
    const xs = gr.map(i => vals[i]).filter(v => v != null); if (xs.length < 3) return;
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length, dev = (Math.max(...xs) - Math.min(...xs)) / avg * 100;
    const st = dev <= 2 ? "ok" : dev <= 5 ? "warn" : "fail";
    out.push(E("Desbalance de resistencia" + (groups.length > 1 ? (k ? " (T7-T12)" : " (T1-T6)") : ""), fmt(dev, 2) + " %", st,
      (dev <= 2 ? "Dentro de 2 %" : dev <= 5 ? "Entre 2 y 5 %: revisar conexiones y puntos de medición" : "Mayor a 5 %: posible espira en corto, conexión floja o error de conexión") + ". Promedio " + fmt(avg, 3) + " Ω" + (tw != null ? " · a 25 °C: " + fmt(avg * (234.5 + 25) / (234.5 + tw), 3) + " Ω" : "")));
  });
  if (have.some(v => v < 1)) out.push(E("Resolución del instrumento", "devanado < 1 Ω", "warn", "Con devanados menores a 1 Ω, un instrumento con resolución de 0.1 Ω no da un desbalance confiable: usar micro-ohmímetro (método de 4 hilos)"));
  return out;
}

// Corrección de resistencia de aislamiento a 40 °C (IEEE 43): se duplica cada 10 °C
export function r40(p, v) {
  const tw = num(p.v.twind);
  if (v == null || tw == null) return null;
  return v * Math.pow(0.5, (40 - tw) / 10);
}

export function evalIR(p) {
  const g = id => p.v[id];
  const out = []; const ir = num(g("ir1"));
  if (ir != null) {
    const c = r40(p, ir); const val = c ?? ir;
    const st = val >= 100 ? "ok" : val >= 5 ? "warn" : "fail";
    out.push(E("IR 1 min fases-tierra", fmt(ir, 0) + " MΩ" + (c != null ? " · " + fmt(c, 0) + " MΩ a 40 °C" : ""), st,
      val >= 100 ? "Cumple IEEE 43 (mín. 5 MΩ, devanado aleatorio <1 kV) con margen amplio" : val >= 5 ? "Cumple el mínimo de IEEE 43 (5 MΩ) pero es bajo: evaluar secado y tendencia" : "No cumple IEEE 43: no energizar. Limpiar, secar y repetir"));
    if (c == null) out.push(E("Corrección por temperatura", "falta T devanado", "na", "Ingresa la temperatura del devanado para corregir a 40 °C"));
  }
  for (const [id, nm] of [["irab", "IR fase-fase A-B"], ["irbc", "IR fase-fase B-C"], ["irca", "IR fase-fase C-A"]]) {
    const v = num(g(id)); if (v == null) continue; const c = r40(p, v) ?? v;
    out.push(E(nm, fmt(v, 0) + " MΩ", c >= 100 ? "ok" : c >= 5 ? "warn" : "fail", "Mismo mínimo que fases-tierra"));
  }
  return out;
}

export function evalPI(p) {
  const g = id => p.v[id];
  const out = []; const pi = num(g("pi")), dar = num(g("dar")), ir = num(g("ir1"));
  const minPI = g("clase") === "A" ? 1.5 : 2.0;
  if (pi != null) {
    let st = pi >= minPI ? "ok" : pi >= 1.0 ? "warn" : "fail", note = pi >= minPI ? "Cumple IEEE 43 (mín. " + minPI + " para clase " + g("clase") + ")" : pi >= 1 ? "Bajo el mínimo IEEE 43: humedad o contaminación probable" : "PI < 1: aislamiento deteriorado, no energizar";
    if (ir != null && (r40(p, ir) ?? ir) > 5000) { st = "ok"; note = "IR 1 min > 5000 MΩ: IEEE 43 considera el PI no concluyente; el valor se registra como informativo"; }
    out.push(E("Índice de polarización (10/1 min)", fmt(pi, 2), st, note));
  }
  if (dar != null) {
    const st = dar >= 1.25 ? "ok" : dar >= 1.0 ? "warn" : "fail";
    out.push(E("DAR (60/30 s)", fmt(dar, 2), st, dar >= 1.6 ? "Excelente (>1.6)" : dar >= 1.25 ? "Aceptable (1.25-1.6)" : dar >= 1 ? "Cuestionable (1.0-1.25)" : "Deficiente (<1.0)"));
  }
  return out;
}

export function evalRun(p) {
  const g = id => p.v[id];
  const out = []; const vs = ["vab", "vbc", "vca"].map(i => num(g(i)));
  if (vs.every(v => v != null)) {
    const a = vs.reduce((x, y) => x + y, 0) / 3, u = Math.max(...vs.map(v => Math.abs(v - a))) / a * 100;
    out.push(E("Desbalance de voltaje", fmt(u, 2) + " %", u <= 1 ? "ok" : u <= 5 ? "warn" : "fail", (u <= 1 ? "Dentro de 1 %" : u <= 5 ? "Entre 1 y 5 %: aplicar factor de reducción de potencia (NEMA MG-1 14.36)" : "Mayor a 5 %: NEMA MG-1 no recomienda operar") + ". Promedio " + fmt(a, 1) + " V"));
    const vn = num(g("vserv")); if (vn) { const d = (a - vn) / vn * 100; out.push(E("Voltaje vs. nominal", fmt(d, 1) + " %", Math.abs(d) <= 10 ? "ok" : "fail", "NEMA MG-1 12.44: ±10 % del nominal")); }
  }
  const is = ["ia", "ib", "ic"].map(i => num(g(i)));
  if (is.every(v => v != null)) {
    const a = is.reduce((x, y) => x + y, 0) / 3, u = Math.max(...is.map(v => Math.abs(v - a))) / a * 100;
    out.push(E("Desbalance de corriente", fmt(u, 2) + " %", u <= 5 ? "ok" : u <= 10 ? "warn" : "fail", "Criterio práctico: ≤5 % normal, 5-10 % investigar, >10 % corregir. Suele ser 6 a 10 veces el desbalance de voltaje"));
    const fla = currentFLA(p), fs = num(g("fs")) || 1;
    if (fla) { const mx = Math.max(...is); out.push(E("Corriente máx. vs. placa", fmt(mx, 1) + " / " + fmt(fla, 1) + " A", mx <= fla ? "ok" : mx <= fla * fs ? "warn" : "fail", mx <= fla ? "Dentro de la corriente nominal" : mx <= fla * fs ? "Opera dentro del factor de servicio" : "Supera FLA × FS: sobrecarga")); }
  }
  return out;
}

// Niveles de una placa. "/" separa niveles (230/460) y, dentro de un nivel, "-" es un rango
// (208-230/460 son dos niveles: 208-230 y 460). Sin "/", el guion separa niveles (230-460).
function niveles(txt) {
  const s = String(txt || "");
  const grupos = s.includes("/") ? s.split("/").map(x => x.split("-")) : s.split("-").map(x => [x]);
  return grupos.map(gr => gr.map(num).filter(v => v != null)).filter(gr => gr.length);
}

// Corrección aprobada por ISELEC (2026-11-23): antes separaba por "/" y "-" a la vez y con
// placa 208-230/460 · 60/30 A devolvía 30 A a 230 V.
export function currentFLA(p) {
  const g = id => p.v[id];
  const A = niveles(g("aplaca")), V = niveles(g("vplaca"));
  const parts = A.flat(), vparts = V.flat();
  if (!parts.length) return null;
  if (parts.length === 1 || vparts.length < 2) return parts[0];
  const vs = num(g("vserv")); if (!vs) return Math.min(...parts);
  // nivel de voltaje de placa más cercano al de servicio
  let gi = 0, vi = 0;
  V.forEach((gr, i) => gr.forEach((v, j) => { if (Math.abs(v - vs) < Math.abs(V[gi][vi] - vs)) { gi = i; vi = j; } }));
  const ga = A[Math.min(gi, A.length - 1)];
  // corriente de ese nivel; si el nivel es un rango con una corriente por voltaje (62-60), la que corresponde;
  // si no se puede emparejar, la menor (criterio conservador para detectar sobrecarga)
  return ga.length === V[gi].length ? ga[vi] : ga.length === 1 ? ga[0] : Math.min(...ga);
}
