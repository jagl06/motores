# Despliegue de la API en Bluehost (cPanel)

La API vive en `api-motores.iselec.com.pa`. Es PHP 8 plano con PDO, sin procesos externos (`exec` y
`shell_exec` están deshabilitados en el hosting). Composer se usa solo para dos librerías en PHP puro,
FPDF y FPDI, que ponen el sello de aprobación en el informe.

```
api/
├─ public/        ← raíz web del subdominio (solo index.php y .htaccess)
├─ src/           código
├─ sql/           schema.sql y migraciones numeradas
├─ bin/           scripts de terminal: migrar.php, usuario.php
├─ cron/          limpieza.php
├─ config.php     ← se crea en el servidor; NO está en el repositorio
├─ vendor/        ← lo crea `composer install`; NO está en el repositorio
└─ storage/       fotos y PDFs; lo crea la API; NO está en el repositorio
```

Todo lo que no es `public/` queda fuera del alcance del servidor web. La API key de Anthropic
(etapa 4) y la clave de la base solo existen en `config.php`.

## Instalación (una sola vez)

1. **Base de datos.** cPanel → *MySQL Databases*: crear la base `CUENTA_motores`, un usuario con
   contraseña generada y darle *All Privileges* sobre esa base. Anotar los tres datos.
2. **Código.** cPanel → *Git Version Control* → *Create*: clonar
   `https://github.com/jagl06/motores.git` en `/home/CUENTA/repositories/motores`.
   (Alternativa por SFTP: subir la carpeta `api/` completa a `/home/CUENTA/motores-api/`.)
3. **Subdominio.** cPanel → *Domains* → *Create a New Domain*: `api-motores.iselec.com.pa`, con
   *Document Root* en `repositories/motores/api/public` (o `motores-api/public` si fue por SFTP).
   Bluehost crea el registro DNS. Verificar que AutoSSL emitió el certificado (*SSL/TLS Status*).
4. **Versión de PHP.** cPanel → *MultiPHP Manager*: PHP 8.1 o superior para el subdominio.
   Extensiones necesarias: `pdo_mysql`, `mbstring`, `json`, `fileinfo`, `iconv`, `curl` (vienen activas por defecto).
5. **Configuración.** En el *File Manager*, dentro de `api/`: copiar `config.example.php` como
   `config.php`, poner el DSN, usuario y clave de la base, y permisos `600`.
6. **Tablas.** Con terminal (cPanel → *Terminal*, o SSH):
   ```
   cd ~/repositories/motores/api && php bin/migrar.php
   ```
   Sin terminal: phpMyAdmin → seleccionar la base → *Import* → `sql/schema.sql`.
7. **Librerías del sello.** En la terminal:
   ```
   cd ~/repositories/motores/api && composer install --no-dev
   ```
   Si no hay `composer` en el servidor: correr ese comando en un equipo con PHP y subir la carpeta
   `vendor/` resultante a `api/vendor/` por SFTP o File Manager. Sin `vendor/` la API funciona igual,
   pero al aprobar no sella el PDF en el servidor (la app pone entonces el sello al generar el informe).
8. **Primer usuario.**
   ```
   php bin/usuario.php crear jgonzalez "Nombre Apellido" admin
   ```
   Muestra una contraseña inicial una sola vez. El usuario la cambia desde la app.
   Sin terminal: crear un cron de una sola ejecución con ese comando y la salida a un archivo
   fuera de `public/` (`> ~/usuario.txt`), leerlo, y borrar el cron y el archivo.
9. **Cron de limpieza.** cPanel → *Cron Jobs*, una vez al día:
   ```
   15 3 * * * /usr/local/bin/php /home/CUENTA/repositories/motores/api/cron/limpieza.php >/dev/null 2>&1
   ```

## Asistente de IA

El asistente queda apagado hasta que `config.php` tenga la API key de Anthropic. Para encenderlo:

