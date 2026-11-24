<?php
declare(strict_types=1);

// Administración de usuarios desde la terminal (Terminal de cPanel o SSH).
//   php bin/usuario.php crear <usuario> "<Nombre Apellido>" <tecnico|supervisor|admin>
//   php bin/usuario.php clave <usuario>          genera una contraseña nueva y cierra sus sesiones
//   php bin/usuario.php rol <usuario> <rol>
//   php bin/usuario.php renombrar <usuario> <usuario_nuevo>   conserva clave, rol y pruebas
//   php bin/usuario.php nombre <usuario> "<Nombre Apellido>"  el nombre que sale en la app y los informes
//   php bin/usuario.php desactivar <usuario>     (activar <usuario> lo revierte)
//   php bin/usuario.php listar
// La contraseña se genera al azar y se muestra UNA sola vez: entrégala al usuario,
// que la cambia desde la app. Nunca se guarda en claro.

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/nucleo.php';
require __DIR__ . '/../src/auth.php';

function clave_al_azar(): string
{
    // 16 caracteres sin los que se confunden al dictarlos (0/O, 1/l/I)
    $abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $c = '';
    for ($i = 0; $i < 16; $i++) {
        $c .= $abc[random_int(0, strlen($abc) - 1)];
    }
    return $c;
}
function fin(string $msg, int $codigo = 0): void
{
    fwrite($codigo ? STDERR : STDOUT, $msg . "\n");
    exit($codigo);
}

[$accion, $usuario, $a3, $a4] = array_slice($argv, 1) + [null, null, null, null];
$usuario = $usuario !== null ? mb_strtolower(trim($usuario)) : null;
$pdo = db();

if ($accion === 'listar') {
    foreach ($pdo->query('SELECT usuario, nombre, rol, activo FROM usuarios ORDER BY usuario') as $u) {
        printf("%-20s %-12s %-8s %s\n", $u['usuario'], $u['rol'], $u['activo'] ? 'activo' : 'INACTIVO', $u['nombre']);
    }
    exit(0);
}
if ($usuario === null || !preg_match('/^[a-z0-9._-]{3,60}$/', $usuario)) {
    fin("Uso: php bin/usuario.php crear|clave|rol|renombrar|nombre|desactivar|activar|listar <usuario> ...\nEl usuario lleva de 3 a 60 letras minúsculas, números, punto, guion o guion bajo.", 1);
}

if ($accion === 'crear') {
    if (!$a3 || !in_array($a4, ROLES, true)) {
        fin('Uso: php bin/usuario.php crear <usuario> "<Nombre>" <' . implode('|', ROLES) . '>', 1);
    }
    $clave = clave_al_azar();
    try {
        $pdo->prepare('INSERT INTO usuarios (usuario, nombre, hash, rol, activo, creado_en) VALUES (?, ?, ?, ?, 1, ?)')
            ->execute([$usuario, mb_substr(trim($a3), 0, 120), password_hash($clave, PASSWORD_DEFAULT), $a4, ahora()]);
    } catch (PDOException $e) {
        fin($e->getCode() === '23000' ? "El usuario $usuario ya existe." : 'Error: ' . $e->getMessage(), 1);
    }
    fin("Usuario $usuario creado con rol $a4.\nContraseña inicial (se muestra una sola vez): $clave");
}

$st = $pdo->prepare('SELECT id FROM usuarios WHERE usuario = ?');
$st->execute([$usuario]);
$id = $st->fetchColumn();
if ($id === false) {
    fin("No existe el usuario $usuario.", 1);
}

switch ($accion) {
    case 'clave':
        $clave = clave_al_azar();
        $pdo->prepare('UPDATE usuarios SET hash = ? WHERE id = ?')->execute([password_hash($clave, PASSWORD_DEFAULT), $id]);
        $pdo->prepare('DELETE FROM sesiones WHERE usuario_id = ?')->execute([$id]);
        fin("Contraseña nueva de $usuario (se muestra una sola vez): $clave\nSe cerraron sus sesiones abiertas.");
    case 'rol':
        if (!in_array($a3, ROLES, true)) {
            fin('Rol no válido. Opciones: ' . implode(', ', ROLES), 1);
        }
        $pdo->prepare('UPDATE usuarios SET rol = ? WHERE id = ?')->execute([$a3, $id]);
        fin("$usuario ahora es $a3.");
    case 'renombrar':
        $nuevo = $a3 !== null ? mb_strtolower(trim($a3)) : '';
        if (!preg_match('/^[a-z0-9._-]{3,60}$/', $nuevo)) {
            fin("Uso: php bin/usuario.php renombrar <usuario> <usuario_nuevo>
El usuario lleva de 3 a 60 letras minúsculas, números, punto, guion o guion bajo.", 1);
        }
        if ($nuevo === $usuario) {
            fin("El usuario ya se llama $usuario.", 1);
        }
        try {
            $pdo->prepare('UPDATE usuarios SET usuario = ? WHERE id = ?')->execute([$nuevo, $id]);
        } catch (PDOException $e) {
            fin($e->getCode() === '23000' ? "El usuario $nuevo ya existe." : 'Error: ' . $e->getMessage(), 1);
        }
        fin("$usuario ahora entra como $nuevo, con la misma contraseña. Sus pruebas y sesiones no cambian.");
    case 'nombre':
        $nombre = mb_substr(trim((string) $a3), 0, 120);
        if ($nombre === '') {
            fin('Uso: php bin/usuario.php nombre <usuario> "<Nombre Apellido>"', 1);
        }
        $pdo->prepare('UPDATE usuarios SET nombre = ? WHERE id = ?')->execute([$nombre, $id]);
        fin("$usuario ahora se muestra como $nombre. Los informes ya generados conservan el nombre anterior.");
    case 'desactivar':
    case 'activar':
        $pdo->prepare('UPDATE usuarios SET activo = ? WHERE id = ?')->execute([$accion === 'activar' ? 1 : 0, $id]);
        if ($accion === 'desactivar') {
            $pdo->prepare('DELETE FROM sesiones WHERE usuario_id = ?')->execute([$id]);
        }
        fin("Usuario $usuario " . ($accion === 'activar' ? 'activado.' : 'desactivado y con las sesiones cerradas.'));
    default:
        fin('Acción no reconocida: ' . (string) $accion, 1);
}
