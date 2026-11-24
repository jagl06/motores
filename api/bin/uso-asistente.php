<?php
declare(strict_types=1);

// Consumo del asistente de IA por usuario, para controlar el costo.
//   php bin/uso-asistente.php            mes en curso
//   php bin/uso-asistente.php 2026-11    un mes específico
// Los precios para estimar el costo son los del modelo configurado; ajústalos aquí si cambias de modelo.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/nucleo.php';

// USD por millón de tokens (Claude Sonnet 5.5): entrada, salida, lectura de caché, escritura de caché
const PRECIOS = ['entrada' => 2.00, 'salida' => 10.00, 'cache_lectura' => 0.10, 'cache_escritura' => 2.50];

$mes = $argv[1] ?? gmdate('Y-m', time() - 5 * 3600);
if (!preg_match('/^\d{4}-\d{2}$/', $mes)) {
    fwrite(STDERR, "Uso: php bin/uso-asistente.php [AAAA-MM]\n");
    exit(1);
}
$st = db()->prepare(
    'SELECT u.usuario, u.nombre, SUM(a.consultas) AS consultas, SUM(a.tokens_entrada) AS ent, SUM(a.tokens_salida) AS sal,
            SUM(a.tokens_cache_lectura) AS cl, SUM(a.tokens_cache_escritura) AS ce, COUNT(*) AS dias
       FROM asistente_uso a JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.fecha >= ? AND a.fecha < ? GROUP BY u.id, u.usuario, u.nombre ORDER BY consultas DESC'
);
$st->execute([$mes . '-01', date('Y-m-d', strtotime($mes . '-01 +1 month'))]);
$filas = $st->fetchAll();

printf("Uso del asistente en %s\n%-20s %9s %5s %11s %11s %11s %9s\n", $mes, 'usuario', 'consultas', 'días', 'entrada', 'salida', 'caché leída', 'USD aprox');
$total = 0.0;
foreach ($filas as $f) {
    $usd = ($f['ent'] * PRECIOS['entrada'] + $f['sal'] * PRECIOS['salida'] + $f['cl'] * PRECIOS['cache_lectura'] + $f['ce'] * PRECIOS['cache_escritura']) / 1e6;
    $total += $usd;
    printf("%-20s %9d %5d %11d %11d %11d %9.4f\n", $f['usuario'], $f['consultas'], $f['dias'], $f['ent'], $f['sal'], $f['cl'], $usd);
}
printf("%s\nTotal aproximado: USD %.4f (%d usuario(s))\n", str_repeat('-', 82), $total, count($filas));
