// ============================================================
//  lib/migrate.js — Estructura de la base de datos
//
//  Se ejecuta al arrancar el servidor. Es IDEMPOTENTE:
//   • En una BD vacía crea todo desde cero.
//   • En una BD existente solo agrega lo que falta,
//     sin borrar ni modificar datos.
// ============================================================
'use strict';

const bcrypt = require('bcryptjs');
const { pool } = require('./db');
const cfg = require('../config/app');

const TABLES = [
`CREATE TABLE IF NOT EXISTS ROLES (
  id_rol   INT PRIMARY KEY,
  nombre   VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

`CREATE TABLE IF NOT EXISTS USUARIOS (
  id_usuario    INT AUTO_INCREMENT PRIMARY KEY,
  nombre        VARCHAR(120) NOT NULL,
  usuario       VARCHAR(60) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  id_rol        INT NOT NULL,
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (id_rol) REFERENCES ROLES(id_rol)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

`CREATE TABLE IF NOT EXISTS SECUENCIAS (
  nombre VARCHAR(40) PRIMARY KEY,
  valor  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

`CREATE TABLE IF NOT EXISTS CONFIGURACION (
  clave VARCHAR(60) PRIMARY KEY,
  valor TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// Tipos de vehículo (nombre e ícono). La tarifa es una sola para todos y vive en
// CONFIGURACION (tarifa_hora); las columnas de precio de esta tabla ya no se usan.
`CREATE TABLE IF NOT EXISTS TARIFAS (
  id_tarifa       INT AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(40) NOT NULL,
  icono           VARCHAR(10) NOT NULL DEFAULT '🚗',
  precio_hora     DECIMAL(10,2) NOT NULL DEFAULT 0,
  precio_fraccion DECIMAL(10,2) NOT NULL DEFAULT 0,
  min_fraccion    INT NOT NULL DEFAULT 15,
  tope_dia        DECIMAL(10,2) NOT NULL DEFAULT 0,
  orden           INT NOT NULL DEFAULT 0,
  activo          TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

`CREATE TABLE IF NOT EXISTS PENSIONES (
  id_pension  INT AUTO_INCREMENT PRIMARY KEY,
  cliente     VARCHAR(120) NOT NULL,
  telefono    VARCHAR(30) NULL,
  placas      VARCHAR(20) NOT NULL,
  descripcion VARCHAR(120) NULL,
  mensualidad DECIMAL(10,2) NOT NULL DEFAULT 0,
  vence       DATE NOT NULL,
  notas       VARCHAR(255) NULL,
  activo      TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pen_placas (placas)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

`CREATE TABLE IF NOT EXISTS CAJA_SESIONES (
  id_sesion     INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario    INT NOT NULL,
  turno         VARCHAR(10) NOT NULL,
  fondo_inicial DECIMAL(10,2) NOT NULL DEFAULT 0,
  cerrada       TINYINT(1) NOT NULL DEFAULT 0,
  abierta_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cerrada_at    DATETIME,
  notas_cierre  TEXT,
  efectivo_esperado DECIMAL(10,2) NULL,
  efectivo_contado  DECIMAL(10,2) NULL,
  diferencia        DECIMAL(10,2) NULL,
  total_ingresos    DECIMAL(12,2) NULL,
  total_egresos     DECIMAL(12,2) NULL,
  id_usuario_cierre INT NULL,
  FOREIGN KEY (id_usuario) REFERENCES USUARIOS(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

// Un registro por vehículo: nace en la entrada y se cierra al cobrar la salida
`CREATE TABLE IF NOT EXISTS TICKETS (
  id_ticket          INT AUTO_INCREMENT PRIMARY KEY,
  folio              VARCHAR(20) NOT NULL UNIQUE,
  placas             VARCHAR(20) NOT NULL,
  id_tarifa          INT NULL,
  tipo_vehiculo      VARCHAR(40) NOT NULL DEFAULT 'Auto',
  descripcion        VARCHAR(120) NULL,
  tipo_cobro         VARCHAR(20) NOT NULL DEFAULT 'Tiempo',
  id_pension         INT NULL,
  estado             VARCHAR(15) NOT NULL DEFAULT 'Dentro',
  entrada_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  id_usuario_entrada INT NOT NULL,
  salida_at          DATETIME NULL,
  id_usuario_salida  INT NULL,
  id_sesion          INT NULL,
  minutos            INT NULL,
  monto_tiempo       DECIMAL(10,2) NULL,
  cargo_extra        DECIMAL(10,2) NOT NULL DEFAULT 0,
  boleto_perdido     TINYINT(1) NOT NULL DEFAULT 0,
  monto_cobrado      DECIMAL(10,2) NULL,
  metodo_pago        VARCHAR(30) NULL,
  pago_recibido      DECIMAL(10,2) NULL,
  cambio             DECIMAL(10,2) NULL,
  cancel_motivo      VARCHAR(200) NULL,
  INDEX idx_tk_estado (estado),
  INDEX idx_tk_entrada (entrada_at),
  INDEX idx_tk_salida (salida_at),
  INDEX idx_tk_placas (placas),
  FOREIGN KEY (id_usuario_entrada) REFERENCES USUARIOS(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

`CREATE TABLE IF NOT EXISTS CAJA_MOVIMIENTOS (
  id_movimiento INT AUTO_INCREMENT PRIMARY KEY,
  id_sesion     INT NOT NULL,
  id_usuario    INT NOT NULL,
  id_ticket     INT NULL,
  id_pension    INT NULL,
  tipo          VARCHAR(20) NOT NULL,
  categoria     VARCHAR(40) DEFAULT 'Otro',
  concepto      VARCHAR(200) NOT NULL,
  monto         DECIMAL(10,2) NOT NULL,
  metodo_pago   VARCHAR(30) DEFAULT 'Efectivo',
  referencia    VARCHAR(100),
  anulado       TINYINT(1) NOT NULL DEFAULT 0,
  anulado_motivo VARCHAR(200) NULL,
  fecha_hora    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_mov_fecha (fecha_hora),
  INDEX idx_mov_ticket (id_ticket),
  FOREIGN KEY (id_sesion) REFERENCES CAJA_SESIONES(id_sesion),
  FOREIGN KEY (id_usuario) REFERENCES USUARIOS(id_usuario)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

`CREATE TABLE IF NOT EXISTS AUDITORIA (
  id_auditoria  INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario    INT,
  accion        VARCHAR(50) NOT NULL,
  tabla         VARCHAR(50),
  registro_id   INT,
  detalle       TEXT,
  ip            VARCHAR(45),
  fecha_hora    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aud_fecha (fecha_hora)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// Columnas que se agreguen en versiones futuras: [tabla, columna, definición]
const COLUMNS = [
  ['TICKETS', 'cliente', 'VARCHAR(120) NULL'],   // nombre de quien deja el vehículo (opcional)
];

const VIEWS = [
// Los movimientos anulados no cuentan para nada
`CREATE OR REPLACE VIEW vw_ResumenCaja AS
SELECT
  s.id_sesion, s.fondo_inicial,
  u.nombre AS cajero,
  IFNULL(SUM(CASE WHEN m.tipo='Ingreso' THEN m.monto ELSE 0 END), 0) AS total_ingresos,
  IFNULL(SUM(CASE WHEN m.tipo='Egreso'  THEN m.monto ELSE 0 END), 0) AS total_egresos,
  IFNULL(SUM(CASE WHEN m.tipo='Egreso' AND m.categoria='Retiro de efectivo' THEN m.monto ELSE 0 END), 0) AS total_retiros,
  IFNULL(SUM(CASE WHEN m.tipo='Egreso' AND m.categoria<>'Retiro de efectivo' THEN m.monto ELSE 0 END), 0) AS total_gastos,
  s.fondo_inicial
    + IFNULL(SUM(CASE WHEN m.tipo='Ingreso' AND m.metodo_pago='Efectivo' THEN m.monto ELSE 0 END), 0)
    - IFNULL(SUM(CASE WHEN m.tipo='Egreso'  AND m.metodo_pago='Efectivo' THEN m.monto ELSE 0 END), 0)
    AS efectivo_caja
FROM CAJA_SESIONES s
JOIN USUARIOS u ON u.id_usuario = s.id_usuario
LEFT JOIN CAJA_MOVIMIENTOS m ON m.id_sesion = s.id_sesion AND m.anulado = 0
GROUP BY s.id_sesion, s.fondo_inicial, u.nombre`,
];

const TARIFAS_SEED = [
  // nombre, icono, 1ª hora, fracción, min fracción, tope 24 h
  ['Auto',      '🚗', 20, 5, 15, 150],
  ['Camioneta', '🚙', 25, 7, 15, 180],
  ['Moto',      '🏍️', 10, 3, 15, 80],
  ['Camión',    '🚚', 40, 10, 15, 300],
];

const q = async (conn, sql, params = []) => (await conn.query(sql, params))[0];

async function migrate(log = console.log) {
  const conn = await pool.getConnection();
  try {
    for (const sql of TABLES) await q(conn, sql);

    for (const [t, c, def] of COLUMNS) {
      const ya = await q(conn, `SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [t, c]);
      if (!ya.length) await q(conn, `ALTER TABLE \`${t}\` ADD COLUMN \`${c}\` ${def}`);
    }

    for (const sql of VIEWS) await q(conn, sql);
    await seed(conn, log);
  } finally {
    conn.release();
  }
}

async function seed(conn, log) {
  await q(conn, "INSERT IGNORE INTO ROLES (id_rol, nombre) VALUES (1,'Administrador'),(2,'Cajero')");
  await q(conn, "INSERT IGNORE INTO SECUENCIAS (nombre, valor) VALUES ('FOLIO_TICKET', 0)");

  const [{ n: nTar }] = await q(conn, 'SELECT COUNT(*) AS n FROM TARIFAS');
  if (parseInt(nTar) === 0) {
    let orden = 1;
    for (const [nombre, icono, hora, frac, min, tope] of TARIFAS_SEED) {
      await q(conn, `INSERT INTO TARIFAS (nombre, icono, precio_hora, precio_fraccion, min_fraccion, tope_dia, orden)
        VALUES (?,?,?,?,?,?,?)`, [nombre, icono, hora, frac, min, tope, orden++]);
    }
    log('  [DB] Tarifas iniciales creadas (puedes cambiarlas en Tarifas).');
  }

  const [{ n: nUsr }] = await q(conn, 'SELECT COUNT(*) AS n FROM USUARIOS');
  if (parseInt(nUsr) === 0) {
    await q(conn, "INSERT INTO USUARIOS (nombre, usuario, password_hash, id_rol) VALUES ('Administrador', ?, ?, 1)",
      [cfg.ADMIN_USUARIO, await bcrypt.hash(cfg.ADMIN_PASSWORD, 10)]);
    await q(conn, "INSERT INTO USUARIOS (nombre, usuario, password_hash, id_rol) VALUES ('Cajero', ?, ?, 2)",
      [cfg.CAJERO_USUARIO, await bcrypt.hash(cfg.CAJERO_PASSWORD, 10)]);
    log(`  [DB] Usuarios iniciales creados: ${cfg.ADMIN_USUARIO} (administrador) y ${cfg.CAJERO_USUARIO} (cajero).`);
    log('       Sus contraseñas están en el archivo .env — cámbialas al entrar.');
  }
}

module.exports = { migrate };
