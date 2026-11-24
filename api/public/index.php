<?php
declare(strict_types=1);

// Único punto de entrada de la API. El subdominio api-motores.iselec.com.pa apunta a esta carpeta;
// config.php, src/, sql/ y storage/ quedan un nivel arriba, fuera del alcance del servidor web.

require __DIR__ . '/../src/nucleo.php';
require __DIR__ . '/../src/auth.php';
require __DIR__ . '/../src/pruebas.php';
require __DIR__ . '/../src/archivos.php';
require __DIR__ . '/../src/revision.php';
require __DIR__ . '/../src/historial.php';
require __DIR__ . '/../src/asistente.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

try {
    cors();
    $metodo = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $ruta = ruta();

    // [método, expresión de la ruta, función]
    $rutas = [
        ['GET',  '#^/$#',                              static fn() => responder(['api' => 'motores-iselec', 'ok' => true])],
        ['GET',  '#^/salud$#',                         static function () { db()->query('SELECT 1'); responder(['ok' => true, 'hora' => iso(ahora())]); }],
        ['POST', '#^/auth/login$#',                    'auth_login'],
        ['POST', '#^/auth/logout$#',                   'auth_logout'],
        ['GET',  '#^/auth/yo$#',                       'auth_yo'],
        ['POST', '#^/auth/clave$#',                    'auth_clave'],
        ['GET',  '#^/pruebas$#',                       'pruebas_listar'],
        ['GET',  '#^/pruebas/([0-9a-fA-F-]{36})$#',        'pruebas_obtener'],
        ['PUT',  '#^/pruebas/([0-9a-fA-F-]{36})$#',        'pruebas_guardar'],
        ['POST', '#^/pruebas/([0-9a-fA-F-]{36})/cerrar$#', 'pruebas_cerrar'],
        ['POST', '#^/pruebas/([0-9a-fA-F-]{36})/fotos$#',  'fotos_subir'],
        ['GET',  '#^/pruebas/([0-9a-fA-F-]{36})/fotos/([0-9a-fA-F-]{36})$#', 'fotos_obtener'],
        ['POST', '#^/pruebas/([0-9a-fA-F-]{36})/pdf$#',    'pdf_subir'],
        ['GET',  '#^/pruebas/([0-9a-fA-F-]{36})/pdf$#',    'pdf_obtener'],
        ['POST', '#^/pruebas/([0-9a-fA-F-]{36})/aprobar$#',  'pruebas_aprobar'],
        ['POST', '#^/pruebas/([0-9a-fA-F-]{36})/devolver$#', 'pruebas_devolver'],
        ['POST', '#^/asistente$#',                     'asistente_consulta'],
        ['GET',  '#^/asistente/uso$#',                 'asistente_uso'],
        ['GET',  '#^/motores/historial$#',             'motores_historial'],
        ['GET',  '#^/motores/([^/]{1,80})/historial$#', 'motores_historial'],
    ];

    $existe = false;
    foreach ($rutas as [$m, $re, $fn]) {
        if (preg_match($re, $ruta, $p)) {
            $existe = true;
            if ($m === $metodo) {
                $fn(...array_slice($p, 1));
            }
        }
    }
    throw $existe
        ? new ErrorHttp(405, 'Método no permitido', 'metodo')
        : new ErrorHttp(404, 'Ruta no encontrada', 'ruta');
} catch (ErrorHttp $e) {
    responder(['error' => $e->getMessage(), 'codigo' => $e->codigo] + $e->extra, $e->estado);
} catch (Throwable $e) {
    error_log('[motores-api] ' . get_class($e) . ': ' . $e->getMessage() . ' en ' . $e->getFile() . ':' . $e->getLine());
    $debug = false;
    try { $debug = (bool) (cfg()['debug'] ?? false); } catch (Throwable $x) { /* sin config */ }
    responder(['error' => 'Error interno del servidor', 'codigo' => 'interno'] + ($debug ? ['detalle' => $e->getMessage()] : []), 500);
}
