// Informe PDF generado en el teléfono con jsPDF + jspdf-autotable.
// Estructura portada del prototipo. `fotos` es { idPaso: [dataURL JPEG, ...] }.
import { STEPS, stepFields, stepChecks, allEvals, suggested } from "./protocolo.js";

export const folio = p => p.sample ? "EJEMPLO" : String(p.uuid || "").slice(0, 8).toUpperCase();

// La fuente Helvetica estándar del PDF solo cubre Latin-1: Δ, Ω, ≤ y similares salen
// como basura con las letras separadas. Se sustituyen solo en el informe; en pantalla no cambian.
export function textoPDF(s) {
  return String(s ?? "")
    .replace(/ΔΔ/g, "Delta-Delta").replace(/\(Δ\)/g, "(D)").replace(/Δ\s*/g, "Delta ")
    .replace(/MΩ/g, "Mohm").replace(/Ω/g, "ohm")
    .replace(/≤\s*/g, "<= ").replace(/≥\s*/g, ">= ").replace(/≈\s*/g, "aprox. ")
    .replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...")
    .replace(/[^\u0000-ÿ]/g, "?");
}
const limpia = filas => filas.map(f => f.map(textoPDF));

// Texto y color del recuadro de dictamen del encabezado
export function dictamenPDF(p) {
  const d = p.v.dictamen;
  if (!d) { const s = suggested(p); return { texto: "Dictamen: pendiente" + (s ? " (sugerido: " + s + ")" : ""), color: [90, 104, 118] }; }
  return { texto: "Dictamen: " + d, color: /No apto/.test(d) ? [179, 38, 30] : /observ/.test(d) ? [154, 100, 0] : [31, 122, 69] };
}

