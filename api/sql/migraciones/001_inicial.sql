-- 001: esquema inicial (etapa 2: usuarios, sesiones, motores y pruebas)
-- MySQL 8, InnoDB, utf8mb4. Sin triggers, procedimientos ni eventos (el hosting no da SUPER).
-- Todas las fechas se guardan en UTC.

CREATE TABLE usuarios (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario     VARCHAR(60)  NOT NULL,
  nombre      VARCHAR(120) NOT NULL,
  hash        VARCHAR(255) NOT NULL,
  rol         ENUM('tecnico','supervisor','admin') NOT NULL DEFAULT 'tecnico',
  activo      TINYINT(1)   NOT NULL DEFAULT 1,
  creado_en   DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_usuario (usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Del token solo se guarda su SHA-256: una copia de la base no sirve para entrar.
CREATE TABLE sesiones (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token_hash  CHAR(64)     NOT NULL,
  usuario_id  INT UNSIGNED NOT NULL,
  creado_en   DATETIME     NOT NULL,
  vence_en    DATETIME     NOT NULL,
  ultimo_uso  DATETIME     NOT NULL,
  agente      VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sesiones_token (token_hash),
  KEY ix_sesiones_vence (vence_en),
  CONSTRAINT fk_sesiones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Intentos fallidos de inicio de sesión, para frenar la fuerza bruta.
CREATE TABLE intentos_login (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario     VARCHAR(60)  NOT NULL,
  ip          VARCHAR(45)  NOT NULL,
  creado_en   DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY ix_intentos_usuario (usuario, creado_en),
  KEY ix_intentos_ip (ip, creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un motor se identifica por `clave`: "S:<serie>" si hay serie; si no, "T:<cliente>|<tag>".
CREATE TABLE motores (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  clave           VARCHAR(190) NOT NULL,
  cliente         VARCHAR(160) NULL,
  serie           VARCHAR(80)  NULL,
  tag             VARCHAR(80)  NULL,
  fabricante      VARCHAR(80)  NULL,
  modelo          VARCHAR(80)  NULL,
  hp              VARCHAR(20)  NULL,
  kw              VARCHAR(20)  NULL,
  creado_en       DATETIME     NOT NULL,
  actualizado_en  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_motores_clave (clave),
  KEY ix_motores_serie (serie),
  KEY ix_motores_tag (tag)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- `datos` es la prueba completa tal como la guarda el teléfono; las columnas sueltas
-- son copias para filtrar y listar. `rev` sube en cada guardado (control de conflictos).
-- `resumen` trae IR a 40 °C, PI, DAR y resistencias, calculados en el cliente (historial, etapa 5).
CREATE TABLE pruebas (
  uuid            CHAR(36)     NOT NULL,
  motor_id        INT UNSIGNED NULL,
  tecnico_id      INT UNSIGNED NOT NULL,
  estado          ENUM('borrador','cerrada','aprobada') NOT NULL DEFAULT 'borrador',
  rev             INT UNSIGNED NOT NULL DEFAULT 1,
  datos_hash      CHAR(64)     NOT NULL,
  cliente         VARCHAR(160) NULL,
  tag             VARCHAR(80)  NULL,
  serie           VARCHAR(80)  NULL,
  orden           VARCHAR(80)  NULL,
  fecha           DATE         NULL,
  dictamen        VARCHAR(40)  NULL,
  datos           JSON         NOT NULL,
  resumen         JSON         NULL,
  cerrada_en      DATETIME     NULL,
  aprobada_por    INT UNSIGNED NULL,
  aprobada_en     DATETIME     NULL,
  creado_en       DATETIME     NOT NULL,
  actualizado_en  DATETIME     NOT NULL,
  PRIMARY KEY (uuid),
  KEY ix_pruebas_tecnico (tecnico_id, actualizado_en),
  KEY ix_pruebas_motor (motor_id, fecha),
  KEY ix_pruebas_cliente (cliente),
  KEY ix_pruebas_fecha (fecha),
  CONSTRAINT fk_pruebas_motor    FOREIGN KEY (motor_id)     REFERENCES motores (id)  ON DELETE SET NULL,
  CONSTRAINT fk_pruebas_tecnico  FOREIGN KEY (tecnico_id)   REFERENCES usuarios (id),
  CONSTRAINT fk_pruebas_aprobo   FOREIGN KEY (aprobada_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
