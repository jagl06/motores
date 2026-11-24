# Despliegue de la API en Bluehost (cPanel)

La API vive en `api-motores.iselec.com.pa`. Es PHP 8 plano con PDO: no usa Composer en esta etapa
ni procesos externos (`exec` y `shell_exec` están deshabilitados en el hosting).

```
api/
├─ public/        ← raíz web del subdominio (solo index.php y .htaccess)
├─ src/           código
├─ sql/           schema.sql y migraciones numeradas
├─ bin/           scripts de terminal: migrar.php, usuario.php
├─ cron/          limpieza.php
├─ config.php     ← se crea en el servidor; NO está en el repositorio
└─ storage/       fotos y PDFs (etapa 3); NO está en el repositorio
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
   Extensiones necesarias: `pdo_mysql`, `mbstring`, `json` (vienen activas por defecto).
5. **Configuración.** En el *File Manager*, dentro de `api/`: copiar `config.example.php` como
   `config.php`, poner el DSN, usuario y clave de la base, y permisos `600`.
6. **Tablas.** Con terminal (cPanel → *Terminal*, o SSH):
   ```
   cd ~/repositories/motores/api && php bin/migrar.php
   ```
   Sin terminal: phpMyAdmin → seleccionar la base → *Import* → `sql/schema.sql`.
7. **Primer usuario.**
   ```
   php bin/usuario.php crear jgonzalez "Nombre Apellido" admin
   ```
   Muestra una contraseña inicial una sola vez. El usuario la cambia desde la app.
   Sin terminal: crear un cron de una sola ejecución con ese comando y la salida a un archivo
   fuera de `public/` (`> ~/usuario.txt`), leerlo, y borrar el cron y el archivo.
8. **Cron de limpieza.** cPanel → *Cron Jobs*, una vez al día:
   ```
   15 3 * * * /usr/local/bin/php /home/CUENTA/repositories/motores/api/cron/limpieza.php >/dev/null 2>&1
   ```

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
3. Si la versión trae migraciones nuevas: `php bin/migrar.php`.

El frontend (GitHub Pages) y la API se actualizan por separado desde el mismo repositorio.

## Usuarios

```
php bin/usuario.php listar
php bin/usuario.php crear <usuario> "<Nombre>" <tecnico|supervisor|admin>
php bin/usuario.php clave <usuario>        # contraseña nueva; cierra sus sesiones
php bin/usuario.php rol <usuario> <rol>
php bin/usuario.php desactivar <usuario>   # activar <usuario> lo revierte
```

## Endpoints de esta etapa

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

Límites del hosting que el código respeta: sin `exec`, sin triggers ni eventos de MySQL, una
petición por prueba (sin fotos; cada foto irá en su propia petición en la etapa 3).
