// Pruebas de los evaluadores, con los casos límite de cada umbral.
// Fijan el comportamiento portado del prototipo: si una prueba cambia de
// resultado, alguien movió un umbral.
import { test, igual, cierto } from "./mini.js";
import { evalTermo, evalVib, vibLimits, evalRes, evalIR, evalPI, evalRun, currentFLA, r40, num } from "../js/evaluadores.js";
import { textoPDF } from "../js/pdf.js";
import { STEPS, allEvals, suggested, stepChecks, stepFields } from "../js/protocolo.js";

const P = (v = {}, vib = false) => ({ v, vib });
const por = (lista, etiqueta) => lista.find(e => e.label.startsWith(etiqueta));
const estado = (lista, etiqueta) => por(lista, etiqueta)?.status;

/* ---------- num ---------- */
test("num: vacío, coma decimal y texto", () => {
  igual(num(""), null); igual(num(null), null); igual(num("abc"), null);
  igual(num("1,5"), 1.5); igual(num("2.0"), 2); igual(num(0), 0);
});

/* ---------- termografía ---------- */
for (const [dt, esp] of [[0, "ok"], [1, "ok"], [1.1, "warn"], [3, "warn"], [3.1, "warn"], [15, "warn"], [15.1, "fail"]])
  test(`termo: ΔT entre fases ${dt} °C → ${esp}`, () => igual(estado(evalTermo(P({ dtfases: dt })), "ΔT"), esp));

for (const [tb, esp] of [[40, "ok"], [40.1, "warn"], [50, "warn"], [50.1, "fail"]])
  test(`termo: bornes ${tb} °C con ambiente 30 → ${esp}`, () => igual(estado(evalTermo(P({ tamb: 30, tbornes: tb })), "Caja de bornes"), esp));

test("termo: bornes sin T ambiente no se evalúa", () => igual(por(evalTermo(P({ tbornes: 60 })), "Caja de bornes"), undefined));

for (const [ta, t, esp] of [[30, 70, "ok"], [30, 70.1, "warn"], [30, 80, "warn"], [30, 80.1, "fail"], [45, 80, "ok"], [45, 80.1, "warn"], [50, 95, "warn"], [50, 95.1, "fail"]])
  test(`termo: rodamiento ${t} °C con ambiente ${ta} → ${esp}`, () => igual(estado(evalTermo(P({ tamb: ta, tla: t })), "Rodamiento lado acople"), esp));

test("termo: rodamiento sin T ambiente usa solo límites absolutos", () => {
  igual(estado(evalTermo(P({ tloa: 80 })), "Rodamiento lado opuesto"), "ok");
  igual(estado(evalTermo(P({ tloa: 81 })), "Rodamiento lado opuesto"), "warn");
  igual(estado(evalTermo(P({ tloa: 96 })), "Rodamiento lado opuesto"), "fail");
});

// Clase F: 105 °C permitidos → ok < 75, warn < 95, fail ≥ 95 (elevación de carcasa)
for (const [cls, r, esp] of [["F", 74.9, "ok"], ["F", 75, "warn"], ["F", 94.9, "warn"], ["F", 95, "fail"], ["A", 29.9, "ok"], ["A", 30, "warn"], ["A", 50, "fail"], ["B", 49.9, "ok"], ["B", 70, "fail"], ["H", 94.9, "ok"], ["H", 115, "fail"]])
  test(`termo: carcasa clase ${cls}, elevación ${r} °C → ${esp}`, () => igual(estado(evalTermo(P({ tamb: 0, tcarc: r, clase: cls })), "Carcasa"), esp));

/* ---------- vibración ---------- */
test("vib: módulo desactivado → no aplicado", () => {
  const r = evalVib(P({ kw: 20, vla_h: 9 }, false));
  igual(r.length, 1); igual(r[0].status, "na"); igual(r[0].value, "no aplicado");
});
test("vib: sin potencia → s/d", () => igual(evalVib(P({ vla_h: 1 }, true))[0].status, "na"));
test("vib: activado sin lecturas → sin evaluación", () => igual(evalVib(P({ kw: 20 }, true)).length, 0));

