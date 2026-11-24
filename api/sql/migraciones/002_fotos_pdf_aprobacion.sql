-- 002: fotos y PDF en disco (en la base solo la ruta) y devolución de pruebas por el supervisor.

-- Una fila por foto. `uuid` lo genera el teléfono: volver a subir la misma foto no la duplica.
-- `ruta` es relativa a la carpeta storage/ de config.php.
CREATE TABLE fotos (
  uuid         CHAR(36)     NOT NULL,
  prueba_uuid  CHAR(36)     NOT NULL,
  paso         VARCHAR(40)  NOT NULL,
  ruta         VARCHAR(255) NOT NULL,
  bytes        INT UNSIGNED NOT NULL,
  sha256       CHAR(64)     NOT NULL,
  ancho        SMALLINT UNSIGNED NOT NULL,
  alto         SMALLINT UNSIGNED NOT NULL,
  creado_en    DATETIME     NOT NULL,
  PRIMARY KEY (uuid),
  KEY ix_fotos_prueba (prueba_uuid),
  CONSTRAINT fk_fotos_prueba FOREIGN KEY (prueba_uuid) REFERENCES pruebas (uuid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un informe por prueba: el que generó el teléfono al cerrar y, al aprobar, su copia sellada.
CREATE TABLE pdfs (
  prueba_uuid   CHAR(36)     NOT NULL,
  version       INT UNSIGNED NOT NULL DEFAULT 1,
  ruta          VARCHAR(255) NOT NULL,
  bytes         INT UNSIGNED NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  ruta_sellado  VARCHAR(255) NULL,
  sellado_en    DATETIME     NULL,
  subido_en     DATETIME     NOT NULL,
  PRIMARY KEY (prueba_uuid),
  CONSTRAINT fk_pdfs_prueba FOREIGN KEY (prueba_uuid) REFERENCES pruebas (uuid) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE pruebas
  ADD COLUMN devuelta_en     DATETIME     NULL AFTER aprobada_en,
  ADD COLUMN devuelta_por    INT UNSIGNED NULL AFTER devuelta_en,
  ADD COLUMN devuelta_motivo VARCHAR(500) NULL AFTER devuelta_por,
  ADD KEY ix_pruebas_estado (estado, actualizado_en);
