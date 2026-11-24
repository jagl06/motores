<?php
declare(strict_types=1);

// Pruebas: el técnico edita las suyas hasta cerrarlas; supervisor y administrador las leen todas.
// La sincronización es idempotente: el uuid lo genera el teléfono y repetir un PUT no duplica nada.

const DICTAMENES = ['Apto para operar', 'Apto con observaciones', 'No apto'];
const MAX_DATOS_BYTES = 1048576; // 1 MB: la prueba va sin fotos (cada foto se sube aparte, etapa 3)

function exigir_uuid(string $uuid): string
{
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $uuid)) {
        throw new ErrorHttp(400, 'Identificador de prueba no válido', 'uuid_invalido');
    }
    return strtolower($uuid);
}

function puede_ver(array $u, array $fila): bool
{
    return $u['rol'] !== 'tecnico' || (int) $fila['tecnico_id'] === $u['id'];
}

/** Clave que identifica al motor: serie si existe; si no, cliente + TAG. */
function clave_motor(?string $cliente, ?string $serie, ?string $tag): ?string
{
    $norm = static fn(?string $t): string => mb_strtoupper(preg_replace('/[\s\-_.\/]+/u', '', (string) $t) ?? '');
    if ($norm($serie) !== '') {
        return mb_substr('S:' . $norm($serie), 0, 190);
    }
    if ($norm($tag) !== '' && $norm($cliente) !== '') {
        return mb_substr('T:' . $norm($cliente) . '|' . $norm($tag), 0, 190);
    }
    return null;
}

/**
 * Crea o actualiza el motor de la prueba y devuelve su id (null si no hay cómo identificarlo).
 * @param array<string,mixed> $v valores de la prueba
 */
function upsert_motor(array $v): ?int
{
    $cliente = texto($v['cliente'] ?? null, 160);
    $serie   = texto($v['serie'] ?? null, 80);
    $tag     = texto($v['tag'] ?? null, 80);
    $clave   = clave_motor($cliente, $serie, $tag);
    if ($clave === null) {
        return null;
    }
    $t = ahora();
    db()->prepare(
        'INSERT INTO motores (clave, cliente, serie, tag, fabricante, modelo, hp, kw, creado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE cliente = VALUES(cliente), serie = VALUES(serie), tag = VALUES(tag), fabricante = VALUES(fabricante),
                                 modelo = VALUES(modelo), hp = VALUES(hp), kw = VALUES(kw), actualizado_en = VALUES(actualizado_en)'
    )->execute([$clave, $cliente, $serie, $tag, texto($v['fab'] ?? null, 80), texto($v['modelo'] ?? null, 80), texto($v['hp'] ?? null, 20), texto($v['kw'] ?? null, 20), $t, $t]);
    $st = db()->prepare('SELECT id FROM motores WHERE clave = ?');
    $st->execute([$clave]);
    return (int) $st->fetchColumn();
}

function fecha_valida($f): ?string
{
    return is_string($f) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) && strtotime($f) !== false ? $f : null;
}

/** @param array<string,mixed> $f fila de `pruebas` */
function prueba_resumida(array $f): array
{
    return [
        'uuid' => $f['uuid'], 'rev' => (int) $f['rev'], 'estado' => $f['estado'],
        'cliente' => $f['cliente'], 'tag' => $f['tag'], 'serie' => $f['serie'], 'orden' => $f['orden'],
        'fecha' => $f['fecha'], 'dictamen' => $f['dictamen'],
        'tecnico' => $f['tecnico_nombre'] ?? null, 'tecnico_id' => (int) $f['tecnico_id'],
        'actualizado_en' => iso($f['actualizado_en']),
    ];
}