test("vib: selección de norma por potencia y base", () => {
  igual(vibLimits(P({ kw: 14.99 })).std, "ISO 10816-1 clase I (<15 kW)");
  igual(vibLimits(P({ kw: 15 })).std, "ISO 20816-3 grupo 2, base rígida");
  igual(vibLimits(P({ kw: 15, base: "Flexible" })).std, "ISO 20816-3 grupo 2, base flexible");
  igual(vibLimits(P({ kw: 300 })).std, "ISO 20816-3 grupo 2, base rígida");
  igual(vibLimits(P({ kw: 300.1 })).std, "ISO 20816-3 grupo 1, base rígida");
  igual(vibLimits(P({ kw: 400, base: "Flexible" })).std, "ISO 20816-3 grupo 1, base flexible");
  igual(vibLimits(P({ hp: 20 })).std, "ISO 10816-1 clase I (<15 kW)", "20 HP = 14.92 kW");
  igual(vibLimits(P({ hp: 25 })).std, "ISO 20816-3 grupo 2, base rígida", "25 HP = 18.65 kW");
  igual(vibLimits(P({})), null);
});

const ZONAS = [
  ["clase I", { kw: 10 }, 0.71, 1.8, 4.5],
  ["grupo 2 rígida", { kw: 20, base: "Rígida" }, 1.4, 2.8, 4.5],
  ["grupo 2 flexible", { kw: 20, base: "Flexible" }, 2.3, 4.5, 7.1],
  ["grupo 1 rígida", { kw: 400, base: "Rígida" }, 2.3, 4.5, 7.1],
  ["grupo 1 flexible", { kw: 400, base: "Flexible" }, 3.5, 7.1, 11.0]
];
for (const [nombre, base, ab, bc, cd] of ZONAS) {
  const zona = mx => evalVib(P({ ...base, vla_h: 0.1, vloa_a: mx }, true))[0];
  test(`vib ${nombre}: fronteras A/B ${ab}, B/C ${bc}, C/D ${cd}`, () => {
    cierto(zona(ab).value.endsWith("zona A")); igual(zona(ab).status, "ok");
    cierto(zona(ab + 0.01).value.endsWith("zona B")); igual(zona(ab + 0.01).status, "ok");
    cierto(zona(bc).value.endsWith("zona B"));
    cierto(zona(bc + 0.01).value.endsWith("zona C")); igual(zona(bc + 0.01).status, "warn");
    cierto(zona(cd).value.endsWith("zona C"));
    cierto(zona(cd + 0.01).value.endsWith("zona D")); igual(zona(cd + 0.01).status, "fail");
  });
}
test("vib: toma la lectura máxima de los seis puntos", () => {
  const r = evalVib(P({ kw: 20, vla_h: 1, vla_v: 1, vla_a: 1, vloa_h: 1, vloa_v: 5, vloa_a: 1 }, true))[0];
  cierto(r.value.startsWith("5.00 mm/s")); igual(r.status, "fail");
});

/* ---------- resistencia de devanados ---------- */
test("res: menos de tres lecturas → sin evaluación", () => igual(evalRes(P({ hilos: "6", r1: 10, r2: 10 })).length, 0));
for (const [rs, esp] of [[[100, 100, 100], "ok"], [[99, 100, 101], "ok"], [[98.9, 100, 101.1], "warn"], [[97.5, 100, 102.5], "warn"], [[97.4, 100, 102.6], "fail"]])
  test(`res: 6 hilos ${rs.join("/")} Ω → ${esp}`, () => igual(estado(evalRes(P({ hilos: "6", r1: rs[0], r2: rs[1], r3: rs[2] })), "Desbalance de resistencia"), esp));

test("res: 12 hilos evalúa dos grupos por separado", () => {
  const r = evalRes(P({ hilos: "12", r1: 100, r2: 100, r3: 100, r4: 100, r5: 110, r6: 100 }));
  igual(estado(r, "Desbalance de resistencia (T1-T6)"), "ok");
  igual(estado(r, "Desbalance de resistencia (T7-T12)"), "fail");
});
test("res: 12 hilos con solo el primer grupo medido", () => {
  const r = evalRes(P({ hilos: "12", r1: 5, r2: 5, r3: 5 }));
  igual(r.length, 1); cierto(r[0].label.endsWith("(T1-T6)"));
});
test("res: corrección a 25 °C con cobre (234.5)", () => {
  const r = evalRes(P({ hilos: "6", twind: 40, r1: 10, r2: 10, r3: 10 }))[0];
  cierto(r.note.includes("a 25 °C: " + (10 * 259.5 / 274.5).toFixed(3) + " Ω"), r.note);
  cierto(!evalRes(P({ hilos: "6", r1: 10, r2: 10, r3: 10 }))[0].note.includes("25 °C"));
});
test("res: aviso de resolución 0.1 Ω con devanados menores a 1 Ω", () => {
  igual(estado(evalRes(P({ hilos: "6", r1: 0.62, r2: 0.63, r3: 0.62 })), "Resolución"), "warn");
  igual(por(evalRes(P({ hilos: "6", r1: 1, r2: 1, r3: 1 })), "Resolución"), undefined);
});

