<?php
declare(strict_types=1);

// Núcleo de la API: configuración, base de datos, respuestas JSON y CORS.
// PHP plano con PDO y consultas preparadas; sin dependencias.

final class ErrorHttp extends RuntimeException
{
    /** @param array<string,mixed> $extra */
    public function __construct(public int $estado, string $mensaje, public string $codigo = 'error', public array $extra = [])
    {
        parent::__construct($mensaje);
    }
}

/** @return array<string,mixed> */
function cfg(): array
{
    static $c = null;
    if ($c === null) {
        $ruta = dirname(__DIR__) . '/config.php';
        if (!is_file($ruta)) {
            throw new RuntimeException('Falta api/config.php (copiar de config.example.php)');
        }
        $c = require $ruta;
    }
    return $c;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $d = cfg()['db'];
        $pdo = new PDO($d['dsn'], $d['usuario'], $d['clave'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

/** Fecha y hora UTC en formato DATETIME de MySQL. */
function ahora(int $masSegundos = 0): string
{
    return gmdate('Y-m-d H:i:s', time() + $masSegundos);
}

/** DATETIME UTC de MySQL → ISO 8601 con Z, para el cliente. */
function iso(?string $dt): ?string
{
    return $dt === null ? null : str_replace(' ', 'T', $dt) . 'Z';
}

/** @param mixed $datos */
function responder($datos, int $estado = 200): void
{
    http_response_code($estado);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Cuerpo JSON de la petición como arreglo asociativo.
 * @return array<string,mixed>
 */
function cuerpo(int $maxBytes = 1048576): array
{
    $crudo = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($crudo === false || $crudo === '') {
        return [];
    }
    if (strlen($crudo) > $maxBytes) {
        throw new ErrorHttp(413, 'La petición es demasiado grande', 'muy_grande');
    }
    $d = json_decode($crudo, true, 64);
    if (!is_array($d)) {
        throw new ErrorHttp(400, 'El cuerpo no es JSON válido', 'json_invalido');
    }
    cuerpo_objeto(json_decode($crudo, false, 64));
    return $d;
}

/**
 * El mismo cuerpo decodificado como objetos (stdClass). Se usa para lo que se guarda tal cual:
 * como arreglo asociativo, PHP no distingue {} de [] y un objeto vacío volvería al teléfono como lista.
 * @param mixed $nuevo
 * @return mixed
 */
function cuerpo_objeto($nuevo = null)
{
    static $o = null;
    if ($nuevo !== null) {
        $o = $nuevo;
    }
    return $o;
}

/** CORS limitado a los orígenes configurados. Responde aquí mismo las peticiones OPTIONS. */
function cors(): void
{
    $origen = $_SERVER['HTTP_ORIGIN'] ?? '';
    header('Vary: Origin');
    if ($origen !== '' && in_array($origen, cfg()['origenes'] ?? [], true)) {
        header('Access-Control-Allow-Origin: ' . $origen);
        header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
        header('Access-Control-Allow-Headers: Authorization, Content-Type');
        header('Access-Control-Max-Age: 600');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

/** Ruta pedida, relativa a la carpeta pública y sin query: "/pruebas/abc". */
function ruta(): string
{
    $uri  = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    if ($base !== '' && str_starts_with($uri, $base)) {
        $uri = substr($uri, strlen($base));
    }
    if (str_starts_with($uri, '/index.php')) {
        $uri = substr($uri, strlen('/index.php'));
    }
    $uri = '/' . trim(rawurldecode($uri), '/');
    return $uri;
}

function ip_cliente(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

/** Recorta un texto a la longitud de su columna; vacío → null. */
function texto($v, int $max): ?string
{
    if (!is_scalar($v)) {
        return null;
    }
    $t = trim((string) $v);
    return $t === '' ? null : mb_substr($t, 0, $max);
}
