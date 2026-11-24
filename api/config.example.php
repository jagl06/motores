<?php
// Copiar como config.php (junto a este archivo, FUERA de public/) y completar.
// config.php está en .gitignore: nunca se sube al repositorio.
return [
    'db' => [
        // En cPanel el nombre de la base y del usuario llevan el prefijo de la cuenta.
        'dsn'     => 'mysql:host=localhost;dbname=CUENTA_motores;charset=utf8mb4',
        'usuario' => 'CUENTA_motores',
        'clave'   => '',
    ],

    // Orígenes que pueden llamar a la API (CORS). Solo la app publicada.
    'origenes' => ['https://motores.iselec.com.pa'],

    // Días de vigencia del token de sesión.
    'sesion_dias' => 30,

    // Freno a la fuerza bruta: intentos fallidos permitidos por usuario o por IP en la ventana.
    'login_max_intentos' => 8,
    'login_ventana_min'  => 15,

    // Carpeta de fotos y PDFs (etapa 3). Debe quedar fuera de public/.
    'storage' => __DIR__ . '/storage',

    // Asistente (etapa 4). La key de Anthropic solo vive aquí.
    'anthropic' => [
        'api_key'       => '',
        'modelo'        => 'claude-sonnet-5-5',
        'max_tokens'    => 1024,
        'consultas_dia' => 40,
    ],

    // true solo para diagnosticar: incluye el detalle del error en la respuesta.
    'debug' => false,
];
