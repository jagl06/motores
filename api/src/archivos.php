<?php
declare(strict_types=1);

// Fotos e informes PDF. Los archivos viven en disco, en la carpeta `storage` de config.php
// (fuera de la raíz web); en la base solo se guarda la ruta relativa.
// El servidor no procesa imágenes: llegan ya comprimidas del teléfono y aquí solo se validan.

const MAX_FOTO_BYTES = 5242880;   // 5 MB
const MAX_PDF_BYTES  = 26214400;  // 25 MB
const MAX_FOTO_LADO  = 4000;      // px; la app comprime a 1600

function dir_storage(): string
{
    $d = rtrim((string) (cfg()['storage'] ?? dirname(__DIR__) . '/storage'), '/\\');
    if (!is_dir($d) && !@mkdir($d, 0700, true) && !is_dir($d)) {
        throw new RuntimeException('No se pudo crear la carpeta de archivos');
    }
    return $d;
}

/** Carpeta de una prueba dentro de storage, creada si hace falta. Devuelve la ruta relativa. */
function dir_prueba(string $uuid): string
{
    $rel = 'pruebas/' . $uuid;
    $abs = dir_storage() . '/' . $rel;
    if (!is_dir($abs) && !@mkdir($abs, 0700, true) && !is_dir($abs)) {
        throw new RuntimeException('No se pudo crear la carpeta de la prueba');
    }
    return $rel;
}

/**
 * Guarda el cuerpo de la petición en un archivo temporal dentro de storage y devuelve su ruta.
 * Corta si supera $max. Se lee por bloques para no cargar el archivo entero en memoria.
 */
function cuerpo_a_temporal(int $max): string
{
    $largo = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($largo > $max) {
        throw new ErrorHttp(413, 'El archivo es demasiado grande', 'muy_grande');
    }
    $tmp = tempnam(dir_storage(), 'sub');
    if ($tmp === false) {
        throw new RuntimeException('No se pudo crear el archivo temporal');
    }
    $in = fopen('php://input', 'rb');
    $out = fopen($tmp, 'wb');
    $total = 0;
    while (!feof($in)) {
        $bloque = fread($in, 65536);
        if ($bloque === false || $bloque === '') {
            break;
        }
        $total += strlen($bloque);
        if ($total > $max) {
            fclose($in); fclose($out); @unlink($tmp);
            throw new ErrorHttp(413, 'El archivo es demasiado grande', 'muy_grande');
        }
        fwrite($out, $bloque);
    }
    fclose($in);
    fclose($out);
    if ($total === 0) {
        @unlink($tmp);
        throw new ErrorHttp(400, 'No llegó ningún archivo', 'vacio');
    }
    return $tmp;
}

function mime_de(string $archivo): string
{
    $f = new finfo(FILEINFO_MIME_TYPE);
    return (string) $f->file($archivo);
}

/** Envía un archivo de storage al cliente. Nunca se sirve directo por Apache. */
function enviar_archivo(string $rel, string $mime, string $nombre): void
{
    $abs = dir_storage() . '/' . $rel;
    if (!is_file($abs)) {
        throw new ErrorHttp(404, 'El archivo no está en el servidor', 'sin_archivo');
    }
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($abs));
    header('Content-Disposition: inline; filename="' . preg_replace('/[^A-Za-z0-9._-]+/', '_', $nombre) . '"');
    header('Cache-Control: private, no-store');
    readfile($abs);
    exit;
}

/**
 * Prueba que el usuario puede ver, o error.
 * @return array<string,mixed>
 */
function prueba_visible(string $uuid): array
{
    $u = usuario_actual();
    $f = prueba_o_404(exigir_uuid($uuid));
    if (!puede_ver($u, $f)) {
        throw new ErrorHttp(403, 'Esta prueba es de otro técnico', 'ajena');
    }
    return $f;
}

/**
 * Prueba en la que el usuario puede subir archivos: es suya y aún no está aprobada.
 * (Cerrada sí admite archivos: el cierre sube primero la prueba y después sus fotos y su PDF.)
 * @return array<string,mixed>
 */
