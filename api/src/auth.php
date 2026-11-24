<?php
declare(strict_types=1);

// Autenticación: usuario y contraseña (password_hash), token de sesión con vencimiento en MySQL.

const ROLES = ['tecnico', 'supervisor', 'admin'];

function token_de_cabecera(): ?string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($h === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) {
            if (strcasecmp($k, 'Authorization') === 0) {
                $h = $v;
                break;
            }
        }
    }
    return preg_match('/^Bearer\s+([A-Za-z0-9]{32,128})$/', trim($h), $m) ? $m[1] : null;
}

/**
 * Usuario de la sesión vigente o error 401.
 * @return array{id:int,usuario:string,nombre:string,rol:string,sesion_id:int}
 */
function usuario_actual(): array
{
    $token = token_de_cabecera();
    if ($token === null) {
        throw new ErrorHttp(401, 'Inicia sesión', 'sin_sesion');
    }
    $st = db()->prepare(
        'SELECT u.id, u.usuario, u.nombre, u.rol, s.id AS sesion_id, s.ultimo_uso
           FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
          WHERE s.token_hash = ? AND s.vence_en > ? AND u.activo = 1'
    );
    $st->execute([hash('sha256', $token), ahora()]);
    $u = $st->fetch();
    if (!$u) {
        throw new ErrorHttp(401, 'La sesión venció. Inicia sesión de nuevo', 'sesion_vencida');
    }
    // Marca de último uso, como mucho una escritura cada 10 minutos por sesión
    if ($u['ultimo_uso'] < ahora(-600)) {
        db()->prepare('UPDATE sesiones SET ultimo_uso = ? WHERE id = ?')->execute([ahora(), $u['sesion_id']]);
    }
    return ['id' => (int) $u['id'], 'usuario' => $u['usuario'], 'nombre' => $u['nombre'], 'rol' => $u['rol'], 'sesion_id' => (int) $u['sesion_id']];
}

/** @param array<string,mixed> $u */
function usuario_publico(array $u): array
{
    return ['id' => (int) $u['id'], 'usuario' => $u['usuario'], 'nombre' => $u['nombre'], 'rol' => $u['rol']];
}

function exigir_clave_valida(string $clave): void
{
    if (strlen($clave) < 10 || strlen($clave) > 200) {
        throw new ErrorHttp(422, 'La contraseña debe tener al menos 10 caracteres', 'clave_debil');
    }
}

// POST /auth/login  { usuario, clave }
function auth_login(): void
{
    $c = cuerpo(4096);
    $usuario = mb_strtolower(trim((string) ($c['usuario'] ?? '')));
    $clave   = (string) ($c['clave'] ?? '');
    if ($usuario === '' || $clave === '' || mb_strlen($usuario) > 60 || strlen($clave) > 200) {
        throw new ErrorHttp(400, 'Escribe usuario y contraseña', 'faltan_datos');
    }

    $conf = cfg();
    $desde = ahora(-60 * (int) ($conf['login_ventana_min'] ?? 15));
    $max   = (int) ($conf['login_max_intentos'] ?? 8);
    $ip    = ip_cliente();
    $st = db()->prepare('SELECT SUM(usuario = ?) AS por_usuario, SUM(ip = ?) AS por_ip FROM intentos_login WHERE creado_en > ? AND (usuario = ? OR ip = ?)');
    $st->execute([$usuario, $ip, $desde, $usuario, $ip]);
    $n = $st->fetch();
    // Por IP se tolera más: varios técnicos pueden salir por la misma red.
    if ((int) $n['por_usuario'] >= $max || (int) $n['por_ip'] >= $max * 4) {
        throw new ErrorHttp(429, 'Demasiados intentos. Espera unos minutos', 'demasiados_intentos');
    }

    $st = db()->prepare('SELECT id, usuario, nombre, rol, hash, activo FROM usuarios WHERE usuario = ?');
    $st->execute([$usuario]);
    $u = $st->fetch();
    // Si el usuario no existe se gasta el mismo trabajo de cómputo, para que el tiempo de respuesta no lo delate.
    if ($u) {
        $ok = password_verify($clave, $u['hash']) && (int) $u['activo'] === 1;
    } else {
        password_hash($clave, PASSWORD_DEFAULT);
        $ok = false;
    }
    if (!$ok) {
        db()->prepare('INSERT INTO intentos_login (usuario, ip, creado_en) VALUES (?, ?, ?)')->execute([$usuario, $ip, ahora()]);
        throw new ErrorHttp(401, 'Usuario o contraseña incorrectos', 'credenciales');
    }

    if (password_needs_rehash($u['hash'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE usuarios SET hash = ? WHERE id = ?')->execute([password_hash($clave, PASSWORD_DEFAULT), $u['id']]);
    }
    db()->prepare('DELETE FROM intentos_login WHERE usuario = ?')->execute([$usuario]);

    $token = bin2hex(random_bytes(32));
    $vence = ahora(86400 * (int) ($conf['sesion_dias'] ?? 30));
    db()->prepare('INSERT INTO sesiones (token_hash, usuario_id, creado_en, vence_en, ultimo_uso, agente) VALUES (?, ?, ?, ?, ?, ?)')
        ->execute([hash('sha256', $token), $u['id'], ahora(), $vence, ahora(), texto($_SERVER['HTTP_USER_AGENT'] ?? '', 255)]);

    responder(['token' => $token, 'vence_en' => iso($vence), 'usuario' => usuario_publico($u)]);
}

// POST /auth/logout
function auth_logout(): void
{
    $u = usuario_actual();
    db()->prepare('DELETE FROM sesiones WHERE id = ?')->execute([$u['sesion_id']]);
    responder(['ok' => true]);
}

// GET /auth/yo
function auth_yo(): void
{
    responder(['usuario' => usuario_publico(usuario_actual())]);
}

// POST /auth/clave  { actual, nueva }  — cambia la contraseña y cierra las demás sesiones
function auth_clave(): void
{
    $u = usuario_actual();
    $c = cuerpo(4096);
    $actual = (string) ($c['actual'] ?? '');
    $nueva  = (string) ($c['nueva'] ?? '');
    exigir_clave_valida($nueva);
    $st = db()->prepare('SELECT hash FROM usuarios WHERE id = ?');
    $st->execute([$u['id']]);
    if (!password_verify($actual, (string) $st->fetchColumn())) {
        throw new ErrorHttp(401, 'La contraseña actual no coincide', 'credenciales');
    }
    db()->prepare('UPDATE usuarios SET hash = ? WHERE id = ?')->execute([password_hash($nueva, PASSWORD_DEFAULT), $u['id']]);
    db()->prepare('DELETE FROM sesiones WHERE usuario_id = ? AND id <> ?')->execute([$u['id'], $u['sesion_id']]);
    responder(['ok' => true]);
}
