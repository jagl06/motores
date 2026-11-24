<?php
declare(strict_types=1);

// Limpieza periódica, ejecutada por el cron de cPanel (MySQL no permite eventos programados en este hosting).
// Sugerido una vez al día:
//   15 3 * * * /usr/local/bin/php /home/CUENTA/repositories/motores/api/cron/limpieza.php >/dev/null 2>&1
// Borra sesiones vencidas, intentos de login antiguos, fotos que el técnico quitó de su prueba
// (pasados 7 días) y temporales de subidas interrumpidas.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/nucleo.php';
require __DIR__ . '/../src/archivos.php';

$pdo = db();
$st = $pdo->prepare('DELETE FROM sesiones WHERE vence_en < ?');
$st->execute([ahora()]);
$sesiones = $st->rowCount();

$st = $pdo->prepare('DELETE FROM intentos_login WHERE creado_en < ?');
$st->execute([ahora(-86400)]);
$intentos = $st->rowCount();

// Fotos huérfanas: están en el servidor pero la prueba ya no las referencia en sus datos.
// Se espera 7 días por si la foto subió antes que la versión de la prueba que la incluye.
$huerfanas = 0;
$fotos = $pdo->prepare('SELECT f.uuid, f.prueba_uuid, f.ruta, p.datos FROM fotos f JOIN pruebas p ON p.uuid = f.prueba_uuid WHERE f.creado_en < ?');
$fotos->execute([ahora(-7 * 86400)]);
$referencias = [];
foreach ($fotos->fetchAll() as $f) {
    $referencias[$f['prueba_uuid']] ??= array_flip(fotos_referenciadas($f['datos']));
    if (!isset($referencias[$f['prueba_uuid']][strtolower($f['uuid'])])) {
        @unlink(dir_storage() . '/' . $f['ruta']);
        $pdo->prepare('DELETE FROM fotos WHERE uuid = ?')->execute([$f['uuid']]);
        $huerfanas++;
    }
}

// Temporales de subidas que se cortaron a medias
$temporales = 0;
foreach (glob(dir_storage() . '/sub*') ?: [] as $t) {
    if (is_file($t) && filemtime($t) < time() - 86400) {
        @unlink($t);
        $temporales++;
    }
}

echo ahora() . " UTC · sesiones vencidas: $sesiones · intentos antiguos: $intentos · fotos huérfanas: $huerfanas · temporales: $temporales\n";