/* ---------- resistencia de aislamiento ---------- */
test("r40: se duplica cada 10 °C", () => {
  igual(r40(P({ twind: 40 }), 100), 100);
  igual(r40(P({ twind: 30 }), 100), 50);
  igual(r40(P({ twind: 50 }), 100), 200);
  igual(r40(P({}), 100), null);
});
for (const [ir, esp] of [[100, "ok"], [99.9, "warn"], [5, "warn"], [4.9, "fail"]])
  test(`IR: ${ir} MΩ a 40 °C → ${esp}`, () => igual(estado(evalIR(P({ twind: 40, ir1: ir })), "IR 1 min"), esp));

test("IR: el criterio se aplica al valor corregido", () => {
  igual(estado(evalIR(P({ twind: 30, ir1: 9.9 })), "IR 1 min"), "fail", "9.9 MΩ a 30 °C = 4.95 a 40 °C;");
  igual(estado(evalIR(P({ twind: 30, ir1: 10 })), "IR 1 min"), "warn");
  igual(estado(evalIR(P({ twind: 50, ir1: 50 })), "IR 1 min"), "ok", "50 MΩ a 50 °C = 100 a 40 °C;");
});
test("IR: sin T devanado usa la lectura sin corregir y lo avisa", () => {
  const r = evalIR(P({ ir1: 100 }));
  igual(estado(r, "IR 1 min"), "ok"); igual(estado(r, "Corrección por temperatura"), "na");
});
test("IR: fase-fase con el mismo mínimo", () => {
  const r = evalIR(P({ twind: 40, irab: 100, irbc: 5, irca: 4.9 }));
  igual(estado(r, "IR fase-fase A-B"), "ok"); igual(estado(r, "IR fase-fase B-C"), "warn"); igual(estado(r, "IR fase-fase C-A"), "fail");
});

/* ---------- PI y DAR ---------- */
for (const [cls, pi, esp] of [["F", 2.0, "ok"], ["F", 1.99, "warn"], ["B", 2.0, "ok"], ["H", 1.99, "warn"], ["F", 1.0, "warn"], ["F", 0.99, "fail"], ["A", 1.5, "ok"], ["A", 1.49, "warn"], ["A", 0.99, "fail"]])
  test(`PI: clase ${cls}, PI ${pi} → ${esp}`, () => igual(estado(evalPI(P({ clase: cls, pi })), "Índice de polarización"), esp));

test("PI: no concluyente si IR a 40 °C > 5000 MΩ", () => {
  const alto = por(evalPI(P({ clase: "F", pi: 1.2, ir1: 5001, twind: 40 })), "Índice");
  igual(alto.status, "ok"); cierto(alto.note.includes("no concluyente"));
  igual(estado(evalPI(P({ clase: "F", pi: 1.2, ir1: 5000, twind: 40 })), "Índice"), "warn", "5000 exacto no aplica;");
  igual(estado(evalPI(P({ clase: "F", pi: 1.2, ir1: 6000, twind: 30 })), "Índice"), "warn", "6000 a 30 °C = 3000 a 40 °C;");
});
for (const [dar, esp, nota] of [[1.6, "ok", "Excelente"], [1.59, "ok", "Aceptable"], [1.25, "ok", "Aceptable"], [1.24, "warn", "Cuestionable"], [1.0, "warn", "Cuestionable"], [0.99, "fail", "Deficiente"]])
  test(`DAR ${dar} → ${esp} (${nota})`, () => { const r = por(evalPI(P({ dar })), "DAR"); igual(r.status, esp); cierto(r.note.startsWith(nota), r.note); });

/* ---------- arranque ---------- */
for (const [vs, esp] of [[[200, 200, 200], "ok"], [[198, 200, 202], "ok"], [[197.9, 200, 202.1], "warn"], [[190, 200, 210], "warn"], [[189, 200, 211], "fail"]])
  test(`arranque: voltajes ${vs.join("/")} V → desbalance ${esp}`, () => igual(estado(evalRun(P({ vab: vs[0], vbc: vs[1], vca: vs[2] })), "Desbalance de voltaje"), esp));