1. Crear una API key en la consola de Anthropic (https://platform.claude.com), en una cuenta de la
   empresa con un límite de gasto mensual configurado.
2. En el *File Manager*, editar `api/config.php` y, dentro del bloque `'anthropic'`, pegar la key en
   `'api_key' => '...'`. Si `config.php` es anterior a esta versión y su bloque `'anthropic'` no trae
   `'equipos'`, `'esfuerzo'` ni `'respaldo'`, no hace falta agregarlos: tienen valores por defecto
   (los de `config.example.php`). Para nombrar los instrumentos reales de ISELEC, agregar la línea
   `'equipos' => '...'` con el texto que se quiera.
3. Aplicar la migración 003 (`php ~/repositories/motores/api/bin/migrar.php`).
4. En la app, abrir **Asistente**: debe decir "Te quedan 40 de 40 consultas hoy".

La key nunca sale del servidor: no está en el repositorio, ni en la app, ni en las respuestas de la API.

Control de costo:

- `'consultas_dia'` limita las consultas por usuario y por día (día de Panamá).
- `php ~/repositories/motores/api/bin/uso-asistente.php [AAAA-MM]` muestra consultas y tokens por
  usuario en el mes, con el costo aproximado.
- Cada consulta envía las instrucciones, los datos de la prueba y hasta 12 mensajes de la conversación,
  y pide como máximo `'max_tokens'` de respuesta.

Si las respuestas llegan de golpe en vez de aparecer poco a poco, el hosting está reteniendo la salida:
la app funciona igual, solo que sin el efecto de escritura. Si el asistente responde "No se pudo obtener
respuesta", el motivo exacto queda en el registro de errores de PHP (cPanel → *Errors*), con el prefijo
`[motores-api] asistente`.

## Comprobación

- `https://api-motores.iselec.com.pa/` → `{"api":"motores-iselec","ok":true}`
- `https://api-motores.iselec.com.pa/salud` → `{"ok":true,...}` (confirma la conexión a MySQL)
- `https://api-motores.iselec.com.pa/config.php` y `/src/nucleo.php` → 404 (están fuera de la raíz web)
- En la app (`motores.iselec.com.pa` → *Pruebas* → *Iniciar sesión*) entrar con el usuario creado.

Si el inicio de sesión funciona pero todo lo demás responde "Inicia sesión", el servidor no está
pasando la cabecera `Authorization`: revisar que `public/.htaccess` se haya subido y que
`mod_rewrite` esté activo.

## Actualizar

1. `git push` a `main` desde el equipo de desarrollo.
2. cPanel → *Git Version Control* → *Manage* → *Pull or Deploy* → **Update from Remote**.
3. Si la versión trae migraciones nuevas: `php ~/repositories/motores/api/bin/migrar.php`.
4. Si cambió `composer.json` o `composer.lock`: `cd ~/repositories/motores/api && composer install --no-dev`.

Conviene actualizar la API justo después de cada `push`: el frontend nuevo se publica solo en un minuto y
puede pedir rutas que la API vieja aún no tiene (la app lo tolera y deja los archivos pendientes).

El frontend (GitHub Pages) y la API se actualizan por separado desde el mismo repositorio.

## Usuarios

```
php bin/usuario.php listar
php bin/usuario.php crear <usuario> "<Nombre>" <tecnico|supervisor|admin>
php bin/usuario.php clave <usuario>        # contraseña nueva; cierra sus sesiones
php bin/usuario.php rol <usuario> <rol>
php bin/usuario.php renombrar <usuario> <usuario_nuevo>    # conserva clave, rol y pruebas
php bin/usuario.php nombre <usuario> "<Nombre Apellido>"   # el nombre que sale en la app y los informes
php bin/usuario.php desactivar <usuario>   # activar <usuario> lo revierte
```

## Probar en un equipo de desarrollo

Con PHP 8 y MariaDB o MySQL locales (base vacía y `config.php` apuntando a ella, con
`'origenes' => ['http://localhost:8123']`):

```
php bin/migrar.php
php bin/usuario.php crear tecnico1 "Técnico Uno" tecnico      > claves.txt
php bin/usuario.php crear tecnico2 "Técnico Dos" tecnico      >> claves.txt
php bin/usuario.php crear supervisor1 "Supervisora Uno" supervisor >> claves.txt
node ../tools/anthropic-simulado.js &                            # imita la API de Anthropic en el puerto 8126
php -S 127.0.0.1:8125 -t public public/index.php
node ../tools/probar-api.js http://127.0.0.1:8125 claves.txt     # 138 comprobaciones
```

Para probar el asistente sin una key real, el `config.php` local apunta al servidor simulado:
`'anthropic' => ['api_key' => 'clave-de-prueba', 'url' => 'http://127.0.0.1:8126/v1/messages']`.
Con `'api_key'` vacía, `probar-api.js` omite las comprobaciones del asistente y lo avisa.

`probar-api.js` crea y cierra pruebas y bloquea un usuario ficticio: es solo para desarrollo y se
niega a correr contra `iselec.com.pa`. Para usar la app local contra esa API, en la consola del
navegador: `localStorage.pm_api = "http://localhost:8125"`.

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| POST | `/auth/login` | `{usuario, clave}` → token de sesión (30 días) |
| POST | `/auth/logout` | cierra la sesión |
| GET | `/auth/yo` | usuario de la sesión |
| POST | `/auth/clave` | `{actual, nueva}` cambia la contraseña |
| GET | `/pruebas?motor=&cliente=&desde=&estado=` | lista (el técnico ve las suyas) |
| GET | `/pruebas/{uuid}` | prueba completa |
| PUT | `/pruebas/{uuid}` | `{rev, datos, resumen, cerrar}` crea o actualiza; 409 si hay conflicto |
| POST | `/pruebas/{uuid}/cerrar` | cierra la prueba |
| POST | `/pruebas/{uuid}/fotos?foto={uuid}&paso={id}` | sube una foto JPEG como cuerpo de la petición (máx. 5 MB) |
| GET | `/pruebas/{uuid}/fotos/{foto}` | descarga una foto |
| POST | `/pruebas/{uuid}/pdf` | sube el informe PDF como cuerpo de la petición (máx. 25 MB) |
| GET | `/pruebas/{uuid}/pdf` | descarga el informe (el sellado si la prueba está aprobada) |
| POST | `/pruebas/{uuid}/aprobar` | supervisor o administrador; exige prueba cerrada con su PDF y sus fotos |
| POST | `/pruebas/{uuid}/devolver` | supervisor o administrador; `{motivo}`; la prueba vuelve a borrador |
| GET | `/motores/{serie_o_tag}/historial` | IR a 40 °C, PI, DAR y resistencia de cada prueba del motor (también `/motores/historial?q=&cliente=`) |
| POST | `/asistente` | `{mensajes, contexto, stream}`; proxy a Claude con límite diario por usuario |
| GET | `/asistente/uso` | consultas de hoy, límite y si el asistente está configurado |

La app envía fotos e informes con `Content-Type: application/octet-stream`: el ModSecurity de Bluehost
responde 406 a un POST con `Content-Type: application/pdf` antes de que llegue a PHP. La API no usa esa
cabecera; valida el contenido real del archivo.

Los archivos quedan en `api/storage/pruebas/{uuid}/` (fotos `{foto}.jpg`, `informe.pdf` e
`informe-aprobado.pdf`). Para respaldar el sistema hay que copiar esa carpeta además de la base.

Límites del hosting que el código respeta: sin `exec`, sin triggers ni eventos de MySQL, y cada foto
en su propia petición (nunca la prueba completa con todas las fotos en una sola).
