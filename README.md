# Prueba de motores — ISELEC

App web móvil (PWA) que guía al técnico paso a paso en la prueba de motores de inducción
trifásicos multiconexión (6 y 12 hilos, menores de 600 V). Registra mediciones, observaciones y
fotos en el celular, evalúa los criterios de aceptación, genera el informe PDF y lo pasa a revisión
del supervisor.

- **App:** https://motores.iselec.com.pa — estática, sin build, publicada con GitHub Pages desde `main`.
- **API:** https://api-motores.iselec.com.pa — PHP 8 + MySQL en cPanel (Bluehost), carpeta `api/`.

La app funciona completa sin la API: sin conexión o sin sesión, la prueba se hace, se guarda en el
teléfono (IndexedDB) y el PDF se genera ahí mismo. Con red y sesión, sincroniza.

## Qué hace

| | |
|---|---|
| Protocolo | 15 pasos: orden, placa y conexión, seguridad, termografía, vibración (opcional), bloqueo, limpieza, inspección, hilos, resistencia, aislamiento, PI/DAR, reconexión, arranque y dictamen |
| Criterios | NFPA 70E-2024, IEEE 43-2013, NEMA MG-1, NETA MTS-2023, ISO 20816-3 / 10816-1. El dictamen lo sugieren los criterios y lo decide el técnico |
| Informe | PDF generado en el teléfono con jsPDF; al aprobar, el servidor lo sella con nombre y fecha |
| Sincronización | Cola de subida idempotente (UUID del cliente), control de conflictos por revisión, fotos e informe en peticiones separadas |
| Revisión | El supervisor aprueba o devuelve con motivo; aprobada, la prueba ya no cambia |
| Historial | Tendencia de IR a 40 °C, PI y resistencia por motor |
| Asistente | Consultas a Claude a través de la API de ISELEC; la API key solo vive en el servidor |

## Estructura

```
index.html, css/, js/      app (módulos ES, sin framework)
  js/evaluadores.js        criterios de aceptación — NO cambiar umbrales sin aprobación de ISELEC
  js/protocolo.js          definición de los 15 pasos
  js/sync.js, js/api.js    sincronización y cliente de la API
  js/pdf.js                informe
  js/historial.js          gráficas de tendencia
  js/asistente.js          chat
sw.js, manifest.webmanifest  PWA (uso sin señal)
tests/, tests.html         pruebas de los evaluadores (Node o navegador)
tools/                     servidor local, API simulada, pruebas de extremo a extremo
api/                       API PHP: ver api/DEPLOY.md
prototipo-prueba-motores.html   prototipo original, solo como referencia
```

## Desarrollo

```
node tests/run-node.js        # pruebas de los evaluadores (también en /tests.html)
node tools/servir.js          # app en http://localhost:8123
```

La API real se prueba en local con PHP y MariaDB o MySQL; los pasos y la batería de comprobaciones
de extremo a extremo (`tools/probar-api.js`) están en [api/DEPLOY.md](api/DEPLOY.md).

Tras cambiar cualquier archivo de la app hay que subir la constante `CACHE` de `sw.js`: el service
worker sirve la copia guardada y actualiza en segundo plano, así que un cambio se ve en la segunda carga.

## Despliegue

- **App:** `git push` a `main`; GitHub Pages publica en un minuto.
- **API:** después del `push`, en cPanel → *Git Version Control* → *Update from Remote*, y las
  migraciones si las hay. Detalle en [api/DEPLOY.md](api/DEPLOY.md).

Nunca van al repositorio: `api/config.php` (claves), `api/storage/` (fotos y PDFs) ni `api/vendor/`.
