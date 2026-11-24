<?php
declare(strict_types=1);

// Historial de un motor: los valores clave de cada prueba (IR a 40 °C, PI, DAR, resistencia)
// para graficar su tendencia. Los valores los calcula el teléfono con los evaluadores y viajan
// en `resumen` al guardar la prueba; aquí no se recalcula nada.
//
// Cualquier usuario con sesión puede ver el historial de un motor, aunque las pruebas sean de
// otro técnico: solo se exponen los valores resumidos, no la prueba completa.

// GET /motores/{serie_o_tag}/historial[?cliente=]     (o /motores/historial?q=...&cliente=)
// La segunda forma existe porque una serie puede llevar "/" y Apache rechaza %2F en la ruta.
function motores_historial(?string $segmento = null): void
{
    usuario_actual();
    $q = trim((string) ($segmento ?? ($_GET['q'] ?? '')));
    $n = norm_id($q);
    if ($n === '' || mb_strlen($q) > 80) {
        throw new ErrorHttp(400, 'Indica el número de serie o el TAG del motor', 'sin_motor');
    }
    $cliente = norm_id((string) ($_GET['cliente'] ?? ''));

    // Mismo criterio de normalización que clave_motor(): sin espacios, guiones, puntos ni barras, en mayúsculas.
    $normSql = static fn(string $col): string => "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER($col), ' ', ''), '-', ''), '_', ''), '.', ''), '/', '')";
    $sql = 'SELECT id, clave, cliente, serie, tag, fabricante, modelo, hp, kw FROM motores WHERE ' . $normSql('serie') . ' = ? OR (' . $normSql('tag') . ' = ?'
         . ($cliente !== '' ? ' AND ' . $normSql('cliente') . ' = ?' : '') . ') ORDER BY actualizado_en DESC LIMIT 20';
    $st = db()->prepare($sql);
    $st->execute($cliente !== '' ? [$n, $n, $cliente] : [$n, $n]);
    $motores = $st->fetchAll();
    if (!$motores) {
        responder(['consulta' => $q, 'motores' => [], 'pruebas' => []]);
    }

    $ids = array_map(static fn(array $m): int => (int) $m['id'], $motores);
    $st = db()->prepare(
        'SELECT p.uuid, p.motor_id, p.fecha, p.estado, p.dictamen, p.resumen, p.actualizado_en, u.nombre AS tecnico
           FROM pruebas p JOIN usuarios u ON u.id = p.tecnico_id
          WHERE p.motor_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')
          ORDER BY COALESCE(p.fecha, DATE(p.creado_en)), p.creado_en LIMIT 500'
    );
    $st->execute($ids);
    $pruebas = array_map(static function (array $f): array {
        return [
            'uuid' => $f['uuid'], 'motor_id' => (int) $f['motor_id'], 'fecha' => $f['fecha'], 'estado' => $f['estado'],
            'dictamen' => $f['dictamen'], 'tecnico' => $f['tecnico'],
            'resumen' => $f['resumen'] !== null ? json_decode($f['resumen']) : null,
        ];
    }, $st->fetchAll());

    responder([
        'consulta' => $q,
        'motores' => array_map(static fn(array $m): array => ['id' => (int) $m['id'], 'cliente' => $m['cliente'], 'serie' => $m['serie'], 'tag' => $m['tag'],
            'fabricante' => $m['fabricante'], 'modelo' => $m['modelo'], 'hp' => $m['hp'], 'kw' => $m['kw']], $motores),
        'pruebas' => $pruebas,
    ]);
}
