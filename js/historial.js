// Historial de un motor: tendencia de IR a 40 °C, PI y desbalance de resistencia entre pruebas.
// Tres gráficas pequeñas, una medida por gráfica (nunca dos escalas en un mismo eje), y una tabla
// con los mismos datos. SVG hecho a mano: sin librerías, funciona sin conexión una vez cargado.
// Los umbrales dibujados son los mismos de js/evaluadores.js; si cambian allá, cambian aquí.
import { pedir } from "./api.js";

const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = v => (typeof v === "number" && isFinite(v) ? v : null);
const fmt = (v, d = 2) => v == null ? "s/d" : Number(v).toFixed(d);
const fechaTxt = f => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : "sin fecha"; };
const dia = f => { const t = Date.parse((f || "") + "T00:00:00Z"); return isNaN(t) ? null : t / 864e5; };

export async function cargarHistorial(v) {
  const q = (v.serie || "").trim() || (v.tag || "").trim();
  if (!q) return null;
  const porTag = !(v.serie || "").trim();
  return pedir("GET", "/motores/historial?q=" + encodeURIComponent(q) + (porTag && v.cliente ? "&cliente=" + encodeURIComponent(v.cliente) : ""));
}

// Una gráfica de líneas. series: [{ nombre, clase, puntos: [{ x, y, tip }] }]; umbrales: [{ y, txt }]
function grafica({ titulo, unidad, series, umbrales = [], log = false, dec = 2 }) {
  const W = 328, H = 176, L = 40, R = 52, T = 12, B = 26;
  const pts = series.flatMap(s => s.puntos);
  if (!pts.length) return `<figure class="graf"><figcaption>${esc(titulo)}</figcaption><p class="hint">Ninguna prueba registró este valor.</p></figure>`;
  const xs = pts.map(p => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = x => x1 === x0 ? L + (W - L - R) / 2 : L + (x - x0) / (x1 - x0) * (W - L - R);
  const ys = [...pts.map(p => p.y), ...umbrales.map(u => u.y)];
  let Y, marcas;
  if (log) {
    const lo = Math.floor(Math.log10(Math.max(0.1, Math.min(...ys)))), hi = Math.ceil(Math.log10(Math.max(...ys)) + 1e-9) || lo + 1;
    const a = lo, b = Math.max(hi, lo + 1);
    Y = y => T + (1 - (Math.log10(Math.max(y, Math.pow(10, a))) - a) / (b - a)) * (H - T - B);
    marcas = Array.from({ length: b - a + 1 }, (_, i) => Math.pow(10, a + i));
  } else {
    const max = Math.max(...ys) * 1.15 || 1, paso = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].find(p => max / p <= 5) || Math.ceil(max / 5);
    Y = y => T + (1 - y / max) * (H - T - B);
    marcas = []; for (let m = 0; m <= max + 1e-9; m += paso) marcas.push(+m.toFixed(6));
  }
  const tick = m => m >= 1000 ? (m / 1000) + "k" : String(m);
  let g = "";
  for (const m of marcas) g += `<line class="rej" x1="${L}" x2="${W - R}" y1="${Y(m).toFixed(1)}" y2="${Y(m).toFixed(1)}"/><text class="eje" x="${L - 5}" y="${(Y(m) + 3.5).toFixed(1)}" text-anchor="end">${tick(m)}</text>`;
  // fechas del primer y último punto en el eje x
  const fx = [...new Map(pts.map(p => [p.x, p.fecha])).entries()].sort((a, b) => a[0] - b[0]);
  if (fx.length) g += `<text class="eje" x="${X(fx[0][0]).toFixed(1)}" y="${H - 8}" text-anchor="${fx.length > 1 ? "start" : "middle"}">${esc(fx[0][1])}</text>`;
  if (fx.length > 1) g += `<text class="eje" x="${X(fx[fx.length - 1][0]).toFixed(1)}" y="${H - 8}" text-anchor="end">${esc(fx[fx.length - 1][1])}</text>`;
  for (const u of umbrales) g += `<line class="umb" x1="${L}" x2="${W - R}" y1="${Y(u.y).toFixed(1)}" y2="${Y(u.y).toFixed(1)}"/><text class="eje umbtxt" x="${L + 4}" y="${(Y(u.y) - 4).toFixed(1)}">${esc(u.txt)}</text>`;
  let finales = [];
  series.forEach(s => {
    const p = [...s.puntos].sort((a, b) => a.x - b.x); if (!p.length) return;
    if (p.length > 1) g += `<polyline class="lin ${s.clase}" points="${p.map(q => X(q.x).toFixed(1) + "," + Y(q.y).toFixed(1)).join(" ")}"/>`;
    for (const q of p) g += `<circle class="pto ${s.clase}" cx="${X(q.x).toFixed(1)}" cy="${Y(q.y).toFixed(1)}" r="4.5"/><circle class="toca" cx="${X(q.x).toFixed(1)}" cy="${Y(q.y).toFixed(1)}" r="15" tabindex="0" data-tip="${esc(q.tip)}"/>`;
    const u = p[p.length - 1]; finales.push({ y: Y(u.y), txt: fmt(u.y, dec), x: X(u.x) });
  });
  // etiqueta directa del último valor de cada serie, en el margen derecho; se separan si chocan.
  // Las etiquetas de los umbrales van dentro del área, a la izquierda, para no pisarse con estas.
  finales.sort((a, b) => a.y - b.y);
  for (let i = 1; i < finales.length; i++) if (finales[i].y - finales[i - 1].y < 12) finales[i].y = finales[i - 1].y + 12;
  for (const f of finales) g += `<text class="val" x="${(f.x + 9).toFixed(1)}" y="${(f.y + 4).toFixed(1)}">${esc(f.txt)}</text>`;
  const leyenda = series.length > 1 ? `<div class="ley">${series.map(s => `<span><i class="${s.clase}"></i>${esc(s.nombre)}</span>`).join("")}</div>` : "";
  return `<figure class="graf"><figcaption>${esc(titulo)} <span class="hint">${esc(unidad)}</span></figcaption>${leyenda}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}: ${pts.length} lecturas. Los valores están en la tabla de abajo.">${g}</svg></figure>`;
}