function prueba_para_subir(string $uuid): array
{
    $u = usuario_actual();
    $f = prueba_o_404(exigir_uuid($uuid));
    if ((int) $f['tecnico_id'] !== $u['id']) {
        throw new ErrorHttp(403, 'Esta prueba es de otro técnico', 'ajena');
    }
    if ($f['estado'] === 'aprobada') {
        throw new ErrorHttp(409, 'La prueba ya está aprobada y no admite cambios', 'cerrada', ['estado' => 'aprobada']);
    }
    return $f;
}

// POST /pruebas/{uuid}/fotos?foto=<uuid>&paso=<id>   cuerpo: el JPEG tal cual (Content-Type: image/jpeg)
// Una foto por petición. Repetir la subida de la misma foto responde 200 sin duplicar.
function fotos_subir(string $uuid): void
{
    $p = prueba_para_subir($uuid);
    $foto = exigir_uuid((string) ($_GET['foto'] ?? ''));
    $paso = (string) ($_GET['paso'] ?? '');
    if (!preg_match('/^[a-z0-9_]{1,40}$/', $paso)) {
        throw new ErrorHttp(400, 'Paso no válido', 'paso_invalido');
    }

    $st = db()->prepare('SELECT prueba_uuid, sha256, bytes FROM fotos WHERE uuid = ?');
    $st->execute([$foto]);
    $ya = $st->fetch();
    if ($ya && $ya['prueba_uuid'] !== $p['uuid']) {
        throw new ErrorHttp(409, 'Ese identificador de foto pertenece a otra prueba', 'foto_ajena');
    }

    $tmp = cuerpo_a_temporal(MAX_FOTO_BYTES);
    try {
        $info = @getimagesize($tmp);
        if (mime_de($tmp) !== 'image/jpeg' || $info === false || $info[2] !== IMAGETYPE_JPEG) {
            throw new ErrorHttp(415, 'La foto debe ser una imagen JPEG', 'tipo_invalido');
        }
        [$ancho, $alto] = $info;
        if ($ancho < 1 || $alto < 1 || $ancho > MAX_FOTO_LADO || $alto > MAX_FOTO_LADO) {
            throw new ErrorHttp(422, 'Las dimensiones de la foto no son válidas', 'dimensiones');
        }
        $sha = hash_file('sha256', $tmp);
        $bytes = filesize($tmp);
        if ($ya && hash_equals($ya['sha256'], $sha)) {
            @unlink($tmp); // responder() termina el script y no pasa por el finally
            responder(['uuid' => $foto, 'bytes' => (int) $ya['bytes'], 'repetida' => true]);
        }
        $rel = dir_prueba($p['uuid']) . '/' . $foto . '.jpg';
        if (!rename($tmp, dir_storage() . '/' . $rel)) {
            throw new RuntimeException('No se pudo guardar la foto');
        }
        @chmod(dir_storage() . '/' . $rel, 0600);
        db()->prepare(
            'INSERT INTO fotos (uuid, prueba_uuid, paso, ruta, bytes, sha256, ancho, alto, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE paso = VALUES(paso), ruta = VALUES(ruta), bytes = VALUES(bytes), sha256 = VALUES(sha256), ancho = VALUES(ancho), alto = VALUES(alto)'
        )->execute([$foto, $p['uuid'], $paso, $rel, $bytes, $sha, $ancho, $alto, ahora()]);
        responder(['uuid' => $foto, 'bytes' => $bytes], 201);
    } finally {
        if (is_file($tmp)) {
            @unlink($tmp);
        }
    }
}

// GET /pruebas/{uuid}/fotos/{foto}
function fotos_obtener(string $uuid, string $foto): void
{
    $p = prueba_visible($uuid);
    $st = db()->prepare('SELECT ruta FROM fotos WHERE uuid = ? AND prueba_uuid = ?');
    $st->execute([exigir_uuid($foto), $p['uuid']]);
    $ruta = $st->fetchColumn();
    if ($ruta === false) {
        throw new ErrorHttp(404, 'La foto no está en el servidor', 'sin_archivo');
    }
    enviar_archivo($ruta, 'image/jpeg', $foto . '.jpg');
}

