// ============================================================
//  config/app.js — Configuración global
//  Los valores sensibles se leen de variables de entorno (.env).
// ============================================================
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = (k, def) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : def);

// Muchos hostings (Railway, Render, etc.) entregan la BD como una sola URL
function parseDbUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname, port: parseInt(u.port || '3306'),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  } catch { return null; }
}
const dbUrl = parseDbUrl(env('DATABASE_URL', env('MYSQL_URL', '')));

module.exports = {
  APP_NAME:  env('APP_NAME', 'Estacionamiento'),
  APP_VER:   '1.0',
  PORT:      parseInt(env('PORT', '3002')),
  NODE_ENV:  env('NODE_ENV', 'development'),
  IS_PROD:   env('NODE_ENV', 'development') === 'production',
  TZ:        env('TZ', 'America/Mexico_City'),
  DB_TZ_OFFSET: env('DB_TZ_OFFSET', '-06:00'), // México centro (sin horario de verano)

  // ── Turnos ───────────────────────────────────────────────
  TURNO_MANANA_INI: 6,
  TURNO_MANANA_FIN: 18,

  // ── Base de datos ────────────────────────────────────────
  DB_HOST:     dbUrl?.host     || env('DB_HOST', env('MYSQLHOST', 'localhost')),
  DB_PORT:     dbUrl?.port     || parseInt(env('DB_PORT', env('MYSQLPORT', '3306'))),
  DB_DATABASE: dbUrl?.database || env('DB_DATABASE', env('MYSQLDATABASE', 'estacionamiento')),
  DB_USER:     dbUrl?.user     || env('DB_USER', env('MYSQLUSER', 'root')),
  DB_PASSWORD: dbUrl?.password ?? env('DB_PASSWORD', env('MYSQLPASSWORD', '')),
  DB_SSL:      env('DB_SSL', 'false') === 'true',
  DB_CHARSET:  'utf8mb4',

  // ── Roles ─────────────────────────────────────────────────
  ROL_ADMIN:  1,
  ROL_CAJERO: 2,

  // ── Sesión ───────────────────────────────────────────────
  SESSION_SECRET:   env('SESSION_SECRET', 'cambia-esta-clave-en-produccion'),
  SESSION_MAX_AGE:  12 * 60 * 60 * 1000,  // 12 horas

  // ── Usuarios iniciales (solo si la BD está vacía) ─────────
  ADMIN_USUARIO:   env('ADMIN_USUARIO', 'admin'),
  ADMIN_PASSWORD:  env('ADMIN_PASSWORD', 'Admin123!'),
  CAJERO_USUARIO:  env('CAJERO_USUARIO', 'cajero'),
  CAJERO_PASSWORD: env('CAJERO_PASSWORD', 'Cajero123!'),
};
