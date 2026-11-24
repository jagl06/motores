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

    // Asistente de IA. La API key de Anthropic solo vive aquí: nunca en el repositorio ni en la app.
    // Con 'api_key' vacía el asistente queda apagado y la app lo indica; todo lo demás sigue funcionando.
    'anthropic' => [
        'api_key'       => '',
        'modelo'        => 'claude-sonnet-5-5',
        // Tope de la respuesta (incluye el razonamiento interno del modelo). Con 1024 la respuesta
        // termina antes del corte de 60 s del hosting; si las respuestas salen cortadas, subir a 2048.
        'max_tokens'    => 1024,
        // Consultas permitidas por usuario y por día (día de Panamá).
        'consultas_dia' => 40,
        // Equipos de medición que tiene ISELEC. El asistente los toma de aquí: al comprar o cambiar
        // un instrumento se edita esta línea, sin tocar el código. Se puede poner marca y modelo.
        'equipos'       => 'cámara termográfica, megóhmetro con función PI/DAR (aislamiento de 50 a 1000 V, resistencia con resolución de 0.1 Ω, voltaje), multímetro, pinza amperimétrica y termómetro infrarrojo. Aún no hay medidor de vibración.',
        // Profundidad de razonamiento: 'low' es rápido y barato, suficiente para consultas de campo.
        'esfuerzo'      => 'low',
        // true: si el modelo declina una consulta por sus filtros de seguridad, la API la reintenta en un modelo de respaldo.
        'respaldo'      => true,
    ],

    // true solo para diagnosticar: incluye el detalle del error en la respuesta.
    'debug' => false,
];
