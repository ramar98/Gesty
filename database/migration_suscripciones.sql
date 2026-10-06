ALTER TABLE empresas
  ADD COLUMN suscripcion_vence DATETIME NULL DEFAULT NULL;

CREATE TABLE codigos_promocionales (
  id int NOT NULL AUTO_INCREMENT,
  codigo varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  tipo enum('MESES_GRATIS','DESCUENTO') COLLATE utf8mb4_unicode_ci NOT NULL,
  meses_gratis int DEFAULT NULL,
  descuento_porcentaje decimal(5,2) DEFAULT NULL,
  usos_maximos int NOT NULL DEFAULT 1,
  usos int NOT NULL DEFAULT 0,
  activo tinyint(1) NOT NULL DEFAULT 1,
  expira_en datetime DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_codigos_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE pagos_suscripcion (
  id int NOT NULL AUTO_INCREMENT,
  empresa_id int NOT NULL,
  codigo_id int DEFAULT NULL,
  mp_preference_id varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  mp_payment_id varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  monto decimal(12,2) NOT NULL,
  meses int NOT NULL DEFAULT 1,
  estado enum('PENDIENTE','APROBADO','RECHAZADO') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDIENTE',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pagado_at datetime DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pagos_mp_payment (mp_payment_id),
  KEY idx_pagos_empresa (empresa_id),
  CONSTRAINT fk_pagos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas (id),
  CONSTRAINT fk_pagos_codigo FOREIGN KEY (codigo_id) REFERENCES codigos_promocionales (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO roles (nombre) VALUES ('Superadmin');