// GET /pruebas?motor=&cliente=&desde=&estado=
function pruebas_listar(): void
{
    $u = usuario_actual();
    $cond = []; $par = [];
    if ($u['rol'] === 'tecnico') {
        $cond[] = 'p.tecnico_id = ?'; $par[] = $u['id'];
    }
    $like = static fn(string $t): string => '%' . addcslashes(mb_substr($t, 0, 80), '%_\\') . '%';
    if (($m = trim((string) ($_GET['motor'] ?? ''))) !== '') {
        $cond[] = '(p.serie LIKE ? OR p.tag LIKE ?)'; $par[] = $like($m); $par[] = $like($m);
    }
    if (($c = trim((string) ($_GET['cliente'] ?? ''))) !== '') {
        $cond[] = 'p.cliente LIKE ?'; $par[] = $like($c);
    }
    if (($d = fecha_valida($_GET['desde'] ?? null)) !== null) {
        $cond[] = 'p.fecha >= ?'; $par[] = $d;
    }
    if (in_array($_GET['estado'] ?? '', ['borrador', 'cerrada', 'aprobada'], true)) {
        $cond[] = 'p.estado = ?'; $par[] = $_GET['estado'];
    }
    $sql = 'SELECT p.uuid, p.rev, p.estado, p.cliente, p.tag, p.serie, p.orden, p.fecha, p.dictamen, p.tecnico_id, p.actualizado_en, u.nombre AS tecnico_nombre
              FROM pruebas p JOIN usuarios u ON u.id = p.tecnico_id'
         . ($cond ? ' WHERE ' . implode(' AND ', $cond) : '')
         . ' ORDER BY p.actualizado_en DESC LIMIT 300';
    $st = db()->prepare($sql);
    $st->execute($par);
    responder(['pruebas' => array_map('prueba_resumida', $st->fetchAll())]);
}

/** @return array<string,mixed> */
function prueba_o_404(string $uuid, bool $bloquear = false): array
{
    $st = db()->prepare(
        'SELECT p.*, u.nombre AS tecnico_nombre FROM pruebas p JOIN usuarios u ON u.id = p.tecnico_id WHERE p.uuid = ?' . ($bloquear ? ' FOR UPDATE' : '')
    );
    $st->execute([$uuid]);
    $f = $st->fetch();
    if (!$f) {
        throw new ErrorHttp(404, 'La prueba no existe en el servidor', 'no_existe');
    }
    return $f;
}

/** @param array<string,mixed> $f */
function prueba_completa(array $f): array
{
    return prueba_resumida($f) + [
        'datos' => json_decode($f['datos']), // como objeto: conserva {} vacíos
        'cerrada_en' => iso($f['cerrada_en']),
        'aprobada_en' => iso($f['aprobada_en']),
    ];
}

// GET /pruebas/{uuid}
function pruebas_obtener(string $uuid): void
{
    $u = usuario_actual();
    $f = prueba_o_404(exigir_uuid($uuid));
    if (!puede_ver($u, $f)) {
        throw new ErrorHttp(403, 'Esta prueba es de otro técnico', 'ajena');
    }
    responder(prueba_completa($f));
}

