// Definición del protocolo de prueba (15 pasos). Textos portados del prototipo.
// Campos: [id, etiqueta, tipo, unidad u opciones, clase, ayuda]
// `extra` indica un bloque adicional que dibuja la interfaz: "diagrama", "reconexion" o "resumen".
import { WINDINGS } from "./conexiones.js";
import { evalTermo, evalVib, evalRes, evalIR, evalPI, evalRun } from "./evaluadores.js";

export const STEPS = [
  { id: "general", phase: "Preparación", title: "Datos de la orden", norma: "Registro general",
    intro: "Identifica el equipo y anota las condiciones ambientales. La humedad relativa y la temperatura afectan la lectura de aislamiento.",
    fields: [["cliente", "Cliente", "text", null, "wide"], ["sitio", "Ubicación / área", "text"], ["tag", "TAG del equipo", "text"], ["ot", "Orden de trabajo", "text"], ["fecha", "Fecha", "date"],
      ["tecnico", "Técnico", "text"], ["supervisor", "Supervisor", "text"], ["tamb", "T ambiente", "number", "°C"], ["hr", "Humedad relativa", "number", "%"]] },
  { id: "placa", phase: "Preparación", title: "Datos de placa y conexión", norma: "NEMA MG-1",
    intro: "Copia la placa completa y toma foto. Define con cuántos hilos sale el motor y con qué conexión va a operar al voltaje de servicio.",
    fields: [["fab", "Fabricante", "text"], ["modelo", "Modelo", "text"], ["serie", "N.º de serie", "text"], ["hp", "Potencia", "number", "HP"], ["kw", "Potencia", "number", "kW"],
      ["vplaca", "Voltaje de placa", "text", null, null, "Ej. 230/460"], ["aplaca", "Corriente de placa", "text", null, null, "Ej. 60/30"], ["rpm", "Velocidad", "number", "rpm"], ["frame", "Armazón (frame)", "text"],
      ["fs", "Factor de servicio", "number"], ["clase", "Clase de aislamiento", "select", ["A", "B", "F", "H"]], ["diseno", "Diseño NEMA", "select", ["", "A", "B", "C", "D"]],
      ["hilos", "Hilos de salida", "select", ["6", "12"]], ["conexion", "Conexión de servicio", "conn"], ["vserv", "Voltaje de servicio", "number", "V"]],
    extra: "diagrama" },
  { id: "seguridad", phase: "En operación", title: "Seguridad para mediciones en operación", norma: "NFPA 70E-2024, 110.5 y 130",
    intro: "La termografía y la vibración se toman con el motor en marcha y antes de desenergizar. Si se abre la caja de bornes o un tablero energizado, aplica el EPP del análisis de arco.",
    checks: ["Permiso de trabajo y análisis de riesgo firmados", "Etiqueta de arco del tablero/arrancador revisada (energía incidente y frontera)", "EPP de arco según etiqueta o tabla 130.7(C)(15) puesto y en buen estado", "Frontera de aproximación delimitada", "Guardas de partes rotativas instaladas; ropa y cabello sin riesgo de atrapamiento"],
    fields: [["epp", "Categoría EPP / energía incidente", "text"], ["frontera", "Frontera de arco", "text"]] },
  { id: "termo", phase: "En operación", title: "Termografía y temperaturas", norma: "NETA MTS-2023 tabla 100.18 · NEMA MG-1",
    intro: "Con el motor a carga estable al menos 30 minutos. Usa la cámara para ubicar puntos calientes y el termómetro IR para leer rodamientos y carcasa. Ajusta la emisividad (pintura ≈ 0.95; metal desnudo da lecturas falsas bajas).",
    checks: ["Emisividad y temperatura reflejada configuradas en la cámara", "Imagen de carcasa completa", "Imagen de caja de bornes y conexiones (si se puede abrir con seguridad)", "Imagen de alimentación en arrancador / VFD", "Rodamientos medidos con termómetro IR en el mismo punto de referencia"],
    fields: [["carga", "Carga aproximada", "number", "%"], ["tcarc", "T máx. carcasa", "number", "°C"], ["tla", "T rodamiento lado acople", "number", "°C"], ["tloa", "T rodamiento lado opuesto", "number", "°C"], ["tbornes", "T máx. caja de bornes", "number", "°C"], ["dtfases", "ΔT entre conexiones similares", "number", "°C", null, "Máx. menos mín. entre fases"]],
    evaluate: evalTermo },
  { id: "vibracion", phase: "En operación", title: "Vibración", norma: "ISO 20816-3:2022 · ISO 10816-1", optional: true,
    intro: "Velocidad RMS de 10 a 1000 Hz en las tapas de rodamiento, en tres ejes. Mismo punto marcado en cada inspección para comparar tendencia.",
    checks: ["Puntos marcados en tapas de rodamiento (LA y LOA)", "Sensor con base magnética sobre superficie plana y limpia", "Motor a velocidad y carga normales"],
    fields: [["base", "Tipo de base", "select", ["Rígida", "Flexible"]], ["vibequipo", "Equipo utilizado", "text"], ["vla_h", "LA horizontal", "number", "mm/s"], ["vla_v", "LA vertical", "number", "mm/s"], ["vla_a", "LA axial", "number", "mm/s"],
      ["vloa_h", "LOA horizontal", "number", "mm/s"], ["vloa_v", "LOA vertical", "number", "mm/s"], ["vloa_a", "LOA axial", "number", "mm/s"]],
    evaluate: evalVib },
  { id: "loto", phase: "Desenergizado", title: "Desenergización y bloqueo", norma: "NFPA 70E-2024, 120.5 · OSHA 1910.147",
    intro: "Establece la condición de trabajo eléctricamente segura antes de abrir la caja de bornes o desconectar cables.",
    checks: ["Motor detenido y fuentes identificadas (incluye VFD, capacitores de corrección y calefactores de espacio)", "Interruptor abierto y verificado visualmente", "Candado y etiqueta personales colocados", "Detector de tensión probado en fuente conocida antes y después (vivo-muerto-vivo)", "Ausencia de tensión verificada fase-fase y fase-tierra en bornes del motor", "Capacitores y VFD descargados; tiempo de espera del fabricante cumplido"],
    fields: [["bloqueo", "Punto de bloqueo", "text"], ["candado", "N.º de candado / etiqueta", "text"]] },
  { id: "limpieza", phase: "Desenergizado", title: "Limpieza", norma: "EASA AR100 · OSHA 1910.242(b)",
    intro: "Limpia antes de medir aislamiento: polvo húmedo y grasa en la caja de bornes bajan la lectura. Foto antes y después.",
    checks: ["Rejillas y aletas de carcasa libres de polvo y residuos", "Cubierta y aspas del ventilador limpias", "Caja de bornes limpia y seca, empaque en buen estado", "Aire comprimido seco a 30 psi máx. en boquilla, con careta (OSHA 1910.242(b))", "Solvente dieléctrico sin residuos; no usar agua a presión", "Drenajes de condensado destapados"],
    fields: [["metodo", "Método de limpieza", "select", ["Aire seco + brocha", "Aspiradora", "Solvente dieléctrico", "Combinado"]]] },
  { id: "inspeccion", phase: "Desenergizado", title: "Inspección mecánica y de bornes", norma: "NETA MTS-2023, 7.15.1",
    intro: "Inspección visual y manual con el motor bloqueado.",
    checks: ["Eje gira libre a mano, sin roce ni ruido de rodamiento", "Juego axial y radial normal", "Anclaje y pernos de base apretados; sin pata coja aparente", "Acople y alineación sin daño visible", "Cables de salida sin resequedad, grietas ni sobrecalentamiento", "Terminales y conectores sin corrosión; marcado legible", "Carcasa sin fisuras; placa legible; puesta a tierra conectada"],
    fields: [["estado_mec", "Estado general", "select", ["Bueno", "Regular", "Malo"]]] },
  { id: "terminales", phase: "Desenergizado", title: "Separación e identificación de hilos", norma: "NEMA MG-1 parte 2",
    intro: "Desconecta los hilos del motor de la alimentación y entre sí. Con 6 o 12 hilos separados se puede probar cada devanado y el aislamiento entre fases.",
    checksFn: p => (WINDINGS[p.v.hilos] || []).map(w => "Continuidad del devanado " + w),
    extraChecks: ["Hilos marcados con su número (T1 a T6 o T1 a T12) al separarlos", "Cables de alimentación aislados y fuera de alcance"] },
  { id: "resistencia", phase: "Desenergizado", title: "Resistencia de devanados", norma: "IEEE 118 · NETA MTS 7.15.1",
    intro: "Mide cada devanado entre sus dos extremos. Anota la temperatura del devanado (o la ambiente si el motor lleva horas parado) para corregir a 25 °C.",
    checks: ["Puntas en cero (resta la resistencia de las puntas)", "Mismo punto de contacto en cada terminal"],
    fieldsFn: p => [["twind", "T devanado", "number", "°C"], ...(WINDINGS[p.v.hilos] || []).map((w, i) => ["r" + (i + 1), "R " + w, "number", "Ω"])],
    evaluate: evalRes },
  { id: "aislamiento", phase: "Desenergizado", title: "Resistencia de aislamiento", norma: "IEEE 43-2013",
    intro: "Fluke 1587 FC a 500 V CC (IEEE 43 para devanados < 1000 V). Une todos los hilos y mide contra la carcasa a 1 minuto. Si los devanados están separados, mide también entre fases.",
    checks: ["Carcasa puesta a tierra; RTD y termistores a tierra", "Todos los hilos unidos para fases-tierra", "Superficie de bornes seca", "Descargar el devanado al terminar cada prueba (mín. 4 veces el tiempo de prueba)"],
    fields: [["vprueba", "Voltaje de prueba", "select", ["500", "1000", "250"]], ["twind", "T devanado", "number", "°C"], ["ir1", "IR 1 min fases-tierra", "number", "MΩ"], ["irab", "IR A-B", "number", "MΩ"], ["irbc", "IR B-C", "number", "MΩ"], ["irca", "IR C-A", "number", "MΩ"]],
    evaluate: evalIR },
  { id: "pi", phase: "Desenergizado", title: "Índice de polarización y DAR", norma: "IEEE 43-2013",
    intro: "Función PI/DAR del Fluke 1587 FC, 10 minutos a 500 V. Anota el PI y el DAR que muestra el equipo.",
    checks: ["Prueba completa de 10 min sin interrupción", "Lecturas guardadas en el equipo / Fluke Connect"],
    fields: [["pi", "PI (R10/R1)", "number"], ["dar", "DAR (R60/R30)", "number"], ["r10", "R 10 min", "number", "MΩ"]],
    evaluate: evalPI },
  { id: "reconexion", phase: "Puesta en servicio", title: "Reconexión", norma: "NEMA MG-1 · NETA MTS",
    intro: "Reconecta según el voltaje de servicio y la conexión de placa. Aísla cada unión y aprieta al torque del fabricante del conector.",
    checks: ["Conexión según diagrama de placa y voltaje de servicio", "Uniones aisladas con cinta clase 130 °C o conectores aislados", "Tapa de caja de bornes con empaque instalada", "Puesta a tierra del motor reconectada", "Herramientas retiradas; bloqueo liberado por quien lo colocó"],
    extra: "reconexion" },
  { id: "arranque", phase: "Puesta en servicio", title: "Arranque y verificación", norma: "NEMA MG-1 12.44 y 14.36",
    intro: "Arranque en vacío si es posible y luego con carga. Voltajes con el Fluke 1587 FC; corrientes con pinza amperimétrica.",
    checks: ["Sentido de giro correcto", "Sin ruido ni vibración anormal al arranque", "Protección de sobrecarga ajustada a la corriente de placa"],
    fields: [["vab", "V L1-L2", "number", "V"], ["vbc", "V L2-L3", "number", "V"], ["vca", "V L3-L1", "number", "V"], ["ia", "I L1", "number", "A"], ["ib", "I L2", "number", "A"], ["ic", "I L3", "number", "A"]],
    evaluate: evalRun },
  { id: "dictamen", phase: "Cierre", title: "Dictamen e informe", norma: "",
    intro: "Revisa el resumen, define el dictamen y escribe las recomendaciones. El informe PDF toma todo lo registrado.",
    fields: [["dictamen", "Dictamen", "select", ["", "Apto para operar", "Apto con observaciones", "No apto"]], ["proxima", "Próxima prueba recomendada", "date"], ["recom", "Recomendaciones", "textarea", null, "wide"]],
    extra: "resumen" }
];

export function stepEvals(st, p) { return st.evaluate ? st.evaluate(p) : []; }
export function stepStatus(st, p) {
  const ev = stepEvals(st, p).map(e => e.status);
  if (ev.includes("fail")) return "fail"; if (ev.includes("warn")) return "warn"; if (ev.includes("ok")) return "ok"; return "";
}
export function stepChecks(st, p) { return [...(st.checks || []), ...(st.checksFn ? st.checksFn(p) : []), ...(st.extraChecks || [])]; }
export function stepFields(st, p) { return st.fieldsFn ? st.fieldsFn(p) : (st.fields || []); }
export function allEvals(p) { return STEPS.flatMap(st => stepEvals(st, p).map(e => ({ ...e, step: st.title }))); }
export function suggested(p) {
  const ev = allEvals(p).map(e => e.status);
  return ev.includes("fail") ? "No apto" : ev.includes("warn") ? "Apto con observaciones" : ev.includes("ok") ? "Apto para operar" : "";
}