// POST /pruebas/{uuid}/pdf   cuerpo: el PDF tal cual (Content-Type: application/pdf)
// Reemplaza el informe anterior de la prueba (p. ej. tras una devolución).
function pdf_subir(string $uuid): void
{
    $p = prueba_para_subir($uuid);
    $tmp = cuerpo_a_temporal(MAX_PDF_BYTES);
    try {
        $cabecera = (string) file_get_contents($tmp, false, null, 0, 5);
        if ($cabecera !== '%PDF-' || mime_de($tmp) !== 'application/pdf') {
            throw new ErrorHttp(415, 'El informe debe ser un archivo PDF', 'tipo_invalido');
        }
        $sha = hash_file('sha256', $tmp);
        $bytes = filesize($tmp);
        $st = db()->prepare('SELECT version, sha256, ruta_sellado FROM pdfs WHERE prueba_uuid = ?');
        $st->execute([$p['uuid']]);
        $ya = $st->fetch();
        if ($ya && hash_equals($ya['sha256'], $sha)) {
            @unlink($tmp);
            responder(['version' => (int) $ya['version'], 'bytes' => $bytes, 'repetido' => true]);
        }
        $rel = dir_prueba($p['uuid']) . '/informe.pdf';
        if (!rename($tmp, dir_storage() . '/' . $rel)) {
            throw new RuntimeException('No se pudo guardar el informe');
        }
        @chmod(dir_storage() . '/' . $rel, 0600);
        if ($ya && $ya['ruta_sellado']) { // un informe nuevo invalida el sello anterior
            @unlink(dir_storage() . '/' . $ya['ruta_sellado']);
        }
        $version = $ya ? (int) $ya['version'] + 1 : 1;
        db()->prepare(
            'INSERT INTO pdfs (prueba_uuid, version, ruta, bytes, sha256, ruta_sellado, sellado_en, subido_en) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
             ON DUPLICATE KEY UPDATE version = VALUES(version), ruta = VALUES(ruta), bytes = VALUES(bytes), sha256 = VALUES(sha256), ruta_sellado = NULL, sellado_en = NULL, subido_en = VALUES(subido_en)'
        )->execute([$p['uuid'], $version, $rel, $bytes, $sha, ahora()]);
        responder(['version' => $version, 'bytes' => $bytes], 201);
    } finally {
        if (is_file($tmp)) {
            @unlink($tmp);
        }
    }
}

// GET /pruebas/{uuid}/pdf  — el sellado si la prueba está aprobada y se pudo sellar; si no, el del técnico
function pdf_obtener(string $uuid): void
{
    $p = prueba_visible($uuid);
    $st = db()->prepare('SELECT ruta, ruta_sellado FROM pdfs WHERE prueba_uuid = ?');
    $st->execute([$p['uuid']]);
    $f = $st->fetch();
    if (!$f) {
        throw new ErrorHttp(404, 'El informe de esta prueba aún no ha subido al servidor', 'sin_archivo');
    }
    $sellado = $p['estado'] === 'aprobada' && $f['ruta_sellado'];
    header('X-Informe-Sellado: ' . ($sellado ? '1' : '0'));
    $nombre = 'Informe-' . ($p['tag'] ?: 'motor') . '-' . ($p['fecha'] ?: '') . ($sellado ? '-aprobado' : '') . '.pdf';
    enviar_archivo($sellado ? $f['ruta_sellado'] : $f['ruta'], 'application/pdf', $nombre);
}

/** Identificadores de las fotos que la prueba referencia en sus datos. @return string[] */
function fotos_referenciadas(string $datosJson): array
{
    $d = json_decode($datosJson, true);
    $ids = [];
    foreach ((array) ($d['photos'] ?? []) as $lista) {
        foreach ((array) $lista as $id) {
            if (is_string($id)) {
                $ids[] = strtolower($id);
            }
        }
    }
    return array_values(array_unique($ids));
}

/** Fotos referenciadas que todavía no han llegado al servidor. @return string[] */
function fotos_faltantes(string $uuid, string $datosJson): array
{
    $ref = fotos_referenciadas($datosJson);
    if (!$ref) {
        return [];
    }
    $st = db()->prepare('SELECT uuid FROM fotos WHERE prueba_uuid = ?');
    $st->execute([$uuid]);
    return array_values(array_diff($ref, array_map('strtolower', $st->fetchAll(PDO::FETCH_COLUMN))));
}
