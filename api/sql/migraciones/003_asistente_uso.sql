-- 003: consumo del asistente de IA por usuario y por día (día calendario de Panamá).
-- Sirve para aplicar el límite diario de consultas y para controlar el costo.

CREATE TABLE asistente_uso (
  usuario_id            INT UNSIGNED NOT NULL,
  fecha                 DATE         NOT NULL,
  consultas             INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_entrada        INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_salida         INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_cache_lectura  INT UNSIGNED NOT NULL DEFAULT 0,
  tokens_cache_escritura INT UNSIGNED NOT NULL DEFAULT 0,
  actualizado_en        DATETIME     NOT NULL,
  PRIMARY KEY (usuario_id, fecha),
  KEY ix_asistente_fecha (fecha),
  CONSTRAINT fk_asistente_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
