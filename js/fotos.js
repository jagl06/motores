// Fotos y termogramas: se comprimen en el teléfono antes de guardarse.
export const MAX_PX = 1600, CALIDAD = 0.75;

async function cargar(blob) {
  // createImageBitmap respeta la orientación EXIF; si no existe, se usa <img>
  if (self.createImageBitmap) {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (e) { /* sigue con <img> */ }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("imagen ilegible")); };
    img.src = url;
  });
}

function dibujar(img, maxPx) {
  const k = Math.min(1, maxPx / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); // PNG con transparencia → fondo blanco
  ctx.drawImage(img, 0, 0, c.width, c.height);
  if (img.close) img.close();
  return c;
}

// Archivo de imagen → Blob JPEG de máx. 1600 px por lado, calidad 0.75
export async function comprimir(archivo, maxPx = MAX_PX, calidad = CALIDAD) {
  const c = dibujar(await cargar(archivo), maxPx);
  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", calidad));
  if (!blob) throw new Error("no se pudo comprimir");
  return blob;
}

// Blob → data URL JPEG reducida (para incrustar en el PDF o exportar)
export async function aDataURL(blob, maxPx = MAX_PX, calidad = CALIDAD) {
  return dibujar(await cargar(blob), maxPx).toDataURL("image/jpeg", calidad);
}

export async function deDataURL(dataURL) {
  return (await fetch(dataURL)).blob();
}