// PUT /pruebas/{uuid}  { rev, datos, resumen?, cerrar? }
//   rev    = revisión del servidor sobre la que trabajó el teléfono (0 si nunca se ha subido)
//   cerrar = true para guardar y cerrar en la misma operación (cierre hecho sin conexión)
// 200 guardada · 409 conflicto (trae la versión del servidor) · 409 cerrada · 403 ajena
function pruebas_guardar(string $uuid): void
{
    $u = usuario_actual();
    $uuid = exigir_uuid($uuid);
    $c = cuerpo(MAX_DATOS_BYTES + 65536);
    $datos = $c['datos'] ?? null;
    if (!is_array($datos) || !is_array($datos['v'] ?? null)) {
        throw new ErrorHttp(422, 'Faltan los datos de la prueba', 'datos_invalidos');
    }
    $revBase = (int) ($c['rev'] ?? 0);
    $cerrar  = ($c['cerrar'] ?? false) === true;
    // Lo que se guarda sale de la forma "objeto" del cuerpo, para conservar {} como {} (ver cuerpo_objeto)
    $obj = cuerpo_objeto();
    $resumen = is_array($c['resumen'] ?? null) ? json_encode($obj->resumen, JSON_UNESCAPED_UNICODE) : null;
    $guardar = $obj->datos;
    foreach (['dirty', 'conflicto', 'rev', 'estado', 'fotosData', 'sample'] as $k) {
        unset($guardar->$k);
    }
    $guardar->uuid = $uuid;
    $json = json_encode($guardar, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || strlen($json) > MAX_DATOS_BYTES) {
        throw new ErrorHttp(413, 'La prueba es demasiado grande', 'muy_grande');
    }
    $hash = hash('sha256', $json);
    $v = $datos['v'];
    $dictamen = in_array($v['dictamen'] ?? '', DICTAMENES, true) ? $v['dictamen'] : null;
    if ($cerrar && $dictamen === null) {
        throw new ErrorHttp(422, 'Para cerrar la prueba hay que elegir el dictamen', 'sin_dictamen');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('SELECT uuid, tecnico_id, estado, rev, datos_hash, datos, actualizado_en FROM pruebas WHERE uuid = ? FOR UPDATE');
        $st->execute([$uuid]);
        $act = $st->fetch();
        $t = ahora();
        $cols = [
            'motor_id' => upsert_motor($v), 'datos_hash' => $hash,
            'cliente' => texto($v['cliente'] ?? null, 160), 'tag' => texto($v['tag'] ?? null, 80), 'serie' => texto($v['serie'] ?? null, 80),
            'orden' => texto($v['ot'] ?? null, 80), 'fecha' => fecha_valida($v['fecha'] ?? null), 'dictamen' => $dictamen,
            'datos' => $json, 'resumen' => $resumen, 'actualizado_en' => $t,
        ];

        if (!$act) {
            $cols += ['uuid' => $uuid, 'tecnico_id' => $u['id'], 'estado' => $cerrar ? 'cerrada' : 'borrador', 'rev' => 1,
                      'cerrada_en' => $cerrar ? $t : null, 'creado_en' => $t];
            $pdo->prepare('INSERT INTO pruebas (' . implode(', ', array_keys($cols)) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')')
                ->execute(array_values($cols));
            $pdo->commit();
            responder(['uuid' => $uuid, 'rev' => 1, 'estado' => $cols['estado'], 'actualizado_en' => iso($t)], 201);
        }

        if ((int) $act['tecnico_id'] !== $u['id']) {
            throw new ErrorHttp(403, 'Esta prueba es de otro técnico', 'ajena');
        }
        $igual = hash_equals($act['datos_hash'], $hash);
        $rev = (int) $act['rev'];

        if ($act['estado'] !== 'borrador') {
            // Reintento de un guardado que ya había llegado: se responde igual, sin tocar nada.
            if ($igual) {
                $pdo->commit();
                responder(['uuid' => $uuid, 'rev' => $rev, 'estado' => $act['estado'], 'actualizado_en' => iso($act['actualizado_en'])]);
            }
            throw new ErrorHttp(409, 'La prueba ya está cerrada en el servidor y no admite cambios', 'cerrada', ['estado' => $act['estado'], 'rev' => $rev]);
        }

        if ($revBase !== $rev && !$igual) {
            throw new ErrorHttp(409, 'La prueba cambió en el servidor desde otro equipo', 'conflicto', [
                'servidor' => ['rev' => $rev, 'estado' => $act['estado'], 'datos' => json_decode($act['datos']), 'actualizado_en' => iso($act['actualizado_en'])],
            ]);
        }

        if ($igual && !$cerrar) { // mismo contenido: reintento, no sube la revisión
            $pdo->commit();
            responder(['uuid' => $uuid, 'rev' => $rev, 'estado' => 'borrador', 'actualizado_en' => iso($act['actualizado_en'])]);
        }

        $cols += ['rev' => $rev + 1];
        if ($cerrar) {
            $cols += ['estado' => 'cerrada', 'cerrada_en' => $t];
        }
        $set = implode(', ', array_map(static fn(string $k): string => "$k = ?", array_keys($cols)));
        $pdo->prepare("UPDATE pruebas SET $set WHERE uuid = ?")->execute([...array_values($cols), $uuid]);
        $pdo->commit();
        responder(['uuid' => $uuid, 'rev' => $rev + 1, 'estado' => $cerrar ? 'cerrada' : 'borrador', 'actualizado_en' => iso($t)]);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

// POST /pruebas/{uuid}/cerrar — el técnico da por terminada su prueba; desde aquí solo se lee
function pruebas_cerrar(string $uuid): void
{
    $u = usuario_actual();
    $uuid = exigir_uuid($uuid);
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $f = prueba_o_404($uuid, true);
        if ((int) $f['tecnico_id'] !== $u['id']) {
            throw new ErrorHttp(403, 'Esta prueba es de otro técnico', 'ajena');
        }
        if ($f['estado'] === 'borrador') {
            if ($f['dictamen'] === null) {
                throw new ErrorHttp(422, 'Para cerrar la prueba hay que elegir el dictamen', 'sin_dictamen');
            }
            $t = ahora();
            $pdo->prepare("UPDATE pruebas SET estado = 'cerrada', cerrada_en = ?, actualizado_en = ?, rev = rev + 1 WHERE uuid = ?")->execute([$t, $t, $uuid]);
            $f = prueba_o_404($uuid);
        }
        $pdo->commit();
        responder(['uuid' => $uuid, 'rev' => (int) $f['rev'], 'estado' => $f['estado'], 'actualizado_en' => iso($f['actualizado_en'])]);
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}