// HTML completo del historial. `actual` es la prueba abierta (para el mínimo de PI según la clase y para marcarla).
export function historialHTML(datos, actual) {
  const pruebas = (datos.pruebas || []).filter(p => p.resumen);
  const m = (datos.motores || [])[0];
  if (!pruebas.length) return `<p>No hay pruebas de este motor en el servidor${datos.consulta ? ` (búsqueda: <b>${esc(datos.consulta)}</b>)` : ""}. El historial se arma con las pruebas ya sincronizadas que tengan el mismo número de serie, o el mismo TAG y cliente.</p>`;
  const minPI = actual.v.clase === "A" ? 1.5 : 2.0;
  const tip = (p, txt) => `${fechaTxt(p.fecha)} · ${txt}${p.uuid === actual.uuid ? " · esta prueba" : ""} · ${p.tecnico || ""}${p.estado === "borrador" ? " · sin cerrar" : ""}`;
  const serie = (clase, nombre, valor, texto) => ({ clase, nombre, puntos: pruebas.map(p => ({ p, y: n(valor(p.resumen)) })).filter(q => q.y != null && dia(q.p.fecha) != null)
    .map(q => ({ x: dia(q.p.fecha), y: q.y, fecha: fechaTxt(q.p.fecha), tip: tip(q.p, texto(q.y)) })) });
  const res = i => r => (r.resistencia && r.resistencia[i] ? r.resistencia[i].desbalance : null);
  const doceHilos = pruebas.some(p => p.resumen.resistencia && p.resumen.resistencia[1]);
  let h = `<p><b>${esc([m && m.tag, m && m.cliente].filter(Boolean).join(" · ") || "Motor")}</b><br><span class="hint">${esc([m && m.serie && "Serie " + m.serie, m && [m.fabricante, m.modelo].filter(Boolean).join(" "), m && m.hp && m.hp + " HP"].filter(Boolean).join(" · "))} · ${pruebas.length} prueba(s)</span></p>`;
  if (pruebas.length === 1) h += `<p class="hint">Solo hay una prueba: la tendencia aparece a partir de la segunda.</p>`;
  h += grafica({ titulo: "Resistencia de aislamiento a 40 °C", unidad: "MΩ, escala logarítmica", log: true, dec: 0,
    series: [serie("s1", "IR 1 min", r => r.ir1_40c ?? r.ir1, y => fmt(y, 0) + " MΩ")], umbrales: [{ y: 5, txt: "mín. 5" }, { y: 100, txt: "100" }] });
  h += grafica({ titulo: "Índice de polarización", unidad: "R10/R1",
    series: [serie("s1", "PI", r => r.pi, y => "PI " + fmt(y))], umbrales: [{ y: minPI, txt: "mín. " + minPI }] });
  h += grafica({ titulo: "Desbalance de resistencia de devanados", unidad: "%",
    series: [serie("s1", doceHilos ? "T1-T6" : "Devanados", res(0), y => fmt(y) + " %"), ...(doceHilos ? [serie("s2", "T7-T12", res(1), y => fmt(y) + " %")] : [])],
    umbrales: [{ y: 2, txt: "2 %" }, { y: 5, txt: "5 %" }] });
  h += `<div class="tabla-h"><table><thead><tr><th>Fecha</th><th>IR 40 °C</th><th>PI</th><th>DAR</th><th>Desb. R</th><th>Dictamen</th><th>Técnico</th></tr></thead><tbody>${
    [...pruebas].reverse().map(p => { const r = p.resumen, d = [res(0)(r), res(1)(r)].filter(x => x != null).map(x => fmt(x) + " %").join(" / ");
      return `<tr${p.uuid === actual.uuid ? ' class="esta"' : ""}><td>${esc(fechaTxt(p.fecha))}</td><td>${n(r.ir1_40c ?? r.ir1) != null ? fmt(r.ir1_40c ?? r.ir1, 0) + " MΩ" : "s/d"}</td><td>${fmt(n(r.pi))}</td><td>${fmt(n(r.dar))}</td><td>${d || "s/d"}</td><td>${esc(p.dictamen || (p.estado === "borrador" ? "sin cerrar" : "s/d"))}</td><td>${esc(p.tecnico || "")}</td></tr>`; }).join("")
  }</tbody></table></div><p class="hint">La fila resaltada es la prueba abierta. Toca un punto de la gráfica para ver su lectura. IR sin temperatura de devanado se muestra sin corregir.</p>`;
  return h;
}
