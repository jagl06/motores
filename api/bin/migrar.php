<?php
declare(strict_types=1);

// Aplica las migraciones pendientes de sql/migraciones/ en orden numérico.
// Uso (Terminal de cPanel o SSH):  php bin/migrar.php
// Sin terminal: importar sql/schema.sql en phpMyAdmin (ver DEPLOY.md).

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require __DIR__ . '/../src/nucleo.php';

$pdo = db();
$pdo->exec(
    'CREATE TABLE IF NOT EXISTS migraciones (
        numero INT UNSIGNED NOT NULL, nombre VARCHAR(120) NOT NULL, aplicada_en DATETIME NOT NULL, PRIMARY KEY (numero)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);
$hechas = array_map('intval', $pdo->query('SELECT numero FROM migraciones')->fetchAll(PDO::FETCH_COLUMN));

$archivos = glob(__DIR__ . '/../sql/migraciones/[0-9][0-9][0-9]_*.sql') ?: [];
sort($archivos);
$n = 0;
foreach ($archivos as $archivo) {
    $nombre = basename($archivo);
    $numero = (int) substr($nombre, 0, 3);
    if (in_array($numero, $hechas, true)) {
        continue;
    }
    echo "Aplicando $nombre ... ";
    // Quita comentarios de línea y separa por ';' al final de línea (las migraciones no llevan ';' dentro de textos)
    $sql = preg_replace('/^\s*--.*$/m', '', (string) file_get_contents($archivo));
    foreach (preg_split('/;\s*(\r?\n|$)/', (string) $sql) ?: [] as $sentencia) {
        if (trim($sentencia) !== '') {
            $pdo->exec($sentencia);
        }
    }
    $pdo->prepare('INSERT INTO migraciones (numero, nombre, aplicada_en) VALUES (?, ?, ?)')->execute([$numero, $nombre, ahora()]);
    echo "listo\n";
    $n++;
}
echo $n ? "$n migración(es) aplicada(s).\n" : "La base ya está al día.\n";
