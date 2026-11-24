<?php
declare(strict_types=1);

// Revisión del supervisor: aprobar (sella el PDF) o devolver al técnico con un motivo.

/** @return array{id:int,usuario:string,nombre:string,rol:string,sesion_id:int} */
function exigir_revisor(): array
{
    $u = usuario_actual();
    if (!in_array($u['rol'], ['supervisor', 'admin'], true)) {
        throw new ErrorHttp(403, 'Solo un supervisor puede revisar pruebas', 'sin_permiso');
    }
    return $u;
}

// POST /pruebas/{uuid}/aprobar
// Exige que la prueba esté cerrada y que su informe y todas sus fotos ya estén en el servidor.
// Si el sellado falla (FPDI ausente o PDF ilegible) la aprobación queda registrada igual y
// la respuesta lleva sellado=false: la app genera entonces el informe con el sello.
function pruebas_aprobar(string $uuid): void
{
    $u = exigir_revisor();
    $uuid = exigir_uuid($uuid);
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $f = prueba_o_404($uuid, true);
        if ($f['estado'] === 'aprobada') { // repetir la aprobación no cambia nada
            $pdo->commit();
            responder(revision_respuesta(prueba_o_404($uuid)));
        }
        if ($f['estado'] !== 'cerrada') {
            throw new ErrorHttp(409, 'Solo se aprueba una prueba cerrada por el técnico', 'no_cerrada', ['estado' => $f['estado']]);
        }
        $st = $pdo->prepare('SELECT ruta FROM pdfs WHERE prueba_uuid = ?');
        $st->execute([$uuid]);
        $ruta = $st->fetchColumn();
        if ($ruta === false) {
            throw new ErrorHttp(409, 'El informe PDF de esta prueba aún no ha subido desde el celular del técnico', 'falta_pdf');
        }
        $faltan = fotos_faltantes($uuid, $f['datos']);
        if ($faltan) {
            throw new ErrorHttp(409, 'Faltan ' . count($faltan) . ' foto(s) por subir desde el celular del técnico', 'faltan_fotos', ['faltan' => count($faltan)]);
        }

        $t = ahora();
        $pdo->prepare("UPDATE pruebas SET estado = 'aprobada', aprobada_por = ?, aprobada_en = ?, actualizado_en = ?, rev = rev + 1 WHERE uuid = ?")
            ->execute([$u['id'], $t, $t, $uuid]);

        $sellado = false;
        try {
            require_once __DIR__ . '/sello.php';
            $rel = dir_prueba($uuid) . '/informe-aprobado.pdf';
            ob_start(); // cualquier aviso de la librería se descarta: no debe mezclarse con la respuesta JSON
            try {
                sellar_pdf(dir_storage() . '/' . $ruta, dir_storage() . '/' . $rel, $u['nombre'], $t, strtoupper(substr($uuid, 0, 8)));
            } finally {
                ob_end_clean();
            }
            @chmod(dir_storage() . '/' . $rel, 0600);
            $pdo->prepare('UPDATE pdfs SET ruta_sellado = ?, sellado_en = ? WHERE prueba_uuid = ?')->execute([$rel, $t, $uuid]);
            $sellado = true;
        } catch (Throwable $e) {
            error_log('[motores-api] no se pudo sellar ' . $uuid . ': ' . $e->getMessage());
        }
        $pdo->commit();
        responder(revision_respuesta(prueba_o_404($uuid)) + ['sellado' => $sellado]);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

// POST /pruebas/{uuid}/devolver  { motivo }  — la prueba vuelve a borrador para que el técnico la corrija
function pruebas_devolver(string $uuid): void
{
    $u = exigir_revisor();
    $uuid = exigir_uuid($uuid);
    $motivo = texto(cuerpo(8192)['motivo'] ?? null, 500);
    if ($motivo === null || mb_strlen($motivo) < 5) {
        throw new ErrorHttp(422, 'Escribe el motivo de la devolución', 'sin_motivo');
    }
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $f = prueba_o_404($uuid, true);
        if ($f['estado'] !== 'cerrada') {
            throw new ErrorHttp(409, $f['estado'] === 'aprobada' ? 'La prueba ya fue aprobada y no se puede devolver' : 'La prueba no está cerrada', 'no_cerrada', ['estado' => $f['estado']]);
        }
        $t = ahora();
        $pdo->prepare("UPDATE pruebas SET estado = 'borrador', cerrada_en = NULL, devuelta_en = ?, devuelta_por = ?, devuelta_motivo = ?, actualizado_en = ?, rev = rev + 1 WHERE uuid = ?")
            ->execute([$t, $u['id'], $motivo, $t, $uuid]);
        $pdo->commit();
        responder(revision_respuesta(prueba_o_404($uuid)));
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

/** @param array<string,mixed> $f */
function revision_respuesta(array $f): array
{
    return ['uuid' => $f['uuid'], 'rev' => (int) $f['rev'], 'estado' => $f['estado'], 'actualizado_en' => iso($f['actualizado_en'])] + revision_de($f);
}

/**
 * Datos de aprobación o devolución de una prueba, para mostrarlos en la app.
 * @param array<string,mixed> $f fila de pruebas
 */
function revision_de(array $f): array
{
    $nombre = static function ($id): ?string {
        if ($id === null) {
            return null;
        }
        $st = db()->prepare('SELECT nombre FROM usuarios WHERE id = ?');
        $st->execute([$id]);
        $n = $st->fetchColumn();
        return $n === false ? null : $n;
    };
    return [
        'aprobacion' => $f['estado'] === 'aprobada' ? ['nombre' => $nombre($f['aprobada_por']), 'fecha' => iso($f['aprobada_en'])] : null,
        'devolucion' => $f['estado'] === 'borrador' && $f['devuelta_motivo'] !== null ? ['nombre' => $nombre($f['devuelta_por']), 'fecha' => iso($f['devuelta_en']), 'motivo' => $f['devuelta_motivo']] : null,
    ];
}