test("arranque: desbalance de voltaje exacto en 1 % y 5 %", () => {
  igual(por(evalRun(P({ vab: 198, vbc: 200, vca: 202 })), "Desbalance de voltaje").value, "1.00 %");
  igual(por(evalRun(P({ vab: 190, vbc: 200, vca: 210 })), "Desbalance de voltaje").value, "5.00 %");
});
for (const [v, esp] of [[220, "ok"], [221, "fail"], [180, "ok"], [179, "fail"], [200, "ok"]])
  test(`arranque: ${v} V con nominal 200 V → ${esp}`, () => igual(estado(evalRun(P({ vserv: 200, vab: v, vbc: v, vca: v })), "Voltaje vs. nominal"), esp));

test("arranque: sin voltaje de servicio no compara con nominal", () => igual(por(evalRun(P({ vab: 460, vbc: 460, vca: 460 })), "Voltaje vs."), undefined));
test("arranque: faltando una fase no evalúa", () => igual(evalRun(P({ vab: 460, vbc: 460, ia: 10, ib: 10 })).length, 0));

for (const [is, esp] of [[[100, 100, 100], "ok"], [[95, 100, 105], "ok"], [[94, 100, 106], "warn"], [[90, 100, 110], "warn"], [[89, 100, 111], "fail"]])
  test(`arranque: corrientes ${is.join("/")} A → desbalance ${esp}`, () => igual(estado(evalRun(P({ ia: is[0], ib: is[1], ic: is[2] })), "Desbalance de corriente"), esp));

for (const [i, esp] of [[100, "ok"], [100.1, "warn"], [125, "warn"], [125.1, "fail"]])
  test(`arranque: ${i} A con placa 100 A y FS 1.25 → ${esp}`, () => igual(estado(evalRun(P({ aplaca: "100", fs: "1.25", ia: i, ib: i, ic: i })), "Corriente máx."), esp));

test("arranque: sin FS se asume 1.0", () => igual(estado(evalRun(P({ aplaca: "100", ia: 100.1, ib: 100, ic: 100 })), "Corriente máx."), "fail"));

/* ---------- corriente de placa ---------- */
test("currentFLA: placa de doble voltaje", () => {
  igual(currentFLA(P({ vplaca: "230/460", aplaca: "60/30", vserv: "460" })), 30);
  igual(currentFLA(P({ vplaca: "230/460", aplaca: "60/30", vserv: "230" })), 60);
  igual(currentFLA(P({ vplaca: "230/460", aplaca: "60/30", vserv: "480" })), 30, "toma el voltaje más cercano;");
  igual(currentFLA(P({ vplaca: "230/460", aplaca: "60/30", vserv: "208" })), 60);
});
test("currentFLA: casos simples", () => {
  igual(currentFLA(P({})), null);
  igual(currentFLA(P({ vplaca: "460", aplaca: "30" })), 30);
  igual(currentFLA(P({ vplaca: "460", aplaca: "60/30" })), 60, "un solo voltaje: primera corriente;");
  igual(currentFLA(P({ vplaca: "230/460", aplaca: "60/30" })), 30, "sin voltaje de servicio: la menor;");
  igual(currentFLA(P({ vplaca: "230/460", aplaca: "60,5/30,2", vserv: "230" })), 60.5);
});
// Corregido el 2026-11-23: el prototipo devolvía 30 A a 230 V con esta placa.
test("currentFLA: placa con rango 208-230/460", () => {
  const pl = (aplaca, vserv) => currentFLA(P({ vplaca: "208-230/460", aplaca, vserv }));
  igual(pl("60/30", "230"), 60); igual(pl("60/30", "208"), 60); igual(pl("60/30", "220"), 60);
  igual(pl("60/30", "460"), 30); igual(pl("60/30", "480"), 30);
  igual(pl("62-60/30", "208"), 62, "una corriente por voltaje del rango;");
  igual(pl("62-60/30", "230"), 60); igual(pl("62-60/30", "460"), 30);
  igual(pl("60/30", ""), 30, "sin voltaje de servicio: la menor;");
});
test("currentFLA: guion como separador de niveles cuando no hay barra", () => {
  igual(currentFLA(P({ vplaca: "230-460", aplaca: "60-30", vserv: "230" })), 60);
  igual(currentFLA(P({ vplaca: "230-460", aplaca: "60-30", vserv: "460" })), 30);
});
test("arranque: 55 A a 230 V con placa 208-230/460 · 60/30 A queda dentro de la nominal", () =>
  igual(estado(evalRun(P({ vplaca: "208-230/460", aplaca: "60/30", vserv: "230", ia: 55, ib: 55, ic: 55 })), "Corriente máx."), "ok"));

