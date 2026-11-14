// ============================================================
//  middleware/auth.js — Autenticación y roles
// ============================================================
'use strict';

const bcrypt = require('bcryptjs');
const { dbFirst, dbExecute } = require('../lib/db');
const { ROL_ADMIN, ROL_CAJERO, TURNO_MANANA_INI, TURNO_MANANA_FIN } = require('../config/app');

module.exports = {
  ROL_ADMIN, ROL_CAJERO,

  /** Middleware: requiere uno de los roles indicados */
  requireRol(roles) {
    return async (req, res, next) => {
      if (!req.session.user) return res.redirect('/login');
      // Si al usuario lo dieron de baja o le cambiaron el rol, su sesión deja de valer
      try {
        const u = await dbFirst('SELECT id_rol, activo FROM USUARIOS WHERE id_usuario=?', [req.session.user.id_usuario]);
        if (!u || !u.activo) return req.session.destroy(() => res.redirect('/login'));
        req.session.user.id_rol = u.id_rol;
      } catch (e) { return next(e); }
      if (!roles.includes(req.session.user.id_rol)) {
        return res.status(403).render('error', { codigo: 403, mensaje: 'No tienes permiso para ver esta página.' });
      }
      next();
    };
  },

  /** Iniciar sesión: devuelve usuario o null */
  async login(usuario, password, ip = null) {
    const u = await dbFirst(
      `SELECT u.id_usuario, u.nombre, u.usuario, u.password_hash, u.id_rol, r.nombre AS nombre_rol
       FROM USUARIOS u JOIN ROLES r ON r.id_rol = u.id_rol
       WHERE LOWER(u.usuario) = LOWER(?) AND u.activo = 1`, [usuario]);
    if (!u) return null;
    if (!(await bcrypt.compare(password, u.password_hash))) return null;
    const { password_hash, ...datos } = u;
    try {
      await dbExecute("INSERT INTO AUDITORIA (id_usuario,accion,tabla,detalle,ip) VALUES (?,'LOGIN','USUARIOS','Inicio de sesión',?)",
        [u.id_usuario, ip]);
    } catch {}
    return datos;
  },

  /** Pantalla de inicio según el rol */
  urlDefaultPorRol(idRol) {
    return idRol === ROL_ADMIN ? '/dashboard' : '/operacion';
  },

  turnoActual() {
    const h = new Date().getHours();
    return (h >= TURNO_MANANA_INI && h < TURNO_MANANA_FIN) ? 'MAÑANA' : 'NOCHE';
  },

  /** Caja abierta en este momento (id_sesion o null). Solo hay una a la vez. */
  async sesionCajaActiva() {
    const s = await dbFirst('SELECT id_sesion FROM CAJA_SESIONES WHERE cerrada=0 ORDER BY abierta_at DESC LIMIT 1');
    return s ? parseInt(s.id_sesion) : null;
  },

  esAdmin(req) { return req.session.user?.id_rol === ROL_ADMIN; },

  async auditar(req, accion, tabla, regId = 0, detalle = '') {
    try {
      await dbExecute('INSERT INTO AUDITORIA (id_usuario,accion,tabla,registro_id,detalle,ip) VALUES (?,?,?,?,?,?)',
        [req.session.user?.id_usuario || null, accion, tabla, regId || null, detalle || null, req.ip || null]);
    } catch {}
  },
};