export function generarPDF(p, fotos = {}) {
  if (!window.jspdf) throw new Error("sin-jspdf");
  const g = id => p.v[id];
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "letter" });
  const texto = doc.text.bind(doc);
  doc.text = (t, ...resto) => texto(typeof t === "string" ? textoPDF(t) : t, ...resto);
  const W = doc.internal.pageSize.getWidth(), M = 14; let y = 16;
  const steel = [36, 56, 77], amber = [184, 110, 0];
  doc.setFillColor(...steel); doc.rect(0, 0, W, 24, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("ISELEC", M, 11);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text("Informe de prueba de motor de inducción", M, 17.5);
  doc.setFontSize(9); doc.text("Informe " + folio(p), W - M, 11, { align: "right" }); doc.text(String(g("fecha") || ""), W - M, 17.5, { align: "right" });
  if (p.sample) { doc.setTextColor(...amber); doc.setFont("helvetica", "bold"); doc.text("DATOS DE EJEMPLO", W / 2, 11, { align: "center" }); }
  doc.setTextColor(20); y = 32;
  const kv = rows => doc.autoTable({ startY: y, body: limpia(rows), theme: "grid", margin: { left: M, right: M }, styles: { fontSize: 8.5, cellPadding: 1.6 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 46, fillColor: [238, 241, 244] } } });
  const h2 = t => { if (y > 250) { doc.addPage(); y = 18; } doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...steel); doc.text(t, M, y); doc.setTextColor(20); doc.setFont("helvetica", "normal"); y += 2; };
  const after = () => { y = doc.lastAutoTable.finalY + 8; };

  // dictamen
  // El dictamen lo decide el técnico: si no lo ha elegido, el recuadro lo dice en gris
  // y muestra el sugerido solo como referencia, nunca como definitivo.
  const { texto: dict, color: col } = dictamenPDF(p);
  doc.setDrawColor(...col); doc.setLineWidth(0.8); doc.rect(M, y, W - 2 * M, 14);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...col); doc.text(dict, M + 4, y + 9);
  doc.setTextColor(20); y += 22;

  h2("Datos generales"); kv([["Cliente", g("cliente")], ["Ubicación", g("sitio")], ["TAG", g("tag")], ["Orden de trabajo", g("ot")], ["Técnico", g("tecnico")], ["Supervisor", g("supervisor")], ["Condiciones", `T amb ${g("tamb") || "s/d"} °C · HR ${g("hr") || "s/d"} %`]].map(r => [r[0], r[1] || ""])); after();
  h2("Datos de placa"); kv([["Fabricante / modelo", [g("fab"), g("modelo")].filter(Boolean).join(" ")], ["N.º de serie", g("serie")], ["Potencia", [g("hp") && g("hp") + " HP", g("kw") && g("kw") + " kW"].filter(Boolean).join(" / ")], ["Voltaje / corriente", `${g("vplaca") || ""} V · ${g("aplaca") || ""} A`], ["Velocidad / armazón", `${g("rpm") || ""} rpm · ${g("frame") || ""}`], ["FS / clase / diseño", `${g("fs") || ""} · ${g("clase") || ""} · ${g("diseno") || ""}`], ["Hilos / conexión", `${g("hilos")} hilos · ${g("conexion") || ""} · ${g("vserv") || ""} V`]].map(r => [r[0], r[1] || ""])); after();

  // resumen de evaluaciones
  const ev = allEvals(p);
  h2("Resultados y criterios de aceptación");
  doc.autoTable({ startY: y, head: [["Paso", "Prueba", "Resultado", "Estado", "Criterio / nota"]], body: limpia(ev.map(e => [e.step, e.label, e.value, { ok: "Cumple", warn: "Revisar", fail: "No cumple", na: "N/A" }[e.status], e.note || ""])),
    theme: "grid", margin: { left: M, right: M }, styles: { fontSize: 7.6, cellPadding: 1.4, valign: "top" }, headStyles: { fillColor: steel },
    columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 34 }, 2: { cellWidth: 28 }, 3: { cellWidth: 16, fontStyle: "bold" } },
    didParseCell: d => { if (d.section === "body" && d.column.index === 3) { const v = d.cell.raw; d.cell.styles.textColor = v === "Cumple" ? [31, 122, 69] : v === "Revisar" ? [154, 100, 0] : v === "No cumple" ? [179, 38, 30] : [90, 104, 118]; } } });
  after();

  // detalle por paso
  for (const st of STEPS) {
    // Los campos de orden, placa y dictamen ya salen en sus propias tablas;
    // de esos pasos aquí solo van observaciones y fotos (p. ej. la foto de la placa).
    const soloAnexos = st.id === "general" || st.id === "placa" || st.id === "dictamen";
    const fields = soloAnexos ? [] : stepFields(st, p).filter(f => p.v[f[0]] !== undefined && p.v[f[0]] !== "");
    const checks = stepChecks(st, p); const done = checks.filter((c, i) => p.c[st.id + "_" + i]).length;
    const obs = p.obs[st.id]; const ph = fotos[st.id] || [];
    if (st.optional && !p.vib) { h2(st.title); kv([["Estado", "No aplicado en esta prueba"]]); after(); continue; }
    if (!fields.length && !checks.length && !obs && !ph.length) continue;
    h2(st.title + (soloAnexos ? "  ·  observaciones y fotos" : st.norma ? "  ·  " + st.norma : ""));
    const rows = fields.map(f => [f[1] + (f[2] === "number" && f[3] ? " (" + f[3] + ")" : ""), String(p.v[f[0]])]);
    if (checks.length) rows.push(["Procedimiento", `${done} de ${checks.length} puntos verificados`]);
    const pend = checks.filter((c, i) => !p.c[st.id + "_" + i]); if (pend.length && pend.length < checks.length) rows.push(["Puntos no marcados", pend.join("; ")]);
    if (obs) rows.push(["Observaciones", obs]);
    if (rows.length) { kv(rows); after(); } else y += 4;
    if (ph.length) {
      let x = M; const sz = 58;
      if (y + sz > 265) { doc.addPage(); y = 18; }
      for (const f of ph) {
        if (x + sz > W - M) { x = M; y += sz + 4; if (y + sz > 265) { doc.addPage(); y = 18; } }
        try { const pr = doc.getImageProperties(f); const k = Math.min(sz / pr.width, sz / pr.height); doc.addImage(f, "JPEG", x, y, pr.width * k, pr.height * k); } catch (e) { /* imagen ilegible: se omite */ }
        x += sz + 4;
      }
      y += sz + 8;
    }
  }
  h2("Dictamen y recomendaciones");
  kv([["Dictamen", g("dictamen") || "No definido (sugerido: " + (suggested(p) || "s/d") + ")"], ["Recomendaciones", g("recom") || ""], ["Próxima prueba", g("proxima") || ""]]); after();
  if (y > 240) { doc.addPage(); y = 30; }
  y += 14; doc.setDrawColor(120); doc.setLineWidth(0.3);
  doc.line(M, y, M + 70, y); doc.line(W - M - 70, y, W - M, y); doc.setFontSize(8.5);
  doc.text("Técnico: " + (g("tecnico") || ""), M, y + 5); doc.text("Revisó: " + (g("supervisor") || ""), W - M - 70, y + 5);
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(110); doc.text(`Normas de referencia: NFPA 70E, IEEE 43-2013, NEMA MG-1, NETA MTS-2023, ISO 20816-3 · Página ${i} de ${n}`, W / 2, 272, { align: "center" }); }
  const nombre = `Informe-${(g("tag") || "motor").replace(/[^\w-]+/g, "_")}-${g("fecha") || ""}.pdf`;
  return { nombre, blob: doc.output("blob"), paginas: n };
}
