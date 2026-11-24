// Cliente de la API de ISELEC. La app funciona completa sin ella: aquí solo vive
// la sesión (token en localStorage) y el envoltorio de fetch.

// Para desarrollo se puede apuntar a otra API con localStorage.pm_api = "http://localhost:8080"
export const API_URL = (() => {
  try { const o = localStorage.getItem("pm_api"); if (o) return o.replace(/\/+$/, ""); } catch (e) { /* sin almacenamiento */ }
  return "https://api-motores.iselec.com.pa";
})();

const CLAVE = "pm_sesion";

export class ApiError extends Error {
  constructor(estado, datos) {
    super((datos && datos.error) || (estado ? "Error " + estado : "Sin conexión con el servidor"));
    this.estado = estado;              // 0 = no hubo respuesta (sin red o servidor caído)
    this.codigo = (datos && datos.codigo) || (estado ? "error" : "sin_red");
    this.datos = datos || {};
  }
}

export function sesion() {
  try { const s = JSON.parse(localStorage.getItem(CLAVE)); return s && s.token ? s : null; } catch (e) { return null; }
}
function guardarSesion(s) {
  try { if (s) localStorage.setItem(CLAVE, JSON.stringify(s)); else localStorage.removeItem(CLAVE); } catch (e) { /* sin almacenamiento */ }
  dispatchEvent(new CustomEvent("pm-sesion"));
}

// opciones: { binario: Blob, tipo: "image/jpeg" } envía un archivo como cuerpo crudo; { blob: true } devuelve un Blob
export async function pedir(metodo, ruta, cuerpo, opciones = {}) {
  const s = sesion();
  const tipo = opciones.binario ? opciones.tipo : cuerpo !== undefined ? "application/json" : null;
  let r;
  try {
    r = await fetch(API_URL + ruta, {
      method: metodo, cache: "no-store",
      headers: { ...(tipo ? { "Content-Type": tipo } : {}), ...(s ? { Authorization: "Bearer " + s.token } : {}) },
      body: opciones.binario || (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined)
    });
  } catch (e) { throw new ApiError(0); }
  if (r.ok && opciones.blob) return r.blob();
  let datos = null;
  try { datos = await r.json(); } catch (e) { /* respuesta sin JSON */ }
  if (!r.ok) {
    // Sesión vencida o revocada: se olvida el token; las pruebas siguen en el teléfono
    if (r.status === 401 && s && !ruta.startsWith("/auth/login") && !ruta.startsWith("/auth/clave")) guardarSesion(null);
    throw new ApiError(r.status, datos);
  }
  return datos;
}
export const subirArchivo = (ruta, blob, tipo) => pedir("POST", ruta, undefined, { binario: blob, tipo });
export const bajarArchivo = ruta => pedir("GET", ruta, undefined, { blob: true });

export const olvidarSesion = () => guardarSesion(null);

export async function login(usuario, clave) {
  const d = await pedir("POST", "/auth/login", { usuario, clave });
  guardarSesion({ token: d.token, vence_en: d.vence_en, usuario: d.usuario });
  return d.usuario;
}
export async function logout() {
  try { await pedir("POST", "/auth/logout"); } catch (e) { /* sin red: igual se olvida el token */ }
  guardarSesion(null);
}
export const cambiarClave = (actual, nueva) => pedir("POST", "/auth/clave", { actual, nueva });
