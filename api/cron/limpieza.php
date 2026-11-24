<?php
declare(strict_types=1);

// Limpieza periódica, ejecutada por el cron de cPanel (MySQL no permite eventos programados en este hosting).
// Sugerido una vez al día:
//   15 3 * * * /usr/local/bin/php /home/CUENTA/repositories/motores/api/cron/limpieza.php >/dev/null 2>&1
// Etapa 3 agregará aquí el borrado de fotos y PDFs huérfanos.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/nucleo.php';

$pdo = db();
$st = $pdo->prepare('DELETE FROM sesiones WHERE vence_en < ?');
$st->execute([ahora()]);
$sesiones = $st->rowCount();

$st = $pdo->prepare('DELETE FROM intentos_login WHERE creado_en < ?');
$st->execute([ahora(-86400)]);
$intentos = $st->rowCount();

echo ahora() . " UTC · sesiones vencidas: $sesiones · intentos antiguos: $intentos\n";
