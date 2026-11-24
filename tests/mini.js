// Corredor de pruebas mínimo, sin dependencias: sirve igual en Node y en tests.html.
export const resultados = [];

export function test(nombre, fn) {
  try { fn(); resultados.push({ nombre, ok: true }); }
  catch (e) { resultados.push({ nombre, ok: false, error: String(e && e.message || e) }); }
}

export function igual(obtenido, esperado, msg = "") {
  if (obtenido !== esperado) throw new Error(`${msg} esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(obtenido)}`.trim());
}

export function cierto(cond, msg = "condición falsa") {
  if (!cond) throw new Error(msg);
}
