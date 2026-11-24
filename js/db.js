// Almacenamiento local en IndexedDB.
//   pruebas: una fila por prueba, clave uuid (generado en el cliente)
//   fotos:   un Blob JPEG por foto, clave uuid, índice por prueba
//   meta:    pares clave-valor (prueba abierta, etc.)
//   cola:    trabajos pendientes de sincronizar con la API (se usa desde la etapa 2)
const NOMBRE = "motores-iselec", VERSION = 1;
let dbP = null;

function abrir() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const rq = indexedDB.open(NOMBRE, VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("pruebas")) db.createObjectStore("pruebas", { keyPath: "uuid" });
      if (!db.objectStoreNames.contains("fotos")) db.createObjectStore("fotos", { keyPath: "uuid" }).createIndex("prueba", "prueba");
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      if (!db.objectStoreNames.contains("cola")) db.createObjectStore("cola", { keyPath: "id", autoIncrement: true });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => { dbP = null; rej(rq.error); };
  });
  return dbP;
}

// Ejecuta fn(store) dentro de una transacción y resuelve cuando la transacción termina.
async function tx(almacen, modo, fn) {
  const db = await abrir();
  return new Promise((res, rej) => {
    const t = db.transaction(almacen, modo);
    const rq = fn(t.objectStore(almacen));
    t.oncomplete = () => res(rq ? rq.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

export const uuid = () => crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

export const getPrueba = id => tx("pruebas", "readonly", s => s.get(id));
export const putPrueba = p => tx("pruebas", "readwrite", s => s.put(p));
export const listPruebas = () => tx("pruebas", "readonly", s => s.getAll());

export const putFoto = f => tx("fotos", "readwrite", s => s.put(f));
export const delFoto = id => tx("fotos", "readwrite", s => s.delete(id));
export const fotosDePrueba = id => tx("fotos", "readonly", s => s.index("prueba").getAll(id));

export const getMeta = k => tx("meta", "readonly", s => s.get(k));
export const setMeta = (k, v) => tx("meta", "readwrite", s => s.put(v, k));