/* ---------- texto del informe PDF ---------- */
test("textoPDF: sustituye los símbolos que Helvetica no tiene", () => {
  igual(textoPDF("ΔT entre conexiones similares"), "Delta T entre conexiones similares");
  igual(textoPDF("850 MΩ · 425 MΩ a 40 °C"), "850 Mohm · 425 Mohm a 40 °C");
  igual(textoPDF("Promedio 0.623 Ω"), "Promedio 0.623 ohm");
  igual(textoPDF("≤5 % normal"), "<= 5 % normal");
  igual(textoPDF("Delta (Δ)"), "Delta (D)");
  igual(textoPDF("ΔΔ paralelo, bajo voltaje"), "Delta-Delta paralelo, bajo voltaje");
  igual(textoPDF("Δ serie, alto voltaje"), "Delta serie, alto voltaje");
  igual(textoPDF("pintura ≈ 0.95"), "pintura aprox. 0.95");
  igual(textoPDF("±10 % · N.º · FLA × FS · °C · ñ á"), "±10 % · N.º · FLA × FS · °C · ñ á", "Latin-1 no se toca;");
  igual(textoPDF(null), "");
});
test("textoPDF: ningún texto del protocolo ni de los evaluadores queda fuera de Latin-1", () => {
  const p = P({ tamb: 30, tbornes: 45, tla: 60, tcarc: 60, clase: "F", dtfases: 2, kw: 20, vla_h: 1, hilos: "12", twind: 30, r1: .6, r2: .6, r3: .6, r4: .6, r5: .6, r6: .6,
    ir1: 850, irab: 900, pi: 2.5, dar: 1.4, vab: 460, vbc: 461, vca: 462, vserv: 460, ia: 20, ib: 21, ic: 20, aplaca: "30" }, true);
  const textos = [...allEvals(p).flatMap(e => [e.label, e.value, e.note]), ...STEPS.flatMap(s => [s.title, s.norma, ...stepChecks(s, p), ...stepFields(s, p).flatMap(f => [f[1], typeof f[3] === "string" ? f[3] : ""])])];
  for (const t of textos) cierto(!/[^\u0000-ÿ]|\?/.test(textoPDF(t).replace(/¿[^?]*\?/g, "")), "queda fuera de Latin-1: " + t);
});

/* ---------- protocolo ---------- */
test("protocolo: 15 pasos con identificadores únicos", () => {
  igual(STEPS.length, 15);
  igual(new Set(STEPS.map(s => s.id)).size, 15);
});
test("protocolo: continuidad y resistencias según hilos", () => {
  const term = STEPS.find(s => s.id === "terminales"), res = STEPS.find(s => s.id === "resistencia");
  igual(stepChecks(term, P({ hilos: "6" })).length, 3 + 2);
  igual(stepChecks(term, P({ hilos: "12" })).length, 6 + 2);
  igual(stepFields(res, P({ hilos: "6" })).length, 1 + 3);
  igual(stepFields(res, P({ hilos: "12" })).length, 1 + 6);
});
test("dictamen sugerido: peor estado de todos los criterios", () => {
  igual(suggested(P({})), "", "solo 'no aplicado' no sugiere nada;");
  igual(suggested(P({ clase: "F", pi: 2.5 })), "Apto para operar");
  igual(suggested(P({ clase: "F", pi: 2.5, dar: 1.1 })), "Apto con observaciones");
  igual(suggested(P({ clase: "F", pi: 2.5, dar: 1.1, twind: 40, ir1: 2 })), "No apto");
});
test("allEvals: cada resultado lleva el título de su paso", () => {
  const ev = allEvals(P({ clase: "F", pi: 2.5, dtfases: 1 }));
  cierto(ev.some(e => e.step === "Termografía y temperaturas"));
  cierto(ev.some(e => e.step === "Índice de polarización y DAR"));
  cierto(ev.some(e => e.step === "Vibración" && e.status === "na"));
});
