// ============================================================
//  lib/db.js — Conexión MySQL + helpers
// ============================================================
'use strict';

const mysql  = require('mysql2/promise');
const cfg    = require('../config/app');

const base = {
  host:     cfg.DB_HOST,
  port:     cfg.DB_PORT,
  user:     cfg.DB_USER,
  password: cfg.DB_PASSWORD,
  charset:  cfg.DB_CHARSET,
  ssl:      cfg.DB_SSL ? { rejectUnauthorized: false } : undefined,
};

const pool = mysql.createPool({
  ...base,
  database:           cfg.DB_DATABASE,
  waitForConnections: true,
  connectionLimit:    10,
  dateStrings:        true,   // fechas como string 'YYYY-MM-DD HH:MM:SS'
  decimalNumbers:     false,
  enableKeepAlive:    true,
});

// NOW() y CURDATE() en hora de México aunque el servidor de BD esté en UTC
pool.on('connection', (conn) => {
  conn.query(`SET time_zone = '${cfg.DB_TZ_OFFSET}'`);
});

/** Crea la base de datos si todavía no existe (instalación nueva) */
async function ensureDatabase() {
  const conn = await mysql.createConnection(base);
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${cfg.DB_DATABASE.replace(/`/g, '')}\`
      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (e) {
    // En hostings el usuario no puede crear bases: ahí ya viene creada
    if (e.code !== 'ER_DBACCESS_DENIED_ERROR' && e.code !== 'ER_ACCESS_DENIED_ERROR') throw e;
  } finally {
    await conn.end();
  }
}

/** SELECT → array de filas */
async function dbQuery(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** SELECT → primera fila o null */
async function dbFirst(sql, params = []) {
  const rows = await dbQuery(sql, params);
  return rows[0] || null;
}

/** INSERT/UPDATE/DELETE → filas afectadas */
async function dbExecute(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result.affectedRows;
}

/** INSERT → ID generado */
async function dbInsert(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result.insertId;
}

/** Ejecuta fn(conn) dentro de una transacción */
async function dbTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Siguiente folio de secuencia (atómico) */
async function nextFolio(nombre) {
  const conn = await pool.getConnection();
  try {
    await conn.query('INSERT IGNORE INTO SECUENCIAS (nombre, valor) VALUES (?, 0)', [nombre]);
    await conn.query('UPDATE SECUENCIAS SET valor = LAST_INSERT_ID(valor + 1) WHERE nombre = ?', [nombre]);
    const [[row]] = await conn.query('SELECT LAST_INSERT_ID() AS v');
    return parseInt(row.v);
  } finally {
    conn.release();
  }
}

module.exports = { pool, ensureDatabase, dbQuery, dbFirst, dbExecute, dbInsert, dbTx, nextFolio };
