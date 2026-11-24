// Asistente técnico: consulta a la API de ISELEC, que hace de proxy hacia Claude.
// La API key nunca está en el teléfono. Requiere sesión (el límite de consultas es por usuario).
import { API_URL, sesion, pedir, olvidarSesion, ApiError } from "./api.js";
import { STEPS, allEvals } from "./protocolo.js";

// Preguntas sugeridas según el paso en que está el técnico
const SUGERENCIAS = {
  termo: ["¿Qué emisividad uso en carcasa pintada?", "¿Cómo interpreto un ΔT de 8 °C en una fase?"],
  vibracion: ["¿Qué equipo de vibración conviene comprar?", "¿Qué indica vibración alta en axial?"],
  resistencia: ["¿Cómo corrijo la resistencia a 25 °C?", "El desbalance da 6 %, ¿qué reviso?"],
  aislamiento: ["¿Por qué 500 V y no 1000 V?", "IR bajo con humedad alta, ¿qué hago?"],
  pi: ["PI de 1.3 con IR alto, ¿qué significa?"],
  placa: ["¿Cómo identifico un motor de 12 hilos sin placa?"],
  loto: ["¿Qué pasos exige NFPA 70E para verificar ausencia de tensión?"],
  arranque: ["Desbalance de voltaje 2 %, ¿cuánto reduzco la potencia?"]
};
export const sugerencias = pasoId => SUGERENCIAS[pasoId] || ["Revisa los datos que llevo y dime si algo no cuadra"];

// Lo que el asistente ve de la prueba: el paso actual, los valores y lo que ya evaluó la app
export function contexto(p) {
  const st = STEPS[p.step] || STEPS[0];
  return { paso: st.title, fase: st.phase,
    datos: { valores: p.v, vibracion_aplicada: !!p.vib, evaluaciones: allEvals(p).map(e => ({ paso: e.step, prueba: e.label, resultado: e.value, estado: e.status })) } };
}

// Envía la conversación y devuelve { texto, corte, rechazo, restantes }.
// `alTexto(parcial)` se llama a medida que llega la respuesta, si el servidor logra enviarla por partes.
export async function preguntar(mensajes, ctx, alTexto = () => {}) {
  const s = sesion();
  if (!s) throw new ApiError(401, { error: "Inicia sesión para usar el asistente", codigo: "sin_sesion" });
  let texto = "";
  try {
    let r;
    try {
      r = await fetch(API_URL + "/asistente", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.token }, body: JSON.stringify({ mensajes, contexto: ctx }) });
    } catch (e) { throw new ApiError(0); }
    if (!r.ok) {
      let d = null; try { d = await r.json(); } catch (e) { /* sin JSON */ }
      if (r.status === 401) olvidarSesion();
      throw new ApiError(r.status, d);
    }
    if (!/text\/event-stream/.test(r.headers.get("content-type") || "")) { const d = await r.json(); return { texto: d.texto || "", corte: !!d.corte, rechazo: !!d.rechazo, restantes: d.restantes }; }
    // Respuesta por partes: eventos "data: {...}" separados por una línea en blanco
    const lector = r.body.getReader(), deco = new TextDecoder(); let buf = "", fin = null;
    for (;;) {
      const { done, value } = await lector.read();
      buf += deco.decode(value || new Uint8Array(), { stream: !done });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const bloque = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!bloque.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(bloque.slice(5)); } catch (e) { continue; }
        if (typeof ev.t === "string") { texto += ev.t; alTexto(texto); }
        else if (ev.error) throw new ApiError(502, { error: ev.error, codigo: "asistente_no_disponible", restantes: ev.restantes });
        else if (ev.fin) fin = ev;
      }
      if (done) break;
    }
    if (!fin) throw new ApiError(0); // la conexión se cortó antes de terminar
    return { texto, corte: !!fin.corte, rechazo: !!fin.rechazo, restantes: fin.restantes };
  } catch (e) {
    // Si el envío por partes falló sin entregar nada, se pide la respuesta completa en una sola pieza
    if (e instanceof ApiError && e.estado === 0 && !texto && navigator.onLine !== false) {
      const d = await pedir("POST", "/asistente", { mensajes, contexto: ctx, stream: false });
      return { texto: d.texto || "", corte: !!d.corte, rechazo: !!d.rechazo, restantes: d.restantes };
    }
    if (e instanceof ApiError) e.parcial = texto;
    throw e;
  }
}

export const usoDeHoy = () => pedir("GET", "/asistente/uso");
